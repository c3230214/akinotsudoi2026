import { COLORS } from '../rules.js';
import { fail, invalid, requireReason } from '../errors.js';
import {
  COLOR_LABELS, activeBalls, assertColor, availablePrizes, isStopped, machineOf, sessionOf,
} from './state.js';

export function needsReview(ball) {
  return ball.color === null || ball.orderUncertain || ball.reviewReason !== null;
}

/**
 * Move one ball's colour into the machine ledger. A confirmed ball always
 * leaves the machine exactly once; a colour correction moves the count.
 * With strict=false (device input) a ledger mismatch becomes a review flag
 * instead of a negative count (§15 C18).
 */
function countBall(machine, ball, { strict }) {
  if (ball.color === ball.countedColor) return;
  const target = ball.color;
  const available = target === null ? Infinity : machine.contents[target] + (ball.countedColor === target ? 1 : 0);
  if (target !== null && available <= 0) {
    if (strict) {
      fail('NO_BALL_OF_COLOR', `帳簿上、${machine.name}に${COLOR_LABELS[target]}の玉がありません。棚卸しで在庫を補正してください`);
    }
    ball.reviewReason = 'LEDGER_MISMATCH';
    return;
  }
  if (ball.countedColor !== null) machine.contents[ball.countedColor] += 1;
  if (target !== null) machine.contents[target] -= 1;
  ball.countedColor = target;
}

function uncountBall(machine, ball) {
  if (ball.countedColor !== null) machine.contents[ball.countedColor] += 1;
  ball.countedColor = null;
}

/**
 * Recompute valid/excess/review for one session and settle prize reservations.
 * Reservations come from the shared stock; since every transition runs
 * serially inside one DB transaction, two machines cannot both take the last
 * prize (§3, extra test 37).
 */
export function reconcileSession(s, session) {
  const balls = activeBalls(session);
  balls.forEach((ball, i) => {
    ball.order = i + 1;
    if (i >= session.n) ball.kind = 'excess';
    else ball.kind = needsReview(ball) ? 'review' : 'valid';
  });
  for (const ball of session.balls) {
    const desired = !ball.removed && ball.kind === 'valid' ? ball.color : null;
    if (ball.reservedColor && ball.reservedColor !== desired) {
      s.prizes[ball.reservedColor].allocated -= 1;
      ball.reservedColor = null;
    }
    if (!desired) ball.shortage = false;
  }
  for (const ball of balls) {
    if (ball.kind !== 'valid' || ball.reservedColor) continue;
    if (availablePrizes(s, ball.color) > 0) {
      s.prizes[ball.color].allocated += 1;
      ball.reservedColor = ball.color;
      ball.shortage = false;
    } else {
      // TODO(DECISION-C17): what staff may do after a shortage hold is undefined.
      ball.shortage = true;
    }
  }
}

export function sessionSummary(session) {
  const balls = activeBalls(session);
  return {
    count: balls.length,
    valid: balls.filter((b) => b.kind === 'valid').length,
    review: balls.filter((b) => needsReview(b)).length,
    shortage: balls.filter((b) => b.shortage).length,
    remaining: Math.max(0, session.n - balls.length),
  };
}

function requireDrawingSession(s, machineId, sessionId) {
  const machine = machineOf(s, machineId);
  if (machine.phase !== 'drawing' || machine.activeSessionId !== sessionId) {
    fail('SESSION_NOT_ACTIVE', `${machine.name}で抽選 ${sessionId} は進行していません。画面を最新にしてください`);
  }
  return { machine, session: sessionOf(s, sessionId) };
}

function newBall(s, ctx, fields) {
  s.ballCounter += 1;
  return {
    ballId: `ball-${s.ballCounter}`,
    order: 0,
    color: null,
    countedColor: null,
    reservedColor: null,
    source: 'manual',
    orderUncertain: false,
    reviewReason: null,
    shortage: false,
    kind: 'review',
    removed: false,
    removedReason: null,
    at: ctx.now,
    by: ctx.actor?.name ?? null,
    detectedAt: null,
    deviceRef: null,
    corrections: [],
    ...fields,
  };
}

export function manualBall(s, a, ctx) {
  const { machine, session } = requireDrawingSession(s, a.machineId, a.sessionId);
  assertColor(a.color);
  if (machine.inputMode !== 'manual') {
    // TODO(DECISION-C02): manual and automatic input are never added together.
    fail('INPUT_MODE_AUTO', `${machine.name}は自動読取モードです。手入力するには入力モードを手入力へ切り替えてください`);
  }
  const ball = newBall(s, ctx, { color: a.color, source: 'manual' });
  countBall(machine, ball, { strict: true });
  session.balls.push(ball);
  reconcileSession(s, session);
  return {
    touched: [machine.id],
    message: `${ball.order}個目 ${COLOR_LABELS[ball.color]}`,
    result: { sessionId: session.id, ballId: ball.ballId, order: ball.order, kind: ball.kind, shortage: ball.shortage },
  };
}

