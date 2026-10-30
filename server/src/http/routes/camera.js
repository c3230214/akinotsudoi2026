import { DomainError } from '../../domain/errors.js';
import { requireStaff } from '../auth.js';
import { createRateLimiter } from '../../services/rateLimiter.js';

/**
 * Camera station: Chrome on the venue Windows PC with three webcams
 * (one for cards, one per machine for balls). It signs in with a staff
 * account; Cookie + Origin protect these endpoints like other browser APIs.
 */
export function cameraRoutes(app, { auth, draw, devices }) {
  const pre = requireStaff(auth, 'admin', 'printer', 'operator');
  const limiter = createRateLimiter({ windowMs: 60_000, max: 240 });
  const own = (request, machineId) => {
    const a = request.staffAuth;
    if (machineId === 'auto') {
      // Automatic routing may pick either machine, so a machine operator cannot use it.
      if (a.staff.role === 'operator') throw new DomainError('FORBIDDEN', '自動振り分けは発券端末か管理者のアカウントで使います', { status: 403 });
      if (!limiter.hit(a.sessionHash).allowed) throw new DomainError('RATE_LIMITED', '送信が多すぎます', { status: 429 });
      return;
    }
    if (a.staff.role === 'operator' && a.machineId !== machineId) {
      throw new DomainError('MACHINE_NOT_SELECTED', '担当台として選択している台だけ送信できます', { status: 403 });
    }
    if (!limiter.hit(a.sessionHash).allowed) throw new DomainError('RATE_LIMITED', '送信が多すぎます', { status: 429 });
    // Each machine's tablet decides whether camera recognition is used there.
    const m = draw.getState().machines[machineId];
    if (m && m.cameraAssist !== true) {
      throw new DomainError('CAMERA_ASSIST_OFF', `${m.name}のタブレットでカメラ自動認識がオフになっています`, { status: 409 });
    }
  };

  app.get('/api/camera/state', { preHandler: pre }, async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const s = draw.getState();
    const status = devices.getDeviceStatus();
    return {
      intakeClosed: s.intakeClosed?.closed ? s.intakeClosed : null,
      ready: devices.machinesReady().map((m) => m.id),
      machines: Object.values(s.machines).map((m) => ({
        id: m.id, name: m.name, phase: m.phase, stopped: Boolean(m.emergency || m.resumeRequired),
        activeSessionId: m.activeSessionId, pendingRead: Boolean(status[m.id]?.pendingRead),
        cameraAssist: m.cameraAssist === true,
      })),
    };
  });

  app.post('/api/camera/card-read', {
    preHandler: pre,
    bodyLimit: 700 * 1024,
    schema: {
      body: {
        type: 'object', required: ['machineId', 'kind'],
        properties: {
          machineId: { type: 'string', maxLength: 32 }, kind: { enum: ['paper', 'digital'] },
          cells: { type: 'array', minItems: 9, maxItems: 9, items: { type: ['boolean', 'null'] } },
          cornerPresent: { type: ['boolean', 'null'] }, qrPayload: { type: 'string', maxLength: 300 },
          image: { type: 'string', maxLength: 600 * 1024 },
        },
      },
    },
  }, async (request) => {
    own(request, request.body.machineId);
    return devices.receiveBrowserCardRead(request.body.machineId, request.body);
  });

  app.post('/api/camera/hint', {
    preHandler: pre,
    schema: { body: { type: 'object', required: ['machineId'], properties: { machineId: { type: 'string', maxLength: 32 }, color: { type: ['string', 'null'], maxLength: 16 }, confidence: { type: 'number' } } } },
  }, async (request) => {
    own(request, request.body.machineId);
    return devices.addHint(request.body.machineId, request.body);
  });
}
