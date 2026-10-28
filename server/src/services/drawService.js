import { tx } from '../db/connection.js';
import { appendActionLog, findOperation, insertOperation, loadSnapshot, saveSnapshot } from '../db/repos/drawRepo.js';
import { DomainError, fail } from '../domain/errors.js';
import { initialState } from '../domain/draw/state.js';
import { transition } from '../domain/draw/transition.js';
import { toStaffView } from '../domain/draw/projections.js';
import { sha256 } from './secrets.js';

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export const requestHash = (body) => sha256(canonical(body));

const OPERATION_ID_RE = /^[A-Za-z0-9_-]{8,80}$/;

/**
 * Serialises every draw/inventory command: one command = one DB transaction
 * covering the snapshot, the action log, the idempotency record and any extra
 * rows (card used, device event). Memory is updated only after COMMIT, and
 * SSE is published after that; a failed publish never rolls back the DB.
 */
export function createDrawService({ db, bus, clock, deviceOnline = () => ({}) }) {
  let state = loadSnapshot(db);
  if (!state) {
    state = initialState();
    tx(db, () => saveSnapshot(db, state, clock()));
  }

  function execute({ action, actor, operationId = null, requestBody = null, before = null, after = null }) {
    const at = clock();
    const actorKey = `${actor.kind}:${actor.id}`;
    let committed;
    try {
      committed = tx(db, () => {
        if (operationId !== null) {
          if (typeof operationId !== 'string' || !OPERATION_ID_RE.test(operationId)) {
            throw new DomainError('VALIDATION_FAILED', 'operationId must be 8..80 URL-safe characters', { status: 422 });
          }
          // §15 C08: an existing key is answered before any revision check.
          const prev = findOperation(db, operationId);
          if (prev) {
            if (prev.actor_key !== actorKey || prev.request_hash !== requestHash(requestBody ?? action)) {
              fail('OPERATION_ID_REUSED', 'この操作IDは別の内容で使用済みです', { status: 409 });
            }
            return { replay: true, response: { ...JSON.parse(prev.response_json), duplicate: true } };
          }
        }
        if (before) {
          const short = before(state);
          if (short) return { replay: true, response: short };
        }
        const out = transition(state, action, { now: at, actor, deviceOnline: deviceOnline() });
        const extra = after ? after(out, at) : undefined;
        const response = { ok: true, message: out.message, result: { ...out.result, ...(extra ?? {}) }, revision: out.state.revision, machineRevisions: Object.fromEntries(out.touched.map((id) => [id, out.state.machines[id]?.revision])) };
        saveSnapshot(db, out.state, at);
        appendActionLog(db, { at, actor, type: action.type, action, result: 'ok', message: out.message, revisionAfter: out.state.revision });
        if (operationId !== null) insertOperation(db, { operationId, actorKey, requestHash: requestHash(requestBody ?? action), response, at });
        return { replay: false, response, out };
      });
    } catch (error) {
      if (error instanceof DomainError) {
        try {
          tx(db, () => appendActionLog(db, { at, actor, type: String(action?.type ?? 'unknown'), action, result: `rejected:${error.code}`, message: error.message, revisionAfter: state.revision }));
        } catch { /* logging a rejection must not mask the original error */ }
      }
      throw error;
    }
    if (!committed.replay) {
      state = committed.out.state;
      try {
        bus.publish('draw', { touched: committed.out.touched, events: committed.out.events, revision: state.revision });
      } catch { /* clients recover by refetching */ }
    }
    return committed.response;
  }

  return {
    execute,
    getState: () => state,
    getStaffView: (extras = {}) => toStaffView(state, { now: clock(), ...extras }),
    /** Re-read the snapshot (used after a restore). */
    reload() { state = loadSnapshot(db) ?? state; },
  };
}
