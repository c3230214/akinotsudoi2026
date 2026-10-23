import { requireDevice } from '../auth.js';
import { createRateLimiter } from '../../services/rateLimiter.js';
import { DomainError } from '../../domain/errors.js';

/**
 * Venue-PC programs authenticate with a per-machine Bearer token. No Origin
 * header is required or used here (§15 C06).
 */
export function deviceRoutes(app, { devices }) {
  const auth = requireDevice(devices);
  const limiter = createRateLimiter({ windowMs: 60_000, max: 600 });
  const limit = async (request) => {
    if (!limiter.hit(request.deviceMachineId).allowed) throw new DomainError('RATE_LIMITED', 'too many requests', { status: 429 });
  };
  const pre = [auth, limit];

  app.post('/api/device/v1/ball-events', { preHandler: pre, bodyLimit: 8 * 1024 }, async (request) => devices.receiveBallEvent(request.deviceMachineId, request.body));
  app.post('/api/device/v1/card-reads', { preHandler: pre, bodyLimit: 8 * 1024 }, async (request) => devices.receiveCardRead(request.deviceMachineId, request.body));
  app.post('/api/device/v1/heartbeat', { preHandler: pre, bodyLimit: 4 * 1024 }, async (request) => devices.receiveHeartbeat(request.deviceMachineId, request.body));
  app.get('/api/device/v1/state', { preHandler: pre }, async (request) => devices.getDeviceState(request.deviceMachineId));
  app.post('/api/device/v1/images', { preHandler: pre, bodyLimit: 300 * 1024 }, async (request) => (
    devices.saveImage(request.deviceMachineId, request.body, String(request.headers['content-type'] ?? '').split(';')[0].trim())
  ));
}
