const toCard = (r) => r && ({
  id: r.card_id, kind: r.kind, createdAt: r.created_at,
  usedSessionId: r.used_session_id, usedMachineId: r.used_machine_id, usedAt: r.used_at,
});

export function insertCard(db, { id, kind, tokenHash = null, createdAt }) {
  db.prepare('INSERT INTO cards (card_id, kind, token_hash, created_at) VALUES (?, ?, ?, ?)').run(id, kind, tokenHash, createdAt);
}

export function findCardByTokenHash(db, tokenHash) {
  return toCard(db.prepare('SELECT * FROM cards WHERE token_hash = ?').get(tokenHash));
}

export function findCardById(db, cardId) {
  return toCard(db.prepare('SELECT * FROM cards WHERE card_id = ?').get(cardId));
}

/** Only an unused card can be marked; 0 changed rows means someone else used it first. */
export function markCardUsed(db, { cardId, sessionId, machineId, at, intake }) {
  const r = db.prepare(`UPDATE cards SET used_session_id = ?, used_machine_id = ?, used_at = ?, intake_json = ?
    WHERE card_id = ? AND used_at IS NULL`).run(sessionId, machineId, at, JSON.stringify(intake ?? null), cardId);
  return r.changes === 1;
}

export function listStamps(db, cardId) {
  return db.prepare('SELECT cell_index, point_id, stamped_at FROM stamps WHERE card_id = ? ORDER BY cell_index')
    .all(cardId).map((r) => ({ cellIndex: r.cell_index, pointId: r.point_id, stampedAt: r.stamped_at }));
}

export function insertStamp(db, { cardId, cellIndex, pointId, at, actor }) {
  db.prepare('INSERT INTO stamps (card_id, cell_index, point_id, stamped_at, actor) VALUES (?, ?, ?, ?, ?)')
    .run(cardId, cellIndex, pointId, at, actor);
}

export function hasStampFromPoint(db, cardId, pointId) {
  return Boolean(db.prepare('SELECT 1 FROM stamps WHERE card_id = ? AND point_id = ?').get(cardId, pointId));
}

const toPoint = (r) => r && ({ id: r.point_id, name: r.name, cellIndex: r.cell_index, category: r.category, active: r.active === 1 });

export function findStampPointByTokenHash(db, tokenHash) {
  return toPoint(db.prepare('SELECT * FROM stamp_points WHERE token_hash = ?').get(tokenHash));
}

export function listStampPoints(db) {
  return db.prepare('SELECT * FROM stamp_points ORDER BY cell_index, point_id').all().map(toPoint);
}

export function upsertStampPoint(db, { id, name, cellIndex = null, category = null, tokenHash, at }) {
  db.prepare(`INSERT INTO stamp_points (point_id, name, cell_index, category, token_hash, active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(point_id) DO UPDATE SET name = excluded.name, cell_index = excluded.cell_index,
      category = excluded.category, token_hash = excluded.token_hash, active = 1`)
    .run(id, name, cellIndex, category, tokenHash, at);
}

export function cardStats(db) {
  return db.prepare(`SELECT kind, COUNT(*) AS total, SUM(used_at IS NOT NULL) AS used FROM cards GROUP BY kind`).all();
}

export function deactivateStampPointsForCells(db, cellIndexes) {
  for (const i of cellIndexes) db.prepare("UPDATE stamp_points SET active = 0 WHERE cell_index = ? AND token_hash NOT LIKE 'tap-only:%'").run(i);
}

export function findTapPoint(db, cellIndex) {
  const r = db.prepare("SELECT * FROM stamp_points WHERE cell_index = ? AND token_hash LIKE 'tap-only:%' AND active = 1").get(cellIndex);
  return r ? { id: r.point_id, name: r.name, cellIndex: r.cell_index } : null;
}
