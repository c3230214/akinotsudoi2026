import { initialState } from '../../src/domain/draw/state.js';
import { transition } from '../../src/domain/draw/transition.js';

export const ALL = Array(9).fill(true);
// Three lines: top row, left column, diagonal 0-4-8 -> N=2
export const THREE_LINES = [true, true, true, true, true, false, true, false, true];
export const ONE_LINE = [true, true, true, false, false, false, false, false, false];

let clock = Date.parse('2026-11-01T10:00:00+09:00');
export const now = () => new Date((clock += 1000)).toISOString();

export function makeWorld({ contents, spare } = {}) {
  let state = initialState();
  const ctx = () => ({ now: now(), actor: { name: 'tester', role: 'admin' }, deviceOnline: { 'garagara-1': true, 'garagara-2': true } });
  const run = (action, extra = {}) => {
    const out = transition(state, action, { ...ctx(), ...extra });
    state = out.state;
    return out;
  };
  run({
    type: 'setInventory',
    contents: contents ?? {
      'garagara-1': { red: 10, green: 10, lightblue: 10, white: 10 },
      'garagara-2': { red: 10, green: 10, lightblue: 10, white: 10 },
    },
    spare: spare ?? { red: 0, green: 5, lightblue: 5, white: 5 },
  });
  let cardSeq = 0;
  const start = (machineId, marks = THREE_LINES, kind = 'paper') => {
    cardSeq += 1;
    return run({
      type: 'startSession', machineId, expectedMachineRevision: state.machines[machineId].revision,
      card: { id: `card-${cardSeq}`, kind }, marks,
    });
  };
  return {
    get state() { return state; },
    set state(v) { state = v; },
    run,
    start,
    ball: (machineId, color) => run({ type: 'manualBall', machineId, sessionId: state.machines[machineId].activeSessionId, color }),
  };
}
