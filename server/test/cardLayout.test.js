import test from 'node:test';
import assert from 'node:assert/strict';
import { CELL_COUNT, CELLS } from '../src/domain/card/cardLayout.js';

test('紙カードと同じ3x3、番号1〜9の順で9マスを定義する', () => {
  assert.equal(CELL_COUNT, 9);
  assert.deepEqual(CELLS.map((cell) => cell.number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(CELLS.map((cell) => cell.index), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test('紙仕様に記載されたマスの文言と分類を保持する', () => {
  assert.equal(CELLS[0].category, 'committee');
  assert.equal(CELLS[1].category, 'panel_feedback');
  assert.equal(CELLS[2].category, 'workshop');
  assert.equal(CELLS[4].category, 'participation');
  assert.equal(CELLS[7].category, 'stage_feedback');
  assert.equal(CELLS[8].label, '体験工房で体験しよう');
});

test('繰り返し文言の具体的なマス割当ロジックはここで決めない', () => {
  assert.equal(CELLS.filter((cell) => cell.category === 'committee').length, 3);
  assert.equal(CELLS.filter((cell) => cell.category === 'workshop').length, 3);
});
