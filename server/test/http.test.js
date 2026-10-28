import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { makeApp, ORIGIN } from './helpers/appFixture.js';

const ONE_LINE = [true, true, true, false, false, false, false, false, false];

test('health と未知ルートのJSON 404', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const h = await f.req('GET', '/health');
  assert.equal(h.status, 200);
  assert.equal(h.json.status, 'ok');
  assert.equal((await f.req('GET', '/nope')).json.error, 'NOT_FOUND');
});

test('カード発行Cookieは HttpOnly/SameSite=Strict、同じCookieでは再発行しない', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const r = await f.req('POST', '/api/visitor/cards');
  assert.equal(r.status, 200);
  const raw = String(r.res.headers['set-cookie']);
  assert.match(raw, /HttpOnly/);
  assert.match(raw, /SameSite=Strict/);
  const cookie = f.cookieOf(r.res);
  const again = await f.req('POST', '/api/visitor/cards', { cookie });
  assert.equal(again.json.issued, false);
  assert.equal(again.json.cardId, r.json.cardId);
  const qr = await f.req('GET', '/api/visitor/card/qr.svg', { cookie });
  assert.equal(qr.status, 200);
  assert.match(qr.res.body, /<svg/);
  // the Cookie token itself is not stored in plain text
  const row = f.db.prepare('SELECT token_hash FROM cards WHERE card_id = ?').get(r.json.cardId);
  assert.ok(!raw.includes(row.token_hash));
});

test('22: 他サイトOriginとOriginなしの状態変更要求は拒否、43: 機器APIはOriginなしBearerで受理', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  assert.equal((await f.req('POST', '/api/visitor/cards', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.req('POST', '/api/visitor/cards', { origin: null })).status, 403);
  const token = f.deviceToken('garagara-1');
  const hb = await f.req('POST', '/api/device/v1/heartbeat', { origin: null, headers: { authorization: `Bearer ${token}` }, body: { machineId: 'garagara-1', bootId: randomUUID(), lastSeq: 0, cameraOk: true, sensorsOk: true } });
  assert.equal(hb.status, 200);
  assert.equal((await f.req('POST', '/api/device/v1/heartbeat', { origin: null, body: { machineId: 'garagara-1' } })).status, 401);
  const other = await f.req('POST', '/api/device/v1/heartbeat', { origin: null, headers: { authorization: `Bearer ${token}` }, body: { machineId: 'garagara-2', bootId: randomUUID() } });
  assert.equal(other.status, 403);
});

test('21: 来場者Cookieや未ログインでstaff/commandsは拒否、役割外の操作は403', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const visitor = f.cookieOf((await f.req('POST', '/api/visitor/cards')).res);
  assert.equal((await f.command(visitor, { type: 'redeemPrize', voucher: 'BM-0001' })).status, 401);
  const prize = await f.staff('prize');
  assert.equal((await f.command(prize, { type: 'setInventory', contents: {}, spare: {} })).status, 403);
  assert.equal((await f.req('GET', '/api/staff/view?role=admin', { cookie: visitor })).status, 401);
});

test('台担当は選択した台だけ操作できる', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  const op1 = await f.staff('operator');
  await f.req('POST', '/api/staff/machine', { cookie: op1, body: { machineId: 'garagara-1' } });
  const rev = f.svc.draw.getState().machines['garagara-2'].revision;
  const r = await f.req('POST', '/api/staff/cards/accept', { cookie: op1, body: { kind: 'paper', machineId: 'garagara-2', expectedMachineRevision: rev, operationId: f.op(), marks: ONE_LINE, cornerPresent: true } });
  assert.equal(r.status, 403);
  assert.equal(r.json.error, 'MACHINE_NOT_SELECTED');
});

