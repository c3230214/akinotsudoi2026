import { ApiError, getJson, operationId, postJson, sendWithRetry } from '../shared/api.js';
import { $, $$, COLORS, COLOR_LABELS, fmtTime, html, previewDraws, raw, render, toast } from '../shared/html.js';
import { openStream } from '../shared/stream.js';
import { scanQr } from '../shared/scanner.js';

// Machine tablet: the iPad runs /garagara1/, the Pixel Tablet /garagara2/.
// The page names the machine it is for; the server still decides what the
// signed-in account may do (an operator only works on the machine selected
// for its login session).
// Flow (2026-10-30 request): ガラガラを開始する -> choose the number of turns
// -> enter the colour of each ball -> 引換券を発券. With camera recognition
// on, card reads from the Windows PC and ball-colour hints appear here too;
// the staff member always confirms them.

const MACHINE_ID = document.body.dataset.machine;
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
const st = { me: null, view: null, step: 'home', done: null, readMarks: null, readId: null, usedHints: new Set(), busy: false };

const machine = () => st.view?.machines.find((m) => m.id === MACHINE_ID) ?? null;
const gradeOf = (color) => st.view.settings.grades.find((g) => g.color === color);

function showError(error) {
  toast(error instanceof ApiError ? error.message : String(error?.message ?? error), { kind: 'error', ms: 6000 });
}

async function command(body) {
  try {
    return await sendWithRetry('/api/staff/commands', { operationId: operationId(), ...body }, { onRetry: () => toast('通信を再試行しています…') });
  } catch (error) {
    showError(error);
    return null;
  }
}

async function accept(body) {
  const m = machine();
  if (st.busy) return null;
  st.busy = true;
  try {
    const out = await sendWithRetry('/api/staff/cards/accept', { operationId: operationId(), machineId: m.id, expectedMachineRevision: m.revision, ...body });
    st.step = 'home';
    return out;
  } catch (error) {
    showError(error);
    return null;
  } finally {
    st.busy = false;
  }
}

// ---------- boot ----------
async function boot() {
  try { st.me = await getJson('/api/staff/me'); } catch { st.me = null; }
  if (!st.me) return showLogin();
  if (!st.me.machines.some((m) => m.id === MACHINE_ID)) {
    render($('#app'), html`<p class="notice notice-danger">この画面の台（${MACHINE_ID}）が登録されていません。</p>`);
    return;
  }
  if (st.me.machineId !== MACHINE_ID) {
    try {
      await postJson('/api/staff/machine', { machineId: MACHINE_ID });
      st.me.machineId = MACHINE_ID;
    } catch (error) { showError(error); }
  }
  $('#logout').hidden = false;
  $('#logout').addEventListener('click', async () => { await postJson('/api/staff/logout').catch(() => {}); location.reload(); });
  openStream('/api/stream/staff', {
    onView: (v) => { st.view = v; draw(); },
    onStatus: (s) => { $('#conn').textContent = s === 'online' ? '● 接続中' : '● 再接続中…'; $('#conn').className = `conn conn-${s}`; },
  });
  keepAwake();
}

/** Keep the tablet screen on while the page is open (where supported). */
async function keepAwake() {
  try {
    if (!('wakeLock' in navigator)) return;
    await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(() => {}); });
  } catch { /* not allowed; the device's own sleep setting applies */ }
}

function showLogin() {
  render($('#app'), html`
    <form id="login" class="panel login stack">
      <h1>${document.title.split('｜')[0]}</h1>
      <label for="login-name">ログイン名</label>
      <input id="login-name" autocomplete="username" autocapitalize="off" required>
      <label for="login-pass">パスコード</label>
      <input id="login-pass" type="password" autocomplete="current-password" required>
      <button class="btn btn-block">ログイン</button>
    </form>`);
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await postJson('/api/staff/login', { loginName: $('#login-name').value, passcode: $('#login-pass').value });
      location.reload();
    } catch (error) { showError(error); }
  });
}

// ---------- render ----------
function draw() {
  const m = machine();
  if (!m) return;
  $('#mname').textContent = m.name;
  render($('#app'), html`${statusBar(m)}${m.activeSession ? viewDrawing(m) : st.done ? viewDone() : st.step === 'count' ? viewCount(m) : viewHome(m)}`);
  bind();
}

