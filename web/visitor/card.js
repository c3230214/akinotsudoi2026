// Digital bingo card. The organisers' card design (Canva PDF, 2026-10-28) is
// shown as one image, so title, furigana, illustrations and the deadline box
// match the paper card exactly. Transparent buttons sit on the nine cells;
// tapping one offers a QR scan for that cell, never marks it by itself.
// The image comes from assets/bingo-card.*, rasterised from the supplied PDF.
// TODO(DECISION-U04): confirm the illustrations' terms allow web distribution.
import { html, raw } from '../shared/html.js';

export const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];

const leaf = `<svg class="stamp-leaf" viewBox="-12 -12 24 24" aria-hidden="true" focusable="false"><path transform="rotate(-12)" fill="#d64a20" d="M0-10 L2.5-4 L8-6 L5.5 0 L10 3 L4 4 L5 10 L0 6 L-5 10 L-4 4 L-10 3 L-5.5 0 L-8-6 L-2.5-4Z"/></svg>`;

export function renderCardFace(card) {
  const cells = card.cells.map((c) => html`
    <li class="cell-slot">
      <button type="button" class="cell${c.marked ? ' is-marked' : ''}" data-cell="${c.index}"
        aria-label="${CIRCLED[c.index]} ${c.label}：${c.marked ? '体験済み' : 'まだ。タップしてQRコードを読み取る'}">
        ${c.marked ? raw(`${leaf}<span class="cell-done" aria-hidden="true">体験済</span>`) : ''}
      </button>
    </li>`);
  return html`
  <article class="bingo-card" aria-label="デジタルビンゴカード">
    <picture>
      <source srcset="/assets/bingo-card.webp" type="image/webp">
      <img class="card-art" src="/assets/bingo-card.jpg" width="1200" height="1700"
        alt="秋のつどい まるごと体験ビンゴ。11月1日（日）大垣城ホール。シール貼付は14時50分まで、景品交換は15時まで">
    </picture>
    <ol class="grid-hit">${cells}</ol>
    ${card.used ? html`<p class="used-stamp">抽選済み</p>` : ''}
  </article>`;
}
