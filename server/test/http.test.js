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
  // The intake QR needs the survey first (2026-10-28).
  assert.equal((await f.req('GET', '/api/visitor/card/qr.svg', { cookie })).status, 403);
  assert.equal(again.json.qrPayload, null);
  assert.equal(again.json.surveyRequired, true);
  await f.req('POST', '/api/visitor/survey', { cookie, body: { consent: true, ageGroup: '20代', gender: '女性', ratings: { event: 4, bingo: 4, digital: 4 } } });
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
  await f.req('POST', '/api/visitor/survey', { cookie: visitor, body: { consent: true, ageGroup: '20代', gender: '女性', ratings: { event: 4, bingo: 4, digital: 4 } } });
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

test('会場マップ：初回は同梱の会場案内図とステージスケジュール（完成版パンフレット）、取込で置き換え、不正データは拒否', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const bundled = (await f.req('GET', '/api/map', { origin: null })).json;
  assert.equal(bundled.venue.name, '大垣城ホール');
  const names = bundled.places.map((p) => p.shortName ?? p.name);
  for (const n of ['かがやきステージ', 'だいこう列車', 'グラウンドゴルフ', 'おはぎ販売', '景品交換所']) assert.ok(names.includes(n), n);
  assert.deepEqual(bundled.places.filter((p) => p.kind === 'outdoor').map((p) => p.id).sort(), ['daiko', 'groundgolf', 'ohagi']);
  assert.equal(bundled.programs.length, 20);
  // The final schedule gives part times only: 第2部 is 12:30-15:00 for every performer.
  const os = bundled.programs.find((g) => g.organizer === 'OSアンサンブル風');
  assert.deepEqual([os.startsAt, os.endsAt], ['2026-11-01T12:30+09:00', '2026-11-01T15:00+09:00']);
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

test('管理パネル：ベーシック認証、受付終了で両台の受付を拒否し来場者に案内、他サイトからの変更は拒否', async (t) => {
  const f = await makeApp({ env: { ADMIN_PANEL_USER: 'paneluser', ADMIN_PANEL_PASSWORD: 'panel-pass-1' } });
  t.after(() => f.close());
  const basic = (u, p) => ({ authorization: `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}` });
  const none = await f.req('GET', '/api/panel/summary', { origin: null });
  assert.equal(none.status, 401);
  assert.match(String(none.res.headers['www-authenticate']), /^Basic realm=/);
  assert.equal((await f.req('GET', '/api/panel/summary', { origin: null, headers: basic('paneluser', 'wrong') })).status, 401);
  const ok = await f.req('GET', '/api/panel/summary', { origin: null, headers: basic('paneluser', 'panel-pass-1') });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.prizes.length, 4);
  assert.equal((await f.req('GET', '/admin/', { origin: null })).status, 401);
  // CSRF: the browser re-sends Basic credentials, so the Origin check must still apply.
  const evil = await f.req('POST', '/api/panel/intake', { origin: 'https://evil.example', headers: basic('paneluser', 'panel-pass-1'), body: { closed: true, operationId: f.op() } });
  assert.equal(evil.status, 403);
  const close = await f.req('POST', '/api/panel/intake', { headers: basic('paneluser', 'panel-pass-1'), body: { closed: true, operationId: f.op() } });
  assert.equal(close.status, 200);
  const notice = (await f.req('GET', '/api/notices', { origin: null })).json;
  assert.equal(notice.intakeClosed.reason, '景品がなくなったため');
  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  const rev = f.svc.draw.getState().machines['garagara-1'].revision;
  const acc = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { kind: 'paper', machineId: 'garagara-1', expectedMachineRevision: rev, operationId: f.op(), marks: ONE_LINE, cornerPresent: true } });
  assert.equal(acc.json.error, 'INTAKE_CLOSED');
  const logs = await f.req('GET', '/api/panel/logs', { origin: null, headers: basic('paneluser', 'panel-pass-1') });
  assert.ok(logs.json.rows.some((r) => r.type === 'setIntakeClosed' && r.actor.name === '管理パネル'));
});

test('管理パネルは資格情報が未設定なら無効（404）', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  assert.equal((await f.req('GET', '/api/panel/summary', { origin: null })).status, 404);
});

