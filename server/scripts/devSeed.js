// Development only: fills an empty dev DB so every screen can be exercised.
//   node scripts/devSeed.js
// Creates staff (admin / op1 / op2 / prize / printer, passcode "dev-passcode"),
// sample inventory and dev stamp points (the venue map loads from
// config/map-2026.json on first start). Refuses in production.
import { createServices } from '../src/app.js';
import { upsertStampPoint } from '../src/db/repos/cardRepo.js';
import { tx } from '../src/db/connection.js';
import { sha256 } from '../src/services/secrets.js';
import { nowJst } from '../src/time.js';
import { CELLS } from '../src/domain/card/cardLayout.js';
import { die, openFromEnv } from './lib.js';

if (process.env.NODE_ENV === 'production') die('devSeed must not run in production');
const { config, db } = openFromEnv();
const svc = createServices({ config, db });
const cli = { kind: 'cli', id: 'devSeed', name: 'devSeed', role: 'admin' };

for (const [loginName, role] of [['admin', 'admin'], ['op1', 'operator'], ['op2', 'operator'], ['prize', 'prize'], ['printer', 'printer']]) {
  try {
    await svc.auth.createStaff({ loginName, displayName: loginName, role, passcode: 'dev-passcode' }, cli);
  } catch { /* exists */ }
}
const s = svc.draw.getState();
if (!s.inventoryConfigured) {
  svc.draw.execute({ actor: cli, action: { type: 'setInventory', contents: { 'garagara-1': { red: 8, green: 20, lightblue: 40, white: 80 }, 'garagara-2': { red: 8, green: 20, lightblue: 40, white: 80 } }, spare: { red: 4, green: 20, lightblue: 60, white: 150 } } });
}
const tokens = [];
tx(db, () => {
  for (const c of CELLS) {
    const token = `devstamp${c.number}aaaaaaaaaaaa`;
    tokens.push(`MARUGOTO2026:STAMP:${token}`);
    upsertStampPoint(db, { id: `cell-${c.number}`, name: `${c.number} ${c.label}`, cellIndex: c.index, tokenHash: sha256(token), at: nowJst() });
  }
});
db.close();
console.log('dev seed done. staff passcode: dev-passcode');
console.log('dev stamp payloads:');
for (const t of tokens) console.log(`  ${t}`);
