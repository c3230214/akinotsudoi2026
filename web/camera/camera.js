/* global jsQR */
import { getJson, postJson } from '../shared/api.js';
import { $, $$, COLOR_LABELS, COLORS, html, render, toast } from '../shared/html.js';
import { DEFAULT_BALL_COLORS, cardFeatures, judgeBall, judgeCard, roiBlocks, squareToQuad } from '../shared/vision.js';

// Camera station on the venue Windows PC (Chrome). Three webcams:
//  - card camera: digital card QR (automatic) and paper card scan (button)
//  - one ball camera per machine: colour shown to the tablet as a hint only
// Results go to the machine the operator chooses; the tablet operator confirms.
// Settings and calibration are stored in this browser (localStorage).

const SLOTS = [
  { id: 'card', label: 'カード読取カメラ' },
  { id: 'garagara-1', label: 'ガラガラ1 玉カメラ' },
  { id: 'garagara-2', label: 'ガラガラ2 玉カメラ' },
];
const store = {
  get(k, d) { try { const v = localStorage.getItem(`mbcam-${k}`); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(`mbcam-${k}`, JSON.stringify(v)); } catch { /* ignore */ } },
};
const st = {
  me: null,
  machines: [],
  streams: {},
  canvas: document.createElement('canvas'),
  picking: null, // corner picking: array of points
  detected: null, // { kind, payload?, cells?, cornerPresent?, scores?, image? }
  lastQr: { text: '', at: 0 },
  ball: {}, // per machine: { present, sentAt, absentTicks, presentTicks, last }
  testMode: store.get('test', false),
};
const ctx = st.canvas.getContext('2d', { willReadFrequently: true });

