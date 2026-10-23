// Digital bingo card modelled on the paper card (requirements §2.1).
// Decorations are simple original SVG shapes: the paper card's illustrations
// are not reused because their distribution terms are unconfirmed.
import { html, raw } from '../shared/html.js';

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

// Cell text with furigana as on the paper card. Static, trusted markup.
const R = (kanji, kana) => `<ruby>${kanji}<rt>${kana}</rt></ruby>`;
const TEXT = {
  committee: `${R('実行委員会企画', 'じっこういいんかいきかく')}を<br>${R('体験', 'たいけん')}しよう`,
  panel_feedback: `パネルをみて<br>${R('感想', 'かんそう')}を${R('書', 'か')}こう`,
  workshop: `${R('体験工房', 'たいけんこうぼう')}で<br>${R('体験', 'たいけん')}しよう`,
  participation: `ビンゴに<br>${R('参加', 'さんか')}しよう`,
  stage_feedback: `${R('発表', 'はっぴょう')}をみて<br>${R('感想', 'かんそう')}を${R('書', 'か')}こう`,
};

const svg = (body, vb = '0 0 100 60') => `<svg class="cell-art" viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;
const leaf = (x, y, r, c, rot = 0) => `<path transform="translate(${x} ${y}) rotate(${rot}) scale(${r})" fill="${c}" d="M0-10 L2.5-4 L8-6 L5.5 0 L10 3 L4 4 L5 10 L0 6 L-5 10 L-4 4 L-10 3 L-5.5 0 L-8-6 L-2.5-4Z"/>`;
const flower = (x, y, r, c) => `<g transform="translate(${x} ${y})">${[0, 72, 144, 216, 288].map((a) => `<ellipse rx="${r * 0.45}" ry="${r}" fill="${c}" transform="rotate(${a}) translate(0 ${-r * 0.8})"/>`).join('')}<circle r="${r * 0.45}" fill="#f6c443"/></g>`;

// One small motif per cell, echoing the paper card's themes.
const ART = [
  svg(`${flower(18, 40, 7, '#f7c6c0')}${flower(84, 46, 6, '#fbe0dc')}<rect x="8" y="6" width="84" height="48" fill="none" stroke="#c97b6b" stroke-width="1.2"/>`),
  svg(`<rect x="22" y="34" width="56" height="12" rx="6" fill="#d8834a"/><rect x="34" y="22" width="22" height="14" fill="#fff" stroke="#999"/><path d="M60 18 l14 14" stroke="#555" stroke-width="3" stroke-linecap="round"/>`),
  svg(`<circle cx="30" cy="34" r="9" fill="none" stroke="#3a7bd5" stroke-width="4"/><circle cx="30" cy="34" r="3" fill="#3a7bd5"/><rect x="48" y="22" width="22" height="20" fill="#f7a8c8" transform="rotate(-12 59 32)"/><path d="M76 26 l14 16 M90 26 l-14 16" stroke="#2e7d32" stroke-width="3"/>`),
  svg(`${flower(40, 28, 7, '#f6a5c0')}${flower(58, 24, 7, '#ffffff')}${flower(50, 38, 7, '#b39ddb')}<path d="M44 44 L50 58 L56 44Z" fill="#7cc1e8"/><path d="M42 50 q8 6 16 0" stroke="#d32f2f" stroke-width="3" fill="none"/>`),
  svg(`${[0, 40, 80, 120, 160, 200, 240, 280, 320].map((a, i) => leaf(50 + 38 * Math.cos((a * Math.PI) / 180), 30 + 24 * Math.sin((a * Math.PI) / 180), 0.9, ['#e8643c', '#f39a2b', '#c0582c', '#e7b23c'][i % 4], a)).join('')}`, '0 0 100 60'),
  svg(`<ellipse cx="50" cy="36" rx="14" ry="17" fill="#a0613a"/><path d="M34 30 q16 -16 32 0 z" fill="#6d3f22"/><path d="M50 13 v6" stroke="#6d3f22" stroke-width="3"/>`),
  svg(`<path d="M6 6 Q20 22 10 56 L6 56Z" fill="#e9b3a5"/><path d="M94 6 Q80 22 90 56 L94 56Z" fill="#e9b3a5"/><path d="M6 6 H94" stroke="#c97b6b" stroke-width="3"/><path d="M10 6 q10 10 20 0 q10 10 20 0 q10 10 20 0 q10 10 20 0" stroke="#c97b6b" fill="none"/>`),
  svg(`<path d="M2 6 Q50 24 98 6" stroke="#6b8e23" stroke-width="1.5" fill="none"/>${[10, 26, 42, 58, 74, 90].map((x, i) => `<path d="M${x - 6} ${8 + (x < 50 ? x / 6 : (100 - x) / 6) - 2} l6 14 l6 -14z" fill="${['#9ccc65', '#fff176', '#81c784', '#fff59d', '#aed581', '#fff176'][i]}"/>`).join('')}`),
  svg(`<circle cx="44" cy="20" r="10" fill="#fff" stroke="#333" stroke-width="2"/><path d="M44 30 v14 M44 36 l10 6" stroke="#333" stroke-width="2"/><rect x="50" y="40" width="26" height="14" fill="#fff" stroke="#333" transform="rotate(-10 63 47)"/>`),
];

const STAMP_MARK = `<svg class="stamp-mark" viewBox="-12 -12 24 24" aria-hidden="true" focusable="false">${leaf(0, 0, 1.05, '#d64a20', -12)}</svg>`;

export { CIRCLED };

export function renderCardFace(card) {
  // Each cell is a button: tapping it offers a QR scan for that cell. A tap
  // never marks the cell by itself (§2.1).
  const cells = card.cells.map((c) => html`
    <li class="cell-slot">
      <button type="button" class="cell cell-${c.backgroundFamily}${c.marked ? ' is-marked' : ''}" data-cell="${c.index}"
        aria-label="${CIRCLED[c.index]} ${c.label}：${c.marked ? '達成' : 'まだ。タップしてQRコードを読み取る'}">
        <span class="cell-num" aria-hidden="true">${CIRCLED[c.index]}</span>
        <span class="cell-text${c.category === 'committee' ? ' cell-text-long' : ''}" aria-hidden="true">${raw(TEXT[c.category])}</span>
        ${raw(ART[c.index])}
        ${c.marked ? raw(`${STAMP_MARK}<span class="cell-done" aria-hidden="true">体験済</span>`) : ''}
      </button>
    </li>`);
  return html`
  <article class="bingo-card" aria-label="デジタルビンゴカード">
    <div class="deco deco-tl" aria-hidden="true">${raw(svg(`${leaf(18, 18, 1.6, '#f39a2b', 20)}${leaf(42, 10, 1.1, '#e8643c', -10)}${leaf(12, 44, 1.2, '#e7b23c', 40)}`, '0 0 60 60'))}</div>
    <div class="corner ${card.used ? 'is-used' : ''}">
      <svg class="corner-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><line x1="0" y1="0" x2="100" y2="100" stroke="#555" stroke-width="2" stroke-dasharray="7 5" vector-effect="non-scaling-stroke"/></svg>
      <span class="corner-label">${card.used ? '抽選済み' : '抽選確認'}</span>
      <span class="corner-cut">キリトリ線</span>
    </div>
    <header class="card-title">
      <h1 class="t1"><ruby>秋<rt>あき</rt></ruby>のつどい</h1>
      <p class="t2">まるごと<ruby>体験<rt>たいけん</rt></ruby>ビンゴ</p>
      <p class="band"><span>11/1(日) <ruby>大垣城<rt>おおがきじょう</rt></ruby>ホール</span></p>
    </header>
    <ol class="grid">${cells}</ol>
    <p class="times"><span>シール<ruby>貼付<rt>てんぷ</rt></ruby> 〜14:50</span><span><ruby>景品交換<rt>けいひんこうかん</rt></ruby> 〜15:00</span></p>
  </article>`;
}
