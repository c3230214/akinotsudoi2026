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

// 「玉と景品」 opens the ball and prize dashboard over the camera frame. The
// camera frame stays loaded (not removed), so scanning keeps running.
const dash = document.getElementById('dash');
const toggle = document.getElementById('dash-toggle');
toggle.addEventListener('click', () => {
  const open = dash.hidden;
  dash.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'カメラに戻る' : '玉と景品';
  const f = document.getElementById('f-balls');
  if (open && !f.src) f.src = f.dataset.src;
});
