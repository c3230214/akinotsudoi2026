import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PORT = 3000;
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Development only. Production refuses to start without its own secret.
const DEV_CLAIM_SECRET = 'development-only-claim-secret-do-not-use-in-production';

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

function parseBool(value, key, fallback) {
  if (value === undefined || value === '') return fallback;
  if (['1', 'true', 'yes'].includes(value)) return true;
  if (['0', 'false', 'no'].includes(value)) return false;
  throw new Error(`${key} must be true or false`);
}

function parseIntRange(value, key, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
  return n;
}

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }
  const production = nodeEnv === 'production';
  const publicOrigin = parseOptionalUrl(env.PUBLIC_ORIGIN, 'PUBLIC_ORIGIN');
  if (production && !publicOrigin) throw new Error('PUBLIC_ORIGIN is required in production');
  if (production && publicOrigin.startsWith('http:')) throw new Error('PUBLIC_ORIGIN must use https in production');
  if (production && /CHANGE-ME|example\.invalid/i.test(publicOrigin)) throw new Error('PUBLIC_ORIGIN still has the placeholder value');

  const claimSecret = env.CARD_CLAIM_SECRET || (production ? '' : DEV_CLAIM_SECRET);
  if (claimSecret.length < 32) throw new Error('CARD_CLAIM_SECRET must be at least 32 characters');
  if (production && claimSecret === DEV_CLAIM_SECRET) throw new Error('CARD_CLAIM_SECRET must be changed for production');

  return Object.freeze({
    nodeEnv,
    host: env.HOST || '127.0.0.1',
    port: parsePort(env.PORT),
    publicOrigin,
    dbPath: env.DB_PATH || './data/marugoto-bingo.sqlite',
    imageDir: env.IMAGE_DIR || './data/images',
    webDir: env.WEB_DIR || path.resolve(SERVER_ROOT, '..', 'web'),
    claimSecret,
    cookieSecure: parseBool(env.COOKIE_SECURE, 'COOKIE_SECURE', production),
    // Caddy on the same host: trust X-Forwarded-For only from loopback.
    trustProxy: env.TRUST_PROXY === undefined || env.TRUST_PROXY === '' ? (production ? '127.0.0.1' : false) : env.TRUST_PROXY,
    // TODO(DECISION-images): 14 days after the event is the spec's default proposal.
    imageRetentionDays: parseIntRange(env.IMAGE_RETENTION_DAYS, 'IMAGE_RETENTION_DAYS', 14, 1, 365),
  });
}
