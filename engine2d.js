// 2D PNG/JPG jewellery overlay engine
// Tracking + landmark math follows jewellery_try_on/engine3d.js;
// Three.js / GLB-OBJ rendering is replaced by Canvas 2D image transforms.

import { ensureTransparentJewelleryImage } from './bg-removal.js';

const FACE = {
  chin: 152,
  forehead: 10,
  noseTip: 1,
  rightEarLow: 93,
  leftEarLow: 323,
  rightJawAngle: 132,
  leftJawAngle: 361,
  rightJaw: 234,
  leftJaw: 454,
  rightEyeOuter: 33,
  leftEyeOuter: 263,
};

const POSE = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
};

const FOREARM_PAIRS = [
  [POSE.leftElbow, POSE.leftWrist],
  [POSE.rightElbow, POSE.rightWrist],
];

const HAND = {
  wrist: 0,
  thumbCmc: 1,
  indexMcp: 5,
  middleMcp: 9,
  middlePip: 10,
  ringMcp: 13,
  ringPip: 14,
  ringTip: 16,
  pinkyMcp: 17,
};

const MCP_ROW = [5, 9, 13, 17];
const HAND_OUTLINE = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 20];
const MCP_GAPS = [[5, 9], [9, 13], [13, 17]];

const PLACE = {
  // Higher = lower on the neck (away from chin/beard toward collarbone)
  neckDrop: 0.86,
  neckPivotDrop: -0.05,
  neckPivotBack: 0.30,
  // Minimum distance below chin — raise if chain still sits in the beard
  neckClearChin: 0.38,
  neckDropMin: 0.20,
  neckDropMax: 1.25,
  neckAboveShoulder: 0.38,
  neckShoulderLift: 0.12,
  neckShoulderDepth: 0.35,
  neckTorsoAxis: 0.25,
  neckRadius: 0.66,
  // 2D chain art is usually shorter than a full 3D wrap — slightly wider on screen
  necklaceWidth: 1.45,
  pendantDrop: 1.10,
  necklaceForward: 0,
  neckFromShoulder: 0.30,
  neckShoulderTrust: 0.35,
  neckShoulderPull: 0.30,
  neckShoulderShift: 0.22,

  // Earrings — smaller 2D overlay; show only when that ear faces the camera
  earringDrop: 0.12,
  earringMax: 0.18,
  // Lower lobeDrop = higher on the ear; higher lobeOut = more L/R outward
  earringLobeDrop: 0.12,
  earringLobeOut: 0.18,
  earringLobeBack: 0.06,
  earringLobeUp: 0.0,
  // Pull right earring slightly inward (toward face / left)
  earringRightIn: 0.07,
  earHandReach: 0.55,
  earHandFade: 0.35,
  earringRollFollow: 0.55,
  earringHeadFollow: 0.82,
  earringOutward: 0.28,
  // Medium: frontal both ears; hide when that ear turns away from camera
  earringFadeStart: -0.06,
  earringFadeEnd: -0.28,

  ringWidth: 1.48,
  ringHoleFit: 1.0,
  ringShaft: 0.82,
  ringSeat: 0.61,
  ringDepth: 0.16,
  ringMinPx: 18,
  ringMinPhalanx: 0.35,
  ringPhalanxBand: 0.25,
  ringMinStraight: 0.65,
  ringStraightBand: 0.15,
  ringMinProportion: 0.6,
  ringMinAxisView: 0.10,
  ringAxisBand: 0.15,
  ringStoneOnBackOfHand: false,
  // Landmark finger stamp for ring-band depth (back → finger → front)
  fingerMaskLen: 2.50,
  fingerMaskRad: 1.12,

  handCoverReach: 0.95,
  handCoverFade: 0.35,

  bangleWidth: 1.32,
  bangleHoleFit: 1.08,
  bangleSag: 0.75,
  bangleSlide: 0.44,
  bangleDepth: 0.15,
  bangleMinPx: 20,
  wristFromPalm: 0.86,
  wristDepthRatio: 0.70,
  forearmMaskToHand: 0.70,
  forearmMaskToElbow: 2.30,
  forearmTrust: 0.85,
};

const SMOOTH_PROFILE = {
  necklace: { posMin: 0.14, posMax: 0.72, rotMin: 0.10, rotMax: 0.55, scale: 0.14 },
  earring: { posMin: 0.20, posMax: 0.86, rotMin: 0.14, rotMax: 0.68, scale: 0.18 },
  ring: { posMin: 0.48, posMax: 0.98, rotMin: 0.38, rotMax: 0.94, scale: 0.36, rampMin: 0.68 },
  bangles: { posMin: 0.26, posMax: 0.90, rotMin: 0.18, rotMax: 0.78, scale: 0.20 },
  default: { posMin: 0.24, posMax: 0.86, rotMin: 0.18, rotMax: 0.70, scale: 0.20 },
};

const RESPONSE_SPEED = 0.055;
const RESPONSE_ANGLE = 0.020;
const DEADBAND_PX = 0.35;
const DEADBAND_SCALE = 0.005;
const JUMP_SNAP = 2.5;
const OFFSCREEN_MARGIN = 1.5;
// Keep FaceMesh alone for earrings/necklace so phones/ngrok can lock a face.
// (Reference enables hand occlusion too; that often stalls FaceMesh here → "Looking for face…")
const HIDE_UNDER_HANDS = false;
const HAND_HOLD_MISSES = 2;
const HAND_FADE_MISSES = 5;
const FADE_SPEED = 0.18;
const TORSO_BLEND_RATE = 0.12;
const EAR_HOLD_FRAMES = 12;
const LIMB_WIDTH_SMOOTH = 0.12;
const FOREARM_MATCH_RADIUS = 0.14;
const FOREARM_MIN_VISIBILITY = 0.5;
const MIN_PALM_AGREEMENT = 0.25;
const RING_FRAME_INSET = 0.02;
const RING_HAND_STICK = 1.3;
const RING_BONE_TO_WIDTH = 2.4;
const RING_SHOW_LEVEL = 0.20;
const RING_HIDE_LEVEL = 0.10;
const RING_SHOW_FRAMES = 1;
const RING_HIDE_FRAMES = 6;
const FINGER_WOBBLE_LIMIT = 0.12;
const FINGER_WOBBLE_SMOOTH = 0.32;
const RING_WIDTH_SMOOTH = 0.30;
const FINGER_TAP_REACH = 0.75;
const FINGER_OCCLUDE_REACH = 1.05;
const FINGER_OCCLUDE_FADE = 0.55;
const FINGER_OCCLUDE_DEPTH = 0.12;
const WRIST_CAL_SQUARENESS = 0.80;
const WRIST_CAL_SMOOTH = 0.05;
const SAME_HAND_LIMIT = 0.5;
const WRIST_CHAIN = [0, 1, 5, 17];
const RING_SUPPORT = [0, 5, 9, 13, 17];
const SAME_HAND_POINTS = [0, 5, 9, 13, 17];
const FINGER_CHAINS = [
  [5, 6, 8],
  [9, 10, 12],
  [13, 14, 16],
  [17, 18, 20],
];
const CURL_MIN_SIGNAL = 0.012;
const CURL_MIN_STRAIGHTNESS = 0.80;
const RING_FACING_SHOW = 0.06;
const RING_FACING_HIDE = -0.06;
const RING_FACING_SMOOTH = 0.22;

/** Ring with front.png + back.png — folder-agnostic, so new ring-* pieces pick this up. */
function jewelleryWrapDepth(entry) {
  return entry.category === 'ring'
    && entry.wrap && entry.imgFront && entry.imgBack;
}

function wrapFacingFromSignal(inst, rawFacing, dtScale) {
  // Positive → front.png on top (camera-facing / outside). Negative → back.png on top.
  const prev = inst.ringFacingSignal ?? rawFacing;
  inst.ringFacingSignal = prev + (rawFacing - prev) * adapt(RING_FACING_SMOOTH, dtScale);
  let mode = inst.ringFacing || 'front';
  if (mode === 'front') {
    if (inst.ringFacingSignal < RING_FACING_HIDE) mode = 'back';
  } else if (inst.ringFacingSignal > RING_FACING_SHOW) {
    mode = 'front';
  }
  inst.ringFacing = mode;
  return mode;
}

export const RING_FINGERS = {
  index: { key: 'index', label: 'Index', mcp: 5, pip: 6, dip: 7, tip: 8, gapRef: 9 },
  middle: { key: 'middle', label: 'Middle', mcp: 9, pip: 10, dip: 11, tip: 12, gapRef: 9 },
  ring: { key: 'ring', label: 'Ring', mcp: 13, pip: 14, dip: 15, tip: 16, gapRef: 9 },
  little: { key: 'little', label: 'Little', mcp: 17, pip: 18, dip: 19, tip: 20, gapRef: 13 },
};
export const RING_FINGER_ORDER = ['index', 'middle', 'ring', 'little'];
export const DEFAULT_RING_FINGER = 'ring';
const MCP_GAP_OF = { index: 0, middle: 0, ring: 1, little: 2 };

const CATEGORY_DEFAULTS = {
  necklace: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 1 },
  earring: { fitAxis: 'y', anchor: 'top', scale: 1, pair: 2 },
  ring: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 1, offsetY: -0.05 },
  bangles: { fitAxis: 'x', anchor: 'center', scale: 1, pair: 2 },
};

export let MODEL_TUNING = {};
const TUNING_STORE_KEY = 'vto2d-model-tuning';

try {
  const saved = JSON.parse(localStorage.getItem(TUNING_STORE_KEY) || '{}');
  if (saved && typeof saved === 'object') MODEL_TUNING = { ...MODEL_TUNING, ...saved };
} catch { /* ignore */ }

function saveTuning() {
  try { localStorage.setItem(TUNING_STORE_KEY, JSON.stringify(MODEL_TUNING)); } catch { /* ignore */ }
}

export function clearSavedTuning(engine = null) {
  MODEL_TUNING = {};
  try { localStorage.removeItem(TUNING_STORE_KEY); } catch { /* ignore */ }
  if (engine?.activeItems) {
    for (const [, entry] of engine.activeItems) {
      const defaults = {
        ...CATEGORY_DEFAULTS[entry.category],
        category: entry.category,
      };
      for (const key of Object.keys(entry.tuning)) delete entry.tuning[key];
      Object.assign(entry.tuning, defaults);
    }
  }
}

// --- tiny vector helpers (centred screen space, +Y up) ---

class V3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z = 0) { this.x = x; this.y = y; this.z = z; return this; }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  clone() { return new V3(this.x, this.y, this.z); }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
  subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  lerp(v, t) { this.x += (v.x - this.x) * t; this.y += (v.y - this.y) * t; this.z += (v.z - this.z) * t; return this; }
  normalize() {
    const L = Math.hypot(this.x, this.y, this.z) || 1;
    this.x /= L; this.y /= L; this.z /= L; return this;
  }
  length() { return Math.hypot(this.x, this.y, this.z); }
  lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  crossVectors(a, b) {
    this.x = a.y * b.z - a.z * b.y;
    this.y = a.z * b.x - a.x * b.z;
    this.z = a.x * b.y - a.y * b.x;
    return this;
  }
  negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
}

const _v1 = new V3();
const _v2 = new V3();
const _v3 = new V3();
const _v4 = new V3();
const _v5 = new V3();
const _v6 = new V3();
const _v7 = new V3();
const _n1 = new V3();
const _n2 = new V3();
const _n3 = new V3();
const _pos = new V3();
const _hfWrist = new V3();
const _hfP = new V3();
const _hfQ = new V3();
const _hfTmp = new V3();
const _hfNormal = new V3();
const _hfAcross = new V3();
const _hfAlong = new V3();
const _handFrameOut = { wrist: _hfWrist, normal: _hfNormal, across: _hfAcross, along: _hfAlong };
const _wfWrist = new V3();
const _wfThumb = new V3();
const _wfIndex = new V3();
const _wfPinky = new V3();
const _wfBase = new V3();
const _wfAlong = new V3();
const _wfAcross = new V3();
const _wfNormal = new V3();
const _wristFrameOut = { wrist: _wfWrist, along: _wfAlong, across: _wfAcross, normal: _wfNormal };
const _ftA = new V3();
const _ftB = new V3();
const _hcWrist = new V3();
const _hcIndex = new V3();
const _hcPinky = new V3();
const _hcMiddle = new V3();
const _hcPoint = new V3();
const _fcChord = new V3();
const _fcBend = new V3();
const _fcSum = new V3();
const _fcMcp = new V3();
const _fcPip = new V3();
const _fcTip = new V3();
const _dorsal = new V3();

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function adapt(rate, dtScale) { return 1 - Math.pow(1 - rate, dtScale); }
function responsive(minK, maxK, magnitude, reference, dtScale) {
  const t = reference > 1e-9 ? clamp01(magnitude / reference) : 0;
  return adapt(minK + (maxK - minK) * t, dtScale);
}
function freshness(miss, hold = HAND_HOLD_MISSES, fade = HAND_FADE_MISSES) {
  if (!Number.isFinite(miss) || miss <= hold) return 1;
  return clamp01(1 - (miss - hold) / fade);
}
function inFrame(lm, margin = 0.06) {
  return !!lm && lm.x > -margin && lm.x < 1 + margin && lm.y > -margin && lm.y < 1 + margin;
}
function allInFrame(landmarks, indices, margin) {
  for (const i of indices) {
    if (!inFrame(landmarks[i], margin)) return false;
  }
  return true;
}
function fingerChain(finger) { return [finger.mcp, finger.pip, finger.dip, finger.tip]; }
function handSign(isRight) { return isRight === false ? -1 : 1; }