export function removeManualBall(s, a, ctx) {
  const { machine, session } = requireDrawingSession(s, a.machineId, a.sessionId);
  const reason = requireReason(a.reason);
  const balls = activeBalls(session);
  const lastManual = [...balls].reverse().find((b) => b.source === 'manual');
  // TODO(DECISION-C02): "直前" when manual and device balls are mixed is
  // undefined; only the most recent manual ball can be removed, and only if
  // no ball was recorded after it.
  if (!lastManual || lastManual.ballId !== a.ballId || balls[balls.length - 1].ballId !== a.ballId) {
    fail('NOT_LAST_MANUAL_BALL', '取り消せるのは最後に手入力した1個だけです');
  }
  lastManual.removed = true;
  lastManual.removedReason = reason;
  lastManual.corrections.push({ at: ctx.now, by: ctx.actor?.name ?? null, action: 'remove', reason });
  uncountBall(machine, lastManual);
  reconcileSession(s, session);
  return { touched: [machine.id], message: `${lastManual.order}個目の入力を取り消しました`, result: { ballId: lastManual.ballId } };
}

export function correctBall(s, a, ctx) {
  const { machine, session } = requireDrawingSession(s, a.machineId, a.sessionId);
  const reason = requireReason(a.reason);
  assertColor(a.color);
  const ball = activeBalls(session).find((b) => b.ballId === a.ballId);
  if (!ball) fail('UNKNOWN_BALL', '対象の玉が見つかりません', { status: 404 });
  const before = { color: ball.color, orderUncertain: ball.orderUncertain, reviewReason: ball.reviewReason };
  const snapshot = { color: ball.color, countedColor: ball.countedColor, contents: { ...machine.contents } };
  ball.color = a.color;
  ball.orderUncertain = false;
  ball.reviewReason = null;
  try {
    countBall(machine, ball, { strict: true });
  } catch (error) {
    Object.assign(ball, { color: snapshot.color, countedColor: snapshot.countedColor, ...before });
    machine.contents = snapshot.contents;
    throw error;
  }
  ball.corrections.push({ at: ctx.now, by: ctx.actor?.name ?? null, action: 'correct', before, after: a.color, reason });
  reconcileSession(s, session);
  return {
    touched: [machine.id],
    message: `${ball.order}個目を${COLOR_LABELS[a.color]}に確定しました`,
    result: { ballId: ball.ballId, kind: ball.kind, shortage: ball.shortage },
  };
}

/** Discard a device-recorded ball that staff judged not to be a real draw. */
export function voidBall(s, a, ctx) {
  const { machine, session } = requireDrawingSession(s, a.machineId, a.sessionId);
  const reason = requireReason(a.reason);
  const ball = activeBalls(session).find((b) => b.ballId === a.ballId);
  if (!ball) fail('UNKNOWN_BALL', '対象の玉が見つかりません', { status: 404 });
  if (ball.source !== 'device') fail('NOT_DEVICE_BALL', '手入力の玉は「直前取消」で取り消してください');
  ball.removed = true;
  ball.removedReason = reason;
  ball.corrections.push({ at: ctx.now, by: ctx.actor?.name ?? null, action: 'void', reason });
  uncountBall(machine, ball);
  reconcileSession(s, session);
  return { touched: [machine.id], message: '自動読取の記録を無効にしました', result: { ballId: ball.ballId } };
}

/** Try again to reserve prizes held for shortage (e.g. after another session released one). */
export function retryShortage(s, a) {
  const session = sessionOf(s, a.sessionId);
  if (session.status !== 'drawing') fail('SESSION_NOT_ACTIVE', 'この抽選は確定済みです');
  reconcileSession(s, session);
  const { shortage } = sessionSummary(session);
  return { touched: [session.machineId], message: shortage ? '景品不足のままです' : '景品を確保しました', result: { shortage } };
}

