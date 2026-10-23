const DEFAULT_PORT = 3000;

function parsePort(value) {
  if (value === undefined || value === '') return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 to 65535');
  }
  return port;
}

function parseOptionalUrl(value, key) {
  if (value === undefined || value === '') return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid absolute URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${key} must use http or https`);
  }
  return url.origin;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  return Object.freeze({
    nodeEnv,
    host: env.HOST || '127.0.0.1',
    port: parsePort(env.PORT),
    publicOrigin: parseOptionalUrl(env.PUBLIC_ORIGIN, 'PUBLIC_ORIGIN'),
    dbPath: env.DB_PATH || './data/marugoto-bingo.sqlite',
    imageDir: env.IMAGE_DIR || './data/images',
  });
}
