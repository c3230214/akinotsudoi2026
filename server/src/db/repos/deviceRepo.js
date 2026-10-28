export function findMachineByTokenHash(db, tokenHash) {
  const r = db.prepare('SELECT machine_id FROM machines WHERE device_token_hash = ?').get(tokenHash);
  return r ? r.machine_id : null;
}

export function setDeviceToken(db, machineId, tokenHash, at) {
  db.prepare(`INSERT INTO machines (machine_id, device_token_hash, token_issued_at) VALUES (?, ?, ?)
    ON CONFLICT(machine_id) DO UPDATE SET device_token_hash = excluded.device_token_hash, token_issued_at = excluded.token_issued_at`)
    .run(machineId, tokenHash, at);
}

export function recordHeartbeat(db, machineId, { bootId, at, payload }) {
  db.prepare('UPDATE machines SET last_heartbeat_at = ?, boot_id = ?, heartbeat_json = ? WHERE machine_id = ?')
    .run(at, bootId, JSON.stringify(payload), machineId);
}

export function listMachineRows(db) {
  return db.prepare('SELECT machine_id, token_issued_at, last_heartbeat_at, boot_id, heartbeat_json FROM machines').all()
    .map((r) => ({ machineId: r.machine_id, tokenIssuedAt: r.token_issued_at, lastHeartbeatAt: r.last_heartbeat_at, bootId: r.boot_id, heartbeat: r.heartbeat_json ? JSON.parse(r.heartbeat_json) : null }));
}

export function findDeviceEvent(db, { machineId, bootId, stream, seq }) {
  const r = db.prepare('SELECT payload_hash, outcome_json FROM device_events WHERE machine_id = ? AND boot_id = ? AND stream = ? AND seq = ?')
    .get(machineId, bootId, stream, seq);
  return r ? { payloadHash: r.payload_hash, outcome: JSON.parse(r.outcome_json) } : null;
}

export function insertDeviceEvent(db, e) {
  db.prepare(`INSERT INTO device_events (machine_id, boot_id, stream, seq, received_at, detected_at, payload_hash, payload_json, outcome_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(e.machineId, e.bootId, e.stream, e.seq, e.receivedAt, e.detectedAt ?? null, e.payloadHash, JSON.stringify(e.payload), JSON.stringify(e.outcome));
}

export function lastSeqOf(db, { machineId, bootId, stream }) {
  const r = db.prepare('SELECT last_seq FROM device_streams WHERE machine_id = ? AND boot_id = ? AND stream = ?').get(machineId, bootId, stream);
  return r ? r.last_seq : 0;
}

export function setLastSeq(db, { machineId, bootId, stream, seq, at }) {
  db.prepare(`INSERT INTO device_streams (machine_id, boot_id, stream, last_seq, first_seen_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(machine_id, boot_id, stream) DO UPDATE SET last_seq = excluded.last_seq`).run(machineId, bootId, stream, seq, at);
}

export function listStreams(db, machineId) {
  return db.prepare('SELECT boot_id, stream, last_seq, first_seen_at FROM device_streams WHERE machine_id = ? ORDER BY first_seen_at DESC LIMIT 6').all(machineId)
    .map((r) => ({ bootId: r.boot_id, stream: r.stream, lastSeq: r.last_seq, firstSeenAt: r.first_seen_at }));
}

const toRead = (r) => r && ({
  readId: r.read_id, machineId: r.machine_id, kind: r.kind, cells: r.cells_json ? JSON.parse(r.cells_json) : null,
  cornerPresent: r.corner_present === null ? null : r.corner_present === 1, hasQr: r.qr_payload_present === 1,
  qrCardId: r.qr_card_id, qrError: r.qr_error,
  readAt: r.read_at, receivedAt: r.received_at, imageId: r.image_id, status: r.status, sessionId: r.session_id,
});

/** A new read replaces the previous pending one for that machine. */
export function insertCardRead(db, read) {
  db.prepare("UPDATE card_reads SET status = 'superseded' WHERE machine_id = ? AND status = 'pending'").run(read.machineId);
  return Number(db.prepare(`INSERT INTO card_reads (machine_id, boot_id, read_seq, kind, cells_json, corner_present, qr_payload_present, qr_card_id, qr_error, read_at, received_at, image_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`).run(
    read.machineId, read.bootId, read.readSeq, read.kind, read.cells ? JSON.stringify(read.cells) : null,
    read.cornerPresent === null || read.cornerPresent === undefined ? null : (read.cornerPresent ? 1 : 0),
    read.hasQr ? 1 : 0, read.qrCardId ?? null, read.qrError ?? null, read.readAt ?? null, read.receivedAt, read.imageId ?? null,
  ).lastInsertRowid);
}

export function pendingCardRead(db, machineId) {
  return toRead(db.prepare("SELECT * FROM card_reads WHERE machine_id = ? AND status = 'pending' ORDER BY read_id DESC LIMIT 1").get(machineId));
}

export function findCardRead(db, readId) {
  return toRead(db.prepare('SELECT * FROM card_reads WHERE read_id = ?').get(readId));
}

export function closeCardRead(db, readId, status, sessionId = null) {
  return db.prepare("UPDATE card_reads SET status = ?, session_id = ? WHERE read_id = ? AND status = 'pending'").run(status, sessionId, readId).changes === 1;
}

export function insertImage(db, img) {
  db.prepare('INSERT INTO images (image_id, machine_id, file_name, mime, bytes, created_at, delete_after) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(img.imageId, img.machineId, img.fileName, img.mime, img.bytes, img.createdAt, img.deleteAfter);
}

export function findImage(db, imageId) {
  const r = db.prepare('SELECT * FROM images WHERE image_id = ?').get(imageId);
  return r ? { imageId: r.image_id, machineId: r.machine_id, fileName: r.file_name, mime: r.mime, bytes: r.bytes, deleteAfter: r.delete_after } : null;
}

export function listExpiredImages(db, nowIso) {
  return db.prepare('SELECT image_id, file_name FROM images WHERE delete_after < ?').all(nowIso).map((r) => ({ imageId: r.image_id, fileName: r.file_name }));
}

export function deleteImageRow(db, imageId) {
  db.prepare('DELETE FROM images WHERE image_id = ?').run(imageId);
}

export function nextReadSeq(db, machineId, bootId) {
  return db.prepare('SELECT COALESCE(MAX(read_seq), 0) + 1 AS n FROM card_reads WHERE machine_id = ? AND boot_id = ?').get(machineId, bootId).n;
}
