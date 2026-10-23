import { COLORS } from '../rules.js';
import { COLOR_LABELS, activeBalls, availablePrizes, ballLedger, gradeOf } from './state.js';
import { needsReview, sessionSummary } from './balls.js';

const REVIEW_LABELS = Object.freeze({
  COLOR_UNKNOWN: '色未判定',
  ORDER_UNCERTAIN: '順番不確実',
  LATE: '遅れて到着',
  EMERGENCY: '停止中の出玉',
  NO_GENERATION: '受付世代なし',
  LEDGER_MISMATCH: '帳簿と不一致',
});

function ballView(b) {
  let review = null;
  if (needsReview(b)) {
    review = b.reviewReason ? REVIEW_LABELS[b.reviewReason] : b.color === null ? REVIEW_LABELS.COLOR_UNKNOWN : REVIEW_LABELS.ORDER_UNCERTAIN;
  }
  return {
    ballId: b.ballId, order: b.order, color: b.color, colorLabel: b.color ? COLOR_LABELS[b.color] : '未判定',
    kind: b.kind, source: b.source, review, shortage: b.shortage, at: b.at, by: b.by, corrections: b.corrections,
  };
}

export function sessionView(s, session) {
  return {
    id: session.id,
    machineId: session.machineId,
    cardKind: session.card.kind,
    cardId: session.card.id,
    marks: session.marks,
    lines: session.lines,
    n: session.n,
    status: session.status,
    intake: session.intake,
    createdAt: session.createdAt,
    createdBy: session.createdBy,
    finalizedAt: session.finalizedAt,
    balls: activeBalls(session).map(ballView),
    removedBalls: session.balls.filter((b) => b.removed).map(ballView),
    summary: sessionSummary(session),
    voucher: session.voucher,
  };
}

/** Raw and non-negative difference between prizes and balls held (§3, test 11). */
export function shortageByColor(s) {
  return Object.fromEntries(COLORS.map((c) => {
    const ledger = ballLedger(s, c);
    const total = gradeOf(s, c).total;
    const diff = total - ledger.total;
    return [c, { prizeTotal: total, ballsTotal: ledger.total, diff, shortage: Math.max(0, diff) }];
  }));
}

/** What staff should put into a machine now: due refill plans and excess balls to return. */
export function refillGuide(s, machineId, now) {
  const m = s.machines[machineId];
  const due = s.plans.filter((p) => p.machineId === machineId && Date.parse(p.dueAt) <= Date.parse(now))
    .map((p) => ({
      planId: p.planId,
      dueAt: p.dueAt,
      remaining: Object.fromEntries(COLORS.map((c) => [c, Math.max(0, p.colors[c] - p.done[c])])),
    }))
    .filter((p) => COLORS.some((c) => p.remaining[c] > 0));
  return { due, returnPending: { ...m.returnPending } };
}

export function printQueue(s) {
  const jobs = [];
  for (const id of s.sessionOrder) {
    const session = s.sessions[id];
    if (!session.voucher) continue;
    for (const job of session.voucher.jobs) {
      if (job.status === 'queued' || job.status === 'dispatched') {
        jobs.push({ ...job, sessionId: id, machineId: session.machineId, machineName: s.machines[session.machineId]?.name, prizes: session.voucher.prizes, finalizedAt: session.finalizedAt, eventName: s.settings.eventName });
      }
    }
  }
  return jobs;
}

function prizeView(s) {
  return s.settings.grades.map((g) => ({
    ...g,
    colorLabel: COLOR_LABELS[g.color],
    allocated: s.prizes[g.color].allocated,
    redeemed: s.prizes[g.color].redeemed,
    allocatedNotRedeemed: s.prizes[g.color].allocated - s.prizes[g.color].redeemed,
    available: availablePrizes(s, g.color),
    inMachines: Object.values(s.machines).reduce((sum, m) => sum + m.contents[g.color], 0),
  }));
}

