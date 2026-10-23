import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  // FULL: a committed intake/prize/redeem must survive a power cut.
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

/**
 * Run within BEGIN IMMEDIATE so the write lock is taken up front. Every
 * business operation goes through here; Node runs it synchronously, so
 * operations are also serialised within the process.
 */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listMigrationFiles(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: Number(f.slice(0, 3)), name: f, sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

/** Apply numbered migrations once each. An edited applied migration aborts start-up. */
export function runMigrations(db, { dir = MIGRATIONS_DIR } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL
  ) STRICT`);
  const applied = new Map(db.prepare('SELECT version, name, checksum FROM schema_migrations').all().map((r) => [r.version, r]));
  const done = [];
  for (const m of listMigrationFiles(dir)) {
    const checksum = createHash('sha256').update(m.sql).digest('hex');
    const prev = applied.get(m.version);
    if (prev) {
      if (prev.checksum !== checksum) {
        throw new Error(`migration ${m.name} was modified after it was applied; add a new migration instead`);
      }
      continue;
    }
    tx(db, () => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)')
        .run(m.version, m.name, checksum, new Date().toISOString());
    });
    done.push(m.name);
  }
  return done;
}