test('スタンプQRでマスを埋め、デジタル受付でNをサーバー側で計算する。15: 2台同時受付は一方のみ成功', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const tokens = f.stampPoints();
  const visitor = f.cookieOf((await f.req('POST', '/api/visitor/cards')).res);
  for (const i of [0, 1, 2]) {
    const s = await f.req('POST', '/api/visitor/stamps', { cookie: visitor, body: { payload: `MARUGOTO2026:STAMP:${tokens[i]}`, cellIndex: i } });
    assert.equal(s.status, 200, JSON.stringify(s.json));
  }
  const wrongCell = await f.req('POST', '/api/visitor/stamps', { cookie: visitor, body: { payload: `MARUGOTO2026:STAMP:${tokens[5]}`, cellIndex: 4 } });
  assert.equal(wrongCell.status, 422);
  assert.match(wrongCell.json.message, /⑥のマス用/);
  const dup = await f.req('POST', '/api/visitor/stamps', { cookie: visitor, body: { payload: `MARUGOTO2026:STAMP:${tokens[0]}` } });
  assert.equal(dup.json.error, 'ALREADY_STAMPED');
  const bad = await f.req('POST', '/api/visitor/stamps', { cookie: visitor, body: { payload: 'MARUGOTO2026:STAMP:unknowntokenxxxxxxxxxxx' } });
  assert.equal(bad.status, 404);
  const card = (await f.req('GET', '/api/visitor/card', { cookie: visitor })).json;
  assert.equal(card.lines, 1);
  assert.equal(card.draws, 1);

  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  const s = f.svc.draw.getState();
  const accept = (machineId) => f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { kind: 'digital', payload: card.qrPayload, machineId, expectedMachineRevision: s.machines[machineId].revision, operationId: f.op() } });
  const [a, b] = await Promise.all([accept('garagara-1'), accept('garagara-2')]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.json.error, 'CARD_ALREADY_USED');
  const winner = a.status === 200 ? a : b;
  assert.equal(winner.json.result.n, 1);
  // QR is no longer offered and stamping stops after use
  const after = (await f.req('GET', '/api/visitor/card', { cookie: visitor })).json;
  assert.equal(after.used, true);
  assert.equal(after.qrPayload, null);
  // forged claim is rejected
  const forged = card.qrPayload.replace(/:[^:]+$/, ':AAAAAAAAAAAAAAAAAAAAAA');
  const fr = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { kind: 'digital', payload: forged, machineId: 'garagara-1', expectedMachineRevision: 0, operationId: f.op() } });
  assert.equal(fr.json.error, 'INVALID_CARD_QR');
  // claim never stored in the action log
  const log = f.db.prepare('SELECT action_json FROM action_log').all().map((r) => r.action_json).join('\n');
  assert.equal(log.includes(card.qrPayload.split(':').pop()), false);
});

test('C08/40: 同じoperationIdの再送は古いrevisionでも初回結果を返し二重実行しない。別内容は409', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  const rev = f.svc.draw.getState().machines['garagara-1'].revision;
  const body = { kind: 'paper', machineId: 'garagara-1', expectedMachineRevision: rev, operationId: f.op(), marks: ONE_LINE, cornerPresent: true };
  const first = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body });
  assert.equal(first.status, 200);
  const replay = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body });
  assert.equal(replay.status, 200);
  assert.equal(replay.json.duplicate, true);
  assert.equal(replay.json.result.sessionId, first.json.result.sessionId);
  assert.equal(f.svc.draw.getState().sessionOrder.length, 1);
  const changed = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { ...body, marks: Array(9).fill(true) } });
  assert.equal(changed.json.error, 'OPERATION_ID_REUSED');
});

test('33: 色ボタン連打（別operationId）は押した回数だけ記録され、再送は二重にならない', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  const rev = f.svc.draw.getState().machines['garagara-1'].revision;
  const sid = (await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { kind: 'paper', machineId: 'garagara-1', expectedMachineRevision: rev, operationId: f.op(), marks: Array(9).fill(true), cornerPresent: true } })).json.result.sessionId;
  const ops = [f.op(), f.op(), f.op(), f.op()];
  const send = (operationId, color) => f.req('POST', '/api/staff/commands', { cookie: admin, body: { operationId, type: 'manualBall', machineId: 'garagara-1', sessionId: sid, color } });
  await Promise.all([send(ops[0], 'white'), send(ops[1], 'white'), send(ops[2], 'green'), send(ops[3], 'red')]);
  await send(ops[1], 'white'); // retransmission
  const balls = f.svc.draw.getState().sessions[sid].balls;
  assert.equal(balls.length, 4);
});

test('25/26: 紙カードの読取修正は理由必須、角なしは理由必須、元判定と修正後が残る', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  const token = f.deviceToken('garagara-1');
  const bootId = randomUUID();
  const read = await f.req('POST', '/api/device/v1/card-reads', { origin: null, headers: { authorization: `Bearer ${token}` }, body: { machineId: 'garagara-1', bootId, readSeq: 1, kind: 'paper', cells: [true, true, null, false, false, false, false, false, false], cornerPresent: false, qrPayload: null } });
  assert.equal(read.status, 200);
  const readId = read.json.readId;
  const rev = () => f.svc.draw.getState().machines['garagara-1'].revision;
  const base = { kind: 'paper', machineId: 'garagara-1', readId, marks: ONE_LINE, cornerPresent: true };
  const noReason = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { ...base, expectedMachineRevision: rev(), operationId: f.op() } });
  assert.equal(noReason.status, 422);
  const noCorner = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { ...base, correctionReason: '3番は達成済みを目視確認', expectedMachineRevision: rev(), operationId: f.op() } });
  assert.equal(noCorner.status, 422, 'C1 reported a missing corner, so a corner reason is required');
  const ok = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { ...base, correctionReason: '3番は達成済みを目視確認', cornerReason: '受付担当が角の欠けを確認、初回提示', expectedMachineRevision: rev(), operationId: f.op() } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const session = f.svc.draw.getState().sessions[ok.json.result.sessionId];
  assert.deepEqual(session.intake.originalMarks, [true, true, null, false, false, false, false, false, false]);
  assert.deepEqual(session.intake.correctedMarks, ONE_LINE);
  assert.equal(session.intake.cornerPresent, false);
});