function statusBar(m) {
  const v = st.view;
  const blocked = [];
  if (v.intakeClosed?.closed) blocked.push(`新規受付は終了しています（${v.intakeClosed.reason}）`);
  if (!v.inventoryConfigured) blocked.push('玉と景品の初期在庫が未登録です（管理者が登録）');
  if (m.emergency) blocked.push(`緊急停止中（ソフトウェア上の停止で、ガラガラ自体は止まっていません）：${m.emergency.reason || ''}`);
  if (m.resumeRequired) blocked.push('停止は解除済みです。「再開」を押してください');
  return html`
    <section class="bar">
      <label class="switch">
        <input type="checkbox" id="assist" ${m.cameraAssist ? raw('checked') : ''}>
        <span>カメラ自動認識：<b>${m.cameraAssist ? 'オン' : 'オフ'}</b></span>
      </label>
      <span class="muted small">${m.cameraAssist ? 'WindowsPCのカメラの読取結果と玉の色の候補がここに出ます（確定はこの画面で）' : '手動で回数と色を入力します'}</span>
      <span class="spacer"></span>
      ${m.emergency ? html`<button class="btn btn-secondary btn-small" data-act="clearEmergency">停止を解除</button>`
    : html`<button class="btn btn-danger btn-small" data-act="emergencyStop">緊急停止</button>`}
      ${m.resumeRequired ? html`<button class="btn btn-ok btn-small" data-act="resumeDrawing">再開</button>` : ''}
    </section>
    ${blocked.map((t) => html`<p class="notice notice-danger">${t}</p>`)}`;
}

function viewHome(m) {
  const read = m.cameraAssist ? m.device?.pendingRead : null;
  return html`
    ${read ? viewRead(m, read) : ''}
    <button class="start" data-act="start">ガラガラを開始する</button>
    ${recentVouchers(m)}`;
}

function viewRead(m, read) {
  if (read.kind === 'digital') {
    const p = read.preview;
    return html`<section class="panel read">
      <h2>カメラ：デジタルカード <span class="muted small">${fmtTime(read.receivedAt)}</span></h2>
      ${p ? html`<p class="draws-big">${p.lines}ライン → ガラガラ <strong>${p.draws}回</strong></p>` : html`<p class="notice notice-danger">${read.qrError ?? 'QRを確認できません'}</p>`}
      <div class="row">
        ${p && !p.used && p.draws > 0 ? html`<button class="btn btn-ok btn-lg" data-act="acceptDigitalRead">この内容でガラガラを開始する</button>` : ''}
        <button class="btn btn-plain" data-act="dismissRead">取り消す</button>
      </div></section>`;
  }
  if (st.readId !== read.readId) { st.readId = read.readId; st.readMarks = [...read.cells]; }
  const pv = previewDraws(st.readMarks);
  const changed = st.readMarks.some((x, i) => x !== read.cells[i]);
  return html`<section class="panel read">
    <h2>カメラ：紙カード <span class="muted small">${fmtTime(read.receivedAt)}</span></h2>
    <div class="read-grid">
      ${read.imageId ? html`<img class="read-img" alt="カメラで撮ったカード" src="/api/staff/images/${read.imageId}">` : ''}
      <div>
        <p class="muted small">カードの実物と見比べ、違うマスはタップして直してください。</p>
        <div class="toggles">${st.readMarks.map((v, i) => html`<button type="button" class="toggle ${v === true ? 'on' : v === null ? 'unknown' : ''}" data-cell="${i}" aria-pressed="${v === true}"><span>${CIRCLED[i]}</span><small>${v === true ? 'シールあり' : v === null ? '要確認' : 'なし'}</small></button>`)}</div>
        <p class="draws-big">${pv.lines}ライン → ガラガラ <strong>${pv.n}回</strong></p>
        ${read.cornerPresent === false ? html`<p class="notice notice-danger">「抽選確認」の角がないカードの可能性があります。</p>` : ''}
        <div class="row">
          <button class="btn btn-ok btn-lg" data-act="acceptPaperRead" ${st.readMarks.includes(null) || pv.n === 0 ? raw('disabled') : ''}>この内容でガラガラを開始する</button>
          <button class="btn btn-plain" data-act="dismissRead">取り消す</button>
        </div>
        ${changed ? html`<p class="muted small">直したマスは「カメラの判定を修正」として記録します。</p>` : ''}
      </div>
    </div></section>`;
}