function frame(video) {
  const w = video.videoWidth; const h = video.videoHeight;
  if (!w || !h) return null;
  st.canvas.width = w; st.canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

// ---------- boot ----------
async function boot() {
  try { st.me = await getJson('/api/staff/me'); } catch { /* not signed in */ }
  if (!st.me) return login();
  if (!navigator.mediaDevices?.getUserMedia) {
    render($('#app'), html`<p class="notice notice-danger">このブラウザではカメラを使えません。HTTPSのURLで開いてください（localhost 以外の http ではカメラが使えません）。</p>`);
    return;
  }
  renderShell();
  await listDevices();
  pollState();
  setInterval(pollState, 3000);
  requestAnimationFrame(loop);
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

async function pollState() {
  try {
    const s = await getJson('/api/camera/state');
    st.machines = s.machines;
    $('#state').textContent = s.intakeClosed ? `新規受付終了中（${s.intakeClosed.reason}）` : st.machines.map((m) => `${m.name}：${m.stopped ? '停止中' : m.activeSessionId ? `抽選中 ${m.activeSessionId}` : m.pendingRead ? '確認待ち' : '待機中'}`).join('　');
    renderSend();
  } catch (error) {
    $('#state').textContent = `状態を取得できません：${error.message}`;
  }
}

// ---------- layout ----------
function renderShell() {
  render($('#app'), html`
    <section class="panel">
      <h2>カメラの割り当て</h2>
      <div class="devsel" id="devsel"></div>
      <p class="muted small">3台を同じUSBハブにつなぐと映像が止まることがあります。止まる場合は別々のUSBポートにつないでください。</p>
    </section>
    <div class="layout">
      <section class="panel">
        <h2>カード読取</h2>
        <div class="cam" id="cam-card"><video playsinline muted></video><canvas class="overlay"></canvas><span class="badge">カード</span></div>
        <div class="tools">
          <button class="btn" id="scan-paper">紙カードを読み取る</button>
          <button class="btn btn-plain btn-small" id="pick">カードの四隅を指定</button>
          <button class="btn btn-plain btn-small" id="ref">何も貼っていないカードを登録</button>
          <label><input type="checkbox" id="test" ${st.testMode ? 'checked' : ''}> 判定値を表示（テスト）</label>
        </div>
        <div class="tools">
          <label for="thr">シール判定のしきい値</label><input type="range" id="thr" min="4" max="40" step="1" value="${store.get('thr', 7)}"><span id="thr-v">${store.get('thr', 7)}</span>
          <label for="cthr">角の判定</label><input type="range" id="cthr" min="5" max="60" step="1" value="${store.get('cthr', 22)}"><span id="cthr-v">${store.get('cthr', 22)}</span>
        </div>
        <p class="muted small" id="calib-state"></p>
      </section>
      <section class="panel">
        <h2>読み取り結果 → 台へ送る</h2>
        <p class="muted small">デジタルカードは受付用QRをカメラに向けると自動で読み取ります。紙カードは所定の位置に置いて「紙カードを読み取る」を押してください。どちらの台で抽選するかを選ぶと、その台のタブレットに確認待ちとして表示されます。キーボードの 1 / 2 でも送れます。</p>
        <div id="detected"></div>
        <div class="send" id="send"></div>
        <div id="sent"></div>
      </section>
    </div>
    <section class="panel">
      <h2>玉の色（補助）</h2>
      <p class="muted small">玉の色の認識は精度を検証していないため、記録はしません。認識した色は担当台のタブレットに「候補」として表示され、担当者が確認して記録します。</p>
      <div class="balls">${SLOTS.slice(1).map((s) => html`
        <div>
          <div class="cam" id="cam-${s.id}"><video playsinline muted></video><canvas class="overlay"></canvas><span class="badge">${s.label}</span></div>
          <p class="ballinfo" id="info-${s.id}" role="status"></p>
          <div class="tools">
            <button class="btn btn-plain btn-small" data-bg="${s.id}">背景を登録（玉なし）</button>
            ${COLORS.map((c) => html`<button class="btn btn-plain btn-small" data-color="${c}" data-machine="${s.id}"><span class="ball ball-${c}" aria-hidden="true"></span>${COLOR_LABELS[c]}を登録</button>`)}
            <label><input type="checkbox" data-hint="${s.id}" ${store.get(`hint-${s.id}`, true) ? 'checked' : ''}> タブレットへ候補を送る</label>
          </div>
        </div>`)}
      </div>
    </section>`);
  $('#scan-paper').addEventListener('click', scanPaper);
  $('#pick').addEventListener('click', () => { st.picking = []; $('#cam-card').classList.add('picking'); toast('カードの左上、右上、右下、左下の順にクリックしてください', { ms: 6000 }); });
  $('#ref').addEventListener('click', registerReference);
  $('#test').addEventListener('change', (e) => { st.testMode = e.target.checked; store.set('test', st.testMode); });
  for (const id of ['thr', 'cthr']) {
    $(`#${id}`).addEventListener('input', (e) => { $(`#${id}-v`).textContent = e.target.value; store.set(id, Number(e.target.value)); });
  }
  $('#cam-card').addEventListener('click', pickCorner);
  for (const b of $$('[data-bg]')) b.addEventListener('click', () => registerBackground(b.dataset.bg));
  for (const b of $$('[data-color]')) b.addEventListener('click', () => registerColor(b.dataset.machine, b.dataset.color));
  for (const c of $$('[data-hint]')) c.addEventListener('change', (e) => store.set(`hint-${c.dataset.hint}`, e.target.checked));
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const m = st.machines[Number(e.key) - 1];
    if (m && st.detected) send(m.id);
  });
  updateCalibState();
}

async function listDevices() {
  try {
    const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
    tmp.getTracks().forEach((t) => t.stop());
  } catch {
    toast('カメラの使用が許可されていません', { kind: 'error' });
  }
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  render($('#devsel'), html`${SLOTS.map((s) => html`<label for="dev-${s.id}">${s.label}</label>
    <select id="dev-${s.id}"><option value="">使わない</option>${devices.map((d, i) => html`<option value="${d.deviceId}" ${store.get(`dev-${s.id}`, '') === d.deviceId ? 'selected' : ''}>${d.label || `カメラ ${i + 1}`}</option>`)}</select>`)}`);
  for (const s of SLOTS) {
    $(`#dev-${s.id}`).addEventListener('change', (e) => { store.set(`dev-${s.id}`, e.target.value); startSlot(s.id); });
    startSlot(s.id);
  }
}

