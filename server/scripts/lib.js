import { loadConfig } from '../src/config.js';
import { openDatabase, runMigrations } from '../src/db/connection.js';

/** Scripts read the same environment as the service: run with `node --env-file=...`. */
export function openFromEnv() {
  const config = loadConfig(process.env);
  const db = openDatabase(config.dbPath);
  runMigrations(db);
  return { config, db };
}

export function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

export function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}