function viewCount() {
  return html`
    <section class="panel">
      <h2>紙カード：何回まわしますか？</h2>
      <p class="muted">カードのそろったラインを数えて選んでください。1〜2ライン＝1回、3〜7ライン＝2回、8ライン（全部）＝3回。</p>
      <label class="check"><input type="checkbox" id="corner"> 右上の「抽選確認」の角が残っているのを確かめた（このあと切り取る）</label>
      <div class="counts">${[1, 2, 3].map((n) => html`<button class="count" data-count="${n}"><b>${n}</b>回</button>`)}</div>
      <p class="muted small">紙カードには番号がないため、同じカードを2回出されてもシステムでは見分けられません。角を切り取って防ぎます。</p>
    </section>
    <section class="panel">
      <h2>デジタルカード</h2>
      <p class="muted">来場者のスマホの受付用QRを、このタブレットのカメラで読みます。回数はサーバーが計算します。</p>
      <button class="btn btn-lg" data-act="scanDigital">受付用QRを読む</button>
    </section>
    <button class="btn btn-plain" data-act="back">戻る</button>`;
}

function viewDrawing(m) {
  const s = m.activeSession;
  const sum = s.summary;
  const nextTurn = Math.min(sum.count + 1, s.n);
  const lastManual = [...s.balls].reverse().find((b) => b.source === 'manual');
  const canUndo = lastManual && s.balls[s.balls.length - 1].ballId === lastManual.ballId;
  const hints = m.cameraAssist ? (m.device?.hints ?? []).filter((h) => h.color && !st.usedHints.has(h.id)).slice(0, 2) : [];
  const ready = sum.count >= s.n && sum.review === 0 && sum.shortage === 0 && !m.emergency && !m.resumeRequired;
  return html`
    <section class="panel">
      <div class="turnhead">
        <p class="turn">${sum.count >= s.n ? html`全<b>${s.n}</b>回 入力済み` : html`<b>${nextTurn}</b>回目 ／ 全${s.n}回`}</p>
        <p class="muted small">${s.id}　${s.cardKind === 'paper' ? '紙カード' : 'デジタルカード'}${s.lines !== null ? `　${s.lines}ライン` : ''}</p>
      </div>
      ${sum.count < s.n ? html`<p class="muted">出た玉の色を押してください。</p>` : ''}
      <div class="colors">${COLORS.map((c) => { const g = gradeOf(c); return html`
        <button class="cbtn cbtn-${c}" data-ball="${c}"><span class="ball ball-${c}" aria-hidden="true"></span><b>${COLOR_LABELS[c]}</b><span>${g.grade}等</span></button>`; })}</div>
      ${hints.length ? html`<div class="hints"><span class="muted small">カメラの候補：</span>${hints.map((h) => html`
        <span class="hint"><span class="ball ball-${h.color}" aria-hidden="true"></span>${COLOR_LABELS[h.color]}（${gradeOf(h.color).grade}等）${h.confidence !== null ? ` ${Math.round(h.confidence * 100)}%` : ''}
        <button class="btn btn-small btn-ok" data-hint="${h.id}" data-color="${h.color}">この色で記録</button>
        <button class="btn btn-small btn-plain" data-skip="${h.id}">無視</button></span>`)}</div>` : ''}
      <ol class="results">${s.balls.map((b) => html`
        <li class="${b.kind}"><span class="ord">${b.kind === 'excess' ? '超過' : `${b.order}回目`}</span>
          <span class="ball ball-${b.color ?? 'null'}" aria-hidden="true"></span><b>${b.colorLabel}</b>
          ${b.color && b.kind !== 'excess' ? html`<span>${gradeOf(b.color).grade}等 ${gradeOf(b.color).prize}</span>` : ''}
          ${b.kind === 'excess' ? html`<span class="muted small">回数を超えた玉（ガラガラへ戻す）</span>` : ''}
          ${b.review ? html`<span class="chip warn">${b.review}</span>` : ''}${b.shortage ? html`<span class="chip warn">景品不足</span>` : ''}</li>`)}</ol>
      <div class="row">
        ${canUndo ? html`<button class="btn btn-plain" data-act="undo" data-id="${lastManual.ballId}">直前の入力を取り消す</button>` : ''}
        <a class="btn btn-plain btn-small" href="/staff/#draw">詳しい画面（修正・要確認）</a>
      </div>
      ${sum.review ? html`<p class="notice">要確認の玉があります。「詳しい画面」で色を確定してください。</p>` : ''}
      ${sum.shortage ? html`<p class="notice notice-danger">景品が足りない色があります。管理者に連絡してください。</p>` : ''}
      ${sum.count >= s.n ? html`<div class="finish">
        <label class="check"><input type="checkbox" id="tray"> 受け皿の玉をすべて回収した</label>
        <button class="btn btn-ok btn-lg" data-act="finalize" ${ready ? '' : raw('disabled')}>引換券を発券する</button>
      </div>` : ''}
    </section>`;
}

