// Digital bingo card in the layout approved by the city: title block on the
// left, おがっきぃ on the top right, 3x3 cells, a line counter and the draw
// rule (2026-10-30: back to the earlier HTML cells instead of the paper card
// pasted as images). Wording, colours and illustrations come from the paper
// card; the illustrations are cut from the organisers' PDF. A marked cell is
// covered by one of the organisers' stickers (Good Job etc.) with the words
// 「達成済み」. Tapping a cell opens its QR scan; ⑤ is achieved by the tap.
// Use of the illustrations and the mascots on the web was approved by e-mail
// (user report, 2026-10-30, DECISIONS U04).
import { html } from '../shared/html.js';

export const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
export const TAP_CELLS = [4];
const STICKERS = ['goodjob', 'amazing', 'champion', 'genius', 'fantastic'];

// Labels with furigana as printed on the paper card.
const R = (kanji, kana) => html`<ruby>${kanji}<rt>${kana}</rt></ruby>`;
const LABELS = {
  committee: html`${R('実行委員会企画', 'じっこういいんかいきかく')}を<br>${R('体験', 'たいけん')}しよう`,
  panel_feedback: html`パネルをみて<br>${R('感想', 'かんそう')}を${R('書', 'か')}こう`,
  workshop: html`${R('体験工房', 'たいけんこうぼう')}で<br>${R('体験', 'たいけん')}しよう`,
  participation: html`ビンゴに<br>${R('参加', 'さんか')}しよう`,
  stage_feedback: html`${R('発表', 'はっぴょう')}をみて<br>${R('感想', 'かんそう')}を${R('書', 'か')}こう`,
};
// Cells 7 and 8 carry a decoration along the top (curtain, bunting) instead of an icon.
const DECO_TOP = [6, 7];

function lineMessage(card) {
  if (card.used) return html`<span class="lb-right is-used">抽選済み</span>`;
  if (card.draws > 0) return html`<span class="lb-right"><b>${card.draws}回</b> 抽選できるよ！</span>`;
  return html`<span class="lb-right">スタンプをあつめよう！</span>`;
}

export function renderCardFace(card) {
  const cells = card.cells.map((c) => html`
    <li class="cell-slot">
      <button type="button" class="cell bg-${c.backgroundFamily ?? 'white'}${DECO_TOP.includes(c.index) ? ' deco-top' : ''}${c.marked ? ' is-marked' : ''}" data-cell="${c.index}"
        aria-label="${CIRCLED[c.index]} ${c.label}：${c.marked ? '達成済み' : TAP_CELLS.includes(c.index) ? 'まだ。タップすると達成' : 'まだ。タップしてQRコードを読み取る'}">
        <span class="cell-no" aria-hidden="true">${CIRCLED[c.index]}</span>
        <span class="cell-label" aria-hidden="true">${LABELS[c.category] ?? c.label}</span>
        <img class="cell-illus" src="/assets/illus-${c.index + 1}.webp" alt="" decoding="async">
        ${c.marked ? html`<span class="cell-done" aria-hidden="true"><img src="/assets/sticker-${STICKERS[c.index % STICKERS.length]}.webp" alt="" decoding="async"><span class="cell-done-text">達成済み</span></span>` : ''}
      </button>
    </li>`);
  return html`
  <article class="bingo-card" aria-label="デジタルビンゴカード">
    <div class="card-top">
      <div class="card-titles">
        <p class="ct-sub">あきのつどい 2026</p>
        <h1 class="ct-title">まるごと体験ビンゴ</h1>
        <p class="ct-pill"><span>11/1（日）当日のみ有効</span></p>
        <p class="ct-hint">体験したらマスをタップしてQRを読み取ろう！</p>
      </div>
      <figure class="mascot">
        <img src="/assets/ogakky.webp" alt="おがっきぃ" width="416" height="442">
        <figcaption>大垣市マスコットキャラクター<br><b>おがっきぃ</b></figcaption>
      </figure>
    </div>
    <ol class="grid">${cells}</ol>
    <p class="line-bar"><span class="lb-left"><span class="lb-num">${card.lines}</span>ライン達成</span>${lineMessage(card)}</p>
    <p class="rule">1〜2ライン：1回 ／ 3〜7：2回 ／ 全8：3回　抽選は一度だけ</p>
  </article>`;
}
