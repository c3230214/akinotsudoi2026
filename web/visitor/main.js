import { getJson, postJson } from '../shared/api.js';
import { $, $$, fmtTime, html, render, toast } from '../shared/html.js';
import { scanQr } from '../shared/scanner.js';
import { CIRCLED, renderCardFace } from './card.js';
import { KIND_LABELS, mountMap } from './map3d.js';

// Every visitor screen fits one phone screen: the card is scaled to the
// available height and secondary content (QR, booth list, details) opens in
// a dialog instead of extending the page.

const state = { card: null, noCard: false, map: null, mapApi: null, survey: null, qrBust: 0 };

// ---------- dialog ----------
function openSheet(title, body) {
  const dlg = $('#detail');
  $('#detail-title').textContent = title;
  render($('#detail-body'), body);
  if (!dlg.open) dlg.showModal();
  return dlg;
}

// ---------- routing ----------
function route() {
  const name = location.hash.replace('#', '') || 'card';
  const view = ['card', 'map', 'survey'].includes(name) ? name : 'card';
  for (const s of $$('[data-view]')) s.hidden = s.dataset.view !== view;
  for (const a of $$('[data-route]')) a.toggleAttribute('aria-current', a.dataset.route === view);
  if (view === 'card') loadCard();
  if (view === 'map') showMap();
  if (view === 'survey') loadSurvey();
}

// ---------- card ----------
async function loadCard() {
  try {
    state.card = await getJson('/api/visitor/card');
    state.noCard = false;
  } catch (error) {
    if (error.status === 401) {
      state.card = null;
      state.noCard = true;
    } else {
      toast(error.message, { kind: 'error' });
    }
  }
  renderCard();
}

function statusText(c) {
  if (c.used) return html`<strong>抽選済み</strong>（${fmtTime(c.usedAt)}）`;
  if (c.draws === 0) return html`ラインがそろうと抽選できます`;
  return html`<span class="big">${c.lines}</span>ライン達成 ／ <span class="big">${c.draws}</span>回 抽選できるよ！`;
}

function renderCard() {
  const root = $('#view-card');
  if (state.noCard) {
    render(root, html`
      <div class="start">
        <h1 class="view-title">まるごと体験ビンゴ</h1>
        <p>このスマホでデジタルビンゴカードを受け取ります。名前などの入力はありません。</p>
        <p class="muted small">カードはこのブラウザに保存されます。別のブラウザでは表示できません。</p>
        <button type="button" class="btn btn-block" id="issue">カードを受け取る</button>
      </div>`);
    $('#issue').addEventListener('click', issueCard);
    return;
  }
  const c = state.card;
  if (!c) return;
  render(root, html`
    <div class="card-fit">${renderCardFace(c)}</div>
    <div class="card-bar">
      <p class="status-line" role="status">${statusText(c)}</p>
      ${c.used ? '' : html`<p class="tap-hint">体験したらマスをタップしてブースのQRを読み取ろう</p>`}
      <p class="rule">1〜2ライン：1回／3〜7：2回／全8：3回　抽選は一度だけ</p>
      <div class="bar-buttons">
        <button type="button" class="btn btn-secondary" id="show-qr" ${c.used || c.draws === 0 ? 'disabled' : ''}>受付用QRを表示</button>
      </div>
    </div>`);
  for (const b of $$('[data-cell]', root)) b.addEventListener('click', () => openCell(Number(b.dataset.cell)));
  $('#show-qr').addEventListener('click', showQr);
}

function showQr() {
  const c = state.card;
  openSheet('受付用QRコード', html`
    <div class="qr-sheet">
      <img class="card-qr" alt="抽選受付用のQRコード（カード番号 ${c.cardId}）" src="/api/visitor/card/qr.svg?v=${state.qrBust}" width="240" height="240">
      <p>受付で係員に見せてください。</p>
      <p class="muted small">カード番号 ${c.cardId}。受付後にスタンプが増えても抽選回数は変わりません。QRを他の人に送らないでください。</p>
    </div>`);
}

async function issueCard() {
  const btn = $('#issue');
  btn.disabled = true;
  try {
    state.card = await postJson('/api/visitor/cards');
    state.noCard = false;
    renderCard();
    toast('カードを受け取りました', { kind: 'ok' });
  } catch (error) {
    btn.disabled = false;
    toast(error.message, { kind: 'error' });
  }
}

