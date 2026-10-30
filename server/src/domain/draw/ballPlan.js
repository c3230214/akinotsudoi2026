import { COLORS } from '../rules.js';
import { fail, invalid } from '../errors.js';
import { COLOR_LABELS, availablePrizes, gradeOf, machineOf, zeroColors } from './state.js';

/**
 * Ball mix planning for the Windows PC dashboard (2026-10-30 request: enter
 * ball stock and prize counts, and get how many balls of each colour to put
 * in each machine).
 *
 * Rule: a drawn valid ball of a colour takes one prize of that colour and is
 * kept out of the machine, so the chance of a grade is the share of its balls
 * in the machine. The plan sets that share to the share of the remaining
 * prizes, so prizes run out at about the same time, and it never puts more
 * balls of a colour into the machines than prizes remain (otherwise a draw
 * could hit a colour with no prize left). Balls must also physically exist
 * (in a machine or the spare stock). A grade with prizes left keeps at least
 * one ball even when its exact share rounds to zero.
 * TODO(DECISION-U24): "proportional to remaining prizes" is the proposed
 * rule; the organisers may prefer other odds (e.g. fewer top prizes early).
 */

/** Largest-remainder split of `total` by `weights`, never above `caps`. */
export function apportion(total, weights, caps) {
  const keys = Object.keys(weights);
  const out = Object.fromEntries(keys.map((k) => [k, 0]));
  let left = Math.min(total, keys.reduce((a, k) => a + caps[k], 0));
  // Water-filling: colours that hit their cap give the rest to the others.
  for (let guard = 0; left > 0 && guard < 50; guard += 1) {
    const open = keys.filter((k) => out[k] < caps[k] && weights[k] > 0);
    if (!open.length) break;
    const w = open.reduce((a, k) => a + weights[k], 0);
    const share = open.map((k) => ({ k, exact: (left * weights[k]) / w }));
    let given = 0;
    for (const x of share) {
      const n = Math.min(Math.floor(x.exact), caps[x.k] - out[x.k]);
      out[x.k] += n;
      given += n;
    }
    left -= given;
    if (given === 0) {
      // Hand out single balls by largest remainder.
      share.sort((a, b) => (b.exact % 1) - (a.exact % 1) || weights[b.k] - weights[a.k]);
      for (const x of share) {
        if (left === 0) break;
        if (out[x.k] < caps[x.k]) { out[x.k] += 1; left -= 1; }
      }
    }
  }
  return out;
}

/**
 * @param {object} s draw state
 * @param {Record<string, number>} sizes balls wanted in each machine
 * @returns per machine: target counts, moves (target - now) and odds, plus warnings
 */
export function planBallMix(s, sizes) {
  const machines = Object.values(s.machines);
  for (const m of machines) {
    const n = sizes[m.id];
    if (!Number.isInteger(n) || n < 0 || n > 2000) invalid(`${m.name}に入れる玉の数は0〜2000の整数です`);
  }
  const remaining = Object.fromEntries(COLORS.map((c) => [c, Math.max(0, availablePrizes(s, c))]));
  const owned = Object.fromEntries(COLORS.map((c) => [c, s.spare[c] + machines.reduce((a, m) => a + m.contents[c], 0)]));
  const caps = Object.fromEntries(COLORS.map((c) => [c, Math.min(remaining[c], owned[c])]));
  const totalWanted = machines.reduce((a, m) => a + sizes[m.id], 0);
  const totals = apportion(totalWanted, remaining, caps);
  // Keep every grade that still has prizes winnable: at least one ball, taken
  // from the colour with the most balls (slightly above its strict share).
  for (const c of COLORS) {
    if (caps[c] > 0 && totals[c] === 0) {
      const donor = [...COLORS].sort((a, b) => totals[b] - totals[a])[0];
      if (totals[donor] > 1) { totals[donor] -= 1; totals[c] = 1; }
    }
  }

  // Split each colour between machines in proportion to their size.
  const target = Object.fromEntries(machines.map((m) => [m.id, zeroColors()]));
  for (const c of COLORS) {
    const split = apportion(totals[c], Object.fromEntries(machines.map((m) => [m.id, sizes[m.id]])), Object.fromEntries(machines.map((m) => [m.id, sizes[m.id]])));
    for (const m of machines) target[m.id][c] = split[m.id];
  }
  // Rounding per colour can leave one machine short and the other over its
  // size; move single balls until each machine is as close to its size as possible.
  for (let guard = 0; guard < 100; guard += 1) {
    const sum = (id) => COLORS.reduce((a, c) => a + target[id][c], 0);
    const over = machines.find((m) => sum(m.id) > sizes[m.id]);
    const under = machines.find((m) => sum(m.id) < sizes[m.id]);
    if (!over || !under) break;
    const c = [...COLORS].sort((a, b) => target[over.id][b] - target[over.id][a])[0];
    target[over.id][c] -= 1;
    target[under.id][c] += 1;
  }

  const warnings = [];
  for (const c of COLORS) {
    if (owned[c] < remaining[c] && totals[c] === owned[c]) {
      warnings.push(`${COLOR_LABELS[c]}の玉が${owned[c]}個しかなく、景品の残り（${remaining[c]}）より少ないため、${gradeOf(s, c).grade}等の確率が予定より低くなります`);
    }
  }
  const short = totalWanted - COLORS.reduce((a, c) => a + totals[c], 0);
  if (short > 0) warnings.push(`景品の残りか玉が足りないため、2台合わせて${short}個少なく入れる計画です`);

  const odds = (counts) => {
    const n = COLORS.reduce((a, c) => a + counts[c], 0);
    return Object.fromEntries(COLORS.map((c) => [c, n ? Math.round((counts[c] / n) * 1000) / 10 : 0]));
  };
  return {
    remaining,
    owned,
    prizeShare: odds(remaining),
    machines: machines.map((m) => ({
      id: m.id,
      name: m.name,
      idle: m.phase === 'idle',
      size: sizes[m.id],
      current: { ...m.contents },
      currentOdds: odds(m.contents),
      target: target[m.id],
      targetOdds: odds(target[m.id]),
      moves: Object.fromEntries(COLORS.map((c) => [c, target[m.id][c] - m.contents[c]])),
    })),
    spareAfter: Object.fromEntries(COLORS.map((c) => [c, owned[c] - machines.reduce((a, m) => a + target[m.id][c], 0)])),
    warnings,
  };
}

