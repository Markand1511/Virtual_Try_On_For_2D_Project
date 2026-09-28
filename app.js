import { MediaPipeTracker, getTrackingLabel } from './mediapipe.js';
import {
  Engine2D,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  MODEL_EXTENSIONS,
  RING_FINGERS,
  discoverItems,
  buildCatalogueEntries,
  CATALOGUE_MANIFEST,
} from './engine2d.js';

const NOTIFICATION_DURATION = 4000;
const NOTIFICATION_GAP = 10;
const NOTIFICATION_MAX = 3;
const NOTIFICATION_LEAVE_MS = 420;

const CAMERA_OFF_MESSAGE = 'Please Turn On Your Camera';


const $ = (sel) => document.querySelector(sel);

// Module-scoped variables (initialized in init())
let video, canvas2d, placeholder, loadingOverlay, loadingText;
let btnStart, btnStop, btnScreenshot, trackingStatus, trackingLabel;
let jewelleryControls, cameraSlot, cameraSection, btnCloseTryOn;

// Wait for DOM to be fully ready before accessing elements
if (document.readyState === 'loading') {
  await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
} else if (document.readyState === 'interactive') {
  // DOM is parsing but not fully ready - wait for completion
  await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
}

// Now DOM is guaranteed ready
video = $('#video');
canvas2d = $('#canvas2d');
placeholder = $('#camera-placeholder');
loadingOverlay = $('#loading-overlay');
loadingText = $('#loading-text');
btnStart = $('#btn-start');
btnStop = $('#btn-stop');
btnScreenshot = $('#btn-screenshot');
trackingStatus = $('#tracking-status');
trackingLabel = $('#tracking-label');
jewelleryControls = $('#jewellery-controls');
cameraSlot = document.getElementById('tryon-camera-slot');
cameraSection = document.querySelector('.camera-section');
btnCloseTryOn = document.getElementById('btn-close-tryon');

// Validate critical elements exist
if (!canvas2d) throw new Error('Critical element #canvas2d not found');
if (!video) throw new Error('Critical element #video not found');

const engine = new Engine2D(canvas2d);
engine.setVideoElement(video);
const tracker = new MediaPipeTracker();

let stream = null;
let running = false;
// The jewellery UI is inert until the camera is live
let cameraOn = false;
let rafId = null;
let catalogue = [];
let latestTracking = null;
let lastLabel = '';
const activeByCategory = new Map();
const activeIds = new Set();

// In-flight load per category, identified by a monotonic token
const pendingByCategory = new Map();
let requestSeq = 0;

const notificationItems = [];
let cameraPermissionDenied = false;
let lastCameraErrorMessage = 'Unable to access camera. Please allow camera permission.';
let trackingGeneration = 0;
let backNavBound = false;

// From ?category=&item= or window.VTO_BOOT (WordPress product → Try On)
const boot = readBootConfig();
let pendingAutoItemId = boot.item || '';

injectNotificationStyles();

function readBootConfig() {
  const params = new URLSearchParams(location.search);
  const fromWindow = (typeof window !== 'undefined' && window.VTO_BOOT) ? window.VTO_BOOT : {};
  let category = (params.get('category') || fromWindow.category || '').toLowerCase().trim();
  let item = (params.get('item') || fromWindow.item || '').trim();
  item = item.replace(/[^a-zA-Z0-9_\-]/g, '');
  if (category === 'earrings' || category === 'studs' || category === 'stud') category = 'earring';
  if (category === 'rings') category = 'ring';
  // `bracelet` still accepted on the way in — old links and old product meta
  if (category === 'bracelet' || category === 'bracelets'
    || category === 'bangle' || category === 'kada') category = 'bangles';
  if (category === 'necklaces' || category === 'chain' || category === 'pendant') category = 'necklace';
  return { category, item };
}

// Chrome

function injectNotificationStyles() {
  if (document.getElementById('vto-notification-styles')) return;
  const style = document.createElement('style');
  style.id = 'vto-notification-styles';
  style.textContent = `
    #vto-notification-host {
      position: fixed;
      left: 0;
      right: 0;
      top: 1.5rem;
      bottom: auto;
      z-index: 9999;
      pointer-events: none;
      height: 0;
    }
    .vto-notification {
      position: absolute;
      left: 50%;
      top: 0;
      bottom: auto;
      width: max-content;
      max-width: min(90vw, 420px);
      padding: 0.7rem 1.4rem;
      background: rgba(19, 18, 16, 0.94);
      border: 1px solid rgba(var(--gold-rgb, 197, 164, 100), 0.45);
      border-radius: 14px;
      color: var(--text-primary, #F2ECE0);
      font-family: 'Poppins', sans-serif;
      font-size: 0.82rem;
      letter-spacing: 0.03em;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 0 24px rgba(var(--gold-rgb, 197, 164, 100), 0.15);
      text-align: center;
      opacity: 0;
      transform: translateX(-50%) translateY(calc(var(--stack-y, 0px) - 18px));
      transition: opacity 0.38s ease, transform 0.42s cubic-bezier(0.22, 1, 0.36, 1);
      pointer-events: none;
    }
    .vto-notification.show {
      opacity: var(--stack-opacity, 1);
      transform: translateX(-50%) translateY(var(--stack-y, 0px));
    }
    .vto-notification.is-leaving {
      opacity: 0;
      transform: translateX(-50%) translateY(calc(var(--stack-y, 0px) - 12px));
    }
    @media (prefers-reduced-motion: reduce) {
      .vto-notification {
        transition-duration: 0.01ms;
      }
    }
    .jewellery-btn {
      transition: transform 0.22s cubic-bezier(0.4,0,0.2,1),
                  box-shadow 0.22s cubic-bezier(0.4,0,0.2,1),
                  background 0.22s cubic-bezier(0.4,0,0.2,1),
                  border-color 0.22s cubic-bezier(0.4,0,0.2,1),
                  color 0.22s cubic-bezier(0.4,0,0.2,1);
    }
    .jewellery-btn.active {
      transform: scale(1.04);
      animation: luxuryPulse 0.35s ease;
    }
    @keyframes luxuryPulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.06); }
      100% { transform: scale(1.04); }
    }
  `;
  document.head.appendChild(style);
}

function getNotificationHost() {
  let host = document.getElementById('vto-notification-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'vto-notification-host';
    host.setAttribute('aria-live', 'polite');
    host.setAttribute('aria-relevant', 'additions');
    document.body.appendChild(host);
  }
  return host;
}

function layoutNotificationStack() {
  let offset = 0;
  let depth = 0;
  for (let i = notificationItems.length - 1; i >= 0; i -= 1) {
    const item = notificationItems[i];
    if (item.exiting) continue;
    const opacity = depth === 0 ? 1 : depth === 1 ? 0.52 : 0.26;
    item.el.style.setProperty('--stack-y', `${offset}px`);
    item.el.style.setProperty('--stack-opacity', String(opacity));
    offset += item.el.offsetHeight + NOTIFICATION_GAP;
    depth += 1;
  }
}