export function toStaffView(s, { now, devices = {} } = {}) {
  const machines = Object.values(s.machines).map((m) => {
    const inMachinesOverStock = COLORS.filter((c) => Object.values(s.machines).reduce((sum, x) => sum + x.contents[c], 0) > availablePrizes(s, c));
    return {
      id: m.id, name: m.name, revision: m.revision, phase: m.phase, inputMode: m.inputMode,
      emergency: m.emergency, resumeRequired: m.resumeRequired,
      contents: m.contents, returnPending: m.returnPending,
      activeSession: m.activeSessionId ? sessionView(s, s.sessions[m.activeSessionId]) : null,
      refill: now ? refillGuide(s, m.id, now) : null,
      device: devices[m.id] ?? null,
      warnings: inMachinesOverStock.map((c) => `両台の機内の${COLOR_LABELS[c]}玉が${COLOR_LABELS[c]}の景品残数を超えています`),
      unassigned: s.unassigned.filter((u) => u.machineId === m.id && !u.resolvedAt),
    };
  });
  const recent = s.sessionOrder.slice(-40).reverse().map((id) => {
    const x = s.sessions[id];
    return { id, machineId: x.machineId, status: x.status, n: x.n, lines: x.lines, cardKind: x.card.kind, createdAt: x.createdAt, voucher: x.voucher ? { printStatus: x.voucher.printStatus, redeemedAt: x.voucher.redeemedAt, prizes: x.voucher.prizes, everDispatched: x.voucher.everDispatched, manual: Boolean(x.voucher.manual) } : null };
  });
  return {
    revision: s.revision,
    settingsVersion: s.settingsVersion,
    settings: s.settings,
    locked: s.locked,
    inventoryConfigured: s.inventoryConfigured,
    machines,
    prizes: prizeView(s),
    spare: s.spare,
    storedValid: s.storedValid,
    ledger: Object.fromEntries(COLORS.map((c) => [c, ballLedger(s, c)])),
    shortage: shortageByColor(s),
    plans: s.plans,
    printQueue: printQueue(s),
    recentSessions: recent,
    totals: {
      sessions: s.sessionOrder.length,
      finalized: s.sessionOrder.filter((id) => s.sessions[id].status === 'finalized').length,
      redeemed: s.sessionOrder.filter((id) => s.sessions[id].voucher?.redeemedAt).length,
    },
  };
}

/** Kiosk: only what visitors standing at one machine need to see. No card data. */
export function toKioskView(s, machineId) {
  const m = s.machines[machineId];
  if (!m) return null;
  const session = m.activeSessionId ? s.sessions[m.activeSessionId] : null;
  let instruction;
  let remaining = 0;
  let balls = [];
  if (m.emergency || m.resumeRequired) {
    instruction = 'ただいま一時停止中です。係員の案内をお待ちください';
  } else if (!session) {
    instruction = 'ビンゴカードを係員に見せてください';
  } else {
    const sum = sessionSummary(session);
    remaining = sum.remaining;
    balls = activeBalls(session).map((b) => ({ order: b.order, color: b.color, colorLabel: b.color ? COLOR_LABELS[b.color] : '確認中', kind: b.kind }));
    if (remaining > 0) instruction = `ガラガラを回してください。あと${remaining}回`;
    else if (sum.review > 0) instruction = '係員が玉を確認しています。少しお待ちください';
    else instruction = '抽選終了！係員から引換券を受け取ってください';
  }
  return {
    machineId: m.id,
    machineName: m.name,
    instruction,
    remaining,
    n: session?.n ?? 0,
    balls,
    grades: s.settings.grades.map((g) => ({ grade: g.grade, color: g.color, colorLabel: COLOR_LABELS[g.color], prize: g.prize, soldOut: availablePrizes(s, g.color) <= 0 })),
    stopped: Boolean(m.emergency || m.resumeRequired),
    revision: m.revision,
  };
}
