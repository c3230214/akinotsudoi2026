import { tx } from '../db/connection.js';
import { appendActionLog } from '../db/repos/drawRepo.js';
import { invalid } from '../domain/errors.js';

// Closing notices shown to visitors, taken from the organisers' POP
// (「受付は14:30終了です」「抽選は15:00終了です」). They only display a
// notice; they do not stop card issue, stamps or intake.
// TODO(DECISION-U08): whether the system should also refuse those actions.
export const NOTICE_KINDS = Object.freeze({
  reception: { label: '受付', ruby: 'うけつけ' },
  draw: { label: '抽選', ruby: 'ちゅうせん' },
});
const DEFAULT_CONFIG = Object.freeze({ enabled: true, reception: '14:30', draw: '15:00' });
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function createNoticeService({ db, clock, eventDate }) {
  function getConfig() {
    const r = db.prepare("SELECT value FROM meta WHERE key = 'notice_config'").get();
    return r ? { ...DEFAULT_CONFIG, ...JSON.parse(r.value) } : { ...DEFAULT_CONFIG };
  }

  function setConfig(input, actor) {
    const cfg = { enabled: input?.enabled !== false, reception: input?.reception, draw: input?.draw };
    for (const k of ['reception', 'draw']) {
      if (typeof cfg[k] !== 'string' || !HHMM.test(cfg[k])) invalid(`${NOTICE_KINDS[k].label}の終了時刻は HH:MM で入力してください`);
    }
    const at = clock();
    tx(db, () => {
      db.prepare("INSERT INTO meta (key, value) VALUES ('notice_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(cfg));
      appendActionLog(db, { at, actor, type: 'setNoticeConfig', action: cfg, result: 'ok' });
    });
    return cfg;
  }

  /** Times are on the event day in Japan time; `now` lets clients correct their clock. */
  function publicNotices() {
    const cfg = getConfig();
    const day = eventDate();
    const notices = cfg.enabled ? Object.entries(NOTICE_KINDS).map(([id, k]) => ({
      id, label: k.label, ruby: k.ruby, time: cfg[id], at: `${day}T${cfg[id]}:00+09:00`,
    })).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) : [];
    return { now: clock(), notices };
  }

  return { getConfig, setConfig, publicNotices };
}
