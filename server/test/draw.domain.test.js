import test from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, ONE_LINE, THREE_LINES, ALL } from './helpers/drawFixture.js';
import { ballLedger, initialState } from '../src/domain/draw/state.js';
import { transition } from '../src/domain/draw/transition.js';
import { toStaffView } from '../src/domain/draw/projections.js';
import { COLORS } from '../src/domain/rules.js';

const sid = (w, m = 'garagara-1') => w.state.machines[m].activeSessionId;
const kinds = (w, m = 'garagara-1') => w.state.sessions[sid(w, m)].balls.filter((b) => !b.removed).map((b) => b.kind);

test('受付でNをサーバー側マスから計算する（0ラインは拒否）', () => {
  const w = makeWorld();
  assert.throws(() => w.start('garagara-1', Array(9).fill(false)), { code: 'NO_LINES' });
  assert.equal(w.start('garagara-1', ONE_LINE).result.n, 1);
  const w2 = makeWorld();
  assert.equal(w2.start('garagara-1', THREE_LINES).result.n, 2);
  const w3 = makeWorld();
  assert.equal(w3.start('garagara-1', ALL).result.n, 3);
});

test('01/31: N=2で白・緑・赤・白、先着2個だけ有効、機内数は4減る', () => {
  const w = makeWorld();
  w.start('garagara-1');
  for (const c of ['white', 'green', 'red', 'white']) w.ball('garagara-1', c);
  assert.deepEqual(kinds(w), ['valid', 'valid', 'excess', 'excess']);
  const m = w.state.machines['garagara-1'];
  assert.deepEqual(m.contents, { red: 9, green: 9, lightblue: 10, white: 8 });
  assert.equal(w.state.prizes.white.allocated, 1);
  assert.equal(w.state.prizes.green.allocated, 1);
  assert.equal(w.state.prizes.red.allocated, 0);
  const out = w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: 'BM-0001', trayEmptied: true });
  assert.deepEqual(out.result.prizes.map((p) => p.color), ['white', 'green']);
  assert.equal(w.state.machines['garagara-1'].returnPending.red, 1);
  assert.equal(w.state.machines['garagara-1'].returnPending.white, 1);
  assert.equal(w.state.storedValid.white, 1);
  assert.equal(w.state.sessions['BM-0001'].voucher.jobs.length, 1);
});

test('02/03: 要確認玉は順番を保持し、後続玉で置換せず確定できない', () => {
  const w = makeWorld();
  w.run({ type: 'setInputMode', machineId: 'garagara-1', mode: 'auto', reason: 'C2試験' });
  w.start('garagara-1');
  const g = w.state.machines['garagara-1'].generation;
  const dev = (detectedColor, extra = {}) => w.run({ type: 'ballDetected', machineId: 'garagara-1', generation: g, detectedColor, ...extra });
  dev('white');
  dev(null);
  dev('red', { orderUncertain: true });
  assert.deepEqual(kinds(w), ['valid', 'review', 'excess']);
  assert.equal(w.state.prizes.red.allocated, 0);
  assert.throws(() => w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: sid(w), trayEmptied: true }), { code: 'REVIEW_PENDING' });
  const second = w.state.sessions[sid(w)].balls[1].ballId;
  w.run({ type: 'correctBall', machineId: 'garagara-1', sessionId: sid(w), ballId: second, color: 'green', reason: '目視で緑' });
  const third = w.state.sessions[sid(w)].balls[2].ballId;
  w.run({ type: 'correctBall', machineId: 'garagara-1', sessionId: sid(w), ballId: third, color: 'red', reason: '順番確認済み' });
  assert.deepEqual(kinds(w), ['valid', 'valid', 'excess']);
});

