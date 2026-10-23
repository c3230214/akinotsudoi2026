// node --env-file=<env> scripts/importMap.js --file map.json
// Replaces the venue map, booths and stage programmes with the given JSON
// (format: docs/map-data.md). The admin screen offers the same import.
import fs from 'node:fs';
import { createMapService } from '../src/services/mapService.js';
import { nowJst } from '../src/time.js';
import { arg, die, openFromEnv } from './lib.js';

const file = arg('file');
if (!file || file === true) die('--file is required');
const { db } = openFromEnv();
try {
  const out = createMapService({ db, clock: nowJst }).importMap(JSON.parse(fs.readFileSync(file, 'utf8')), { kind: 'cli', id: 'importMap' });
  console.log(`imported ${out.places} places and ${out.programs} programmes`);
} catch (error) {
  die(error.message);
} finally {
  db.close();
}