/**
 * Move balls between the spare stock and the machines as the staff actually
 * did (positive = into the machine). The ball ledger total does not change.
 */
export function rebalanceBalls(s, a) {
  if (!a.moves || typeof a.moves !== 'object') invalid('moves is required');
  const spare = { ...s.spare };
  const touched = [];
  const next = {};
  for (const [machineId, colors] of Object.entries(a.moves)) {
    const m = machineOf(s, machineId);
    if (!colors || typeof colors !== 'object') invalid('moves must map colours to counts');
    const contents = { ...m.contents };
    let changed = false;
    for (const [c, d] of Object.entries(colors)) {
      if (!COLORS.includes(c)) invalid(`unknown color ${c}`);
      if (!Number.isInteger(d) || Math.abs(d) > 2000) invalid('move must be an integer');
      if (d === 0) continue;
      changed = true;
      contents[c] += d;
      spare[c] -= d;
      if (contents[c] < 0) fail('NEGATIVE_STOCK', `${m.name}の${COLOR_LABELS[c]}が負になります`);
    }
    if (changed && m.phase !== 'idle') fail('MACHINE_BUSY', `${m.name}は抽選中です。結果確定のあとで入れ替えてください`);
    if (changed) { next[m.id] = contents; touched.push(m.id); }
  }
  for (const c of COLORS) if (spare[c] < 0) fail('SPARE_SHORTAGE', `${COLOR_LABELS[c]}の予備玉が足りません（あと${-spare[c]}個）`);
  if (!touched.length) invalid('入れ替える玉がありません');
  for (const id of touched) s.machines[id].contents = next[id];
  s.spare = spare;
  return { touched, message: `玉の入れ替えを記録しました（${touched.map((id) => s.machines[id].name).join('、')}）`, result: { contents: next, spare } };
}

/**
 * Change the number of prizes of one grade during the event (e.g. more were
 * bought). Never below the number already won. Reason required.
 */
export function adjustPrizeTotal(s, a) {
  if (!COLORS.includes(a.color)) invalid('color is required');
  if (!Number.isInteger(a.total) || a.total < 0 || a.total > 100000) invalid('景品数は0〜100000の整数です');
  if (typeof a.reason !== 'string' || a.reason.trim().length < 2) invalid('理由を入力してください');
  const g = s.settings.grades.find((x) => x.color === a.color);
  if (a.total < s.prizes[a.color].allocated) fail('BELOW_ALLOCATED', `${g.grade}等はすでに${s.prizes[a.color].allocated}個当選しています`);
  const before = g.total;
  s.settings.grades = s.settings.grades.map((x) => (x.color === a.color ? { ...x, total: a.total } : x));
  s.settingsVersion += 1;
  return { touched: [], message: `${g.grade}等（${COLOR_LABELS[a.color]}）の景品数を${before}から${a.total}にしました（${a.reason.trim().slice(0, 200)}）`, result: { color: a.color, total: a.total } };
}
