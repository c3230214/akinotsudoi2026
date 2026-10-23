export class ApiError extends Error {
  constructor(status, code, message, data) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK', '通信できませんでした。電波の状態を確認してください');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or non-JSON body */ }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'HTTP', data?.message ?? `エラー（HTTP ${res.status}）`, data);
  return data;
}

export const getJson = (url) => api('GET', url);
export const postJson = (url, body = {}) => api('POST', url, body);

export function operationId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a command and retry with the SAME operationId on network errors and
 * 5xx (§15 C08). Business rejections (4xx) are returned to the caller as-is.
 */
export async function sendWithRetry(url, body, { attempts = 8, onRetry } = {}) {
  let delay = 1000;
  for (let i = 1; ; i += 1) {
    try {
      return await postJson(url, body);
    } catch (error) {
      const retryable = error.status === 0 || error.status >= 500;
      if (!retryable || i >= attempts) throw error;
      onRetry?.(i, error);
      await sleep(delay);
      delay = Math.min(delay * 2, 10_000);
    }
  }
}

/**
 * Sequential queue so rapid taps on a slow line are sent one by one, each
 * with its own operationId (§15 C07). After a business error the remaining
 * queued items are dropped so nothing runs against a state the user did not see.
 */
export class CommandQueue {
  constructor({ url = '/api/staff/commands', onChange = () => {} } = {}) {
    this.url = url;
    this.items = [];
    this.running = false;
    this.onChange = onChange;
  }

  get pending() { return this.items.length + (this.running ? 1 : 0); }

  push(body) {
    return new Promise((resolve, reject) => {
      this.items.push({ body: { operationId: operationId(), ...body }, resolve, reject });
      this.onChange(this.pending);
      this.#run();
    });
  }

  async #run() {
    if (this.running) return;
    this.running = true;
    while (this.items.length) {
      const item = this.items.shift();
      this.onChange(this.pending);
      try {
        item.resolve(await sendWithRetry(this.url, item.body));
      } catch (error) {
        item.reject(error);
        const dropped = this.items.splice(0);
        for (const d of dropped) d.reject(new ApiError(0, 'CANCELLED', '前の操作が失敗したため、続けて押した操作は送信していません'));
      }
    }
    this.running = false;
    this.onChange(0);
  }
}