async function startSlot(slot) {
  st.streams[slot]?.getTracks().forEach((t) => t.stop());
  delete st.streams[slot];
  const deviceId = store.get(`dev-${slot}`, '');
  const video = $(`#cam-${slot} video`);
  if (!deviceId) { video.srcObject = null; return; }
  try {
    // Modest resolution keeps three USB cameras within the bus bandwidth.
    const stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal: slot === 'card' ? 1280 : 640 }, height: { ideal: slot === 'card' ? 720 : 480 }, frameRate: { ideal: 15 } }, audio: false });
    st.streams[slot] = stream;
    video.srcObject = stream;
    await video.play();
  } catch (error) {
    const label = SLOTS.find((x) => x.id === slot)?.label ?? slot;
    if (error.name === 'OverconstrainedError' || error.name === 'NotFoundError') {
      // The saved camera is no longer attached (or its id changed): ask to choose again.
      store.set(`dev-${slot}`, '');
      $(`#dev-${slot}`).value = '';
      toast(`${label}：保存していたカメラが見つかりません。選び直してください`, { kind: 'error', ms: 6000 });
    } else {
      toast(`${label}：カメラを起動できません（${error.name}）。他のアプリがカメラを使っていないか確認してください`, { kind: 'error', ms: 6000 });
    }
  }
}

// ---------- card: calibration ----------
function updateCalibState() {
  const corners = store.get('corners', null);
  const ref = store.get('ref', null);
  $('#calib-state').textContent = `四隅：${corners ? '指定済み' : '未指定'}　空カード：${ref ? '登録済み' : '未登録'}${corners && ref ? '' : '（紙カードの読取には両方が必要です）'}`;
}

function videoPoint(e, video) {
  const r = video.getBoundingClientRect();
  const vw = video.videoWidth; const vh = video.videoHeight;
  const scale = Math.min(r.width / vw, r.height / vh);
  const ox = (r.width - vw * scale) / 2; const oy = (r.height - vh * scale) / 2;
  return [(e.clientX - r.left - ox) / scale, (e.clientY - r.top - oy) / scale];
}

function pickCorner(e) {
  if (!st.picking) return;
  const video = $('#cam-card video');
  st.picking.push(videoPoint(e, video));
  if (st.picking.length === 4) {
    store.set('corners', st.picking);
    st.picking = null;
    $('#cam-card').classList.remove('picking');
    toast('四隅を保存しました。何も貼っていないカードを置いて「登録」を押してください', { kind: 'ok', ms: 6000 });
    updateCalibState();
  }
}

function registerReference() {
  const corners = store.get('corners', null);
  if (!corners) { toast('先に四隅を指定してください', { kind: 'error' }); return; }
  const img = frame($('#cam-card video'));
  if (!img) { toast('カードカメラの映像がありません', { kind: 'error' }); return; }
  store.set('ref', cardFeatures(img, corners));
  toast('何も貼っていないカードを登録しました', { kind: 'ok' });
  updateCalibState();
}

function warpedImage(img, corners) {
  const map = squareToQuad(corners);
  const W = 360; const H = 510;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const o = out.getContext('2d');
  const dst = o.createImageData(W, H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const [sx, sy] = map((x + 0.5) / W, (y + 0.5) / H);
      const xi = Math.min(img.width - 1, Math.max(0, Math.round(sx)));
      const yi = Math.min(img.height - 1, Math.max(0, Math.round(sy)));
      const si = (yi * img.width + xi) * 4; const di = (y * W + x) * 4;
      dst.data[di] = img.data[si]; dst.data[di + 1] = img.data[si + 1]; dst.data[di + 2] = img.data[si + 2]; dst.data[di + 3] = 255;
    }
  }
  o.putImageData(dst, 0, 0);
  return out.toDataURL('image/jpeg', 0.75);
}

function scanPaper() {
  const corners = store.get('corners', null);
  const ref = store.get('ref', null);
  if (!corners || !ref) { toast('四隅の指定と空カードの登録が必要です', { kind: 'error' }); return; }
  const img = frame($('#cam-card video'));
  if (!img) { toast('カードカメラの映像がありません', { kind: 'error' }); return; }
  const out = judgeCard(cardFeatures(img, corners), ref, { threshold: store.get('thr', 7), cornerThreshold: store.get('cthr', 22) });
  st.detected = { kind: 'paper', cells: out.cells, cornerPresent: out.cornerPresent, scores: out.scores, cornerScore: out.cornerScore, image: warpedImage(img, corners) };
  renderDetected();
}

// ---------- card: QR ----------
function scanQrFrame() {
  const video = $('#cam-card video');
  if (!video || video.readyState < 2) return;
  const w = video.videoWidth; const h = video.videoHeight;
  const scale = Math.min(1, 800 / w);
  st.canvas.width = Math.round(w * scale); st.canvas.height = Math.round(h * scale);
  ctx.drawImage(video, 0, 0, st.canvas.width, st.canvas.height);
  const img = ctx.getImageData(0, 0, st.canvas.width, st.canvas.height);
  const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
  if (!code?.data?.startsWith('MARUGOTO2026:CARD:')) return;
  const now = Date.now();
  if (code.data === st.lastQr.text && now - st.lastQr.at < 15_000) return;
  st.lastQr = { text: code.data, at: now };
  st.detected = { kind: 'digital', payload: code.data, cardId: code.data.split(':')[2] };
  navigator.vibrate?.(50);
  renderDetected();
}