function normaliseFingerKey(key) {
  if (!key) return null;
  const v = String(key).toLowerCase().trim();
  if (RING_FINGERS[v]) return v;
  if (v === 'third' || v === '3' || v === 'ringfinger') return 'ring';
  if (v === 'pinky' || v === 'pinkie') return 'little';
  return null;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function angleDiffPeriodic(a, b, period = Math.PI * 2) {
  let d = a - b;
  const half = period * 0.5;
  while (d > half) d -= period;
  while (d < -half) d += period;
  return d;
}

function screenAngleFromUp(up) {
  return Math.atan2(up.x, up.y);
}

function screenAngleFromAxis(axis) {
  return Math.atan2(axis.x, axis.y);
}

// Ring band PNG is horizontal at rest. On a front-facing hand the band sits
// across the finger (screen-horizontal when the finger points up), so the
// draw angle is perpendicular to the finger axis, not parallel to it.
function ringCanvasAngle(axis) {
  return Math.atan2(-axis.y, axis.x) + Math.PI / 2;
}

function distanceToSegment2D(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(x - a.x, y - a.y);
  let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(x - (a.x + dx * t), y - (a.y + dy * t));
}

function fingerQuality(hand, engine, finger) {
  const mcp = hand[finger.mcp];
  const pip = hand[finger.pip];
  const dip = hand[finger.dip];
  const tip = hand[finger.tip];
  const gapRef = hand[finger.gapRef];
  if (!mcp || !pip) return 0;

  const proximal = engine.dist3D(mcp, pip);
  if (!(proximal > 1e-4)) return 0;

  let score = 0.85;
  if (gapRef) {
    const knuckleGap = engine.dist3D(gapRef, mcp);
    if (knuckleGap > 1e-4) {
      score = clamp01((proximal / knuckleGap - 0.15) / 0.35);
    }
  }

  if (dip && tip) {
    const middle = engine.dist3D(pip, dip);
    const distal = engine.dist3D(dip, tip);
    const path = proximal + middle + distal;
    const chord = engine.dist3D(mcp, tip);
    if (path > 1e-4) {
      const straightness = clamp01((chord / path - 0.40) / 0.35);
      score = Math.min(score, straightness);
    }
  }
  return Math.max(0.5, score);
}

function fingerShapeRatio(hand, engine, finger) {
  const mcp = hand[finger.mcp];
  const pip = hand[finger.pip];
  const gapRef = hand[finger.gapRef];
  if (!mcp || !pip || !gapRef) return 0;
  const gap = engine.dist3D(gapRef, mcp);
  return gap > 1e-4 ? engine.dist3D(mcp, pip) / gap : 0;
}

const _fsA = new V3();
const _fsB = new V3();
const _fsSeg = new V3();
const _fsRel = new V3();
const _fsNear = new V3();

function fingerClearance(hand, engine, finger, seat, fingerWidth) {
  if (!(fingerWidth > 1e-4)) return 0;
  let worst = 1;
  for (const key of RING_FINGER_ORDER) {
    const other = RING_FINGERS[key];
    if (other.key === finger.key) continue;
    const a = hand[other.mcp];
    const b = hand[other.pip];
    if (!a || !b) continue;
    engine.lmToScreen(a, _fsA);
    engine.lmToScreen(b, _fsB);
    _fsSeg.subVectors(_fsB, _fsA);
    const len2 = _fsSeg.lengthSq();
    let t = 0;
    if (len2 > 1e-9) {
      _fsRel.subVectors(seat, _fsA);
      t = _fsRel.dot(_fsSeg) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
    }
    _fsNear.copy(_fsA).addScaledVector(_fsSeg, t);
    if (_fsNear.z - seat.z <= fingerWidth * FINGER_OCCLUDE_DEPTH) continue;
    const gap = Math.hypot(_fsNear.x - seat.x, _fsNear.y - seat.y);
    const reach = fingerWidth * FINGER_OCCLUDE_REACH;
    const fade = Math.max(fingerWidth * FINGER_OCCLUDE_FADE, 1e-3);
    const clear = 1 - clamp01((reach - gap) / fade);
    if (clear < worst) worst = clear;
  }
  return worst;
}

/** Opaque bounding box of a PNG/JPG as fractions of natural size (for 2D anchors). */
function analyzeImageContent(img) {
  const nw = img.naturalWidth || img.width || 1;
  const nh = img.naturalHeight || img.height || 1;
  const fallback = { x0: 0, y0: 0, x1: 1, y1: 1, cx: 0.5, cy: 0.5, w: 1, h: 1 };
  // Downsample the scan so large jewellery PNGs still report the real opaque size.
  const maxDim = 256;
  const shrink = Math.min(1, maxDim / Math.max(nw, nh));
  const w = Math.max(1, Math.round(nw * shrink));
  const h = Math.max(1, Math.round(nh * shrink));
  try {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let found = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 12) {
          found = true;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (!found) return fallback;
    const x0 = minX / w;
    const y0 = minY / h;
    const x1 = (maxX + 1) / w;
    const y1 = (maxY + 1) / h;
    return {
      x0, y0, x1, y1,
      cx: (x0 + x1) * 0.5,
      cy: (y0 + y1) * 0.5,
      w: Math.max(x1 - x0, 1e-3),
      h: Math.max(y1 - y0, 1e-3),
    };
  } catch {
    return fallback;
  }
}

/**
 * Split ring/bangle PNG on the worn depth axis (upper arc = front, lower arc = back).
 * NOT a flat canvas half (∩/∪) and NOT a left/right cut — follows the band arc.
 */
function splitLayersFromImage(img) {
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  if (!sctx) return { front: img, back: img };
  sctx.drawImage(img, 0, 0);
  let data;
  try {
    data = sctx.getImageData(0, 0, w, h).data;
  } catch {
    return { front: img, back: img };
  }
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        sumX += x;
        sumY += y;
        count += 1;
      }
    }
  }
  const pivotX = count ? sumX / count : w * 0.5;
  const pivotY = count ? sumY / count : h * 0.5;
  const seam = Math.max(2, Math.min(w, h) * 0.02);

  const front = document.createElement('canvas');
  const back = document.createElement('canvas');
  front.width = back.width = w;
  front.height = back.height = h;
  const fctx = front.getContext('2d');
  const bctx = back.getContext('2d');
  if (!fctx || !bctx) return { front: img, back: img };
  const fImg = fctx.createImageData(w, h);
  const bImg = bctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      if (a <= 0) continue;
      const dy = y - pivotY;
      const tFront = clamp01((-dy + seam) / (seam * 2));
      const tBack = 1 - tFront;
      if (tBack > 0) {
        bImg.data[i] = data[i];
        bImg.data[i + 1] = data[i + 1];
        bImg.data[i + 2] = data[i + 2];
        bImg.data[i + 3] = Math.round(a * tBack);
      }
      if (tFront > 0) {
        fImg.data[i] = data[i];
        fImg.data[i + 1] = data[i + 1];
        fImg.data[i + 2] = data[i + 2];
        fImg.data[i + 3] = Math.round(a * tFront);
      }
    }
  }
  fctx.putImageData(fImg, 0, 0);
  bctx.putImageData(bImg, 0, 0);
  return { front, back };
}

/** Strip opaque black matte from wrap layers so it never paints over the hand. */
function prepareWrapLayer(img) {
  const w = img.naturalWidth || img.width || 1;
  const h = img.naturalHeight || img.height || 1;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return img;
  ctx.drawImage(img, 0, 0);
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h);
  } catch {
    return img;
  }
  const px = data.data;
  let changed = false;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    const a = px[i + 3];
    if (a > 0 && r < 28 && g < 28 && b < 28) {
      px[i + 3] = 0;
      changed = true;
    }
  }
  if (!changed) return img;
  ctx.putImageData(data, 0, 0);
  return c;
}

/** Same canvas size for front/back — avoids stretched bangles when PNG sizes differ. */
function alignWrapLayers(front, back) {
  const fw = front.naturalWidth || front.width || 1;
  const fh = front.naturalHeight || front.height || 1;
  const bw = back.naturalWidth || back.width || 1;
  const bh = back.naturalHeight || back.height || 1;
  if (fw === bw && fh === bh) {
    return { front, back };
  }
  const w = Math.max(fw, bw);
  const h = Math.max(fh, bh);
  const fit = (img, iw, ih) => {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return img;
    const scale = Math.min(w / iw, h / ih);
    const dw = Math.max(1, Math.round(iw * scale));
    const dh = Math.max(1, Math.round(ih * scale));
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return c;
  };
  return { front: fit(front, fw, fh), back: fit(back, bw, bh) };
}

function compositeLayers(front, back) {
  const aligned = alignWrapLayers(front, back);
  const w = aligned.front.width || aligned.front.naturalWidth || 1;
  const h = aligned.front.height || aligned.front.naturalHeight || 1;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return aligned.front;
  ctx.drawImage(aligned.back, 0, 0, w, h);
  ctx.drawImage(aligned.front, 0, 0, w, h);
  return c;
}

function dorsalSideFromCurl(hand, engine, normal) {
  _fcSum.set(0, 0, 0);
  let reach = 0;
  for (const [mcpIdx, pipIdx, tipIdx] of FINGER_CHAINS) {
    const mcp = hand[mcpIdx];
    const pip = hand[pipIdx];
    const tip = hand[tipIdx];
    if (!mcp || !pip || !tip) continue;
    engine.lmToScreen(mcp, _fcMcp);
    engine.lmToScreen(pip, _fcPip);
    engine.lmToScreen(tip, _fcTip);
    const path = _fcMcp.distanceTo(_fcPip) + _fcPip.distanceTo(_fcTip);
    const chord = _fcMcp.distanceTo(_fcTip);
    if (path < 1e-6 || chord / path < CURL_MIN_STRAIGHTNESS) continue;
    _fcChord.addVectors(_fcMcp, _fcTip).multiplyScalar(0.5);
    _fcBend.subVectors(_fcPip, _fcChord);
    _fcSum.add(_fcBend);
    reach += chord;
  }
  if (reach < 1e-3) return 0;
  const signal = _fcSum.dot(normal) / reach;
  if (Math.abs(signal) < CURL_MIN_SIGNAL) return 0;
  return signal > 0 ? 1 : -1;
}

function newHeadPose() {
  return {
    valid: false, confidence: 0, staleFrames: 0, faceSign: 1, yaw: 0,
    faceHeight: 1, jawWidth: 1, halfWidth: 0.5,
    right: new V3(1, 0, 0), up: new V3(0, 1, 0), forward: new V3(0, 0, 1),
    chin: new V3(), center: new V3(), jawCenter: new V3(), neckPivot: new V3(),
  };
}

function newTorsoPose() {
  return {
    valid: false, blend: 0, width: 1,
    right: new V3(1, 0, 0), up: new V3(0, 1, 0), forward: new V3(0, 0, 1),
    shoulderMid: new V3(),
  };
}

