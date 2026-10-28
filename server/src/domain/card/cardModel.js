import { CELLS } from './cardLayout.js';
import { completeLines, entitledDraws } from '../rules.js';
import { invalid } from '../errors.js';

// TODO(DECISION-C21): the prefix is fixed to this event; a later event needs its own.
export const QR_PREFIX = 'MARUGOTO2026';
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
/** Cells achieved by tapping, with no stamp QR (2026-10-28: ⑤ ビンゴに参加しよう). */
export const TAP_CELLS = Object.freeze([4]);
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const CARD_ID_RE = /^D[0-9A-HJKMNP-TV-Z]{8}$/;

export function isCardId(text) {
  return typeof text === 'string' && CARD_ID_RE.test(text);
}

/** Stamp QR payload. Accepts the raw form or a URL whose `s` parameter holds it. */
export function parseStampPayload(text) {
  if (typeof text !== 'string') invalid('QRコードを読み取れませんでした');
  let value = text.trim();
  try {
    const url = new URL(value);
    value = url.searchParams.get('s') || value;
  } catch { /* not a URL */ }
  const m = value.match(/^MARUGOTO2026:STAMP:([A-Za-z0-9_-]{16,64})$/);
  if (!m) invalid('ビンゴのスタンプ用QRコードではありません');
  return { token: m[1] };
}

export function parseCardPayload(text) {
  if (typeof text !== 'string') invalid('カードのQRコードを読み取れませんでした');
  const m = text.trim().match(/^MARUGOTO2026:CARD:(D[0-9A-HJKMNP-TV-Z]{8}):([A-Za-z0-9_-]{16,64})$/);
  if (!m) invalid('デジタルビンゴカードのQRコードではありません');
  return { cardId: m[1], claim: m[2] };
}

export function cardPayload(cardId, claim) {
  return `${QR_PREFIX}:CARD:${cardId}:${claim}`;
}

export function stampPayload(token) {
  if (!TOKEN_RE.test(token)) throw new TypeError('invalid stamp token');
  return `${QR_PREFIX}:STAMP:${token}`;
}

/**
 * Server-side marks from recorded stamps. Visitors cannot toggle cells (§2.1).
 * @param {Array<{cellIndex:number}>} stamps
 */
export function marksFromStamps(stamps, { centerMarked = false } = {}) {
  const marks = Array(CELLS.length).fill(false);
  for (const s of stamps) {
    if (Number.isInteger(s.cellIndex) && s.cellIndex >= 0 && s.cellIndex < marks.length) marks[s.cellIndex] = true;
  }
  if (centerMarked) marks[4] = true;
  return marks;
}

/**
 * Cell for a stamp point. A point bound to a cell always fills that cell; a
 * category point fills the lowest-numbered empty cell of its category.
 * TODO(DECISION-C19): the category rule is the spec's provisional proposal.
 */
export function cellForPoint(point, marks, chosenCell = null) {
  if (chosenCell !== null) {
    // The visitor tapped a cell and then scanned: the QR must belong to it.
    const target = CELLS[chosenCell];
    const fits = Number.isInteger(point.cellIndex) ? point.cellIndex === chosenCell : point.category === target.category;
    if (!fits) {
      const right = Number.isInteger(point.cellIndex) ? `${CIRCLED[point.cellIndex]}のマス` : 'ほかのマス';
      invalid(`このQRコードは${right}用です。${CIRCLED[chosenCell]}のマスには使えません`);
    }
    return marks[chosenCell] ? null : chosenCell;
  }
  if (Number.isInteger(point.cellIndex)) return marks[point.cellIndex] ? null : point.cellIndex;
  const cell = CELLS.find((c) => c.category === point.category && !marks[c.index]);
  return cell ? cell.index : null;
}

export function toCardView(card, stamps, { centerMarked = false } = {}) {
  const marks = marksFromStamps(stamps, { centerMarked });
  const lines = completeLines(marks);
  return {
    cardId: card.id,
    createdAt: card.createdAt,
    used: Boolean(card.usedAt),
    usedAt: card.usedAt ?? null,
    marks,
    lines,
    draws: entitledDraws(lines),
    cells: CELLS.map((c) => ({ ...c, marked: marks[c.index], stampedAt: stamps.find((s) => s.cellIndex === c.index)?.stampedAt ?? null })),
  };
}