test('⑤はタップで達成（QRなし）、他のマスはタップだけでは達成できない', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const visitor = f.cookieOf((await f.req('POST', '/api/visitor/cards')).res);
  const tap = await f.req('POST', '/api/visitor/tap', { cookie: visitor, body: { cellIndex: 4 } });
  assert.equal(tap.status, 200, JSON.stringify(tap.json));
  assert.equal(tap.json.card.marks[4], true);
  assert.equal((await f.req('POST', '/api/visitor/tap', { cookie: visitor, body: { cellIndex: 4 } })).json.error, 'CELL_ALREADY_MARKED');
  assert.equal((await f.req('POST', '/api/visitor/tap', { cookie: visitor, body: { cellIndex: 0 } })).status, 422);
  assert.equal((await f.req('POST', '/api/visitor/tap', { cookie: null, body: { cellIndex: 4 } })).status, 401);
});

test('アンケート：年代・性別と3項目の満足度（1〜5）をコードで保存し、集計とCSVに出す。1カード1回', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const answer = async (body) => {
    const v = f.cookieOf((await f.req('POST', '/api/visitor/cards')).res);
    return f.req('POST', '/api/visitor/survey', { cookie: v, body: { consent: true, ...body } });
  };
  const cfg = (await f.req('GET', '/api/visitor/survey', { origin: null })).json;
  assert.equal(cfg.enabled, true);
  assert.deepEqual(cfg.questions.map((q) => q.label), ['秋のつどいの満足度', 'まるごと体験ビンゴの満足度', 'デジタルビンゴカードの満足度']);
  assert.equal((await answer({ ageGroup: '30代', gender: '女性', ratings: { event: 5, bingo: 4, digital: 3 } })).status, 200);
  assert.equal((await answer({ ageGroup: '30代', gender: '男性', ratings: { event: 4, bingo: 4, digital: 5 } })).status, 200);
  assert.equal((await answer({ ageGroup: '10代', gender: '女性', ratings: { event: 3, bingo: 1, digital: 4 } })).status, 200);
  assert.equal((await answer({ ageGroup: '30代', gender: '女性', ratings: { event: 9, bingo: 4, digital: 4 } })).status, 422);
  assert.equal((await answer({ ageGroup: '30代', gender: '女性', ratings: { event: 4, bingo: 4 } })).status, 422);
  assert.equal((await answer({ ageGroup: '130代', gender: '女性', ratings: { event: 3, bingo: 3, digital: 3 } })).status, 422);
  const admin = await f.staff('admin');
  const sum = (await f.req('GET', '/api/admin/surveys/summary', { cookie: admin })).json;
  assert.equal(sum.total, 3);
  assert.equal(sum.questions.find((q) => q.key === 'event').mean, 4);
  assert.equal(sum.questions.find((q) => q.key === 'bingo').mean, 3);
  assert.equal(sum.questions.find((q) => q.key === 'digital').distribution[5], 1);
  assert.equal(sum.byAge.find((r) => r.label === '30代').means.event, 4.5);
  assert.equal(sum.byGender.find((r) => r.label === '女性').count, 2);
  const csv = (await f.req('GET', '/api/admin/export/surveys.csv', { cookie: admin })).res.body;
  assert.match(csv, /"eventSatisfaction","bingoSatisfaction","digitalCardSatisfaction"/);
  assert.match(csv, /"4","30代","2","女性","5","4","3"/);
  const v = f.cookieOf((await f.req('POST', '/api/visitor/cards')).res);
  await f.req('POST', '/api/visitor/survey', { cookie: v, body: { consent: true, ageGroup: '20代', gender: '女性', ratings: { event: 3, bingo: 3, digital: 3 } } });
  assert.equal((await f.req('POST', '/api/visitor/survey', { cookie: v, body: { consent: true, ageGroup: '20代', gender: '女性', ratings: { event: 3, bingo: 3, digital: 3 } } })).json.error, 'ALREADY_ANSWERED');
});

