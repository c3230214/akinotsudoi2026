// Windows PC screen. The two frames are ordinary same-origin pages: the
// camera screen (/camera/) and the print screen (/print/). The print frame
// calls print() on its own document, so only the voucher is printed; with
// Chrome started with --kiosk-printing it goes straight to the MP-B20.
// Keep the PC awake while this page is open (where the browser allows it).
async function keepAwake() {
  try {
    if (!('wakeLock' in navigator)) return;
    await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') navigator.wakeLock.request('screen').catch(() => {}); });
  } catch { /* falls back to the Windows power settings */ }
}
keepAwake();
