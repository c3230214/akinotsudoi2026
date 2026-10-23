const toStaff = (r) => r && ({
  id: r.staff_id, loginName: r.login_name, displayName: r.display_name, role: r.role,
  passcodeHash: r.passcode_hash, active: r.active === 1, createdAt: r.created_at,
});

export function findStaffByLogin(db, loginName) {
  return toStaff(db.prepare('SELECT * FROM staff WHERE login_name = ?').get(loginName));
}

export function findStaffById(db, staffId) {
  return toStaff(db.prepare('SELECT * FROM staff WHERE staff_id = ?').get(staffId));
}

export function listStaff(db) {
  return db.prepare('SELECT * FROM staff ORDER BY staff_id').all().map((r) => {
    const { passcodeHash, ...rest } = toStaff(r);
    return rest;
  });
}

export function insertStaff(db, { loginName, displayName, role, passcodeHash, at }) {
  return Number(db.prepare('INSERT INTO staff (login_name, display_name, role, passcode_hash, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(loginName, displayName, role, passcodeHash, at).lastInsertRowid);
}

export function updateStaff(db, staffId, { displayName, role, passcodeHash, active }) {
  const cur = db.prepare('SELECT * FROM staff WHERE staff_id = ?').get(staffId);
  if (!cur) return false;
  db.prepare('UPDATE staff SET display_name = ?, role = ?, passcode_hash = ?, active = ? WHERE staff_id = ?').run(
    displayName ?? cur.display_name, role ?? cur.role, passcodeHash ?? cur.passcode_hash,
    active === undefined ? cur.active : (active ? 1 : 0), staffId,
  );
  if (active === false || passcodeHash) db.prepare('DELETE FROM staff_sessions WHERE staff_id = ?').run(staffId);
  return true;
}

export function insertSession(db, { sessionHash, staffId, at, expiresAt }) {
  db.prepare('INSERT INTO staff_sessions (session_hash, staff_id, machine_id, created_at, expires_at) VALUES (?, ?, NULL, ?, ?)')
    .run(sessionHash, staffId, at, expiresAt);
}

export function findSession(db, sessionHash) {
  const r = db.prepare(`SELECT s.session_hash, s.machine_id, s.expires_at, st.* FROM staff_sessions s
    JOIN staff st ON st.staff_id = s.staff_id WHERE s.session_hash = ?`).get(sessionHash);
  if (!r) return null;
  return { sessionHash: r.session_hash, machineId: r.machine_id, expiresAt: r.expires_at, staff: toStaff(r) };
}

export function setSessionMachine(db, sessionHash, machineId) {
  db.prepare('UPDATE staff_sessions SET machine_id = ? WHERE session_hash = ?').run(machineId, sessionHash);
}

export function deleteSession(db, sessionHash) {
  db.prepare('DELETE FROM staff_sessions WHERE session_hash = ?').run(sessionHash);
}

export function deleteExpiredSessions(db, nowIso) {
  // Stored values share one +09:00 format, so string comparison orders correctly.
  db.prepare('DELETE FROM staff_sessions WHERE expires_at < ?').run(nowIso);
}

export function insertKioskPairing(db, { codeHash, machineId, expiresAt, createdBy }) {
  db.prepare('INSERT INTO kiosk_pairings (code_hash, machine_id, expires_at, used_at, created_by) VALUES (?, ?, ?, NULL, ?)')
    .run(codeHash, machineId, expiresAt, createdBy);
}

/** One-time use: the UPDATE only succeeds for an unused, unexpired code. */
export function consumeKioskPairing(db, codeHash, nowIso) {
  const row = db.prepare('SELECT machine_id FROM kiosk_pairings WHERE code_hash = ? AND used_at IS NULL AND expires_at >= ?').get(codeHash, nowIso);
  if (!row) return null;
  const r = db.prepare('UPDATE kiosk_pairings SET used_at = ? WHERE code_hash = ? AND used_at IS NULL').run(nowIso, codeHash);
  return r.changes === 1 ? row.machine_id : null;
}

export function insertKioskDevice(db, { kioskId, tokenHash, machineId, at }) {
  db.prepare('INSERT INTO kiosk_devices (kiosk_id, token_hash, machine_id, created_at) VALUES (?, ?, ?, ?)').run(kioskId, tokenHash, machineId, at);
}

export function findKioskByTokenHash(db, tokenHash) {
  const r = db.prepare('SELECT kiosk_id, machine_id FROM kiosk_devices WHERE token_hash = ? AND revoked_at IS NULL').get(tokenHash);
  return r ? { kioskId: r.kiosk_id, machineId: r.machine_id } : null;
}

export function listKiosks(db) {
  return db.prepare('SELECT kiosk_id, machine_id, created_at, revoked_at FROM kiosk_devices ORDER BY created_at').all()
    .map((r) => ({ kioskId: r.kiosk_id, machineId: r.machine_id, createdAt: r.created_at, revokedAt: r.revoked_at }));
}

export function revokeKiosk(db, kioskId, at) {
  return db.prepare('UPDATE kiosk_devices SET revoked_at = ? WHERE kiosk_id = ? AND revoked_at IS NULL').run(at, kioskId).changes === 1;
}
