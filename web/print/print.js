import { getJson, operationId, postJson, sendWithRetry } from '../shared/api.js';
import { $, $$, COLOR_LABELS, fmtDateTime, fmtTime, html, render, toast } from '../shared/html.js';
import { openStream } from '../shared/stream.js';

// Print station. The voucher printer is an SII MP-B20 (58 mm, USB/Bluetooth,
// no Wi-Fi). Browser printing reaches it only through the Windows printer
// driver, so the Windows PC (Chrome with --kiosk-printing) is the print
// station. On the iPad and Pixel tablet auto-print is off, because iOS/Android
// standard printing is not known to reach this printer and an auto-claimed
// job would be lost; manual printing stays available for real-device tests.
// TODO(DECISION-printer): SII URL Print Agent / Web SDK Server integration
// needs SII's API guide.
// Each device chooses which machine's vouchers it prints. Before printing, the device claims the
// job on the server, so two devices never print the same job.
// "印刷指示済み" only means window.print() returned; a person still confirms
// the paper came out (§15 C13).

const st = { me: null, jobs: [], busy: false, printed: new Set() };

function pref(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}
function setPref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable */ }
}
try {
  for (const id of JSON.parse(sessionStorage.getItem('mb-printed') ?? '[]')) st.printed.add(id);
} catch { /* storage unavailable */ }

const auto = () => !mobileOs && pref('mb-auto', '0') === '1';
const station = () => pref('mb-station', '');
function target() {
  const v = pref('mb-target', '');
  if (v) return v;
  // An operator's device prints its own machine by default; others print all.
  return st.me?.staff.role === 'operator' && st.me.machineId ? st.me.machineId : 'all';
}
// iPadOS reports itself as a Mac, so touch points are checked too.
const mobileOs = /iPhone|iPad|Android/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const mine = (j) => target() === 'all' || j.machineId === target();

async function boot() {
  try { st.me = await getJson('/api/staff/me'); } catch { /* not logged in */ }
  if (!st.me) return login();
  openStream('/api/stream/print', {
    onView: (v) => { st.jobs = v.jobs; draw(); pump(); },
    onStatus: (s) => { $('#conn').textContent = s === 'online' ? '● 接続中' : '● 再接続中…'; $('#conn').className = `conn conn-${s}`; },
  });
}

function login() {
  render($('#app'), html`<form id="login" class="panel stack"><h2>スタッフアカウントでログイン</h2>
    <label for="ln">ログイン名</label><input id="ln" autocomplete="username" autocapitalize="off" required>
    <label for="pw">パスコード</label><input id="pw" type="password" autocomplete="current-password" required>
    <button class="btn">ログイン</button></form>`);
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await postJson('/api/staff/login', { loginName: $('#ln').value, passcode: $('#pw').value }); location.reload(); } catch (error) { toast(error.message, { kind: 'error' }); }
  });
}

