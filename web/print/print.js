import { getJson, operationId, postJson, sendWithRetry } from '../shared/api.js';
import { $, $$, COLOR_LABELS, fmtDateTime, fmtTime, html, render, toast } from '../shared/html.js';
import { openStream } from '../shared/stream.js';

// Print station for the venue PC (Chrome started with --kiosk-printing).
// "印刷指示済み" only means window.print() returned; a person still confirms
// the paper came out (§15 C13). Jobs are printed one at a time.

const st = { jobs: [], auto: true, busy: false, printed: new Set() };
try {
  st.auto = localStorage.getItem('mb-auto') !== '0';
  for (const id of JSON.parse(sessionStorage.getItem('mb-printed') ?? '[]')) st.printed.add(id);
} catch { /* storage unavailable */ }

function paper() {
  let w = '58';
  try { w = localStorage.getItem('mb-paper') ?? '58'; } catch { /* default */ }
  return w === '80' ? '80' : '58';
}
function applyPaper() { $('#paper-css').href = `/print/paper-${paper()}.css`; }

async function boot() {
  let me = null;
  try { me = await getJson('/api/staff/me'); } catch { /* not logged in */ }
  if (!me) return login();
  applyPaper();
  openStream('/api/stream/print', {
    onView: (v) => { st.jobs = v.jobs; draw(); pump(); },
    onStatus: (s) => { $('#conn').textContent = s === 'online' ? '● 接続中' : '● 再接続中…'; $('#conn').className = `conn conn-${s}`; },
  });
}

function login() {
  render($('#app'), html`<form id="login" class="panel stack"><h2>発券アカウントでログイン</h2>
    <label for="ln">ログイン名</label><input id="ln" autocomplete="username" required>
    <label for="pw">パスコード</label><input id="pw" type="password" autocomplete="current-password" required>
    <button class="btn">ログイン</button></form>`);
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await postJson('/api/staff/login', { loginName: $('#ln').value, passcode: $('#pw').value }); location.reload(); } catch (error) { toast(error.message, { kind: 'error' }); }
  });
}

function draw() {
  const queued = st.jobs.filter((j) => j.status === 'queued');
  const dispatched = st.jobs.filter((j) => j.status === 'dispatched');
  render($('#app'), html`
    <section class="panel row">
      <label class="row"><input type="checkbox" id="auto" ${st.auto ? 'checked' : ''}> 自動で印刷する</label>
      <label class="row">用紙幅
        <select id="paper"><option value="58" ${paper() === '58' ? 'selected' : ''}>58mm</option><option value="80" ${paper() === '80' ? 'selected' : ''}>80mm</option></select></label>
      <span class="muted">プリンター機種・用紙幅は未確定です。実機で確認してください。</span>
    </section>
    <section class="panel"><h2>印刷待ち（${queued.length}）</h2>
      ${queued.length ? '' : html`<p class="muted">ありません</p>`}
      ${queued.map((j) => html`<div class="job"><span class="vno">${j.sessionId}</span><span>${j.machineName}</span><span>${j.kind === 'reprint' ? '再印刷' : ''}</span>
        <button class="btn btn-small" data-print="${j.jobId}">今すぐ印刷</button></div>`)}
    </section>
    <section class="panel"><h2>排紙の確認待ち（${dispatched.length}）</h2>
      <p class="muted">プリンターから券が出たか目で確認して押してください。</p>
      ${dispatched.map((j) => html`<div class="job"><span class="vno">${j.sessionId}</span><span>${j.machineName} ${fmtTime(j.updatedAt)}</span>
        <button class="btn btn-ok btn-small" data-ok="${j.jobId}" data-s="${j.sessionId}">券が出た</button>
        <button class="btn btn-danger btn-small" data-ng="${j.jobId}" data-s="${j.sessionId}">出ない・汚れ（再印刷）</button></div>`)}
    </section>`);
  $('#auto').addEventListener('change', (e) => { st.auto = e.target.checked; try { localStorage.setItem('mb-auto', st.auto ? '1' : '0'); } catch { /* ignore */ } pump(); });
  $('#paper').addEventListener('change', (e) => { try { localStorage.setItem('mb-paper', e.target.value); } catch { /* ignore */ } applyPaper(); });
  for (const b of $$('[data-print]')) b.addEventListener('click', () => printJob(st.jobs.find((j) => j.jobId === b.dataset.print), { manual: true }));
  for (const b of $$('[data-ok]')) b.addEventListener('click', () => report(b.dataset.s, b.dataset.ok, 'confirmed'));
  for (const b of $$('[data-ng]')) b.addEventListener('click', () => report(b.dataset.s, b.dataset.ng, 'failed'));
}

async function report(sessionId, jobId, outcome) {
  try {
    await sendWithRetry('/api/staff/commands', { operationId: operationId(), type: 'recordPrintResult', sessionId, jobId, outcome });
  } catch (error) {
    toast(error.message, { kind: 'error' });
  }
}

function receipt(j) {
  return html`
    <p class="r-title">${j.eventName}</p>
    <p class="r-label">景品引換券</p>
    <p class="r-no">${j.sessionId}</p>
    <ul class="r-prizes">${j.prizes.map((p) => html`<li>${p.grade}等（${COLOR_LABELS[p.color]}）${p.prize}</li>`)}</ul>
    <img class="r-qr" alt="" src="/api/staff/vouchers/${j.sessionId}/qr.svg">
    <p class="r-meta">${j.machineName}　${fmtDateTime(j.finalizedAt)}${j.kind === 'reprint' ? '　再発行' : ''}</p>
    <p class="r-note">景品交換所でこの券をお渡しください。景品交換は15:00まで。</p>`;
}

async function printJob(j, { manual = false } = {}) {
  if (!j || st.busy) return;
  if (!manual && st.printed.has(j.jobId)) return;
  st.busy = true;
  try {
    const box = $('#receipt');
    render(box, receipt(j));
    const img = box.querySelector('img');
    await new Promise((resolve) => { if (img.complete) resolve(); else { img.onload = resolve; img.onerror = resolve; } });
    window.print();
    st.printed.add(j.jobId);
    try { sessionStorage.setItem('mb-printed', JSON.stringify([...st.printed])); } catch { /* ignore */ }
    await report(j.sessionId, j.jobId, 'dispatched');
  } finally {
    st.busy = false;
  }
}

async function pump() {
  if (!st.auto || st.busy) return;
  const next = st.jobs.find((j) => j.status === 'queued' && !st.printed.has(j.jobId));
  if (next) {
    await printJob(next);
    setTimeout(pump, 500);
  }
}

boot();
