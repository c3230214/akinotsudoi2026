// Pieces shared by the staff-side screens (staff, tablets, Windows PC camera,
// print and ball dashboard), so each screen behaves the same way.
import { ApiError, operationId, postJson, sendWithRetry } from './api.js';
import { $, COLOR_LABELS, html, render, toast } from './html.js';

/** Coloured ball with its name (colour is never the only cue). */
export const ballChip = (color, label) => html`<span class="chip"><span class="ball ball-${color ?? 'null'}" aria-hidden="true"></span>${label ?? (color ? COLOR_LABELS[color] : '未判定')}</span>`;

export function showError(error) {
  toast(error instanceof ApiError ? error.message : String(error?.message ?? error), { kind: 'error', ms: 6000 });
}

/**
 * Send one staff command with a fresh operationId; network errors retry with
 * the same id. Resolves with the result, or null after showing the error.
 */
export async function sendCommand(body, { okToast = true } = {}) {
  try {
    const out = await sendWithRetry('/api/staff/commands', { operationId: operationId(), ...body }, { onRetry: () => toast('通信を再試行しています…') });
    if (okToast && out?.message) toast(out.message, { kind: 'ok' });
    return out;
  } catch (error) {
    showError(error);
    return null;
  }
}

/** Staff sign-in form; reloads the page once signed in. */
export function mountLogin(root, { title = 'スタッフアカウントでログイン', note = '' } = {}) {
  render(root, html`
    <form id="login" class="panel login stack">
      <h1>${title}</h1>
      <label for="login-name">ログイン名</label>
      <input id="login-name" autocomplete="username" autocapitalize="off" required>
      <label for="login-pass">パスコード</label>
      <input id="login-pass" type="password" autocomplete="current-password" required>
      <button class="btn btn-block">ログイン</button>
      ${note}
    </form>`);
  $('#login', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await postJson('/api/staff/login', { loginName: $('#login-name', root).value, passcode: $('#login-pass', root).value });
      location.reload();
    } catch (error) { showError(error); }
  });
}

/** Keep the screen on while the page is open (where the browser allows it). */
export async function keepAwake() {
  try {
    if (!('wakeLock' in navigator)) return;
    await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(() => {});
    });
  } catch { /* not allowed; the device's own sleep setting applies */ }
}

/** Voucher print state as staff read it. */
export function printStatusLabel(v) {
  if (v.redeemedAt) return '引換済み';
  return {
    none: '未印刷', queued: '印刷待ち', printing: '印刷中', dispatched: '印刷済み（排紙未確認）', confirmed: '印刷済み（排紙確認）', failed: '印刷失敗（再印刷します）',
  }[v.printStatus] ?? v.printStatus;
}
