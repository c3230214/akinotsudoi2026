import { DomainError } from '../../domain/errors.js';
import { listActionLog } from '../../db/repos/drawRepo.js';
import { cardStats } from '../../db/repos/cardRepo.js';
import { createRateLimiter } from '../../services/rateLimiter.js';
import { safeEqual } from '../../services/secrets.js';
import { clientIp } from '../security.js';
import { auditCsv, sendCsv, sessionsCsv } from './admin.js';

const REALM = 'Basic realm="marugoto-bingo admin", charset="UTF-8"';

/**
 * Administrator panel behind HTTP Basic authentication (2026-10-28 request).
 * It shows quantities and logs and can close new intake. Credentials come
 * from ADMIN_PANEL_USER / ADMIN_PANEL_PASSWORD; without them the panel is off.
 * Basic credentials are re-sent by the browser on every request, so the
 * state-changing endpoint is also covered by the Origin check for /api/*.
 */
export function basicAuthHook(config) {
  const failures = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 20 });
  return async function panelAuth(request, reply) {
    if (!config.panelUser || !config.panelPassword) {
      throw new DomainError('PANEL_DISABLED', '管理パネルは設定されていません', { status: 404 });
    }
    const ip = clientIp(request);
    if (failures.blocked(ip)) throw new DomainError('TOO_MANY_ATTEMPTS', 'しばらく待ってから再試行してください', { status: 429 });
    const m = String(request.headers.authorization ?? '').match(/^Basic ([A-Za-z0-9+/=]{1,400})$/);
    let user = '';
    let pass = '';
    if (m) {
      const decoded = Buffer.from(m[1], 'base64').toString('utf8');
      const i = decoded.indexOf(':');
      if (i >= 0) { user = decoded.slice(0, i); pass = decoded.slice(i + 1); }
    }
    // Evaluate both comparisons so timing does not reveal which part was wrong.
    const okUser = safeEqual(user, config.panelUser);
    const okPass = safeEqual(pass, config.panelPassword);
    if (!(okUser && okPass)) {
      if (m) failures.hit(ip);
      reply.header('WWW-Authenticate', REALM);
      throw new DomainError('UNAUTHENTICATED', '管理パネルにはログインが必要です', { status: 401 });
    }
    failures.reset(ip);
    request.panelUser = user;
  };
}

const panelActor = (request) => ({ kind: 'panel', id: request.panelUser, name: '管理パネル', role: 'admin' });

export function panelRoutes(app, { draw, devices, surveys, db, clock }) {
  app.get('/api/panel/summary', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const v = draw.getStaffView({ devices: devices.getDeviceStatus() });
    return {
      now: clock(),
      intakeClosed: v.intakeClosed,
      prizes: v.prizes,
      totals: v.totals,
      shortage: v.shortage,
      ledger: v.ledger,
      machines: v.machines.map((m) => ({
        id: m.id, name: m.name, phase: m.phase, inputMode: m.inputMode, emergency: m.emergency, resumeRequired: m.resumeRequired,
        contents: m.contents, returnPending: m.returnPending, online: m.device?.online ?? false, activeSession: m.activeSession ? { id: m.activeSession.id, n: m.activeSession.n, count: m.activeSession.summary.count } : null,
      })),
      printQueue: v.printQueue.map((j) => ({ sessionId: j.sessionId, status: j.status, station: j.station ?? null })),
      recentSessions: v.recentSessions.slice(0, 20),
      cards: cardStats(db),
      surveys: { total: surveys.summary().total },
    };
  });

  app.get('/api/panel/logs', {
    schema: { querystring: { type: 'object', properties: { before: { type: 'integer' }, limit: { type: 'integer', minimum: 1, maximum: 200 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const rows = listActionLog(db, { before: request.query.before ?? null, limit: request.query.limit ?? 50 });
    return { rows, next: rows.length ? rows[rows.length - 1].seq : null };
  });

  app.post('/api/panel/intake', {
    schema: { body: { type: 'object', required: ['closed', 'operationId'], properties: { closed: { type: 'boolean' }, reason: { type: 'string', maxLength: 100 }, operationId: { type: 'string', maxLength: 80 } } } },
  }, async (request) => {
    const { operationId, ...rest } = request.body;
    return draw.execute({ action: { type: 'setIntakeClosed', ...rest }, actor: panelActor(request), operationId, requestBody: request.body });
  });

  app.get('/api/panel/export/sessions.csv', async (_request, reply) => sendCsv(reply, 'sessions.csv', sessionsCsv(draw.getState())));
  app.get('/api/panel/export/audit.csv', async (_request, reply) => sendCsv(reply, 'audit.csv', auditCsv(db)));
}