// ---------- send ----------
function suggestion() {
  const idle = st.machines.filter((m) => !m.stopped && !m.activeSessionId && !m.pendingRead);
  return idle[0]?.id ?? null;
}

function renderDetected() {
  if (!$('#detected')) return;
  const d = st.detected;
  if (!d) { render($('#detected'), html`<p class="muted">カードを待っています…</p>`); renderSend(); return; }
  if (d.kind === 'digital') {
    render($('#detected'), html`<div class="result"><strong>デジタルカードを検出</strong>（カード番号 ${d.cardId}）<br><span class="muted small">送ると、ライン数と抽選回数がタブレットに表示されます。</span></div>`);
  } else {
    const unsure = d.cells.filter((c) => c === null).length;
    render($('#detected'), html`<div class="result">
      <strong>紙カード</strong>　角：${d.cornerPresent === false ? '切られている可能性' : d.cornerPresent === true ? 'あり' : '判定できず'}${st.testMode && d.cornerScore !== null ? `（${d.cornerScore.toFixed(1)}）` : ''}
      ${unsure ? html`<br><span class="warn-text">判定できないマスが ${unsure} 個あります。タブレットで確認してください</span>` : ''}
      <div class="mini-grid">${d.cells.map((c, i) => html`<span class="${c === true ? 'on' : c === null ? 'unsure' : ''}">${'①②③④⑤⑥⑦⑧⑨'[i]} ${c === true ? '○' : c === null ? '？' : '－'}${st.testMode ? html`<small>${d.scores[i].toFixed(1)}</small>` : ''}</span>`)}</div>
    </div>`);
  }
  renderSend();
}

function renderSend() {
  if (!$('#send')) return;
  const sug = suggestion();
  render($('#send'), html`${st.machines.map((m, i) => html`<button class="btn ${m.id === sug ? 'suggest' : 'btn-secondary'}" data-send="${m.id}" ${st.detected ? '' : 'disabled'}>${i + 1}：${m.name}へ送る${m.activeSessionId ? '（抽選中）' : m.pendingRead ? '（確認待ちあり）' : ''}</button>`)}`);
  for (const b of $$('[data-send]')) b.addEventListener('click', () => send(b.dataset.send));
}

async function send(machineId) {
  const d = st.detected;
  if (!d) return;
  const body = d.kind === 'digital' ? { machineId, kind: 'digital', qrPayload: d.payload } : { machineId, kind: 'paper', cells: d.cells, cornerPresent: d.cornerPresent, image: d.image };
  try {
    const out = await postJson('/api/camera/card-read', body);
    const m = st.machines.find((x) => x.id === machineId);
    render($('#sent'), html`<div class="result ok"><strong>${m?.name ?? machineId}へ送りました</strong>：${out.preview.lines}ライン → ガラガラ <strong>${out.preview.draws}回</strong>${out.preview.unsure ? `（要確認 ${out.preview.unsure}マス）` : ''}。タブレットで確認して受付してください。</div>`);
    st.detected = null;
    renderDetected();
    pollState();
  } catch (error) {
    render($('#sent'), html`<div class="result err">${error.message}</div>`);
  }
}

// ---------- balls ----------
const roiOf = (machineId) => store.get(`roi-${machineId}`, { x: 0.3, y: 0.3, w: 0.4, h: 0.4 });

function registerBackground(machineId) {
  const img = frame($(`#cam-${machineId} video`));
  if (!img) { toast('映像がありません', { kind: 'error' }); return; }
  store.set(`bg-${machineId}`, roiBlocks(img, roiOf(machineId)));
  toast('背景（玉なし）を登録しました', { kind: 'ok' });
}

