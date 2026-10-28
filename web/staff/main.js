import { ApiError, CommandQueue, api, getJson, operationId, postJson, sendWithRetry } from '../shared/api.js';
import { $, $$, COLORS, COLOR_LABELS, fmtDateTime, fmtTime, html, previewDraws, raw, render, toast } from '../shared/html.js';
import { openStream } from '../shared/stream.js';
import { scanQr } from '../shared/scanner.js';

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
const ROLE_LABELS = { admin: '管理者', operator: '台担当', prize: '景品担当', printer: '発券端末' };
const TABS = [
  { id: 'draw', label: '受付・抽選', roles: ['admin', 'operator'] },
  { id: 'redeem', label: '引換', roles: ['admin', 'prize'] },
  { id: 'stock', label: '在庫', roles: ['admin', 'operator'] },
  { id: 'devices', label: '機器', roles: ['admin', 'operator'] },
  { id: 'audit', label: '履歴', roles: ['admin', 'operator', 'prize'] },
  { id: 'admin', label: '管理', roles: ['admin'] },
];

const st = {
  me: null,
  view: null,
  tab: null,
  paper: Array(9).fill(false),
  digital: null, // { payload, info }
  audit: { rows: [], next: null },
  redeem: null,
  closeStream: null,
};
const queue = new CommandQueue({ onChange: (n) => { const el = $('#queue'); if (el) el.textContent = n ? `送信待ち ${n} 件` : ''; } });

// ---------- helpers ----------
const ballChip = (color, label) => html`<span class="chip"><span class="ball ball-${color ?? 'null'}" aria-hidden="true"></span>${label ?? (color ? COLOR_LABELS[color] : '未判定')}</span>`;
const machine = () => st.view?.machines.find((m) => m.id === st.me.machineId) ?? null;
const isAdmin = () => st.me?.staff.role === 'admin';

function showError(error) {
  const msg = error instanceof ApiError ? error.message : String(error?.message ?? error);
  toast(msg, { kind: 'error', ms: 6000 });
  if (error?.code === 'REVISION_CONFLICT' || error?.code === 'SESSION_NOT_ACTIVE') refreshView();
}

async function command(body, { confirmText } = {}) {
  if (confirmText && !window.confirm(confirmText)) return null;
  try {
    const out = await sendWithRetry('/api/staff/commands', { operationId: operationId(), ...body }, { onRetry: () => toast('通信を再試行しています…') });
    if (out?.message) toast(out.message, { kind: 'ok' });
    return out;
  } catch (error) {
    showError(error);
    return null;
  }
}

/** Ask for a reason in a modal; resolves with the text or null. */
function askReason(title, text = '', label = '理由') {
  const dlg = $('#prompt-dlg');
  $('#prompt-title').textContent = title;
  $('#prompt-text').textContent = text;
  $('#prompt-label').textContent = label;
  const input = $('#prompt-input');
  input.value = '';
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); resolve(v); };
    $('#prompt-form').onsubmit = (e) => { e.preventDefault(); const v = input.value.trim(); if (v.length >= 2) done(v); else toast('理由を2文字以上入力してください', { kind: 'error' }); };
    $('#prompt-cancel').onclick = () => done(null);
    dlg.showModal();
    input.focus();
  });
}

/** Re-render while keeping typed values and focus of elements with an id. */
function renderKeeping(root, content) {
  const saved = new Map();
  for (const el of $$('input[id], select[id], textarea[id]', root)) saved.set(el.id, el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.value);
  const focusId = document.activeElement?.id;
  render(root, content);
  for (const [id, v] of saved) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox' || el.type === 'radio') el.checked = v;
    else el.value = v;
  }
  if (focusId) document.getElementById(focusId)?.focus();
}

async function refreshView() {
  try {
    st.view = await getJson('/api/staff/view');
    draw();
  } catch (error) {
    showError(error);
  }
}

// ---------- boot / login ----------
async function boot() {
  try {
    st.me = await getJson('/api/staff/me');
  } catch {
    st.me = null;
  }
  if (!st.me) return showLogin();
  if (st.me.staff.role === 'printer') {
    location.href = '/print/';
    return;
  }
  $('#who').innerHTML = html`${st.me.staff.displayName}（${ROLE_LABELS[st.me.staff.role]}）
    <select id="machine-select" aria-label="担当台">
      <option value="">担当台を選択</option>
      ${st.me.machines.map((m) => html`<option value="${m.id}" ${m.id === st.me.machineId ? raw('selected') : ''}>${m.name}</option>`)}
    </select>
    <a class="btn btn-plain btn-small" href="/print/" target="mb-print">発券画面</a>
    <button type="button" class="btn btn-plain btn-small" id="logout">ログアウト</button>`.value;
  $('#machine-select').addEventListener('change', async (e) => {
    try {
      await postJson('/api/staff/machine', { machineId: e.target.value || null });
      st.me.machineId = e.target.value || null;
      st.paper = Array(9).fill(false);
      st.digital = null;
      draw();
    } catch (error) { showError(error); }
  });
  $('#logout').addEventListener('click', async () => { await postJson('/api/staff/logout').catch(() => {}); location.reload(); });
  const tabs = TABS.filter((t) => t.roles.includes(st.me.staff.role));
  st.tab = tabs.find((t) => `#${t.id}` === location.hash)?.id ?? tabs[0].id;
  const nav = $('#tabs');
  nav.hidden = false;
  render(nav, html`${tabs.map((t) => html`<a href="#${t.id}" data-tab="${t.id}">${t.label}</a>`)}`);
  window.addEventListener('hashchange', () => { const id = location.hash.slice(1); if (tabs.some((t) => t.id === id)) { st.tab = id; draw(); } });
  st.closeStream = openStream('/api/stream/staff', {
    onView: (v) => { st.view = v; draw(); },
    onStatus: (s) => { $('#conn').textContent = s === 'online' ? '● 接続中' : '● 再接続中…'; $('#conn').className = `conn conn-${s}`; },
  });
}

function showLogin() {
  render($('#app'), html`
    <form id="login" class="panel login stack">
      <h1>スタッフログイン</h1>
      <label for="login-name">ログイン名</label>
      <input id="login-name" name="loginName" autocomplete="username" autocapitalize="off" required>
      <label for="login-pass">パスコード</label>
      <input id="login-pass" name="passcode" type="password" autocomplete="current-password" required>
      <button class="btn btn-block" type="submit">ログイン</button>
      <p class="muted">引換券の印刷は <a href="/print/">発券画面</a> で行います。</p>
    </form>`);
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      await postJson('/api/staff/login', { loginName: f.get('loginName'), passcode: f.get('passcode') });
      location.reload();
    } catch (error) { showError(error); }
  });
}

