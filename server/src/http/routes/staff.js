import fs from 'node:fs';
import QRCode from 'qrcode';
import { DomainError } from '../../domain/errors.js';
import { listActionLog } from '../../db/repos/drawRepo.js';
import { COOKIES, clientIp, cookieOptions } from '../security.js';
import { requireStaff, staffActor } from '../auth.js';

const OPS = ['admin', 'operator'];
/** Which roles may send each command; operators are further limited to their selected machine. */
export const COMMAND_ROLES = Object.freeze({
  manualBall: OPS,
  removeManualBall: OPS,
  correctBall: OPS,
  voidBall: OPS,
  retryShortage: OPS,
  resolveUnassigned: OPS,
  finalizeResult: OPS,
  requestReprint: [...OPS, 'printer'],
  recordPrintResult: [...OPS, 'printer'],
  returnBalls: OPS,
  refillPlanned: OPS,
  setInputMode: OPS,
  setCameraAssist: OPS,
  emergencyStop: OPS,
  clearEmergency: OPS,
  resumeDrawing: OPS,
  redeemPrize: ['admin', 'prize'],
  markManualVoucher: ['admin'],
  setInventory: ['admin'],
  adjustInventory: ['admin'],
  addRefillPlan: ['admin'],
  updateSettings: ['admin'],
  setIntakeClosed: ['admin'],
});

const BODY_LIMIT_KEYS = 40;

function machineScope(state, action) {
  if (action.machineId) return action.machineId;
  if (action.sessionId && state.sessions[action.sessionId]) return state.sessions[action.sessionId].machineId;
  if (action.unassignedId) return state.unassigned.find((u) => u.id === action.unassignedId)?.machineId ?? null;
  return null;
}