function objectsBase() {
  const set = (typeof window !== 'undefined' && window.VTO_OBJECTS_BASE) || 'objects/';
  return String(set).replace(/\/*$/, '/') ;
}

export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'];
export const MODEL_EXTENSIONS = IMAGE_EXTENSIONS;

const IMAGE_CANDIDATES = [
  'jewellery.png', 'jewellery.jpg', 'jewellery.jpeg',
  'image.png', 'image.jpg', 'overlay.png', 'overlay.jpg',
  'model.png', 'model.jpg', 'model.jpeg',
  'earring.png', 'necklace.png', 'ring.png', 'bangle.png',
];
const FRONT_CANDIDATES = ['front.png', 'front.jpg', 'front.jpeg', 'front.webp'];
const BACK_CANDIDATES = ['back.png', 'back.jpg', 'back.jpeg', 'back.webp'];
const WRAP_CATEGORIES = new Set(['ring']);

// ---------------------------------------------------------------------------

export class Engine2D {
  constructor(canvas) {
    if (!canvas) {
      throw new Error('Engine2D: canvas element not found — is #canvas2d present in the DOM yet?');
    }
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    if (!this.ctx) {
      throw new Error('Engine2D: 2D canvas context unavailable in this environment.');
    }
    this.width = 1;
    this.height = 1;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.dispW = 1;
    this.dispH = 1;
    this.offX = 0;
    this.offY = 0;
    this.mirror = true;

    this.imageCache = new Map();
    this.pendingLoads = new Map();
    this.activeItems = new Map();

    this.headPose = newHeadPose();
    this.torsoPose = newTorsoPose();
    this._lastFrameTime = 0;
    this._dtScale = 1;
    this._lastFaceRef = null;
    this._lastPoseRef = null;
    this._faceMiss = 0;
    this._tracking = null;
    this.ringFinger = DEFAULT_RING_FINGER;
    this.fingerConfidence = {};
    this.video = null;
    this.showAnchors = typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('anchors');
    this.showRingDebug = typeof location !== 'undefined'
      && new URLSearchParams(location.search).has('ringdebug');
  }

  setVideoElement(video) {
    this.video = video || null;
  }

  resize(width, height) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._updateCoverMapping();
  }

  setVideoSize(vw, vh) {
    if (!vw || !vh) return;
    this.videoWidth = vw;
    this.videoHeight = vh;
    this._updateCoverMapping();
  }

  _updateCoverMapping() {
    const vw = this.videoWidth || this.width;
    const vh = this.videoHeight || this.height;
    const cover = Math.max(this.width / vw, this.height / vh);
    this.dispW = vw * cover;
    this.dispH = vh * cover;
    this.offX = (this.width - this.dispW) / 2;
    this.offY = (this.height - this.dispH) / 2;
  }

  lmToScreen(lm, out) {
    const nx = this.mirror ? 1 - lm.x : lm.x;
    const px = this.offX + nx * this.dispW;
    const py = this.offY + lm.y * this.dispH;
    return out.set(
      px - this.width / 2,
      -(py - this.height / 2),
      -(lm.z || 0) * this.dispW,
    );
  }

  dist2D(a, b) {
    const dx = (a.x - b.x) * this.dispW;
    const dy = (a.y - b.y) * this.dispH;
    return Math.hypot(dx, dy);
  }

  dist3D(a, b) {
    const dx = (a.x - b.x) * this.dispW;
    const dy = (a.y - b.y) * this.dispH;
    const dz = ((a.z || 0) - (b.z || 0)) * this.dispW;
    return Math.hypot(dx, dy, dz);
  }

  // --- head / torso ---

  _decayHeadPose() {
    const hp = this.headPose;
    hp.staleFrames++;
    hp.confidence = Math.max(0, hp.confidence - 0.15);
    if (hp.staleFrames > 8) hp.valid = false;
    return hp;
  }

  _updateHeadPose(face) {
    const hp = this.headPose;
    // Accept any usable face mesh (do not require exactly 468 — some builds differ)
    if (!face || !face[FACE.chin] || !face[FACE.forehead] || !face[FACE.leftJaw] || !face[FACE.rightJaw]) {
      this._lastFaceRef = null;
      return this._decayHeadPose();
    }
    if (face === this._lastFaceRef && hp.valid) return hp;
    this._lastFaceRef = face;

    const chin = face[FACE.chin];
    const forehead = face[FACE.forehead];
    const lEye = face[FACE.leftEyeOuter];
    const rEye = face[FACE.rightEyeOuter];
    const lJaw = face[FACE.leftJaw];
    const rJaw = face[FACE.rightJaw];
    const noseTip = face[FACE.noseTip];

    const faceHeight = this.dist3D(forehead, chin);
    const jawWidth = this.dist3D(lJaw, rJaw);
    if (!(faceHeight > 1e-3) || !(jawWidth > 1e-3)) return this._decayHeadPose();

    this.lmToScreen(forehead, _v1);
    this.lmToScreen(chin, _v2);
    this.lmToScreen(lEye, _v3);
    this.lmToScreen(rEye, _v4);

    const right = _n1;
    const up = _n2;
    const forward = _n3;
    right.subVectors(_v4, _v3);
    up.subVectors(_v1, _v2);
    if (right.lengthSq() < 1e-9 || up.lengthSq() < 1e-9) return this._decayHeadPose();
    right.normalize();
    up.normalize();
    forward.crossVectors(right, up);
    if (forward.lengthSq() < 1e-9) return this._decayHeadPose();
    forward.normalize();

    _v5.addVectors(_v3, _v4).multiplyScalar(0.5);
    this.lmToScreen(noseTip, _v6);
    _v6.sub(_v5);
    const noseReach = _v6.length();
    if (noseReach > faceHeight * 0.06) {
      const flipped = forward.dot(_v6) < 0;
      if (flipped) { forward.negate(); right.negate(); }
      hp.faceSign = flipped ? -1 : 1;
    } else if (hp.faceSign < 0) {
      forward.negate();
      right.negate();
    }
    right.crossVectors(up, forward).normalize();

    hp.right.copy(right);
    hp.up.copy(up);
    hp.forward.copy(forward);
    hp.chin.copy(_v2);
    hp.center.copy(_v2).addScaledVector(hp.up, faceHeight * 0.5);
    this.lmToScreen(face[FACE.rightJawAngle], _v7);
    this.lmToScreen(face[FACE.leftJawAngle], _v1);
    hp.jawCenter.addVectors(_v7, _v1).multiplyScalar(0.5);
    hp.neckPivot.copy(hp.center)
      .addScaledVector(hp.up, -faceHeight * PLACE.neckPivotDrop)
      .addScaledVector(hp.forward, -jawWidth * PLACE.neckPivotBack);
    hp.faceHeight = faceHeight;
    hp.jawWidth = jawWidth;
    hp.halfWidth = jawWidth * 0.5;
    hp.yaw = Math.atan2(hp.forward.x, hp.forward.z);
    hp.staleFrames = 0;
    hp.confidence = 1;
    hp.valid = true;
    return hp;
  }

  _updateTorsoPose(pose) {
    const tp = this.torsoPose;
    const hp = this.headPose;
    let ok;
    if (pose && pose === this._lastPoseRef && tp.valid) {
      ok = true;
    } else {
      this._lastPoseRef = pose || null;
      ok = this._solveTorso(pose, tp, hp);
    }
    const target = ok ? 1 : 0;
    tp.blend += (target - tp.blend) * adapt(TORSO_BLEND_RATE, this._dtScale);
    tp.blend = clamp01(tp.blend);
    tp.valid = ok;
    return tp;
  }

  _solveTorso(pose, tp, hp) {
    if (!pose || pose.length <= POSE.rightHip || !hp.valid) return false;
    const ls = pose[POSE.leftShoulder];
    const rs = pose[POSE.rightShoulder];
    if (!ls || !rs) return false;
    const vis = Math.min(ls.visibility ?? 0, rs.visibility ?? 0);
    if (vis < 0.55) return false;
    const okFrame = (lm) => lm.x > -0.15 && lm.x < 1.15 && lm.y > -0.15 && lm.y < 1.12;
    if (!okFrame(ls) || !okFrame(rs)) return false;
    const width = this.dist3D(ls, rs);
    if (!(width > 1e-3)) return false;
    const ratio = width / Math.max(hp.jawWidth, 1e-6);
    if (ratio < 1.4 || ratio > 4.5) return false;

    this.lmToScreen(ls, _v1);
    this.lmToScreen(rs, _v2);
    tp.right.subVectors(_v2, _v1);
    if (tp.right.lengthSq() < 1e-9) return false;
    tp.right.normalize();
    tp.shoulderMid.addVectors(_v1, _v2).multiplyScalar(0.5);

    const lh = pose[POSE.leftHip];
    const rh = pose[POSE.rightHip];
    const hipsVisible = lh && rh
      && Math.min(lh.visibility ?? 0, rh.visibility ?? 0) > 0.5
      && okFrame(lh) && okFrame(rh);
    if (hipsVisible) {
      this.lmToScreen(lh, _v3);
      this.lmToScreen(rh, _v4);
      _v5.addVectors(_v3, _v4).multiplyScalar(0.5);
      tp.up.subVectors(tp.shoulderMid, _v5);
    } else {
      tp.up.subVectors(hp.chin, tp.shoulderMid);
    }
    if (tp.up.lengthSq() < 1e-9) return false;
    tp.up.normalize();
    tp.forward.crossVectors(tp.right, tp.up);
    if (tp.forward.lengthSq() < 1e-9) return false;
    tp.forward.normalize();
    if (tp.forward.dot(hp.forward) < 0) { tp.forward.negate(); tp.right.negate(); }
    tp.right.crossVectors(tp.up, tp.forward).normalize();
    tp.width = width;
    return true;
  }

  // --- image loading ---

  async loadJewellery(id, folder, imageFile, category, onProgress, layers = {}, assetRevisions = {}) {
    const wrap = WRAP_CATEGORIES.has(category);
    const modelRev = assetRevisions.model || '';
    const frontRev = assetRevisions.front || '';
    const backRev = assetRevisions.back || '';
    const cacheKey = wrap
      ? `${folder}/wrap:${layers.front || 'front.png'}|${layers.back || 'back.png'}@${frontRev}|${backRev}`
      : `${folder}/${imageFile}@${modelRev}`;
    if (this.imageCache.has(cacheKey)) {
      onProgress?.(1);
      return this.imageCache.get(cacheKey);
    }
    if (this.pendingLoads.has(cacheKey)) return this.pendingLoads.get(cacheKey);

    const promise = (async () => {
      onProgress?.(0.1);
      const warnings = [];
      const toUrl = (name) => {
        if (!name) return null;
        if (name.startsWith('blob:') || name.startsWith('data:') || name.startsWith('http')) return name;
        return `${objectsBase()}${folder}/${name}`;
      };

      let img = null;
      let imgFront = null;
      let imgBack = null;

      if (wrap) {
        const frontName = layers.front || 'front.png';
        const backName = layers.back || 'back.png';
        try {
          imgFront = await loadImageElement(toUrl(frontName), frontRev);
        } catch {
          warnings.push(`Missing front layer (${frontName})`);
        }
        try {
          imgBack = await loadImageElement(toUrl(backName), backRev);
        } catch {
          warnings.push(`Missing back layer (${backName})`);
        }
        onProgress?.(0.5);

        // Prefer front.png + back.png — jewellery.png is fallback / catalogue only
        if ((!imgFront || !imgBack) && imageFile) {
          try {
            const legacy = await loadImageElement(toUrl(imageFile), modelRev);
            const split = splitLayersFromImage(legacy);
            if (!imgFront) imgFront = split.front;
            if (!imgBack) imgBack = split.back;
            warnings.push('Front/back derived from jewellery.png — add front.png + back.png.');
          } catch {
            warnings.push(`Could not load fallback ${imageFile}`);
          }
        }
        if (!imgFront || !imgBack) {
          throw new Error(`Ring "${folder}" needs front.png and back.png.`);
        }
        imgFront = prepareWrapLayer(imgFront);
        imgBack = prepareWrapLayer(imgBack);
        const aligned = alignWrapLayers(imgFront, imgBack);
        imgFront = aligned.front;
        imgBack = aligned.back;
        // Composite for anchor/content math only — render uses layers, not this image
        img = compositeLayers(imgFront, imgBack);
        for (const w of warnings) console.warn(`[Engine2D] "${folder}": ${w}`);
      } else {
        if (!imageFile) throw new Error(`Could not load image for ${folder}`);
        img = await loadImageElement(toUrl(imageFile) || imageFile, modelRev);
      }

      onProgress?.(0.9);
      const content = analyzeImageContent(img);
      const tuning = {
        ...CATEGORY_DEFAULTS[category],
        ...(MODEL_TUNING[folder] || {}),
        category,
        offsetX: MODEL_TUNING[folder]?.offsetX ?? 0,
        offsetY: MODEL_TUNING[folder]?.offsetY ?? 0,
        rotationOffset: MODEL_TUNING[folder]?.rotationOffset ?? 0,
        scale: MODEL_TUNING[folder]?.scale ?? 1,
        earDrop: MODEL_TUNING[folder]?.earDrop,
        earOut: MODEL_TUNING[folder]?.earOut,
        earBack: MODEL_TUNING[folder]?.earBack,
        anchor: MODEL_TUNING[folder]?.anchor || CATEGORY_DEFAULTS[category].anchor,
      };
      const template = {
        id, folder, imageFile, category, cacheKey, img, tuning, content,
        imgFront: wrap ? imgFront : null,
        imgBack: wrap ? imgBack : null,
        wrap: wrap && !!(imgFront && imgBack),
        warnings,
        naturalWidth: img.naturalWidth || img.width,
        naturalHeight: img.naturalHeight || img.height,
      };
      this.imageCache.set(cacheKey, template);
      onProgress?.(1);
      return template;
    })();

    this.pendingLoads.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.pendingLoads.delete(cacheKey);
    }
  }

  _validateUploadFile(file, label = '') {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      throw new Error(`Only PNG, JPG and JPEG images are supported${label ? ` (${label})` : ''}.`);
    }
    if (file.size > 12 * 1024 * 1024) {
      throw new Error(`${label ? `${label} image` : 'Image'} is too large (max 12 MB).`);
    }
  }

  /**
   * Load a user-uploaded File as jewellery with automatic background removal.
   */
  async loadUploadedJewellery(file, category, onProgress) {
    this._validateUploadFile(file);
    if (file.type && !/^image\/(png|jpeg|jpg|webp)$/i.test(file.type) && file.type !== 'image/jpg') {
      if (!file.type.startsWith('image/')) throw new Error('File is not an image.');
    }

    onProgress?.(0, 'checking');
    let processedFile;
    let wasAlreadyTransparent;
    try {
      ({ file: processedFile, wasAlreadyTransparent } = await ensureTransparentJewelleryImage(
        file,
        (fraction) => onProgress?.(fraction, wasAlreadyTransparent ? 'checking' : 'removing-bg'),
      ));
    } catch (err) {
      console.error('[Upload] background removal failed', err);
      throw new Error(err?.message || 'Could not process this image. Please try another one.');
    }

    onProgress?.(1, 'loading');
    const url = URL.createObjectURL(processedFile);
    const id = `upload-${Date.now()}`;
    const folder = id;
    const template = await this.loadJewellery(id, folder, url, category);
    template.revokeUrl = url;
    template.label = file.name.replace(/\.[^.]+$/, '');
    template.backgroundRemoved = !wasAlreadyTransparent;
    return template;
  }

  /**
   * Load a user-uploaded ring as front + back wrap pair with background removal.
   */
  async loadUploadedRingJewellery(frontFile, backFile, onProgress) {
    this._validateUploadFile(frontFile, 'front');
    this._validateUploadFile(backFile, 'back');

    onProgress?.(0, 'checking');
    let processedFront;
    let processedBack;
    let frontWasTransparent;
    let backWasTransparent;
    try {
      ({ file: processedFront, wasAlreadyTransparent: frontWasTransparent } = await ensureTransparentJewelleryImage(
        frontFile,
        (fraction) => onProgress?.(fraction * 0.5, frontWasTransparent ? 'checking' : 'removing-bg'),
      ));
      ({ file: processedBack, wasAlreadyTransparent: backWasTransparent } = await ensureTransparentJewelleryImage(
        backFile,
        (fraction) => onProgress?.(0.5 + fraction * 0.5, backWasTransparent ? 'checking' : 'removing-bg'),
      ));
    } catch (err) {
      console.error('[Upload] ring background removal failed', err);
      throw new Error(err?.message || 'Could not process these images. Please try again.');
    }

    onProgress?.(1, 'loading');
    const frontUrl = URL.createObjectURL(processedFront);
    const backUrl = URL.createObjectURL(processedBack);
    const id = `upload-${Date.now()}`;
    const folder = id;
    const template = await this.loadJewellery(id, folder, null, 'ring', undefined, {
      front: frontUrl,
      back: backUrl,
    });
    template.revokeUrl = frontUrl;
    template.revokeUrlBack = backUrl;
    template.backgroundRemoved = !frontWasTransparent || !backWasTransparent;
    return template;
  }

  /**
   * Load uploaded bangle/bracelet pair, auto remove bg, and composite into one.
   */
  async loadUploadedBangleJewellery(frontFile, backFile, onProgress) {
    this._validateUploadFile(frontFile, 'front');
    this._validateUploadFile(backFile, 'back');

    onProgress?.(0, 'checking');
    let processedFront;
    let processedBack;
    let frontWasTransparent;
    let backWasTransparent;
    try {
      ({ file: processedFront, wasAlreadyTransparent: frontWasTransparent } = await ensureTransparentJewelleryImage(
        frontFile,
        (fraction) => onProgress?.(fraction * 0.45, frontWasTransparent ? 'checking' : 'removing-bg'),
      ));
      ({ file: processedBack, wasAlreadyTransparent: backWasTransparent } = await ensureTransparentJewelleryImage(
        backFile,
        (fraction) => onProgress?.(0.45 + fraction * 0.45, backWasTransparent ? 'checking' : 'removing-bg'),
      ));
    } catch (err) {
      console.error('[Upload] bangle background removal failed', err);
      throw new Error(err?.message || 'Could not process these images. Please try again.');
    }

    onProgress?.(0.9, 'loading');
    const frontImg = prepareWrapLayer(await loadImageElementDirect(URL.createObjectURL(processedFront)));
    const backImg = prepareWrapLayer(await loadImageElementDirect(URL.createObjectURL(processedBack)));
    const composited = compositeLayers(frontImg, backImg);
    const compositedBlob = await new Promise((resolve) => composited.toBlob(resolve, 'image/png'));
    const url = URL.createObjectURL(compositedBlob);
    const id = `upload-${Date.now()}`;
    const folder = id;
    const template = await this.loadJewellery(id, folder, url, 'bangles');
    template.revokeUrl = url;
    template.backgroundRemoved = !frontWasTransparent || !backWasTransparent;
    return template;
  }

  activate(id, template) {
    const pair = template.tuning.pair || 1;
    const instances = [];
    for (let i = 0; i < pair; i++) {
      instances.push({
        index: i,
        opacity: 0,
        _earHold: null,
        state: {
          initialized: false,
          age: 0,
          x: 0,
          y: 0,
          scale: 1,
          angle: 0,
        },
      });
    }
    this.activeItems.set(id, {
      id,
      folder: template.folder,
      category: template.category,
      cacheKey: template.cacheKey,
      img: template.img,
      imgFront: template.imgFront || null,
      imgBack: template.imgBack || null,
      wrap: !!template.wrap,
      warnings: template.warnings || [],
      content: template.content || { x0: 0, y0: 0, x1: 1, y1: 1, cx: 0.5, cy: 0.5, w: 1, h: 1 },
      naturalWidth: template.naturalWidth,
      naturalHeight: template.naturalHeight,
      tuning: { ...template.tuning },
      instances,
      ringGate: null,
      fingerShape: null,
      fingerWidth: 0,
      ringSlot: undefined,
      wristWidthA: 0,
      wristWidthB: 0,
    });
  }

  deactivate(id) {
    const entry = this.activeItems.get(id);
    if (!entry) return;
    const cacheKey = entry.cacheKey;
    this.activeItems.delete(id);
    let cacheStillUsed = false;
    for (const [, other] of this.activeItems) {
      if (other.cacheKey === cacheKey) {
        cacheStillUsed = true;
        break;
      }
    }
    if (!cacheStillUsed) {
      const cached = this.imageCache.get(cacheKey);
      if (cached?.revokeUrl) {
        URL.revokeObjectURL(cached.revokeUrl);
        cached.revokeUrl = null;
      }
      if (cached?.revokeUrlBack) {
        URL.revokeObjectURL(cached.revokeUrlBack);
        cached.revokeUrlBack = null;
      }
    }
  }

  // Snap everything out of view immediately (used when the camera stops) — same as Engine3D.hideAll
  hideAll() {
    this.headPose.valid = false;
    this.headPose.confidence = 0;
    this.headPose.staleFrames = 0;
    this.torsoPose.valid = false;
    this.torsoPose.blend = 0;
    this._lastFaceRef = null;
    this._lastPoseRef = null;
    this._lastFrameTime = 0;
    this.fingerConfidence = {};
    this._tracking = null;

    for (const [, entry] of this.activeItems) {
      entry.ringGate = null;
      entry.fingerShape = null;
      entry.fingerWidth = 0;
      entry.ringSlot = undefined;
      entry.wristWidthA = 0;
      entry.wristWidthB = 0;
      entry.dorsalSideA = undefined;
      entry.dorsalSideB = undefined;
      for (const inst of entry.instances) {
        inst.opacity = 0;
        inst._earHold = null;
        inst.state.initialized = false;
        inst.state.age = 0;
        inst.state.x = 0;
        inst.state.y = 0;
        inst.state.scale = 1;
        inst.state.angle = 0;
      }
    }
  }

  hide(entry) {
    for (const inst of entry.instances) {
      inst.occlude = null;
      inst.ringFacing = null;
      inst.ringFacingSignal = null;
      inst._ringDebug = null;
      this.place(inst, 0, 0, 1, 0, false, 0);
    }
  }

  place(inst, x, y, targetScale, targetAngle, visible, alpha = 1) {
    const s = inst.state;
    const p = inst.smooth || SMOOTH_PROFILE.default;
    const dtScale = this._dtScale;

    if (visible) {
      if (!s.initialized) {
        s.x = x; s.y = y; s.scale = targetScale; s.angle = targetAngle;
        s.initialized = true; s.age = 0;
      } else {
        s.age = Math.min(s.age + 1, 8);
        const rampFloor = p.rampMin ?? 0.35;
        const ramp = rampFloor + (1 - rampFloor) * (s.age / 8);
        const dx = x - s.x;
        const dy = y - s.y;
        const moved = Math.hypot(dx, dy);
        if (moved > Math.max(targetScale, 1) * JUMP_SNAP) {
          s.x = x; s.y = y; s.scale = targetScale; s.angle = targetAngle; s.age = 0;
        } else {
          const reference = Math.max(targetScale, 1) * RESPONSE_SPEED * dtScale;
          const deadband = p.rampMin != null ? 0.18 : DEADBAND_PX;
          if (moved > deadband) {
            const k = responsive(p.posMin, p.posMax, moved, reference, dtScale) * ramp;
            s.x += dx * k;
            s.y += dy * k;
          }
          if (Math.abs(targetScale - s.scale) > s.scale * DEADBAND_SCALE) {
            s.scale += (targetScale - s.scale) * adapt(p.scale, dtScale) * ramp;
          }
          const period = inst.anglePeriod || Math.PI * 2;
          const delta = angleDiffPeriodic(targetAngle, s.angle, period);
          const swept = Math.abs(delta);
          const kRot = responsive(p.rotMin, p.rotMax, swept, RESPONSE_ANGLE * dtScale, dtScale) * ramp;
          s.angle += delta * kRot;
        }
      }
    }

    const target = visible ? clamp01(alpha) : 0;
    const next = (inst.opacity ?? 0) + (target - (inst.opacity ?? 0)) * adapt(FADE_SPEED, dtScale);
    inst.opacity = Math.abs(target - next) < 0.01 ? target : next;
    if (!visible && inst.opacity <= 0.02) {
      s.initialized = false;
      s.age = 0;
    }
  }

  _outOfFrame(x, y, scale) {
    const margin = Math.max(scale, 1) * OFFSCREEN_MARGIN;
    return Math.abs(x) > this.width / 2 + margin || Math.abs(y) > this.height / 2 + margin;
  }

  _handCoverage(pos, tracking, exceptHand) {
    if (!HIDE_UNDER_HANDS || !tracking) return 0;
    let best = 0;
    for (const hand of [tracking.leftHand, tracking.rightHand]) {
      if (!hand || hand === exceptHand || hand.length < 21) continue;
      this.lmToScreen(hand[HAND.wrist], _hcWrist);
      this.lmToScreen(hand[HAND.indexMcp], _hcIndex);
      this.lmToScreen(hand[HAND.pinkyMcp], _hcPinky);
      const span = Math.hypot(_hcIndex.x - _hcPinky.x, _hcIndex.y - _hcPinky.y) || 1;
      const d = Math.hypot(pos.x - _hcWrist.x, pos.y - _hcWrist.y);
      const cover = clamp01(1 - (d / (span * PLACE.handCoverReach) - PLACE.handCoverFade) / (1 - PLACE.handCoverFade));
      if (cover > best) best = cover;
    }
    return best;
  }

  _handOutlineCoverage(pos, tracking, exceptHand) {
    if (!HIDE_UNDER_HANDS || !tracking) return 0;
    let best = 0;
    for (const hand of [tracking.leftHand, tracking.rightHand]) {
      if (!hand || hand === exceptHand || hand.length < 21) continue;
      this.lmToScreen(hand[HAND.indexMcp], _hcIndex);
      this.lmToScreen(hand[HAND.pinkyMcp], _hcPinky);
      const span = Math.hypot(_hcIndex.x - _hcPinky.x, _hcIndex.y - _hcPinky.y) || 1;
      let nearest = Infinity;
      for (const idx of HAND_OUTLINE) {
        const lm = hand[idx];
        if (!lm) continue;
        this.lmToScreen(lm, _hcPoint);
        const d = Math.hypot(pos.x - _hcPoint.x, pos.y - _hcPoint.y);
        if (d < nearest) nearest = d;
      }
      const cover = clamp01(1 - (nearest / (span * PLACE.earHandReach) - PLACE.earHandFade) / (1 - PLACE.earHandFade));
      if (cover > best) best = cover;
    }
    return best;
  }

  // --- category placement ---

  updateNecklace(entry, tracking) {
    const hp = this.headPose;
    if (!hp.valid) return false;
    const face = tracking.face;
    // Soft gate — do not hide the whole necklace for one landmark near the frame edge
    if (face && !inFrame(face[FACE.chin], 0.12)) return false;

    const tp = this.torsoPose;
    const torso = tp.blend;
    const faceHeight = hp.faceHeight;
    const jawWidth = hp.jawWidth;
    const NECK_FOLLOW = 0.38;

    _n1.set(0, 1, 0).lerp(hp.up, NECK_FOLLOW).normalize();
    _n2.set(0, 0, 1).lerp(hp.forward, NECK_FOLLOW).normalize();
    if (torso > 0.001) {
      _v5.copy(tp.up).lerp(hp.up, 0.20).normalize();
      _v6.copy(tp.forward).lerp(hp.forward, 0.30).normalize();
      _n1.lerp(_v5, torso * PLACE.neckTorsoAxis).normalize();
      _n2.lerp(_v6, torso * PLACE.neckTorsoAxis).normalize();
    }

    let neckRadius = jawWidth * PLACE.neckRadius * 0.5;
    if (torso > 0.001) {
      const fromShoulders = tp.width * PLACE.neckFromShoulder * 0.5;
      neckRadius += (fromShoulders - neckRadius) * torso * PLACE.neckShoulderTrust;
    }

    _pos.copy(hp.neckPivot)
      .addScaledVector(_n1, -faceHeight * PLACE.neckDrop)
      .addScaledVector(_n2, -neckRadius * PLACE.necklaceForward);

    const faceAnchorX = _pos.x;
    const faceAnchorY = _pos.y;
    if (torso > 0.001) {
      _v5.copy(tp.shoulderMid).addScaledVector(tp.up, tp.width * PLACE.neckAboveShoulder);
      _pos.lerp(_v5, torso * PLACE.neckShoulderPull);
      const lift = faceHeight * PLACE.neckShoulderLift;
      _pos.y = faceAnchorY + Math.min(Math.max(_pos.y - faceAnchorY, -lift), lift);
      const limit = jawWidth * PLACE.neckShoulderShift;
      _pos.x = faceAnchorX + Math.min(Math.max(_pos.x - faceAnchorX, -limit), limit);
    }

    const tune = entry.tuning;
    const contentW = Math.max(entry.content?.w || 1, 1e-3);
    let scale = (neckRadius * 2 * PLACE.necklaceWidth / contentW) * (tune.scale ?? 1);
    const minDrop = faceHeight * PLACE.neckClearChin;
    _v6.subVectors(_pos, hp.chin);
    const along = _v6.dot(_n1);
    const wanted = Math.min(Math.max(-along, minDrop), Math.max(faceHeight * PLACE.neckDropMax, minDrop));
    _pos.addScaledVector(_n1, -(wanted + along));

    _pos.x += (tune.offsetX || 0) * faceHeight;
    _pos.y += (tune.offsetY || 0) * faceHeight;

    if (this._outOfFrame(_pos.x, _pos.y, scale)) return false;
    const alpha = hp.confidence * freshness(tracking.faceMiss) * (1 - this._handCoverage(_pos, tracking, null));
    if (alpha <= 0.01) return false;

    const angle = screenAngleFromUp(_n1) + ((tune.rotationOffset || 0) * Math.PI / 180);
    const inst = entry.instances[0];
    inst.smooth = SMOOTH_PROFILE.necklace;
    this.place(inst, _pos.x, _pos.y, scale, angle, true, alpha);
    return true;
  }

  updateEarrings(entry, tracking) {
    const hp = this.headPose;
    if (!hp.valid) return false;

    const face = tracking.face;
    const faceHeight = hp.faceHeight;
    const userScale = entry.tuning.scale ?? 1;

    const contentH = Math.max(entry.content?.h || 1, 0.35);
    let scale = (faceHeight * PLACE.earringDrop * userScale) / contentH;
    const maxOpaque = faceHeight * PLACE.earringMax * userScale;
    if (scale * contentH > maxOpaque) scale = maxOpaque / contentH;
    scale = Math.max(scale, faceHeight * 0.06);

    this._placeEarring(entry, entry.instances[0], face, +1, scale);
    if (entry.instances[1]) {
      this._placeEarring(entry, entry.instances[1], face, -1, scale);
    }
    return true;
  }

  _placeEarring(entry, inst, face, side, scale) {
    const hp = this.headPose;
    const faceHeight = hp.faceHeight;
    const earIdx = side > 0 ? FACE.rightEarLow : FACE.leftEarLow;
    const jawIdx = side > 0 ? FACE.rightJawAngle : FACE.leftJawAngle;
    _n1.copy(hp.right).multiplyScalar(side);
    const facing = _n1.z;
    const tune = entry.tuning;
    const earDrop = tune.earDrop ?? PLACE.earringLobeDrop;
    const earOut = tune.earOut ?? PLACE.earringLobeOut;
    const earBack = tune.earBack ?? PLACE.earringLobeBack;
    const earUp = tune.earUp ?? PLACE.earringLobeUp;

    // Ear still facing camera enough that a hand cover is likely (not a head turn)
    const earShouldShow = facing > PLACE.earringFadeStart;

    const clearHide = () => {
      inst._earHold = null;
      this.place(inst, 0, 0, scale, 0, false, 0);
    };

    const holdOrHide = () => {
      // Head turned — ear not visible → never hold a ghost earring
      if (!earShouldShow) {
        clearHide();
        return;
      }
      const hold = inst._earHold;
      if (hold && hold.miss < EAR_HOLD_FRAMES) {
        hold.miss += 1;
        const fade = 1 - hold.miss / (EAR_HOLD_FRAMES + 1);
        this.place(inst, hold.x, hold.y, hold.scale, hold.angle, true, hold.alpha * fade);
        return;
      }
      clearHide();
    };

    // Hand over ear often drops FaceMesh landmarks briefly — hold only if ear should show
    if (!face || !face[earIdx] || !face[jawIdx]) {
      holdOrHide();
      return;
    }

    this.lmToScreen(face[earIdx], _v1);
    this.lmToScreen(face[jawIdx], _v2);
    _pos.copy(_v1).lerp(_v2, earDrop);
    _pos.addScaledVector(_n1, hp.halfWidth * earOut)
      .addScaledVector(hp.forward, -hp.halfWidth * earBack)
      .addScaledVector(hp.up, faceHeight * earUp);
    // Right earring only: nudge inward (left toward face)
    if (side > 0) {
      _pos.addScaledVector(_n1, -hp.halfWidth * PLACE.earringRightIn);
    }

    _pos.x += (tune.offsetX || 0) * faceHeight * side;
    _pos.y += (tune.offsetY || 0) * faceHeight;

    _n3.set(0, 1, 0).lerp(hp.up, PLACE.earringRollFollow).normalize();

    // Per-ear visibility from head turn
    let turned = clamp01(
      (facing - PLACE.earringFadeEnd) / (PLACE.earringFadeStart - PLACE.earringFadeEnd),
    );
    if (!allInFrame(face, [earIdx, jawIdx], 0.08)) turned = 0;

    const alpha = (this._outOfFrame(_pos.x, _pos.y, scale) ? 0 : turned)
      * hp.confidence * freshness(this._faceMiss);

    const angle = screenAngleFromUp(_n3) + ((tune.rotationOffset || 0) * Math.PI / 180);
    inst.smooth = SMOOTH_PROFILE.earring;

    // Ear clearly turned away from camera → hide immediately (no hold)
    if (facing <= PLACE.earringFadeEnd) {
      clearHide();
      return;
    }

    if (alpha > 0.12) {
      inst._earHold = {
        x: _pos.x, y: _pos.y, scale, angle, alpha, miss: 0,
      };
      this.place(inst, _pos.x, _pos.y, scale, angle, true, alpha);
      return;
    }

    // Landmark glitch while ear still faces camera (hand on ear / hair)
    if (inst._earHold && earShouldShow) {
      holdOrHide();
      return;
    }

    // Soft fade during mild turn; fully off otherwise
    inst._earHold = null;
    this.place(inst, _pos.x, _pos.y, scale, angle, alpha > 0.02, alpha);
  }

  _handFrame(hand) {
    const wristLm = hand[HAND.wrist];
    const index = hand[HAND.indexMcp];
    const middle = hand[HAND.middleMcp];
    const pinky = hand[HAND.pinkyMcp];
    if (!wristLm || !index || !middle || !pinky) return null;
    this.lmToScreen(wristLm, _hfWrist);
    _hfNormal.set(0, 0, 0);
    let area = 0;
    for (let i = 0; i < MCP_ROW.length - 1; i++) {
      const a = hand[MCP_ROW[i]];
      const b = hand[MCP_ROW[i + 1]];
      if (!a || !b) continue;
      this.lmToScreen(a, _hfP).sub(_hfWrist);
      this.lmToScreen(b, _hfQ).sub(_hfWrist);
      _hfTmp.crossVectors(_hfQ, _hfP);
      _hfNormal.add(_hfTmp);
      area += _hfTmp.length();
    }
    if (!(area > 1e-6)) return null;
    if (_hfNormal.length() < area * MIN_PALM_AGREEMENT) return null;
    _hfNormal.normalize();
    this.lmToScreen(index, _hfP);
    this.lmToScreen(pinky, _hfQ);
    _hfAcross.subVectors(_hfQ, _hfP);
    _hfAcross.addScaledVector(_hfNormal, -_hfNormal.dot(_hfAcross));
    if (_hfAcross.lengthSq() < 1e-12) return null;
    _hfAcross.normalize();
    this.lmToScreen(middle, _hfP);
    _hfAlong.subVectors(_hfP, _hfWrist);
    _hfAlong.addScaledVector(_hfNormal, -_hfNormal.dot(_hfAlong));
    _hfAlong.addScaledVector(_hfAcross, -_hfAcross.dot(_hfAlong));
    if (_hfAlong.lengthSq() < 1e-12) return null;
    _hfAlong.normalize();
    return _handFrameOut;
  }

  getRingFinger() { return this.ringFinger; }
  setRingFinger(key) {
    const next = normaliseFingerKey(key);
    if (!next || next === this.ringFinger) return this.ringFinger;
    this.ringFinger = next;
    this._forgetRingFingerState();
    return this.ringFinger;
  }
  resetRingFinger() {
    this.ringFinger = DEFAULT_RING_FINGER;
    this._forgetRingFingerState();
    return this.ringFinger;
  }
  _forgetRingFingerState() {
    this.fingerConfidence = {};
    for (const [, entry] of this.activeItems) {
      if (entry.category !== 'ring') continue;
      entry.ringGate = null;
      entry.fingerShape = null;
      entry.fingerWidth = 0;
      entry.ringSlot = undefined;
      entry.dorsalSide = undefined;
    }
  }

  pickFingerAt(x, y) {
    const tracking = this._tracking;
    if (!tracking) return null;
    let best = null;
    for (const hand of [tracking.leftHand, tracking.rightHand]) {
      if (!hand || hand.length < 21) continue;
      const span = this.dist2D(hand[HAND.indexMcp], hand[HAND.pinkyMcp]);
      if (!(span > 1e-3)) continue;
      const limit = span * FINGER_TAP_REACH;
      for (const key of RING_FINGER_ORDER) {
        const d = this._tapDistanceToFinger(hand, RING_FINGERS[key], x, y);
        if (d === null || d > limit) continue;
        if (!best || d < best.d) best = { key, d };
      }
    }
    return best ? best.key : null;
  }

  _tapDistanceToFinger(hand, finger, x, y) {
    const chain = fingerChain(finger);
    let best = null;
    for (let i = 0; i < chain.length - 1; i++) {
      const a = hand[chain[i]];
      const b = hand[chain[i + 1]];
      if (!a || !b) continue;
      this.lmToScreen(a, _ftA);
      this.lmToScreen(b, _ftB);
      const d = distanceToSegment2D(x, y, _ftA, _ftB);
      if (best === null || d < best) best = d;
    }
    return best;
  }

  _pickRingHand(entry, tracking, finger) {
    const options = [
      { hand: tracking.leftHand, miss: tracking.leftHandMiss, isRight: tracking.leftHandIsRight, slot: 0 },
      { hand: tracking.rightHand, miss: tracking.rightHandMiss, isRight: tracking.rightHandIsRight, slot: 1 },
    ];
    let best = null;
    for (const option of options) {
      const hand = option.hand;
      if (!hand || hand.length < 21) continue;
      if (!allInFrame(hand, [finger.mcp, finger.pip], 0.15)) continue;
      const quality = fingerQuality(hand, this, finger) * freshness(option.miss);
      if (quality <= 0.01) continue;
      const weighted = option.slot === entry.ringSlot ? quality * RING_HAND_STICK : quality;
      if (!best || weighted > best.weighted) best = { ...option, quality, weighted };
    }
    return best;
  }

  _ringFingerWidth(entry, hand, finger) {
    const gaps = MCP_GAPS.map(([a, b]) => this.dist3D(hand[a], hand[b]));
    const own = MCP_GAP_OF[finger.key] ?? 1;
    const others = gaps.filter((v, i) => i !== own && v > 1e-4);
    const cues = [
      gaps[own],
      others.length ? others.reduce((sum, v) => sum + v, 0) / others.length : 0,
      this.dist3D(hand[finger.mcp], hand[finger.pip]) / RING_BONE_TO_WIDTH,
    ].filter((v) => v > 1e-4).sort((a, b) => a - b);
    if (!cues.length) return 0;
    const target = cues[Math.floor(cues.length / 2)] * PLACE.ringShaft;
    const prev = entry.fingerWidth || 0;
    entry.fingerWidth = prev > 0
      ? prev + (target - prev) * adapt(RING_WIDTH_SMOOTH, this._dtScale)
      : target;
    return entry.fingerWidth;
  }

  _fingerSteadiness(entry, hand, finger) {
    const ratio = fingerShapeRatio(hand, this, finger);
    if (!(ratio > 1e-4)) return 0;
    const st = entry.fingerShape;
    if (!st || st.key !== finger.key) {
      entry.fingerShape = { key: finger.key, ratio, wobble: 0 };
      return 1;
    }
    const change = Math.abs(ratio - st.ratio) / Math.max(this._dtScale, 1e-3);
    st.ratio = ratio;
    st.wobble += (change - st.wobble) * adapt(FINGER_WOBBLE_SMOOTH, this._dtScale);
    return clamp01(1 - st.wobble / FINGER_WOBBLE_LIMIT);
  }

  _ringGate(entry, confidence) {
    let gate = entry.ringGate;
    if (!gate) gate = entry.ringGate = { on: false, good: 0, bad: 0 };
    if (gate.on) {
      if (confidence >= RING_HIDE_LEVEL) gate.bad = 0;
      else if (++gate.bad >= RING_HIDE_FRAMES) { gate.on = false; gate.good = 0; }
    } else if (confidence >= RING_SHOW_LEVEL) {
      if (++gate.good >= RING_SHOW_FRAMES) { gate.on = true; gate.bad = 0; }
    } else {
      gate.good = 0;
    }
    return gate.on;
  }

  _reportFingerConfidence(tracking, chosenKey, chosenValue) {
    const out = {};
    for (const key of RING_FINGER_ORDER) {
      const finger = RING_FINGERS[key];
      let best = 0;
      for (const hand of [tracking.leftHand, tracking.rightHand]) {
        if (!hand || hand.length < 21) continue;
        if (!allInFrame(hand, fingerChain(finger), RING_FRAME_INSET)) continue;
        if (!allInFrame(hand, RING_SUPPORT)) continue;
        const q = fingerQuality(hand, this, finger);
        if (q > best) best = q;
      }
      out[key] = best;
    }
    if (chosenKey) out[chosenKey] = chosenValue;
    this.fingerConfidence = out;
  }

  updateRing(entry, tracking) {
    const finger = RING_FINGERS[this.ringFinger] || RING_FINGERS[DEFAULT_RING_FINGER];
    const pick = this._pickRingHand(entry, tracking, finger);
    if (!pick) {
      this._ringGate(entry, 0);
      this._reportFingerConfidence(tracking, finger.key, 0);
      return false;
    }
    const hand = pick.hand;
    const frame = this._handFrame(hand);
    if (!frame) {
      this._ringGate(entry, 0);
      this._reportFingerConfidence(tracking, finger.key, 0);
      return false;
    }
    if (entry.ringSlot !== pick.slot) {
      entry.fingerWidth = 0;
      entry.dorsalSide = undefined;
      entry.fingerShape = null;
      entry.ringAxis = null;
      entry.ringAngleUnwrapped = NaN;
      entry.ringSlot = pick.slot;
    }

    // Which way is the back of the hand? (reference: engine3d updateRing)
    _n2.copy(frame.normal);
    const curl = dorsalSideFromCurl(hand, this, _n2);
    if (curl !== 0) entry.dorsalSide = curl;
    else if (entry.dorsalSide === undefined) entry.dorsalSide = handSign(pick.isRight);
    _dorsal.copy(frame.normal);
    _dorsal.multiplyScalar(PLACE.ringStoneOnBackOfHand ? entry.dorsalSide : -entry.dorsalSide);
    if (_dorsal.lengthSq() > 1e-12) _dorsal.normalize();

    this.lmToScreen(hand[finger.mcp], _v1);
    this.lmToScreen(hand[finger.pip], _v2);
    this.lmToScreen(hand[finger.tip], _v3);
    _v5.subVectors(_v2, _v1);
    const pipLen = _v5.length();
    _v6.subVectors(_v3, _v1);
    const fingerLen = _v6.length();
    if (pipLen > 1e-6) _n1.copy(_v5).multiplyScalar(1 / pipLen);
    else if (fingerLen > 1e-6) _n1.copy(_v6).multiplyScalar(1 / fingerLen);
    else {
      this._ringGate(entry, 0);
      this._reportFingerConfidence(tracking, finger.key, 0);
      return false;
    }
    const axisLen = pipLen > 1e-6 ? pipLen : fingerLen;
    const inPlane = Math.hypot(_n1.x, _n1.y);
    const axisScore = clamp01((inPlane - PLACE.ringMinAxisView) / PLACE.ringAxisBand);

    // Stabilize finger axis under foreshortening by blending with last valid in-plane direction
    if (!entry.ringAxis) entry.ringAxis = { x: _n1.x, y: _n1.y };
    if (inPlane > 1e-6) {
      const reliability = clamp01((inPlane - PLACE.ringMinAxisView * 0.5) / (PLACE.ringAxisBand * 0.5));
      if (reliability >= 1) {
        entry.ringAxis.x = _n1.x / inPlane;
        entry.ringAxis.y = _n1.y / inPlane;
      } else if (reliability > 0) {
        const blendedX = entry.ringAxis.x + ((_n1.x / inPlane) - entry.ringAxis.x) * reliability;
        const blendedY = entry.ringAxis.y + ((_n1.y / inPlane) - entry.ringAxis.y) * reliability;
        const blendedLen = Math.hypot(blendedX, blendedY);
        if (blendedLen > 1e-6) {
          entry.ringAxis.x = blendedX / blendedLen;
          entry.ringAxis.y = blendedY / blendedLen;
        }
        _n1.x = entry.ringAxis.x;
        _n1.y = entry.ringAxis.y;
      } else {
        _n1.x = entry.ringAxis.x;
        _n1.y = entry.ringAxis.y;
      }
    } else {
      _n1.x = entry.ringAxis.x;
      _n1.y = entry.ringAxis.y;
    }

    // Accumulate rotation step continuously to preserve actual physical sweep direction
    if (!Number.isFinite(entry.ringAngleUnwrapped)) {
      entry.ringAngleUnwrapped = ringCanvasAngle(_n1);
    } else {
      const targetAngle = ringCanvasAngle(_n1);
      const step = angleDiffPeriodic(targetAngle, entry.ringAngleUnwrapped, Math.PI * 2);
      entry.ringAngleUnwrapped += step;
    }

    const fingerWidth = this._ringFingerWidth(entry, hand, finger);
    if (!(fingerWidth > 1e-4)) {
      this._ringGate(entry, 0);
      this._reportFingerConfidence(tracking, finger.key, 0);
      return false;
    }
    const tune = entry.tuning;
    // Opaque width should match fingerWidth * ringWidth (3D hole-fit fallback)
    const contentW = Math.max(entry.content?.w || 1, 1e-3);
    const scale = Math.max(
      (fingerWidth * PLACE.ringWidth) / contentW,
      PLACE.ringMinPx,
    ) * (tune.scale ?? 1);

    _n3.copy(frame.normal);
    if (_n3.z < 0) _n3.negate();
    _pos.copy(_v1)
      .addScaledVector(pipLen > 1e-6 ? _v5 : _v6, PLACE.ringSeat)
      .addScaledVector(_n3, -fingerWidth * 0.5 * PLACE.ringDepth);
    _pos.x += (tune.offsetX || 0) * fingerWidth;
    _pos.y += (tune.offsetY || 0) * fingerWidth;

    const clearance = Math.max(0.6, fingerClearance(hand, this, finger, _pos, fingerWidth));
    const steadiness = Math.max(0.6, this._fingerSteadiness(entry, hand, finger));
    const covered = this._handCoverage(_pos, tracking, hand);
    const rawConf = pick.quality * Math.max(0.5, axisScore) * clearance * steadiness * (1 - covered);
    const confidence = this._outOfFrame(_pos.x, _pos.y, scale)
      ? 0
      : Math.max(0.4, rawConf);
    this._reportFingerConfidence(tracking, finger.key, confidence);
    if (!this._ringGate(entry, confidence)) return false;

    const alpha = Math.min(1, Math.max(0.9, (confidence - RING_HIDE_LEVEL) / Math.max(RING_SHOW_LEVEL - RING_HIDE_LEVEL, 1e-6)));

    const angle = entry.ringAngleUnwrapped + ((tune.rotationOffset || 0) * Math.PI / 180);
    const inst = entry.instances[0];
    inst.smooth = SMOOTH_PROFILE.ring;
    // Ring band rotation follows natural 2*PI period
    inst.anglePeriod = Math.PI * 2;
    this.place(inst, _pos.x, _pos.y, scale, angle, true, alpha);

    if (jewelleryWrapDepth(entry)) {
      const mode = wrapFacingFromSignal(inst, -_dorsal.z, this._dtScale);
      inst.occlude = {
        rxNorm: (fingerWidth * 0.5 * PLACE.fingerMaskRad) / scale,
        ryNorm: (axisLen * PLACE.fingerMaskLen * 0.5) / scale,
        baseRot: Math.atan2(-_n1.y, _n1.x) + Math.PI / 2,
        baseRingAngle: angle,
      };
      inst._ringDebug = {
        axis: { x: _n1.x, y: _n1.y },
        dorsal: { x: _dorsal.x, y: _dorsal.y, z: _dorsal.z },
        seat: { x: _pos.x, y: _pos.y },
        signal: inst.ringFacingSignal,
        mode,
      };
    } else {
      inst.ringFacing = null;
      inst.ringFacingSignal = null;
      inst.occlude = null;
      inst._ringDebug = null;
    }
    return true;
  }

  _sameHand(a, b) {
    if (!a || !b) return false;
    let sum = 0;
    for (const i of SAME_HAND_POINTS) {
      if (!a[i] || !b[i]) return false;
      sum += this.dist2D(a[i], b[i]);
    }
    const span = Math.max(
      this.dist2D(a[HAND.indexMcp], a[HAND.pinkyMcp]),
      this.dist2D(b[HAND.indexMcp], b[HAND.pinkyMcp]),
      1e-3,
    );
    return sum / SAME_HAND_POINTS.length < span * SAME_HAND_LIMIT;
  }

  _wristFrame(hand) {
    const wrist = hand[HAND.wrist];
    const thumb = hand[HAND.thumbCmc];
    const index = hand[HAND.indexMcp];
    const pinky = hand[HAND.pinkyMcp];
    if (!wrist || !thumb || !index || !pinky) return null;
    this.lmToScreen(wrist, _wfWrist);
    this.lmToScreen(thumb, _wfThumb);
    this.lmToScreen(index, _wfIndex);
    this.lmToScreen(pinky, _wfPinky);
    _wfBase.addVectors(_wfIndex, _wfPinky).multiplyScalar(0.5);
    _wfAlong.subVectors(_wfBase, _wfWrist);
    if (_wfAlong.lengthSq() < 1e-9) return null;
    _wfAlong.normalize();
    _wfAcross.subVectors(_wfPinky, _wfThumb);
    _wfAcross.addScaledVector(_wfAlong, -_wfAlong.dot(_wfAcross));
    if (_wfAcross.lengthSq() < 1e-9) return null;
    _wfAcross.normalize();
    _wfNormal.crossVectors(_wfAcross, _wfAlong);
    if (_wfNormal.lengthSq() < 1e-9) return null;
    _wfNormal.normalize();
    return _wristFrameOut;
  }

  _wristWidth(entry, hand, slot, frame) {
    const primary = this.dist3D(hand[HAND.indexMcp], hand[HAND.pinkyMcp]);
    if (!(primary > 1e-4)) return 0;
    const base = this.dist3D(hand[HAND.thumbCmc], hand[HAND.pinkyMcp]);
    const length = this.dist3D(hand[HAND.wrist], hand[HAND.middleMcp]);
    const calKey = slot === 1 ? 'wristCalB' : 'wristCalA';
    const cal = entry[calKey] || (entry[calKey] = { base: 0, length: 0 });
    if (Math.abs(frame.normal.z) > WRIST_CAL_SQUARENESS && base > 1e-4 && length > 1e-4) {
      const k = adapt(WRIST_CAL_SMOOTH, this._dtScale);
      const toBase = primary / base;
      const toLength = primary / length;
      cal.base = cal.base > 0 ? cal.base + (toBase - cal.base) * k : toBase;
      cal.length = cal.length > 0 ? cal.length + (toLength - cal.length) * k : toLength;
    }
    const cues = [primary];
    if (cal.base > 0 && base > 1e-4) cues.push(base * cal.base);
    if (cal.length > 0 && length > 1e-4) cues.push(length * cal.length);
    cues.sort((a, b) => a - b);
    const target = cues[Math.floor(cues.length / 2)] * PLACE.wristFromPalm;
    const widthKey = slot === 1 ? 'wristWidthB' : 'wristWidthA';
    const prev = entry[widthKey] || 0;
    entry[widthKey] = prev > 0
      ? prev + (target - prev) * adapt(LIMB_WIDTH_SMOOTH, this._dtScale)
      : target;
    return entry[widthKey];
  }

  _forearmAxis(hand, tracking, out) {
    const pose = tracking?.pose;
    if (!pose || pose.length <= POSE.rightWrist) return 0;
    const handWrist = hand[HAND.wrist];
    if (!handWrist) return 0;
    let best = null;
    let bestDist = FOREARM_MATCH_RADIUS;
    for (const [elbowIdx, wristIdx] of FOREARM_PAIRS) {
      const elbow = pose[elbowIdx];
      const wrist = pose[wristIdx];
      if (!elbow || !wrist) continue;
      const seen = Math.min(elbow.visibility ?? 0, wrist.visibility ?? 0);
      if (seen < FOREARM_MIN_VISIBILITY) continue;
      const d = Math.hypot(wrist.x - handWrist.x, wrist.y - handWrist.y);
      if (d < bestDist) {
        bestDist = d;
        best = { elbow, wrist, seen };
      }
    }
    if (!best) return 0;
    this.lmToScreen(best.elbow, _v7);
    this.lmToScreen(best.wrist, _v6);
    out.subVectors(_v6, _v7);
    if (out.lengthSq() < 1e-9) return 0;
    out.normalize();
    return clamp01((best.seen - FOREARM_MIN_VISIBILITY) / 0.25)
      * clamp01(1 - bestDist / FOREARM_MATCH_RADIUS);
  }

  updateBangles(entry, tracking) {
    const hands = [tracking.leftHand, tracking.rightHand];
    const sides = [tracking.leftHandIsRight, tracking.rightHandIsRight];
    const misses = [tracking.leftHandMiss, tracking.rightHandMiss];
    let placed = 0;
    if (this._sameHand(hands[0], hands[1])) {
      const stale = (misses[0] ?? 0) >= (misses[1] ?? 0) ? 0 : 1;
      hands[stale] = null;
    }
    for (let i = 0; i < entry.instances.length; i++) {
      const hand = hands[i];
      const alpha = (hand && hand.length >= 21 && allInFrame(hand, WRIST_CHAIN))
        ? freshness(misses[i]) : 0;
      if (alpha <= 0.01) {
        this.place(entry.instances[i], 0, 0, 1, 0, false, 0);
        continue;
      }
      if (this._placeBangle(entry, entry.instances[i], hand, i, sides[i], alpha, tracking)) placed++;
    }
    if (!placed && entry.instances.length === 1) {
      const hand = tracking.primaryHand;
      if (!hand || hand.length < 21 || !allInFrame(hand, WRIST_CHAIN)) return false;
      const alpha = freshness(tracking.primaryHandMiss);
      if (alpha <= 0.01) return false;
      if (this._placeBangle(entry, entry.instances[0], hand, 0, tracking.primaryHandIsRight, alpha, tracking)) {
        placed++;
      }
    }
    return placed > 0;
  }

  _placeBangle(entry, inst, hand, slot, isRight, alpha = 1, tracking = null) {
    const frame = this._wristFrame(hand);
    if (!frame) {
      this.place(inst, 0, 0, 1, 0, false, 0);
      return false;
    }
    this.lmToScreen(hand[HAND.wrist], _v1);
    // Knuckles → wrist, toward the elbow (reference engine3d _placeBangle)
    _n1.copy(frame.along).negate();
    const trust = this._forearmAxis(hand, tracking || this._tracking, _v7);
    if (trust > 0) {
      _v7.negate();
      if (_v7.dot(_n1) > 0.2) _n1.lerp(_v7, trust * PLACE.forearmTrust).normalize();
    }

    _n2.copy(frame.normal);
    const curl = dorsalSideFromCurl(hand, this, _n2);
    const dorsalKey = slot === 1 ? 'dorsalSideB' : 'dorsalSideA';
    if (curl !== 0) entry[dorsalKey] = curl;
    else if (entry[dorsalKey] === undefined) entry[dorsalKey] = handSign(isRight);
    _n2.multiplyScalar(entry[dorsalKey]);
    _n2.addScaledVector(_n1, -_n1.dot(_n2));
    if (_n2.lengthSq() < 1e-9) {
      this.place(inst, 0, 0, 1, 0, false, 0);
      return false;
    }
    _n2.normalize();
    _n3.copy(_n2);
    if (_n3.z < 0) _n3.negate();

    const palmWidth = this.dist3D(hand[HAND.indexMcp], hand[HAND.pinkyMcp]);
    const wristWidth = this._wristWidth(entry, hand, slot, frame);
    if (!(palmWidth > 1e-4) || !(wristWidth > 1e-4)) {
      this.place(inst, 0, 0, 1, 0, false, 0);
      return false;
    }
    const tune = entry.tuning;
    const contentW = Math.max(entry.content?.w || 1, 1e-3);
    const scale = Math.max(
      (wristWidth * PLACE.bangleWidth) / contentW,
      PLACE.bangleMinPx,
    ) * (tune.scale ?? 1);
    const wristRadius = wristWidth * 0.5;
    const holeRadius = wristRadius * PLACE.bangleHoleFit;
    const slack = Math.max(holeRadius - wristRadius, 0);

    _pos.copy(_v1)
      .addScaledVector(_n1, wristWidth * PLACE.bangleSlide)
      .addScaledVector(_n3, -wristRadius * PLACE.bangleDepth);
    const sag = slack * PLACE.bangleSag;
    _v6.set(0, -1, 0).addScaledVector(_n1, _n1.y);
    if (_v6.lengthSq() > 1e-9) {
      _v6.normalize();
      _pos.addScaledVector(_v6, sag);
    }
    _pos.x += (tune.offsetX || 0) * wristWidth;
    _pos.y += (tune.offsetY || 0) * wristWidth;

    const visible = alpha * (1 - this._handCoverage(_pos, this._tracking, hand));
    if (this._outOfFrame(_pos.x, _pos.y, scale) || visible <= 0.01) {
      this.place(inst, _pos.x, _pos.y, scale, 0, false, 0);
      return false;
    }
    // PNG is a wide horizontal band — same as rings: long axis stays around the wrist,
    // not along the forearm. (+π/2 made every bangle stand upright.)
    const angle = screenAngleFromAxis(_n1) + ((tune.rotationOffset || 0) * Math.PI / 180);
    inst.smooth = SMOOTH_PROFILE.bangles;
    this.place(inst, _pos.x, _pos.y, scale, angle, true, visible);

    if (jewelleryWrapDepth(entry)) {
      // _n2 = dorsal / outside of the hand. +z toward camera → front.png on the outside.
      wrapFacingFromSignal(inst, _n2.z, this._dtScale);
      const maskLen = palmWidth * (PLACE.forearmMaskToHand + PLACE.forearmMaskToElbow);
      inst.occlude = {
        rxNorm: (wristRadius * PLACE.wristDepthRatio) / scale,
        ryNorm: (maskLen * 0.5) / scale,
        baseRot: Math.atan2(-_n1.y, _n1.x) + Math.PI / 2,
        baseRingAngle: angle,
      };
    } else {
      inst.ringFacing = null;
      inst.ringFacingSignal = null;
      inst.occlude = null;
    }
    return true;
  }

  update(tracking) {
    if (!tracking) tracking = {};
    const now = performance.now();
    const elapsed = this._lastFrameTime ? (now - this._lastFrameTime) / 1000 : 1 / 60;
    this._lastFrameTime = now;
    this._dtScale = Math.min(Math.max(elapsed * 60, 0.25), 3);
    this._faceMiss = tracking.faceMiss ?? 0;
    this._tracking = tracking;

    this._updateHeadPose(tracking.face);
    this._updateTorsoPose(tracking.pose);

    for (const [, entry] of this.activeItems) {
      let ok = false;
      try {
        if (entry.category === 'necklace') ok = this.updateNecklace(entry, tracking);
        else if (entry.category === 'earring') ok = this.updateEarrings(entry, tracking);
        else if (entry.category === 'ring') ok = this.updateRing(entry, tracking);
        else if (entry.category === 'bangles') ok = this.updateBangles(entry, tracking);
      } catch (err) {
        console.error(`[Engine2D] "${entry.id}" placement failed`, err);
        ok = false;
      }
      if (!ok) this.hide(entry);
    }
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    const feed = this.video;

    for (const [, entry] of this.activeItems) {
      const wrap = entry.wrap && entry.imgFront && entry.imgBack;
      if (!wrap && !entry.img) continue;
      const content = entry.content || { x0: 0, y0: 0, x1: 1, y1: 1, cx: 0.5, cy: 0.5, w: 1, h: 1 };
      const aspect = entry.naturalWidth / Math.max(entry.naturalHeight, 1);
      const anchor = entry.tuning.anchor || 'center';
      const fitAxis = entry.tuning.fitAxis || 'x';
      const wrapDepth = jewelleryWrapDepth(entry);

      for (const inst of entry.instances) {
        if (!(inst.opacity > 0.02) || !inst.state.initialized) continue;
        const s = inst.state;
        let drawW;
        let drawH;
        if (fitAxis === 'y') {
          drawH = s.scale;
          drawW = drawH * aspect;
        } else {
          drawW = s.scale;
          drawH = drawW / aspect;
        }
        const cx = s.x + this.width / 2;
        const cy = this.height / 2 - s.y;
        let ox;
        let oy;
        if (anchor === 'top') {
          ox = -drawW * content.cx;
          oy = -drawH * content.y0;
        } else {
          ox = -drawW * content.cx;
          oy = -drawH * content.cy;
        }

        const drawTransform = (img) => {
          this._drawLayer(ctx, img, inst.opacity, cx, cy, s.angle, ox, oy, drawW, drawH);
        };

        if (wrap) {
          if (wrapDepth) {
            const frontOnTop = inst.ringFacing !== 'back';
            const rear = frontOnTop ? entry.imgBack : entry.imgFront;
            const fore = frontOnTop ? entry.imgFront : entry.imgBack;
            drawTransform(rear);
            this._stampLimb(ctx, this._resolveRingOcclude(inst, s), feed, true);
            drawTransform(fore);
            if (this.showRingDebug) this._drawRingDebug(ctx, inst, cx, cy);
          } else {
            drawTransform(entry.imgBack);
            drawTransform(entry.imgFront);
          }
        } else {
          drawTransform(entry.img);
        }

        if (this.showAnchors) {
          ctx.save();
          ctx.fillStyle = '#ffcc00';
          ctx.beginPath();
          ctx.arc(cx, cy, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
    }
  }

  _drawRingDebug(ctx, inst, cx, cy) {
    const dbg = inst._ringDebug;
    if (!dbg) return;
    ctx.save();
    ctx.strokeStyle = dbg.mode === 'front' ? '#44ff88' : '#ff8844';
    ctx.fillStyle = dbg.mode === 'front' ? '#44ff88' : '#ff8844';
    ctx.lineWidth = 2;
    ctx.font = '12px monospace';
    ctx.fillText(`${dbg.mode.toUpperCase()} z=${dbg.signal.toFixed(3)}`, cx + 12, cy - 12);
    if (dbg.axis) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dbg.axis.x * 40, cy - dbg.axis.y * 40);
      ctx.stroke();
    }
    if (dbg.dorsal) {
      ctx.strokeStyle = '#88ccff';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + dbg.dorsal.x * 40, cy - dbg.dorsal.y * 40);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Finger stamp aligned to smoothed ring pose — never inherits ring canvas transforms. */
  _resolveRingOcclude(inst, s) {
    const oc = inst.occlude;
    if (!oc) return null;
    const rx = oc.rxNorm * s.scale;
    const ry = oc.ryNorm * s.scale;
    if (!(rx > 1) || !(ry > 1)) return null;
    return {
      cx: s.x + this.width / 2,
      cy: this.height / 2 - s.y,
      rx,
      ry,
      rot: oc.baseRot + (s.angle - oc.baseRingAngle),
    };
  }

  _stampLimb(ctx, occlude, video, onlyOverCanvas = false) {
    if (!occlude || !video || video.readyState < 2) return;
    if (!(occlude.rx > 1) || !(occlude.ry > 1)) return;
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(occlude.cx, occlude.cy, occlude.rx, occlude.ry, occlude.rot, 0, Math.PI * 2);
    ctx.clip();
    if (onlyOverCanvas) ctx.globalCompositeOperation = 'source-atop';
    ctx.translate(this.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, this.offX, this.offY, this.dispW, this.dispH);
    ctx.restore();
  }

  _drawLayer(ctx, img, alpha, cx, cy, angle, ox, oy, drawW, drawH) {
    if (!img) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.drawImage(img, ox, oy, drawW, drawH);
    ctx.restore();
  }

  requiredTrackers() {
    let face = false;
    let hands = false;
    let pose = false;
    let handCount = 1;
    for (const [, entry] of this.activeItems) {
      if (entry.category === 'necklace' || entry.category === 'earring') {
        face = true;
        // Do NOT attach Hands here — FaceMesh must run alone for a stable lock.
      }
      // Necklace placement works from the head frame; Pose is optional overhead.
      if (entry.category === 'ring' || entry.category === 'bangles') {
        hands = true;
        handCount = 2;
      }
      if (entry.category === 'bangles') pose = true;
    }
    return { face, hands, pose, handCount, precise: false };
  }

  captureComposite(video) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.width;
    const h = this.height;
    const composite = document.createElement('canvas');
    composite.width = Math.max(1, Math.round(w * dpr));
    composite.height = Math.max(1, Math.round(h * dpr));
    const ctx = composite.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.scale(dpr, dpr);
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, this.offX, this.offY, this.dispW, this.dispH);
    }
    ctx.restore();
    ctx.drawImage(this.canvas, 0, 0, w, h);
    return composite;
  }

  getTuning(id) {
    return this.activeItems.get(id)?.tuning ?? null;
  }

  updateTuning(id, patch) {
    const entry = this.activeItems.get(id);
    if (!entry) return null;
    Object.assign(entry.tuning, patch);
    MODEL_TUNING[entry.folder] = { ...(MODEL_TUNING[entry.folder] || {}), ...patch };
    saveTuning();
    return entry.tuning;
  }
}