test('05/35: 待機中の出玉と旧世代の遅着は未割当で、次のセッションに入らない', () => {
  const w = makeWorld();
  w.run({ type: 'setInputMode', machineId: 'garagara-1', mode: 'auto', reason: 'C2試験' });
  w.run({ type: 'ballDetected', machineId: 'garagara-1', detectedColor: 'red' });
  assert.equal(w.state.unassigned.length, 1);
  w.start('garagara-1', ONE_LINE);
  const genA = w.state.machines['garagara-1'].generation;
  w.run({ type: 'ballDetected', machineId: 'garagara-1', generation: genA, detectedColor: 'white' });
  w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: genA, trayEmptied: true });
  w.start('garagara-1', ONE_LINE);
  const out = w.run({ type: 'ballDetected', machineId: 'garagara-1', generation: genA, detectedColor: 'red' });
  assert.equal(out.result.unassigned, true);
  assert.equal(w.state.sessions[sid(w)].balls.length, 0);
});

test('06: 回収確認（結果確定）前に次の受付はできない', () => {
  const w = makeWorld();
  w.start('garagara-1');
  assert.throws(() => w.start('garagara-1'), { code: 'MACHINE_BUSY' });
});

test('07/30: 補充計画だけでは機内数は増えず、実投入分だけ増える', () => {
  const w = makeWorld();
  w.run({ type: 'addRefillPlan', machineId: 'garagara-1', dueAt: '2026-11-01T09:00:00+09:00', colors: { white: 5 } });
  assert.equal(w.state.machines['garagara-1'].contents.white, 10);
  const view = toStaffView(w.state, { now: '2026-11-01T10:00:00+09:00' });
  assert.equal(view.machines[0].refill.due[0].remaining.white, 5);
  w.run({ type: 'refillPlanned', machineId: 'garagara-1', planId: 'plan-1', colors: { white: 3 } });
  assert.equal(w.state.machines['garagara-1'].contents.white, 13);
  assert.equal(w.state.spare.white, 2);
  const after = toStaffView(w.state, { now: '2026-11-01T10:00:00+09:00' });
  assert.equal(after.machines[0].refill.due[0].remaining.white, 2);
  assert.throws(() => w.run({ type: 'refillPlanned', machineId: 'garagara-1', colors: { white: 3 } }), { code: 'SPARE_SHORTAGE' });
});

test('09/10: 印刷失敗後は同じ券番号で再印刷、景品確保は1回分、引換は1回だけ', () => {
  const w = makeWorld();
  w.start('garagara-1', ONE_LINE);
  w.ball('garagara-1', 'red');
  w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: 'BM-0001', trayEmptied: true });
  assert.throws(() => w.run({ type: 'redeemPrize', voucher: 'BM-0001' }), { code: 'NOT_PRINTED' });
  w.run({ type: 'recordPrintResult', sessionId: 'BM-0001', jobId: 'pj-1', outcome: 'dispatched' });
  w.run({ type: 'recordPrintResult', sessionId: 'BM-0001', jobId: 'pj-1', outcome: 'failed' });
  const v = w.state.sessions['BM-0001'].voucher;
  assert.equal(v.jobs.length, 2);
  assert.equal(v.number, 'BM-0001');
  assert.equal(w.state.prizes.red.allocated, 1);
  w.run({ type: 'redeemPrize', voucher: 'bm-1' });
  assert.equal(w.state.prizes.red.redeemed, 1);
  assert.throws(() => w.run({ type: 'redeemPrize', voucher: 'BM-0001' }), { code: 'ALREADY_REDEEMED' });
});

test('11: 玉の手持ちが景品数より少ない色の不足数を示す', () => {
  const w = makeWorld();
  const view = toStaffView(w.state, { now: new Date().toISOString() });
  // white: 380 prizes, 10+10 in machines + 5 spare = 25 balls
  assert.equal(view.shortage.white.diff, 355);
  assert.equal(view.shortage.white.shortage, 355);
});

test('12: 景品残数0の色が機内にある状態では受付を止める', () => {
  const w = makeWorld();
  w.run({ type: 'updateSettings', settings: { ...w.state.settings, grades: w.state.settings.grades.map((g) => (g.color === 'red' ? { ...g, total: 0 } : g)) } });
  assert.throws(() => w.start('garagara-1'), { code: 'PRIZE_EXHAUSTED_COLOR_IN_MACHINE' });
});

