// node --env-file=<env> scripts/backup.js --dir /srv/backup/marugoto-bingo --keep 288
// Writes a consistent copy with VACUUM INTO (safe while the service runs in
// WAL mode), verifies it with integrity_check, then prunes old copies.
// TODO(DECISION-C24): retention and the acceptable data-loss window are undecided.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/config.js';
import { arg, die } from './lib.js';

const config = loadConfig(process.env);
const dir = arg('dir', process.env.BACKUP_DIR);
const keep = Number(arg('keep', process.env.BACKUP_KEEP ?? 288));
if (!dir || dir === true) die('--dir or BACKUP_DIR is required');
if (!Number.isInteger(keep) || keep < 1) die('--keep must be a positive integer');
if (!fs.existsSync(config.dbPath)) die(`database not found: ${config.dbPath}`);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const stamp = new Date().toISOString().replace(/[-:.]/g, '');
const target = path.join(dir, `marugoto-bingo-${stamp}.sqlite`);
// Not read-only: a WAL database reader needs write access to the -shm file.
const src = new DatabaseSync(config.dbPath);
src.exec('PRAGMA busy_timeout = 10000');
src.prepare('VACUUM INTO ?').run(target);
src.close();

const copy = new DatabaseSync(target, { readOnly: true });
const check = copy.prepare('PRAGMA integrity_check').get();
const rev = copy.prepare('SELECT revision, saved_at FROM draw_snapshot WHERE id = 1').get();
copy.close();
if (Object.values(check)[0] !== 'ok') die(`integrity_check failed for ${target}`);
fs.chmodSync(target, 0o600);

const files = fs.readdirSync(dir).filter((f) => /^marugoto-bingo-\d{8}T\d{9}Z\.sqlite$/.test(f)).sort();
for (const f of files.slice(0, Math.max(0, files.length - keep))) fs.unlinkSync(path.join(dir, f));
console.log(`backup ok: ${target} (revision ${rev?.revision ?? 'n/a'}, saved ${rev?.saved_at ?? 'n/a'})`);