function viewDone() {
  const d = st.done;
  const rec = st.view.recentSessions.find((x) => x.id === d.sessionId);
  const status = rec?.voucher ? { queued: 'WindowsPCで印刷待ち', printing: '印刷中', dispatched: '印刷しました（券が出たか確認してください）', confirmed: '券が出ました', failed: '印刷に失敗しました。再印刷しています', none: '未印刷' }[rec.voucher.printStatus] ?? rec.voucher.printStatus : '';
  return html`<section class="panel done">
    <h2>引換券 ${d.sessionId}</h2>
    <ul class="results">${d.prizes.map((p, i) => html`<li><span class="ord">${i + 1}回目</span><span class="ball ball-${p.color}" aria-hidden="true"></span><b>${p.grade}等</b> ${p.prize}</li>`)}</ul>
    <p class="print-status">${status}</p>
    <p class="muted small">引換券はWindowsPCにつないだプリンター（MP-B20）から出ます。</p>
    <button class="start" data-act="next">次の人へ</button>
  </section>`;
}

function recentVouchers(m) {
  const list = st.view.recentSessions.filter((x) => x.machineId === m.id && x.voucher).slice(0, 4);
  if (!list.length) return '';
  const label = (v) => (v.redeemedAt ? '引換済み' : { queued: '印刷待ち', printing: '印刷中', dispatched: '印刷済み（排紙未確認）', confirmed: '印刷済み', failed: '印刷失敗' }[v.printStatus] ?? v.printStatus);
  return html`<section class="panel"><h2>この台の最近の引換券</h2><ul class="plain">${list.map((x) => html`
    <li class="row"><b>${x.id}</b> ${x.voucher.prizes.map((p) => `${p.grade}等`).join('・')}　${label(x.voucher)}
      ${x.voucher.redeemedAt ? '' : html`<button class="btn btn-small btn-plain" data-reprint="${x.id}">同じ番号で再印刷</button>`}</li>`)}</ul></section>`;
}

// ---------- actions ----------
function bind() {
  const m = machine();
  $('#assist')?.addEventListener('change', async (e) => {
    const out = await command({ type: 'setCameraAssist', machineId: m.id, enabled: e.target.checked });
    if (!out) e.target.checked = !e.target.checked;
  });
  for (const b of $$('[data-cell]')) {
    b.addEventListener('click', () => {
      const i = Number(b.dataset.cell);
      st.readMarks[i] = st.readMarks[i] !== true;
      draw();
    });
  }
  for (const b of $$('[data-count]')) {
    b.addEventListener('click', async () => {
      if (!$('#corner').checked) { toast('「抽選確認」の角を確かめてチェックしてください', { kind: 'error' }); return; }
      const n = Number(b.dataset.count);
      if (!window.confirm(`紙カードで ${n}回 まわします。よろしいですか？`)) return;
      await accept({ kind: 'paper', declaredDraws: n, cornerPresent: true });
    });
  }
  for (const b of $$('[data-ball]')) b.addEventListener('click', () => ball(b.dataset.ball));
  for (const b of $$('[data-hint]')) b.addEventListener('click', () => { st.usedHints.add(b.dataset.hint); ball(b.dataset.color); });
  for (const b of $$('[data-skip]')) b.addEventListener('click', () => { st.usedHints.add(b.dataset.skip); draw(); });
  for (const b of $$('[data-reprint]')) {
    b.addEventListener('click', async () => {
      const reason = window.prompt('再印刷の理由（例：紙が出なかった）');
      if (!reason || reason.trim().length < 2) return;
      if (await command({ type: 'requestReprint', sessionId: b.dataset.reprint, reason })) toast('同じ番号で再印刷します', { kind: 'ok' });
    });
  }
  for (const b of $$('[data-act]')) b.addEventListener('click', () => act(b.dataset.act, b));
}

