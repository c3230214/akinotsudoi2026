import test from 'node:test';
import assert from 'node:assert/strict';
import { CARD_GRID, cardFeatures, judgeBall, judgeCard, roiBlocks, squareToQuad } from '../../web/shared/vision.js';

function image(w, h, paint) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const [r, g, b] = paint(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

// A card drawn as a slightly skewed quad on a dark mat, with a printed
// pattern; stickers are orange discs; a cut corner shows the mat.
const corners = [[60, 40], [420, 52], [430, 560], [50, 548]];
function cardImage({ stickers = [], cut = false, light = 1 } = {}) {
  // Precompute map from card space to image space, then paint by inverse search on a grid.
  const W = 480; const H = 600;
  const map = squareToQuad(corners);
  const buf = Array.from({ length: H }, () => Array(W).fill(null));
  const N = 700;
  for (let i = 0; i <= N; i += 1) {
    for (let j = 0; j <= N; j += 1) {
      const u = i / N; const v = j / N;
      const [x, y] = map(u, v);
      const xi = Math.round(x); const yi = Math.round(y);
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) buf[yi][xi] = [u, v];
    }
  }
  return image(W, H, (x, y) => {
    const uv = buf[y][x];
    if (!uv) return [30, 30, 35];
    const [u, v] = uv;
    if (cut && v < (0.178 * (u - 0.741)) / 0.259) return [30, 30, 35];
    let col = Math.floor(((u * 13) | 0) + ((v * 17) | 0)) % 2 ? [240, 180, 160] : [180, 220, 245];
    for (const k of stickers) {
      const c = k % 3; const r = Math.floor(k / 3);
      const cu = (CARD_GRID.xs[c] + CARD_GRID.xs[c + 1]) / 2; const cv = (CARD_GRID.ys[r] + CARD_GRID.ys[r + 1]) / 2;
      if (Math.hypot((u - cu) * 1.0, (v - cv) * 1.41) < 0.09) col = [235, 90, 40];
    }
    return col.map((x2) => Math.min(255, x2 * light));
  });
}

test('squareToQuad は単位正方形の角を指定した四隅に写す', () => {
  const map = squareToQuad(corners);
  const close = (a, b) => assert.ok(Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6, `${a} vs ${b}`);
  close(map(0, 0), corners[0]);
  close(map(1, 0), corners[1]);
  close(map(1, 1), corners[2]);
  close(map(0, 1), corners[3]);
});

test('紙カード：空カードとの差分でシールのあるマスと切り取られた角を判定する（明るさの違いも補正）', () => {
  const ref = cardFeatures(cardImage(), corners);
  const cur = cardFeatures(cardImage({ stickers: [0, 4, 8], cut: true, light: 0.9 }), corners);
  const out = judgeCard(cur, ref);
  assert.deepEqual(out.cells, [true, false, false, false, true, false, false, false, true], JSON.stringify(out.scores.map((s) => s.toFixed(1))));
  assert.equal(out.cornerPresent, false);
  const same = judgeCard(cardFeatures(cardImage(), corners), ref);
  assert.ok(same.cells.every((c) => c === false));
  assert.equal(same.cornerPresent, true);
});

test('玉：背景との差分で玉の有無を判定し、登録色に近い色を返す。曖昧ならnull', () => {
  const roi = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
  const bg = roiBlocks(image(200, 200, () => [90, 90, 95]), roi);
  const red = roiBlocks(image(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 30 ? [200, 50, 45] : [90, 90, 95])), roi);
  const r = judgeBall(red, bg);
  assert.equal(r.present, true);
  assert.equal(r.color, 'red');
  assert.equal(judgeBall(bg, bg).present, false);
  const between = roiBlocks(image(200, 200, (x, y) => (Math.hypot(x - 100, y - 100) < 30 ? [153, 159, 146] : [90, 90, 95])), roi);
  assert.equal(judgeBall(between, bg).color, null);
});