// ---------- main render ----------
function draw() {
  if (!st.me || !st.view) return;
  for (const a of $$('[data-tab]')) a.toggleAttribute('aria-current', a.dataset.tab === st.tab);
  const root = $('#app');
  const views = { draw: viewDraw, redeem: viewRedeem, stock: viewStock, devices: viewDevices, audit: viewAudit, admin: viewAdmin };
  renderKeeping(root, views[st.tab]());
  bind(root);
}

function needMachine() {
  return html`<div class="panel"><p class="notice">画面上部で担当台を選んでください。</p></div>`;
}

// ---------- draw tab ----------
function viewDraw() {
  const m = machine();
  if (!m) return needMachine();
  const v = st.view;
  const header = html`
    <section class="panel mhead">
      <div class="row between">
        <h1>${m.name} <span class="chip">${m.phase === 'drawing' ? '抽選中' : '待機中'}</span> <span class="chip">${m.inputMode === 'auto' ? '自動読取モード' : '手入力モード'}</span></h1>
        <span id="queue" class="muted"></span>
      </div>
      ${v.intakeClosed?.closed ? html`<p class="notice notice-danger">新規受付は終了しています（${v.intakeClosed.reason}）。進行中の抽選の確定と景品引換は続けられます。</p>` : ''}
      ${!v.inventoryConfigured ? html`<p class="notice notice-danger">初期在庫が未登録です。管理者が「管理」タブで登録するまで受付できません。</p>` : ''}
      ${m.emergency ? html`<p class="notice notice-danger">緊急停止中（ソフトウェア上の停止です。機械そのものは止まっていません）：${m.emergency.reason || '理由なし'}（${fmtTime(m.emergency.at)} ${m.emergency.by ?? ''}）</p>` : ''}
      ${m.resumeRequired ? html`<p class="notice">停止は解除済みです。「再開」を押すまで受付・確定はできません。</p>` : ''}
      ${m.warnings.map((w) => html`<p class="notice">${w}</p>`)}
      <div class="row">
        ${m.emergency ? html`<button class="btn btn-secondary" data-act="clearEmergency">停止を解除</button>`
    : html`<button class="btn btn-danger" data-act="emergencyStop">緊急停止</button>`}
        ${m.resumeRequired ? html`<button class="btn btn-ok" data-act="resumeDrawing">再開</button>` : ''}
        <span class="muted">機内：${COLORS.map((c) => html`${ballChip(c, `${COLOR_LABELS[c]} ${m.contents[c]}`)} `)}</span>
      </div>
    </section>`;
  return html`${header}${m.activeSession ? viewSession(m) : viewIntake(m)}${viewMachineVouchers(m)}${viewUnassigned(m)}`;
}

function cellToggles(marks, prefix) {
  return html`<div class="toggles" role="group" aria-label="9マスの達成状態">${marks.map((v, i) => html`
    <button type="button" class="toggle ${v === true ? 'on' : v === null ? 'unknown' : ''}" data-toggle="${prefix}" data-i="${i}" aria-pressed="${v === true}">
      <span class="tnum">${CIRCLED[i]}</span><span class="tval">${v === true ? '達成' : v === null ? '要確認' : '—'}</span>
    </button>`)}</div>`;
}

function viewIntake(m) {
  const read = m.device?.pendingRead;
  const p = previewDraws(st.paper);
  let readPanel = '';
  if (read) {
    if (read.kind === 'paper') {
      if (!st.readMarks || st.readMarksId !== read.readId) {
        st.readMarks = [...read.cells];
        st.readMarksId = read.readId;
      }
      const rp = previewDraws(st.readMarks);
      const changed = st.readMarks.some((x, i) => x !== read.cells[i]);
      readPanel = html`
        <section class="panel">
          <h2>C1読取結果（紙カード） <span class="muted">${fmtTime(read.receivedAt)}</span></h2>
          <div class="read-grid">
            ${read.imageId ? html`<img class="read-img" alt="読取画像" src="/api/staff/images/${read.imageId}">` : html`<p class="muted">画像なし</p>`}
            <div>
              <p class="muted">元の判定：${read.cells.map((x, i) => `${CIRCLED[i]}${x === true ? '○' : x === null ? '？' : '×'}`).join(' ')}</p>
              ${cellToggles(st.readMarks, 'read')}
              <p><strong>${rp.lines}ライン → 抽選${rp.n}回</strong>（最終判定はサーバー）</p>
              ${read.cornerPresent === false ? html`<p class="notice notice-danger">抽選確認の角が欠けている可能性があります。理由なしには受付できません。</p>
                <label for="read-corner-reason">角がない理由</label><input id="read-corner-reason" class="wide">` : ''}
              ${changed ? html`<label for="read-reason">修正した理由（必須）</label><input id="read-reason" class="wide">` : ''}
              <div class="row">
                <button class="btn" data-act="acceptRead" ${st.readMarks.includes(null) || rp.n === 0 ? raw('disabled') : ''}>この内容で受付</button>
                <button class="btn btn-plain" data-act="dismissRead">読取を破棄</button>
              </div>
            </div>
          </div>
        </section>`;
    } else {
      readPanel = html`
        <section class="panel">
          <h2>C1読取結果（デジタルカード）</h2>
          ${read.qrCardId ? html`<p>カード ${read.qrCardId} を読み取りました。</p><button class="btn" data-act="acceptDigitalRead">受付</button>` : html`<p class="notice notice-danger">QRを確認できません：${read.qrError ?? '不明'}</p>`}
          <button class="btn btn-plain" data-act="dismissRead">破棄</button>
        </section>`;
    }
  }
  const d = st.digital;
  return html`
    ${readPanel}
    <div class="cols">
      <section class="panel">
        <h2>デジタルカード受付</h2>
        <p class="muted">来場者のスマホに表示された受付用QRを読み取ります。</p>
        <button class="btn btn-block" data-act="scanCard">カードのQRを読み取る</button>
        ${d ? html`<div class="stack result">
          <p>カード ${d.info.cardId}：<strong>${d.info.lines}ライン → 抽選${d.info.draws}回</strong></p>
          ${d.info.used ? html`<p class="notice notice-danger">このカードは受付済みです（${fmtDateTime(d.info.usedAt)} ${d.info.usedSessionId ?? ''}）</p>`
      : d.info.draws === 0 ? html`<p class="notice">ラインが成立していません</p>`
        : html`<button class="btn btn-ok btn-block" data-act="acceptDigital">${m.name}で受付する</button>`}
          <button class="btn btn-plain btn-small" data-act="clearDigital">取り消し</button></div>` : ''}
      </section>
      <section class="panel">
        <h2>紙カード受付（手入力）</h2>
        <p class="muted">シールが貼られたマスをタップしてください。</p>
        ${cellToggles(st.paper, 'paper')}
        <p class="preview"><strong>${p.lines}ライン → 抽選${p.n}回</strong>（最終判定はサーバー）</p>
        <label class="check"><input type="checkbox" id="paper-corner" checked> 右上の「抽選確認」の角が残っている</label>
        <div id="paper-corner-reason-wrap"><label for="paper-corner-reason">角がない場合の理由</label><input id="paper-corner-reason" class="wide"></div>
        <p class="muted small">紙カードには固有番号がないため、同じカードの再提示はシステムでは検出できません。運営手順どおり角を処理してください。</p>
        <div class="row">
          <button class="btn" data-act="acceptPaper" ${p.n === 0 ? raw('disabled') : ''}>受付</button>
          <button class="btn btn-plain" data-act="clearPaper">クリア</button>
        </div>
      </section>
    </div>`;
}

