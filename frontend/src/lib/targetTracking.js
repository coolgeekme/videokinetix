/**
 * Target identity tracking for pose capture.
 *
 * WHY THIS EXISTS
 * ---------------
 * The original resolver picked, on every frame, the detected pose whose hip
 * centre was nearest the previous frame's hip centre, and adopted it when it was
 * within a fixed distance threshold. Two properties made that fragile:
 *
 *   1. When only ONE pose was detected it was adopted unconditionally, whatever
 *      the distance.
 *   2. Adopting a pose overwrote the anchor with that pose's position — so the
 *      anchor *was* the identity. One bad adoption permanently relocated the
 *      lock, and the correct subject could never win it back.
 *
 * Underwater swimming breaks both. The water surface is a mirror. Measured on
 * real footage (BlazePose full, numPoses 5, conf 0.3 — see
 * tests/fixtures/README.md for the capture recipe):
 *
 *   - the detector's single-pose output alternates between the swimmer and its
 *     mirror image frame to frame: 45 of 163 frames reported only the
 *     reflection, 82 only the swimmer, 10 both, 26 neither;
 *   - swimmer and reflection are separated by dy 0.55-0.67 while the swimmer's
 *     own frame-to-frame motion step is 0.023 median / 0.098 p90;
 *   - MediaPipe re-interprets a vertically flipped person as an *upright* person,
 *     so the reflection's joint geometry is NOT anti-correlated with the
 *     swimmer's (measured correlation +0.74, -0.32, +0.59 ... i.e. unreliable).
 *     A "mirror geometry" test is therefore unsound and is not used here.
 *
 * Replaying the old rule over that footage: 49 of 136 adopted frames (36%) were
 * the reflection. Every stroke count, catch angle and body-roll figure derived
 * from those frames was computed from the mirror image.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 *   - The anchor is never overwritten by a detection. It coasts on a
 *     conservative velocity estimate; detections only ever CONFIRM identity.
 *   - Adoption is gated by a motion-scaled radius around the PREDICTED anchor, so
 *     a pose appearing far away is not adopted even when it is the only one on
 *     screen. The gate stays well below the measured swimmer↔reflection
 *     separation, which is what keeps the mirror image out.
 *   - Velocity is clamped hard and the prediction step is capped, because a
 *     single noisy detection would otherwise poison the prediction and starve the
 *     tracker of confirmations (a lock-loss spiral).
 *   - Optional waterline: when the caller knows where the surface is, poses on
 *     the reflective side are excluded outright — and only then is the gate
 *     allowed to widen after a long dropout (relaxing is safe because the wrong
 *     side is already excluded). Without a waterline the tracker refuses to guess.
 *   - Mirror-image pose pairs are reported so the UI can prompt the user to mark
 *     the water line. That is a *prompt*, not a silent heuristic.
 *
 * Everything here is pure so the resolver can be replayed against recorded
 * landmark dumps of real footage — see tests/targetTracking.test.mjs.
 */

/** Joint subset used for scale/visibility summaries. */
export const JOINT_SAMPLE = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

/** Joints that must be reasonably visible for a pose to count as "complete". */
const KEY_JOINTS = [0, 11, 12, 23, 24, 25, 26, 27, 28];