export function staffRoutes(app, { auth, draw, cards, devices, surveys, db }) {
  const anyStaff = requireStaff(auth);

  app.post('/api/staff/login', {
    schema: { body: { type: 'object', required: ['loginName', 'passcode'], properties: { loginName: { type: 'string', maxLength: 64 }, passcode: { type: 'string', maxLength: 128 } } } },
  }, async (request, reply) => {
    const out = await auth.login(request.body.loginName, request.body.passcode, clientIp(request));
    reply.setCookie(COOKIES.staff, out.token, cookieOptions(app.config, out.maxAgeSec));
    return { staff: out.staff };
  });

  app.post('/api/staff/logout', async (request, reply) => {
    auth.logout(request.cookies[COOKIES.staff]);
    reply.clearCookie(COOKIES.staff, { path: '/' });
    return { ok: true };
  });

  app.get('/api/staff/me', { preHandler: anyStaff }, async (request) => ({
    staff: request.staffAuth.staff,
    machineId: request.staffAuth.machineId,
    machines: Object.values(draw.getState().machines).map((m) => ({ id: m.id, name: m.name })),
  }));

  app.post('/api/staff/machine', {
    preHandler: anyStaff,
    schema: { body: { type: 'object', required: ['machineId'], properties: { machineId: { type: ['string', 'null'], maxLength: 32 } } } },
  }, async (request) => auth.selectMachine(request.staffAuth, request.body.machineId));

  app.get('/api/staff/view', { preHandler: anyStaff }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return staffView(draw, devices);
  });

  app.post('/api/staff/commands', {
    preHandler: anyStaff,
    schema: { body: { type: 'object', required: ['type', 'operationId'], maxProperties: BODY_LIMIT_KEYS, properties: { type: { type: 'string', maxLength: 40 }, operationId: { type: 'string', maxLength: 80 } } } },
  }, async (request) => {
    const { operationId, ...action } = request.body;
    const roles = Object.hasOwn(COMMAND_ROLES, action.type) ? COMMAND_ROLES[action.type] : null;
    if (!roles) throw new DomainError('UNKNOWN_COMMAND', `unknown command ${action.type}`, { status: 422 });
    const a = request.staffAuth;
    if (!roles.includes(a.staff.role)) throw new DomainError('FORBIDDEN', 'この操作の権限がありません', { status: 403 });
    if (action.type === 'startSession' || action.type === 'ballDetected') throw new DomainError('FORBIDDEN', 'この操作は専用APIを使ってください', { status: 403 });
    if (a.staff.role === 'operator') {
      const target = machineScope(draw.getState(), action);
      if (target && target !== a.machineId) throw new DomainError('MACHINE_NOT_SELECTED', '担当台として選択している台だけ操作できます', { status: 403 });
    }
    if (action.type === 'recordPrintResult' && a.staff.role === 'printer' && !['claimed', 'dispatched', 'confirmed', 'failed'].includes(action.outcome)) {
      throw new DomainError('FORBIDDEN', 'この操作の権限がありません', { status: 403 });
    }
    return draw.execute({ action, actor: staffActor(a), operationId, requestBody: request.body });
  });

  const intakeAuth = requireStaff(auth, ...OPS);
  const requireOwnMachine = (request) => {
    const a = request.staffAuth;
    if (a.staff.role === 'operator' && request.body.machineId !== a.machineId) {
      throw new DomainError('MACHINE_NOT_SELECTED', '担当台として選択している台だけ受付できます', { status: 403 });
    }
  };

  app.post('/api/staff/cards/accept', {
    preHandler: intakeAuth,
    schema: {
      body: {
        type: 'object', required: ['kind', 'machineId', 'expectedMachineRevision', 'operationId'],
        properties: {
          kind: { enum: ['paper', 'digital'] }, machineId: { type: 'string', maxLength: 32 }, expectedMachineRevision: { type: 'integer' },
          operationId: { type: 'string', maxLength: 80 }, payload: { type: 'string', maxLength: 300 }, readId: { type: ['integer', 'null'] },
          marks: { type: 'array', minItems: 9, maxItems: 9, items: { type: 'boolean' } }, declaredDraws: { type: 'integer', minimum: 1, maximum: 3 },
          cornerPresent: { type: 'boolean' }, cornerReason: { type: 'string', maxLength: 500 }, correctionReason: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request) => {
    requireOwnMachine(request);
    const b = request.body;
    const actor = staffActor(request.staffAuth);
    // The QR claim is part of the idempotency hash but never stored or logged.
    const requestBody = { ...b };
    if (b.kind === 'digital') {
      return cards.acceptDigital({ payload: b.payload, readId: b.readId ?? null, machineId: b.machineId, expectedMachineRevision: b.expectedMachineRevision, actor, operationId: b.operationId, requestBody });
    }
    if (!b.marks && !b.declaredDraws) throw new DomainError('VALIDATION_FAILED', '9マスの達成状態か抽選回数を指定してください', { status: 422 });
    return cards.acceptPaper({ ...b, marks: b.marks ?? null, declaredDraws: b.declaredDraws ?? null, readId: b.readId ?? null, actor, requestBody });
  });

  app.post('/api/staff/cards/lookup', {
    preHandler: requireStaff(auth, ...OPS, 'prize'),
    schema: { body: { type: 'object', required: ['payload'], properties: { payload: { type: 'string', maxLength: 300 } } } },
  }, async (request) => {
    const info = cards.lookupForStaff(request.body.payload);
    const survey = surveys.find(info.cardId);
    return { ...info, survey: survey ? { answeredAt: survey.answeredAt, giftAt: survey.giftAt } : null };
  });

  app.post('/api/staff/card-reads/:readId/dismiss', {
    preHandler: intakeAuth,
    schema: { params: { type: 'object', properties: { readId: { type: 'integer' } } }, body: { type: 'object', required: ['machineId'], properties: { machineId: { type: 'string' } } } },
  }, async (request) => {
    requireOwnMachine(request);
    cards.dismissRead(request.params.readId, request.body.machineId);
    return { ok: true };
  });

  app.post('/api/staff/survey-gift', {
    preHandler: requireStaff(auth, 'admin', 'prize'),
    schema: { body: { type: 'object', required: ['payload'], properties: { payload: { type: 'string', maxLength: 300 } } } },
  }, async (request) => {
    const card = cards.verifyDigital(request.body.payload);
    return surveys.giveGift(card.id, staffActor(request.staffAuth));
  });

  app.get('/api/staff/vouchers/:number', { preHandler: requireStaff(auth, 'admin', 'prize', 'operator') }, async (request) => {
    const s = draw.getState();
    const id = String(request.params.number).toUpperCase();
    const session = s.sessions[id];
    if (!session?.voucher) throw new DomainError('UNKNOWN_VOUCHER', `券番号 ${id} は発行されていません`, { status: 404 });
    return { number: id, machineId: session.machineId, finalizedAt: session.finalizedAt, ...session.voucher, jobs: undefined, printStatus: session.voucher.printStatus };
  });

  app.get('/api/staff/vouchers/:number/qr.svg', { preHandler: requireStaff(auth, 'admin', 'printer', 'operator') }, async (request, reply) => {
    const id = String(request.params.number).toUpperCase();
    if (!/^BM-\d{4,6}$/.test(id) || !draw.getState().sessions[id]?.voucher) throw new DomainError('UNKNOWN_VOUCHER', '券番号が見つかりません', { status: 404 });
    const svg = await QRCode.toString(`MARUGOTO2026:VOUCHER:${id}`, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 });
    return reply.type('image/svg+xml; charset=utf-8').header('Cache-Control', 'private, max-age=3600').send(svg);
  });

  app.get('/api/staff/images/:imageId', { preHandler: requireStaff(auth, ...OPS) }, async (request, reply) => {
    const img = devices.imagePath(request.params.imageId);
    if (!img || !fs.existsSync(img.path)) throw new DomainError('NOT_FOUND', '画像が見つかりません', { status: 404 });
    reply.header('Cache-Control', 'private, max-age=300');
    return reply.type(img.mime).send(fs.createReadStream(img.path));
  });

  app.get('/api/staff/audit', {
    preHandler: requireStaff(auth, ...OPS, 'prize'),
    schema: { querystring: { type: 'object', properties: { before: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 500 }, type: { type: 'string', maxLength: 40 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const rows = listActionLog(db, request.query);
    return { rows, next: rows.length ? rows[rows.length - 1].seq : null };
  });
}

export function staffView(draw, devices) {
  const status = devices.getDeviceStatus();
  return draw.getStaffView({ devices: status });
}