function viewSession(m) {
  const s = m.activeSession;
  const sum = s.summary;
  const lastManual = [...s.balls].reverse().find((b) => b.source === 'manual');
  const isLast = lastManual && s.balls[s.balls.length - 1].ballId === lastManual.ballId;
  const canFinalize = sum.count >= s.n && sum.review === 0 && sum.shortage === 0 && !m.emergency && !m.resumeRequired;
  return html`
    <section class="panel session">
      <div class="row between">
        <h2>${s.id}：${s.cardKind === 'paper' ? '紙' : 'デジタル'}カード ${s.lines}ライン／抽選${s.n}回</h2>
        <p class="remain">${sum.remaining > 0 ? html`あと<strong>${sum.remaining}</strong>個` : '回数分の出玉あり'}</p>
      </div>
      ${m.inputMode === 'manual' ? html`
      <div class="color-buttons" role="group" aria-label="出た玉の色を記録">
        ${COLORS.map((c) => html`<button type="button" class="cbtn cbtn-${c}" data-ball="${c}"><span class="ball ball-${c}" aria-hidden="true"></span>${COLOR_LABELS[c]}</button>`)}
      </div>
      <p class="muted small">玉が出るたびに、出た順に色を押してください。回数を超えた玉も記録します（超過玉は当選に含めません）。</p>` : html`<p class="notice">自動読取モードです。C2の判定を確認し、要確認の玉は色を確定してください。</p>`}
      <ol class="balls">${s.balls.map((b) => html`
        <li class="ballrow kind-${b.kind}${b.review ? ' needs-review' : ''}">
          <span class="ord">${b.order}個目</span>${ballChip(b.color, b.colorLabel)}
          <span class="kind">${b.kind === 'valid' ? '有効' : b.kind === 'excess' ? '超過（戻し）' : '要確認'}</span>
          ${b.review ? html`<span class="chip warn">${b.review}</span>` : ''}
          ${b.shortage ? html`<span class="chip warn">景品不足で保留</span>` : ''}
          <span class="muted small">${b.source === 'device' ? '自動' : '手入力'} ${fmtTime(b.at)}</span>
          <span class="row ballacts">
            <select id="fix-${b.ballId}" aria-label="${b.order}個目の色">${COLORS.map((c) => html`<option value="${c}" ${c === b.color ? raw('selected') : ''}>${COLOR_LABELS[c]}</option>`)}</select>
            <button class="btn btn-small btn-plain" data-act="correctBall" data-id="${b.ballId}">${b.review ? '確定' : '色を修正'}</button>
            ${b.source === 'device' ? html`<button class="btn btn-small btn-plain" data-act="voidBall" data-id="${b.ballId}">無効</button>` : ''}
            ${isLast && b.ballId === lastManual.ballId ? html`<button class="btn btn-small btn-secondary" data-act="removeLast" data-id="${b.ballId}">直前取消</button>` : ''}
          </span>
        </li>`)}</ol>
      ${s.balls.length === 0 ? html`<p class="muted">まだ出玉の記録はありません。</p>` : ''}
      ${sum.shortage ? html`<button class="btn btn-secondary" data-act="retryShortage">景品の確保を再試行</button>` : ''}
      <div class="finalize">
        <label class="check"><input type="checkbox" id="tray-${s.id}"> 受け皿を空にした（玉をすべて回収した）</label>
        <button class="btn btn-ok" data-act="finalize" ${canFinalize ? '' : raw('disabled')}>結果確定・引換券を印刷</button>
        ${!canFinalize ? html`<p class="muted small">${sum.count < s.n ? `あと${s.n - sum.count}個の出玉が必要です。` : ''}${sum.review ? '要確認の玉を確定してください。' : ''}${sum.shortage ? '景品不足の判断が必要です。' : ''}${m.emergency || m.resumeRequired ? '停止中です。' : ''}</p>` : ''}
      </div>
    </section>`;
}

function printLabel(v) {
  if (v.redeemedAt) return `引換済み ${fmtTime(v.redeemedAt)}`;
  return { none: '未印刷', queued: '印刷待ち', dispatched: '印刷指示済み（排紙未確認）', confirmed: '排紙確認済み', failed: '印刷失敗' }[v.printStatus] ?? v.printStatus;
}

function viewMachineVouchers(m) {
  const list = st.view.recentSessions.filter((s) => s.machineId === m.id && s.voucher).slice(0, 6);
  if (!list.length) return '';
  return html`<section class="panel">
    <h2>この台の最近の引換券</h2>
    <div class="table-wrap"><table><thead><tr><th>券番号</th><th>景品</th><th>状態</th><th>操作</th></tr></thead><tbody>
    ${list.map((s) => html`<tr><td>${s.id}</td><td>${s.voucher.prizes.map((p) => `${p.grade}等`).join('・')}</td><td>${printLabel(s.voucher)}</td>
      <td class="row">${s.voucher.redeemedAt ? '' : html`<button class="btn btn-small btn-plain" data-act="reprint" data-id="${s.id}">同じ番号で再印刷</button>`}</td></tr>`)}
    </tbody></table></div></section>`;
}

function viewUnassigned(m) {
  if (!m.unassigned.length) return '';
  const reasons = { IDLE: '待機中の出玉', GENERATION_MISMATCH: '別の受付世代', INPUT_MODE_MANUAL: '手入力モード中の自動読取' };
  return html`<section class="panel"><h2>未割当の玉（${m.unassigned.length}）</h2>
    <p class="muted small">次の参加者には割り当てません。現物を確認して処理してください。</p>
    <ul class="plain">${m.unassigned.map((u) => html`<li class="row">${ballChip(u.color)} ${reasons[u.reason] ?? u.reason} ${fmtTime(u.receivedAt)}
      <button class="btn btn-small btn-plain" data-act="unassignedReturn" data-id="${u.id}">機内へ戻した</button>
      <button class="btn btn-small btn-plain" data-act="unassignedDismiss" data-id="${u.id}">記録のみ（実物なし）</button></li>`)}</ul></section>`;
}