function dismissNotification(item) {
  if (!item || item.exiting) return;
  item.exiting = true;
  clearTimeout(item.timer);
  item.el.classList.remove('show');
  item.el.classList.add('is-leaving');
  layoutNotificationStack();
  setTimeout(() => {
    item.el.remove();
    const idx = notificationItems.indexOf(item);
    if (idx !== -1) notificationItems.splice(idx, 1);
    layoutNotificationStack();
  }, NOTIFICATION_LEAVE_MS);
}

function showNotification(message) {
  const host = getNotificationHost();
  while (notificationItems.filter((item) => !item.exiting).length >= NOTIFICATION_MAX) {
    const oldest = notificationItems.find((item) => !item.exiting);
    if (!oldest) break;
    dismissNotification(oldest);
  }

  const el = document.createElement('div');
  el.className = 'vto-notification';
  el.setAttribute('role', 'status');
  el.textContent = message;
  host.appendChild(el);

  const item = { el, exiting: false, timer: null };
  notificationItems.push(item);
  layoutNotificationStack();
  requestAnimationFrame(() => {
    void el.offsetWidth;
    el.classList.add('show');
    layoutNotificationStack();
  });

  item.timer = setTimeout(() => dismissNotification(item), NOTIFICATION_DURATION);
}

function setTrackingUI(label, state) {
  if (label === lastLabel) return;
  lastLabel = label;
  trackingLabel.textContent = label;
  trackingStatus.className = `status-dot ${state}`;
}

function showLoading(message) {
  if (loadingText) loadingText.textContent = message;
  loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

// Viewport

function resizeViewport() {
  const wrapper = video.parentElement;
  const rect = wrapper.getBoundingClientRect();
  engine.resize(rect.width, rect.height);
  engine.setVideoSize(video.videoWidth, video.videoHeight);
}

// Catalogue

async function discoverCatalogue() {
  // objects/index.json is the source of truth for which folders exist —
  // a folder the user deletes (and removes from index.json) must actually
  // disappear from the homepage, not keep reappearing as a broken card.
  // The built-in manifest is used only as an emergency fallback when
  // index.json itself can't be read at all (e.g. offline first load).
  try {
    catalogue = await Promise.race([
      discoverItems(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
    ]);
    console.log('[Catalogue] Loaded from index.json:', catalogue.length, 'items');
  } catch (err) {
    console.warn('[Catalogue] index.json unreachable, using built-in fallback:', err.message);
    catalogue = buildCatalogueEntries(CATALOGUE_MANIFEST);
  }

  const missing = catalogue.filter((c) => !c.available).map((c) => c.folder);
  if (missing.length) {
    console.warn('[Catalogue] no image found in: ' + missing.join(', '));
  }
  console.log('[Catalogue] Final:', catalogue.map(c => ({ id: c.id, available: c.available, folder: c.folder })));
}

function catalogueImageUrl(item) {
  if (!item?.image) return null;
  const base = String(item.image).split('?')[0];
  const rev = item.demoRevision || item.modelRevision || '';
  if (!rev) return base;
  return `${base}?v=${encodeURIComponent(rev)}`;
}

const PRODUCT_BLURBS = {
  necklace: {
    lead: 'A refined neckpiece cut for quiet luxury — made to catch soft light at the collarbone.',
    bullets: ['Premium finish', 'Everyday to evening', 'Comfortable drape', 'Try on live with your camera'],
  },
  earring: {
    lead: 'Lightweight elegance for the ear — atelier gleam without the weight.',
    bullets: ['Secure wear', 'Day-to-night pairing', 'Polished detail', 'Preview on yourself instantly'],
  },
  ring: {
    lead: 'A sculpted band designed for the hand — mirror polish and comfort fit.',
    bullets: ['Comfort-fit feel', 'Statement or stack', 'High polish', 'See it on your finger live'],
  },
  bangles: {
    lead: 'A luminous bangle line for the wrist — fluid shine, intentional weight.',
    bullets: ['Smooth clasp feel', 'Layer or solo', 'Luxe finish', 'Try the fit on camera'],
  },
};

let currentView = 'home';
let selectedProduct = null;
let tryOnOnProductPage = false;

function setView(view) {
  currentView = view;
  const views = {
    home: document.getElementById('view-home'),
    detail: document.getElementById('view-detail'),
    tryon: document.getElementById('view-tryon'),
  };
  Object.entries(views).forEach(([name, el]) => {
    if (!el) return;
    const on = name === view;
    el.hidden = !on;
    el.classList.toggle('hidden', !on);
    el.classList.toggle('active', on);
  });
  syncHeaderStatus();

  if (view === 'home' && (tryOnOnProductPage || cameraOn)) {
    closeTryOnOnPage();
  }
  if (view === 'tryon' || tryOnOnProductPage) {
    requestAnimationFrame(() => resizeViewport());
  }
}

function syncHeaderStatus() {
  const status = document.querySelector('.header-status');
  if (status) status.style.display = (currentView === 'tryon' || tryOnOnProductPage) ? '' : 'none';
}

function buildHiddenJewelleryButtons(items) {
  if (!jewelleryControls) return;
  jewelleryControls.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.className = 'jewellery-buttons';
  for (const item of items) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'jewellery-btn';
    btn.textContent = item.label;
    btn.dataset.id = item.id;
    btn.dataset.category = item.category;
    if (!item.available) {
      btn.classList.add('unavailable');
      btn.disabled = true;
    } else {
      btn.addEventListener('click', () => toggleJewellery(item, btn));
    }
    wrap.appendChild(btn);
  }
  jewelleryControls.appendChild(wrap);
}

function orderedCatalogue() {
  const items = catalogue.filter((c) => c.available);
  const ordered = [];
  for (const key of CATEGORY_ORDER) {
    ordered.push(...items.filter((i) => i.category === key));
  }
  for (const item of items) {
    if (!ordered.includes(item)) ordered.push(item);
  }
  return ordered;
}

/** Main page: photo + name only */
function buildAllProductsHome() {
  const grid = document.getElementById('product-grid');
  if (!grid) return;
  grid.innerHTML = '';

  const items = orderedCatalogue();
  if (!items.length) {
    grid.innerHTML = '<p class="product-shelf__empty">No jewellery models found yet.</p>';
    return;
  }

  for (const item of items) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'product-tile';
    card.dataset.id = item.id;
    card.setAttribute('aria-label', item.label);

    const media = document.createElement('div');
    media.className = 'product-tile__media';
    const preview = catalogueImageUrl(item) || item.image;
    if (preview) {
      const img = document.createElement('img');
      img.src = preview;
      img.alt = item.label;
      img.loading = 'eager';
      img.decoding = 'async';
      img.width = 600;
      img.height = 600;
      img.sizes = '(max-width: 700px) 46vw, (max-width: 1100px) 30vw, 280px';
      img.addEventListener('error', () => {
        img.remove();
        media.classList.add('is-fallback');
      }, { once: true });
      media.appendChild(img);
    } else {
      media.classList.add('is-fallback');
    }

    const name = document.createElement('span');
    name.className = 'product-tile__name';
    name.textContent = item.label;

    card.append(media, name);
    card.addEventListener('click', () => openProductDetail(item));
    grid.appendChild(card);
  }
}