async function ball(color) {
  const m = machine();
  const s = m?.activeSession;
  if (!s || st.busy) return;
  st.busy = true;
  try {
    await sendWithRetry('/api/staff/commands', { operationId: operationId(), type: 'manualBall', machineId: m.id, sessionId: s.id, color });
  } catch (error) {
    showError(error);
  } finally {
    st.busy = false;
  }
}

async function act(name, el) {
  const m = machine();
  switch (name) {
    case 'start': st.step = 'count'; draw(); break;
    case 'back': st.step = 'home'; draw(); break;
    case 'next': st.done = null; st.step = 'home'; draw(); break;
    case 'scanDigital': {
      const text = await scanQr({ title: '受付用QRを読む', hint: '来場者のスマホの受付用QRを枠に入れてください' });
      if (!text) return;
      try {
        const info = await postJson('/api/staff/cards/lookup', { payload: text });
        if (info.used) { toast(`このカードは受付済みです（${info.usedSessionId ?? ''}）`, { kind: 'error', ms: 6000 }); return; }
        if (info.draws === 0) { toast('ラインがそろっていないため抽選できません', { kind: 'error' }); return; }
        if (!window.confirm(`デジタルカード：${info.lines}ライン → ${info.draws}回 まわします。よろしいですか？`)) return;
        await accept({ kind: 'digital', payload: text });
      } catch (error) { showError(error); }
      break;
    }
    case 'acceptDigitalRead': await accept({ kind: 'digital', readId: m.device.pendingRead.readId }); break;
    case 'acceptPaperRead': {
      const read = m.device.pendingRead;
      const changed = st.readMarks.some((x, i) => x !== read.cells[i]);
      const body = { kind: 'paper', readId: read.readId, marks: st.readMarks, cornerPresent: read.cornerPresent !== false };
      if (changed) body.correctionReason = 'タブレットで実物と照合して修正';
      if (read.cornerPresent === false) {
        const reason = window.prompt('「抽選確認」の角がないカードを受け付ける理由');
        if (!reason || reason.trim().length < 2) return;
        body.cornerPresent = false;
        body.cornerReason = reason;
      }
      await accept(body);
      break;
    }
    case 'dismissRead':
      try { await postJson(`/api/staff/card-reads/${m.device.pendingRead.readId}/dismiss`, { machineId: m.id }); } catch (error) { showError(error); }
      break;
    case 'undo':
      if (!window.confirm('直前に入力した色を取り消します')) return;
      await command({ type: 'removeManualBall', machineId: m.id, sessionId: m.activeSession.id, ballId: el.dataset.id, reason: 'タブレットで入力を取り消し' });
      break;
    case 'finalize': {
      if (!$('#tray').checked) { toast('受け皿の玉を回収してチェックしてください', { kind: 'error' }); return; }
      const out = await command({ type: 'finalizeResult', machineId: m.id, sessionId: m.activeSession.id, trayEmptied: true });
      if (out) { st.done = { sessionId: out.result.sessionId, prizes: out.result.prizes }; draw(); }
      break;
    }
    case 'emergencyStop': {
      const reason = window.prompt('緊急停止の理由（任意）') ?? null;
      if (reason === null) return;
      await command({ type: 'emergencyStop', machineId: m.id, reason });
      break;
    }
    case 'clearEmergency': {
      const reason = window.prompt('停止を解除する理由');
      if (!reason || reason.trim().length < 2) return;
      await command({ type: 'clearEmergency', machineId: m.id, reason });
      break;
    }
    case 'resumeDrawing': await command({ type: 'resumeDrawing', machineId: m.id }); break;
    default: break;
  }
}

document.addEventListener('keydown', (e) => {
  // Hardware keyboard shortcut: 1-4 enter red / green / lightblue / white while drawing.
  if (!machine()?.activeSession || e.target.closest?.('input, textarea, select')) return;
  const i = Number(e.key) - 1;
  if (i >= 0 && i < COLORS.length) ball(COLORS[i]);
});

boot();
