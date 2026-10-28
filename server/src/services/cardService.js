import { tx } from '../db/connection.js';
import {
  findCardById, findCardByTokenHash, findStampPointByTokenHash, findTapPoint, hasStampFromPoint, insertCard, insertStamp,
  listStamps, markCardUsed,
} from '../db/repos/cardRepo.js';
import { closeCardRead, findCardRead } from '../db/repos/deviceRepo.js';
import { fail, invalid } from '../domain/errors.js';
import { TAP_CELLS, cardPayload, cellForPoint, isCardId, marksFromStamps, parseCardPayload, parseStampPayload, toCardView } from '../domain/card/cardModel.js';
import { CELLS } from '../domain/card/cardLayout.js';
import { validateMarks } from '../domain/rules.js';
import { cardClaim, newCardId, randomToken, safeEqual, sha256 } from './secrets.js';

function requireReason(reason, message) {
  if (typeof reason !== 'string' || reason.trim().length < 2) invalid(message);
  return reason.trim().slice(0, 500);
}

export function createCardService({ db, clock, draw, claimSecret, bus }) {
  const centerMarked = () => draw.getState().settings.centerMarkedOnIssue;

  function issueCard() {
    const token = randomToken(32);
    const at = clock();
    for (let i = 0; i < 5; i += 1) {
      const id = newCardId('D');
      try {
        tx(db, () => insertCard(db, { id, kind: 'digital', tokenHash: sha256(token), createdAt: at }));
        return { token, cardId: id };
      } catch (error) {
        if (!String(error.message).includes('UNIQUE')) throw error;
      }
    }
    throw new Error('could not allocate card id');
  }

  function cardFromToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    return findCardByTokenHash(db, sha256(token));
  }

  function getCardView(card) {
    const view = toCardView(card, listStamps(db, card.id), { centerMarked: centerMarked() });
    return { ...view, qrPayload: card.usedAt ? null : cardPayload(card.id, cardClaim(claimSecret, card.id)) };
  }

  function stamp(card, payloadText, chosenCell = null) {
    if (chosenCell !== null && !(Number.isInteger(chosenCell) && chosenCell >= 0 && chosenCell < CELLS.length)) invalid('cellIndex must be 0..8');
    const { token } = parseStampPayload(payloadText);
    const at = clock();
    const result = tx(db, () => {
      const point = findStampPointByTokenHash(db, sha256(token));
      if (!point || !point.active) fail('UNKNOWN_STAMP', 'このQRコードは登録されていません', { status: 404 });
      const fresh = findCardById(db, card.id);
      if (fresh.usedAt) fail('CARD_USED', 'このカードは抽選済みのため、スタンプを追加できません');
      if (hasStampFromPoint(db, card.id, point.id)) fail('ALREADY_STAMPED', `「${point.name}」のスタンプは取得済みです`);
      const marks = marksFromStamps(listStamps(db, card.id), { centerMarked: centerMarked() });
      const cell = cellForPoint(point, marks, chosenCell);
      if (cell === null) fail('CELL_ALREADY_MARKED', 'このマスはすでに達成しています');
      insertStamp(db, { cardId: card.id, cellIndex: cell, pointId: point.id, at, actor: 'visitor-qr' });
      return { cellIndex: cell, cellNumber: CELLS[cell].number, pointName: point.name };
    });
    return result;
  }

  /** Cells without a QR (⑤) are achieved by the visitor's tap (2026-10-28 request). */
  function tapCell(card, cellIndex) {
    if (!TAP_CELLS.includes(cellIndex)) invalid('このマスはブースのQRコードを読み取って達成します');
    const at = clock();
    return tx(db, () => {
      const point = findTapPoint(db, cellIndex);
      if (!point) fail('UNKNOWN_STAMP', 'このマスは準備中です', { status: 404 });
      const fresh = findCardById(db, card.id);
      if (fresh.usedAt) fail('CARD_USED', 'このカードは抽選済みのため、スタンプを追加できません');
      const marks = marksFromStamps(listStamps(db, card.id), { centerMarked: centerMarked() });
      if (marks[cellIndex]) fail('CELL_ALREADY_MARKED', 'このマスはすでに達成しています');
      insertStamp(db, { cardId: card.id, cellIndex, pointId: point.id, at, actor: 'visitor-tap' });
      return { cellIndex, cellNumber: CELLS[cellIndex].number, pointName: point.name };
    });
  }

  function verifyDigital(payloadText) {
    const { cardId, claim } = parseCardPayload(payloadText);
    if (!safeEqual(claim, cardClaim(claimSecret, cardId))) fail('INVALID_CARD_QR', 'カードのQRコードが正しくありません', { status: 422 });
    const card = findCardById(db, cardId);
    if (!card || card.kind !== 'digital') fail('UNKNOWN_CARD', 'カードが見つかりません', { status: 404 });
    return card;
  }

  function acceptDigital({ payload, readId = null, machineId, expectedMachineRevision, actor, operationId, requestBody }) {
    let card;
    if (readId !== null) {
      const read = findCardRead(db, readId);
      if (!read || read.machineId !== machineId || read.status !== 'pending' || !read.qrCardId) fail('UNKNOWN_READ', 'カード読取結果が見つかりません', { status: 404 });
      card = findCardById(db, read.qrCardId);
    } else if (payload) {
      card = verifyDigital(payload);
    } else {
      invalid('QRコードの内容が必要です');
    }
    const marks = marksFromStamps(listStamps(db, card.id), { centerMarked: centerMarked() });
    return draw.execute({
      operationId,
      requestBody,
      actor,
      action: {
        type: 'startSession', machineId, expectedMachineRevision, card: { id: card.id, kind: 'digital' }, marks,
        intake: { source: readId ? 'c1-qr' : 'staff-qr', readId },
      },
      before: () => {
        const fresh = findCardById(db, card.id);
        if (fresh.usedAt) fail('CARD_ALREADY_USED', `このカードは ${fresh.usedAt} に受付済みです`, { details: { sessionId: fresh.usedSessionId } });
        return null;
      },
      after: (out, at) => {
        if (!markCardUsed(db, { cardId: card.id, sessionId: out.result.sessionId, machineId, at, intake: { by: actor.name } })) {
          fail('CARD_ALREADY_USED', 'このカードは受付済みです');
        }
        if (readId !== null) closeCardRead(db, readId, 'accepted', out.result.sessionId);
        return { cardId: card.id };
      },
    });
  }

  /**
   * Paper card intake. Staff confirm the nine cells; the server computes N.
   * TODO(DECISION-C04): a paper card has no unique id, so this cannot detect
   * the same physical card presented twice. The corner procedure is the only
   * guard and it is an operational rule, not a software guarantee.
   */
  function acceptPaper({ marks, readId = null, cornerPresent, cornerReason, correctionReason, machineId, expectedMachineRevision, actor, operationId, requestBody }) {
    validateMarks(marks);
    let originalMarks = null;
    let read = null;
    if (readId !== null) {
      read = findCardRead(db, readId);
      if (!read || read.machineId !== machineId || read.status !== 'pending' || read.kind !== 'paper') fail('UNKNOWN_READ', 'カード読取結果が見つかりません', { status: 404 });
      originalMarks = read.cells;
    }
    const changed = originalMarks ? originalMarks.some((v, i) => v !== marks[i]) : false;
    const intake = {
      source: read ? 'c1' : 'staff-manual',
      readId,
      originalMarks,
      correctedMarks: changed ? marks : null,
      correctionReason: changed ? requireReason(correctionReason, '読取結果を修正した理由を入力してください') : null,
      cornerPresent: cornerPresent === true,
      cornerReason: null,
    };
    if (read && read.cornerPresent === false && cornerPresent !== false) {
      // C1 reported a missing corner; the operator cannot silently override it.
      intake.cornerPresent = false;
    }
    if (!intake.cornerPresent) intake.cornerReason = requireReason(cornerReason, '抽選確認の角がないカードを受け付ける理由を入力してください');
    const cardId = newCardId('P');
    return draw.execute({
      operationId,
      requestBody,
      actor,
      action: { type: 'startSession', machineId, expectedMachineRevision, card: { id: cardId, kind: 'paper' }, marks, intake },
      after: (out, at) => {
        insertCard(db, { id: cardId, kind: 'paper', createdAt: at });
        markCardUsed(db, { cardId, sessionId: out.result.sessionId, machineId, at, intake });
        if (readId !== null && !closeCardRead(db, readId, 'accepted', out.result.sessionId)) fail('UNKNOWN_READ', 'カード読取結果は処理済みです');
        return { cardId };
      },
    });
  }

  function dismissRead(readId, machineId) {
    const read = findCardRead(db, readId);
    if (!read || read.machineId !== machineId) fail('UNKNOWN_READ', 'カード読取結果が見つかりません', { status: 404 });
    tx(db, () => closeCardRead(db, readId, 'dismissed'));
    bus?.publish('draw', { touched: [machineId], events: [] });
  }

  function lookupForStaff(payloadText) {
    const card = verifyDigital(payloadText);
    const view = toCardView(card, listStamps(db, card.id), { centerMarked: centerMarked() });
    return { cardId: card.id, used: view.used, usedAt: card.usedAt, usedSessionId: card.usedSessionId, marks: view.marks, lines: view.lines, draws: view.draws };
  }

  return { issueCard, cardFromToken, getCardView, stamp, tapCell, acceptDigital, acceptPaper, dismissRead, verifyDigital, lookupForStaff, isCardId };
}
