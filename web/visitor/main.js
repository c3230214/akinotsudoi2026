import { getJson, postJson } from '../shared/api.js';
import { $, $$, fmtTime, html, render, toast } from '../shared/html.js';
import { scanQr } from '../shared/scanner.js';
import { CIRCLED, TAP_CELLS, renderCardFace } from './card.js';
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
    ${c.draws > 0 && !c.used ? html`<div class="card-bar">${c.surveyRequired
    ? html`<a class="btn btn-block" href="#survey">アンケートに答えて受付用QRを表示</a>`
    : html`<button type="button" class="btn btn-secondary btn-block" id="show-qr">受付用QRを表示</button>`}</div>` : ''}`);
  for (const b of $$('[data-cell]', root)) b.addEventListener('click', () => openCell(Number(b.dataset.cell)));
  $('#show-qr')?.addEventListener('click', showQr);
}

// ---------- おがっきぃ cheer ----------
let cheerTimer = 0;
function cheer(kind) {
  const dlg = $('#cheer');
  $('#cheer-img').src = `/assets/ogakky-${kind}.webp`;
  $('#cheer-img').alt = { goodjob: 'Good Job', champion: 'Champion', fantastic: 'Fantastic' }[kind];
  if (!dlg.open) dlg.show();
  clearTimeout(cheerTimer);
  cheerTimer = setTimeout(() => dlg.close(), 1800);
}

function celebrate(before, after, cellIndex) {
  if (after.marks.every(Boolean)) cheer('fantastic');
  else if (before.lines === 0 && after.lines > 0) cheer('champion');
  else cheer('goodjob');
  toast(`${CIRCLED[cellIndex]} を達成しました！`, { kind: 'ok', ms: 3000 });
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
  if (TAP_CELLS.includes(index)) {
    tapCell(index);
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

async function tapCell(cellIndex) {
  const before = state.card;
  try {
    const out = await postJson('/api/visitor/tap', { cellIndex });
    state.card = out.card;
    renderCard();
    celebrate(before, out.card, cellIndex);
  } catch (error) {
    toast(error.message, { kind: 'error', ms: 5000 });
  }
}

async function scanStamp(cellIndex) {
  const before = state.card;
  const text = await scanQr({ title: `${CIRCLED[cellIndex]} のQRコードを読み取る`, hint: 'ブースのスタンプ用QRコードを枠に写してください' });
  if (!text) return;
  try {
    const out = await postJson('/api/visitor/stamps', { payload: text, cellIndex });
    state.card = out.card;
    state.qrBust += 1;
    renderCard();
    celebrate(before, out.card, out.stamped.cellIndex);
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
    const programs = state.map.programs.filter((g) => g.stageId === place.id)
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    // The final schedule gives one time range per part (第1部, 第2部), not per
    // performer, so programmes sharing a range are listed under one time in order.
    const groups = [];
    for (const g of programs) {
      const last = groups[groups.length - 1];
      if (last && last.startsAt === g.startsAt && last.endsAt === g.endsAt) last.items.push(g);
      else groups.push({ startsAt: g.startsAt, endsAt: g.endsAt, items: [g] });
    }
    body = html`
      <p class="kind-tag">${KIND_LABELS.stage}</p>
      ${place.description ? html`<p>${place.description}</p>` : ''}
      ${programs.length === 0 ? html`<p class="notice">ステージ予定は準備中です。</p>` : html`
      <ol class="timeline" aria-label="ステージプログラム">${groups.map((grp) => html`
        <li class="tl-item">
          <p class="tl-time">${fmtTime(grp.startsAt)}〜${grp.endsAt ? fmtTime(grp.endsAt) : ''}</p>
          <ol class="tl-body tl-list">${grp.items.map((g) => html`
            <li class="${g.status === 'cancelled' ? 'is-cancelled' : ''}">
              <p class="tl-title">${g.organizer ? html`${g.organizer}<span class="muted">（${g.title}）</span>` : g.title}${g.status === 'cancelled' ? html` <span class="chip">中止</span>` : g.status === 'changed' ? html` <span class="chip">変更あり</span>` : ''}</p>
              ${g.description ? html`<p class="muted small">${g.description}</p>` : ''}
            </li>`)}</ol>
        </li>`)}</ol>
      ${groups.some((grp) => grp.items.length > 1) ? html`<p class="muted small">各部の中は出演順です。</p>` : ''}`}`;
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
      <p><a class="btn btn-block" href="#card">ビンゴカードに戻る</a></p>
      ${s.giftEnabled ? html`<p>${s.giftAt ? 'お礼はお渡し済みです。' : '景品交換所でカードのQRを見せるとお礼を受け取れます。'}</p>` : ''}`);
  }
  const scale = [...s.satisfaction].sort((a, b) => a.code - b.code);
  const [scaleLow, scaleHigh] = [scale[0], scale[scale.length - 1]];
  const radios = (name, list) => list.map((label) => html`<label class="chip-opt"><input type="radio" name="${name}" value="${label}" required><span>${label}</span></label>`);
  render(root, html`
    ${title}
    <form id="survey-form" class="survey">
      <fieldset><legend>年代</legend><div class="opts opts-4">${radios('ageGroup', s.ageGroups)}</div></fieldset>
      <fieldset><legend>性別</legend><div class="opts opts-4">${radios('gender', s.genders)}</div></fieldset>
      <p class="scale-hint"><span>1＝${scaleLow.label}</span><span>5＝${scaleHigh.label}</span></p>
      ${s.questions.map((q) => html`<fieldset class="rate"><legend>${q.label}</legend><div class="opts opts-5">${scale.map((x) => html`<label class="chip-opt sat"><input type="radio" name="rate-${q.key}" value="${x.code}" required aria-label="${q.label} ${x.code} ${x.label}"><span><b>${x.code}</b></span></label>`)}</div></fieldset>`)}
      <label for="comment" class="small-label">${s.commentLabel}（任意・名前は書かないでください）</label>
      <textarea id="comment" name="comment" maxlength="1000" rows="2"></textarea>
      <label class="consent"><input type="checkbox" name="consent" required> ${s.consentText}</label>
      <button type="submit" class="btn btn-block">送信する</button>
    </form>`);
  $('#survey-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await postJson('/api/visitor/survey', {
        ageGroup: f.get('ageGroup'), gender: f.get('gender'), ratings: Object.fromEntries(s.questions.map((q) => [q.key, Number(f.get(`rate-${q.key}`))])),
        comment: f.get('comment') ?? '', consent: f.get('consent') === 'on',
      });
      toast('送信しました。ありがとうございました', { kind: 'ok' });
      // The intake QR becomes available after answering; show it right away when the card can draw.
      try { state.card = await getJson('/api/visitor/card'); } catch { /* shown on next load */ }
      if (state.card && state.card.draws > 0 && !state.card.used) {
        location.hash = '#card';
        setTimeout(showQr, 300);
      } else {
        loadSurvey();
      }
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
    notice.intakeClosed = r.intakeClosed;
    checkNotices();
  } catch { /* retried on the next interval */ }
}

