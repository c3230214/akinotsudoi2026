// node --env-file=<env> scripts/issueDeviceToken.js --machine garagara-1
// Prints a new Bearer token for the venue-PC program once. Only its hash is
// stored; issuing again invalidates the previous token.
import { setDeviceToken } from '../src/db/repos/deviceRepo.js';
import { appendActionLog } from '../src/db/repos/drawRepo.js';
import { tx } from '../src/db/connection.js';
import { loadSnapshot } from '../src/db/repos/drawRepo.js';
import { randomToken, sha256 } from '../src/services/secrets.js';
import { nowJst } from '../src/time.js';
import { arg, die, openFromEnv } from './lib.js';

const machineId = arg('machine');
if (!machineId || machineId === true) die('--machine is required (e.g. garagara-1)');
const { db } = openFromEnv();
const state = loadSnapshot(db);
const known = state ? Object.keys(state.machines) : ['garagara-1', 'garagara-2'];
if (!known.includes(machineId)) die(`unknown machine ${machineId}; known: ${known.join(', ')}`);
const token = randomToken(32);
const at = nowJst();
tx(db, () => {
  setDeviceToken(db, machineId, sha256(token), at);
  appendActionLog(db, { at, actor: { kind: 'cli', id: 'issueDeviceToken' }, type: 'issueDeviceToken', action: { machineId }, result: 'ok' });
});
db.close();
console.log(`machine: ${machineId}`);
console.log(`token:   ${token}`);
console.log('Store this token only on the venue PC. It will not be shown again.');