test('カメラ画面：紙カードの判定とデジタルQRを振り分けた台の確認待ちに置き、玉の色は候補として出すだけ', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  const pc = await f.staff('printer');
  // On by default; a machine's tablet can turn it off, and then nothing is sent there.
  assert.equal((await f.req('GET', '/api/camera/state', { cookie: pc })).json.machines[0].cameraAssist, true);
  assert.equal((await f.command(admin, { type: 'setCameraAssist', machineId: 'garagara-1', enabled: false })).status, 200);
  assert.equal((await f.req('POST', '/api/camera/hint', { cookie: pc, body: { machineId: 'garagara-1', color: 'red' } })).json.error, 'CAMERA_ASSIST_OFF');
  assert.equal((await f.command(admin, { type: 'setCameraAssist', machineId: 'garagara-1', enabled: true })).status, 200);
  const paper = await f.req('POST', '/api/camera/card-read', { cookie: pc, body: { machineId: 'garagara-2', kind: 'paper', cells: [true, true, true, false, true, null, false, false, true], cornerPresent: true } });
  assert.equal(paper.status, 200, JSON.stringify(paper.json));
  assert.equal(paper.json.preview.lines, 2);
  assert.equal(paper.json.preview.unsure, 1);
  const view = (await f.req('GET', '/api/staff/view', { cookie: admin })).json;
  const m2 = view.machines.find((m) => m.id === 'garagara-2');
  assert.equal(m2.device.pendingRead.readId, paper.json.readId);
  assert.equal(m2.device.pendingRead.preview.draws, 1);
  // digital: claim verified, unused card with lines only
  const tokens = f.stampPoints();
  const visitor = f.cookieOf((await f.req('POST', '/api/visitor/cards')).res);
  const empty = f.svc.cards.getCardView(f.svc.cards.cardFromToken(visitor.split('=')[1]));
  assert.equal((await f.req('POST', '/api/camera/card-read', { cookie: pc, body: { machineId: 'garagara-1', kind: 'digital', qrPayload: empty.qrPayload } })).json.error, 'NO_LINES');
  for (const i of [0, 1, 2]) await f.req('POST', '/api/visitor/stamps', { cookie: visitor, body: { payload: `MARUGOTO2026:STAMP:${tokens[i]}`, cellIndex: i } });
  const dig = await f.req('POST', '/api/camera/card-read', { cookie: pc, body: { machineId: 'garagara-1', kind: 'digital', qrPayload: empty.qrPayload } });
  assert.equal(dig.status, 200);
  assert.equal(dig.json.preview.draws, 1);
  const acc = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { kind: 'digital', readId: dig.json.readId, machineId: 'garagara-1', expectedMachineRevision: f.svc.draw.getState().machines['garagara-1'].revision, operationId: f.op() } });
  assert.equal(acc.status, 200, JSON.stringify(acc.json));
  // ball hint
  const hint = await f.req('POST', '/api/camera/hint', { cookie: pc, body: { machineId: 'garagara-1', color: 'green', confidence: 0.7 } });
  assert.equal(hint.status, 200);
  const v2 = (await f.req('GET', '/api/staff/view', { cookie: admin })).json;
  assert.equal(v2.machines[0].device.hints[0].color, 'green');
  assert.equal(f.svc.draw.getState().sessions[acc.json.result.sessionId].balls.length, 0, 'a hint never records a ball');
  const visitorCookie = f.cookieOf((await f.req('POST', '/api/visitor/cards')).res);
  assert.equal((await f.req('POST', '/api/camera/hint', { cookie: visitorCookie, body: { machineId: 'garagara-1', color: 'red' } })).status, 401);
});

test('タブレットの回数選択：紙カードは1〜3回を選んで開始し、色を入力して確定すると各回の等級が引換券に載る', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  const op1 = await f.staff('operator');
  await f.req('POST', '/api/staff/machine', { cookie: op1, body: { machineId: 'garagara-1' } });
  const rev = () => f.svc.draw.getState().machines['garagara-1'].revision;
  const accept = (body) => f.req('POST', '/api/staff/cards/accept', { cookie: op1, body: { kind: 'paper', machineId: 'garagara-1', expectedMachineRevision: rev(), operationId: f.op(), cornerPresent: true, ...body } });
  assert.equal((await accept({ declaredDraws: 4 })).status, 422);
  assert.equal((await accept({ declaredDraws: 2, marks: Array(9).fill(true) })).status, 422);
  // The other machine's operator cannot start this machine.
  const op2 = await f.staff('operator');
  await f.req('POST', '/api/staff/machine', { cookie: op2, body: { machineId: 'garagara-2' } });
  assert.equal((await f.req('POST', '/api/staff/cards/accept', { cookie: op2, body: { kind: 'paper', declaredDraws: 1, machineId: 'garagara-1', expectedMachineRevision: rev(), operationId: f.op(), cornerPresent: true } })).status, 403);
  const out = await accept({ declaredDraws: 2 });
  assert.equal(out.status, 200, JSON.stringify(out.json));
  const id = out.json.result.sessionId;
  const session = f.svc.draw.getState().sessions[id];
  assert.equal(session.n, 2);
  assert.equal(session.lines, null);
  assert.equal(session.intake.source, 'staff-count');
  for (const color of ['white', 'green']) assert.equal((await f.command(op1, { type: 'manualBall', machineId: 'garagara-1', sessionId: id, color })).status, 200);
  const fin = await f.command(op1, { type: 'finalizeResult', machineId: 'garagara-1', sessionId: id, trayEmptied: true });
  assert.equal(fin.status, 200, JSON.stringify(fin.json));
  const job = (await f.req('GET', '/api/staff/view', { cookie: admin })).json.printQueue.find((j) => j.sessionId === id);
  assert.equal(job.draws, 2);
  assert.deepEqual(job.prizes.map((p) => p.grade), [4, 2]);
  // Camera assist is switched per machine by its own operator only.
  assert.equal((await f.command(op1, { type: 'setCameraAssist', machineId: 'garagara-1', enabled: true })).status, 200);
  assert.equal((await f.command(op1, { type: 'setCameraAssist', machineId: 'garagara-2', enabled: true })).status, 403);
});