test('13: 受付後のイベント設定変更と初期在庫変更は拒否する', () => {
  const w = makeWorld();
  w.start('garagara-1');
  assert.throws(() => w.run({ type: 'updateSettings', settings: w.state.settings }), { code: 'SETTINGS_LOCKED' });
  assert.throws(() => w.run({ type: 'setInventory', contents: {}, spare: {} }), { code: 'SETTINGS_LOCKED' });
});

test('16/37: 2台同時抽選で共有景品を正しく確保し、残り1個は一方だけが得る', () => {
  const w = makeWorld();
  w.run({ type: 'updateSettings', settings: { ...w.state.settings, grades: w.state.settings.grades.map((g) => (g.color === 'red' ? { ...g, total: 3 } : g)) } });
  w.start('garagara-1', ONE_LINE);
  w.start('garagara-2', ONE_LINE);
  w.ball('garagara-1', 'red');
  w.ball('garagara-2', 'red');
  assert.equal(w.state.prizes.red.allocated, 2);
  assert.equal(w.state.sessions['BM-0001'].balls[0].reservedColor, 'red');
  assert.equal(w.state.sessions['BM-0002'].balls[0].reservedColor, 'red');
  w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: 'BM-0001', trayEmptied: true });
  w.run({ type: 'finalizeResult', machineId: 'garagara-2', sessionId: 'BM-0002', trayEmptied: true });
  // one red prize left; contention
  w.start('garagara-1', ONE_LINE);
  w.start('garagara-2', ONE_LINE);
  w.ball('garagara-1', 'red');
  w.ball('garagara-2', 'red');
  assert.equal(w.state.prizes.red.allocated, 3);
  assert.equal(w.state.sessions['BM-0003'].balls[0].shortage, false);
  assert.equal(w.state.sessions['BM-0004'].balls[0].shortage, true);
  assert.throws(() => w.run({ type: 'finalizeResult', machineId: 'garagara-2', sessionId: 'BM-0004', trayEmptied: true }), { code: 'PRIZE_SHORTAGE' });
});

test('24: 古いrevisionでの受付は409相当のREVISION_CONFLICT', () => {
  const w = makeWorld();
  const stale = w.state.machines['garagara-1'].revision;
  w.run({ type: 'setInputMode', machineId: 'garagara-1', mode: 'manual', reason: '確認' });
  assert.throws(() => w.run({ type: 'startSession', machineId: 'garagara-1', expectedMachineRevision: stale, card: { id: 'x', kind: 'paper' }, marks: ONE_LINE }), { code: 'REVISION_CONFLICT' });
});

test('32: 直前取消で機内数と景品確保が戻り、理由が残る', () => {
  const w = makeWorld();
  w.start('garagara-1');
  w.ball('garagara-1', 'white');
  const out = w.ball('garagara-1', 'red');
  assert.equal(w.state.prizes.red.allocated, 1);
  assert.throws(() => w.run({ type: 'removeManualBall', machineId: 'garagara-1', sessionId: sid(w), ballId: out.result.ballId, reason: '' }), { code: 'VALIDATION_FAILED' });
  w.run({ type: 'removeManualBall', machineId: 'garagara-1', sessionId: sid(w), ballId: out.result.ballId, reason: '押し間違い' });
  assert.equal(w.state.prizes.red.allocated, 0);
  assert.equal(w.state.machines['garagara-1'].contents.red, 10);
  const removed = w.state.sessions[sid(w)].balls.find((b) => b.removed);
  assert.equal(removed.removedReason, '押し間違い');
});

test('色修正で機内数と景品確保を付け替える', () => {
  const w = makeWorld();
  w.start('garagara-1', ONE_LINE);
  const out = w.ball('garagara-1', 'white');
  w.run({ type: 'correctBall', machineId: 'garagara-1', sessionId: sid(w), ballId: out.result.ballId, color: 'lightblue', reason: '見間違い' });
  const m = w.state.machines['garagara-1'];
  assert.equal(m.contents.white, 10);
  assert.equal(m.contents.lightblue, 9);
  assert.equal(w.state.prizes.white.allocated, 0);
  assert.equal(w.state.prizes.lightblue.allocated, 1);
});

