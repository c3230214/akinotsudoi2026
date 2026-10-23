import { COLORS } from '../rules.js';
import { fail, invalid } from '../errors.js';

export const COLOR_LABELS = Object.freeze({
  red: '赤', green: '緑', lightblue: '水色', white: '白',
});

/**
 * Grades and prize totals transcribed from the provided prize table image
 * (requirements §3). Ball counts per machine are NOT provided and start at 0
 * until an administrator registers them.
 */
export const DEFAULT_GRADES = Object.freeze([
  Object.freeze({ grade: 1, color: 'red', prize: 'お菓子詰め合わせ', total: 20 }),
  Object.freeze({ grade: 2, color: 'green', prize: 'りんごジュース', total: 60 }),
  Object.freeze({ grade: 3, color: 'lightblue', prize: '駄菓子（むぎチョコ）', total: 140 }),
  Object.freeze({ grade: 4, color: 'white', prize: '駄菓子（うまい棒）', total: 380 }),
]);

export const DEFAULT_MACHINES = Object.freeze([
  Object.freeze({ id: 'garagara-1', name: 'ガラガラ1' }),
  Object.freeze({ id: 'garagara-2', name: 'ガラガラ2' }),
]);

export const DEFAULT_SETTINGS = Object.freeze({
  eventName: 'かがやきライフタウン大垣 秋のつどい まるごと体験ビンゴ',
  heldOn: '2026-11-01',
  grades: DEFAULT_GRADES,
  machines: DEFAULT_MACHINES,
  // TODO(DECISION-C01): which input modes require a live venue-PC heartbeat
  // before a new intake. 'auto_only' is the proposal in §15 C01, not approved.
  heartbeatPolicy: 'auto_only',
  // Arrival delay after which a device ball is held for review (§4).
  lateEventSeconds: 60,
  // TODO(DECISION-C05): hand-written vouchers are disabled until approved.
  allowManualVoucher: false,
  // TODO(DECISION-C19): whether cell ⑤ is marked when the card is issued.
  centerMarkedOnIssue: false,
});

export const zeroColors = () => Object.fromEntries(COLORS.map((c) => [c, 0]));

export function assertColor(color) {
  if (!COLORS.includes(color)) invalid(`color must be one of ${COLORS.join(', ')}`);
  return color;
}

