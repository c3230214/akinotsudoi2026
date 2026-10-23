/* global jsQR */
// QR reading with the device camera (needs HTTPS or localhost) and an image
// file fallback. jsQR is loaded as a classic script from /vendor/jsQR.js.
// Frames are processed in memory only; nothing is uploaded.

let jsqrLoading = null;
function loadJsQr() {
  if (globalThis.jsQR) return Promise.resolve();
  if (!jsqrLoading) {
    jsqrLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = '/vendor/jsQR.js';
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('QR読取部品を読み込めませんでした'));
      document.head.append(s);
    });
  }
  return jsqrLoading;
}

function decode(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const code = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
  return code?.data ?? null;
}

/**
 * Open a full-screen scanner dialog. Resolves with the decoded text, or null
 * when the user closes it.
 */
export async function scanQr({ title = 'QRコードを読み取る', hint = '' } = {}) {
  await loadJsQr();
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'scanner';
    dlg.innerHTML = `
      <div class="scanner-head"><h2></h2><button type="button" class="btn" data-close>閉じる</button></div>
      <p class="scanner-hint"></p>
      <div class="scanner-view"><video playsinline muted></video><div class="scanner-frame" aria-hidden="true"></div></div>
      <p class="scanner-msg" role="status" aria-live="polite">カメラを起動しています…</p>
      <label class="btn btn-secondary scanner-file">写真から読み取る<input type="file" accept="image/*" hidden></label>`;
    dlg.querySelector('h2').textContent = title;
    dlg.querySelector('.scanner-hint').textContent = hint;
    document.body.append(dlg);
    const video = dlg.querySelector('video');
    const msg = dlg.querySelector('.scanner-msg');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let stream = null;
    let raf = 0;
    let done = false;

    const finish = (value) => {
      if (done) return;
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      dlg.close();
      dlg.remove();
      resolve(value);
    };

    const tick = () => {
      if (done) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const scale = Math.min(1, 640 / video.videoWidth);
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const text = decode(ctx, canvas.width, canvas.height);
        if (text) {
          navigator.vibrate?.(60);
          finish(text);
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    dlg.querySelector('[data-close]').addEventListener('click', () => finish(null));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.querySelector('input[type=file]').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const bmp = await createImageBitmap(file);
        const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
        canvas.width = Math.round(bmp.width * scale);
        canvas.height = Math.round(bmp.height * scale);
        ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
        const text = decode(ctx, canvas.width, canvas.height);
        if (text) finish(text);
        else msg.textContent = 'この写真からQRコードを見つけられませんでした。QRを大きく写してください';
      } catch {
        msg.textContent = '写真を読み込めませんでした';
      }
    });

    dlg.showModal();
    if (!navigator.mediaDevices?.getUserMedia) {
      msg.textContent = 'この画面ではカメラを使えません。「写真から読み取る」を使ってください';
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (done) { s.getTracks().forEach((t) => t.stop()); return; }
        stream = s;
        video.srcObject = s;
        return video.play().then(() => {
          msg.textContent = 'QRコードを枠の中に写してください';
          raf = requestAnimationFrame(tick);
        });
      })
      .catch(() => {
        msg.textContent = 'カメラを起動できませんでした。カメラの許可を確認するか「写真から読み取る」を使ってください';
      });
  });
}
