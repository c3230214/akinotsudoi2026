import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('config has safe local development defaults', () => {
  assert.deepEqual(loadConfig({}), {
    nodeEnv: 'development',
    host: '127.0.0.1',
    port: 3000,
    publicOrigin: null,
    dbPath: './data/marugoto-bingo.sqlite',
    imageDir: './data/images',
  });
});

test('config parses known settings', () => {
  assert.deepEqual(loadConfig({
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: '8088',
    PUBLIC_ORIGIN: 'https://example.org/some/path',
    DB_PATH: '/tmp/test.sqlite',
    IMAGE_DIR: '/tmp/test-images',
  }), {
    nodeEnv: 'test',
    host: '127.0.0.1',
    port: 8088,
    publicOrigin: 'https://example.org',
    dbPath: '/tmp/test.sqlite',
    imageDir: '/tmp/test-images',
  });
});

test('config rejects invalid port, environment and public origin', () => {
  assert.throws(() => loadConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => loadConfig({ NODE_ENV: 'live' }), /NODE_ENV/);
  assert.throws(() => loadConfig({ PUBLIC_ORIGIN: 'file:///tmp/app' }), /http or https/);
});