// ---------- redeem tab ----------
function viewRedeem() {
  const r = st.redeem;
  return html`
    <section class="panel">
      <h1>景品引換</h1>
      <div class="row">
        <button class="btn" data-act="scanVoucher">引換券のQRを読む</button>
        <input id="voucher-input" placeholder="券番号（例 BM-0003）" autocapitalize="characters" inputmode="text">
        <button class="btn btn-secondary" data-act="lookupVoucher">番号で検索</button>
      </div>
      ${r ? html`<div class="voucher-box ${r.redeemedAt ? 'is-done' : ''}">
        <p class="vnum">${r.number}</p>
        <ul class="prizes">${r.prizes.map((p) => html`<li>${ballChip(p.color)} <strong>${p.grade}等</strong> ${p.prize}</li>`)}</ul>
        <p>${printLabel(r)}${r.manual ? '（手書き券）' : ''}</p>
        ${r.redeemedAt ? html`<p class="notice notice-danger">この券は ${fmtDateTime(r.redeemedAt)} に引換済みです（${r.redeemedBy ?? ''}）。</p>`
    : html`<button class="btn btn-ok btn-block" data-act="redeem">景品を渡して引換済みにする</button>`}
      </div>` : ''}
    </section>
    <section class="panel">
      <h2>アンケートのお礼</h2>
      <p class="muted">来場者のカードの受付用QR、または抽選済みカードの場合はカード画面のQRを読み取ります。</p>
      <button class="btn btn-secondary" data-act="surveyGift">カードQRを読んでお礼を記録</button>
    </section>
    ${viewPrizeTable()}`;
}

function viewPrizeTable() {
  return html`<section class="panel"><h2>景品の状況（2台共有）</h2><div class="table-wrap"><table>
    <thead><tr><th>等級</th><th>景品</th><th class="num">総数</th><th class="num">確保済み</th><th class="num">うち引換済み</th><th class="num">未確保（残り）</th></tr></thead>
    <tbody>${st.view.prizes.map((p) => html`<tr><td>${ballChip(p.color, `${p.grade}等 ${p.colorLabel}`)}</td><td>${p.prize}</td><td class="num">${p.total}</td><td class="num">${p.allocated}</td><td class="num">${p.redeemed}</td><td class="num"><strong>${p.available}</strong></td></tr>`)}</tbody>
  </table></div><p class="muted small">確保済み＝有効玉として景品を割り当てた数（未引換を含む）。残り＝総数−確保済み。</p></section>`;
}

// ---------- stock tab ----------
function countInputs(prefix) {
  return html`<div class="counts">${COLORS.map((c) => html`<label>${ballChip(c)}<input id="${prefix}-${c}" type="number" min="0" max="10000" value="0" inputmode="numeric"></label>`)}</div>`;
}
const readCounts = (prefix) => Object.fromEntries(COLORS.map((c) => [c, Number($(`#${prefix}-${c}`)?.value || 0)]).filter(([, n]) => n > 0));

function viewStock() {
  const v = st.view;
  const m = machine();
  return html`
    ${viewPrizeTable()}
    <section class="panel"><h2>玉の帳簿（色別）</h2><div class="table-wrap"><table>
      <thead><tr><th>色</th>${v.machines.map((x) => html`<th class="num">${x.name} 機内</th>`)}<th class="num">予備</th><th class="num">受け皿</th><th class="num">有効保管</th><th class="num">戻し待ち</th><th class="num">未割当</th><th class="num">合計</th><th class="num">景品数−玉数</th></tr></thead>
      <tbody>${COLORS.map((c) => html`<tr><td>${ballChip(c)}</td>${v.machines.map((x) => html`<td class="num">${x.contents[c]}</td>`)}<td class="num">${v.ledger[c].spare}</td><td class="num">${v.ledger[c].inTray}</td><td class="num">${v.ledger[c].storedValid}</td><td class="num">${v.ledger[c].returnPending}</td><td class="num">${v.ledger[c].unassigned}</td><td class="num">${v.ledger[c].total}</td>
        <td class="num">${v.shortage[c].diff > 0 ? html`<strong class="warn-text">不足 ${v.shortage[c].shortage}</strong>` : `${v.shortage[c].diff}`}</td></tr>`)}</tbody>
    </table></div><p class="muted small">「景品数−玉数」が正の色は、有効玉を再投入しない限り景品を配り切れません（解消には追加調達または承認済みのルール変更が必要）。</p></section>
    ${m ? html`
    <section class="panel"><h2>${m.name}：今入れるべき玉</h2>
      ${m.refill.due.length === 0 && COLORS.every((c) => m.returnPending[c] === 0) ? html`<p class="muted">現在ありません。</p>` : ''}
      ${COLORS.some((c) => m.returnPending[c] > 0) ? html`<p>戻し待ちの超過玉：${COLORS.filter((c) => m.returnPending[c]).map((c) => html`${ballChip(c, `${COLOR_LABELS[c]} ${m.returnPending[c]}個`)} `)}</p>` : ''}
      ${m.refill.due.map((p) => html`<p>補充計画 ${p.planId}（${fmtTime(p.dueAt)}〜）未実施：${COLORS.filter((c) => p.remaining[c]).map((c) => html`${ballChip(c, `${COLOR_LABELS[c]} ${p.remaining[c]}個`)} `)}</p>`)}
    </section>
    <section class="panel"><h2>超過玉を${m.name}へ戻す</h2>${countInputs('ret')}<button class="btn" data-act="returnBalls">戻した数を記録</button></section>
    <section class="panel"><h2>予備玉を${m.name}へ投入</h2>
      <label for="refill-plan">補充計画</label>
      <select id="refill-plan"><option value="">計画なし</option>${v.plans.filter((p) => p.machineId === m.id).map((p) => html`<option value="${p.planId}">${p.planId}（${fmtTime(p.dueAt)}）</option>`)}</select>
      ${countInputs('ref')}<button class="btn" data-act="refill">実際に入れた数を記録</button>
      <p class="muted small">予定の登録や時刻の到達だけでは機内数は増えません。実際に入れた数を記録したときに増えます。</p></section>` : needMachine()}`;
}

