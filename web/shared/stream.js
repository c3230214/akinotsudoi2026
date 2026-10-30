import { noticeVersion } from './api.js';

/**
 * EventSource wrapper. Each `view` event carries the full projection, so a
 * reconnect always lands on the latest state (§9.2).
 */
export function openStream(url, { onView, onStatus = () => {} }) {
  let es = null;
  let closed = false;
  let retryTimer = null;
  const connect = () => {
    es = new EventSource(url, { withCredentials: true });
    es.addEventListener('open', () => {
      onStatus('online');
      // A reconnect may follow a server update; check the build id.
      fetch('/health', { cache: 'no-store' }).then((r) => noticeVersion(r.headers.get('X-App-Version'))).catch(() => {});
    });
    es.addEventListener('view', (e) => {
      try {
        onView(JSON.parse(e.data));
      } catch (error) {
        console.error(error);
      }
    });
    es.addEventListener('error', () => {
      onStatus('offline');
      // The browser retries by itself unless the server answered 401/403.
      if (es.readyState === EventSource.CLOSED && !closed) {
        clearTimeout(retryTimer);
        retryTimer = setTimeout(connect, 5000);
      }
    });
  };
  connect();
  // Coming back with the browser's back button can restore a frozen copy of
  // the page; reload so the live state is shown.
  window.addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
  return () => {
    closed = true;
    clearTimeout(retryTimer);
    es?.close();
  };
}