function draw() {
  const list = st.jobs.filter(mine);
  const queued = list.filter((j) => j.status === 'queued');
  const printing = list.filter((j) => j.status === 'printing');
  const dispatched = list.filter((j) => j.status === 'dispatched');
  const others = st.jobs.length - list.length;
  render($('#app'), html`
    <section class="panel stack">
      <div class="row">
        <label for="station">この端末の名前</label>
        <input id="station" value="${station()}" placeholder="例：WindowsPC、iPad、Pixel" maxlength="40">
      </div>
      <div class="row">
        <label for="target">この端末で印刷する券</label>
        <select id="target">
          <option value="all" ${target() === 'all' ? 'selected' : ''}>すべての台</option>
          ${st.me.machines.map((m) => html`<option value="${m.id}" ${target() === m.id ? 'selected' : ''}>${m.name}の券だけ</option>`)}
        </select>
        <label class="row"><input type="checkbox" id="auto" ${auto() ? 'checked' : ''} ${mobileOs ? 'disabled' : ''}> 届いたら自動で印刷する</label>
      </div>
      ${station() ? '' : html`<p class="notice">端末の名前を入れてください。別の端末と同じ券を印刷しないよう、印刷を引き受けた端末名を記録します。</p>`}
      ${mobileOs ? html`<p class="notice notice-danger">iPad／Androidタブレットでは自動印刷を止めています。MP-B20 は AirPrint や Android の標準印刷への対応が確認できず、印刷画面にプリンターが出ない可能性が高いためです。通常は WindowsPC の発券画面が印刷します。この端末の「この端末で印刷」は、実機で印刷できることを確かめた場合だけ使ってください。紙が出なかったら「出ない（再印刷）」を押すと、WindowsPC が刷り直します。</p>`
    : html`<p class="muted small">プリンター：SII MP-B20（58mm、印字幅48mm）。Windows の通常使うプリンターを MP-B20 にし、Chrome を --kiosk-printing 付きで起動すると確認画面なしで印刷します。</p>`}
    </section>
    <section class="panel"><h2>印刷待ち（${queued.length}）</h2>
      ${queued.length ? '' : html`<p class="muted">ありません${others ? `（ほかの台の券 ${others} 件は別の端末が担当）` : ''}</p>`}
      ${queued.map((j) => html`<div class="job"><span class="vno">${j.sessionId}</span><span>${j.machineName}</span><span>${j.kind === 'reprint' ? '再印刷' : ''}</span>
        <button class="btn btn-small" data-print="${j.jobId}" ${station() ? '' : 'disabled'}>この端末で印刷</button></div>`)}
    </section>
    ${printing.length ? html`<section class="panel"><h2>印刷中（${printing.length}）</h2>
      <p class="muted">担当の端末が印刷しています。端末を閉じてしまった場合は、スタッフ画面の「同じ番号で再印刷」を使ってください。</p>
      ${printing.map((j) => html`<div class="job"><span class="vno">${j.sessionId}</span><span>${j.machineName}</span><span>担当：${j.station ?? '不明'} ${fmtTime(j.updatedAt)}</span></div>`)}
    </section>` : ''}
    <section class="panel"><h2>排紙の確認待ち（${dispatched.length}）</h2>
      <p class="muted">プリンターから券が出たか目で確認して押してください。</p>
      ${dispatched.map((j) => html`<div class="job"><span class="vno">${j.sessionId}</span><span>${j.machineName} ${j.station ?? ''} ${fmtTime(j.updatedAt)}</span>
        <button class="btn btn-ok btn-small" data-ok="${j.jobId}" data-s="${j.sessionId}">券が出た</button>
        <button class="btn btn-danger btn-small" data-ng="${j.jobId}" data-s="${j.sessionId}">出ない・汚れ（再印刷）</button></div>`)}
    </section>`);
  $('#station').addEventListener('change', (e) => { setPref('mb-station', e.target.value.trim()); draw(); pump(); });
  $('#target').addEventListener('change', (e) => { setPref('mb-target', e.target.value); draw(); pump(); });
  $('#auto').addEventListener('change', (e) => { setPref('mb-auto', e.target.checked ? '1' : '0'); pump(); });
  for (const b of $$('[data-print]')) b.addEventListener('click', () => printJob(st.jobs.find((j) => j.jobId === b.dataset.print)));
  for (const b of $$('[data-ok]')) b.addEventListener('click', () => report(b.dataset.s, b.dataset.ok, 'confirmed'));
  for (const b of $$('[data-ng]')) b.addEventListener('click', () => report(b.dataset.s, b.dataset.ng, 'failed'));
}

async function report(sessionId, jobId, outcome, extra = {}) {
  try {
    await sendWithRetry('/api/staff/commands', { operationId: operationId(), type: 'recordPrintResult', sessionId, jobId, outcome, ...extra });
    return true;
  } catch (error) {
    // Losing a claim to another device is normal when several devices run auto-print.
    if (error.code !== 'JOB_ALREADY_CLAIMED') toast(error.message, { kind: 'error', ms: 6000 });
    return false;
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

async function printJob(j) {
  if (!j || st.busy || !station()) return;
  if (st.printed.has(j.jobId)) return;
  st.busy = true;
  try {
    // Claim first: if another device already took it, the server says so and we stop.
    if (!(await report(j.sessionId, j.jobId, 'claimed', { station: station() }))) return;
    const box = $('#receipt');
    render(box, receipt(j));
    const img = box.querySelector('img');
    await new Promise((resolve) => { if (img.complete) resolve(); else { img.onload = resolve; img.onerror = resolve; } });
    // On iPad / Android the print sheet can return before printing finishes;
    // keep this receipt on screen until the browser reports the print closed,
    // so the next job cannot replace what is being printed.
    await new Promise((resolve) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 120_000);
      window.addEventListener('afterprint', done, { once: true });
      window.print();
    });
    st.printed.add(j.jobId);
    try { sessionStorage.setItem('mb-printed', JSON.stringify([...st.printed])); } catch { /* ignore */ }
    await report(j.sessionId, j.jobId, 'dispatched');
  } finally {
    st.busy = false;
  }
}

async function pump() {
  if (!auto() || st.busy || !station()) return;
  const next = st.jobs.find((j) => j.status === 'queued' && mine(j) && !st.printed.has(j.jobId));
  if (next) {
    await printJob(next);
    setTimeout(pump, 500);
  }
}

boot();