function openCell(index) {
  const c = state.card;
  const cell = c.cells[index];
  const title = `${CIRCLED[index]} ${cell.label}`;
  if (cell.marked) {
    openSheet(title, html`<div class="cell-sheet"><p class="notice notice-ok">このマスは達成済みです${cell.stampedAt ? html`（${fmtTime(cell.stampedAt)}）` : ''}。</p></div>`);
    return;
  }
  if (c.used) {
    openSheet(title, html`<div class="cell-sheet"><p class="notice">抽選済みのカードには追加できません。</p></div>`);
    return;
  }
  openSheet(title, html`<div class="cell-sheet stack">
    <p>体験したブースに掲示されている「${CIRCLED[index]}」のスタンプ用QRコードを読み取ると、このマスが達成になります。</p>
    <button type="button" class="btn" id="cell-scan">QRコードを読み取る</button>
  </div>`);
  $('#cell-scan').addEventListener('click', () => {
    $('#detail').close();
    scanStamp(index);
  });
}

async function scanStamp(cellIndex) {
  const text = await scanQr({ title: `${CIRCLED[cellIndex]} のQRコードを読み取る`, hint: 'ブースのスタンプ用QRコードを枠に写してください' });
  if (!text) return;
  try {
    const out = await postJson('/api/visitor/stamps', { payload: text, cellIndex });
    state.card = out.card;
    state.qrBust += 1;
    renderCard();
    toast(`${CIRCLED[out.stamped.cellIndex]} を達成しました！`, { kind: 'ok', ms: 4500 });
  } catch (error) {
    toast(error.message, { kind: 'error', ms: 5000 });
  }
}

// ---------- map ----------
async function showMap() {
  if (!state.map) {
    try {
      state.map = await getJson('/api/map');
    } catch (error) {
      $('#map-hint').textContent = `マップを読み込めませんでした：${error.message}`;
      return;
    }
  }
  if (!state.mapApi) {
    state.mapApi = mountMap($('#map-root'), state.map, { onSelect: openDetail });
    for (const b of $$('[data-map]')) {
      b.addEventListener('click', () => {
        const a = b.dataset.map;
        if (a === 'in') state.mapApi.zoomIn();
        if (a === 'out') state.mapApi.zoomOut();
        if (a === 'fit') state.mapApi.fit();
      });
    }
  }
  fillPlaceSelect();
  if (!state.map.places.length) $('#map-hint').textContent = state.map.venue.note || '会場配置は準備中です';
}

function fillPlaceSelect() {
  const sel = $('#map-select');
  if (sel.dataset.filled) return;
  sel.dataset.filled = '1';
  const { places } = state.map;
  const groups = ['stage', 'booth', 'facility', 'outdoor', 'area'].map((kind) => [kind, places.filter((p) => p.kind === kind)]).filter(([, list]) => list.length);
  sel.insertAdjacentHTML('beforeend', String(html`${groups.map(([kind, list]) => html`<optgroup label="${KIND_LABELS[kind]}">${list.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</optgroup>`)}`));
  sel.disabled = places.length === 0;
  sel.addEventListener('change', () => {
    const id = sel.value;
    if (!id) return;
    state.mapApi.focus(id);
    openDetail(places.find((p) => p.id === id));
    sel.value = '';
  });
}

const MISSING = '未登録';

function openDetail(place) {
  if (!place) return;
  const labels = state.map.detailLabels ?? {};
  let body;
  if (place.kind === 'stage') {
    const programs = state.map.programs.filter((g) => g.stageId === place.id).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    body = html`
      <p class="kind-tag">${KIND_LABELS.stage}</p>
      ${place.description ? html`<p>${place.description}</p>` : ''}
      ${programs.length === 0 ? html`<p class="notice">ステージ予定は準備中です。</p>` : html`
      <ol class="timeline" aria-label="ステージプログラム">${programs.map((g) => html`
        <li class="tl-item${g.status === 'cancelled' ? ' is-cancelled' : ''}">
          <p class="tl-time">${fmtTime(g.startsAt)}〜${g.endsAt ? fmtTime(g.endsAt) : ''}</p>
          <div class="tl-body">
            <p class="tl-title">${g.title}${g.status === 'cancelled' ? html` <span class="chip">中止</span>` : g.status === 'changed' ? html` <span class="chip">変更あり</span>` : ''}</p>
            ${g.organizer ? html`<p class="muted">${g.organizer}</p>` : ''}
            ${g.description ? html`<p>${g.description}</p>` : ''}
          </div>
        </li>`)}</ol>`}`;
  } else {
    const details = Object.entries(labels).filter(([k]) => place.details?.[k]);
    body = html`
      <p class="kind-tag">${KIND_LABELS[place.kind] ?? ''}${place.category ? html`・${place.category}` : ''}</p>
      <dl class="facts">
        <dt>主催・出展</dt><dd>${place.organizer || MISSING}</dd>
        <dt>紹介</dt><dd>${place.description || MISSING}</dd>
        ${details.map(([k, label]) => html`<dt>${label}</dt><dd>${place.details[k]}</dd>`)}
      </dl>
      <p class="muted small">${place.kind === 'facility' ? '施設のご案内です。スタンプ対象ではありません。' : 'スタンプはブースのQRコードを読み取って取得します。'}</p>`;
  }
  openSheet(place.name, body);
}

// ---------- survey ----------
async function loadSurvey() {
  const root = $('#view-survey');
  try {
    state.survey = await getJson('/api/visitor/survey');
  } catch (error) {
    render(root, html`<p class="notice notice-danger">${error.message}</p>`);
    return;
  }
  const s = state.survey;
  const title = html`<h1 class="view-title">アンケート</h1>`;
  if (!s.enabled) return render(root, html`${title}<p class="notice">アンケートは準備中です。</p>`);
  if (!s.hasCard) return render(root, html`${title}<p class="notice">回答にはデジタルビンゴカードが必要です。<a href="#card">カードを受け取る</a></p>`);
  if (s.answered) {
    return render(root, html`${title}<p class="notice notice-ok">ご回答ありがとうございました（${fmtTime(s.answeredAt)}）。</p>
      ${s.giftEnabled ? html`<p>${s.giftAt ? 'お礼はお渡し済みです。' : '景品交換所でカードのQRを見せるとお礼を受け取れます。'}</p>` : ''}`);
  }
  render(root, html`
    ${title}
    <form id="survey-form" class="survey">
      <fieldset class="ages">
        <legend>年齢区分（必須）</legend>
        ${s.ageGroups.map((g) => html`<label class="radio"><input type="radio" name="ageGroup" value="${g}" required> ${g}</label>`)}
      </fieldset>
      <label for="comment">${s.commentLabel}（任意・名前は書かないでください）</label>
      <textarea id="comment" name="comment" maxlength="1000" rows="3"></textarea>
      <label class="radio"><input type="checkbox" name="consent" required> ${s.consentText}</label>
      <button type="submit" class="btn btn-block">送信する</button>
    </form>`);
  $('#survey-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await postJson('/api/visitor/survey', { ageGroup: f.get('ageGroup'), comment: f.get('comment') ?? '', consent: f.get('consent') === 'on' });
      toast('送信しました。ありがとうございました', { kind: 'ok' });
      loadSurvey();
    } catch (error) {
      toast(error.message, { kind: 'error' });
    }
  });
}