test('帳簿上0個の色は手入力できず、負数にならない', () => {
  const w = makeWorld({ contents: { 'garagara-1': { white: 1 }, 'garagara-2': {} } });
  w.start('garagara-1');
  w.ball('garagara-1', 'white');
  assert.throws(() => w.ball('garagara-1', 'white'), { code: 'NO_BALL_OF_COLOR' });
  assert.equal(w.state.machines['garagara-1'].contents.white, 0);
});

test('08: 戻しは戻し待ち数以内、超過玉は機内へ戻る', () => {
  const w = makeWorld();
  w.start('garagara-1', ONE_LINE);
  w.ball('garagara-1', 'white');
  w.ball('garagara-1', 'red');
  w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: 'BM-0001', trayEmptied: true });
  assert.throws(() => w.run({ type: 'returnBalls', machineId: 'garagara-1', colors: { red: 2 } }), { code: 'EXCEEDS_RETURN_PENDING' });
  w.run({ type: 'returnBalls', machineId: 'garagara-1', colors: { red: 1 } });
  assert.equal(w.state.machines['garagara-1'].contents.red, 10);
  assert.equal(w.state.machines['garagara-1'].returnPending.red, 0);
});

test('緊急停止は受付と確定を止め、解除だけでは再開しない', () => {
  const w = makeWorld();
  w.start('garagara-1', ONE_LINE);
  w.ball('garagara-1', 'white');
  w.run({ type: 'emergencyStop', machineId: 'garagara-1', reason: '玉詰まり' });
  assert.throws(() => w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: sid(w), trayEmptied: true }), { code: 'EMERGENCY_STOPPED' });
  assert.throws(() => w.run({ type: 'clearEmergency', machineId: 'garagara-1' }), { code: 'VALIDATION_FAILED' });
  w.run({ type: 'clearEmergency', machineId: 'garagara-1', reason: '詰まり解消' });
  assert.throws(() => w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: sid(w), trayEmptied: true }), { code: 'EMERGENCY_STOPPED' });
  w.run({ type: 'resumeDrawing', machineId: 'garagara-1' });
  w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: sid(w), trayEmptied: true });
});

test('手入力モードでは自動読取を在庫に反映せず、自動モードでは手入力を拒否する（C02）', () => {
  const w = makeWorld();
  w.start('garagara-1', ONE_LINE);
  const out = w.run({ type: 'ballDetected', machineId: 'garagara-1', generation: sid(w), detectedColor: 'red' });
  assert.equal(out.result.unassigned, true);
  assert.equal(w.state.machines['garagara-1'].contents.red, 10);
  assert.equal(w.state.sessions[sid(w)].balls.length, 0);
  assert.throws(() => w.run({ type: 'setInputMode', machineId: 'garagara-1', mode: 'auto', reason: '切替' }), { code: 'MACHINE_BUSY' });
});

test('23: 検出から60秒以上経って届いた出玉は要確認', () => {
  const w = makeWorld();
  w.run({ type: 'setInputMode', machineId: 'garagara-1', mode: 'auto', reason: 'C2' });
  w.start('garagara-1', ONE_LINE);
  const n = new Date('2026-11-01T12:00:00+09:00');
  const out = w.run({ type: 'ballDetected', machineId: 'garagara-1', generation: sid(w), detectedColor: 'red', detectedAt: new Date(n.getTime() - 61000).toISOString() }, { now: n.toISOString() });
  assert.equal(out.result.needsReview, true);
});