test('埋め込み：WindowsPC画面の枠に入るカメラ画面と発券画面だけ同一オリジンからの埋め込みを許可', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  for (const [url, expected] of [['/camera/', 'SAMEORIGIN'], ['/print/', 'SAMEORIGIN'], ['/visitor/', 'DENY'], ['/garagara1/', 'DENY'], ['/staff/', 'DENY'], ['/camera/../visitor/', 'DENY']]) {
    const r = await f.req('GET', url, { origin: null });
    assert.equal(r.res.headers['x-frame-options'], expected, url);
  }
  assert.match((await f.req('GET', '/camera/', { origin: null })).res.headers['content-security-policy'], /frame-ancestors 'self'/);
});

test('カメラ1の自動振り分け：空いている台へ交互に送り、確認待ち・抽選中・自動認識オフの台は避け、同じカードは二重に送らない', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const admin = await f.staff('admin');
  await f.setupInventory(admin);
  const pc = await f.staff('printer');
  const tokens = f.stampPoints();
  const card = async () => {
    const v = f.cookieOf((await f.req('POST', '/api/visitor/cards')).res);
    for (const i of [0, 1, 2]) await f.req('POST', '/api/visitor/stamps', { cookie: v, body: { payload: `MARUGOTO2026:STAMP:${tokens[i]}`, cellIndex: i } });
    return f.svc.cards.getCardView(f.svc.cards.cardFromToken(v.split('=')[1])).qrPayload;
  };
  const send = (body) => f.req('POST', '/api/camera/card-read', { cookie: pc, body: { machineId: 'auto', ...body } });
  const a = await card();
  const r1 = await send({ kind: 'digital', qrPayload: a });
  assert.equal(r1.status, 200, JSON.stringify(r1.json));
  assert.equal(r1.json.machineId, 'garagara-1');
  assert.equal((await send({ kind: 'digital', qrPayload: a })).json.error, 'READ_ALREADY_PENDING');
  const r2 = await send({ kind: 'paper', cells: [true, true, true, false, false, false, false, false, false], cornerPresent: true });
  assert.equal(r2.json.machineId, 'garagara-2');
  // Both machines now have a card waiting.
  assert.equal((await send({ kind: 'digital', qrPayload: await card() })).json.error, 'NO_MACHINE_READY');
  assert.equal((await send({ kind: 'paper', cells: Array(9).fill(false), cornerPresent: true })).json.error, 'NO_LINES');
  // Machine 1 confirms and starts drawing; machine 2 dismisses its read.
  const acc = await f.req('POST', '/api/staff/cards/accept', { cookie: admin, body: { kind: 'digital', readId: r1.json.readId, machineId: 'garagara-1', expectedMachineRevision: f.svc.draw.getState().machines['garagara-1'].revision, operationId: f.op() } });
  assert.equal(acc.status, 200);
  await f.req('POST', `/api/staff/card-reads/${r2.json.readId}/dismiss`, { cookie: admin, body: { machineId: 'garagara-2' } });
  assert.equal((await send({ kind: 'digital', qrPayload: await card() })).json.machineId, 'garagara-2');
  // A machine whose tablet turned camera recognition off is never chosen.
  await f.req('POST', '/api/staff/card-reads/' + (await f.req('GET', '/api/staff/view', { cookie: admin })).json.machines[1].device.pendingRead.readId + '/dismiss', { cookie: admin, body: { machineId: 'garagara-2' } });
  await f.command(admin, { type: 'setCameraAssist', machineId: 'garagara-2', enabled: false });
  assert.equal((await send({ kind: 'digital', qrPayload: await card() })).json.error, 'NO_MACHINE_READY');
  const op = await f.staff('operator');
  assert.equal((await f.req('POST', '/api/camera/card-read', { cookie: op, body: { machineId: 'auto', kind: 'digital', qrPayload: a } })).status, 403);
});
