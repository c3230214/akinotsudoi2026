import fs from 'node:fs';
import path from 'node:path';
import { tx } from '../db/connection.js';
import {
  nextReadSeq, findDeviceEvent, findImage, findMachineByTokenHash, insertCardRead, insertDeviceEvent, insertImage, lastSeqOf,
  lastReadIds, listMachineRows, listStreams, pendingCardRead, pendingReadForCard, recordHeartbeat, setLastSeq,
} from '../db/repos/deviceRepo.js';
import { DomainError, fail, invalid } from '../domain/errors.js';
import { validateMarks, COLORS, completeLines, entitledDraws } from '../domain/rules.js';
import { addMs } from '../time.js';
import { randomToken, sha256 } from './secrets.js';
import { requestHash } from './drawService.js';

const HEARTBEAT_TIMEOUT_MS = 15_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const IMAGE_ID_RE = /^img_[A-Za-z0-9_-]{16,40}$/;

function checkCommon(body, machineId, seqKey) {
  if (!body || typeof body !== 'object') invalid('JSON body required');
  if (body.machineId !== machineId) fail('MACHINE_MISMATCH', 'machineId does not match the device token', { status: 403 });
  if (typeof body.bootId !== 'string' || !UUID_RE.test(body.bootId)) invalid('bootId must be a UUID');
  if (!Number.isInteger(body[seqKey]) || body[seqKey] < 1 || body[seqKey] > 1e9) invalid(`${seqKey} must be a positive integer`);
}

