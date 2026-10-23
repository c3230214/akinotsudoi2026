import { fail, invalid } from '../errors.js';
import { activeBalls, gradeOf, isStopped, machineOf, sessionOf } from './state.js';
import { needsReview, sessionSummary } from './balls.js';

function requireReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length < 2) invalid('理由を入力してください');
  return reason.trim().slice(0, 500);
}

function queuePrint(s, session, ctx, kind) {
  s.printJobCounter += 1;
  const job = { jobId: `pj-${s.printJobCounter}`, kind, status: 'queued', queuedAt: ctx.now, updatedAt: ctx.now, by: ctx.actor?.name ?? null, note: null };
  session.voucher.jobs.push(job);
  session.voucher.printStatus = 'queued';
  return job;
}

/**
 * Stop confirmation, collection confirmation and the print request are
 * recorded together (§7). This is a software record; it does not prove the
 * tray is physically empty (§15 C12), so the operator must tick trayEmptied.
 */
export function finalizeResult(s, a, ctx) {
  const machine = machineOf(s, a.machineId);
  const session = sessionOf(s, a.sessionId);
  if (machine.activeSessionId !== session.id || session.status !== 'drawing') {
    fail('SESSION_NOT_ACTIVE', 'この抽選は進行中ではありません。画面を最新にしてください');
  }
  if (isStopped(machine)) fail('EMERGENCY_STOPPED', `${machine.name}は停止中のため結果を確定できません`);
  if (a.trayEmptied !== true) fail('TRAY_NOT_CONFIRMED', '受け皿を空にしたことを確認してください', { status: 422 });
  const summary = sessionSummary(session);
  if (summary.count < session.n) fail('NOT_ENOUGH_BALLS', `あと${session.n - summary.count}個の出玉が必要です`);
  if (summary.review > 0) fail('REVIEW_PENDING', '要確認の玉があります。色と順番を確定してください');
  if (summary.shortage > 0) fail('PRIZE_SHORTAGE', '景品不足で保留中の玉があります。担当者の判断が必要です');

  for (const ball of activeBalls(session)) {
    if (ball.kind === 'valid') s.storedValid[ball.color] += 1;
    else machine.returnPending[ball.color] += 1;
  }
  const prizes = activeBalls(session).filter((b) => b.kind === 'valid').map((b) => {
    const g = gradeOf(s, b.color);
    return { color: b.color, grade: g.grade, prize: g.prize };
  });
  session.status = 'finalized';
  session.finalizedAt = ctx.now;
  session.finalizedBy = ctx.actor?.name ?? null;
  session.voucher = {
    number: session.id,
    prizes,
    printStatus: 'none',
    everDispatched: false,
    operatorConfirmed: false,
    manual: null,
    jobs: [],
    redeemedAt: null,
    redeemedBy: null,
  };
  queuePrint(s, session, ctx, 'initial');
  machine.phase = 'idle';
  machine.activeSessionId = null;
  machine.generation = null;
  return {
    touched: [machine.id],
    message: `${session.id} を確定し、引換券の印刷を依頼しました`,
    result: { sessionId: session.id, voucher: session.id, prizes },
    events: [{ topic: 'print', sessionId: session.id }],
  };
}

const PRINT_OUTCOMES = ['dispatched', 'confirmed', 'failed'];

/**
 * dispatched = the print-station browser called window.print();
 * confirmed / failed = a person checked the paper (§15 C13).
 */
export function recordPrintResult(s, a, ctx) {
  const session = sessionOf(s, a.sessionId);
  if (!session.voucher) fail('NO_VOUCHER', 'この抽選の引換券はまだ発行されていません');
  if (!PRINT_OUTCOMES.includes(a.outcome)) invalid('outcome must be dispatched, confirmed or failed');
  const job = session.voucher.jobs.find((j) => j.jobId === a.jobId);
  if (!job) fail('UNKNOWN_PRINT_JOB', '印刷ジョブが見つかりません', { status: 404 });
  if (a.outcome === 'dispatched' && job.status !== 'queued') {
    return { touched: [session.machineId], message: '印刷済みとして記録済みです', result: { jobId: job.jobId, status: job.status } };
  }
  job.status = a.outcome;
  job.updatedAt = ctx.now;
  job.note = typeof a.note === 'string' ? a.note.slice(0, 200) : null;
  if (a.outcome === 'dispatched') session.voucher.everDispatched = true;
  if (a.outcome === 'confirmed') session.voucher.operatorConfirmed = true;
  session.voucher.printStatus = a.outcome;
  const events = [{ topic: 'print', sessionId: session.id }];
  if (a.outcome === 'failed' && a.reprint !== false) {
    queuePrint(s, session, ctx, 'reprint');
  }
  return { touched: [session.machineId], message: `${session.id} 印刷：${a.outcome}`, result: { jobId: job.jobId, status: job.status }, events };
}

export function requestReprint(s, a, ctx) {
  const session = sessionOf(s, a.sessionId);
  if (!session.voucher) fail('NO_VOUCHER', 'この抽選の引換券はまだ発行されていません');
  const reason = requireReason(a.reason);
  if (session.voucher.redeemedAt) fail('ALREADY_REDEEMED', '引換済みの券は再印刷できません');
  const job = queuePrint(s, session, ctx, 'reprint');
  job.note = reason;
  return { touched: [session.machineId], message: `${session.id} を同じ券番号で再印刷します`, result: { jobId: job.jobId }, events: [{ topic: 'print', sessionId: session.id }] };
}

/** TODO(DECISION-C05): hand-written vouchers; only active when the setting allows it. */
export function markManualVoucher(s, a, ctx) {
  if (!s.settings.allowManualVoucher) fail('MANUAL_VOUCHER_DISABLED', '手書き券の記録は運営の承認待ちのため無効です');
  const session = sessionOf(s, a.sessionId);
  if (!session.voucher) fail('NO_VOUCHER', 'この抽選の結果はまだ確定していません');
  const reason = requireReason(a.reason);
  session.voucher.manual = { at: ctx.now, by: ctx.actor?.name ?? null, reason };
  return { touched: [session.machineId], message: `${session.id} を手書き券として記録しました`, result: { sessionId: session.id } };
}

export function normalizeVoucherNumber(text) {
  if (typeof text !== 'string') invalid('券番号を入力してください');
  const m = text.trim().toUpperCase().match(/^(?:MARUGOTO2026:VOUCHER:)?(?:BM-?)?(\d{1,6})$/);
  if (!m) invalid('券番号の形式が正しくありません（例：BM-0003）');
  return `BM-${m[1].padStart(4, '0')}`;
}

export function redeemPrize(s, a, ctx) {
  const id = normalizeVoucherNumber(a.voucher);
  const session = s.sessions[id];
  if (!session || !session.voucher) fail('UNKNOWN_VOUCHER', `券番号 ${id} は発行されていません`, { status: 404 });
  const v = session.voucher;
  if (v.redeemedAt) fail('ALREADY_REDEEMED', `${id} は ${v.redeemedAt} に引換済みです`, { details: { redeemedAt: v.redeemedAt } });
  if (!v.everDispatched && !v.operatorConfirmed && !v.manual) {
    fail('NOT_PRINTED', `${id} はまだ印刷されていません`);
  }
  v.redeemedAt = ctx.now;
  v.redeemedBy = ctx.actor?.name ?? null;
  for (const p of v.prizes) s.prizes[p.color].redeemed += 1;
  return { touched: [session.machineId], message: `${id} を引換済みにしました`, result: { voucher: id, prizes: v.prizes } };
}

export { needsReview };