function addUnassigned(s, machine, ctx, fields) {
  s.unassignedCounter += 1;
  const entry = {
    id: `u-${s.unassignedCounter}`,
    machineId: machine.id,
    color: fields.color,
    countedColor: null,
    reason: fields.reason,
    source: fields.source,
    detectedAt: fields.detectedAt ?? null,
    receivedAt: ctx.now,
    deviceRef: fields.deviceRef ?? null,
    countsInventory: fields.countsInventory,
    resolvedAt: null,
    resolution: null,
  };
  if (entry.countsInventory && entry.color && machine.contents[entry.color] > 0) {
    machine.contents[entry.color] -= 1;
    entry.countedColor = entry.color;
  }
  s.unassigned.push(entry);
  return entry;
}

/**
 * Device ball event (C2). Idempotency on (machineId, bootId, seq) lives in
 * the service layer; this function only applies business rules.
 */
export function ballDetected(s, a, ctx) {
  const machine = machineOf(s, a.machineId);
  const color = a.detectedColor === null || a.detectedColor === undefined ? null : assertColor(a.detectedColor);
  const base = { color, source: 'device', detectedAt: a.detectedAt ?? null, deviceRef: a.deviceRef ?? null };

  if (machine.inputMode !== 'auto') {
    // TODO(DECISION-C02): in manual mode device events are kept for audit only
    // and never change inventory, so the same physical ball is not counted twice.
    const entry = addUnassigned(s, machine, ctx, { ...base, reason: 'INPUT_MODE_MANUAL', countsInventory: false });
    return { touched: [machine.id], message: '手入力モード中の自動読取を記録のみしました', result: { duplicate: false, unassigned: true, unassignedId: entry.id } };
  }
  if (machine.phase !== 'drawing') {
    const entry = addUnassigned(s, machine, ctx, { ...base, reason: 'IDLE', countsInventory: true });
    return { touched: [machine.id], message: '待機中の出玉を未割当として記録しました', result: { duplicate: false, unassigned: true, unassignedId: entry.id } };
  }
  // TODO(DECISION-C03): generation matching is the §15 C03 proposal.
  if (a.generation && a.generation !== machine.generation) {
    const entry = addUnassigned(s, machine, ctx, { ...base, reason: 'GENERATION_MISMATCH', countsInventory: true });
    return { touched: [machine.id], message: '別の受付世代の出玉を未割当として記録しました', result: { duplicate: false, unassigned: true, unassignedId: entry.id } };
  }
  const session = s.sessions[machine.activeSessionId];
  let reviewReason = null;
  if (!a.generation) reviewReason = 'NO_GENERATION';
  if (a.detectedAt) {
    const delay = (Date.parse(ctx.now) - Date.parse(a.detectedAt)) / 1000;
    if (Number.isFinite(delay) && delay >= s.settings.lateEventSeconds) reviewReason = 'LATE';
  }
  if (isStopped(machine)) reviewReason = 'EMERGENCY';
  const ball = newBall(s, ctx, { ...base, orderUncertain: a.orderUncertain === true, reviewReason, by: null });
  countBall(machine, ball, { strict: false });
  session.balls.push(ball);
  reconcileSession(s, session);
  return {
    touched: [machine.id],
    message: `自動読取 ${ball.order}個目 ${color ? COLOR_LABELS[color] : '色未判定'}`,
    result: { duplicate: false, sessionId: session.id, order: ball.order, kind: ball.kind, needsReview: needsReview(ball) },
  };
}

export function resolveUnassigned(s, a, ctx) {
  const entry = s.unassigned.find((u) => u.id === a.unassignedId);
  if (!entry) fail('UNKNOWN_UNASSIGNED', '未割当玉が見つかりません', { status: 404 });
  if (entry.resolvedAt) fail('ALREADY_RESOLVED', 'この未割当玉は処理済みです');
  const reason = requireReason(a.reason);
  const machine = machineOf(s, a.returnToMachineId ?? entry.machineId);
  if (a.disposition === 'returnToMachine') {
    // Only a counted ball moves back in the ledger. An uncounted one (colour
    // unknown or ledger already 0) never left the books; a mismatch found
    // here is fixed by a stocktake with adjustInventory.
    if (entry.countedColor) machine.contents[entry.countedColor] += 1;
  } else if (a.disposition === 'dismiss') {
    // Recorded only (e.g. duplicate of a manual entry). Inventory is restored if it was counted.
    if (entry.countedColor) machineOf(s, entry.machineId).contents[entry.countedColor] += 1;
  } else {
    invalid('disposition must be returnToMachine or dismiss');
  }
  entry.resolvedAt = ctx.now;
  entry.resolution = { disposition: a.disposition, reason, by: ctx.actor?.name ?? null, machineId: machine.id };
  return { touched: [entry.machineId, machine.id], message: '未割当玉を処理しました', result: { unassignedId: entry.id } };
}


export { COLORS };