function checkNotices() {
  const now = Date.now() + notice.offset;
  const active = notice.list.filter((n) => Date.parse(n.at) <= now);
  const banner = $('#closing-banner');
  const lines = [];
  if (notice.intakeClosed) lines.push(`${notice.intakeClosed.reason}新規受付を終了しました`);
  if (active.length) lines.push(`${active.map((n) => `${n.label}は${n.time}`).join('、')}で終了しました`);
  banner.hidden = lines.length === 0;
  banner.textContent = lines.join(' ／ ');
  if (notice.intakeClosed) {
    const key = `intake@${notice.intakeClosed.at}`;
    if (!notice.shown.has(key)) {
      notice.shown.add(key);
      try { sessionStorage.setItem('mb-notice-shown', JSON.stringify([...notice.shown])); } catch { /* ignore */ }
      showIntakeClosedPop(notice.intakeClosed);
      return;
    }
  }
  const latest = active[active.length - 1];
  const key = latest && `${latest.id}@${latest.at}`;
  if (latest && !notice.shown.has(key)) {
    notice.shown.add(key);
    try { sessionStorage.setItem('mb-notice-shown', JSON.stringify([...notice.shown])); } catch { /* ignore */ }
    showPop(latest);
  }
}

function showIntakeClosedPop(c) {
  render($('#pop-text'), html`
    <p class="pop-reason">${c.reason}</p>
    <p class="pop-line1"><ruby>新規受付<rt>しんきうけつけ</rt></ruby>を</p>
    <p class="pop-line2"><ruby class="pop-em">終了<rt>しゅうりょう</rt></ruby>しました</p>`);
  const dlg = $('#pop');
  if ($('#detail').open) $('#detail').close();
  if (!dlg.open) dlg.showModal();
}

function showPop(n) {
  render($('#pop-text'), html`
    <p class="pop-line1"><ruby>${n.label}<rt>${n.ruby}</rt></ruby>は<span class="pop-time">${n.time}</span></p>
    <p class="pop-line2"><ruby class="pop-em">終了<rt>しゅうりょう</rt></ruby>です</p>`);
  const dlg = $('#pop');
  if ($('#detail').open) $('#detail').close();
  if (!dlg.open) dlg.showModal();
}

// ---------- header menu ----------
function openMenu() {
  const c = state.card;
  openSheet('メニュー', html`<div class="stack menu">
    ${c && !c.used && c.draws > 0 && !c.surveyRequired ? html`<button type="button" class="btn btn-secondary btn-block" id="menu-qr">受付用QRを表示</button>` : ''}
    <a class="btn btn-plain btn-block" href="#map">会場マップ</a>
    <a class="btn btn-plain btn-block" href="#survey">アンケート</a>
    ${c ? html`<p class="muted small">カード番号 ${c.cardId}</p>` : ''}
    <a class="admin-link" href="/admin/">管理</a>
  </div>`);
  $('#menu-qr')?.addEventListener('click', showQr);
  for (const a of $$('#detail-body a[href^="#"]')) a.addEventListener('click', () => $('#detail').close());
}

// ---------- boot ----------
$('#menu-btn').addEventListener('click', openMenu);
$('[data-pop-close]').addEventListener('click', () => $('#pop').close());
loadNotices();
setInterval(checkNotices, 5_000);
setInterval(loadNotices, 30_000);
$('#detail [data-close]').addEventListener('click', () => $('#detail').close());
$('#detail').addEventListener('click', (e) => { if (e.target === $('#detail')) $('#detail').close(); });
window.addEventListener('hashchange', route);
// Pick up "抽選済み" after staff accepted the card.
setInterval(() => { if (!document.hidden && !$('#view-card').hidden && state.card && !state.card.used && !$('#detail').open) loadCard(); }, 20_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('#view-card').hidden && !$('#detail').open) loadCard(); });
route();
