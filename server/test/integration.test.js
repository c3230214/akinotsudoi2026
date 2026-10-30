// One event-day flow across all components, over HTTP and SSE: ball and
// prize dashboard -> visitor card, stamps and survey -> camera 1 automatic
// routing -> tablets confirm and enter balls -> Windows PC prints -> prize
// exchange -> admin panel, CSV and ledger agree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COLORS } from '../src/domain/rules.js';
import { makeApp } from './helpers/appFixture.js';

const PANEL = { ADMIN_PANEL_USER: 'paneluser', ADMIN_PANEL_PASSWORD: 'panel-pass-123' };
const basic = { authorization: `Basic ${Buffer.from('paneluser:panel-pass-123').toString('base64')}` };

/** Read SSE "view" events from a real socket until `until` matches or time runs out. */
async function watchStream(base, cookie, until, ms = 4000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  const views = [];
  try {
    const res = await fetch(`${base}/api/stream/staff`, { headers: { cookie }, signal: ac.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const decoder = new TextDecoder();
    let buf = '';
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = block.split('\n').find((l) => l.startsWith('data: '));
        if (block.includes('event: view') && data) {
          views.push(JSON.parse(data.slice(6)));
          if (until(views[views.length - 1])) return views;
        }
      }
    }
  } catch (error) {
    if (error.name !== 'AbortError') throw error;
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  return views;
}

test('結合：玉の登録から受付、自動振り分け、抽選、発券、引換、集計までがつながる', async (t) => {
  const f = await makeApp({ env: PANEL });
  t.after(() => f.close());
  const base = await f.app.listen({ port: 0, host: '127.0.0.1' });

  const admin = await f.staff('admin');
  const pc = await f.staff('admin', 'pc-admin');
  const op1 = await f.staff('operator');
  const op2 = await f.staff('operator');
  await f.req('POST', '/api/staff/machine', { cookie: op1, body: { machineId: 'garagara-1' } });
  await f.req('POST', '/api/staff/machine', { cookie: op2, body: { machineId: 'garagara-2' } });
  const tokens = f.stampPoints();
  const ok = (r, label) => { assert.ok(r.status < 300, `${label}: ${r.status} ${JSON.stringify(r.json)}`); return r.json; };

  // 1. Dashboard: register the stock, compute the plan, record the swap.
  ok(await f.command(pc, { type: 'setInventory', contents: {}, spare: { red: 25, green: 70, lightblue: 150, white: 400 } }), 'stock');
  const plan = ok(await f.req('GET', '/api/staff/ball-plan?garagara-1=30&garagara-2=30', { cookie: pc }), 'plan');
  ok(await f.command(pc, { type: 'rebalanceBalls', moves: Object.fromEntries(plan.machines.map((m) => [m.id, m.moves])) }), 'rebalance');
  const ledgerBefore = (await f.req('GET', '/api/staff/view', { cookie: admin })).json.ledger;
  assert.deepEqual(COLORS.map((c) => ledgerBefore[c].total), [25, 70, 150, 400]);

  // 2. Visitor: card, three stamps and ⑤ by tap; the intake QR appears only after the survey.
  const visitor = f.cookieOf((await f.req('POST', '/api/visitor/cards')).res);
  for (const i of [0, 1, 2]) ok(await f.req('POST', '/api/visitor/stamps', { cookie: visitor, body: { payload: `MARUGOTO2026:STAMP:${tokens[i]}`, cellIndex: i } }), `stamp ${i}`);
  ok(await f.req('POST', '/api/visitor/tap', { cookie: visitor, body: { cellIndex: 4 } }), 'tap ⑤');
  let card = (await f.req('GET', '/api/visitor/card', { cookie: visitor, origin: null })).json;
  assert.equal(card.lines, 1);
  assert.equal(card.qrPayload, null);
  ok(await f.req('POST', '/api/visitor/survey', { cookie: visitor, body: { consent: true, ageGroup: '40代', gender: '女性', ratings: { event: 5, bingo: 4, digital: 5 } } }), 'survey');
  card = (await f.req('GET', '/api/visitor/card', { cookie: visitor, origin: null })).json;
  assert.ok(card.qrPayload);

  // 3. Camera 1 routes the digital card and then a paper card to the two machines.
  const sse = watchStream(base, op1, (v) => v.machines[0].activeSession);
  const dig = ok(await f.req('POST', '/api/camera/card-read', { cookie: pc, body: { machineId: 'auto', kind: 'digital', qrPayload: card.qrPayload } }), 'route digital');
  const pap = ok(await f.req('POST', '/api/camera/card-read', { cookie: pc, body: { machineId: 'auto', kind: 'paper', cells: [true, false, false, true, false, false, true, false, false], cornerPresent: true } }), 'route paper');
  assert.deepEqual([dig.machineId, pap.machineId], ['garagara-1', 'garagara-2']);

  // 4. Tablets confirm the reads and enter the balls.
  const rev = (id) => f.svc.draw.getState().machines[id].revision;
  const s1 = ok(await f.req('POST', '/api/staff/cards/accept', { cookie: op1, body: { kind: 'digital', readId: dig.readId, machineId: 'garagara-1', expectedMachineRevision: rev('garagara-1'), operationId: f.op() } }), 'accept 1').result.sessionId;
  const s2 = ok(await f.req('POST', '/api/staff/cards/accept', { cookie: op2, body: { kind: 'paper', readId: pap.readId, marks: [true, false, false, true, false, false, true, false, false], cornerPresent: true, machineId: 'garagara-2', expectedMachineRevision: rev('garagara-2'), operationId: f.op() } }), 'accept 2').result.sessionId;
  const views = await sse;
  assert.ok(views.some((v) => v.machines[0].activeSession?.id === s1), 'the tablet stream showed the new session');
  // The same card cannot be routed again once used.
  assert.equal((await f.req('POST', '/api/camera/card-read', { cookie: pc, body: { machineId: 'auto', kind: 'digital', qrPayload: card.qrPayload } })).json.error, 'CARD_ALREADY_USED');
  for (const [cookie, machineId, sessionId] of [[op1, 'garagara-1', s1], [op2, 'garagara-2', s2]]) {
    ok(await f.command(cookie, { type: 'manualBall', machineId, sessionId, color: 'white' }), 'ball');
    ok(await f.command(cookie, { type: 'finalizeResult', machineId, sessionId, trayEmptied: true }), 'finalize');
  }

  // 5. The Windows PC prints both vouchers; the tablets see the status.
  const queue = (await f.req('GET', '/api/staff/view', { cookie: pc })).json.printQueue;
  assert.deepEqual(queue.map((j) => j.sessionId).sort(), [s1, s2].sort());
  for (const j of queue) {
    for (const outcome of ['claimed', 'dispatched', 'confirmed']) ok(await f.command(pc, { type: 'recordPrintResult', sessionId: j.sessionId, jobId: j.jobId, outcome, station: 'WindowsPC' }), outcome);
    assert.equal(j.draws, 1);
  }
  const svg = await f.req('GET', `/api/staff/vouchers/${s1}/qr.svg`, { cookie: pc });
  assert.equal(svg.status, 200);

  // 6. Prize exchange (optional in the organisers' operation) for one voucher.
  ok(await f.command(admin, { type: 'redeemPrize', voucher: s1 }), 'redeem');
  assert.equal((await f.command(admin, { type: 'redeemPrize', voucher: s1 })).json.error, 'ALREADY_REDEEMED');

  // 7. Panel, CSV and ledger agree with what happened.
  const sum = (await f.req('GET', '/api/panel/summary', { headers: basic, origin: null })).json;
  assert.equal(sum.totals.sessions, 2);
  assert.equal(sum.totals.finalized, 2);
  assert.equal(sum.totals.redeemed, 1);
  assert.equal(sum.prizes.find((p) => p.color === 'white').allocated, 2);
  assert.equal(sum.surveys.total, 1);
  const csv = (await f.req('GET', '/api/panel/export/sessions.csv', { headers: basic, origin: null })).res.body;
  assert.equal(csv.trim().split('\n').length, 3, 'header and two sessions');
  const view = (await f.req('GET', '/api/staff/view', { cookie: admin })).json;
  assert.deepEqual(COLORS.map((c) => view.ledger[c].total), [25, 70, 150, 400], 'no ball appeared or vanished');
  assert.equal(view.ledger.white.storedValid, 2);
  const after = ok(await f.req('GET', '/api/staff/ball-plan?garagara-1=30&garagara-2=30', { cookie: pc }), 'plan after');
  assert.equal(after.remaining.white, 378);
  const log = (await f.req('GET', '/api/staff/audit?limit=200', { cookie: admin })).json.rows.map((r) => r.type);
  for (const type of ['setInventory', 'rebalanceBalls', 'startSession', 'manualBall', 'finalizeResult', 'recordPrintResult', 'redeemPrize']) assert.ok(log.includes(type), `audit has ${type}`);
});
