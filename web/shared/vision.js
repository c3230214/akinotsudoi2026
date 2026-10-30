// Image analysis for the camera station. No DOM: works on ImageData-like
// objects ({ data, width, height }) so it can be tested with node:test.
//
// Paper card: the operator marks the card's four corners once (fixed camera
// and card position), and registers one empty card as the reference. Each
// cell is then compared with the reference; a sticker changes the cell's
// appearance. Accuracy depends on lighting and stickers and must be checked
// on site; unsure cells are reported as null for the operator to decide.

// Cell edges on the paper card, as fractions of card width / height
// (measured on the organisers' PDF: x 95/431/751/1088 of 1200, y 593/913/1233/1554 of 1700).
export const CARD_GRID = Object.freeze({
  xs: [95 / 1200, 431 / 1200, 751 / 1200, 1088 / 1200],
  ys: [593 / 1700, 913 / 1700, 1233 / 1700, 1554 / 1700],
});
// The 抽選確認 corner is the triangle above the line (0.741, 0) – (1, 0.178).
const CUT = { u0: 889 / 1200, v1: 302 / 1700 };

/**
 * Projective map from the unit square to a quadrilateral (Heckbert).
 * Corners: TL, TR, BR, BL in image pixels. Returns (u, v) => [x, y].
 */
export function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let a; let b; let c; let d; let e; let f; let g; let h;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0; d = y1 - y0; e = y3 - y0; f = y0; g = 0; h = 0;
  } else {
    const dx1 = x1 - x2; const dx2 = x3 - x2; const dy1 = y1 - y2; const dy2 = y3 - y2;
    const den = dx1 * dy2 - dx2 * dy1;
    g = (sx * dy2 - dx2 * sy) / den;
    h = (dx1 * sy - sx * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

function pixel(img, x, y) {
  const xi = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const i = (yi * img.width + xi) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** Mean RGB of a small card-space patch, sampled 3x3. */
function patchMean(img, map, u0, v0, u1, v1) {
  let r = 0; let g = 0; let b = 0;
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) {
      const [x, y] = map(u0 + ((i + 0.5) / 3) * (u1 - u0), v0 + ((j + 0.5) / 3) * (v1 - v0));
      const p = pixel(img, x, y);
      r += p[0]; g += p[1]; b += p[2];
    }
  }
  return [r / 9, g / 9, b / 9];
}

const BLOCKS = 6;
const INSET = 0.12;

/**
 * Features of a card image: per cell a 6x6 grid of mean colours (108
 * numbers), plus samples from the 抽選確認 corner triangle.
 */
export function cardFeatures(img, corners) {
  const map = squareToQuad(corners);
  const cells = [];
  for (let r = 0; r < 3; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const u0 = CARD_GRID.xs[c]; const u1 = CARD_GRID.xs[c + 1];
      const v0 = CARD_GRID.ys[r]; const v1 = CARD_GRID.ys[r + 1];
      const iu0 = u0 + (u1 - u0) * INSET; const iu1 = u1 - (u1 - u0) * INSET;
      const iv0 = v0 + (v1 - v0) * INSET; const iv1 = v1 - (v1 - v0) * INSET;
      const f = [];
      for (let by = 0; by < BLOCKS; by += 1) {
        for (let bx = 0; bx < BLOCKS; bx += 1) {
          const pu0 = iu0 + ((iu1 - iu0) * bx) / BLOCKS; const pu1 = iu0 + ((iu1 - iu0) * (bx + 1)) / BLOCKS;
          const pv0 = iv0 + ((iv1 - iv0) * by) / BLOCKS; const pv1 = iv0 + ((iv1 - iv0) * (by + 1)) / BLOCKS;
          f.push(...patchMean(img, map, pu0, pv0, pu1, pv1));
        }
      }
      cells.push(f);
    }
  }
  const corner = [];
  for (let i = 0; i < 6; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      const u = CUT.u0 + 0.06 + ((1 - CUT.u0 - 0.08) * (i + 0.5)) / 6;
      const v = 0.01 + (0.07 * (j + 0.5)) / 4;
      if (v < (CUT.v1 * (u - CUT.u0)) / (1 - CUT.u0) - 0.01) corner.push(...patchMean(img, map, u - 0.01, v - 0.005, u + 0.01, v + 0.005));
    }
  }
  return { cells, corner };
}

