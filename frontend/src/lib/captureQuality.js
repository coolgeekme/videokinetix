/**
 * Capture quality — decides whether a recorded session is good enough to analyse.
 *
 * WHY THIS EXISTS
 * ---------------
 * On a real user clip the pose detector never found the swimmer at all. Every one
 * of the 85 poses it reported was a false positive fabricated out of the water:
 * the distorted reflection of the lane rope on the underside of the surface, and
 * — once the swimmer was close — the white splash plume. The old target resolver
 * adopted those poses (an isolated pose was adopted unconditionally), so the app
 * "tracked" water for 79 of 120 frames and then computed stroke counts and catch
 * angles from them. The session report looked confident. That is the worst
 * possible failure: not an error, a fabrication.
 *
 * `assessCaptureQuality` runs at the end of a capture and, when the tracked
 * subject is not plausibly an athlete, says so.
 *
 * THE SIGNALS, AND WHY THESE ONES
 * -------------------------------
 * These thresholds are not guesses — they come from comparing that clip against
 * six real underwater swim clips (BlazePose full, numPoses 5, conf 0.3; raw dumps
 * in tests/fixtures/, capture recipe in that folder's README):
 *
 *   signal                    real clips            the bad clip
 *   ------------------------  --------------------  ---------------------
 *   median bbox aspect (h/w)  0.39 – 1.30           2.72  (p90 4.77)
 *   median off-frame joints   0.00 (all six)        0.18
 *   mean key-joint visibility 0.66 – 0.98           0.62
 *
 * Read those three together and the story is physical: a swimmer filmed in
 * profile is widest along the body (aspect < ~1.3), the skeleton sits inside the
 * frame, and the joints the analysis depends on (head, shoulders, hips, knees,
 * ankles) are confidently located. A surface reflection is a tall, narrow,
 * vertically smeared streak whose "limbs" run off the top of the frame with poor
 * confidence. Medians are used rather than means because a handful of outliers —
 * a swimmer briefly half out of frame — should not condemn an otherwise good
 * capture.
 *
 * The guard requires only ONE hard failure to mark a capture unusable, and on the
 * six real clips no real detection trips any of them.
 *
 * All functions are pure so this can be tested against recorded detector output.
 */

/** Joints the sport analyses actually depend on. */
const KEY_JOINTS = [0, 11, 12, 23, 24, 25, 26, 27, 28];

export const DEFAULT_QUALITY = {
  // Hard failures — any one of these makes the capture unusable.
  minConfirmedRatio: 0.25, // fraction of detect ticks where the subject was confirmed
  minKeyVisibility: 0.65,
  maxMedianAspect: 2.0,
  maxMedianOffFrame: 0.05,
  minConfirmedFrames: 12,
  minDurationSec: 1.0,

  // Softer bands, for "fair" / "poor" rather than "unusable".
  fairKeyVisibility: 0.8,
  fairMedianAspect: 1.5,
  fairMedianOffFrame: 0.02,
  fairConfirmedRatio: 0.6,
};