function registerColor(machineId, color) {
  const img = frame($(`#cam-${machineId} video`));
  const bg = store.get(`bg-${machineId}`, null);
  if (!img || !bg) { toast('先に背景を登録してください', { kind: 'error' }); return; }
  const r = judgeBall(roiBlocks(img, roiOf(machineId)), bg, DEFAULT_BALL_COLORS);
  if (!r.present) { toast('枠の中に玉が見つかりません', { kind: 'error' }); return; }
  const palette = store.get(`pal-${machineId}`, { ...DEFAULT_BALL_COLORS });
  palette[color] = r.mean;
  store.set(`pal-${machineId}`, palette);
  toast(`${COLOR_LABELS[color]}を登録しました（${r.mean.join(', ')}）`, { kind: 'ok' });
}

function checkBall(machineId) {
  const video = $(`#cam-${machineId} video`);
  const bg = store.get(`bg-${machineId}`, null);
  const info = $(`#info-${machineId}`);
  if (!video || video.readyState < 2) return;
  if (!bg) { info.textContent = '背景を登録してください'; return; }
  const img = frame(video);
  const r = judgeBall(roiBlocks(img, roiOf(machineId)), bg, store.get(`pal-${machineId}`, DEFAULT_BALL_COLORS));
  const b = (st.ball[machineId] ??= { present: false, presentTicks: 0, absentTicks: 0 });
  if (r.present) { b.presentTicks += 1; b.absentTicks = 0; } else { b.absentTicks += 1; b.presentTicks = 0; }
  info.textContent = r.present ? `認識：${r.color ? COLOR_LABELS[r.color] : '判定できず'}（${r.best ? COLOR_LABELS[r.best] : ''} 信頼度 ${r.confidence}）` : '玉なし';
  // One hint per ball: when it has been seen for 3 checks, then wait until the tray is empty again.
  if (!b.present && b.presentTicks >= 3) {
    b.present = true;
    if (store.get(`hint-${machineId}`, true)) {
      postJson('/api/camera/hint', { machineId, color: r.color, confidence: r.confidence }).catch((error) => { info.textContent += `（送信失敗：${error.message}）`; });
    }
  }
  if (b.present && b.absentTicks >= 3) b.present = false;
}

// ---------- overlays ----------
function drawOverlay(slot) {
  const box = $(`#cam-${slot}`);
  const video = box?.querySelector('video');
  const c = box?.querySelector('canvas');
  if (!video || !c || !video.videoWidth) return;
  const r = box.getBoundingClientRect();
  c.width = r.width; c.height = r.height;
  const g = c.getContext('2d');
  const scale = Math.min(r.width / video.videoWidth, r.height / video.videoHeight);
  const ox = (r.width - video.videoWidth * scale) / 2; const oy = (r.height - video.videoHeight * scale) / 2;
  const P = ([x, y]) => [ox + x * scale, oy + y * scale];
  g.clearRect(0, 0, c.width, c.height);
  g.lineWidth = 2;
  if (slot === 'card') {
    const corners = st.picking ?? store.get('corners', null);
    if (corners?.length) {
      g.strokeStyle = '#ffd166';
      g.beginPath();
      corners.forEach((p, i) => { const [x, y] = P(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      if (corners.length === 4) g.closePath();
      g.stroke();
      if (corners.length === 4 && !st.picking) {
        const map = squareToQuad(corners);
        g.strokeStyle = 'rgba(80, 200, 255, .8)';
        for (const u of [95 / 1200, 431 / 1200, 751 / 1200, 1088 / 1200]) { g.beginPath(); g.moveTo(...P(map(u, 593 / 1700))); g.lineTo(...P(map(u, 1554 / 1700))); g.stroke(); }
        for (const v of [593 / 1700, 913 / 1700, 1233 / 1700, 1554 / 1700]) { g.beginPath(); g.moveTo(...P(map(95 / 1200, v))); g.lineTo(...P(map(1088 / 1200, v))); g.stroke(); }
      }
    }
  } else {
    const roi = roiOf(slot);
    g.strokeStyle = st.ball[slot]?.present ? '#06d6a0' : '#ffd166';
    g.strokeRect(...P([roi.x * video.videoWidth, roi.y * video.videoHeight]), roi.w * video.videoWidth * scale, roi.h * video.videoHeight * scale);
  }
}

let tick = 0;
function loop() {
  tick += 1;
  if (tick % 10 === 0) scanQrFrame();
  if (tick % 9 === 0) { checkBall('garagara-1'); checkBall('garagara-2'); }
  if (tick % 3 === 0) SLOTS.forEach((s) => drawOverlay(s.id));
  requestAnimationFrame(loop);
}

boot().then(() => renderDetected());
