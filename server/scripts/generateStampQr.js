// Create (or import) the nine stamp QR codes, one per card cell ①〜⑨, and
// write printable SVG/PNG files plus an A4 print sheet.
//
//   node --env-file=<env> scripts/generateStampQr.js --out ../stamp-qr           # new tokens
//   node --env-file=<env> scripts/generateStampQr.js --import ../stamp-qr/stamp-tokens.json
//   node scripts/generateStampQr.js --out ../stamp-qr --no-db                     # files only
//
// stamp-tokens.json is the master copy of the printed codes. Keep it with the
// DB backups and out of Git; anyone holding it can stamp every cell.
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { CELLS } from '../src/domain/card/cardLayout.js';
import { stampPayload } from '../src/domain/card/cardModel.js';
import { randomToken, sha256 } from '../src/services/secrets.js';
import { upsertStampPoint } from '../src/db/repos/cardRepo.js';
import { tx } from '../src/db/connection.js';
import { nowJst } from '../src/time.js';
import { arg, die, openFromEnv } from './lib.js';

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const importPath = arg('import');
const outDir = path.resolve(arg('out', importPath ? path.dirname(importPath) : '../stamp-qr'));
const noDb = arg('no-db', false) === true;

let points;
if (importPath && importPath !== true) {
  const data = JSON.parse(fs.readFileSync(importPath, 'utf8'));
  if (!Array.isArray(data.points) || data.points.length !== 9) die('stamp-tokens.json must contain 9 points');
  points = data.points;
} else {
  points = CELLS.map((c) => ({
    pointId: `cell-${c.number}`,
    cellIndex: c.index,
    name: `${CIRCLED[c.index]} ${c.label}`,
    token: randomToken(24),
  }));
}
for (const p of points) {
  if (!Number.isInteger(p.cellIndex) || p.cellIndex < 0 || p.cellIndex > 8) die(`bad cellIndex for ${p.pointId}`);
  stampPayload(p.token); // validates format
}

fs.mkdirSync(outDir, { recursive: true });
const generatedAt = nowJst();
fs.writeFileSync(path.join(outDir, 'stamp-tokens.json'), `${JSON.stringify({ generatedAt, note: 'Master copy of printed stamp QR codes. Keep private.', points }, null, 2)}\n`, { mode: 0o600 });

const blocks = [];
for (const p of points) {
  const payload = stampPayload(p.token);
  const base = `stamp-${String(p.cellIndex + 1).padStart(2, '0')}`;
  const svg = await QRCode.toString(payload, { type: 'svg', errorCorrectionLevel: 'Q', margin: 2 });
  fs.writeFileSync(path.join(outDir, `${base}.svg`), svg);
  await QRCode.toFile(path.join(outDir, `${base}.png`), payload, { errorCorrectionLevel: 'Q', margin: 2, width: 1024 });
  const cell = CELLS[p.cellIndex];
  blocks.push(`<section class="sheet"><div class="num">${CIRCLED[p.cellIndex]}</div><h1>${esc(cell.label)}</h1>
<div class="qr">${svg}</div>
<p class="how">スマホのデジタルビンゴカードで「${CIRCLED[p.cellIndex]}」のマスをタップし、「QRコードを読み取る」で読み取ってください</p>
<p class="meta">まるごと体験ビンゴ スタンプQR ${CIRCLED[p.cellIndex]}（${esc(p.pointId)}）</p></section>`);
}
fs.writeFileSync(path.join(outDir, 'stamp-qr-print.html'), `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>スタンプQR印刷用</title>
<style>
@page { size: A4; margin: 15mm; }
body { font-family: "Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif; margin: 0; color: #222; }
.sheet { page-break-after: always; text-align: center; padding-top: 10mm; }
.num { font-size: 40mm; line-height: 1; color: #e0603a; font-weight: 700; }
h1 { font-size: 13mm; margin: 4mm 0; }
.qr svg { width: 120mm; height: 120mm; }
.how { font-size: 6mm; margin: 4mm 10mm; }
.meta { font-size: 3.5mm; color: #666; }
</style></head><body>
${blocks.join('\n')}
</body></html>
`);

if (!noDb) {
  const { db } = openFromEnv();
  const at = nowJst();
  tx(db, () => {
    for (const p of points) upsertStampPoint(db, { id: p.pointId, name: p.name, cellIndex: p.cellIndex, tokenHash: sha256(p.token), at });
  });
  db.close();
  console.log(`registered ${points.length} stamp points in the database`);
}
console.log(`wrote QR files to ${outDir}`);
