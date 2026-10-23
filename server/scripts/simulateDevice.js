// Simulates a venue-PC program against the device API (§8.4).
//   node scripts/simulateDevice.js --url http://127.0.0.1:3000 --machine garagara-1 --token <token> heartbeat
//   ... ball red [--uncertain] [--generation BM-0003]
//   ... paper 1,1,1,0,1,0,1,0,1 [--no-corner]
//   ... loop   (heartbeat every 5 s)
// Each run uses a fresh bootId unless --boot is given; seq numbers start at 1
// per boot and stream, as the real program must do.
import { randomUUID } from 'node:crypto';
import { arg, die } from './lib.js';

const url = arg('url', 'http://127.0.0.1:3000');
const machineId = arg('machine', 'garagara-1');
const token = arg('token', process.env.MB_DEVICE_TOKEN);
const bootId = arg('boot', randomUUID());
if (!token || token === true) die('--token or MB_DEVICE_TOKEN is required');
const VALUE_FLAGS = new Set(['--url', '--machine', '--token', '--boot', '--generation']);
const positional = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !VALUE_FLAGS.has(all[i - 1]));
const [command, value] = positional;
const seqs = { ball: 0, card: 0 };

async function send(method, pathName, body) {
  for (let delay = 1000; ; delay = Math.min(delay * 2, 10_000)) {
    try {
      const res = await fetch(`${url}${pathName}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
      const json = await res.json().catch(() => ({}));
      if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
      return { status: res.status, json };
    } catch (error) {
      console.error(`retry in ${delay} ms: ${error.message}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

const now = () => new Date().toISOString();
async function heartbeat() {
  return send('POST', '/api/device/v1/heartbeat', { machineId, bootId, lastSeq: seqs.ball, cameraOk: true, sensorsOk: true, at: now() });
}

if (command === 'heartbeat') {
  console.log(await heartbeat());
} else if (command === 'loop') {
  for (;;) {
    console.log(new Date().toLocaleTimeString(), (await heartbeat()).status);
    await new Promise((r) => setTimeout(r, 5000));
  }
} else if (command === 'state') {
  console.log(await send('GET', '/api/device/v1/state'));
} else if (command === 'ball') {
  const state = (await send('GET', '/api/device/v1/state')).json;
  seqs.ball += 1;
  const generation = arg('generation', state.generation ?? undefined);
  const body = { machineId, bootId, seq: seqs.ball, detectedColor: value === 'null' ? null : value, confidence: 0.9, orderUncertain: arg('uncertain', false) === true, detectedAt: now(), generation };
  console.log(await send('POST', '/api/device/v1/ball-events', body));
} else if (command === 'paper') {
  const cells = String(value ?? '').split(',').map((v) => (v === '1' ? true : v === '0' ? false : null));
  seqs.card += 1;
  console.log(await send('POST', '/api/device/v1/card-reads', { machineId, bootId, readSeq: seqs.card, kind: 'paper', cells, cornerPresent: arg('no-corner', false) !== true, qrPayload: null, readAt: now() }));
} else {
  die('command must be heartbeat | loop | state | ball <color|null> | paper <9 comma values>');
}