test('自動モードでは心拍がない台の受付を拒否する（18、DECISION-C01の暫定方針）', () => {
  const w = makeWorld();
  w.run({ type: 'setInputMode', machineId: 'garagara-1', mode: 'auto', reason: 'C2' });
  assert.throws(() => w.run({ type: 'startSession', machineId: 'garagara-1', expectedMachineRevision: w.state.machines['garagara-1'].revision, card: { id: 'x', kind: 'paper' }, marks: ONE_LINE }, { deviceOnline: {} }), { code: 'DEVICE_OFFLINE' });
  // manual mode does not require heartbeat under auto_only
  w.run({ type: 'startSession', machineId: 'garagara-2', expectedMachineRevision: w.state.machines['garagara-2'].revision, card: { id: 'y', kind: 'paper' }, marks: ONE_LINE }, { deviceOnline: {} });
});

test('玉の保存則：どの操作の後も色別の総数が変わらない', () => {
  const w = makeWorld();
  const total = () => COLORS.map((c) => ballLedger(w.state, c).total);
  const before = total();
  w.start('garagara-1', THREE_LINES);
  w.ball('garagara-1', 'white');
  w.ball('garagara-1', 'green');
  w.ball('garagara-1', 'red');
  assert.deepEqual(total(), before);
  w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: 'BM-0001', trayEmptied: true });
  assert.deepEqual(total(), before);
  w.run({ type: 'returnBalls', machineId: 'garagara-1', colors: { red: 1 } });
  w.run({ type: 'refillPlanned', machineId: 'garagara-2', colors: { white: 2 } });
  assert.deepEqual(total(), before);
});

test('複数の発券端末：先に引き受けた端末だけが印刷でき、再印刷で中断ジョブは閉じる', () => {
  const w = makeWorld();
  w.start('garagara-1', ONE_LINE);
  w.ball('garagara-1', 'white');
  w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: 'BM-0001', trayEmptied: true });
  w.run({ type: 'recordPrintResult', sessionId: 'BM-0001', jobId: 'pj-1', outcome: 'claimed', station: 'WindowsPC' });
  assert.throws(() => w.run({ type: 'recordPrintResult', sessionId: 'BM-0001', jobId: 'pj-1', outcome: 'claimed', station: 'iPad' }), { code: 'JOB_ALREADY_CLAIMED' });
  assert.equal(toStaffView(w.state).printQueue[0].status, 'printing');
  w.run({ type: 'requestReprint', sessionId: 'BM-0001', reason: '端末を閉じてしまった' });
  const jobs = w.state.sessions['BM-0001'].voucher.jobs;
  assert.deepEqual(jobs.map((j) => j.status), ['failed', 'queued']);
  w.run({ type: 'recordPrintResult', sessionId: 'BM-0001', jobId: 'pj-2', outcome: 'claimed', station: 'iPad' });
  w.run({ type: 'recordPrintResult', sessionId: 'BM-0001', jobId: 'pj-2', outcome: 'dispatched' });
  w.run({ type: 'redeemPrize', voucher: 'BM-0001' });
  assert.equal(w.state.prizes.white.allocated, 1);
});

test('transitionは入力stateを変更しない', () => {
  const s = initialState();
  const copy = structuredClone(s);
  assert.throws(() => transition(s, { type: 'nope' }, { now: new Date().toISOString() }));
  transition(s, { type: 'setInventory', contents: {}, spare: {} }, { now: new Date().toISOString() });
  assert.deepEqual(s, copy);
});

test('景品切れで新規受付を終了すると両台の受付を拒否し、進行中の抽選と引換は続けられる', () => {
  const w = makeWorld();
  w.start('garagara-1', ONE_LINE);
  w.run({ type: 'setIntakeClosed', closed: true });
  assert.equal(w.state.intakeClosed.reason, '景品がなくなったため');
  assert.throws(() => w.start('garagara-2', ONE_LINE), { code: 'INTAKE_CLOSED' });
  w.ball('garagara-1', 'white');
  w.run({ type: 'finalizeResult', machineId: 'garagara-1', sessionId: 'BM-0001', trayEmptied: true });
  w.run({ type: 'recordPrintResult', sessionId: 'BM-0001', jobId: 'pj-1', outcome: 'dispatched' });
  w.run({ type: 'redeemPrize', voucher: 'BM-0001' });
  w.run({ type: 'setIntakeClosed', closed: false });
  w.start('garagara-2', ONE_LINE);
});