/** Per-frame signals from one pose's landmarks. */
export function frameMetrics(lm) {
  if (!lm || !lm.length) return null;
  const pts = lm.filter(Boolean);
  if (!pts.length) return null;
  let off = 0;
  for (const p of pts) {
    if (!(p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) off += 1;
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  let present = 0;
  for (const k of KEY_JOINTS) {
    const p = lm[k];
    if (p && (p.visibility ?? p.v ?? 0) > 0.3) present += 1;
  }
  const vis = pts.map((p) => p.visibility ?? p.v ?? 0);
  return {
    keyVisibility: present / KEY_JOINTS.length,
    offFrame: off / pts.length,
    aspect: height / Math.max(width, 1e-3),
    width,
    height,
    meanVisibility: vis.reduce((a, b) => a + b, 0) / vis.length,
  };
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

const r2 = (v) => (v == null ? null : +v.toFixed(3));

/**
 * Assess a recorded capture.
 *
 * @param {object} args
 * @param {Array}  args.frames      [{ t, lm }] — lm null where the target was not confirmed
 * @param {object} [args.tracking]  { confirmed, coasted, lost } detect-tick counts
 * @param {object} [args.config]    overrides for DEFAULT_QUALITY
 * @returns {{level:string, reasons:string[], advice:string[], metrics:object}}
 *          level: 'good' | 'fair' | 'poor' | 'unusable'
 */
export function assessCaptureQuality({ frames = [], tracking = null, config = {} } = {}) {
  const cfg = { ...DEFAULT_QUALITY, ...config };
  const confirmedFrames = frames.filter((f) => f && f.lm);
  const metrics = {
    frames: frames.length,
    confirmedFrames: confirmedFrames.length,
  };

  const duration =
    frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
  metrics.durationSeconds = +duration.toFixed(2);

  const per = confirmedFrames.map((f) => frameMetrics(f.lm)).filter(Boolean);
  metrics.medianAspect = r2(median(per.map((m) => m.aspect)));
  metrics.medianOffFrame = r2(median(per.map((m) => m.offFrame)));
  metrics.meanKeyVisibility = per.length
    ? r2(per.reduce((a, m) => a + m.keyVisibility, 0) / per.length)
    : null;

  const ticks = tracking
    ? tracking.confirmed + tracking.coasted + tracking.lost
    : 0;
  metrics.confirmedRatio = ticks ? r2(tracking.confirmed / ticks) : null;

  const reasons = [];
  const advice = [];

  // Not enough signal to say anything at all.
  if (confirmedFrames.length < cfg.minConfirmedFrames || duration < cfg.minDurationSec) {
    reasons.push(
      `Only ${confirmedFrames.length} frame(s) of the athlete were captured over ${metrics.durationSeconds}s.`
    );
    advice.push("Record 3–5 clean stroke cycles — at least a few seconds of continuous swimming.");
    return { level: "unusable", reasons, advice, metrics };
  }

  if (metrics.confirmedRatio != null && metrics.confirmedRatio < cfg.minConfirmedRatio) {
    reasons.push(
      `The athlete could only be confirmed in ${Math.round(metrics.confirmedRatio * 100)}% of the analysed frames.`
    );
  }
  if (metrics.meanKeyVisibility != null && metrics.meanKeyVisibility < cfg.minKeyVisibility) {
    reasons.push(
      `Only ${Math.round(metrics.meanKeyVisibility * 100)}% of the key joints (head, shoulders, hips, knees, ankles) were confidently located.`
    );
    advice.push("Get closer, or zoom in — the athlete needs to fill more of the frame.");
  }
  if (metrics.medianAspect != null && metrics.medianAspect > cfg.maxMedianAspect) {
    reasons.push(
      `The tracked shape is tall and narrow (aspect ${metrics.medianAspect}), not a body in profile — the signature of a water-surface reflection being tracked instead of a swimmer.`
    );
    advice.push(
      "Film side-on from mid-depth so the swimmer crosses the middle of the frame, and mark the water line before recording."
    );
  }
  if (metrics.medianOffFrame != null && metrics.medianOffFrame > cfg.maxMedianOffFrame) {
    reasons.push(
      `${Math.round(metrics.medianOffFrame * 100)}% of the tracked joints sit outside the frame.`
    );
    advice.push("Keep the whole body inside the frame for the length of the clip.");
  }

  if (reasons.length) {
    return { level: "unusable", reasons, advice: dedupe(advice), metrics };
  }

  const marginal = [];
  if (metrics.meanKeyVisibility != null && metrics.meanKeyVisibility < cfg.fairKeyVisibility) {
    marginal.push("joint visibility is low — improve lighting or move closer");
  }
  if (metrics.medianAspect != null && metrics.medianAspect > cfg.fairMedianAspect) {
    marginal.push("body angle is unusual for a side-on view");
  }
  if (metrics.medianOffFrame != null && metrics.medianOffFrame > cfg.fairMedianOffFrame) {
    marginal.push("parts of the athlete drift out of frame");
  }
  if (metrics.confirmedRatio != null && metrics.confirmedRatio < cfg.fairConfirmedRatio) {
    marginal.push("the athlete is hidden for part of the clip");
  }

  if (marginal.length >= 2) return { level: "poor", reasons: marginal, advice: [], metrics };
  if (marginal.length === 1) return { level: "fair", reasons: marginal, advice: [], metrics };
  return { level: "good", reasons: [], advice: [], metrics };
}

function dedupe(arr) {
  return [...new Set(arr)];
}
