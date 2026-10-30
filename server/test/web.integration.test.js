// Wiring between the browser screens and the server: every file a page
// loads is served, every relative import names an export that exists, and
// every /api/ path the screens call is a route on the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeApp } from './helpers/appFixture.js';

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

function walk(dir, ext, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (p.endsWith(ext)) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(WEB, p);

test('結合：各画面のHTMLが読み込むスクリプト、CSS、画像はすべて配信される', async (t) => {
  const f = await makeApp({ env: { WEB_DIR: WEB, ADMIN_PANEL_USER: 'paneluser', ADMIN_PANEL_PASSWORD: 'panel-pass-123' } });
  t.after(() => f.close());
  // The admin panel is behind Basic authentication; the other screens ignore the header.
  const headers = { authorization: `Basic ${Buffer.from('paneluser:panel-pass-123').toString('base64')}` };
  const pages = walk(WEB, '.html');
  for (const screen of ['visitor', 'garagara1', 'garagara2', 'pc', 'camera', 'print', 'balls', 'staff', 'admin']) {
    assert.ok(pages.some((p) => rel(p) === `${screen}/index.html`), `${screen} screen exists`);
  }
  for (const page of pages) {
    const urlDir = `/${path.dirname(rel(page))}/`;
    const res = await f.req('GET', urlDir === '/./' ? '/' : urlDir, { origin: null, headers });
    assert.equal(res.status, path.basename(page) === 'index.html' ? 200 : res.status, `${urlDir} is served`);
    const html = fs.readFileSync(page, 'utf8');
    for (const [, ref] of html.matchAll(/(?:src|href)="(\/[^"]+)"/g)) {
      const r = await f.req('GET', ref, { origin: null, headers });
      assert.equal(r.status, 200, `${rel(page)} -> ${ref}`);
    }
  }
});

test('結合：相対importの先にファイルがあり、読み込む名前がexportされている', () => {
  const files = walk(WEB, '.js');
  const exportsOf = new Map();
  const namesIn = (file) => {
    if (!exportsOf.has(file)) {
      const src = fs.readFileSync(file, 'utf8');
      const names = new Set();
      for (const [, n] of src.matchAll(/export (?:async )?(?:function|const|class|let) ([\w$]+)/g)) names.add(n);
      for (const [, list] of src.matchAll(/export \{([^}]+)\}/g)) for (const n of list.split(',')) names.add(n.trim().split(/\s+as\s+/).pop());
      exportsOf.set(file, names);
    }
    return exportsOf.get(file);
  };
  let checked = 0;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    for (const [, list, from] of src.matchAll(/import \{([^}]+)\} from '(\.[^']+)'/g)) {
      const target = path.resolve(path.dirname(file), from);
      assert.ok(fs.existsSync(target), `${rel(file)} imports missing ${from}`);
      for (const raw of list.split(',')) {
        const name = raw.trim().split(/\s+as\s+/)[0];
        if (!name) continue;
        assert.ok(namesIn(target).has(name), `${rel(file)} imports ${name} which ${from} does not export`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 50);
});

test('結合：画面が呼ぶ /api/ のパスはすべてサーバーのルートにある', async (t) => {
  const f = await makeApp();
  t.after(() => f.close());
  const calls = new Set();
  for (const file of walk(WEB, '.js')) {
    const src = fs.readFileSync(file, 'utf8');
    for (const [, url] of src.matchAll(/[`'"](\/api\/[^`'"?\s]*)/g)) calls.add(url.replace(/\$\{[^}]+\}/g, 'X'));
  }
  assert.ok(calls.size > 30, `found ${calls.size} paths`);
  const missing = [];
  for (const url of calls) {
    let found = false;
    for (const method of ['GET', 'POST', 'PUT', 'PATCH']) {
      const r = await f.req(method, url, { origin: 'https://bingo.test', body: method === 'GET' ? undefined : {} });
      // The not-found handler answers exactly { error: 'NOT_FOUND' }; routes answer anything else.
      if (!(r.status === 404 && r.json?.error === 'NOT_FOUND' && !r.json.message)) { found = true; break; }
    }
    if (!found) missing.push(url);
  }
  assert.deepEqual(missing, []);
});
