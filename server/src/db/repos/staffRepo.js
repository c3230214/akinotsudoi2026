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
