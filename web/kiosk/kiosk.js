import { getJson, postJson } from '../shared/api.js';
import { $, html, render, toast } from '../shared/html.js';
import { openStream } from '../shared/stream.js';

// Kiosk iPad beside one machine. Everything is shown as text and big
// numbers, so it works with the sound off (test 14). Sound is opt-in.

let soundOn = false;
let audio = null;
let lastCount = 0;

function chime() {
  if (!soundOn) return;
  audio ??= new AudioContext();
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.2, audio.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.4);
  o.connect(g).connect(audio.destination);
  o.start();
  o.stop(audio.currentTime + 0.4);
}

function draw(v) {
  if (v.balls.length > lastCount) chime();
  lastCount = v.balls.length;
  const app = $('#app');
  app.className = v.stopped ? 'k-stopped' : '';
  render(app, html`
    <header class="k-head"><h1>まるごと体験ビンゴ</h1><span class="k-machine">${v.machineName}</span></header>
    <section class="k-main">
      <p class="k-instruction">${v.instruction}</p>
      ${v.remaining > 0 ? html`<p class="k-remaining">${v.remaining}<small> 回</small></p>` : ''}
      ${v.balls.length ? html`<ol class="k-balls">${v.balls.map((b) => html`<li><span class="ball ball-${b.color ?? 'null'}" aria-hidden="true"></span>${b.order}個目 ${b.colorLabel}<span class="kind">${b.kind === 'valid' ? '当たり' : b.kind === 'excess' ? '回数外' : '確認中'}</span></li>`)}</ol>` : ''}
    </section>
    <footer class="k-grades">${v.grades.map((g) => html`<div class="k-grade ${g.soldOut ? 'sold' : ''}"><span class="ball ball-${g.color}" aria-hidden="true"></span> ${g.grade}等 ${g.colorLabel}<br>${g.prize}${g.soldOut ? html`<br>（終了）` : ''}</div>`)}</footer>`);
}

function pairForm() {
  render($('#app'), html`<form id="pair" class="panel pair stack"><h1>案内iPadの登録</h1>
    <p>管理者が発行した8文字の登録コードを入力してください（1回限り・10分有効）。</p>
    <input id="code" autocapitalize="characters" autocomplete="off" maxlength="12" required>
    <button class="btn">登録</button></form>`);
  $('#pair').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await postJson('/api/kiosk/pair', { code: $('#code').value }); location.reload(); } catch (error) { toast(error.message, { kind: 'error' }); }
  });
}

$('#sound').addEventListener('click', (e) => {
  soundOn = !soundOn;
  e.target.setAttribute('aria-pressed', String(soundOn));
  e.target.textContent = soundOn ? '音：あり' : '音：なし';
  if (soundOn) { audio ??= new AudioContext(); audio.resume(); }
});

try {
  draw(await getJson('/api/kiosk/view'));
  openStream('/api/stream/kiosk', { onView: draw });
} catch (error) {
  if (error.status === 401) pairForm();
  else toast(error.message, { kind: 'error' });
}