/** After tap: full details + Try On on one clean line */
function openProductDetail(item) {
  if (tryOnOnProductPage || cameraOn) closeTryOnOnPage();
  selectedProduct = item;
  const panel = document.getElementById('product-detail-panel');
  if (!panel) return;

  const blurb = PRODUCT_BLURBS[item.category] || PRODUCT_BLURBS.necklace;
  const bullets = blurb.bullets.slice(0, 3).map((b) => `<li>${b}</li>`).join('');
  const preview = catalogueImageUrl(item) || item.image;

  panel.innerHTML = `
    <article class="product-sheet">
      <div class="product-sheet__media${preview ? '' : ' is-fallback'}">
        ${preview ? `<img src="${preview}" alt="${item.label}" width="800" height="800" decoding="async">` : ''}
      </div>
      <div class="product-sheet__body">
        <p class="product-sheet__eyebrow">${CATEGORY_LABELS[item.category] || item.category}</p>
        <h4 class="product-sheet__title">${item.label}</h4>
        <p class="product-sheet__lead">${blurb.lead}</p>
        <ul class="product-sheet__list">${bullets}</ul>
        <div class="vto-product-tryon vto-product-tryon--bar">
          <button type="button" class="vto-product-tryon__btn" id="btn-open-tryon">
            <span class="vto-product-tryon__pulse" aria-hidden="true"></span>
            <span class="vto-product-tryon__shine" aria-hidden="true"></span>
            <span class="vto-product-tryon__label">Try On</span>
          </button>
        </div>
      </div>
    </article>
  `;

  panel.querySelector('#btn-open-tryon')?.addEventListener('click', () => openTryOn(item));
  setView('detail');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mountTryOnOnProductPhoto() {
  const media = document.querySelector('.product-sheet__media');
  if (!media || !cameraSection) return;
  media.classList.add('is-tryon-host');
  media.appendChild(cameraSection);
  document.documentElement.classList.add('vto-product-tryon-live');
  tryOnOnProductPage = true;
  if (btnCloseTryOn) btnCloseTryOn.hidden = false;
  // Start Camera isn't shown once mounted on the photo — Try On itself
  // starts the camera. Stop Camera / Capture remain.
  if (btnStart) btnStart.hidden = true;
  syncHeaderStatus();
  syncFingerPicker();

  // Try On = start camera immediately. Show the loading overlay right away
  // so there's never a moment with no feedback while the permission prompt
  // / camera stream / jewellery overlay are all coming up.
  showLoading('Opening camera…');
  startCamera()
    .catch((err) => console.error('[TryOn] auto-start', err))
    .finally(() => hideLoading());
}

function unmountTryOnFromProductPhoto() {
  document.documentElement.classList.remove('vto-product-tryon-live', 'vto-embed-needs-tap');
  document.querySelector('.product-sheet__media')?.classList.remove('is-tryon-host');
  if (cameraSlot && cameraSection && cameraSection.parentElement !== cameraSlot) {
    cameraSlot.appendChild(cameraSection);
  }
  if (btnCloseTryOn) btnCloseTryOn.hidden = true;
  if (btnStart) btnStart.hidden = false;
  tryOnOnProductPage = false;
  syncHeaderStatus();
  syncFingerPicker();
}

function closeTryOnOnPage() {
  if (cameraOn) stopCamera();
  // stopCamera() clears the engine's own render state (engine.hideAll()),
  // but app.js's own "what's currently on" bookkeeping (activeIds /
  // activeByCategory) is separate — without resetting it here too,
  // reopening the same piece later sees it as "already active" and skips
  // reloading it, so nothing ever renders again on the reopened try-on.
  clearAllJewellery();
  unmountTryOnFromProductPhoto();
}

// Shopify product page: the host tap opens the camera on the photo, without a
// second Start Camera tap. iOS may still refuse that, and then the Start
// Camera button is the way back in.
async function autoStartOnProductPage() {
  showLoading('Opening camera…');
  try {
    await startCamera();
  } finally {
    hideLoading();
  }
  if (!cameraOn) {
    document.documentElement.classList.add('vto-embed-needs-tap');
  } else {
    document.documentElement.classList.remove('vto-embed-needs-tap');
  }
}

function openTryOn(item) {
  if (tryOnOnProductPage && cameraOn && selectedProduct?.id === item.id) return;
  if (tryOnOnProductPage || cameraOn) closeTryOnOnPage();

  selectedProduct = item;
  clearAllJewellery();
  pendingAutoItemId = item.id;

  const label = document.getElementById('tryon-piece-label');
  if (label) label.textContent = item.label;

  const peers = catalogue.filter((c) => c.category === item.category && c.available);
  buildHiddenJewelleryButtons(peers);

  // Camera opens right inside the jewellery photo itself (no separate
  // page) — same diamond-icon placeholder + Start/Stop/Capture row as the
  // 3D reference, just mounted on the product image instead of a full page.
  setView('detail');
  mountTryOnOnProductPhoto();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildJewelleryUI() {
  buildAllProductsHome();

  if (!backNavBound) {
    backNavBound = true;
    document.getElementById('btn-back-grid')?.addEventListener('click', () => {
      closeTryOnOnPage();
      selectedProduct = null;
      setView('home');
    });
    document.getElementById('btn-back-detail')?.addEventListener('click', () => {
      closeTryOnOnPage();
      if (selectedProduct) openProductDetail(selectedProduct);
      else setView('home');
    });
  }

  if (boot.item) {
    const item = catalogue.find((c) => c.id === boot.item && c.available);
    if (item) {
      openProductDetail(item);
      return;
    }
  }
  setView('home');
}

// Ring finger prompt
//
// Tapping the finger on the camera is the ONLY way to choose one now, so this
// prompt is not decoration — nobody would guess the gesture without it. It
// stays on screen the whole time a ring is being worn.

function hasActiveRing() {
  for (const id of activeIds) {
    const item = catalogue.find((c) => c.id === id);
    if (item && item.category === 'ring') return true;
  }
  return false;
}

// Built once, into the instruction area above camera controls
function buildFingerPicker() {
  const existing = document.getElementById('vto-finger-picker');
  if (existing) return existing;

  const instructionArea = document.getElementById('instruction-area');
  if (!instructionArea) return null;

  const picker = document.createElement('div');
  picker.id = 'vto-finger-picker';
  picker.className = 'vto-finger-picker';
  picker.hidden = true;

  const hint = document.createElement('button');
  hint.type = 'button';
  hint.className = 'vto-finger-hint';
  hint.setAttribute('role', 'status');
  hint.setAttribute('title', 'Tap on any finger in the camera to move the ring');
  hint.setAttribute('aria-label', 'Ring Category: Tap on any finger in camera to move ring');

  const dot = document.createElement('span');
  dot.className = 'vto-finger-hint__dot';
  dot.setAttribute('aria-hidden', 'true');

  const categoryTag = document.createElement('span');
  categoryTag.className = 'vto-finger-hint__category';
  categoryTag.textContent = 'RING';

  const sep = document.createElement('span');
  sep.className = 'vto-finger-hint__sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = '•';

  const text = document.createElement('span');
  text.className = 'vto-finger-hint__text';
  text.textContent = 'Tap finger to place';

  hint.append(dot, categoryTag, sep, text);
  hint.addEventListener('click', () => {
    showNotification('Tap directly on any finger in the camera to place the ring');
  });

  picker.appendChild(hint);
  instructionArea.appendChild(picker);
  return picker;
}

function chooseFinger(key, announce = true) {
  const applied = engine.setRingFinger(key);
  syncFingerPicker();
  if (announce && RING_FINGERS[applied]) {
    showNotification(`Ring moved to the ${RING_FINGERS[applied].label.toLowerCase()} finger`);
  }
}

// The prompt is shown only while a ring is the piece being worn — it is the one
// piece the camera tap applies to.
function syncFingerPicker() {
  const picker = document.getElementById('vto-finger-picker');
  const instructionArea = document.getElementById('instruction-area');
  if (!picker || !instructionArea) return;

  const ringActive = hasActiveRing();
  picker.hidden = !ringActive;
  instructionArea.hidden = !ringActive;
  const text = picker.querySelector('.vto-finger-hint__text');
  if (text) {
    text.textContent = tryOnOnProductPage
      ? 'Tap finger to place'
      : 'Tap finger on camera';
  }
  // Only a ring makes the camera itself tappable
  video.parentElement?.classList.toggle('vto-pickable', ringActive);
}

// Camera-space tap → the centred, Y-up space the engine works in. The wrapper is
// what engine.resize() was given, so its rect and engine.width/height agree.
function viewportTapToEngine(event) {
  const wrapper = video.parentElement;
  if (!wrapper) return null;
  const rect = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  return {
    x: (event.clientX - rect.left) - rect.width / 2,
    y: -((event.clientY - rect.top) - rect.height / 2),
  };
}

function handleViewportTap(event) {
  if (!cameraOn || !hasActiveRing()) return;
  if (event.target.closest('#btn-close-tryon')) return;

  const point = viewportTapToEngine(event);
  if (!point) return;

  const key = engine.pickFingerAt(point.x, point.y);
  if (!key) {
    showNotification('Tap directly on the finger you want to wear the ring');
    return;
  }
  chooseFinger(key);
}

function getButton(id) {
  return jewelleryControls?.querySelector(`[data-id="${id}"]`) || null;
}

// Locks or unlocks the whole jewellery panel
function setJewelleryEnabled(enabled) {
  if (!jewelleryControls) return;
  const buttons = jewelleryControls.querySelectorAll('.jewellery-btn');
  for (const btn of buttons) {
    if (btn.classList.contains('unavailable')) continue;
    // A button mid-download belongs to toggleJewellery until its load settles
    if (btn.classList.contains('loading')) continue;

    btn.classList.toggle('locked', !enabled);
    // Marked disabled for assistive technology, but NOT with the `disabled` attribute, and…
    btn.setAttribute('aria-disabled', String(!enabled));
    btn.title = enabled ? '' : CAMERA_OFF_MESSAGE;
  }
  jewelleryControls.classList.toggle('locked', !enabled);
}

function setButtonState(btn, state) {
  btn.classList.remove('active', 'loading');
  if (state === 'on') btn.classList.add('active');
  if (state === 'loading') btn.classList.add('loading');
}

function syncTrackerNeeds() {
  const need = engine.requiredTrackers();
  // While a face piece is loading/pending, keep FaceMesh warm even if not active yet
  if (!need.face && (pendingAutoItemId || [...pendingByCategory.keys()].length)) {
    const pendingId = pendingAutoItemId
      || [...activeByCategory.values()][0]?.id
      || selectedProduct?.id;
    const item = pendingId ? findCatalogueItem(pendingId) : selectedProduct;
    if (item && (item.category === 'necklace' || item.category === 'earring')) {
      need.face = true;
    }
  }
  tracker.setNeeds(need);
  const keys = ['face', 'hands', 'pose'].filter((k) => need[k]);
  tracker.warmup(keys.length ? keys : ['face']);
}

// Turns one piece of jewellery off, everywhere
function deactivateItem(id) {
  if (!id) return;
  engine.deactivate(id);
  activeIds.delete(id);
  for (const [category, active] of activeByCategory) {
    if (active.id === id) activeByCategory.delete(category);
  }
  const btn = getButton(id);
  if (btn) setButtonState(btn, 'off');
}

/** Only one product on-camera at a time (necklace + earring must not stack). */
function clearAllJewellery() {
  for (const id of [...activeIds]) {
    deactivateItem(id);
  }
  pendingByCategory.clear();
  try {
    engine.hideAll();
  } catch (_) {
    // engine may not be ready yet
  }
  syncFingerPicker();
}

async function toggleJewellery(item, btn) {
  if (btn.classList.contains('loading')) return;

  // The camera rule is enforced HERE, not by disabling the button — see…
  if (!cameraOn) {
    showNotification(CAMERA_OFF_MESSAGE);
    // Draw the eye to the control that unblocks them
    btnStart.focus({ preventScroll: true });
    btnStart.classList.remove('nudge');
    void btnStart.offsetWidth;
    btnStart.classList.add('nudge');
    return;
  }

  // OFF
  if (activeIds.has(item.id)) {
    pendingByCategory.delete(item.category);
    deactivateItem(item.id);
    syncTrackerNeeds();
    syncFingerPicker();
    showNotification(`${item.label} OFF`);
    window.__vtoTuner?.refresh();
    return;
  }

  // ON — remove every other piece first (cross-category)
  clearAllJewellery();
  selectedProduct = item;
  pendingAutoItemId = '';

  const token = ++requestSeq;
  pendingByCategory.set(item.category, token);
  const superseded = () => (
    pendingByCategory.get(item.category) !== token
    || (selectedProduct && selectedProduct.id !== item.id)
  );

  // Marked busy with a class and aria-busy, NOT with the `disabled` attribute
  setButtonState(btn, 'loading');
  btn.setAttribute('aria-busy', 'true');
  btn.textContent = 'Loading…';
  showLoading(`Loading ${item.label}…`);

  try {
    const template = await engine.loadJewellery(
      item.id,
      item.folder,
      item.modelFile,
      item.category,
      (fraction) => showLoading(`Loading ${item.label}… ${Math.round(fraction * 100)}%`),
      { front: item.frontFile, back: item.backFile },
      { model: item.modelRevision, front: item.frontRevision, back: item.backRevision },
    );

    if (superseded()) {
      // The user changed their mind while this was downloading
      setButtonState(btn, 'off');
      return;
    }

    // Ensure nothing else snuck on during the download
    clearAllJewellery();
    pendingByCategory.set(item.category, token);

    engine.activate(item.id, template);
    activeIds.add(item.id);
    activeByCategory.set(item.category, item);
    setButtonState(btn, 'on');
    syncTrackerNeeds();
    syncFingerPicker();
    showNotification(`${item.label} ON`);
    if (template.warnings?.length) {
      showNotification(template.warnings[0]);
    }
    window.__vtoTuner?.refresh();
  } catch (err) {
    console.error('[Load] failed for', item.folder, err);
    setButtonState(btn, 'off');
    showNotification(`Could not load ${item.label}. Please try another piece.`);
  } finally {
    if (pendingByCategory.get(item.category) === token) {
      pendingByCategory.delete(item.category);
    }
    hideLoading();
    btn.textContent = item.label;
    btn.removeAttribute('aria-busy');
    // If the camera was stopped while this was downloading
    btn.classList.toggle('locked', !cameraOn);
    btn.setAttribute('aria-disabled', String(!cameraOn));
  }
}

// Camera + loops

async function startCamera() {
  try {
    setTrackingUI('Starting camera…', 'loading');

    // Every camera session starts on the third finger, whatever the last one
    // ended on. stopCamera() resets too, so this only matters for a session that
    // never got a clean stop.
    engine.resetRingFinger();
    engine.hideAll();
    latestTracking = null;
    syncFingerPicker();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException(
        window.isSecureContext
          ? 'This browser has no camera API.'
          : 'The camera needs a secure page: https:// or localhost.',
        'NotSupportedError',
      );
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) {
      await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
    }

    video.style.display = 'block';
    placeholder.classList.add('hidden');

    btnStart.disabled = true;
    btnStop.disabled = false;
    btnScreenshot.disabled = false;

    cameraOn = true;
    cameraPermissionDenied = false;
    setJewelleryEnabled(true);
    document.documentElement.classList.remove('vto-embed-needs-tap');

    // Tracking failing must not take the camera preview down with it — the models download lazily
    if (!tracker.ready) {
      try {
        await tracker.init();
      } catch (err) {
        console.error('[Tracker] init failed', err);
        showNotification(tracker.lastError || 'AI tracking could not start.');
      }
    }

    running = true;
    const pumpGen = ++trackingGeneration;
    resizeViewport();
    // Do NOT call syncTrackerNeeds() before jewellery is selected — with an empty
    // active set it sets needs.face=false and clears FaceMesh (stuck "Looking for face").
    tracker.warmup(['face']);
    setTrackingUI(tracker.ready ? 'Camera Ready' : 'Tracking unavailable',
      tracker.ready ? 'tracking' : 'offline');
    hideLoading();

    renderLoop();
    trackingPump(pumpGen);

    await maybeAutoSelectJewellery();
    syncTrackerNeeds();
    // Keep FaceMesh armed while a face piece is (or will be) worn
    if ([...activeByCategory.values()].some((i) => i.category === 'necklace' || i.category === 'earring')) {
      tracker.setNeeds({ ...engine.requiredTrackers(), face: true });
      tracker.warmup(['face']);
    }
  } catch (err) {
    console.error('[Camera] start failed', err);
    stopCamera();
    setTrackingUI('Camera permission denied', 'offline');
    const message = err?.name === 'NotSupportedError' && err.message
      ? err.message
      : 'Unable to access camera. Please allow camera permission.';
    lastCameraErrorMessage = message;
    const alreadyAnnounced = cameraPermissionDenied;
    cameraPermissionDenied = true;
    if (!alreadyAnnounced) showNotification(message);
  }
}

function findCatalogueItem(idOrFolder) {
  if (!idOrFolder) return null;
  const key = String(idOrFolder).toLowerCase();
  return catalogue.find((c) => (
    c.available
    && (c.id.toLowerCase() === key || c.folder.toLowerCase() === key)
  )) || null;
}

async function maybeAutoSelectJewellery() {
  const wanted = pendingAutoItemId;
  if (!wanted || !cameraOn) return;

  // Retry a few times — on phones the button row can lag one frame behind.
  let item = null;
  let btn = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    item = findCatalogueItem(wanted);
    if (item) btn = getButton(item.id);
    if (item && btn) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  if (!item) {
    console.warn('[AutoSelect] no catalogue item for', wanted);
    return;
  }
  if (!btn) {
    console.warn('[AutoSelect] button missing for', item.id);
    return;
  }
  if (activeIds.has(item.id)) {
    pendingAutoItemId = '';
    return;
  }

  pendingAutoItemId = '';
  showNotification(`Trying on ${item.label}…`);
  await toggleJewellery(item, btn);
}

function stopCamera() {
  running = false;
  trackingGeneration += 1;
  cameraOn = false;
  setJewelleryEnabled(false);
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }

  video.srcObject = null;
  video.style.display = 'none';
  placeholder.classList.remove('hidden');

  btnStart.disabled = false;
  btnStop.disabled = true;
  btnScreenshot.disabled = true;

  tracker.reset();
  latestTracking = null;
  engine.hideAll();
  // Back to the third finger — the selection is not carried across a restart
  engine.resetRingFinger();
  syncFingerPicker();
  engine.render();
  // Clear any leftover pixels after forced hide
  if (canvas2d) {
    const ctx = canvas2d.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas2d.width, canvas2d.height);
  }
  setTrackingUI('Camera off', 'offline');
}

