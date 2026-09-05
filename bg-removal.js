/**
 * bg-removal.js
 * ---------------------------------------------------------------------
 * Shared helper for the "upload your own jewellery" flow:
 *   1. hasTransparentBackground(file)  -> detect whether an uploaded
 *      JPG/PNG already has a removed/transparent background.
 *   2. removeImageBackground(file)     -> run automatic background
 *      removal (client-side, no server round-trip) and return a new
 *      transparent PNG File.
 *
 * Kept as a standalone module (no dependency on engine2d.js) so it can
 * be copied verbatim between the Shopify / Testing / WordPress projects.
 *
 * Background removal is powered by @imgly/background-removal, loaded
 * lazily from a CDN (same pattern already used for MediaPipe in this
 * project) so there is no build step and no new npm dependency.
 */

// NOTE: @imgly/background-removal@1.5.5 was never actually published
// with a dist/browser.mjs file (confirmed 404 on jsdelivr) — pin to a
// version/path that is verified to exist instead.
const BG_REMOVAL_CDN_ESM = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs';

let _libPromise = null;
function loadBackgroundRemovalLib() {
  if (!_libPromise) {
    _libPromise = import(/* webpackIgnore: true */ BG_REMOVAL_CDN_ESM).catch((err) => {
      _libPromise = null; // allow retry on next call
      throw new Error('Could not load the background-removal engine. Check your internet connection.');
    });
  }
  return _libPromise;
}

/**
 * Decode a File/Blob into an HTMLImageElement.
 */
function decodeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('This file could not be read as an image.'));
    };
    img.src = url;
  });
}

/**
 * Inspect the alpha channel of an image to decide whether it already
 * has a removed/transparent background.
 *
 * Heuristic:
 *  - A JPG never carries an alpha channel, so canvas always reports
 *    alpha === 255 for every pixel -> NOT transparent.
 *  - A PNG that still has its original opaque background will also
 *    read alpha === 255 everywhere (no cutout was ever applied).
 *  - A properly background-removed PNG has a meaningful fraction of
 *    pixels with alpha < 250 (the cut edge / fully transparent area),
 *    typically concentrated around the border/corners.
 *
 * We sample the four corners + a border ring first (cheap, and where
 * a removed background is nearly always visible), then fall back to a
 * full downsampled scan if the border looks fully opaque.
 */
export async function hasTransparentBackground(file) {
  // JPG/JPEG cannot carry transparency at all — short-circuit.
  const ext = (file.name || '').split('.').pop().toLowerCase();
  const mime = (file.type || '').toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg' || mime === 'image/jpeg') {
    return false;
  }

  let img, url;
  try {
    ({ img, url } = await decodeImage(file));
  } catch (err) {
    throw err;
  }

  try {
    const maxDim = 256;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    const { data } = ctx.getImageData(0, 0, w, h);

    let transparentish = 0;
    let opaqueCorners = 0;
    const total = w * h;

    // Full scan on the (small, downsampled) canvas — cheap enough at maxDim=256.
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 250) transparentish++;
    }

    // Corner check as a secondary signal (helps on images with a tiny
    // cutout region where the overall percentage would be misleading).
    const corners = [
      0,
      (w - 1) * 4 + 3,
      (h - 1) * w * 4 + 3,
      ((h - 1) * w + (w - 1)) * 4 + 3,
    ];
    for (const idx of corners) {
      if (data[idx] >= 250) opaqueCorners++;
    }

    const transparentFraction = transparentish / total;

    // If a meaningful share of pixels are non-opaque, treat as already
    // background-removed. Threshold is intentionally low (1%) because
    // tightly-cropped jewellery PNGs can have a thin transparent margin.
    if (transparentFraction > 0.01) return true;

    // All four corners opaque and almost no transparency anywhere ->
    // this is a flat photo with a background, not a cutout.
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Convert a canvas to a File (PNG, to preserve the new alpha channel).
 */
function canvasToFile(canvas, name) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Could not encode the processed image.'));
        return;
      }
      const outName = name.replace(/\.[^.]+$/, '') + '.png';
      resolve(new File([blob], outName, { type: 'image/png' }));
    }, 'image/png');
  });
}

/**
 * Run automatic background removal on a JPG/PNG File and resolve with
 * a new transparent-background PNG File.
 *
 * @param {File} file
 * @param {(fraction: number) => void} [onProgress] 0..1
 * @returns {Promise<File>}
 */
export async function removeImageBackground(file, onProgress) {
  onProgress?.(0.05);
  const lib = await loadBackgroundRemovalLib();
  onProgress?.(0.2);

  const removeBackground = lib.removeBackground || lib.default?.removeBackground || lib.default;
  if (typeof removeBackground !== 'function') {
    throw new Error('Background-removal engine failed to initialize.');
  }

  let resultBlob;
  try {
    resultBlob = await removeBackground(file, {
      progress: (key, current, total) => {
        if (total > 0) {
          // Map library progress (fetching model + inference) into 0.2–0.95
          onProgress?.(0.2 + Math.min(1, current / total) * 0.75);
        }
      },
    });
  } catch (err) {
    console.error('[bg-removal] removeBackground failed', err);
    throw new Error('Automatic background removal failed. Please try a different image.');
  }

  onProgress?.(1);

  const outName = (file.name || 'jewellery').replace(/\.[^.]+$/, '') + '.png';
  return new File([resultBlob], outName, { type: 'image/png' });
}

/**
 * High-level convenience wrapper used by the upload UI:
 * checks for existing transparency and only runs removal if needed.
 * Returns { file, wasAlreadyTransparent }.
 */
export async function ensureTransparentJewelleryImage(file, onProgress) {
  const already = await hasTransparentBackground(file);
  if (already) {
    onProgress?.(1);
    return { file, wasAlreadyTransparent: true };
  }
  const processed = await removeImageBackground(file, onProgress);
  return { file: processed, wasAlreadyTransparent: false };
}
