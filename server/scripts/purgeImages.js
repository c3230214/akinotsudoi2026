// node --env-file=<env> scripts/purgeImages.js
// Deletes camera images whose delete_after has passed (file first, then row).
import fs from 'node:fs';
import path from 'node:path';
import { deleteImageRow, listExpiredImages } from '../src/db/repos/deviceRepo.js';
import { nowJst } from '../src/time.js';
import { openFromEnv } from './lib.js';

const { config, db } = openFromEnv();
let n = 0;
for (const img of listExpiredImages(db, nowJst())) {
  const file = path.join(config.imageDir, img.fileName);
  try {
    fs.unlinkSync(file);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  deleteImageRow(db, img.imageId);
  n += 1;
}
db.close();
console.log(`purged ${n} images`);