// Rendering runs on its own rAF loop, independent of tracking
function renderLoop() {
  if (!running) return;
  rafId = requestAnimationFrame(renderLoop);
  try {
    engine.update(latestTracking);
    engine.render();
  } catch (err) {
    console.error('[Render] frame failed', err);
  }
}

// Tracking runs as fast as it can, and never blocks rendering
async function trackingPump(gen) {
  while (running && gen === trackingGeneration) {
    try {
      latestTracking = await tracker.processFrame(video);

      const activeCategories = [...activeByCategory.values()].map((i) => i.category);

      let label;
      let state;
      if (!tracker.ready) {
        label = 'Tracking unavailable';
        state = 'offline';
      } else if (!tracker.warm && activeCategories.length) {
        // First frame is still downloading the WASM + model files
        label = 'Loading AI model…';
        state = 'loading';
      } else {
        label = getTrackingLabel(latestTracking, activeCategories);
        state = label === 'Camera off' ? 'offline'
          : (label.startsWith('Tracking') || label === 'Camera Ready') ? 'tracking'
          : 'loading';
      }
      setTrackingUI(label, state);
    } catch (err) {
      console.warn('[Tracking] frame failed', err);
    }
    await nextFrame();
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Saves the camera frame and the jewellery as one image
function captureScreenshot() {
  if (!running || video.readyState < 2) return;

  let composite;
  try {
    composite = engine.captureComposite(video);
  } catch (err) {
    console.error('[Screenshot] compositing failed', err);
    showNotification('Could not save the photo. Please try again.');
    return;
  }

  const filename = `jewellery-tryon-${Date.now()}.png`;

  const deliver = (blob) => {
    if (!blob) {
      showNotification('Could not save the photo. Please try again.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';

    // iOS Safari has never supported the download attribute
    const canDownload = 'download' in link && !isIOS();
    if (!canDownload) link.target = '_blank';

    document.body.appendChild(link);
    link.click();
    link.remove();

    // Give the browser time to start reading the blob before releasing it
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    showNotification(canDownload ? 'Screenshot saved' : 'Photo ready — press and hold to save it');
  };

  if (typeof composite.toBlob === 'function') {
    composite.toBlob(deliver, 'image/png');
  } else {
    // Very old WebViews:
    const link = document.createElement('a');
    link.download = filename;
    link.href = composite.toDataURL('image/png');
    link.click();
    showNotification('Screenshot saved');
  }
}

function isIOS() {
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports itself as a Mac, and is told apart by touch support
  return /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

// Boot

async function init() {
  resizeViewport();
  window.addEventListener('resize', resizeViewport);
  window.addEventListener('orientationchange', () => setTimeout(resizeViewport, 250));
  video.addEventListener('loadedmetadata', resizeViewport);

  if (window.ResizeObserver && video.parentElement) {
    new ResizeObserver(() => resizeViewport()).observe(video.parentElement);
  }

  btnStart.addEventListener('click', () => {
    if (!cameraOn && cameraPermissionDenied) {
      showNotification(lastCameraErrorMessage);
    }
    startCamera().catch((err) => console.error('[Camera] start handler', err));
  });
  btnStop.addEventListener('click', stopCamera);
  btnScreenshot.addEventListener('click', captureScreenshot);
  btnCloseTryOn?.addEventListener('click', () => closeTryOnOnPage());
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && tryOnOnProductPage) closeTryOnOnPage();
  });

  buildFingerPicker();
  video.parentElement?.addEventListener('click', handleViewportTap);

  setTrackingUI('Camera off', 'offline');
  await discoverCatalogue();
  buildJewelleryUI();
  setJewelleryEnabled(false);
  bindUploadJewellery();

  window.addEventListener('pageshow', () => {
    if (catalogue.length) buildAllProductsHome();
  });

  if (pendingAutoItemId && currentView === 'tryon') {
    const pref = findCatalogueItem(pendingAutoItemId);
    if (pref) {
      showNotification(`Tap Start Camera to try on ${pref.label}`);
      if (btnStart) {
        btnStart.setAttribute(
          'aria-label',
          `Start Camera and try on ${pref.label}`,
        );
      }
      preloadBootItem(pref).catch((err) => console.warn('[Preload]', err));
    }
  }

  if (new URLSearchParams(location.search).has('tune')) {
    const { createTuner } = await import('./tuning.js');
    window.__vtoTuner = createTuner(engine, () => [...activeByCategory.values()]);
  }
}

async function preloadBootItem(item) {
  if (!item?.available || !item.modelFile) return;
  try {
    showLoading(`Preparing ${item.label}…`);
    await engine.loadJewellery(
      item.id,
      item.folder,
      item.modelFile,
      item.category,
      (fraction) => showLoading(`Preparing ${item.label}… ${Math.round(fraction * 100)}%`),
      { front: item.frontFile, back: item.backFile },
      { model: item.modelRevision, front: item.frontRevision, back: item.backRevision },
    );
  } finally {
    hideLoading();
  }
}

/**
 * Wires the "Upload your own jewellery" input on the home screen.
 *
 * Flow: pick file -> validate -> (transparency check + auto background
 * removal happen inside engine.loadUploadedJewellery, in-browser only) ->
 * once a fully-processed, transparent-background image is ready, persist
 * it to disk via POST /api/upload — this creates objects/<folder>/ and
 * appends the entry to objects/index.json server-side — then reload the
 * catalogue from the server so the new piece survives a refresh and shows
 * up on the homepage like any existing item. Nothing is ever rendered
 * before processing completes.
 */
/**
 * Shows the "Name your jewellery" modal and resolves with the trimmed name
 * the user typed, or null if they cancelled. Prefills with the file's own
 * name (minus extension) as a starting point they can overwrite.
 */
function askUploadName(defaultName) {
  const modal = document.getElementById('upload-name-modal');
  const form = document.getElementById('upload-name-form');
  const nameInput = document.getElementById('upload-name-input');
  const cancelBtn = document.getElementById('upload-name-cancel');
  if (!modal || !form || !nameInput) return Promise.resolve(defaultName || null);

  return new Promise((resolve) => {
    nameInput.value = defaultName || '';
    modal.hidden = false;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
      nameInput.focus();
      nameInput.select();
    });

    const cleanup = () => {
      modal.hidden = true;
      modal.classList.add('hidden');
      form.removeEventListener('submit', onSubmit);
      cancelBtn?.removeEventListener('click', onCancel);
      modal.querySelector('.upload-name-modal__backdrop')?.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeydown);
    };
    const onSubmit = (event) => {
      event.preventDefault();
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      cleanup();
      resolve(name);
    };
    const onCancel = () => {
      cleanup();
      resolve(null);
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') onCancel();
    };

    form.addEventListener('submit', onSubmit);
    cancelBtn?.addEventListener('click', onCancel);
    modal.querySelector('.upload-name-modal__backdrop')?.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeydown);
  });
}

