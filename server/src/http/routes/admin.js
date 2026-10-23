import { randomUUID } from 'node:crypto';
import { listActionLog } from '../../db/repos/drawRepo.js';
import { cardStats, listStampPoints } from '../../db/repos/cardRepo.js';
import { requireStaff, staffActor } from '../auth.js';
import { ROLES } from '../../services/authService.js';

function csvCell(v) {
  const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function toCsv(header, rows) {
  return `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}

export function adminRoutes(app, { auth, draw, maps, surveys, db }) {
  const admin = requireStaff(auth, 'admin');

  app.put('/api/admin/settings', { preHandler: admin, schema: { body: { type: 'object', required: ['settings'] } } }, async (request) => draw.execute({
    action: { type: 'updateSettings', settings: request.body.settings },
    actor: staffActor(request.staffAuth),
    operationId: request.body.operationId ?? randomUUID(),
    requestBody: request.body,
  }));

  app.get('/api/admin/staff', { preHandler: admin }, async () => ({ staff: auth.listStaff(), roles: ROLES }));

  app.post('/api/admin/staff', {
    preHandler: admin,
    schema: { body: { type: 'object', required: ['loginName', 'displayName', 'role', 'passcode'], properties: { loginName: { type: 'string', maxLength: 32 }, displayName: { type: 'string', maxLength: 40 }, role: { enum: ROLES }, passcode: { type: 'string', minLength: 8, maxLength: 128 } } } },
  }, async (request) => ({ staffId: await auth.createStaff(request.body, staffActor(request.staffAuth)) }));

  app.patch('/api/admin/staff/:staffId', {
    preHandler: admin,
    schema: { params: { type: 'object', properties: { staffId: { type: 'integer' } } }, body: { type: 'object', properties: { displayName: { type: 'string', maxLength: 40 }, role: { enum: ROLES }, passcode: { type: 'string', minLength: 8, maxLength: 128 }, active: { type: 'boolean' } } } },
  }, async (request) => {
    await auth.changeStaff(request.params.staffId, request.body, staffActor(request.staffAuth));
    return { ok: true };
  });

  app.post('/api/admin/kiosk-codes', {
    preHandler: admin, schema: { body: { type: 'object', required: ['machineId'], properties: { machineId: { type: 'string', maxLength: 32 } } } },
  }, async (request) => auth.issueKioskCode(request.body.machineId, staffActor(request.staffAuth)));

  app.get('/api/admin/kiosks', { preHandler: admin }, async () => ({ kiosks: auth.listKiosks() }));
  app.post('/api/admin/kiosks/:kioskId/revoke', { preHandler: admin }, async (request) => ({ ok: auth.revokeKiosk(request.params.kioskId) }));

  app.get('/api/admin/map', { preHandler: admin }, async () => maps.exportMap());
  app.put('/api/admin/map', { preHandler: admin, bodyLimit: 512 * 1024 }, async (request) => maps.importMap(request.body, staffActor(request.staffAuth)));

  app.get('/api/admin/stamp-points', { preHandler: admin }, async () => ({ points: listStampPoints(db) }));
  app.get('/api/admin/cards/stats', { preHandler: admin }, async () => ({ cards: cardStats(db) }));

  app.get('/api/admin/survey-config', { preHandler: admin }, async () => surveys.getConfig());
  app.put('/api/admin/survey-config', { preHandler: admin }, async (request) => surveys.setConfig(request.body, staffActor(request.staffAuth)));
  app.get('/api/admin/surveys/summary', { preHandler: admin }, async () => surveys.summary());

  app.get('/api/admin/export/audit.csv', { preHandler: admin }, async (_request, reply) => {
    const rows = [];
    let before = null;
    for (;;) {
      const page = listActionLog(db, { before, limit: 500 });
      if (!page.length) break;
      rows.push(...page);
      before = page[page.length - 1].seq;
    }
    rows.reverse();
    const csv = toCsv(['seq', 'at', 'actor', 'role', 'type', 'result', 'message', 'action', 'revision'],
      rows.map((r) => [r.seq, r.at, r.actor.name ?? r.actor.id ?? r.actor.kind, r.actor.role ?? r.actor.kind, r.type, r.result, r.message, r.action, r.revisionAfter]));
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="audit.csv"').send(csv);
  });

  app.get('/api/admin/export/sessions.csv', { preHandler: admin }, async (_request, reply) => {
    const s = draw.getState();
    const rows = s.sessionOrder.map((id) => {
      const x = s.sessions[id];
      const balls = x.balls.filter((b) => !b.removed);
      return [id, x.machineId, x.card.kind, x.lines, x.n, x.status, x.createdAt, x.createdBy, x.finalizedAt,
        balls.map((b) => `${b.order}:${b.color ?? '?'}:${b.kind}:${b.source}`).join(' '),
        x.voucher?.prizes.map((p) => `${p.grade}等`).join(' ') ?? '', x.voucher?.printStatus ?? '', x.voucher?.redeemedAt ?? '', x.intake?.correctionReason ?? '', x.intake?.cornerReason ?? ''];
    });
    const csv = toCsv(['voucher', 'machine', 'cardKind', 'lines', 'n', 'status', 'createdAt', 'createdBy', 'finalizedAt', 'balls', 'prizes', 'print', 'redeemedAt', 'correctionReason', 'cornerReason'], rows);
    return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="sessions.csv"').send(csv);
  });
}
