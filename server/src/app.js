import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { openDatabase, runMigrations } from './db/connection.js';
import { createBus } from './realtime/bus.js';
import { createDrawService } from './services/drawService.js';
import { createCardService } from './services/cardService.js';
import { createDeviceService } from './services/deviceService.js';
import { createAuthService } from './services/authService.js';
import { createMapService } from './services/mapService.js';
import { createSurveyService } from './services/surveyService.js';
import { createNoticeService } from './services/noticeService.js';
import { errorHandler, securityHeaders, verifyOrigin } from './http/security.js';
import { visitorRoutes } from './http/routes/visitor.js';
import { staffRoutes } from './http/routes/staff.js';
import { adminRoutes } from './http/routes/admin.js';
import { deviceRoutes } from './http/routes/device.js';
import { streamRoutes } from './http/routes/stream.js';
import { nowJst } from './time.js';

const require_ = createRequire(import.meta.url);

/** Wire services on one DB handle. Tests pass ':memory:' and a fake clock. */
export function createServices({ config, db, clock = nowJst }) {
  runMigrations(db);
  const bus = createBus();
  let devices = null;
  const draw = createDrawService({ db, bus, clock, deviceOnline: () => devices?.deviceOnlineMap() ?? {} });
  const cards = createCardService({ db, clock, draw, claimSecret: config.claimSecret, bus });
  devices = createDeviceService({ db, clock, draw, bus, imageDir: config.imageDir, imageRetentionDays: config.imageRetentionDays, cards });
  const auth = createAuthService({ db, clock, machineExists: (id) => Boolean(draw.getState().machines[id]) });
  const maps = createMapService({ db, clock });
  const surveys = createSurveyService({ db, clock });
  const notices = createNoticeService({ db, clock, eventDate: () => draw.getState().settings.heldOn });
  return { db, bus, draw, cards, devices, auth, maps, surveys, notices, clock };
}

export function buildApp({ config, db = null, clock = nowJst, logger = false, services = null } = {}) {
  const ownDb = !db && !services;
  const database = services?.db ?? db ?? openDatabase(config.dbPath);
  const svc = services ?? createServices({ config, db: database, clock });
  const app = Fastify({ logger, trustProxy: config.trustProxy, bodyLimit: 64 * 1024, return503OnClosing: true });
  app.decorate('config', config);
  app.decorate('services', svc);
  app.setErrorHandler(errorHandler);
  app.register(fastifyCookie);
  app.addContentTypeParser('image/jpeg', { parseAs: 'buffer', bodyLimit: 300 * 1024 }, (_req, body, done) => done(null, body));
  app.addHook('onSend', async (_request, reply, payload) => {
    securityHeaders(reply);
    return payload;
  });

  const originHook = verifyOrigin(config);
  app.addHook('onRequest', async (request) => {
    const url = request.url;
    // Cookie-authenticated browser APIs; device API is excluded on purpose.
    if (url.startsWith('/api/') && !url.startsWith('/api/device/')) await originHook(request);
  });

  app.get('/health', async () => {
    database.prepare('SELECT 1').get();
    return { status: 'ok', service: 'marugoto-bingo', revision: svc.draw.getState().revision, time: svc.clock() };
  });

  app.register(async (scope) => {
    visitorRoutes(scope, { ...svc, config });
    staffRoutes(scope, svc);
    adminRoutes(scope, svc);
    deviceRoutes(scope, svc);
    streamRoutes(scope, { ...svc, config });
  });

  if (config.webDir && fs.existsSync(config.webDir)) {
    app.register(fastifyStatic, {
      root: config.webDir,
      prefix: '/',
      index: ['index.html'],
      list: false,
      dotfiles: 'deny',
      redirect: true,
      setHeaders(reply, filePath) {
        // Small no-build app: always revalidate so a deploy is picked up at once.
        reply.header('Cache-Control', /\.(png|jpe?g|webp|svg|woff2?)$/.test(filePath) ? 'public, max-age=3600' : 'no-cache');
      },
    });
    const jsqr = require_.resolve('jsqr/dist/jsQR.js');
    app.get('/vendor/jsQR.js', async (_request, reply) => reply.type('text/javascript; charset=utf-8').header('Cache-Control', 'public, max-age=86400').send(fs.createReadStream(jsqr)));
    app.get('/', async (_request, reply) => reply.redirect('/visitor/'));
    app.get('/staff/print-station', async (_request, reply) => reply.redirect('/print/'));
  }

  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: 'NOT_FOUND' }));

  if (ownDb) app.addHook('onClose', async () => database.close());
  return app;
}

export function resolveWebFile(config, ...parts) {
  return path.join(config.webDir, ...parts);
}
