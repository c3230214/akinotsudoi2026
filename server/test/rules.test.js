import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS, LINES, completeLines, entitledDraws, validateMarks } from '../src/domain/rules.js';

const blank = () => Array(9).fill(false);

test('抽選色は仕様書の4色である', () => {
  assert.deepEqual(COLORS, ['red', 'green', 'lightblue', 'white']);
});

test('ライン定義は縦横斜めの合計8本', () => {
  assert.equal(LINES.length, 8);
  assert.ok(LINES.every((line) => line.length === 3));
});

test('完成ラインが0本なら抽選回数は0', () => {
  assert.equal(completeLines(blank()), 0);
  assert.equal(entitledDraws(0), 0);
});

test('横1本と斜め1本を数える', () => {
  const marks = blank();
  for (const index of [0, 1, 2, 4, 8]) marks[index] = true;
  assert.equal(completeLines(marks), 2);
  assert.equal(entitledDraws(2), 1);
});

test('3〜7ラインは2回、8ラインは3回', () => {
  for (let lines = 3; lines <= 7; lines += 1) assert.equal(entitledDraws(lines), 2);
  assert.equal(entitledDraws(8), 3);
});

test('nullは読取確認中のマスとして扱われ、ライン完成に数えられない', () => {
  const marks = [true, true, null, false, false, false, false, false, false];
  assert.equal(completeLines(marks), 0);
  assert.doesNotThrow(() => validateMarks(marks, { allowNull: true }));
  assert.throws(() => validateMarks(marks), /marks\[2\]/);
});

test('確定マス配列は長さ9のbooleanのみを許す', () => {
  assert.throws(() => validateMarks([true, false]), /exactly 9/);
  assert.throws(() => validateMarks([true, false, true, false, true, false, true, false, 'yes']), /marks\[8\]/);
});

test('不正なライン数を拒否する', () => {
  for (const value of [-1, 9, 1.5, NaN]) assert.throws(() => entitledDraws(value));
});
