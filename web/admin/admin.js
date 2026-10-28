import { api, getJson, operationId } from '../shared/api.js';
import { $, COLOR_LABELS, COLORS, fmtDateTime, fmtTime, html, render, toast } from '../shared/html.js';

// Basic-auth administrator panel: quantities, logs and the switch that
// closes new intake when prizes run out. The browser sends the Basic
// credentials with every request, so no extra login handling is needed here.

const st = { data: null, logs: [], next: null, busy: false };
const ball = (c) => html`<span class="ball ball-${c}" aria-hidden="true"></span>`;
const PRINT = { none: '未印刷', queued: '印刷待ち', printing: '印刷中', dispatched: '印刷指示済み', confirmed: '排紙確認済み', failed: '印刷失敗' };

async function load() {
  try {
    st.data = await getJson('/api/panel/summary');
    $('#updated').textContent = `${fmtTime(st.data.now)} 更新`;
    draw();
  } catch (error) {
    $('#updated').textContent = `更新できません：${error.message}`;
  }
}

async function loadLogs(more = false) {
  try {
    const page = await getJson(`/api/panel/logs?limit=50${more && st.next ? `&before=${st.next}` : ''}`);
    st.logs = more ? [...st.logs, ...page.rows] : page.rows;
    st.next = page.rows.length === 50 ? page.next : null;
    draw();
  } catch (error) {
    toast(error.message, { kind: 'error' });
  }
}

async function setIntake(closed) {
  const reason = closed ? ($('#reason').value.trim() || '景品がなくなったため') : undefined;
  const text = closed
    ? `「${reason}新規受付終了」にします。両方のガラガラで新しい受付ができなくなり、来場者の画面に案内が出ます。よろしいですか？`
    : '新規受付を再開します。よろしいですか？';
  if (!window.confirm(text) || st.busy) return;
  st.busy = true;
  try {
    const out = await api('POST', '/api/panel/intake', { operationId: operationId(), closed, ...(reason ? { reason } : {}) });
    toast(out.message, { kind: 'ok' });
    await load();
    await loadLogs();
  } catch (error) {
    toast(error.message, { kind: 'error', ms: 6000 });
  } finally {
    st.busy = false;
  }
}