const mean = (a) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);

/** Mean absolute difference in percent of full scale, after matching overall brightness. */
export function diffScore(cur, ref, gain = 1) {
  let s = 0;
  for (let i = 0; i < cur.length; i += 1) s += Math.abs(cur[i] * gain - ref[i]);
  return (s / Math.max(1, cur.length) / 255) * 100;
}

/**
 * Compare a card with the empty reference. Returns cells (true / false /
 * null when the score is near the threshold), the corner state and the raw
 * scores so the operator can tune thresholds on site.
 */
export function judgeCard(cur, ref, { threshold = 7, band = 0.25, cornerThreshold = 22 } = {}) {
  // Brightness gain so room lighting changes matter less: the median of the
  // per-cell ratios, so the cells that carry stickers do not skew it.
  const ratios = cur.cells.map((f, i) => mean(ref.cells[i]) / Math.max(1, mean(f))).sort((a, b) => a - b);
  const gain = ratios[Math.floor(ratios.length / 2)];
  const scores = cur.cells.map((f, i) => diffScore(f, ref.cells[i], gain));
  const cells = scores.map((sc) => {
    if (sc >= threshold * (1 + band)) return true;
    if (sc <= threshold * (1 - band)) return false;
    return null;
  });
  let cornerPresent = null;
  let cornerScore = null;
  if (cur.corner.length && ref.corner.length === cur.corner.length) {
    cornerScore = diffScore(cur.corner, ref.corner, gain);
    if (cornerScore >= cornerThreshold * 1.2) cornerPresent = false;
    else if (cornerScore <= cornerThreshold * 0.8) cornerPresent = true;
  }
  return { cells, scores, cornerPresent, cornerScore, gain };
}

/**
 * How different the card area is from a registered "nothing on the table"
 * frame (mean over the nine cells, no brightness matching). Used to notice
 * that a card was put down or taken away.
 */
export function presenceScore(cur, table) {
  return mean(cur.cells.map((f, i) => diffScore(f, table.cells[i])));
}

// ---------- balls ----------
export const DEFAULT_BALL_COLORS = Object.freeze({
  red: [196, 48, 48], green: [52, 140, 70], lightblue: [110, 170, 222], white: [232, 232, 232],
});

/** Mean colours of a grid of blocks inside a normalised rectangle of the frame. */
export function roiBlocks(img, roi, n = 6) {
  const out = [];
  for (let by = 0; by < n; by += 1) {
    for (let bx = 0; bx < n; bx += 1) {
      const x0 = (roi.x + (roi.w * bx) / n) * img.width;
      const y0 = (roi.y + (roi.h * by) / n) * img.height;
      const x1 = (roi.x + (roi.w * (bx + 1)) / n) * img.width;
      const y1 = (roi.y + (roi.h * (by + 1)) / n) * img.height;
      let r = 0; let g = 0; let b = 0;
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          const p = pixel(img, x0 + ((i + 0.5) / 3) * (x1 - x0), y0 + ((j + 0.5) / 3) * (y1 - y0));
          r += p[0]; g += p[1]; b += p[2];
        }
      }
      out.push([r / 9, g / 9, b / 9]);
    }
  }
  return out;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Ball in the ROI? Blocks that differ from the empty background are taken as
 * ball pixels; their mean colour is matched to the registered colours.
 */
export function judgeBall(blocks, background, palette = DEFAULT_BALL_COLORS, { presence = 40, minBlocks = 4, minConfidence = 0.25 } = {}) {
  const changed = blocks.filter((b, i) => dist(b, background[i]) > presence);
  if (changed.length < minBlocks) return { present: false, changedBlocks: changed.length };
  const m = [0, 1, 2].map((k) => mean(changed.map((b) => b[k])));
  const ranked = Object.entries(palette).map(([color, ref]) => ({ color, d: dist(m, ref) })).sort((a, b) => a.d - b.d);
  const confidence = ranked.length > 1 ? Math.max(0, Math.min(1, 1 - ranked[0].d / Math.max(1, ranked[1].d))) : 0;
  return {
    present: true, changedBlocks: changed.length, mean: m.map(Math.round),
    color: confidence >= minConfidence ? ranked[0].color : null, best: ranked[0].color, confidence: Math.round(confidence * 100) / 100,
  };
}