const WRAP_UPLOAD_COPY = {
  ring: {
    front: 'This piece needs a front photo (camera-facing) and a back photo (behind the finger), so the ring can wrap around the finger correctly.',
    back: 'Rings need a front photo (camera-facing) and a back photo (behind the finger) so the ring can wrap around the finger correctly.',
  },
  bangles: {
    front: 'This piece needs a front photo (camera-facing) and a back photo (behind the wrist), so it wraps around the wrist correctly.',
    back: 'Bangles need a front photo (camera-facing) and a back photo (behind the wrist) so it wraps around the wrist correctly.',
  },
};

/**
 * Shows the "Add the front photo" modal (before any file picker opens) and
 * resolves true (proceed to pick the front file) or false (user cancelled).
 */
function askForFrontPhoto(category) {
  const modal = document.getElementById('upload-front-modal');
  const hint = document.getElementById('upload-front-modal-hint');
  const chooseBtn = document.getElementById('upload-front-choose');
  const cancelBtn = document.getElementById('upload-front-cancel');
  if (!modal) return Promise.resolve(false);

  if (hint) hint.textContent = WRAP_UPLOAD_COPY[category]?.front || WRAP_UPLOAD_COPY.ring.front;

  return new Promise((resolve) => {
    modal.hidden = false;
    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.hidden = true;
      modal.classList.add('hidden');
      chooseBtn?.removeEventListener('click', onChoose);
      cancelBtn?.removeEventListener('click', onCancel);
      modal.querySelector('.upload-name-modal__backdrop')?.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeydown);
    };
    const onChoose = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onKeydown = (event) => { if (event.key === 'Escape') onCancel(); };

    chooseBtn?.addEventListener('click', onChoose);
    cancelBtn?.addEventListener('click', onCancel);
    modal.querySelector('.upload-name-modal__backdrop')?.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeydown);
  });
}

