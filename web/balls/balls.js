import { getJson } from '../shared/api.js';
import { $, $$, COLORS, COLOR_LABELS, html, raw, render, toast } from '../shared/html.js';
import { openStream } from '../shared/stream.js';
import { ballChip, sendCommand as command, showError } from '../shared/staffkit.js';

// Ball and prize dashboard for the Windows PC (2026-10-30 request). Staff
// enter the prize counts and the ball stock; the server proposes how many
// balls of each colour go into each machine so that the odds follow the
// remaining prizes. Moving the balls is done by hand; "この通りに入れ替えた"
// records what was moved. Every change goes through the server (admin only).

const st = { me: null, view: null, plan: null, sizes: {}, planKey: '', busy: false, dirty: {} };
const sum = (o) => COLORS.reduce((a, c) => a + (o[c] ?? 0), 0);

async function boot() {
  try { st.me = await getJson('/api/staff/me'); } catch { st.me = null; }
  if (!st.me) {
    render($('#app'), html`<p class="notice">ログインしていません。<a href="/staff/" target="_top">スタッフ画面</a>で管理者としてログインしてください。</p>`);
    return;
  }
  if (st.me.staff.role !== 'admin') {
    render($('#app'), html`<p class="notice notice-danger">この画面は管理者のアカウントで使います（いまは「${st.me.staff.displayName}」でログイン中）。</p>`);
    return;
  }
  openStream('/api/stream/staff', { onView: (v) => { st.view = v; refreshPlan(); } });
}

function sizesFor(v) {
  for (const m of v.machines) if (st.sizes[m.id] === undefined) st.sizes[m.id] = sum(m.contents) || 50;
  return st.sizes;
}

async function refreshPlan(force = false) {
  const v = st.view;
  const sizes = sizesFor(v);
  const key = `${v.revision}:${JSON.stringify(sizes)}`;
  if (!force && key === st.planKey) { draw(); return; }
  st.planKey = key;
  try {
    st.plan = await getJson(`/api/staff/ball-plan?${new URLSearchParams(Object.entries(sizes).map(([k, n]) => [k, String(n)]))}`);
  } catch (error) { st.plan = null; showError(error); }
  draw();
}

/** How far the current odds are from the remaining-prize share (percentage points). */
function drift(p) {
  return Math.max(0, ...p.machines.filter((m) => sum(m.current) > 0).flatMap((m) => COLORS.map((c) => Math.abs(m.currentOdds[c] - p.prizeShare[c]))));
}

