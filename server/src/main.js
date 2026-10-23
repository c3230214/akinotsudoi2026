import Fastify from 'fastify';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.js';

/** Build an app instance so HTTP tests can inject and close it. */
export function buildApp({ logger = false } = {}) {
  const app = Fastify({ logger });

  app.get('/health', async () => ({
    status: 'ok',
    service: 'marugoto-bingo',
    stage: 'scaffold',
  }));

  app.setNotFoundHandler(async (_request, reply) => {
    return reply.code(404).send({ error: 'NOT_FOUND' });
  });

  return app;
}

export async function start() {
  const config = loadConfig();
  const app = buildApp({ logger: true });
  await app.listen({ host: config.host, port: config.port });
  return app;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