function loadImageElement(url, revision = '') {
  const bustUrl = (revision && !url.startsWith('blob:') && !url.startsWith('data:'))
    ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(revision)}`
    : url;

  // Fetch with no-store so replaced jewellery.png (e.g. manual necklace upload) is never stale
  if (revision && !url.startsWith('blob:') && !url.startsWith('data:')) {
    return fetch(bustUrl, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      })
      .then((blob) => new Promise((resolve, reject) => {
        const objUrl = URL.createObjectURL(blob);
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          URL.revokeObjectURL(objUrl);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(objUrl);
          reject(new Error(`Could not decode image: ${url}`));
        };
        img.src = objUrl;
      }))
      .catch(() => loadImageElementDirect(bustUrl));
  }
  return loadImageElementDirect(bustUrl);
}

function loadImageElementDirect(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load image: ${url}`));
    img.src = url;
  });
}

// --- catalogue discovery (PNG/JPG instead of 3D models) ---

export const CATEGORY_ORDER = ['necklace', 'earring', 'ring', 'bangles'];
export const CATEGORY_LABELS = {
  necklace: 'Necklace',
  earring: 'Earrings',
  ring: 'Ring',
  bangles: 'Bangles',
};

export const FOLDER_CATALOG = [
  'necklace-gold', 'necklace-diamond',
  'earring-gold', 'earring-diamond', 'earring-hoop',
  'ring-band', 'ring-solitaire',
  'bangles-gold', 'bangles-diamond',
];