function draw() {
  const v = st.view;
  const p = st.plan;
  if (!v) return;
  // Live updates arrive while staff type; keep what they typed but have not saved.
  for (const el of $$('#app input[id]')) if (el.dataset.dirty) st.dirty[el.id] = el.value;
  const machines = v.machines;
  const exhaustedInMachine = machines.flatMap((m) => COLORS.filter((c) => m.contents[c] > 0 && (v.prizes.find((x) => x.color === c)?.available ?? 0) <= 0).map((c) => `${m.name}に景品のない${COLOR_LABELS[c]}玉`));
  const d = p ? drift(p) : 0;
  render($('#app'), html`
    ${!v.inventoryConfigured ? html`<p class="notice notice-danger">玉の在庫がまだ登録されていません。下の「玉の在庫」に色ごとの全部の数を入れて「在庫を登録」を押してください。</p>` : ''}
    ${exhaustedInMachine.length ? html`<p class="notice notice-danger">${exhaustedInMachine.join('、')}が入っています。受付が止まるので、下の計画どおりに取り出してください。</p>`
    : p && d >= 3 ? html`<p class="notice">いまのガラガラの確率が、景品の残りの割合から最大${d.toFixed(1)}ポイントずれています。入れ替えをおすすめします。</p>` : ''}

    <section class="panel"><h2>景品</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>等級</th><th>景品</th><th class="num">景品数</th><th class="num">当選済み</th><th class="num">引換済み</th><th class="num">残り</th><th class="num">残りの割合</th></tr></thead>
        <tbody>${v.prizes.map((g) => html`<tr>
          <td>${ballChip(g.color, `${g.grade}等 ${g.colorLabel}`)}</td><td>${g.prize}</td>
          <td class="num"><input type="number" id="pt-${g.color}" min="${g.allocated}" max="100000" value="${g.total}" inputmode="numeric"></td>
          <td class="num">${g.allocated}</td><td class="num">${g.redeemed}</td><td class="num"><b>${g.available}</b></td>
          <td class="num">${p ? `${p.prizeShare[g.color]}%` : ''}</td></tr>`)}</tbody>
      </table></div>
      <button class="btn btn-secondary" data-act="savePrizes">景品数を保存</button>
      <p class="muted small">景品を追加したときなどに直します。当選済みより少なくはできません。</p>
    </section>

    <section class="panel"><h2>玉の在庫</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>色</th>${machines.map((m) => html`<th class="num">${m.name}の中</th>`)}<th class="num">予備（台の外）</th><th class="num">合計（全部の数）</th><th class="num">戻し待ち</th></tr></thead>
        <tbody>${COLORS.map((c) => html`<tr><td>${ballChip(c)}</td>
          ${machines.map((m) => html`<td class="num">${v.inventoryConfigured ? html`<input type="number" id="mc-${m.id}-${c}" min="0" max="10000" value="${m.contents[c]}" inputmode="numeric">` : '0'}</td>`)}
          <td class="num">${v.spare[c]}</td>
          <td class="num"><input type="number" id="own-${c}" min="0" max="10000" value="${v.spare[c] + machines.reduce((a, m) => a + m.contents[c], 0)}" inputmode="numeric"></td>
          <td class="num">${machines.reduce((a, m) => a + m.returnPending[c], 0)}</td></tr>`)}</tbody>
      </table></div>
      <div class="row">
        ${v.inventoryConfigured ? html`<button class="btn btn-secondary" data-act="saveOwned">合計（全部の数）を保存</button>
          <button class="btn btn-plain" data-act="saveMachine">台の中の数を数え直した値で保存</button>`
    : html`<button class="btn" data-act="initStock">在庫を登録</button>`}
      </div>
      <p class="muted small">「合計」を直すと差は予備で調整します（玉をなくした、追加したなど）。「台の中の数」は抽選中でない台だけ、数え直した値で直します。どちらも理由とともに記録します。戻し待ちは回数を超えて出た玉で、スタッフ画面の「在庫」タブで台へ戻します。</p>
    </section>

    <section class="panel"><h2>ガラガラに入れる玉（自動計算）</h2>
      <div class="row">${machines.map((m) => html`<label for="size-${m.id}">${m.name}に入れる玉の数</label><input type="number" id="size-${m.id}" min="0" max="2000" value="${st.sizes[m.id]}" inputmode="numeric" class="size">`)}</div>
      ${p ? html`
      ${p.warnings.map((w) => html`<p class="notice">${w}</p>`)}
      <div class="plan">${p.machines.map((m) => html`
        <div class="plan-m">
          <h3>${m.name}${m.idle ? '' : html` <span class="chip warn">抽選中</span>`}</h3>
          <table><thead><tr><th>色</th><th class="num">いま</th><th class="num">計画</th><th class="num">入れる／出す</th><th class="num">確率 いま→計画</th></tr></thead>
          <tbody>${COLORS.map((c) => html`<tr><td>${ballChip(c, `${COLOR_LABELS[c]}（${v.prizes.find((g) => g.color === c).grade}等）`)}</td>
            <td class="num">${m.current[c]}</td><td class="num"><b>${m.target[c]}</b></td>
            <td class="num move ${m.moves[c] > 0 ? 'in' : m.moves[c] < 0 ? 'out' : ''}">${m.moves[c] > 0 ? `${m.moves[c]}個 入れる` : m.moves[c] < 0 ? `${-m.moves[c]}個 出す` : '－'}</td>
            <td class="num">${m.currentOdds[c]}% → ${m.targetOdds[c]}%</td></tr>`)}
            <tr class="total"><td>合計</td><td class="num">${sum(m.current)}</td><td class="num"><b>${sum(m.target)}</b></td><td></td><td></td></tr></tbody></table>
        </div>`)}</div>
      <p>入れ替えた後の予備：${COLORS.map((c) => html`${ballChip(c, `${COLOR_LABELS[c]} ${p.spareAfter[c]}個`)} `)}</p>
      <button class="btn btn-ok btn-lg" data-act="apply" ${p.machines.some((m) => !m.idle && COLORS.some((c) => m.moves[c] !== 0)) || p.machines.every((m) => COLORS.every((c) => m.moves[c] === 0)) ? raw('disabled') : ''}>この通りに入れ替えた（記録する）</button>
      <p class="muted small">確率は、玉1個を引いたときにその色が出る割合です。景品の残りの割合に合わせるので、景品はおおむね同じころになくなります。景品の残りより多い玉は入れません。抽選中の台は、結果を確定してから入れ替えてください。</p>` : html`<p class="muted">計算中…</p>`}
    </section>`);
  bind();
}

