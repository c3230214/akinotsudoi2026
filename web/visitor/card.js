// Digital bingo card in the layout approved by the city (2026-10-28):
// title block on the left, おがっきぃ on the top right, 3x3 cells, a line
// counter and the draw rule. Each cell shows the paper card's cell artwork
// (assets/cell-N.webp, cut from the organisers' PDF), so wording, colours and
// illustrations match the paper card. Tapping a cell opens its QR scan; ⑤
// has no QR and is achieved by the tap itself.
// TODO(DECISION-U04): confirm the illustrations' terms allow web distribution.
import { html } from '../shared/html.js';

export const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
export const TAP_CELLS = [4];

function lineMessage(card) {
  if (card.used) return html`<span class="lb-right is-used">抽選済み</span>`;
  if (card.draws > 0) return html`<span class="lb-right"><b>${card.draws}回</b> 抽選できるよ！</span>`;
  return html`<span class="lb-right">スタンプをあつめよう！</span>`;
}

export function renderCardFace(card) {
  const cells = card.cells.map((c) => html`
    <li class="cell-slot">
      <button type="button" class="cell${c.marked ? ' is-marked' : ''}" data-cell="${c.index}"
        aria-label="${CIRCLED[c.index]} ${c.label}：${c.marked ? '達成済み' : TAP_CELLS.includes(c.index) ? 'まだ。タップすると達成' : 'まだ。タップしてQRコードを読み取る'}">
        <img class="cell-art" src="/assets/cell-${c.index + 1}.webp" alt="" width="420" height="400" decoding="async">
        ${c.marked ? html`<span class="cell-done" aria-hidden="true">達成済み</span>` : ''}
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
