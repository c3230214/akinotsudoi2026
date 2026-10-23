export function loadSnapshot(db) {
  const row = db.prepare('SELECT revision, state_json FROM draw_snapshot WHERE id = 1').get();
  return row ? JSON.parse(row.state_json) : null;
}

export function saveSnapshot(db, state, at) {
  db.prepare(`INSERT INTO draw_snapshot (id, revision, state_json, saved_at) VALUES (1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, state_json = excluded.state_json, saved_at = excluded.saved_at`)
    .run(state.revision, JSON.stringify(state), at);
}

export function appendActionLog(db, { at, actor, type, action, result, message = null, revisionAfter = null }) {
  return db.prepare(`INSERT INTO action_log (at, actor_json, action_type, action_json, result, message, revision_after)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(at, JSON.stringify(actor ?? {}), type, JSON.stringify(action ?? {}), result, message, revisionAfter).lastInsertRowid;
}

export function listActionLog(db, { before = null, limit = 50, type = null } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const rows = db.prepare(`SELECT seq, at, actor_json, action_type, action_json, result, message, revision_after FROM action_log
    WHERE (? IS NULL OR seq < ?) AND (? IS NULL OR action_type = ?) ORDER BY seq DESC LIMIT ?`)
    .all(before, before, type, type, lim);
  return rows.map((r) => ({
    seq: r.seq, at: r.at, actor: JSON.parse(r.actor_json), type: r.action_type,
    action: JSON.parse(r.action_json), result: r.result, message: r.message, revisionAfter: r.revision_after,
  }));
}

export function findOperation(db, operationId) {
  return db.prepare('SELECT operation_id, actor_key, request_hash, response_json FROM operations WHERE operation_id = ?').get(operationId) ?? null;
}

export function insertOperation(db, { operationId, actorKey, requestHash, response, at }) {
  db.prepare('INSERT INTO operations (operation_id, actor_key, request_hash, response_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(operationId, actorKey, requestHash, JSON.stringify(response), at);
}
