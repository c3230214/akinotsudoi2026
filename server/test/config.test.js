import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const PROD = {
  NODE_ENV: 'production',
  PUBLIC_ORIGIN: 'https://bingo.example.jp',
  CARD_CLAIM_SECRET: 'x'.repeat(48),
};

test('config has safe local development defaults', () => {
  const c = loadConfig({});
  assert.equal(c.nodeEnv, 'development');
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.port, 3000);
  assert.equal(c.publicOrigin, null);
  assert.equal(c.dbPath, './data/marugoto-bingo.sqlite');
  assert.equal(c.cookieSecure, false);
  assert.equal(c.trustProxy, false);
  assert.equal(c.imageRetentionDays, 14);
});

test('config parses known settings', () => {
  const c = loadConfig({
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: '8088', PUBLIC_ORIGIN: 'https://example.org/some/path',
    DB_PATH: '/tmp/test.sqlite', IMAGE_DIR: '/tmp/test-images', IMAGE_RETENTION_DAYS: '7', COOKIE_SECURE: 'true',
  });
  assert.equal(c.port, 8088);
  assert.equal(c.publicOrigin, 'https://example.org');
  assert.equal(c.dbPath, '/tmp/test.sqlite');
  assert.equal(c.imageDir, '/tmp/test-images');
  assert.equal(c.imageRetentionDays, 7);
  assert.equal(c.cookieSecure, true);
});

test('production requires https origin, a real claim secret and secure cookies', () => {
  const c = loadConfig(PROD);
  assert.equal(c.cookieSecure, true);
  assert.equal(c.trustProxy, '127.0.0.1');
  assert.throws(() => loadConfig({ ...PROD, PUBLIC_ORIGIN: '' }), /PUBLIC_ORIGIN is required/);
  assert.throws(() => loadConfig({ ...PROD, PUBLIC_ORIGIN: 'http://bingo.example.jp' }), /https/);
  assert.throws(() => loadConfig({ ...PROD, PUBLIC_ORIGIN: 'https://CHANGE-ME.example.invalid' }), /placeholder/);
  assert.throws(() => loadConfig({ ...PROD, CARD_CLAIM_SECRET: 'short' }), /CARD_CLAIM_SECRET/);
});

test('config rejects invalid port, environment and public origin', () => {
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ NODE_ENV: 'live' }), /NODE_ENV/);
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'file:///tmp/app' }), /http or https/);
  assert.throws(() => loadConfig({ IMAGE_RETENTION_DAYS: '0' }), /IMAGE_RETENTION_DAYS/);
});