/** Opens the hidden front-photo file input and resolves with the chosen File, or null on cancel. */
function pickFrontFile() {
  const frontInput = document.getElementById('upload-jewellery-front-input');
  if (!frontInput) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onChange = () => {
      const file = frontInput.files?.[0] || null;
      frontInput.value = '';
      frontInput.removeEventListener('change', onChange);
      window.removeEventListener('focus', onCancelFallback);
      resolve(file);
    };
    const onCancelFallback = () => {
      setTimeout(() => {
        if (!frontInput.files?.length) {
          frontInput.removeEventListener('change', onChange);
          resolve(null);
        }
      }, 300);
    };
    frontInput.addEventListener('change', onChange, { once: true });
    window.addEventListener('focus', onCancelFallback, { once: true });
    frontInput.click();
  });
}

/**
 * Shows the "Add the back photo" modal (after the front photo is picked)
 * and resolves true (proceed to pick the back file) or false (user
 * cancelled the whole upload).
 */
function askForBackPhoto(category) {
  const modal = document.getElementById('upload-back-modal');
  const hint = document.getElementById('upload-back-modal-hint');
  const chooseBtn = document.getElementById('upload-back-choose');
  const cancelBtn = document.getElementById('upload-back-cancel');
  if (!modal) return Promise.resolve(false);

  if (hint) hint.textContent = WRAP_UPLOAD_COPY[category]?.back || WRAP_UPLOAD_COPY.ring.back;

  return new Promise((resolve) => {
    modal.hidden = false;
    modal.classList.remove('hidden');

    const cleanup = () => {
      modal.hidden = true;
      modal.classList.add('hidden');
      chooseBtn?.removeEventListener('click', onChoose);
      cancelBtn?.removeEventListener('click', onCancel);
      modal.querySelector('.upload-name-modal__backdrop')?.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKeydown);
    };
    const onChoose = () => { cleanup(); resolve(true); };
    const onCancel = () => { cleanup(); resolve(false); };
    const onKeydown = (event) => { if (event.key === 'Escape') onCancel(); };

    chooseBtn?.addEventListener('click', onChoose);
    cancelBtn?.addEventListener('click', onCancel);
    modal.querySelector('.upload-name-modal__backdrop')?.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKeydown);
  });
}

