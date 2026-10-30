import test from 'node:test';
import assert from 'node:assert/strict';
import { apportion, planBallMix } from '../src/domain/draw/ballPlan.js';
import { initialState } from '../src/domain/draw/state.js';
import { transition } from '../src/domain/draw/transition.js';

const ctx = { now: '2026-11-01T10:00:00.000+09:00', actor: { name: 'test' } };
const run = (s, action) => transition(s, action, ctx).state;
const sum = (o) => Object.values(o).reduce((a, n) => a + n, 0);

function stocked() {
  // Prize table: 1等20 / 2等60 / 3等140 / 4等380 = 600.
  return run(initialState(), { type: 'setInventory', contents: { 'garagara-1': { white: 10 }, 'garagara-2': { white: 10 } }, spare: { red: 30, green: 70, lightblue: 150, white: 380 } });
}

test('apportion：重みに比例して配り、上限を超えた分はほかへ回す', () => {
  assert.deepEqual(apportion(10, { a: 1, b: 1 }, { a: 10, b: 10 }), { a: 5, b: 5 });
  assert.deepEqual(apportion(10, { a: 9, b: 1 }, { a: 3, b: 10 }), { a: 3, b: 7 });
  assert.deepEqual(apportion(10, { a: 1, b: 1 }, { a: 2, b: 3 }), { a: 2, b: 3 });
  assert.equal(sum(apportion(7, { a: 1, b: 1, c: 1 }, { a: 9, b: 9, c: 9 })), 7);
});

test('配分計画：景品の残りの割合で各台に入れる玉を決め、確率は景品の割合と一致する', () => {
  const plan = planBallMix(stocked(), { 'garagara-1': 60, 'garagara-2': 60 });
  const [m1, m2] = plan.machines;
  assert.equal(sum(m1.target), 60);
  assert.equal(sum(m2.target), 60);
  // 120 balls x (20, 60, 140, 380) / 600 = 4, 12, 28, 76
  assert.deepEqual({ red: m1.target.red + m2.target.red, green: m1.target.green + m2.target.green, lightblue: m1.target.lightblue + m2.target.lightblue, white: m1.target.white + m2.target.white }, { red: 4, green: 12, lightblue: 28, white: 76 });
  assert.equal(m1.targetOdds.red + m2.targetOdds.red, 6.6);
  assert.equal(m1.moves.white, m1.target.white - 10);
});

test('配分計画：景品の残りを超える玉は入れず、景品のない色は機内から出す', () => {
  let s = stocked();
  s = run(s, { type: 'adjustPrizeTotal', color: 'red', total: 1, reason: '試験' });
  s = run(s, { type: 'rebalanceBalls', moves: { 'garagara-1': { red: 3 } } });
  const plan = planBallMix(s, { 'garagara-1': 100, 'garagara-2': 100 });
  assert.equal(plan.machines[0].target.red + plan.machines[1].target.red, 1);
  assert.equal(plan.machines[0].moves.red <= -2, true);
});

test('入れ替えの記録：予備と機内の間で動かし、合計は変わらない。抽選中の台と予備不足は拒否', () => {
  const s = stocked();
  const plan = planBallMix(s, { 'garagara-1': 60, 'garagara-2': 60 });
  const moves = Object.fromEntries(plan.machines.map((m) => [m.id, m.moves]));
  const after = run(s, { type: 'rebalanceBalls', moves });
  assert.deepEqual(after.machines['garagara-1'].contents, plan.machines[0].target);
  assert.deepEqual(after.spare, plan.spareAfter);
  const total = (x) => sum(x.spare) + sum(x.machines['garagara-1'].contents) + sum(x.machines['garagara-2'].contents);
  assert.equal(total(after), total(s));
  assert.throws(() => run(s, { type: 'rebalanceBalls', moves: { 'garagara-1': { red: 31 } } }), /予備玉が足りません/);
  const drawing = run(after, { type: 'startSession', machineId: 'garagara-1', expectedMachineRevision: after.machines['garagara-1'].revision, card: { id: 'P-1', kind: 'paper' }, declaredDraws: 1, intake: null });
  assert.throws(() => run(drawing, { type: 'rebalanceBalls', moves: { 'garagara-1': { red: 1 } } }), /抽選中/);
});

test('景品数の変更：当選済みの数より減らせず、理由が必要', () => {
  const s = stocked();
  assert.throws(() => run(s, { type: 'adjustPrizeTotal', color: 'green', total: 70 }), /理由/);
  const t = run(s, { type: 'adjustPrizeTotal', color: 'green', total: 70, reason: '追加購入' });
  assert.equal(t.settings.grades.find((g) => g.color === 'green').total, 70);
});
