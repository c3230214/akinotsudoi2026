import { COLORS, completeLines, entitledDraws, validateMarks } from '../rules.js';
import { fail, invalid } from '../errors.js';
import { COLOR_LABELS, availablePrizes, isStopped, machineOf } from './state.js';

export function requireIntakeAllowed(s, machine, ctx) {
  if (s.intakeClosed?.closed) fail('INTAKE_CLOSED', `新規受付は終了しています（${s.intakeClosed.reason}）`);
  if (!s.inventoryConfigured) fail('INVENTORY_NOT_CONFIGURED', '玉と景品の初期在庫が登録されていません。管理者が在庫を登録してください');
  if (machine.emergency) fail('EMERGENCY_STOPPED', `${machine.name}は緊急停止中です`);
  if (machine.resumeRequired) fail('RESUME_REQUIRED', `${machine.name}は停止解除後の再開操作が必要です`);
  if (machine.phase !== 'idle') {
    fail('MACHINE_BUSY', `${machine.name}は抽選中です。結果確定（回収確認）まで次の受付はできません`);
  }
  const policy = s.settings.heartbeatPolicy;
  const needsHeartbeat = policy === 'always' || (policy === 'auto_only' && machine.inputMode === 'auto');
  if (needsHeartbeat && !ctx.deviceOnline?.[machine.id]) {
    fail('DEVICE_OFFLINE', `${machine.name}の会場PCから心拍が届いていないため受付できません`);
  }
  const exhausted = COLORS.filter((c) => machine.contents[c] > 0 && availablePrizes(s, c) <= 0);
  if (exhausted.length) {
    fail('PRIZE_EXHAUSTED_COLOR_IN_MACHINE',
      `景品残数0の色（${exhausted.map((c) => COLOR_LABELS[c]).join('・')}）の玉が${machine.name}に残っています。玉を取り出して在庫を補正してから受付してください`,
      { details: { colors: exhausted } });
  }
}

/**
 * Start a draw session for a card whose marks were fixed on the server.
 * The caller (service) marks the card used in the same DB transaction.
 */
export function startSession(s, a, ctx) {
  const machine = machineOf(s, a.machineId);
  if (a.expectedMachineRevision !== machine.revision) {
    fail('REVISION_CONFLICT', '画面の状態が古くなっています。最新の状態を確認してから操作してください', {
      details: { machineRevision: machine.revision },
    });
  }
  requireIntakeAllowed(s, machine, ctx);
  if (!a.card || typeof a.card.id !== 'string' || !['paper', 'digital'].includes(a.card.kind)) invalid('card is required');
  validateMarks(a.marks);
  const lines = completeLines(a.marks);
  const n = entitledDraws(lines);
  if (n === 0) fail('NO_LINES', 'ビンゴのラインが成立していないため抽選できません', { status: 422 });

  s.sessionCounter += 1;
  const id = `BM-${String(s.sessionCounter).padStart(4, '0')}`;
  const session = {
    id,
    machineId: machine.id,
    card: { id: a.card.id, kind: a.card.kind },
    marks: [...a.marks],
    lines,
    n,
    intake: a.intake ?? null,
    status: 'drawing',
    balls: [],
    createdAt: ctx.now,
    createdBy: ctx.actor?.name ?? null,
    finalizedAt: null,
    finalizedBy: null,
    voucher: null,
  };
  s.sessions[id] = session;
  s.sessionOrder.push(id);
  machine.phase = 'drawing';
  machine.activeSessionId = id;
  machine.generation = id;
  s.locked = true;
  return {
    touched: [machine.id],
    message: `${id} 受付：${lines}ライン、抽選${n}回`,
    result: { sessionId: id, lines, n, generation: id },
  };
}
