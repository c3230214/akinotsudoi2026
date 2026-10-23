import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';

export async function start(env = process.env) {
  const config = loadConfig(env);
  const app = buildApp({ config, logger: { level: config.nodeEnv === 'production' ? 'info' : 'debug', redact: ['req.headers.authorization', 'req.headers.cookie'] } });
  const shutdown = async (signal) => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
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