function draw() {
  const d = st.data;
  if (!d) return;
  const closed = d.intakeClosed?.closed;
  const cards = Object.fromEntries(d.cards.map((c) => [c.kind, c]));
  render($('#app'), html`
    <section class="panel intake ${closed ? 'is-closed' : 'is-open'}">
      <h2>新規受付</h2>
      ${closed ? html`
        <p class="state">新規受付終了中（${d.intakeClosed.reason}）</p>
        <p class="muted small">${fmtDateTime(d.intakeClosed.at)} ${d.intakeClosed.by ?? ''}。進行中の抽選の確定、印刷、景品引換は続けられます。</p>
        <button class="btn btn-ok" id="reopen">新規受付を再開する</button>`
    : html`
        <p class="state">受付中</p>
        <label for="reason">理由（来場者の画面に表示）</label>
        <input id="reason" class="wide" value="景品がなくなったため" maxlength="100">
        <p class="muted small">押すと両方のガラガラで新しい受付を止め、来場者のスマホに「新規受付終了」の案内を出します。進行中の抽選と景品引換は止まりません。</p>
        <button class="btn btn-danger" id="close">新規受付を終了する</button>`}
    </section>

    <section class="panel"><h2>集計</h2>
      <div class="stats">
        <div class="stat"><b>${d.totals.sessions}</b>受付数</div>
        <div class="stat"><b>${d.totals.finalized}</b>抽選確定</div>
        <div class="stat"><b>${d.totals.redeemed}</b>引換済み</div>
        <div class="stat"><b>${cards.digital?.total ?? 0}</b>デジタルカード発行</div>
        <div class="stat"><b>${cards.digital?.used ?? 0}</b>デジタル受付済み</div>
        <div class="stat"><b>${cards.paper?.total ?? 0}</b>紙カード受付</div>
        <div class="stat"><b>${d.surveys.total}</b>アンケート</div>
      </div>
    </section>

    <section class="panel"><h2>景品（2台共有）</h2><div class="table-wrap"><table>
      <thead><tr><th>等級</th><th>景品</th><th class="num">総数</th><th class="num">確保</th><th class="num">引換済</th><th class="num">残り</th></tr></thead>
      <tbody>${d.prizes.map((p) => html`<tr><td>${ball(p.color)} ${p.grade}等 ${p.colorLabel}</td><td>${p.prize}</td><td class="num">${p.total}</td><td class="num">${p.allocated}</td><td class="num">${p.redeemed}</td><td class="num"><strong>${p.available}</strong></td></tr>`)}</tbody>
    </table></div><p class="muted small">確保＝当たった数（未引換を含む）、残り＝総数−確保。</p></section>

    <section class="panel"><h2>ガラガラ</h2><div class="table-wrap"><table>
      <thead><tr><th>台</th><th>状態</th>${COLORS.map((c) => html`<th class="num">${ball(c)} ${COLOR_LABELS[c]}</th>`)}<th>会場PC</th></tr></thead>
      <tbody>${d.machines.map((m) => html`<tr><td>${m.name}</td>
        <td>${m.emergency ? '緊急停止中' : m.resumeRequired ? '再開待ち' : m.activeSession ? `抽選中 ${m.activeSession.id}（${m.activeSession.count}/${m.activeSession.n}）` : '待機中'}</td>
        ${COLORS.map((c) => html`<td class="num">${m.contents[c]}</td>`)}<td>${m.online ? '接続中' : '心拍なし'}</td></tr>`)}</tbody>
    </table></div><p class="muted small">色の列は機内に残っている玉の数（帳簿上）。</p></section>

    <section class="panel"><h2>最近の抽選</h2><div class="table-wrap"><table>
      <thead><tr><th>券番号</th><th>台</th><th>カード</th><th>景品</th><th>状態</th></tr></thead>
      <tbody>${d.recentSessions.map((s) => html`<tr><td>${s.id}</td><td>${s.machineId}</td><td>${s.cardKind === 'paper' ? '紙' : 'デジタル'} ${s.lines}ライン</td>
        <td>${s.voucher ? s.voucher.prizes.map((p) => `${p.grade}等`).join('・') : '抽選中'}</td>
        <td>${s.voucher ? (s.voucher.redeemedAt ? `引換済 ${fmtTime(s.voucher.redeemedAt)}` : PRINT[s.voucher.printStatus] ?? s.voucher.printStatus) : ''}</td></tr>`)}</tbody>
    </table></div>
    <p class="row"><a class="btn btn-plain btn-small" href="/api/panel/export/sessions.csv">抽選結果CSV</a><a class="btn btn-plain btn-small" href="/api/panel/export/audit.csv">操作ログCSV</a></p></section>

    <section class="panel"><h2>操作ログ</h2>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>時刻</th><th>操作者</th><th>操作</th><th>結果</th><th>内容</th></tr></thead>
      <tbody>${st.logs.map((r) => html`<tr class="${r.result === 'ok' ? '' : 'rejected'}"><td>${r.seq}</td><td>${fmtDateTime(r.at)}</td><td>${r.actor.name ?? r.actor.kind}</td><td>${r.type}</td><td>${r.result === 'ok' ? 'OK' : r.result.replace('rejected:', '拒否:')}</td><td>${r.message ?? ''}</td></tr>`)}</tbody></table></div>
      <p class="row"><button class="btn btn-plain btn-small" id="logs-refresh">最新を読み込む</button>${st.next ? html`<button class="btn btn-plain btn-small" id="logs-more">さらに古いログ</button>` : ''}</p>
    </section>`);
  $('#close')?.addEventListener('click', () => setIntake(true));
  $('#reopen')?.addEventListener('click', () => setIntake(false));
  $('#logs-refresh').addEventListener('click', () => loadLogs());
  $('#logs-more')?.addEventListener('click', () => loadLogs(true));
}

load();
loadLogs();
// Polling keeps the numbers current without a session cookie.
setInterval(() => { if (!document.hidden && document.activeElement?.id !== 'reason') load(); }, 10_000);