export function createDeviceService({ db, clock, draw, bus, imageDir, imageRetentionDays, cards }) {
  const online = new Map();
  for (const row of listMachineRows(db)) if (row.lastHeartbeatAt) online.set(row.machineId, Date.parse(row.lastHeartbeatAt));

  const isOnline = (machineId, at = Date.parse(clock())) => {
    const last = online.get(machineId);
    return last !== undefined && at - last <= HEARTBEAT_TIMEOUT_MS;
  };

  function deviceOnlineMap() {
    const at = Date.parse(clock());
    return Object.fromEntries(Object.keys(draw.getState().machines).map((id) => [id, isOnline(id, at)]));
  }

  function authenticate(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 200) return null;
    return findMachineByTokenHash(db, sha256(token));
  }

  /**
   * Sequence handling shared by ball and card streams (§8.1, §15 C09/C10):
   * same key + same body = duplicate replay, same key + different body = 409,
   * a skipped number = 409 SEQ_GAP. Each (machine, boot, stream) is independent.
   */
  function sequenced(stream, machineId, body, seq) {
    const key = { machineId, bootId: body.bootId, stream, seq };
    const hash = requestHash(body);
    const prev = findDeviceEvent(db, key);
    if (prev) {
      if (prev.payloadHash !== hash) fail('DUPLICATE_KEY_DIFFERENT_PAYLOAD', 'the same seq was already received with different content', { status: 409 });
      return { duplicate: true, outcome: prev.outcome };
    }
    const expectedSeq = lastSeqOf(db, key) + 1;
    if (seq !== expectedSeq) fail('SEQ_GAP', `expected seq ${expectedSeq}`, { status: 409, details: { expectedSeq } });
    return { duplicate: false, key, hash };
  }

  function receiveBallEvent(machineId, body) {
    checkCommon(body, machineId, 'seq');
    if (body.detectedColor !== null && !COLORS.includes(body.detectedColor)) invalid('detectedColor must be a color or null');
    if (body.orderUncertain !== undefined && typeof body.orderUncertain !== 'boolean') invalid('orderUncertain must be boolean');
    if (body.detectedAt !== undefined && (typeof body.detectedAt !== 'string' || !ISO_RE.test(body.detectedAt))) invalid('detectedAt must be ISO 8601 with offset');
    if (body.generation !== undefined && body.generation !== null && (typeof body.generation !== 'string' || body.generation.length > 40)) invalid('generation must be a string');
    if (body.imageId !== undefined && body.imageId !== null && !IMAGE_ID_RE.test(body.imageId)) invalid('imageId is malformed');
    if (body.confidence !== undefined && (typeof body.confidence !== 'number' || body.confidence < 0 || body.confidence > 1)) invalid('confidence must be 0..1');

    let seqInfo;
    const response = draw.execute({
      actor: { kind: 'device', id: machineId, name: `${machineId} C2` },
      action: {
        type: 'ballDetected', machineId, generation: body.generation ?? null, detectedColor: body.detectedColor,
        orderUncertain: body.orderUncertain === true, detectedAt: body.detectedAt ?? null,
        deviceRef: { bootId: body.bootId, seq: body.seq, imageId: body.imageId ?? null, confidence: body.confidence ?? null },
      },
      before: () => {
        seqInfo = sequenced('ball', machineId, body, body.seq);
        return seqInfo.duplicate ? { ...seqInfo.outcome, duplicate: true } : null;
      },
      after: (out, at) => {
        insertDeviceEvent(db, { ...seqInfo.key, receivedAt: at, detectedAt: body.detectedAt ?? null, payloadHash: seqInfo.hash, payload: body, outcome: out.result });
        setLastSeq(db, { ...seqInfo.key, at });
      },
    });
    return response.duplicate ? response : response.result;
  }

  function receiveCardRead(machineId, body) {
    checkCommon(body, machineId, 'readSeq');
    if (!['paper', 'digital'].includes(body.kind)) invalid('kind must be paper or digital');
    let qrCardId = null;
    let qrError = null;
    if (body.kind === 'paper') {
      validateMarks(body.cells, { allowNull: true });
      if (typeof body.cornerPresent !== 'boolean' && body.cornerPresent !== null) invalid('cornerPresent must be boolean or null');
    } else {
      if (typeof body.qrPayload !== 'string' || body.qrPayload.length > 300) invalid('qrPayload is required for digital cards');
      try {
        qrCardId = cards.verifyDigital(body.qrPayload).id;
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        qrError = error.message;
      }
    }
    if (body.imageId !== undefined && body.imageId !== null && !IMAGE_ID_RE.test(body.imageId)) invalid('imageId is malformed');
    if (body.readAt !== undefined && (typeof body.readAt !== 'string' || !ISO_RE.test(body.readAt))) invalid('readAt must be ISO 8601 with offset');
    // The claim must not reach the DB: store a body copy without the QR text.
    const stored = { ...body, qrPayload: body.qrPayload ? '[verified-on-receipt]' : null };
    const at = clock();
    const out = tx(db, () => {
      const info = sequenced('card', machineId, body, body.readSeq);
      if (info.duplicate) return { ...info.outcome, duplicate: true };
      const readId = insertCardRead(db, {
        machineId, bootId: body.bootId, readSeq: body.readSeq, kind: body.kind, cells: body.kind === 'paper' ? body.cells : null,
        cornerPresent: body.kind === 'paper' ? body.cornerPresent : null, hasQr: body.kind === 'digital', qrCardId, qrError,
        readAt: body.readAt ?? null, receivedAt: at, imageId: body.imageId ?? null,
      });
      const outcome = { duplicate: false, readId, status: 'pending' };
      insertDeviceEvent(db, { ...info.key, receivedAt: at, detectedAt: body.readAt ?? null, payloadHash: info.hash, payload: stored, outcome });
      setLastSeq(db, { ...info.key, at });
      return outcome;
    });
    if (!out.duplicate) bus.publish('draw', { touched: [machineId], events: [] });
    return out;
  }

  function receiveHeartbeat(machineId, body) {
    if (!body || body.machineId !== machineId) fail('MACHINE_MISMATCH', 'machineId does not match the device token', { status: 403 });
    if (typeof body.bootId !== 'string' || !UUID_RE.test(body.bootId)) invalid('bootId must be a UUID');
    const at = clock();
    const wasOnline = isOnline(machineId);
    const payload = {
      lastSeq: Number.isInteger(body.lastSeq) ? body.lastSeq : null,
      cameraOk: typeof body.cameraOk === 'boolean' ? body.cameraOk : null,
      sensorsOk: typeof body.sensorsOk === 'boolean' ? body.sensorsOk : null,
      at: typeof body.at === 'string' && ISO_RE.test(body.at) ? body.at : null,
    };
    tx(db, () => recordHeartbeat(db, machineId, { bootId: body.bootId, at, payload }));
    online.set(machineId, Date.parse(at));
    if (!wasOnline) bus.publish('draw', { touched: [machineId], events: [] });
    return { ok: true, serverTime: at };
  }

  async function saveImage(machineId, buffer, mime) {
    if (mime !== 'image/jpeg') fail('UNSUPPORTED_MEDIA', 'image/jpeg only', { status: 415 });
    if (!Buffer.isBuffer(buffer) || buffer.length < 4 || buffer.length > 300 * 1024) invalid('image must be 1B..300KB');
    if (buffer[0] !== 0xff || buffer[1] !== 0xd8) invalid('not a JPEG file');
    const imageId = `img_${randomToken(18)}`;
    const fileName = `${imageId}.jpg`;
    await fs.promises.mkdir(imageDir, { recursive: true });
    await fs.promises.writeFile(path.join(imageDir, fileName), buffer, { flag: 'wx', mode: 0o640 });
    const at = clock();
    tx(db, () => insertImage(db, { imageId, machineId, fileName, mime, bytes: buffer.length, createdAt: at, deleteAfter: addMs(at, imageRetentionDays * 86400_000) }));
    return { imageId };
  }

  function imagePath(imageId) {
    if (typeof imageId !== 'string' || !IMAGE_ID_RE.test(imageId)) return null;
    const img = findImage(db, imageId);
    return img ? { ...img, path: path.join(imageDir, img.fileName) } : null;
  }

  function getDeviceState(machineId) {
    const s = draw.getState();
    const m = s.machines[machineId];
    if (!m) fail('UNKNOWN_MACHINE', 'unknown machine', { status: 404 });
    const session = m.activeSessionId ? s.sessions[m.activeSessionId] : null;
    return {
      machineId, phase: m.phase, inputMode: m.inputMode, stopped: Boolean(m.emergency || m.resumeRequired),
      generation: m.generation, sessionId: session?.id ?? null, n: session?.n ?? 0,
      count: session ? session.balls.filter((b) => !b.removed).length : 0,
      serverTime: clock(),
    };
  }

  // ---------- camera station (Chrome on the venue Windows PC, 2026-10-28) ----------
  const CAMERA_BOOT = 'camera-station';
  const HINT_TTL_MS = 3 * 60 * 1000;
  const hints = new Map(); // machineId -> [{ id, color, confidence, at }]
  let hintSeq = 0;

  /**
   * Card read from the browser camera page. Paper: cells from the sticker
   * detection (null = unsure). Digital: the QR text, verified now and never
   * stored. Either way the read waits for the operator on that machine's tablet.
   */
  /**
   * Machines that can take a card from the camera now: camera recognition on
   * at the tablet, not stopped, idle and without a read waiting there.
   */
  function machinesReady() {
    const s = draw.getState();
    if (s.intakeClosed?.closed) return [];
    return Object.values(s.machines).filter((m) => m.cameraAssist === true && !m.emergency && !m.resumeRequired && m.phase === 'idle' && !pendingCardRead(db, m.id));
  }

  /**
   * Automatic routing (2026-10-30 request): of the ready machines, the one
   * that received a card least recently, so the two machines alternate.
   */
  function chooseMachine() {
    const ready = machinesReady();
    if (!ready.length) fail('NO_MACHINE_READY', '受け付けられる台がありません（抽選中、確認待ち、停止中、またはタブレットでカメラ自動認識がオフ）', { status: 409 });
    const last = lastReadIds(db);
    return ready.sort((a, b) => (last[a.id] ?? 0) - (last[b.id] ?? 0))[0].id;
  }

  /**
   * Card read from the camera station. machineId 'auto' lets the server pick
   * the machine; the choice is re-checked inside the write transaction.
   */
  async function receiveBrowserCardRead(machineId, body) {
    const auto = machineId === 'auto';
    if (!auto && !draw.getState().machines[machineId]) fail('UNKNOWN_MACHINE', '台が見つかりません', { status: 404 });
    if (!['paper', 'digital'].includes(body?.kind)) invalid('kind must be paper or digital');
    let qrCardId = null;
    let preview = null;
    if (body.kind === 'paper') {
      validateMarks(body.cells, { allowNull: true });
      if (typeof body.cornerPresent !== 'boolean' && body.cornerPresent !== null) invalid('cornerPresent must be boolean or null');
      const lines = completeLines(body.cells);
      preview = { lines, draws: entitledDraws(lines), unsure: body.cells.filter((c) => c === null).length };
      if (auto && preview.draws === 0 && preview.unsure === 0) fail('NO_LINES', 'ラインがそろっていない紙カードです', { status: 422 });
    } else {
      if (typeof body.qrPayload !== 'string' || body.qrPayload.length > 300) invalid('qrPayload is required');
      qrCardId = cards.verifyDigital(body.qrPayload).id;
      preview = cards.previewById(qrCardId);
      if (preview.used) fail('CARD_ALREADY_USED', `このカードは ${preview.usedAt} に受付済みです`);
      if (preview.draws === 0) fail('NO_LINES', 'ビンゴのラインが成立していないカードです', { status: 422 });
      const waiting = pendingReadForCard(db, qrCardId);
      if (waiting) fail('READ_ALREADY_PENDING', `このカードは${draw.getState().machines[waiting.machineId]?.name ?? waiting.machineId}で確認待ちです`, { status: 409, details: { machineId: waiting.machineId } });
    }
    if (auto) chooseMachine(); // fail early, before the image is stored
    let imageId = null;
    if (typeof body.image === 'string' && body.image.startsWith('data:image/jpeg;base64,')) {
      imageId = (await saveImage(auto ? CAMERA_BOOT : machineId, Buffer.from(body.image.slice(23), 'base64'), 'image/jpeg')).imageId;
    }
    const at = clock();
    const out = tx(db, () => {
      const target = auto ? chooseMachine() : machineId;
      if (qrCardId && pendingReadForCard(db, qrCardId)) fail('READ_ALREADY_PENDING', 'このカードは確認待ちです', { status: 409 });
      const readId = insertCardRead(db, {
        machineId: target, bootId: CAMERA_BOOT, readSeq: nextReadSeq(db, target, CAMERA_BOOT), kind: body.kind,
        cells: body.kind === 'paper' ? body.cells : null, cornerPresent: body.kind === 'paper' ? body.cornerPresent : null,
        hasQr: body.kind === 'digital', qrCardId, qrError: null, readAt: at, receivedAt: at, imageId,
      });
      return { readId, machineId: target };
    });
    bus.publish('draw', { touched: [out.machineId], events: [] });
    return { ...out, machineName: draw.getState().machines[out.machineId].name, preview };
  }

  /** Ball colour seen by a camera: a hint shown on the tablet, never recorded by itself. */
  function addHint(machineId, body) {
    if (!draw.getState().machines[machineId]) fail('UNKNOWN_MACHINE', '台が見つかりません', { status: 404 });
    const color = body?.color === null ? null : body?.color;
    if (color !== null && !COLORS.includes(color)) invalid('color must be a ball colour or null');
    const confidence = typeof body?.confidence === 'number' ? Math.max(0, Math.min(1, body.confidence)) : null;
    hintSeq += 1;
    const list = (hints.get(machineId) ?? []).filter((h) => Date.parse(clock()) - Date.parse(h.at) < HINT_TTL_MS);
    list.unshift({ id: `h${hintSeq}`, color, confidence, at: clock() });
    hints.set(machineId, list.slice(0, 5));
    bus.publish('draw', { touched: [machineId], events: [] });
    return { id: `h${hintSeq}` };
  }

  function listHints(machineId) {
    const now = Date.parse(clock());
    return (hints.get(machineId) ?? []).filter((h) => now - Date.parse(h.at) < HINT_TTL_MS);
  }

  function getDeviceStatus() {
    const rows = new Map(listMachineRows(db).map((r) => [r.machineId, r]));
    const at = Date.parse(clock());
    return Object.fromEntries(Object.keys(draw.getState().machines).map((id) => {
      const r = rows.get(id);
      return [id, {
        tokenIssued: Boolean(r?.tokenIssuedAt),
        online: isOnline(id, at),
        lastHeartbeatAt: r?.lastHeartbeatAt ?? null,
        bootId: r?.bootId ?? null,
        heartbeat: r?.heartbeat ?? null,
        streams: listStreams(db, id),
        pendingRead: withPreview(pendingCardRead(db, id)),
        hints: listHints(id),
      }];
    }));
  }

  function withPreview(read) {
    if (!read) return read;
    if (read.qrCardId) return { ...read, preview: cards.previewById(read.qrCardId) };
    if (read.cells) {
      const lines = completeLines(read.cells);
      return { ...read, preview: { lines, draws: entitledDraws(lines), unsure: read.cells.filter((c) => c === null).length } };
    }
    return read;
  }

  return { receiveBrowserCardRead, machinesReady, addHint, listHints, authenticate, receiveBallEvent, receiveCardRead, receiveHeartbeat, saveImage, imagePath, getDeviceState, getDeviceStatus, isOnline, deviceOnlineMap };
}
