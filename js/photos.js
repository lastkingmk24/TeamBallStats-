/* =========================================================================
 * photos.js — player photo upload with client-side canvas compression.
 *
 *   • accepts JPEG / PNG / WebP / GIF from <input type="file">
 *   • centre-crops to a square and resizes to 128 × 128 on a <canvas>
 *   • encodes WebP (quality 0.82) with a JPEG fallback
 *   • returns a data: URL only — nothing is uploaded, nothing is fetched
 *   • guards localStorage quota before a huge photo can be stored
 *
 * The data URL is stored in players[].photo and round-trips through the JSON
 * backup format. CSV exports deliberately ignore photos.
 * ========================================================================= */
(function (TBS) {
  'use strict';

  const MAX_PX = 128;
  const QUALITY = 0.82;
  const MAX_CHARS = 360000;          /* ≈ 270 KB per avatar, hard ceiling */
  const MAX_SOURCE_BYTES = 12 * 1024 * 1024;
  const QUOTA_BUDGET = 4.2 * 1024 * 1024;

  let webpSupport = null;

  function supportsWebP() {
    if (webpSupport !== null) return webpSupport;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      webpSupport = canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (_) {
      webpSupport = false;
    }
    return webpSupport;
  }

  function isPhoto(value) {
    return typeof value === 'string' &&
      /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(value.trim());
  }

  /* Approximate stored bytes for a data URL (localStorage is UTF-16). */
  function bytesOf(dataUrl) {
    return isPhoto(dataUrl) ? dataUrl.length * 2 : 0;
  }

  function usageBytes() {
    try {
      return TBS.storage.usage().bytes;
    } catch (_) {
      return 0;
    }
  }

  function quotaMessage(extraBytes) {
    const total = usageBytes() + (extraBytes || 0);
    if (total <= QUOTA_BUDGET) return '';
    return 'Storage is almost full (~' + Math.round(total / 1024) + ' KB). ' +
      'Remove a photo or two, or export a JSON backup first — browsers stop saving at about 5 MB.';
  }

  function renderAvatar(image) {
    const size = MAX_PX;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable');

    ctx.fillStyle = '#141b27';
    ctx.fillRect(0, 0, size, size);

    const width = image.naturalWidth || image.width || size;
    const height = image.naturalHeight || image.height || size;
    const edge = Math.max(1, Math.min(width, height));
    const sx = Math.max(0, (width - edge) / 2);
    const sy = Math.max(0, (height - edge) / 2);

    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, sx, sy, edge, edge, 0, 0, size, size);

    const preferred = supportsWebP() ? 'image/webp' : 'image/jpeg';
    let quality = QUALITY;
    let out = canvas.toDataURL(preferred, quality);
    if (preferred === 'image/webp' && out.indexOf('data:image/webp') !== 0) {
      out = canvas.toDataURL('image/jpeg', quality);
    }
    /* Shrink further only if a 128px image somehow blew past the ceiling
     * (pathological input, no WebP support, …). */
    let guard = 0;
    while (out.length > MAX_CHARS && quality > 0.4 && guard < 6) {
      quality -= 0.12;
      guard++;
      const type = out.indexOf('data:image/jpeg') === 0 ? 'image/jpeg' : 'image/webp';
      out = canvas.toDataURL(type, quality);
    }
    return out;
  }

  /* Read + compress one file. cb(errorMessage|null, dataUrl|undefined) */
  function compressFile(file, cb) {
    const done = typeof cb === 'function' ? cb : function () {};
    if (!file) { done('No image selected.'); return; }
    if (!/^image\//.test(file.type || '')) {
      done('Choose an image file (JPEG, PNG or WebP).');
      return;
    }
    if (file.size > MAX_SOURCE_BYTES) {
      done('That image is larger than 12 MB. Pick a smaller photo.');
      return;
    }
    let reader;
    try {
      reader = new FileReader();
    } catch (_) {
      done('This browser cannot read local files.');
      return;
    }
    reader.onerror = () => done('Could not read that file.');
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => done('That image could not be decoded.');
      image.onload = () => {
        let dataUrl = '';
        try {
          dataUrl = renderAvatar(image);
        } catch (_) {
          done('Could not process that image.');
          return;
        }
        if (!isPhoto(dataUrl)) {
          done('Could not convert that image.');
          return;
        }
        const warning = quotaMessage(bytesOf(dataUrl));
        if (warning) {
          /* Still offer it: the caller decides, but warn clearly. */
          done(warning, dataUrl);
          return;
        }
        done(null, dataUrl);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  }

  /* Wire a file input. opts: {onPhoto(dataUrl), onError(message), onBusy(bool)} */
  function bindInput(input, opts) {
    if (!input) return;
    const o = opts || {};
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      if (o.onBusy) o.onBusy(true);
      compressFile(file, (error, dataUrl) => {
        if (o.onBusy) o.onBusy(false);
        input.value = '';
        if (dataUrl) {
          if (o.onPhoto) o.onPhoto(dataUrl);
          if (error && o.onError) o.onError(error);
        } else if (error && o.onError) {
          o.onError(error);
        }
      });
    });
  }

  TBS.photos = {
    MAX_PX: MAX_PX,
    QUALITY: QUALITY,
    MAX_CHARS: MAX_CHARS,
    MAX_SOURCE_BYTES: MAX_SOURCE_BYTES,
    supportsWebP: supportsWebP,
    isPhoto: isPhoto,
    bytesOf: bytesOf,
    usageBytes: usageBytes,
    quotaMessage: quotaMessage,
    compressFile: compressFile,
    bindInput: bindInput,
    renderAvatar: renderAvatar
  };
})(window.TBS = window.TBS || {});