/** Built-in fallback when objects/index.json cannot be fetched (e.g. file://). */
export const CATALOGUE_MANIFEST = [
  { folder: 'necklace-gold', model: 'jewellery.png', image: 'demo.jpg' },
  { folder: 'necklace-diamond', model: 'jewellery.png', image: 'demo.jpg' },
  { folder: 'earring-gold', model: 'jewellery.png', image: 'demo.jpg' },
  { folder: 'earring-diamond', model: 'jewellery.png', image: 'demo.jpg' },
  { folder: 'earring-hoop', model: 'jewellery.png', image: 'demo.jpg' },
  { folder: 'ring-band', model: 'jewellery.png', image: 'demo.jpg', front: 'front.png', back: 'back.png' },
  { folder: 'ring-solitaire', model: 'jewellery.png', image: 'demo.jpg', front: 'front.png', back: 'back.png' },
  { folder: 'bangles-gold', model: 'jewellery.png', image: 'demo.jpg' },
  { folder: 'bangles-diamond', model: 'jewellery.png', image: 'demo.jpg' },
];

const DEFAULT_MANIFEST = CATALOGUE_MANIFEST;

/**
 * Some tunnels/proxies (e.g. ngrok) occasionally leave a HEAD/Range
 * request pending forever instead of erroring. Catalogue discovery
 * awaits many of these in parallel (Promise.all) — a single stuck
 * request would silently hang the whole page with no console error.
 * Force every probe request to give up after a short timeout.
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fileExists(url) {
  try {
    const head = await fetchWithTimeout(url, { method: 'HEAD', cache: 'no-cache' });
    if (head.ok) return true;
  } catch { /* try GET */ }
  try {
    const res = await fetchWithTimeout(url, {
      method: 'GET',
      cache: 'no-cache',
      headers: { Range: 'bytes=0-0' },
    });
    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

/** Revision token from file size/date — busts browser cache when jewellery.png is replaced. */
async function assetRevision(folder, file) {
  if (!file) return '';
  const url = `${objectsBase()}${folder}/${file}`;
  try {
    const res = await fetchWithTimeout(url, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) return '';
    return [
      res.headers.get('content-length') || '',
      res.headers.get('last-modified') || '',
      res.headers.get('etag') || '',
    ].join('|');
  } catch {
    return '';
  }
}

async function resolveImageFile(folder, known) {
  if (known) return known;
  const base = objectsBase();
  for (const name of IMAGE_CANDIDATES) {
    if (await fileExists(`${base}${folder}/${name}`)) return name;
  }
  for (const ext of IMAGE_EXTENSIONS) {
    const name = `${folder}.${ext}`;
    if (await fileExists(`${base}${folder}/${name}`)) return name;
  }
  return null;
}

// Homepage thumbnail prioritizes demo.* over jewellery.png
async function resolveDemoImage(folder, knownDemo) {
  const base = objectsBase();
  const fallbacks = ['demo.jpg', 'demo.jpeg', 'demo.png', 'demo.webp', 'preview.jpg', 'preview.png'];
  const candidates = knownDemo
    ? [knownDemo, ...fallbacks.filter((n) => n !== knownDemo)]
    : fallbacks;
  for (const name of candidates) {
    if (await fileExists(`${base}${folder}/${name}`)) {
      return `${base}${folder}/${name}`;
    }
  }
  return null;
}

async function resolveNamedFile(folder, known, candidates) {
  if (known) return known;
  const base = objectsBase();
  for (const name of candidates) {
    if (await fileExists(`${base}${folder}/${name}`)) return name;
  }
  return null;
}

function manifestPreviewUrl(folder, demo, model, front) {
  const base = objectsBase();
  if (demo) return `${base}${folder}/${demo}`;
  if (model) return `${base}${folder}/${model}`;
  if (front) return `${base}${folder}/${front}`;
  return null;
}

function manifestDefaults(folder) {
  return CATALOGUE_MANIFEST.find((m) => m.folder === folder) || null;
}

// Merge existing index.json entries with CATALOGUE_MANIFEST defaults
function mergeManifestEntries(entries) {
  return (entries || [])
    .filter((entry) => entry?.folder)
    .map((entry) => {
      const fb = manifestDefaults(entry.folder);
      return {
        ...entry,
        model: entry.model || fb?.model,
        image: entry.image || fb?.image,
        front: entry.front || fb?.front,
        back: entry.back || fb?.back,
      };
    });
}

/** Instant catalogue row from manifest — no network (homepage must not wait on HEAD). */
function probeFolderSync(folder, knownImage, knownDemo, knownFront, knownBack) {
  const fb = manifestDefaults(folder);
  const imageFile = knownImage || fb?.model || null;
  const frontFile = knownFront || fb?.front || null;
  const backFile = knownBack || fb?.back || null;
  const demoFile = knownDemo || fb?.image || null;
  const available = !!(imageFile || (frontFile && backFile));
  const preview = manifestPreviewUrl(folder, demoFile, imageFile, frontFile);
  return {
    folder,
    modelFile: imageFile || frontFile || null,
    demoFile: demoFile || 'demo.jpg',
    available,
    image: preview,
    frontFile,
    backFile,
    modelRevision: '',
    frontRevision: '',
    backRevision: '',
    demoRevision: '',
  };
}

export function buildCatalogueEntries(entries) {
  const items = [];
  for (const entry of entries) {
    const category = normaliseCategory(entry.category) || folderToCategory(entry.folder);
    if (!category) {
      console.warn(`[Catalogue] "${entry.folder}" has no supported category — skipping.`);
      continue;
    }
    const found = probeFolderSync(
      entry.folder,
      entry.model,
      entry.image || undefined,
      entry.front,
      entry.back,
    );
    items.push({
      id: entry.folder,
      folder: entry.folder,
      category,
      label: entry.label || folderToLabel(entry.folder, category),
      modelFile: found.modelFile,
      demoFile: found.demoFile,
      frontFile: found.frontFile || entry.front || null,
      backFile: found.backFile || entry.back || null,
      modelRevision: '',
      frontRevision: '',
      backRevision: '',
      demoRevision: '',
      available: found.available,
      image: found.image || null,
    });
  }
  return items;
}

/**
 * Some tunnels (e.g. ngrok's free tier) reject/502 a handful of
 * requests once too many land concurrently. Catalogue discovery can
 * fan out 30+ HEAD requests at once (several per item); cap how many
 * run at the same time instead of firing them all together.
 */
async function runWithConcurrencyLimit(items, limit, worker) {
  let cursor = 0;
  async function runNext() {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, runNext);
  await Promise.all(workers);
}

export async function refreshCatalogueRevisions(items) {
  await runWithConcurrencyLimit(items, 4, async (item) => {
    if (!item.available) return;
    const [modelRevision, frontRevision, backRevision, demoRevision] = await Promise.all([
      assetRevision(item.folder, item.modelFile),
      assetRevision(item.folder, item.frontFile),
      assetRevision(item.folder, item.backFile),
      assetRevision(item.folder, item.demoFile || 'demo.jpg'),
    ]);
    item.modelRevision = modelRevision;
    item.frontRevision = frontRevision;
    item.backRevision = backRevision;
    item.demoRevision = demoRevision;

    // assetRevision() comes back empty when the HEAD/Range probe fails —
    // i.e. the file named in index.json doesn't actually exist on disk
    // (folder deleted by hand, asset removed, etc). Demote to unavailable
    // instead of leaving a broken "no image" card on the homepage.
    const hasModel = item.modelFile && modelRevision;
    const hasWrap = item.frontFile && item.backFile && frontRevision && backRevision;
    if (!hasModel && !hasWrap) {
      item.available = false;
    }
  });
}

export async function probeFolder(folder, knownImage, knownDemo, knownFront, knownBack) {
  const sync = probeFolderSync(folder, knownImage, knownDemo, knownFront, knownBack);
  const [modelRevision, frontRevision, backRevision] = await Promise.all([
    assetRevision(folder, sync.modelFile),
    assetRevision(folder, sync.frontFile),
    assetRevision(folder, sync.backFile),
  ]);
  return { ...sync, modelRevision, frontRevision, backRevision };
}

async function readManifest() {
  const parseItems = (raw) => {
    if (!raw || !raw.length) return null;
    const entries = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        if (item.trim()) entries.push({ folder: item.trim() });
      } else if (item && typeof item.folder === 'string' && item.folder.trim()) {
        entries.push({
          folder: item.folder.trim(),
          category: typeof item.category === 'string' ? item.category.trim() : undefined,
          label: typeof item.label === 'string' ? item.label.trim() : undefined,
          model: typeof item.model === 'string' && item.model.trim() ? item.model.trim() : undefined,
          front: typeof item.front === 'string' && item.front.trim() ? item.front.trim() : undefined,
          back: typeof item.back === 'string' && item.back.trim() ? item.back.trim() : undefined,
          image: typeof item.image === 'string' && item.image.trim()
            ? item.image.trim()
            : (typeof item.demo === 'string' && item.demo.trim() ? item.demo.trim() : undefined),
        });
      }
    }
    return entries.length ? entries : null;
  };

  try {
    const res = await fetchWithTimeout(`${objectsBase()}index.json`, { cache: 'no-cache' });
    if (!res.ok) return DEFAULT_MANIFEST;
    const data = await res.json();
    const raw = Array.isArray(data) ? data : (Array.isArray(data?.items) ? data.items : null);
    return parseItems(raw) || DEFAULT_MANIFEST;
  } catch {
    return DEFAULT_MANIFEST;
  }
}

