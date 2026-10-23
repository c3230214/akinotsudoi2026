import { fail, invalid } from '../errors.js';
import { machineOf } from './state.js';

function requireReason(reason) {
  if (typeof reason !== 'string' || reason.trim().length < 2) invalid('理由を入力してください');
  return reason.trim().slice(0, 500);
}

/**
 * Software stop only. It blocks intake and finalisation for the machine; it
 * does not and cannot stop the physical machine (§5).
 */
export function emergencyStop(s, a, ctx) {
  const m = machineOf(s, a.machineId);
  if (m.emergency) fail('ALREADY_STOPPED', `${m.name}はすでに緊急停止中です`);
  m.emergency = { at: ctx.now, by: ctx.actor?.name ?? null, reason: typeof a.reason === 'string' ? a.reason.slice(0, 500) : '' };
  return { touched: [m.id], message: `${m.name}を緊急停止（ソフトウェア上）にしました`, result: {} };
}

/** Clearing the stop does not resume anything by itself (§5, §15 C11). */
export function clearEmergency(s, a) {
  const m = machineOf(s, a.machineId);
  if (!m.emergency) fail('NOT_STOPPED', `${m.name}は緊急停止中ではありません`);
  requireReason(a.reason);
  m.emergency = null;
  m.resumeRequired = true;
  return { touched: [m.id], message: `${m.name}の緊急停止を解除しました。再開操作を行うまで受付・確定はできません`, result: {} };
}

export function resumeDrawing(s, a) {
  const m = machineOf(s, a.machineId);
  if (m.emergency) fail('EMERGENCY_STOPPED', '先に緊急停止を解除してください');
  if (!m.resumeRequired) fail('NOT_WAITING_RESUME', '再開待ちではありません');
  m.resumeRequired = false;
  return { touched: [m.id], message: `${m.name}を再開しました`, result: {} };
}
