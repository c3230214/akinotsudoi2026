import { fail } from '../errors.js';
import { startSession } from './intake.js';
import {
  ballDetected, correctBall, manualBall, removeManualBall, resolveUnassigned, retryShortage, voidBall,
} from './balls.js';
import {
  finalizeResult, markManualVoucher, recordPrintResult, redeemPrize, requestReprint,
} from './finish.js';
import {
  addRefillPlan, adjustInventory, refillPlanned, returnBalls, setCameraAssist, setInputMode, setInventory,
} from './inventory.js';
import { clearEmergency, emergencyStop, resumeDrawing, setIntakeClosed } from './safety.js';
import { updateSettings } from './settings.js';
import { adjustPrizeTotal, rebalanceBalls } from './ballPlan.js';

export const HANDLERS = Object.freeze({
  startSession,
  manualBall,
  removeManualBall,
  correctBall,
  voidBall,
  retryShortage,
  ballDetected,
  resolveUnassigned,
  finalizeResult,
  recordPrintResult,
  requestReprint,
  markManualVoucher,
  redeemPrize,
  setInventory,
  adjustInventory,
  returnBalls,
  addRefillPlan,
  refillPlanned,
  setInputMode,
  setCameraAssist,
  rebalanceBalls,
  adjustPrizeTotal,
  emergencyStop,
  clearEmergency,
  resumeDrawing,
  setIntakeClosed,
  updateSettings,
});

/**
 * Pure state transition. The input state is never mutated; on a DomainError
 * the caller keeps the previous state.
 *
 * @param {object} state
 * @param {{type: string}} action
 * @param {{now: string, actor?: object, deviceOnline?: Record<string, boolean>}} ctx
 */
export function transition(state, action, ctx) {
  const handler = Object.hasOwn(HANDLERS, action?.type) ? HANDLERS[action.type] : null;
  if (!handler) fail('UNKNOWN_COMMAND', `unknown command ${action?.type}`, { status: 422 });
  const next = structuredClone(state);
  const out = handler(next, action, ctx);
  next.revision += 1;
  for (const id of new Set(out.touched ?? [])) {
    if (next.machines[id]) next.machines[id].revision += 1;
  }
  return {
    state: next,
    message: out.message,
    result: out.result ?? {},
    touched: [...new Set(out.touched ?? [])],
    events: out.events ?? [],
  };
}