function readInt(id) {
  const n = Number($(`#${id}`)?.value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function bind() {
  for (const [id, value] of Object.entries(st.dirty)) {
    const el = document.getElementById(id);
    if (el) { el.value = value; el.dataset.dirty = '1'; }
  }
  for (const el of $$('#app input[id]')) el.addEventListener('input', () => { el.dataset.dirty = '1'; });
  for (const el of $$('.size')) {
    el.addEventListener('change', () => {
      const n = readInt(el.id);
      if (n === null) { toast('0以上の整数を入れてください', { kind: 'error' }); return; }
      st.sizes[el.id.slice(5)] = n;
      refreshPlan(true);
    });
  }
  for (const b of $$('[data-act]')) b.addEventListener('click', () => act(b.dataset.act));
}

async function act(name) {
  if (st.busy) return;
  st.busy = true;
  try {
    const v = st.view;
    if (name === 'savePrizes') {
      const changes = v.prizes.filter((g) => readInt(`pt-${g.color}`) !== null && readInt(`pt-${g.color}`) !== g.total);
      if (!changes.length) { toast('変更はありません'); return; }
      const reason = window.prompt('景品数を変える理由（例：追加購入）');
      if (!reason || reason.trim().length < 2) return;
      for (const g of changes) await command({ type: 'adjustPrizeTotal', color: g.color, total: readInt(`pt-${g.color}`), reason });
    } else if (name === 'initStock') {
      const spare = Object.fromEntries(COLORS.map((c) => [c, readInt(`own-${c}`) ?? 0]));
      if (!window.confirm(`玉の在庫を登録します：${COLORS.map((c) => `${COLOR_LABELS[c]} ${spare[c]}個`).join('、')}。いったん全部「予備」として登録し、続けて下の計画でガラガラに入れます。`)) return;
      await command({ type: 'setInventory', contents: {}, spare });
    } else if (name === 'saveOwned') {
      const changes = COLORS.map((c) => [c, (readInt(`own-${c}`) ?? 0) - (v.spare[c] + v.machines.reduce((a, m) => a + m.contents[c], 0))]).filter(([, d]) => d !== 0);
      if (!changes.length) { toast('変更はありません'); return; }
      const bad = changes.find(([c, d]) => v.spare[c] + d < 0);
      if (bad) { toast(`${COLOR_LABELS[bad[0]]}は予備が足りないため、その数まで減らせません。先に台から出してください`, { kind: 'error', ms: 6000 }); return; }
      const reason = window.prompt('在庫数を直す理由（例：玉を追加した、数え直した）');
      if (!reason || reason.trim().length < 2) return;
      for (const [color, delta] of changes) await command({ type: 'adjustInventory', target: 'spare', color, delta, reason });
    } else if (name === 'saveMachine') {
      const changes = v.machines.flatMap((m) => COLORS.map((c) => [m, c, (readInt(`mc-${m.id}-${c}`) ?? m.contents[c]) - m.contents[c]])).filter(([, , d]) => d !== 0);
      if (!changes.length) { toast('変更はありません'); return; }
      const reason = window.prompt('台の中の数を直す理由（例：棚卸しで数え直した）');
      if (!reason || reason.trim().length < 2) return;
      for (const [m, color, delta] of changes) await command({ type: 'adjustInventory', target: 'machine', machineId: m.id, color, delta, reason });
    } else if (name === 'apply') {
      const p = st.plan;
      const moves = Object.fromEntries(p.machines.map((m) => [m.id, m.moves]));
      const text = p.machines.map((m) => `${m.name}：${COLORS.filter((c) => m.moves[c]).map((c) => `${COLOR_LABELS[c]}${m.moves[c] > 0 ? '+' : ''}${m.moves[c]}`).join(' ') || '変更なし'}`).join('\n');
      if (!window.confirm(`次のとおり玉を入れ替えたことを記録します。実際に入れ替えましたか？\n${text}`)) return;
      await command({ type: 'rebalanceBalls', moves });
    }
  } finally {
    st.busy = false;
    st.dirty = {};
    for (const el of $$('#app input[data-dirty]')) delete el.dataset.dirty;
    refreshPlan(true);
  }
}

boot();
