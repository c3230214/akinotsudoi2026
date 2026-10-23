// node --env-file=<env> scripts/createStaff.js --login admin --name "管理者" --role admin
// The passcode is read from the MB_PASSCODE environment variable or prompted
// on the terminal, so it never appears in shell history or process lists.
import readline from 'node:readline';
import { createAuthService } from '../src/services/authService.js';
import { nowJst } from '../src/time.js';
import { arg, die, openFromEnv } from './lib.js';

async function promptHidden(question) {
  if (!process.stdin.isTTY) die('set MB_PASSCODE or run in a terminal');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
  const answer = await new Promise((resolve) => rl.question(question, resolve));
  rl.close();
  process.stdout.write('\n');
  return answer;
}

const login = arg('login');
const name = arg('name', login);
const role = arg('role', 'operator');
if (!login || login === true) die('--login is required');

const passcode = process.env.MB_PASSCODE || await promptHidden('passcode (8+ chars): ');
const { db } = openFromEnv();
const auth = createAuthService({ db, clock: nowJst, machineExists: () => true });
try {
  const id = await auth.createStaff({ loginName: login, displayName: name, role, passcode }, { kind: 'cli', id: 'createStaff', name: 'cli' });
  console.log(`created staff #${id} ${login} (${role})`);
} catch (error) {
  die(error.message);
} finally {
  db.close();
}