/** Opens the hidden back-photo file input and resolves with the chosen File, or null on cancel. */
function pickBackFile() {
  const backInput = document.getElementById('upload-jewellery-back-input');
  if (!backInput) return Promise.resolve(null);
  return new Promise((resolve) => {
    const onChange = () => {
      const file = backInput.files?.[0] || null;
      backInput.value = '';
      backInput.removeEventListener('change', onChange);
      window.removeEventListener('focus', onCancelFallback);
      resolve(file);
    };
    // If the user closes the native file picker without choosing anything,
    // the window regains focus but 'change' never fires — resolve(null) then.
    const onCancelFallback = () => {
      setTimeout(() => {
        if (!backInput.files?.length) {
          backInput.removeEventListener('change', onChange);
          resolve(null);
        }
      }, 300);
    };
    backInput.addEventListener('change', onChange, { once: true });
    window.addEventListener('focus', onCancelFallback, { once: true });
    backInput.click();
  });
}

function isImageExtValid(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return ['jpg', 'jpeg', 'png'].includes(ext);
}

/** Shared final step for both single-image and ring uploads: registers the
 * catalogue entry, opens the detail view, and reports success/failure. */
function finishUpload(item, warnings, backgroundRemoved, saved) {
  catalogue = catalogue.filter((c) => c.id !== item.id);
  catalogue.push(item);

  // After upload: show the uploaded image in detail view.
  // Do NOT auto-open try-on or start camera.
  // User must explicitly click "Try On" then "Start Camera".
  openProductDetail(item);
  pendingAutoItemId = '';
  clearAllJewellery();
  selectedProduct = item;

  const peers = catalogue.filter((c) => c.category === item.category && c.available);
  buildHiddenJewelleryButtons(peers);
  const label = document.getElementById('tryon-piece-label');
  if (label) label.textContent = item.label;

  showNotification(
    saved
      ? `${item.label} saved to your collection`
      : (backgroundRemoved ? `Background removed — ${item.label} ready` : `${item.label} ready`),
  );
  if (!saved) {
    showNotification('Could not save permanently — this piece will disappear on refresh.');
  }
  if (warnings?.length) {
    showNotification(warnings[0]);
  }
  window.__vtoTuner?.refresh();
}

const WRAP_UPLOAD_CATEGORIES = new Set(['ring', 'bangles']);

function bindUploadJewellery() {
  const input = document.getElementById('upload-jewellery-input');
  const label = document.querySelector('label[for="upload-jewellery-input"]');
  const categorySelect = document.getElementById('upload-jewellery-category');
  if (!input) return;

  // Ring and Bangle need a front photo AND a back photo. Intercept the
  // label click before the native single-file picker opens: show the
  // "Add front photo" prompt first, then drive the whole front -> back ->
  // name flow ourselves via handleWrapUpload().
  label?.addEventListener('click', (event) => {
    const category = categorySelect?.value || 'necklace';
    if (!WRAP_UPLOAD_CATEGORIES.has(category)) return; // let the native picker open as usual
    event.preventDefault();
    handleWrapUpload(category);
  });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.value = ''; // allow re-selecting the same file later
    if (!file) return;

    if (!isImageExtValid(file)) {
      showNotification('Please upload a JPG or PNG image.');
      return;
    }

    const category = categorySelect?.value || 'necklace';
    if (!category) {
      showNotification('Please choose a jewellery category.');
      return;
    }

    if (WRAP_UPLOAD_CATEGORIES.has(category)) {
      // Handled by the label click-intercept above; the native picker for
      // this input should not have opened for ring/bangles, but bail out
      // defensively if it somehow did.
      return;
    }

    // Ask for a display name BEFORE any processing/upload starts — that
    // name is what shows on the homepage card.
    const defaultName = file.name.replace(/\.[^.]+$/, '');
    const chosenName = await askUploadName(defaultName);
    if (!chosenName) return; // user cancelled

    showLoading('Checking image…');

    try {
      const template = await engine.loadUploadedJewellery(file, category, (fraction, stage) => {
        const pct = Math.round(fraction * 100);
        if (stage === 'checking') showLoading('Checking image…');
        else if (stage === 'removing-bg') showLoading(`Removing background… ${pct}%`);
        else showLoading(`Loading your jewellery… ${pct}%`);
      });

      const cleanLabel = chosenName;

      // Persist to objects/<folder>/ + objects/index.json on the local
      // dev server so the item is real, not just an in-memory blob: URL.
      showLoading('Saving jewellery…');
      let saved = null;
      try {
        const processedBlob = await (await fetch(template.img?.src || '')).blob().catch(() => null);
        // Background removal always emits PNG; fall back to the original file (and its
        // extension) only if that processed blob couldn't be recovered for some reason.
        saved = processedBlob
          ? await persistUploadedJewellery(processedBlob, category, cleanLabel, 'png')
          : await persistUploadedJewellery(file, category, cleanLabel, (file.name.split('.').pop() || '').toLowerCase());
      } catch (persistErr) {
        console.warn('[Upload] could not persist to objects/, keeping session-only', persistErr);
      }

      hideLoading();

      const item = saved
        ? {
          id: saved.folder,
          folder: saved.folder,
          modelFile: saved.asset,
          demoFile: saved.asset,
          label: saved.label,
          category: saved.category,
          available: true,
          isUpload: true,
          image: `objects/${saved.folder}/${saved.asset}`,
        }
        : {
          id: template.id ?? `upload-${Date.now()}`,
          folder: template.folder,
          modelFile: template.cacheKey.slice(template.folder.length + 1).split('@')[0],
          label: cleanLabel,
          category: template.category,
          available: true,
          isUpload: true,
        };

      finishUpload(item, template.warnings, template.backgroundRemoved, saved);
    } catch (err) {
      console.error('[Upload] failed', err);
      showNotification(err?.message || 'Could not process this image. Please try another one.');
      hideLoading();
    }
  });
}

