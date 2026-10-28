import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { openDatabase, tx } from '../../src/db/connection.js';
import { upsertStampPoint } from '../../src/db/repos/cardRepo.js';
import { setDeviceToken } from '../../src/db/repos/deviceRepo.js';
import { sha256 } from '../../src/services/secrets.js';
import { nowJst } from '../../src/time.js';

export const ORIGIN = 'https://bingo.test';

export async function makeApp({ dbPath = ':memory:', clock = nowJst, env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-test-'));
  const config = loadConfig({ NODE_ENV: 'test', PUBLIC_ORIGIN: ORIGIN, IMAGE_DIR: path.join(dir, 'images'), WEB_DIR: path.join(dir, 'no-web'), ...env });
  const db = openDatabase(dbPath);
  const app = buildApp({ config, db, clock });
  await app.ready();
  const svc = app.services;
  const jar = {};

  const req = async (method, url, { body, cookie, headers = {}, origin = ORIGIN } = {}) => {
    const h = { ...headers };
    if (origin) h.origin = origin;
    if (cookie) h.cookie = cookie;
    const res = await app.inject({ method, url, payload: body, headers: h });
    return { status: res.statusCode, json: res.headers['content-type']?.includes('json') ? res.json() : null, res };
  };

  const cookieOf = (res) => {
    const raw = res.headers['set-cookie'];
    const list = Array.isArray(raw) ? raw : [raw];
    return list.filter(Boolean).map((c) => c.split(';')[0]).join('; ');
  };

  async function staff(role, loginName = `${role}${Math.floor(Math.random() * 1e6)}`) {
    await svc.auth.createStaff({ loginName, displayName: `${role}担当`, role, passcode: 'correct-horse-1' }, { kind: 'test', id: 't' });
    const r = await req('POST', '/api/staff/login', { body: { loginName, passcode: 'correct-horse-1' } });
    if (r.status !== 200) throw new Error(`login failed ${r.status}`);
    return cookieOf(r.res);
  }

  function deviceToken(machineId) {
    const token = `dev-${machineId}-${randomUUID()}`.replace(/[^A-Za-z0-9_-]/g, '');
    tx(db, () => setDeviceToken(db, machineId, sha256(token), nowJst()));
    return token;
  }

  function stampPoints() {
    const tokens = {};
    tx(db, () => {
      for (let i = 0; i < 9; i += 1) {
        tokens[i] = `stamptoken${i}xxxxxxxxxxxx`;
        upsertStampPoint(db, { id: `cell-${i + 1}`, name: `cell ${i + 1}`, cellIndex: i, tokenHash: sha256(tokens[i]), at: nowJst() });
      }
    });
    return tokens;
  }

  let opSeq = 0;
  const op = () => `op-${Date.now()}-${(opSeq += 1)}-${Math.random().toString(36).slice(2, 8)}`;

  async function command(cookie, body) {
    return req('POST', '/api/staff/commands', { cookie, body: { operationId: op(), ...body } });
  }

  async function setupInventory(adminCookie) {
    return command(adminCookie, {
      type: 'setInventory',
      contents: { 'garagara-1': { red: 5, green: 5, lightblue: 5, white: 5 }, 'garagara-2': { red: 5, green: 5, lightblue: 5, white: 5 } },
      spare: {},
    });
  }

  return { app, db, svc, req, staff, cookieOf, deviceToken, stampPoints, op, command, setupInventory, jar, close: () => app.close(), dir };
}
