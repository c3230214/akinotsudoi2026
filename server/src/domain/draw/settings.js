import { fail } from '../errors.js';
import { rebuildMachines, validateSettings } from './state.js';

/** Settings are frozen once the first card is accepted (§3, test 13). */
export function updateSettings(s, a) {
  if (s.locked) fail('SETTINGS_LOCKED', '最初の受付後はイベント設定を変更できません');
  const settings = validateSettings(a.settings);
  s.settings = settings;
  s.settingsVersion += 1;
  s.machines = rebuildMachines(s, settings);
  s.prizes = Object.fromEntries(settings.grades.map((g) => [g.color, s.prizes[g.color] ?? { allocated: 0, redeemed: 0 }]));
  return { touched: Object.keys(s.machines), message: `イベント設定を更新しました（版${s.settingsVersion}）`, result: { settingsVersion: s.settingsVersion } };
}