export async function discoverItems() {
  let entries;
  try {
    entries = await readManifest();
  } catch {
    entries = CATALOGUE_MANIFEST;
  }
  entries = mergeManifestEntries(entries);
  const items = buildCatalogueEntries(entries);
  try {
    await refreshCatalogueRevisions(items);
  } catch (err) {
    console.warn('[Catalogue] revision probe failed', err);
  }
  return items;
}

const CATEGORY_ALIASES = {
  bracelet: 'bangles', bracelets: 'bangles', bangle: 'bangles', kada: 'bangles',
  chain: 'necklace', pendant: 'necklace',
  studs: 'earring', stud: 'earring', earrings: 'earring',
  rings: 'ring',
};

function normaliseCategory(v) {
  if (!v) return null;
  const key = String(v).toLowerCase().trim();
  if (CATEGORY_ORDER.includes(key)) return key;
  return CATEGORY_ALIASES[key] || null;
}

function folderToCategory(folder) {
  const v = String(folder).toLowerCase().replace(/[_\s]+/g, '-');
  for (const cat of CATEGORY_ORDER) {
    if (v === cat || v.startsWith(`${cat}-`) || v.endsWith(`-${cat}`) || v.includes(`-${cat}-`)) return cat;
  }
  for (const [alias, cat] of Object.entries(CATEGORY_ALIASES)) {
    if (v.includes(alias)) return cat;
  }
  return null;
}

function folderToLabel(folder, cat) {
  const joined = String(folder).replace(/[_-]+/g, ' ').trim();
  const words = joined.split(/\s+/).filter(Boolean);
  const drop = new Set([cat, ...(Object.keys(CATEGORY_ALIASES).filter((a) => CATEGORY_ALIASES[a] === cat)), 'jewellery', 'jewelry']);
  const rest = words.filter((w) => !drop.has(w.toLowerCase()));
  const title = rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  const suffix = CATEGORY_LABELS[cat] || '';
  return title ? `${title} ${suffix}`.trim() : suffix;
}