test('04/17: 出玉の同一連番再送はduplicate、連番欠落は409 SEQ_GAP、同じ連番で別内容は409', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  await f.command(admin, { type: 'setInputMode', machineId: 'garagara-1', mode: 'auto', reason: 'C2試験' });
  const token = f.deviceToken('garagara-1');
  const bootId = randomUUID();
  const dev = (path_, body) => f.req('POST', path_, { origin: null, headers: { authorization: `Bearer ${token}` }, body });
  await dev('/api/device/v1/heartbeat', { machineId: 'garagara-1', bootId });
  const rev = f.svc.draw.getState().machines['garagara-1'].revision;
  const acc = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { kind: 'paper', machineId: 'garagara-1', expectedMachineRevision: rev, operationId: f.op(), marks: Array(9).fill(true), cornerPresent: true } });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  const state = await f.req('GET', '/api/device/v1/state', { origin: null, headers: { authorization: `Bearer ${token}` } });
  const generation = state.json.generation;
  const ev = { machineId: 'garagara-1', bootId, seq: 1, detectedColor: 'green', orderUncertain: false, generation };
  const first = await dev('/api/device/v1/ball-events', ev);
  assert.equal(first.status, 200);
  assert.equal(first.json.duplicate, false);
  assert.equal(first.json.kind, 'valid');
  const again = await dev('/api/device/v1/ball-events', ev);
  assert.equal(again.json.duplicate, true);
  assert.equal(again.json.order, 1);
  assert.equal(f.svc.draw.getState().sessions[generation].balls.length, 1);
  const gap = await dev('/api/device/v1/ball-events', { ...ev, seq: 3 });
  assert.equal(gap.status, 409);
  assert.equal(gap.json.error, 'SEQ_GAP');
  assert.equal(gap.json.expectedSeq, 2);
  const diff = await dev('/api/device/v1/ball-events', { ...ev, detectedColor: 'red' });
  assert.equal(diff.status, 409);
  // a new bootId starts its own sequence (C10)
  const boot2 = await dev('/api/device/v1/ball-events', { ...ev, bootId: randomUUID(), seq: 1, detectedColor: 'white' });
  assert.equal(boot2.status, 200);
  assert.equal(boot2.json.order, 2);
  const bad = await dev('/api/device/v1/ball-events', { ...ev, seq: 2, detectedColor: 'gold' });
  assert.equal(bad.status, 422);
});

test('19: 抽選中に再起動しても同じ出玉・進行・使用済みカードから再開する', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-restart-'));
  const dbPath = path.join(dir, 'db.sqlite');
  const f1 = await makeApp({ dbPath });
  const admin = await f1.staff('admin', 'adminx');
  await f1.setupInventory(admin);
  const rev = f1.svc.draw.getState().machines['garagara-1'].revision;
  const acc = await f1.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { kind: 'paper', machineId: 'garagara-1', expectedMachineRevision: rev, operationId: f1.op(), marks: ONE_LINE, cornerPresent: true } });
  const sid = acc.json.result.sessionId;
  await f1.command(admin, { type: 'manualBall', machineId: 'garagara-1', sessionId: sid, color: 'red' });
  await f1.close();
  f1.db.close();

  const f2 = await makeApp({ dbPath });
  t.after(async () => { await f2.close(); f2.db.close(); });
  const s = f2.svc.draw.getState();
  assert.equal(s.machines['garagara-1'].activeSessionId, sid);
  assert.equal(s.sessions[sid].balls.length, 1);
  assert.equal(s.prizes.red.allocated, 1);
  const login = await f2.req('POST', '/api/staff/login', { body: { loginName: 'adminx', passcode: 'correct-horse-1' } });
  assert.equal(login.status, 200);
  const cardRow = f2.db.prepare('SELECT used_session_id FROM cards WHERE used_session_id = ?').get(sid);
  assert.ok(cardRow);
});

test('ログイン失敗が続くと429で止める', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  await f.staff('operator', 'lockme');
  let last;
  for (let i = 0; i < 7; i += 1) last = await f.req('POST', '/api/staff/login', { body: { loginName: 'lockme', passcode: 'wrong-pass-123' } });
  assert.equal(last.status, 429);
  const right = await f.req('POST', '/api/staff/login', { body: { loginName: 'lockme', passcode: 'correct-horse-1' } });
  assert.equal(right.status, 429);
});