export const DEFAULT_TRACKING = {
  // Gate: a detection may only be adopted inside this radius of the predicted
  // anchor (normalized image units). Sized from measurement: the swimmer's own
  // motion step is 0.023 median / 0.098 p90, and the swimmer↔reflection offset
  // is 0.55+, so anything in the 0.1-0.25 band separates them cleanly.
  baseGate: 0.1,
  gatePerSecond: 0.22,
  maxGate: 0.22,
  runningGateScale: 1.3,

  // Velocity coasting (conservative on purpose).
  velocityAlpha: 0.25,
  maxSpeed: 0.5, // normalized units / second
  predictionCapSec: 0.35, // never extrapolate further than this
  // Unconfirmed velocity decays while the subject is missing, so a coasting
  // anchor settles instead of extrapolating into a reflection that sits a fixed
  // offset away.
  coastDecay: 0.8,

  // Recovery after a dropout. Only used when a waterline is known, because only
  // then is widening the gate provably safe (the reflective side is excluded).
  recoveryAfterMs: 500,
  recoveryGateFactor: 2.5,
  maxRecoveryGate: 0.5,

  lostAfterMs: 2500,
  waterlineSlack: 0.02,

  // Tie-breaks among in-gate candidates.
  visibilityWeight: 0.35,
  completenessWeight: 0.25,

  // Tap selection.
  tapRadius: 0.4,

  // Mirror-pair reporting (advisory UI hint only).
  mirrorMaxDx: 0.15,
  mirrorMinDy: 0.25,
  mirrorMaxHeightRatio: 2.2,
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

/* -------------------------------- geometry -------------------------------- */

export function hipCenter(lm) {
  const lh = lm?.[23];
  const rh = lm?.[24];
  if (!lh || !rh) return null;
  return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
}

function bboxCenter(lm) {
  let x = 0;
  let y = 0;
  let n = 0;
  for (const p of lm || []) {
    if (!p) continue;
    x += p.x;
    y += p.y;
    n += 1;
  }
  return n ? { x: x / n, y: y / n } : null;
}

/** Per-pose summary used by the tracker and by the selection UI. */
export function poseStats(lm, index = 0) {
  const center = hipCenter(lm) || bboxCenter(lm) || { x: 0.5, y: 0.5 };
  let visSum = 0;
  let visN = 0;
  let present = 0;
  for (const p of lm || []) {
    if (!p) continue;
    visSum += typeof p.visibility === "number" ? p.visibility : (p.v ?? 1);
    visN += 1;
  }
  for (const k of KEY_JOINTS) {
    const p = lm?.[k];
    if (p && (p.visibility ?? p.v ?? 1) > 0.3) present += 1;
  }
  const ys = (lm || []).filter(Boolean).map((p) => p.y);
  const top = ys.length ? Math.min(...ys) : center.y;
  const bot = ys.length ? Math.max(...ys) : center.y;
  return {
    index,
    center,
    hip: hipCenter(lm),
    meanVis: visN ? visSum / visN : 0,
    complete: present / KEY_JOINTS.length,
    top,
    bot,
    height: Math.max(bot - top, 0.02),
  };
}

/* ------------------------------- tracker state ----------------------------- */

export function createTrackingState() {
  return {
    anchor: null, // {x,y} where the subject is believed to be
    vel: { x: 0, y: 0 }, // normalized units / second
    t: 0, // timestamp of the last ACCEPTED detection (never advanced on a miss)
    misses: 0,
    missSince: null, // ms when the subject stopped being confirmed
    accepted: 0,
    side: null, // 'reflective' | 'submerged' — which side of the waterline we locked
  };
}

/** Lock the tracker onto an explicit pose (tap-to-select). */
export function primeTarget(state, lm, nowMs, waterline = null) {
  const center = hipCenter(lm) || bboxCenter(lm);
  return {
    ...createTrackingState(),
    anchor: center,
    t: nowMs,
    side:
      typeof waterline === "number" && center
        ? center.y < waterline
          ? "reflective"
          : "submerged"
        : null,
    accepted: (state?.accepted || 0) + 1,
  };
}

export function predictAnchor(state, nowMs) {
  if (!state?.anchor) return null;
  const dt = clamp((nowMs - (state.t || nowMs)) / 1000, 0, DEFAULT_TRACKING.predictionCapSec);
  return {
    x: clamp(state.anchor.x + state.vel.x * dt, 0, 1),
    y: clamp(state.anchor.y + state.vel.y * dt, 0, 1),
  };
}

/* --------------------------------- resolver -------------------------------- */

/**
 * Resolve which detected pose is the tracked subject this frame.
 *
 * @param {object}   args
 * @param {Array}    args.poses       landmark arrays from the pose runtime
 * @param {object}   args.state       state from createTrackingState()/previous call
 * @param {number}   args.nowMs       monotonic timestamp (performance.now())
 * @param {object}   [args.config]    overrides for DEFAULT_TRACKING
 * @param {number}   [args.waterline] normalized y of the water surface, if known
 * @param {string}   [args.reflectionSide] 'above' (default) | 'below'
 * @param {boolean}  [args.running]   recording in progress (relaxes the gate)
 * @returns {{targetIdx:number, state:object, status:string, gate:number,
 *            predicted:object|null, candidates:Array, reflectionInFrame:boolean}}
 */
export function resolveTarget({
  poses = [],
  state = createTrackingState(),
  nowMs = 0,
  config = {},
  waterline = null,
  reflectionSide = "above",
  running = false,
}) {
  const cfg = { ...DEFAULT_TRACKING, ...config };
  const st = {
    ...state,
    anchor: state.anchor ? { ...state.anchor } : null,
    vel: { ...(state.vel || { x: 0, y: 0 }) },
  };

  if (!st.anchor) {
    return {
      targetIdx: -1,
      state: st,
      status: "unlocked",
      gate: 0,
      predicted: null,
      candidates: poses.map((lm, i) => poseStats(lm, i)),
      reflectionInFrame: false,
    };
  }

  // Elapsed time since the last CONFIRMED detection. This (not the frame
  // interval) is what opens the gate during a dropout.
  const dt = clamp((nowMs - (st.t || nowMs)) / 1000, 0, 5);
  const gate =
    Math.min(cfg.baseGate + cfg.gatePerSecond * dt, cfg.maxGate) *
    (running ? cfg.runningGateScale : 1);
  const predicted = predictAnchor(st, nowMs);

  const hasWaterline = typeof waterline === "number";
  const isReflective = (s) =>
    hasWaterline &&
    (reflectionSide === "below"
      ? s.center.y > waterline + cfg.waterlineSlack
      : s.center.y < waterline - cfg.waterlineSlack);

  const candidates = poses.map((lm, i) => {
    const s = poseStats(lm, i);
    s.distance = Math.hypot(s.center.x - predicted.x, s.center.y - predicted.y);
    s.reflective = !!isReflective(s);
    return s;
  });
  const reflectionInFrame = candidates.some((c) => c.reflective);

  const score = (s) =>
    -s.distance / Math.max(gate, 1e-6) + cfg.visibilityWeight * s.meanVis + cfg.completenessWeight * s.complete;

  let eligible = candidates.filter((c) => c.distance <= gate && !c.reflective);
  let status = "tracking";
  let recovered = false;

  if (!eligible.length) {
    st.misses += 1;
    if (st.missSince == null) st.missSince = nowMs;

    // Recovery: only safe when the reflective side is excluded, so only offered
    // once a waterline is set. Without it, keep the identity and wait.
    if (hasWaterline && nowMs - st.missSince >= cfg.recoveryAfterMs) {
      const recGate = Math.min(gate * cfg.recoveryGateFactor, cfg.maxRecoveryGate);
      const near = candidates
        .filter((c) => !c.reflective && c.distance <= recGate)
        .sort((a, b) => a.distance - b.distance);
      if (near.length) {
        eligible = [near[0]];
        recovered = true;
        status = "recovered";
      }
    }

    if (!eligible.length) {
      // Nothing adoptable: hold the identity, coast the anchor.
      st.t = state.t || nowMs; // do NOT stamp t — the gate must keep opening
      st.anchor = predicted;
      st.vel = { x: st.vel.x * cfg.coastDecay, y: st.vel.y * cfg.coastDecay };
      return {
        targetIdx: -1,
        state: st,
        status: nowMs - st.missSince > cfg.lostAfterMs ? "lost" : "coasting",
        gate: recovered ? gate * cfg.recoveryGateFactor : gate,
        predicted,
        candidates,
        reflectionInFrame,
      };
    }
  }

  const best = eligible.reduce((a, b) => (score(b) > score(a) ? b : a));
  const center = best.center;
  // Velocity from the LAST ACCEPTED position to this one, over the true elapsed
  // time, clamped — a single noisy measurement must not poison the prediction.
  const sdt = Math.max((nowMs - (st.t || nowMs)) / 1000, 1 / 60);
  let vx = (center.x - st.anchor.x) / sdt;
  let vy = (center.y - st.anchor.y) / sdt;
  const speed = Math.hypot(vx, vy);
  if (speed > cfg.maxSpeed) {
    vx = (vx / speed) * cfg.maxSpeed;
    vy = (vy / speed) * cfg.maxSpeed;
  }
  st.vel = {
    x: st.vel.x * (1 - cfg.velocityAlpha) + vx * cfg.velocityAlpha,
    y: st.vel.y * (1 - cfg.velocityAlpha) + vy * cfg.velocityAlpha,
  };
  st.anchor = { ...center };
  st.t = nowMs;
  st.misses = 0;
  st.missSince = null;
  st.accepted += 1;
  if (hasWaterline) st.side = center.y < waterline ? "reflective" : "submerged";

  return {
    targetIdx: best.index,
    state: st,
    status,
    gate,
    predicted,
    candidates,
    reflectionInFrame,
  };
}

/* ---------------------------- selection-time helpers ---------------------- */

/**
 * Rank poses for a user tap, best first. Confidence-aware, and reports mirror
 * pairs so the UI can tell the user when the tap was ambiguous.
 */
export function rankSelectionCandidates({ poses = [], point, waterline = null, config = {} }) {
  const cfg = { ...DEFAULT_TRACKING, ...config };
  const stats = poses.map((lm, i) => poseStats(lm, i));
  const scored = stats.map((s) => {
    const d = point ? Math.hypot(s.center.x - point.x, s.center.y - point.y) : 0;
    const onReflective =
      typeof waterline === "number" && s.center.y < waterline - cfg.waterlineSlack ? 1 : 0;
    return {
      index: s.index,
      stats: s,
      distance: d,
      score:
        -d +
        cfg.visibilityWeight * s.meanVis +
        cfg.completenessWeight * s.complete -
        0.6 * onReflective,
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const pairs = detectMirrorPairs(stats, cfg);
  const nearest = scored[0];
  const runnerUp = scored[1];
  return {
    candidates: scored,
    mirrorPairs: pairs,
    ambiguous:
      !!nearest &&
      !!runnerUp &&
      pairs.length > 0 &&
      Math.abs(nearest.score - runnerUp.score) < 0.05,
    withinTapRadius: nearest ? nearest.distance < cfg.tapRadius : false,
    selection: nearest?.stats || null,
  };
}

/**
 * Report pose pairs that look like a subject and its mirror image.
 *
 * Deliberately geometric, not shape-based: measured pairs sit within |dx| 0.074
 * of each other with dy 0.55-0.67 and comparable scale. Vertical *geometry*
 * correlation is NOT used — real detector output does not preserve a mirror's
 * handedness (see the module header), so it cannot discriminate.
 *
 * This is an advisory signal for the UI ("reflection suspected — mark the water
 * line"), never a silent accept/reject decision.
 */
export function detectMirrorPairs(stats = [], cfg = DEFAULT_TRACKING) {
  const pairs = [];
  for (let i = 0; i < stats.length; i += 1) {
    for (let j = i + 1; j < stats.length; j += 1) {
      const a = stats[i];
      const b = stats[j];
      const dx = Math.abs(a.center.x - b.center.x);
      const dy = Math.abs(a.center.y - b.center.y);
      const hRatio = Math.max(a.height, b.height) / Math.max(Math.min(a.height, b.height), 1e-6);
      if (dx > cfg.mirrorMaxDx || dy < cfg.mirrorMinDy || hRatio > cfg.mirrorMaxHeightRatio) continue;
      pairs.push({
        a: a.index,
        b: b.index,
        dx: +dx.toFixed(4),
        dy: +dy.toFixed(4),
        heightRatio: +hRatio.toFixed(3),
        likelySubject: a.meanVis >= b.meanVis ? a.index : b.index,
      });
    }
  }
  return pairs;
}

/** Capture-time badge for the tracking pill. */
export function trackingBadge({ status }) {
  if (status === "tracking" || status === "recovered") {
    return { level: "good", label: "Athlete locked" };
  }
  if (status === "coasting") return { level: "warn", label: "Athlete hidden — holding lock" };
  if (status === "lost") return { level: "poor", label: "Athlete lost — tap to re-lock" };
  return { level: "poor", label: "No athlete locked" };
}