// ---------- closing notices (same wording as the organisers' POP) ----------
const notice = { list: [], offset: 0, shown: new Set() };
try { for (const k of JSON.parse(sessionStorage.getItem('mb-notice-shown') ?? '[]')) notice.shown.add(k); } catch { /* storage unavailable */ }

async function loadNotices() {
  try {
    const r = await getJson('/api/notices');
    // Use the server clock: a visitor's phone may be set wrong.
    notice.offset = Date.parse(r.now) - Date.now();
    notice.list = r.notices;
    checkNotices();
  } catch { /* retried on the next interval */ }
}

function checkNotices() {
  const now = Date.now() + notice.offset;
  const active = notice.list.filter((n) => Date.parse(n.at) <= now);
  const banner = $('#closing-banner');
  banner.hidden = active.length === 0;
  if (active.length) banner.textContent = `${active.map((n) => `${n.label}は${n.time}`).join('、')}で終了しました`;
  const latest = active[active.length - 1];
  const key = latest && `${latest.id}@${latest.at}`;
  if (latest && !notice.shown.has(key)) {
    notice.shown.add(key);
    try { sessionStorage.setItem('mb-notice-shown', JSON.stringify([...notice.shown])); } catch { /* ignore */ }
    showPop(latest);
  }
}

function showPop(n) {
  render($('#pop-text'), html`
    <p class="pop-line1"><ruby>${n.label}<rt>${n.ruby}</rt></ruby>は<span class="pop-time">${n.time}</span></p>
    <p class="pop-line2"><ruby class="pop-em">終了<rt>しゅうりょう</rt></ruby>です</p>`);
  const dlg = $('#pop');
  if ($('#detail').open) $('#detail').close();
  if (!dlg.open) dlg.showModal();
}

// ---------- boot ----------
$('[data-pop-close]').addEventListener('click', () => $('#pop').close());
loadNotices();
setInterval(checkNotices, 5_000);
setInterval(loadNotices, 60_000);
$('#detail [data-close]').addEventListener('click', () => $('#detail').close());
$('#detail').addEventListener('click', (e) => { if (e.target === $('#detail')) $('#detail').close(); });
window.addEventListener('hashchange', route);
// Pick up "抽選済み" after staff accepted the card.
setInterval(() => { if (!document.hidden && !$('#view-card').hidden && state.card && !state.card.used && !$('#detail').open) loadCard(); }, 20_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#view-card').hidden && !$('#detail').open) loadCard(); });
route();