// ---------- devices tab ----------
function viewDevices() {
  return html`${st.view.machines.map((m) => {
    const d = m.device ?? {};
    return html`<section class="panel"><h2>${m.name}</h2>
      <p>会場PC：${d.online ? html`<strong class="ok-text">接続中</strong>` : html`<strong class="warn-text">心拍なし（15秒以上）</strong>`}　最終心拍 ${fmtDateTime(d.lastHeartbeatAt) || 'なし'}　トークン ${d.tokenIssued ? '発行済み' : '未発行'}</p>
      ${d.heartbeat ? html`<p>カメラ ${d.heartbeat.cameraOk === false ? '異常' : d.heartbeat.cameraOk ? '正常' : '不明'}　センサー ${d.heartbeat.sensorsOk === false ? '異常' : d.heartbeat.sensorsOk ? '正常' : '不明'}</p>` : ''}
      <div class="table-wrap"><table><thead><tr><th>bootId</th><th>種別</th><th class="num">最終連番</th><th>開始</th></tr></thead>
        <tbody>${(d.streams ?? []).map((x) => html`<tr><td>${x.bootId.slice(0, 8)}…</td><td>${x.stream === 'ball' ? '出玉' : 'カード読取'}</td><td class="num">${x.lastSeq}</td><td>${fmtDateTime(x.firstSeenAt)}</td></tr>`)}</tbody></table></div>
      <p>入力モード：<strong>${m.inputMode === 'auto' ? '自動読取（C2）' : '手入力'}</strong>
        <button class="btn btn-small btn-plain" data-act="toggleMode" data-id="${m.id}" ${m.phase !== 'idle' ? raw('disabled') : ''}>${m.inputMode === 'auto' ? '手入力に切替' : '自動読取に切替'}</button></p>
      <p class="muted small">切替は待機中のみ。手入力モード中に届いた自動読取は記録だけ残し、在庫・当選には数えません。</p>
    </section>`;
  })}`;
}

// ---------- audit tab ----------
function viewAudit() {
  return html`<section class="panel"><h1>操作履歴</h1>
    <div class="row"><button class="btn btn-secondary" data-act="auditLoad">最新を読み込む</button>${st.audit.next ? html`<button class="btn btn-plain" data-act="auditMore">さらに古い履歴</button>` : ''}
    ${isAdmin() ? html`<a class="btn btn-plain" href="/api/admin/export/audit.csv">CSV出力</a>` : ''}</div>
    <div class="table-wrap"><table><thead><tr><th>#</th><th>時刻</th><th>操作者</th><th>操作</th><th>結果</th><th>内容</th></tr></thead>
    <tbody>${st.audit.rows.map((r) => html`<tr class="${r.result === 'ok' ? '' : 'rejected'}"><td>${r.seq}</td><td>${fmtDateTime(r.at)}</td><td>${r.actor.name ?? r.actor.kind}</td><td>${r.type}</td><td>${r.result === 'ok' ? 'OK' : r.result.replace('rejected:', '拒否:')}</td><td>${r.message ?? ''}</td></tr>`)}</tbody></table></div>
  </section>`;
}

// ---------- admin tab ----------
function viewAdmin() {
  const v = st.view;
  const s = v.settings;
  return html`
    <section class="panel"><h2>イベント設定 ${v.locked ? html`<span class="chip">受付開始後のため変更不可</span>` : ''}</h2>
      <div class="table-wrap"><table><thead><tr><th>等級</th><th>色</th><th>景品名</th><th>数量</th></tr></thead><tbody>
        ${s.grades.map((g) => html`<tr><td>${g.grade}等</td><td>${ballChip(g.color)}</td><td><input id="g-prize-${g.color}" value="${g.prize}" ${v.locked ? raw('disabled') : ''}></td><td><input id="g-total-${g.color}" type="number" min="0" value="${g.total}" ${v.locked ? raw('disabled') : ''}></td></tr>`)}
      </tbody></table></div>
      <div class="counts">${s.machines.map((m) => html`<label>台 ${m.id} の名前<input id="m-name-${m.id}" value="${m.name}" ${v.locked ? raw('disabled') : ''}></label>`)}</div>
      <label for="s-heartbeat">心拍が必要な受付（DECISION-C01 未決）</label>
      <select id="s-heartbeat" ${v.locked ? raw('disabled') : ''}>${[['auto_only', '自動読取モードの台だけ必要（暫定案）'], ['always', '常に必要（原文どおり）'], ['never', '不要']].map(([k, l]) => html`<option value="${k}" ${s.heartbeatPolicy === k ? raw('selected') : ''}>${l}</option>`)}</select>
      <label class="check"><input type="checkbox" id="s-center" ${s.centerMarkedOnIssue ? raw('checked') : ''} ${v.locked ? raw('disabled') : ''}> ⑤をカード発行時に達成扱いにする（DECISION-C19 未決）</label>
      <label class="check"><input type="checkbox" id="s-manual" ${s.allowManualVoucher ? raw('checked') : ''} ${v.locked ? raw('disabled') : ''}> 手書き券の記録を許可する（DECISION-C05 未決）</label>
      <button class="btn" data-act="saveSettings" ${v.locked ? raw('disabled') : ''}>設定を保存</button>
    </section>
    <section class="panel"><h2>${v.locked ? '棚卸し補正' : '初期在庫（玉の数）'}</h2>
      ${v.locked ? html`
        <div class="row"><select id="adj-target"><option value="machine">機内</option><option value="spare">予備</option><option value="returnPending">戻し待ち</option></select>
        <select id="adj-machine">${v.machines.map((m) => html`<option value="${m.id}">${m.name}</option>`)}</select>
        <select id="adj-color">${COLORS.map((c) => html`<option value="${c}">${COLOR_LABELS[c]}</option>`)}</select>
        <input id="adj-delta" type="number" placeholder="増減（例 -2）"><button class="btn" data-act="adjust">補正（理由入力）</button></div>`
    : html`${v.machines.map((m) => html`<h3>${m.name} 機内</h3>${countInputs(`init-${m.id}`)}`)}<h3>予備（2台共有）</h3>${countInputs('init-spare')}
        <p class="notice">玉の手持ち総数と台別初期投入数は運営から未提供です。実数を数えて入力してください。</p>
        <button class="btn" data-act="setInventory">初期在庫を登録</button>`}
    </section>
    <section class="panel"><h2>補充計画の追加</h2>
      <div class="row"><select id="plan-machine">${v.machines.map((m) => html`<option value="${m.id}">${m.name}</option>`)}</select>
      <input id="plan-time" type="time" aria-label="補充時刻"></div>${countInputs('plan')}<button class="btn" data-act="addPlan">計画を追加</button></section>
    <section class="panel" id="admin-extra"><h2>スタッフ・端末・データ</h2>
      <div class="row">
        <button class="btn btn-secondary" data-act="loadStaff">スタッフ一覧</button>
        <a class="btn btn-plain" href="/api/admin/export/sessions.csv">抽選結果CSV</a>
        <a class="btn btn-plain" href="/api/admin/export/audit.csv">操作履歴CSV</a>
        <button class="btn btn-secondary" data-act="loadNotice">終了案内の時刻</button>
        <button class="btn btn-secondary" data-act="loadSurvey">アンケート設定・集計</button>
        <button class="btn btn-secondary" data-act="loadMap">マップデータ</button>
        ${s.allowManualVoucher ? html`<button class="btn btn-secondary" data-act="manualVoucher">手書き券を記録</button>` : ''}
      </div>
      <div id="admin-pane"></div>
    </section>`;
}