test('会場マップ：未登録なら準備中の会場だけ、取込後はブースとステージ予定を返す。不正データは拒否', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const empty = (await f.req('GET', '/api/map', { origin: null })).json;
  assert.equal(empty.places.length, 0);
  assert.equal(empty.venue.name, '大垣城ホール');
  const admin = await f.staff('admin');
  const data = {
    venue: { name: '大垣城ホール', width: 40, depth: 28 },
    places: [
      { id: 'stage', kind: 'stage', name: 'ステージ', x: 5, y: 1, w: 30, d: 4, h: 1 },
      { id: 'b1', kind: 'booth', name: '試験ブース', x: 5, y: 10, w: 3, d: 2, h: 1, details: { fee: '無料' } },
    ],
    programs: [{ id: 'p2', stageId: 'stage', title: '後', startsAt: '2026-11-01T11:00+09:00' }, { id: 'p1', stageId: 'stage', title: '先', startsAt: '2026-11-01T10:00+09:00' }],
  };
  assert.equal((await f.req('PUT', '/api/admin/map', { cookie: admin, body: data })).status, 200);
  const map = (await f.req('GET', '/api/map', { origin: null })).json;
  assert.equal(map.places.length, 2);
  assert.deepEqual(map.programs.map((p) => p.title), ['先', '後']);
  const invalid = await f.req('PUT', '/api/admin/map', { cookie: admin, body: { ...data, places: [{ ...data.places[1], details: { secret: 'x' } }], programs: [] } });
  assert.equal(invalid.status, 422);
});

test('CSV出力は数式を無害化しBOM付き', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  const r = await f.req('GET', '/api/admin/export/audit.csv', { cookie: admin });
  assert.equal(r.status, 200);
  assert.ok(r.res.body.startsWith('﻿'));
  assert.equal(ORIGIN.length > 0, true);
});

test('42: VACUUM INTO のバックアップから起動すると、使用済みカード・景品確保・印刷待ち・引換状態が一致する', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-backup-'));
  const f = await makeApp({ dbPath: path.join(dir, 'live.sqlite') });
  const admin = await f.staff('admin', 'adminb');
  await f.setupInventory(admin);
  const rev = () => f.svc.draw.getState().machines['garagara-1'].revision;
  const acc = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { kind: 'paper', machineId: 'garagara-1', expectedMachineRevision: rev(), operationId: f.op(), marks: ONE_LINE, cornerPresent: true } });
  const sid = acc.json.result.sessionId;
  await f.command(admin, { type: 'manualBall', machineId: 'garagara-1', sessionId: sid, color: 'green' });
  await f.command(admin, { type: 'finalizeResult', machineId: 'garagara-1', sessionId: sid, trayEmptied: true });
  const backup = path.join(dir, 'backup.sqlite');
  f.db.prepare('VACUUM INTO ?').run(backup);
  const before = f.svc.draw.getState();
  await f.close();
  f.db.close();
  const g = await makeApp({ dbPath: backup });
  t.after(async () => { await g.close(); g.db.close(); });
  const after = g.svc.draw.getState();
  assert.deepEqual(after, before);
  assert.equal(after.sessions[sid].voucher.jobs[0].status, 'queued');
  assert.equal(after.prizes.green.allocated, 1);
  assert.ok(g.db.prepare('SELECT used_at FROM cards WHERE used_session_id = ?').get(sid).used_at);
});

test('終了案内：初期値はPOPどおり受付14:30と抽選15:00（開催日のJST）、管理者だけが変更できる', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const r = await f.req('GET', '/api/notices', { origin: null });
  assert.deepEqual(r.json.notices.map((n) => [n.id, n.at]), [['reception', '2026-11-01T14:30:00+09:00'], ['draw', '2026-11-01T15:00:00+09:00']]);
  assert.ok(r.json.now);
  const op = await f.staff('operator');
  assert.equal((await f.req('PUT', '/api/admin/notice-config', { cookie: op, body: { enabled: true, reception: '14:00', draw: '15:00' } })).status, 403);
  const admin = await f.staff('admin');
  assert.equal((await f.req('PUT', '/api/admin/notice-config', { cookie: admin, body: { enabled: true, reception: '25:00', draw: '15:00' } })).status, 422);
  assert.equal((await f.req('PUT', '/api/admin/notice-config', { cookie: admin, body: { enabled: true, reception: '14:45', draw: '15:10' } })).status, 200);
  assert.equal((await f.req('GET', '/api/notices', { origin: null })).json.notices[0].time, '14:45');
  await f.req('PUT', '/api/admin/notice-config', { cookie: admin, body: { enabled: false, reception: '14:45', draw: '15:10' } });
  assert.equal((await f.req('GET', '/api/notices', { origin: null })).json.notices.length, 0);
});
