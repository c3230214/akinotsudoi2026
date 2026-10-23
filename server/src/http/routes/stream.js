import { requireKiosk, requireStaff } from '../auth.js';
import { COOKIES, cookieOptions } from '../security.js';
import { staffView } from './staff.js';
import { printQueue } from '../../domain/draw/projections.js';

const KEEPALIVE_MS = 15_000;
const DEBOUNCE_MS = 120;

/**
 * Server-Sent Events: full view on connect, again after each committed change
 * (debounced), and a comment every 15 s. EventSource reconnects by itself and
 * receives the latest full view, so a missed message never leaves stale state.
 */
function openStream(request, reply, bus, project, { filter = () => true, tickMs = null } = {}) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  let timer = null;
  let closed = false;
  let last = '';
  const send = () => {
    timer = null;
    if (closed) return;
    try {
      const data = JSON.stringify(project());
      if (data === last) return;
      last = data;
      res.write(`event: view\ndata: ${data}\n\n`);
    } catch (error) {
      request.log.warn({ err: error }, 'sse write failed');
    }
  };
  const schedule = () => { if (!timer) timer = setTimeout(send, DEBOUNCE_MS); };
  const unsubscribe = bus.subscribe('draw', (evt) => { if (filter(evt)) schedule(); });
  const keepalive = setInterval(() => { if (!closed) res.write(': keepalive\n\n'); }, KEEPALIVE_MS);
  // Time-based guidance (refill due, heartbeat timeout) changes without a command (§15 C26).
  const ticker = tickMs ? setInterval(schedule, tickMs) : null;
  res.write('retry: 3000\n\n');
  send();
  request.raw.on('close', () => {
    closed = true;
    unsubscribe();
    clearInterval(keepalive);
    if (ticker) clearInterval(ticker);
    if (timer) clearTimeout(timer);
  });
}

export function streamRoutes(app, { auth, draw, devices, bus, config }) {
  app.get('/api/stream/staff', { preHandler: requireStaff(auth) }, async (request, reply) => {
    openStream(request, reply, bus, () => staffView(draw, devices), { tickMs: 5_000 });
  });

  app.get('/api/stream/kiosk', { preHandler: requireKiosk(auth) }, async (request, reply) => {
    const { machineId } = request.kiosk;
    openStream(request, reply, bus, () => draw.getKioskView(machineId), { filter: (evt) => Boolean(evt.touched?.includes(machineId)) });
  });

  app.get('/api/stream/print', { preHandler: requireStaff(auth, 'printer', 'admin', 'operator') }, async (request, reply) => {
    openStream(request, reply, bus, () => ({ jobs: printQueue(draw.getState()) }), { filter: (evt) => Boolean(evt.events?.some((e) => e.topic === 'print')) });
  });

  app.post('/api/kiosk/pair', {
    schema: { body: { type: 'object', required: ['code'], properties: { code: { type: 'string', maxLength: 20 } } } },
  }, async (request, reply) => {
    const out = auth.pairKiosk(request.body.code);
    reply.setCookie(COOKIES.kiosk, out.token, cookieOptions(config, 60 * 60 * 24 * 7));
    return { machineId: out.machineId };
  });

  app.get('/api/kiosk/view', { preHandler: requireKiosk(auth) }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    return draw.getKioskView(request.kiosk.machineId);
  });
}