// ---------- events ----------
function bind(root) {
  for (const b of $$('[data-toggle]', root)) {
    b.addEventListener('click', () => {
      const arr = b.dataset.toggle === 'paper' ? st.paper : st.readMarks;
      const i = Number(b.dataset.i);
      arr[i] = arr[i] !== true;
      draw();
    });
  }
  for (const b of $$('[data-ball]', root)) {
    b.addEventListener('click', () => {
      const m = machine();
      const s = m?.activeSession;
      if (!s) return;
      navigator.vibrate?.(30);
      queue.push({ type: 'manualBall', machineId: m.id, sessionId: s.id, color: b.dataset.ball })
        .then((out) => toast(out.message, { kind: 'ok', ms: 1500 }))
        .catch(showError);
    });
  }
  const corner = $('#paper-corner');
  if (corner) {
    const sync = () => { $('#paper-corner-reason-wrap').hidden = corner.checked; };
    corner.addEventListener('change', sync);
    sync();
  }
  for (const b of $$('[data-act]', root)) b.addEventListener('click', () => act(b.dataset.act, b.dataset.id, b));
}

async function acceptCard(body) {
  const m = machine();
  try {
    const out = await sendWithRetry('/api/staff/cards/accept', { operationId: operationId(), machineId: m.id, expectedMachineRevision: m.revision, ...body });
    toast(out.message, { kind: 'ok' });
    return out;
  } catch (error) {
    showError(error);
    return null;
  }
}

async function act(name, id, el) {
  const m = machine();
  const s = m?.activeSession;
  switch (name) {
    case 'emergencyStop': {
      const reason = await askReason(`${m.name}を緊急停止`, 'ソフトウェア上の停止です。機械を物理的に止める操作は別に行ってください。', '停止理由');
      if (reason) await command({ type: 'emergencyStop', machineId: m.id, reason });
      break;
    }
    case 'clearEmergency': {
      const reason = await askReason('緊急停止を解除', '解除後、再開操作をするまで受付・確定はできません。', '解除理由（必須）');
      if (reason) await command({ type: 'clearEmergency', machineId: m.id, reason });
      break;
    }
    case 'resumeDrawing': await command({ type: 'resumeDrawing', machineId: m.id }); break;
    case 'scanCard': {
      const text = await scanQr({ title: 'カードのQRを読み取る', hint: '来場者のスマホに表示された受付用QR' });
      if (!text) break;
      try {
        st.digital = { payload: text, info: await postJson('/api/staff/cards/lookup', { payload: text }) };
        draw();
      } catch (error) { showError(error); }
      break;
    }
    case 'clearDigital': st.digital = null; draw(); break;
    case 'acceptDigital': {
      if (await acceptCard({ kind: 'digital', payload: st.digital.payload })) { st.digital = null; }
      break;
    }
    case 'acceptDigitalRead': await acceptCard({ kind: 'digital', readId: m.device.pendingRead.readId }); break;
    case 'clearPaper': st.paper = Array(9).fill(false); draw(); break;
    case 'acceptPaper': {
      const cornerPresent = $('#paper-corner').checked;
      const cornerReason = $('#paper-corner-reason').value.trim();
      if (!cornerPresent && cornerReason.length < 2) { toast('角がない理由を入力してください', { kind: 'error' }); break; }
      const p = previewDraws(st.paper);
      if (!window.confirm(`紙カード ${p.lines}ライン（抽選${p.n}回）で受付します。よろしいですか？`)) break;
      if (await acceptCard({ kind: 'paper', marks: st.paper, cornerPresent, ...(cornerPresent ? {} : { cornerReason }) })) {
        st.paper = Array(9).fill(false);
        $('#paper-corner-reason').value = '';
      }
      break;
    }
    case 'acceptRead': {
      const read = m.device.pendingRead;
      const body = { kind: 'paper', readId: read.readId, marks: st.readMarks, cornerPresent: read.cornerPresent !== false };
      const reason = $('#read-reason')?.value.trim();
      if (reason) body.correctionReason = reason;
      const cr = $('#read-corner-reason')?.value.trim();
      if (cr) body.cornerReason = cr;
      if (await acceptCard(body)) st.readMarks = null;
      break;
    }
    case 'dismissRead':
      try { await postJson(`/api/staff/card-reads/${m.device.pendingRead.readId}/dismiss`, { machineId: m.id }); } catch (error) { showError(error); }
      break;
    case 'correctBall': {
      const color = $(`#fix-${id}`).value;
      const reason = await askReason(`${COLOR_LABELS[color]}に確定・修正`, '現物の玉を確認してください。', '理由（必須）');
      if (reason) await command({ type: 'correctBall', machineId: m.id, sessionId: s.id, ballId: id, color, reason });
      break;
    }
    case 'voidBall': {
      const reason = await askReason('自動読取の記録を無効にする', '実際には出ていない玉、または手入力と重複した記録のときに使います。', '理由（必須）');
      if (reason) await command({ type: 'voidBall', machineId: m.id, sessionId: s.id, ballId: id, reason });
      break;
    }
    case 'removeLast': {
      const reason = await askReason('直前の入力を取り消す', '入力の訂正です。玉の現物は取り消されません。', '理由（必須）');
      if (reason) await command({ type: 'removeManualBall', machineId: m.id, sessionId: s.id, ballId: id, reason });
      break;
    }
    case 'retryShortage': await command({ type: 'retryShortage', machineId: m.id, sessionId: s.id }); break;
    case 'finalize': {
      if (!$(`#tray-${s.id}`).checked) { toast('受け皿を空にしたことを確認してチェックしてください', { kind: 'error' }); break; }
      if (queue.pending) { toast('送信待ちの出玉があります。送信完了を待ってください', { kind: 'error' }); break; }
      await command({ type: 'finalizeResult', machineId: m.id, sessionId: s.id, trayEmptied: true }, { confirmText: `${s.id} の結果を確定し、引換券を印刷します。` });
      break;
    }
    case 'reprint': {
      const reason = await askReason(`${id} を同じ券番号で再印刷`, '印刷失敗・紙詰まりなどのとき。景品の確保は増えません。', '理由（必須）');
      if (reason) await command({ type: 'requestReprint', sessionId: id, reason });
      break;
    }
    case 'unassignedReturn': case 'unassignedDismiss': {
      const reason = await askReason('未割当の玉を処理', '', '確認内容（必須）');
      if (reason) await command({ type: 'resolveUnassigned', unassignedId: id, disposition: name === 'unassignedReturn' ? 'returnToMachine' : 'dismiss', reason });
      break;
    }
    case 'scanVoucher': {
      const text = await scanQr({ title: '引換券のQRを読む' });
      if (text) await lookupVoucher(text.replace(/^MARUGOTO2026:VOUCHER:/, ''));
      break;
    }
    case 'lookupVoucher': await lookupVoucher($('#voucher-input').value); break;
    case 'redeem': {
      const out = await command({ type: 'redeemPrize', voucher: st.redeem.number });
      if (out) await lookupVoucher(st.redeem.number);
      break;
    }
    case 'surveyGift': {
      const text = await scanQr({ title: 'カードのQRを読む' });
      if (!text) break;
      try { await postJson('/api/staff/survey-gift', { payload: text }); toast('お礼を渡したことを記録しました', { kind: 'ok' }); } catch (error) { showError(error); }
      break;
    }
    case 'returnBalls': {
      const colors = readCounts('ret');
      if (!Object.keys(colors).length) { toast('個数を入力してください', { kind: 'error' }); break; }
      if (await command({ type: 'returnBalls', machineId: m.id, colors })) COLORS.forEach((c) => { $(`#ret-${c}`).value = 0; });
      break;
    }
    case 'refill': {
      const colors = readCounts('ref');
      if (!Object.keys(colors).length) { toast('個数を入力してください', { kind: 'error' }); break; }
      const planId = $('#refill-plan').value || undefined;
      if (await command({ type: 'refillPlanned', machineId: m.id, colors, ...(planId ? { planId } : {}) })) COLORS.forEach((c) => { $(`#ref-${c}`).value = 0; });
      break;
    }
    case 'toggleMode': {
      const target = st.view.machines.find((x) => x.id === id);
      const mode = target.inputMode === 'auto' ? 'manual' : 'auto';
      const reason = await askReason(`${target.name}を${mode === 'auto' ? '自動読取' : '手入力'}モードへ`, '切替前に機内と受け皿の現物を確認してください。', '理由（必須）');
      if (reason) await command({ type: 'setInputMode', machineId: id, mode, reason });
      break;
    }
    case 'auditLoad': case 'auditMore': {
      try {
        const page = await getJson(`/api/staff/audit?limit=100${name === 'auditMore' && st.audit.next ? `&before=${st.audit.next}` : ''}`);
        st.audit = { rows: name === 'auditMore' ? [...st.audit.rows, ...page.rows] : page.rows, next: page.rows.length === 100 ? page.next : null };
        draw();
      } catch (error) { showError(error); }
      break;
    }
    default: await adminAct(name, id, el);
  }
}

