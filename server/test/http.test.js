import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from '../src/main.js';

test('health endpoint identifies this as an incomplete scaffold', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: 'ok',
    service: 'marugoto-bingo',
    stage: 'scaffold',
  });
});

test('unknown route returns JSON 404', async (t) => {
  const app = buildApp();
  t.after(() => app.close());

  const response = await app.inject({ method: 'GET', url: '/route-does-not-exist' });
  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: 'NOT_FOUND' });
});
