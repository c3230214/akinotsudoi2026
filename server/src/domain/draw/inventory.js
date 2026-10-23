import { COLORS } from '../rules.js';
import { fail, invalid } from '../errors.js';
import { COLOR_LABELS, machineOf, zeroColors } from './state.js';

function requireReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length < 2) invalid('理由を入力してください');
  return reason.trim().slice(0, 500);
}

function countMap(input, { allowZeroTotal = true } = {}) {
  if (!input || typeof input !== 'object') invalid('色ごとの個数を指定してください');
  const out = zeroColors();
  for (const [key, value] of Object.entries(input)) {
    if (!COLORS.includes(key)) invalid(`unknown color ${key}`);
    if (!Number.isInteger(value) || value < 0 || value > 10000) invalid(`${COLOR_LABELS[key]}の個数は0〜10000の整数です`);
    out[key] = value;
  }
  if (!allowZeroTotal && COLORS.every((c) => out[c] === 0)) invalid('1個以上指定してください');
  return out;
}

/** Initial ball counts. Allowed only before the first intake (§3). */
export function setInventory(s, a) {
  if (s.locked) fail('SETTINGS_LOCKED', '最初の受付後は初期在庫を変更できません。棚卸し補正を使ってください');
  const contents = a.contents ?? {};
  for (const id of Object.keys(contents)) machineOf(s, id);
  for (const m of Object.values(s.machines)) m.contents = countMap(contents[m.id] ?? {});
  s.spare = countMap(a.spare ?? {});
  s.inventoryConfigured = true;
  return { touched: Object.keys(s.machines), message: '初期在庫を登録しました', result: {} };
}

/** Stocktake correction (§15 C18). Machine must be idle, reason mandatory. */
export function adjustInventory(s, a) {
  const reason = requireReason(a.reason);
  if (!COLORS.includes(a.color)) invalid('color is required');
  if (!Number.isInteger(a.delta) || a.delta === 0 || Math.abs(a.delta) > 10000) invalid('delta must be a non-zero integer');
  let touched = [];
  if (a.target === 'machine') {
    const m = machineOf(s, a.machineId);
    if (m.phase !== 'idle') fail('MACHINE_BUSY', '抽選中の台は補正できません');
    if (m.contents[a.color] + a.delta < 0) fail('NEGATIVE_STOCK', '補正後の個数が負になります');
    m.contents[a.color] += a.delta;
    touched = [m.id];
  } else if (a.target === 'spare') {
    if (s.spare[a.color] + a.delta < 0) fail('NEGATIVE_STOCK', '補正後の個数が負になります');
    s.spare[a.color] += a.delta;
  } else if (a.target === 'returnPending') {
    const m = machineOf(s, a.machineId);
    if (m.returnPending[a.color] + a.delta < 0) fail('NEGATIVE_STOCK', '補正後の個数が負になります');
    m.returnPending[a.color] += a.delta;
    touched = [m.id];
  } else {
    invalid('target must be machine, spare or returnPending');
  }
  return { touched, message: `棚卸し補正：${COLOR_LABELS[a.color]} ${a.delta > 0 ? '+' : ''}${a.delta}（${reason}）`, result: {} };
}

/** Put excess balls back. Idempotency by operationId is enforced by the service (test 08). */
export function returnBalls(s, a) {
  const m = machineOf(s, a.machineId);
  const counts = countMap(a.colors, { allowZeroTotal: false });
  for (const c of COLORS) {
    if (counts[c] > m.returnPending[c]) {
      fail('EXCEEDS_RETURN_PENDING', `${COLOR_LABELS[c]}の戻し待ちは${m.returnPending[c]}個です`);
    }
  }
  for (const c of COLORS) {
    m.returnPending[c] -= counts[c];
    m.contents[c] += counts[c];
  }
  return { touched: [m.id], message: `${m.name}へ玉を戻しました`, result: { colors: counts } };
}

export function addRefillPlan(s, a, ctx) {
  const m = machineOf(s, a.machineId);
  const colors = countMap(a.colors, { allowZeroTotal: false });
  if (typeof a.dueAt !== 'string' || Number.isNaN(Date.parse(a.dueAt))) invalid('dueAt must be an ISO 8601 date-time');
  const planId = `plan-${s.plans.length + 1}`;
  s.plans.push({ planId, machineId: m.id, dueAt: a.dueAt, colors, done: { ...zeroColors() }, createdAt: ctx.now, note: typeof a.note === 'string' ? a.note.slice(0, 200) : null });
  return { touched: [m.id], message: `${m.name}の補充計画を登録しました`, result: { planId } };
}

/**
 * Record balls actually put into a machine from the shared spare stock.
 * A plan only tells staff what to do; contents grow here (test 07).
 */
export function refillPlanned(s, a) {
  const m = machineOf(s, a.machineId);
  const counts = countMap(a.colors, { allowZeroTotal: false });
  const plan = a.planId ? s.plans.find((p) => p.planId === a.planId) : null;
  if (a.planId && (!plan || plan.machineId !== m.id)) fail('UNKNOWN_PLAN', '補充計画が見つかりません', { status: 404 });
  for (const c of COLORS) {
    if (counts[c] > s.spare[c]) fail('SPARE_SHORTAGE', `${COLOR_LABELS[c]}の予備玉は${s.spare[c]}個しかありません`);
  }
  for (const c of COLORS) {
    s.spare[c] -= counts[c];
    m.contents[c] += counts[c];
    if (plan) plan.done[c] += counts[c];
  }
  return { touched: [m.id], message: `${m.name}へ予備玉を投入しました`, result: { colors: counts } };
}

export function setInputMode(s, a) {
  const m = machineOf(s, a.machineId);
  if (!['manual', 'auto'].includes(a.mode)) invalid('mode must be manual or auto');
  requireReason(a.reason);
  // TODO(DECISION-C02): switching while a session runs would mix input paths.
  if (m.phase !== 'idle') fail('MACHINE_BUSY', '入力モードは待機中にだけ切り替えられます');
  m.inputMode = a.mode;
  return { touched: [m.id], message: `${m.name}を${a.mode === 'auto' ? '自動読取' : '手入力'}モードにしました`, result: {} };
}