function surveyTable(sum) {
  const head = html`<tr><th>区分</th><th class="num">回答数</th><th class="num">満足度平均</th>${sum.satisfaction.labels.map((x) => html`<th class="num">${x.code} ${x.label}</th>`)}</tr>`;
  const row = (r) => html`<tr><td>${r.label}</td><td class="num">${r.count}</td><td class="num">${r.mean ?? '－'}</td>${sum.satisfaction.labels.map((x) => html`<td class="num">${r.distribution[x.code]}</td>`)}</tr>`;
  return html`<div class="table-wrap"><table><thead>${head}</thead><tbody>
    ${row({ label: '全体', count: sum.total, mean: sum.satisfaction.mean, distribution: sum.satisfaction.distribution })}
    ${sum.byAge.map(row)}${sum.byGender.map(row)}</tbody></table></div>`;
}

async function lookupVoucher(text) {
  try {
    st.redeem = await getJson(`/api/staff/vouchers/${encodeURIComponent(String(text).trim().toUpperCase())}`);
    draw();
  } catch (error) {
    st.redeem = null;
    showError(error);
    draw();
  }
}

async function adminAct(name) {
  const v = st.view;
  const pane = () => $('#admin-pane');
  switch (name) {
    case 'saveSettings': {
      const settings = {
        ...v.settings,
        grades: v.settings.grades.map((g) => ({ ...g, prize: $(`#g-prize-${g.color}`).value, total: Number($(`#g-total-${g.color}`).value) })),
        machines: v.settings.machines.map((m) => ({ ...m, name: $(`#m-name-${m.id}`).value })),
        heartbeatPolicy: $('#s-heartbeat').value,
        centerMarkedOnIssue: $('#s-center').checked,
        allowManualVoucher: $('#s-manual').checked,
      };
      await command({ type: 'updateSettings', settings });
      break;
    }
    case 'setInventory': {
      const contents = Object.fromEntries(v.machines.map((m) => [m.id, readCounts(`init-${m.id}`)]));
      await command({ type: 'setInventory', contents, spare: readCounts('init-spare') }, { confirmText: '入力した数で初期在庫を登録します。最初の受付後は変更できません。' });
      break;
    }
    case 'adjust': {
      const delta = Number($('#adj-delta').value);
      if (!Number.isInteger(delta) || delta === 0) { toast('増減を整数で入力してください', { kind: 'error' }); break; }
      const reason = await askReason('棚卸し補正', '現物を数えた結果に合わせます。', '理由（必須）');
      if (reason) await command({ type: 'adjustInventory', target: $('#adj-target').value, machineId: $('#adj-machine').value, color: $('#adj-color').value, delta, reason });
      break;
    }
    case 'addPlan': {
      const t = $('#plan-time').value;
      if (!t) { toast('時刻を入力してください', { kind: 'error' }); break; }
      await command({ type: 'addRefillPlan', machineId: $('#plan-machine').value, dueAt: `${v.settings.heldOn}T${t}:00+09:00`, colors: readCounts('plan') });
      break;
    }
    case 'manualVoucher': {
      const sid = window.prompt('手書き券を発行した券番号（例 BM-0003）');
      if (!sid) break;
      const reason = await askReason('手書き券として記録', '', '理由（必須）');
      if (reason) await command({ type: 'markManualVoucher', sessionId: sid.trim().toUpperCase(), reason });
      break;
    }
    case 'loadStaff': {
      try {
        const { staff, roles } = await getJson('/api/admin/staff');
        render(pane(), html`<h3>スタッフ</h3><div class="table-wrap"><table><thead><tr><th>ログイン名</th><th>表示名</th><th>役割</th><th>状態</th><th></th></tr></thead><tbody>
          ${staff.map((s) => html`<tr><td>${s.loginName}</td><td>${s.displayName}</td><td>${ROLE_LABELS[s.role]}</td><td>${s.active ? '有効' : '無効'}</td>
            <td><button class="btn btn-small btn-plain" data-staff-toggle="${s.id}" data-active="${s.active}">${s.active ? '無効にする' : '有効にする'}</button>
            <button class="btn btn-small btn-plain" data-staff-pass="${s.id}">パスコード再設定</button></td></tr>`)}</tbody></table></div>
          <form id="staff-new" class="row"><input id="ns-login" placeholder="ログイン名（英小文字）" required><input id="ns-name" placeholder="表示名" required>
          <select id="ns-role">${roles.map((r) => html`<option value="${r}">${ROLE_LABELS[r]}</option>`)}</select>
          <input id="ns-pass" type="password" placeholder="パスコード（8文字以上）" autocomplete="new-password" required><button class="btn">追加</button></form>`);
        $('#staff-new').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await postJson('/api/admin/staff', { loginName: $('#ns-login').value, displayName: $('#ns-name').value, role: $('#ns-role').value, passcode: $('#ns-pass').value });
            toast('追加しました', { kind: 'ok' });
            adminAct('loadStaff');
          } catch (error) { showError(error); }
        });
        for (const b of $$('[data-staff-toggle]', pane())) b.addEventListener('click', async () => { try { await api('PATCH', `/api/admin/staff/${b.dataset.staffToggle}`, { active: b.dataset.active !== 'true' }); adminAct('loadStaff'); } catch (error) { showError(error); } });
        for (const b of $$('[data-staff-pass]', pane())) b.addEventListener('click', async () => { const p = window.prompt('新しいパスコード（8文字以上）'); if (!p) return; try { await api('PATCH', `/api/admin/staff/${b.dataset.staffPass}`, { passcode: p }); toast('変更しました', { kind: 'ok' }); } catch (error) { showError(error); } });
      } catch (error) { showError(error); }
      break;
    }
    case 'loadNotice': {
      try {
        const cfg = await getJson('/api/admin/notice-config');
        render(pane(), html`<h3>来場者画面の終了案内（POPと同じ表示）</h3>
          <p class="muted">時刻になると来場者のスマホにPOPと同じ案内が出ます。案内を出すだけで、受付や抽選を止めはしません。日付はイベント設定の開催日（${v.settings.heldOn}）です。</p>
          <label class="check"><input type="checkbox" id="nc-enabled" ${cfg.enabled ? raw('checked') : ''}> 案内を出す</label>
          <div class="row"><label for="nc-reception">受付の終了</label><input id="nc-reception" type="time" value="${cfg.reception}">
          <label for="nc-draw">抽選の終了</label><input id="nc-draw" type="time" value="${cfg.draw}"></div>
          <button class="btn" id="nc-save">保存</button>`);
        $('#nc-save').addEventListener('click', async () => {
          try {
            await api('PUT', '/api/admin/notice-config', { enabled: $('#nc-enabled').checked, reception: $('#nc-reception').value, draw: $('#nc-draw').value });
            toast('保存しました', { kind: 'ok' });
          } catch (error) { showError(error); }
        });
      } catch (error) { showError(error); }
      break;
    }
    case 'loadSurvey': {
      try {
        const [cfg, sum] = await Promise.all([getJson('/api/admin/survey-config'), getJson('/api/admin/surveys/summary')]);
        render(pane(), html`<h3>アンケート設定</h3><p class="notice">年代、性別、満足度（5段階）を数値で集計します。選択肢と同意文の初期値は提案です（DECISION-C16）。回答が集まってから選択肢を変えると集計がずれるので、開場前に確定してください。</p>
          <label class="check"><input type="checkbox" id="sv-enabled" ${cfg.enabled ? raw('checked') : ''}> 公開する</label>
          <label for="sv-ages">年代（1行に1つ）</label><textarea id="sv-ages">${cfg.ageGroups.join('\n')}</textarea>
          <label for="sv-genders">性別（1行に1つ）</label><textarea id="sv-genders">${cfg.genders.join('\n')}</textarea>
          <label for="sv-comment">自由記述の見出し</label><input id="sv-comment" value="${cfg.commentLabel}">
          <label for="sv-consent">同意文</label><textarea id="sv-consent">${cfg.consentText}</textarea>
          <label class="check"><input type="checkbox" id="sv-gift" ${cfg.giftEnabled ? raw('checked') : ''}> 回答者へのお礼を記録する</label>
          <button class="btn" id="sv-save">保存</button>
          <h3>集計（回答 ${sum.total} 件、満足度の平均 ${sum.satisfaction.mean ?? '－'}）</h3>
          ${surveyTable(sum)}
          <p><a class="btn btn-plain btn-small" href="/api/admin/export/surveys.csv">アンケートCSV（コード付き）</a></p>`);
        $('#sv-save').addEventListener('click', async () => {
          try {
            await api('PUT', '/api/admin/survey-config', { enabled: $('#sv-enabled').checked, ageGroups: $('#sv-ages').value.split('\n'), genders: $('#sv-genders').value.split('\n'), commentLabel: $('#sv-comment').value, consentText: $('#sv-consent').value, giftEnabled: $('#sv-gift').checked });
            toast('保存しました', { kind: 'ok' });
          } catch (error) { showError(error); }
        });
      } catch (error) { showError(error); }
      break;
    }
    case 'loadMap': {
      try {
        const data = await getJson('/api/admin/map');
        render(pane(), html`<h3>会場マップデータ（JSON）</h3>
          <p class="muted">形式は docs/map-data.md を参照してください。保存すると来場者マップ全体が置き換わります。正式な配置・名称・演目のみ登録してください。</p>
          <textarea id="map-json" class="code-area" spellcheck="false">${JSON.stringify(data, null, 2)}</textarea>
          <div class="row"><label class="btn btn-plain">ファイルを読み込む<input type="file" id="map-file" accept="application/json,.json" hidden></label><button class="btn" id="map-save">検証して保存</button></div>`);
        $('#map-file').addEventListener('change', async (e) => { const f = e.target.files?.[0]; if (f) $('#map-json').value = await f.text(); });
        $('#map-save').addEventListener('click', async () => {
          let body;
          try { body = JSON.parse($('#map-json').value); } catch { toast('JSONの形式が正しくありません', { kind: 'error' }); return; }
          try { const out = await api('PUT', '/api/admin/map', body); toast(`保存しました（場所 ${out.places}、演目 ${out.programs}）`, { kind: 'ok' }); } catch (error) { showError(error); }
        });
      } catch (error) { showError(error); }
      break;
    }
    default: break;
  }
}

boot();