export function validateSettings(input) {
  const s = { ...DEFAULT_SETTINGS, ...input };
  if (typeof s.eventName !== 'string' || !s.eventName.trim()) invalid('eventName is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.heldOn)) invalid('heldOn must be YYYY-MM-DD');
  if (!Array.isArray(s.grades) || s.grades.length !== COLORS.length) invalid('grades must list all four colors');
  const seen = new Set();
  const grades = s.grades.map((g) => {
    assertColor(g.color);
    if (seen.has(g.color)) invalid(`duplicate grade color ${g.color}`);
    seen.add(g.color);
    if (!Number.isInteger(g.grade) || g.grade < 1) invalid('grade must be a positive integer');
    if (typeof g.prize !== 'string' || !g.prize.trim()) invalid('prize name is required');
    if (!Number.isInteger(g.total) || g.total < 0 || g.total > 100000) invalid('prize total must be 0..100000');
    return { grade: g.grade, color: g.color, prize: g.prize.trim(), total: g.total };
  }).sort((a, b) => a.grade - b.grade);
  if (!Array.isArray(s.machines) || s.machines.length < 1 || s.machines.length > 8) invalid('machines must have 1..8 entries');
  const ids = new Set();
  const machines = s.machines.map((m) => {
    if (typeof m.id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(m.id)) invalid('machine id must match [a-z0-9-]{1,32}');
    if (ids.has(m.id)) invalid(`duplicate machine id ${m.id}`);
    ids.add(m.id);
    if (typeof m.name !== 'string' || !m.name.trim()) invalid('machine name is required');
    return { id: m.id, name: m.name.trim() };
  });
  if (!['auto_only', 'always', 'never'].includes(s.heartbeatPolicy)) invalid('heartbeatPolicy must be auto_only, always or never');
  if (!Number.isInteger(s.lateEventSeconds) || s.lateEventSeconds < 5 || s.lateEventSeconds > 3600) invalid('lateEventSeconds must be 5..3600');
  if (typeof s.allowManualVoucher !== 'boolean') invalid('allowManualVoucher must be boolean');
  if (typeof s.centerMarkedOnIssue !== 'boolean') invalid('centerMarkedOnIssue must be boolean');
  return {
    eventName: s.eventName.trim(), heldOn: s.heldOn, grades, machines,
    heartbeatPolicy: s.heartbeatPolicy, lateEventSeconds: s.lateEventSeconds,
    allowManualVoucher: s.allowManualVoucher, centerMarkedOnIssue: s.centerMarkedOnIssue,
  };
}

function newMachine(m) {
  return {
    id: m.id,
    name: m.name,
    revision: 0,
    phase: 'idle', // idle | drawing
    activeSessionId: null,
    generation: null,
    inputMode: 'manual', // manual | auto  (TODO(DECISION-C02))
    emergency: null, // { at, reason, by } while stopped
    resumeRequired: false,
    contents: zeroColors(),
    returnPending: zeroColors(),
  };
}

export function initialState(settingsInput = {}) {
  const settings = validateSettings(settingsInput);
  return {
    schema: 1,
    revision: 0,
    settingsVersion: 1,
    settings,
    locked: false,
    inventoryConfigured: false,
    machines: Object.fromEntries(settings.machines.map((m) => [m.id, newMachine(m)])),
    prizes: Object.fromEntries(settings.grades.map((g) => [g.color, { allocated: 0, redeemed: 0 }])),
    spare: zeroColors(),
    storedValid: zeroColors(),
    sessions: {},
    sessionOrder: [],
    sessionCounter: 0,
    unassigned: [],
    unassignedCounter: 0,
    ballCounter: 0,
    plans: [],
    printJobCounter: 0,
  };
}

export function rebuildMachines(state, settings) {
  const next = {};
  for (const m of settings.machines) {
    next[m.id] = state.machines[m.id] ? { ...state.machines[m.id], name: m.name } : newMachine(m);
  }
  return next;
}

export function machineOf(s, machineId) {
  const m = s.machines[machineId];
  if (!m) fail('UNKNOWN_MACHINE', `台 ${machineId} は登録されていません`, { status: 404 });
  return m;
}

export function sessionOf(s, sessionId) {
  const session = s.sessions[sessionId];
  if (!session) fail('UNKNOWN_SESSION', `抽選 ${sessionId} が見つかりません`, { status: 404 });
  return session;
}

export function gradeOf(s, color) {
  return s.settings.grades.find((g) => g.color === color);
}

export function availablePrizes(s, color) {
  const g = gradeOf(s, color);
  return g.total - s.prizes[color].allocated;
}

export function ballsInMachines(s, color) {
  return Object.values(s.machines).reduce((sum, m) => sum + m.contents[color], 0);
}

export function activeBalls(session) {
  return session.balls.filter((b) => !b.removed);
}

export function isStopped(machine) {
  return Boolean(machine.emergency) || machine.resumeRequired;
}

/**
 * Every ball of a color is in exactly one ledger bucket. Used by tests and the
 * stock screen to show the conservation total (§15 C18).
 */
export function ballLedger(s, color) {
  const inMachines = ballsInMachines(s, color);
  const returnPending = Object.values(s.machines).reduce((sum, m) => sum + m.returnPending[color], 0);
  let inTray = 0;
  for (const m of Object.values(s.machines)) {
    if (!m.activeSessionId) continue;
    inTray += activeBalls(s.sessions[m.activeSessionId]).filter((b) => b.countedColor === color).length;
  }
  const unassigned = s.unassigned.filter((u) => !u.resolvedAt && u.countedColor === color).length;
  return {
    inMachines,
    spare: s.spare[color],
    inTray,
    storedValid: s.storedValid[color],
    returnPending,
    unassigned,
    total: inMachines + s.spare[color] + inTray + s.storedValid[color] + returnPending + unassigned,
  };
}