/**
 * Ring and Bangle upload flow: shows "Add front photo" -> picks front photo
 * -> shows "Add back photo" -> picks back photo -> asks for a name ->
 * Continue. Both photos get auto background removal.
 *
 * Rings keep front.png + back.png as two separate wrap layers (needed for
 * the finger depth-of-field render). Bangles get their two photos
 * flattened into one composited image and persisted like any other
 * single-image piece, since bangle rendering doesn't use the wrap layers.
 */
async function handleWrapUpload(category) {
  const wantsFront = await askForFrontPhoto(category);
  if (!wantsFront) return;

  const frontFile = await pickFrontFile();
  if (!frontFile) return;
  if (!isImageExtValid(frontFile)) {
    showNotification('Please upload a JPG or PNG image for the front photo.');
    return;
  }

  const proceed = await askForBackPhoto(category);
  if (!proceed) return;

  const backFile = await pickBackFile();
  if (!backFile) return;
  if (!isImageExtValid(backFile)) {
    showNotification('Please upload a JPG or PNG image for the back photo.');
    return;
  }

  const defaultName = frontFile.name.replace(/\.[^.]+$/, '');
  const chosenName = await askUploadName(defaultName);
  if (!chosenName) return;

  showLoading('Checking images…');

  const pieceWord = category === 'bangles' ? 'bangle' : 'ring';
  try {
    const loader = category === 'bangles'
      ? engine.loadUploadedBangleJewellery(frontFile, backFile, (fraction, stage) => {
        const pct = Math.round(fraction * 100);
        if (stage === 'checking') showLoading('Checking images…');
        else if (stage === 'removing-bg') showLoading(`Removing background… ${pct}%`);
        else showLoading(`Loading your ${pieceWord}… ${pct}%`);
      })
      : engine.loadUploadedRingJewellery(frontFile, backFile, (fraction, stage) => {
        const pct = Math.round(fraction * 100);
        if (stage === 'checking') showLoading('Checking images…');
        else if (stage === 'removing-bg') showLoading(`Removing background… ${pct}%`);
        else showLoading(`Loading your ${pieceWord}… ${pct}%`);
      });
    const template = await loader;

    showLoading('Saving jewellery…');
    let saved = null;

    if (category === 'bangles') {
      try {
        const compositedBlob = await (await fetch(template.img?.src || '')).blob().catch(() => null);
        if (compositedBlob) {
          saved = await persistUploadedJewellery(compositedBlob, 'bangles', chosenName, 'png');
        }
      } catch (persistErr) {
        console.warn('[Upload] could not persist bangle to objects/, keeping session-only', persistErr);
      }
    } else {
      try {
        const frontBlob = await (await fetch(template.imgFront?.src || '')).blob().catch(() => null);
        const backBlob = await (await fetch(template.imgBack?.src || '')).blob().catch(() => null);
        if (frontBlob && backBlob) {
          saved = await persistUploadedRing(frontBlob, backBlob, chosenName);
        }
      } catch (persistErr) {
        console.warn('[Upload] could not persist ring to objects/, keeping session-only', persistErr);
      }
    }

    hideLoading();

    const item = saved
      ? {
        id: saved.folder,
        folder: saved.folder,
        frontFile: saved.front,
        backFile: saved.back ?? null,
        modelFile: saved.front,
        demoFile: saved.front,
        label: saved.label,
        category,
        available: true,
        isUpload: true,
        image: `objects/${saved.folder}/${saved.front}`,
      }
      : {
        // Session-only fallback (no local upload API reachable): reuse the
        // exact blob: URLs the template was loaded with, so any later
        // toggleJewellery() call reconstructs the same cache key instead of
        // trying to fetch the on-disk filenames.
        id: template.id ?? `upload-${Date.now()}`,
        folder: template.folder,
        frontFile: template.imgFront?.src || template.img?.src || null,
        backFile: template.imgBack?.src || null,
        modelFile: null,
        label: chosenName,
        category,
        available: true,
        isUpload: true,
        image: template.imgFront?.src || template.img?.src || null,
      };

    finishUpload(item, template.warnings, template.backgroundRemoved, saved);
  } catch (err) {
    console.error(`[Upload] ${pieceWord} failed`, err);
    showNotification(err?.message || 'Could not process these images. Please try again.');
    hideLoading();
  }
}

/**
 * Sends the (already background-processed) jewellery image to the local
 * dev server, which writes it into objects/<folder>/ and updates
 * objects/index.json. Returns null (never throws to the caller of the
 * upload handler) when the local API isn't reachable — e.g. this page is
 * open via file:// or a plain static host with no app.py running — so the
 * upload still works for the current session even though it won't survive
 * a refresh.
 */
async function persistUploadedJewellery(fileOrBlob, category, name, ext, extraHeaders = {}) {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Jewellery-Category': category,
      'X-Jewellery-Name': name || '',
      'X-Jewellery-Ext': ext || '',
      ...extraHeaders,
    },
    body: fileOrBlob,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON response (e.g. 404 HTML from a server with no /api/upload) — no local API available
    throw new Error('Local upload API not available');
  }
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || 'Upload failed');
  }
  return data;
}

/** Persists a ring as two requests: front.png first (creates the folder),
 * then back.png (finalises the objects/index.json entry). Both blobs are
 * already background-removed PNGs by the time they get here. */
async function persistUploadedRing(frontBlob, backBlob, name) {
  const front = await persistUploadedJewellery(frontBlob, 'ring', name, 'png', {
    'X-Jewellery-Layer': 'front',
  });
  const back = await persistUploadedJewellery(backBlob, 'ring', name, 'png', {
    'X-Jewellery-Layer': 'back',
    'X-Jewellery-Folder': front.folder,
  });
  return back;
}

init().catch((err) => {
  // If init() throws/rejects for any reason (restricted webview,
  // blocked API, etc.) the page must not stay silently blank —
  // surface it and still try to render whatever catalogue we can.
  console.error('[Init] failed', err);
  
  // Show error on page
  const grid = document.getElementById('product-grid');
  if (grid) {
    grid.innerHTML = `
      <div style="padding: 2rem; text-align: center; color: var(--text-secondary);">
        <p>Failed to initialize: ${err.message}</p>
        <button onclick="location.reload()" class="btn btn-action" style="margin-top: 1rem;">Retry</button>
      </div>
    `;
  }
  
  try {
    if (!catalogue.length) catalogue = buildCatalogueEntries(CATALOGUE_MANIFEST);
    buildAllProductsHome();
    setView('home');
  } catch (fallbackErr) {
    console.error('[Init] fallback render also failed', fallbackErr);
  }
});