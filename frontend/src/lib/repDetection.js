/**
 * Rep detection + sport-specific kinematic measurements.
 *
 * Input: an array of MediaPipe pose-landmark frames captured during a session.
 * Each frame: { t: number (seconds), lm: Landmark[33] | null }
 *
 * Output: { reps: Rep[], summary: {...}, sport_specific: {...} }
 *
 * Approach:
 *  - Each sport defines a 1-D "rep signal" derived from landmarks.
 *  - We smooth the signal and detect prominent peaks separated by a min interval.
 *  - For each peak (the rep "apex"), we measure sport-specific joint angles in a
 *    small window around the peak.
 *  - We score each rep 0-100 against a target band, then aggregate.
 *  - For basketball: integrates ball-tracking shot outcomes (make/miss) and
 *    annotates each rep with its shot result.
 */

import { detectShots, annotateRepsWithOutcomes, makesVsMissesStats } from "./shotDetection";
import { L, angle } from "./repDetectionConstants";
import { classifyStroke, contactPointMetrics, readyPositionStats, strokeBreakdown } from "./pickleballAnalysis";
import {
  swimmingArmExtensionSignal,
  swimmingLandmarkVisible,
} from "./swimmingPose";

// (kept for backward-compat — re-export same constants/helpers used below)
// MediaPipe BlazePose 33 landmark indices — see repDetectionConstants.js

function smooth(signal, windowSize = 5) {
  if (signal.length < windowSize) return signal.slice();
  const out = new Array(signal.length).fill(0);
  const half = Math.floor(windowSize / 2);
  for (let i = 0; i < signal.length; i++) {
    let sum = 0;
    let count = 0;
    for (let j = -half; j <= half; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < signal.length && Number.isFinite(signal[idx])) {
        sum += signal[idx];
        count += 1;
      }
    }
    out[i] = count ? sum / count : signal[i];
  }
  return out;
}

/**
 * Find peaks in a 1D signal.
 *  - minDistance: indices apart required between peaks
 *  - minProminence: peak must exceed local baseline by this much (relative units)
 */
function findPeaks(signal, { minDistance, minProminence }) {
  const peaks = [];
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] > signal[i - 1] && signal[i] >= signal[i + 1]) {
      // local maximum: estimate prominence vs surrounding window
      const winStart = Math.max(0, i - minDistance);
      const winEnd = Math.min(signal.length, i + minDistance);
      let baseline = Infinity;
      for (let j = winStart; j < winEnd; j++) {
        if (signal[j] < baseline) baseline = signal[j];
      }
      const prom = signal[i] - baseline;
      if (prom >= minProminence) {
        peaks.push({ index: i, value: signal[i], prominence: prom });
      }
    }
  }
  // enforce minimum distance: keep tallest per window
  const filtered = [];
  for (const p of peaks) {
    const last = filtered[filtered.length - 1];
    if (last && p.index - last.index < minDistance) {
      if (p.value > last.value) filtered[filtered.length - 1] = p;
    } else {
      filtered.push(p);
    }
  }
  return filtered;
}

/* -------------------- Sport configurations -------------------- */

const SPORTS = {
  basketball: {
    label: "basketball shot",
    // Signal: highest wrist Y position (1 - max(wristY)) — peak when hand is highest
    signal: (lm) => {
      const lw = lm[L.LEFT_WRIST];
      const rw = lm[L.RIGHT_WRIST];
      if (!lw && !rw) return 0;
      const minY = Math.min(lw?.y ?? 1, rw?.y ?? 1); // smaller y = higher
      return 1 - minY; // larger value = wrist higher = closer to release
    },
    // Shots take ~2.5-3s end-to-end; raised from 1.2s to filter post-release
    // bumps (the wrist often dips and comes back up during follow-through).
    minRepIntervalSec: 1.8,
    // Raised from 0.08 to 0.15 — a real shot release moves the wrist by a
    // much larger margin than a setup/load motion.
    minProminence: 0.15,
    // Per-peak validator. Only counts a peak as a release if BOTH wrists
    // are above the shoulders at apex. A "setup/load" peak has the shooting
    // wrist at chest/chin level (below shoulders) — that should NOT count
    // as a separate rep. Returns true to keep, false to drop.
    validatePeak: (lm) => {
      if (!lm) return true;
      const lwY = lm[L.LEFT_WRIST]?.y ?? 1;
      const rwY = lm[L.RIGHT_WRIST]?.y ?? 1;
      const wristY = Math.min(lwY, rwY); // higher wrist (smaller Y)
      const lShY = lm[L.LEFT_SHOULDER]?.y ?? 0.5;
      const rShY = lm[L.RIGHT_SHOULDER]?.y ?? 0.5;
      const shoulderY = (lShY + rShY) / 2;
      // Shooting wrist must reach at least 5% above the shoulder line.
      // At true release the wrist is typically above the head; this is a
      // conservative gate that catches loads and arm gestures.
      return wristY < shoulderY - 0.05;
    },
    apex: (lm) => {
      // Use the higher arm at apex as "shooting" arm
      const lY = lm[L.LEFT_WRIST]?.y ?? 1;
      const rY = lm[L.RIGHT_WRIST]?.y ?? 1;
      const isLeft = lY < rY;
      const shoulder = isLeft ? lm[L.LEFT_SHOULDER] : lm[L.RIGHT_SHOULDER];
      const elbow = isLeft ? lm[L.LEFT_ELBOW] : lm[L.RIGHT_ELBOW];
      const wrist = isLeft ? lm[L.LEFT_WRIST] : lm[L.RIGHT_WRIST];
      const hip = isLeft ? lm[L.LEFT_HIP] : lm[L.RIGHT_HIP];
      const knee = isLeft ? lm[L.LEFT_KNEE] : lm[L.RIGHT_KNEE];
      const ankle = isLeft ? lm[L.LEFT_ANKLE] : lm[L.RIGHT_ANKLE];
      return {
        shooting_elbow_angle: angle(shoulder, elbow, wrist),
        shooting_arm_extension: angle(elbow, shoulder, hip),
        knee_angle_at_release: angle(hip, knee, ankle),
      };
    },
    // Target bands per measurement — used to score each rep 0-100
    targets: {
      shooting_elbow_angle: [150, 180, 25], // [min, max, tolerance]
      shooting_arm_extension: [150, 180, 25],
      knee_angle_at_release: [150, 180, 30],
    },
    cues: {
      shooting_elbow_angle: { low: "Elbow under-extended at release — push through fully.", high: "Elbow over-extended; keep wrist relaxed." },
      knee_angle_at_release: { low: "You released early — extend through your knees.", high: "Lower base — use your legs more." },
    },
  },

  soccer: {
    label: "soccer kick",
    // Signal: vertical velocity magnitude of the higher-velocity ankle (kick)
    signal: (lm, _, prev) => {
      if (!prev) return 0;
      const dy = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);
      const lv = dy(lm[L.LEFT_ANKLE], prev[L.LEFT_ANKLE]);
      const rv = dy(lm[L.RIGHT_ANKLE], prev[L.RIGHT_ANKLE]);
      return Math.max(lv, rv);
    },
    minRepIntervalSec: 1.5,
    minProminence: 0.02,
    apex: (lm, _, prev) => {
      const dy = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0);
      const lv = prev ? dy(lm[L.LEFT_ANKLE], prev[L.LEFT_ANKLE]) : 0;
      const rv = prev ? dy(lm[L.RIGHT_ANKLE], prev[L.RIGHT_ANKLE]) : 0;
      const isLeft = lv > rv;
      const hip = isLeft ? lm[L.LEFT_HIP] : lm[L.RIGHT_HIP];
      const knee = isLeft ? lm[L.LEFT_KNEE] : lm[L.RIGHT_KNEE];
      const ankle = isLeft ? lm[L.LEFT_ANKLE] : lm[L.RIGHT_ANKLE];
      const plantHip = isLeft ? lm[L.RIGHT_HIP] : lm[L.LEFT_HIP];
      const plantKnee = isLeft ? lm[L.RIGHT_KNEE] : lm[L.LEFT_KNEE];
      const plantAnkle = isLeft ? lm[L.RIGHT_ANKLE] : lm[L.LEFT_ANKLE];
      return {
        kicking_knee_flexion: angle(hip, knee, ankle),
        plant_leg_flexion: angle(plantHip, plantKnee, plantAnkle),
        hip_separation: lm[L.LEFT_HIP] && lm[L.RIGHT_HIP] ? Math.abs(lm[L.LEFT_HIP].x - lm[L.RIGHT_HIP].x) * 100 : null,
      };
    },
    targets: {
      kicking_knee_flexion: [150, 180, 30],
      plant_leg_flexion: [150, 175, 25],
    },
    cues: {
      kicking_knee_flexion: { low: "Snap your kicking leg through more aggressively.", high: "Don't lock the knee — keep a slight bend." },
      plant_leg_flexion: { low: "Plant leg over-bent — drives power loss.", high: "Stay athletic; small bend in plant leg for stability." },
    },
  },

  swimming: {
    label: "swim stroke",
    // Normalize arm reach by shoulder width so a stroke remains measurable
    // whether the swimmer is horizontal, diagonal, or approaching the camera.
    signal: (lm) => swimmingArmExtensionSignal(lm),
    minRepIntervalSec: 0.55,
    minProminence: 0.12,
    apex: (lm) => {
      const leftShoulder = lm[L.LEFT_SHOULDER];
      const rightShoulder = lm[L.RIGHT_SHOULDER];
      const leftWrist = lm[L.LEFT_WRIST];
      const rightWrist = lm[L.RIGHT_WRIST];
      const leftReach = swimmingLandmarkVisible(leftShoulder) &&
        swimmingLandmarkVisible(leftWrist)
        ? Math.hypot(leftShoulder.x - leftWrist.x, leftShoulder.y - leftWrist.y)
        : -1;
      const rightReach = swimmingLandmarkVisible(rightShoulder) &&
        swimmingLandmarkVisible(rightWrist)
        ? Math.hypot(rightShoulder.x - rightWrist.x, rightShoulder.y - rightWrist.y)
        : -1;
      const isLeft = leftReach >= rightReach;
      const shoulder = isLeft ? lm[L.LEFT_SHOULDER] : lm[L.RIGHT_SHOULDER];
      const elbow = isLeft ? lm[L.LEFT_ELBOW] : lm[L.RIGHT_ELBOW];
      const wrist = isLeft ? lm[L.LEFT_WRIST] : lm[L.RIGHT_WRIST];
      const hip = isLeft ? lm[L.LEFT_HIP] : lm[L.RIGHT_HIP];
      const shoulderTilt =
        swimmingLandmarkVisible(leftShoulder) &&
        swimmingLandmarkVisible(rightShoulder)
          ? Math.abs(
              Math.atan2(
                rightShoulder.y - leftShoulder.y,
                rightShoulder.x - leftShoulder.x
              ) * 180 / Math.PI
            )
          : null;
      return {
        catch_elbow_angle:
          swimmingLandmarkVisible(shoulder) &&
          swimmingLandmarkVisible(elbow) &&
          swimmingLandmarkVisible(wrist)
            ? angle(shoulder, elbow, wrist)
            : null,
        body_roll_y:
          swimmingLandmarkVisible(shoulder) && swimmingLandmarkVisible(hip)
            ? Math.abs(shoulder.y - hip.y)
            : null,
        shoulder_tilt_deg: shoulderTilt,
      };
    },
    targets: {
      catch_elbow_angle: [100, 140, 25], // high-elbow catch
    },
    cues: {
      catch_elbow_angle: { low: "Elbow dropping during catch — keep it high.", high: "Catch elbow too straight — bend earlier." },
    },
  },

  pickleball: {
    label: "pickleball swing",
    // Signal: dominant wrist horizontal velocity (lateral swing)
    signal: (lm, _, prev) => {
      if (!prev) return 0;
      const dx = (a, b) => (a && b ? Math.abs(a.x - b.x) : 0);
      return Math.max(
        dx(lm[L.LEFT_WRIST], prev[L.LEFT_WRIST]),
        dx(lm[L.RIGHT_WRIST], prev[L.RIGHT_WRIST])
      );
    },
    minRepIntervalSec: 0.6, // dinks come fast
    minProminence: 0.012,
    apex: (lm) => {
      const lExt = angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_ELBOW], lm[L.LEFT_WRIST]) ?? 0;
      const rExt = angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_ELBOW], lm[L.RIGHT_WRIST]) ?? 0;
      const isLeft = lExt > rExt;
      const shoulder = isLeft ? lm[L.LEFT_SHOULDER] : lm[L.RIGHT_SHOULDER];
      const elbow = isLeft ? lm[L.LEFT_ELBOW] : lm[L.RIGHT_ELBOW];
      const wrist = isLeft ? lm[L.LEFT_WRIST] : lm[L.RIGHT_WRIST];
      const hip = isLeft ? lm[L.LEFT_HIP] : lm[L.RIGHT_HIP];
      const knee = isLeft ? lm[L.LEFT_KNEE] : lm[L.RIGHT_KNEE];
      const ankle = isLeft ? lm[L.LEFT_ANKLE] : lm[L.RIGHT_ANKLE];
      const baseMetrics = {
        swing_arm_extension: angle(shoulder, elbow, wrist),
        knee_flexion_at_contact: angle(hip, knee, ankle),
      };
      // Merge in detailed contact-point metrics from the pickleball module
      const contactMetrics = contactPointMetrics({ lm });
      return { ...baseMetrics, ...contactMetrics };
    },
    targets: {
      swing_arm_extension: [120, 165, 25],
      knee_flexion_at_contact: [130, 165, 25],
      arm_extension_deg: [120, 170, 30],
    },
    cues: {
      swing_arm_extension: { low: "Compact swing — extend through contact.", high: "Don't lock the arm; keep a slight bend." },
      knee_flexion_at_contact: { low: "Stay lower — get into ready position.", high: "Knees too straight — flex more for control." },
    },
  },
};

/* -------------------- Scoring -------------------- */

function scoreMeasurement(value, [min, max, tol]) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value >= min && value <= max) return 100;
  const dist = value < min ? min - value : value - max;
  const score = Math.max(0, Math.round(100 - (dist / tol) * 50));
  return score;
}

function summarizeArray(arr) {
  const nums = arr.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance =
    nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
  return {
    mean: +mean.toFixed(1),
    std: +Math.sqrt(variance).toFixed(1),
    min: +Math.min(...nums).toFixed(1),
    max: +Math.max(...nums).toFixed(1),
    n: nums.length,
  };
}

/**
 * Main entry point.
 * frames: [{ t, lm }] sorted by t
 * sport: sport id
 * options: {
 *   ballFrames?: [{ t, x, y, conf } | null]  — basketball ball positions
 *   hoopRoi?: { x, y, w, h }                  — basketball hoop rectangle (normalized)
 * }
 * Returns: rich session summary
 */
export function analyzeSession(frames, sport, options = {}) {
  const { ballFrames = null, hoopRoi = null } = options;
  const cfg = SPORTS[sport];
  if (!cfg || frames.length < 5) {
    return {
      sport,
      rep_count: 0,
      duration_seconds:
        frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0,
      reps: [],
      summary_stats: {},
      consistency: null,
      no_reps_detected: true,
    };
  }

  // Compute per-frame signal
  const signal = [];
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f.lm) {
      signal.push(0);
      continue;
    }
    const prev = i > 0 ? frames[i - 1].lm : null;
    signal.push(cfg.signal(f.lm, f.t, prev) || 0);
  }
  const smoothed = smooth(signal, 5);

  // Estimate fps from frames
  const duration =
    frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 1;
  const fps = frames.length / Math.max(duration, 0.001);
  const minDist = Math.max(3, Math.round(fps * cfg.minRepIntervalSec));

  const peaks = findPeaks(smoothed, {
    minDistance: minDist,
    minProminence: cfg.minProminence,
  });

  // Optional per-peak validator (sport-specific). For basketball this drops
  // setup/load peaks where the wrist hasn't actually crossed the shoulder
  // line — i.e., it's not a real release.
  const validatedPeaks = cfg.validatePeak
    ? peaks.filter((p) => {
        const f = frames[p.index];
        return f && cfg.validatePeak(f.lm, f);
      })
    : peaks;

  // Build per-rep records
  const reps = validatedPeaks.map((p, i) => {
    const f = frames[p.index];
    const prevFrame = p.index > 0 ? frames[p.index - 1] : null;
    const apex = cfg.apex(f.lm, f.t, prevFrame?.lm);
    // Score this rep
    const scores = {};
    let total = 0;
    let count = 0;
    for (const [k, target] of Object.entries(cfg.targets)) {
      const s = scoreMeasurement(apex[k], target);
      scores[k] = s;
      if (s != null) {
        total += s;
        count += 1;
      }
    }
    const repScore = count ? Math.round(total / count) : null;
    const baseRep = {
      index: i + 1,
      time_s: +f.t.toFixed(2),
      frame_index: p.index,
      measurements: apex,
      sub_scores: scores,
      score: repScore,
    };
    // Pickleball-specific: classify stroke type based on contact frame +
    // ~6-frame pre-contact window (200ms back-swing).
    if (sport === "pickleball") {
      const back = Math.max(0, p.index - 6);
      const prevWindow = frames.slice(back, p.index);
      baseRep.stroke_type = classifyStroke({
        contactFrame: f,
        prevFrames: prevWindow,
        isFirstStroke: i === 0,
      });
    }
    return baseRep;
  });

  // Aggregate
  const repScores = reps.map((r) => r.score).filter((s) => s != null);
  const overall =
    repScores.length > 0
      ? Math.round(repScores.reduce((a, b) => a + b, 0) / repScores.length)
      : null;
  const consistency =
    repScores.length > 1
      ? Math.max(
          0,
          100 -
            Math.round(
              Math.sqrt(
                repScores.reduce((acc, s) => {
                  const m = repScores.reduce((a, b) => a + b, 0) / repScores.length;
                  return acc + (s - m) ** 2;
                }, 0) / repScores.length
              ) * 1.5
            )
        )
      : null;

  // Per-measurement summary
  const summary_stats = {};
  for (const k of Object.keys(cfg.targets)) {
    const vals = reps.map((r) => r.measurements[k]).filter((v) => v != null);
    summary_stats[k] = summarizeArray(vals);
  }

  // Best/worst rep indices for keyframe extraction
  let best_rep = null;
  let worst_rep = null;
  if (repScores.length) {
    let bestIdx = 0;
    let worstIdx = 0;
    reps.forEach((r, i) => {
      if (r.score == null) return;
      if (reps[bestIdx].score == null || r.score > reps[bestIdx].score) bestIdx = i;
      if (reps[worstIdx].score == null || r.score < reps[worstIdx].score) worstIdx = i;
    });
    best_rep = reps[bestIdx];
    worst_rep = reps[worstIdx];
  }

  // Coaching cues from worst rep
  const cues = [];
  if (worst_rep) {
    for (const [k, val] of Object.entries(worst_rep.measurements)) {
      const target = cfg.targets[k];
      if (!target || val == null) continue;
      const [min, max] = target;
      if (val < min && cfg.cues[k]?.low) cues.push({ measurement: k, issue: "below target", value: +val.toFixed(1), target_min: min, cue: cfg.cues[k].low });
      else if (val > max && cfg.cues[k]?.high) cues.push({ measurement: k, issue: "above target", value: +val.toFixed(1), target_max: max, cue: cfg.cues[k].high });
    }
  }

  // Basketball-specific: shot make/miss detection from ball trajectory + hoop ROI
  let shot_outcomes = null;
  let makes_vs_misses = null;
  let annotatedReps = reps;
  if (sport === "basketball" && ballFrames && hoopRoi) {
    shot_outcomes = detectShots(ballFrames, hoopRoi);
    // CRITICAL FILTER: when we have ball-tracked shots, those are the
    // ground truth. Drop any pose-peak rep that doesn't have a matching
    // ball-shot within ±1.5s — those are setup motions, arm gestures, or
    // pose-detector noise, NOT real shots. This eliminates the over-count.
    // (If no shots were detected, e.g., hoop ROI never placed or no ball
    // tracked, we keep the pose-only reps so the user still gets feedback.)
    if (shot_outcomes.shots.length > 0) {
      const matchWindow = 1.5;
      reps.forEach((r) => {
        let matched = false;
        for (const s of shot_outcomes.shots) {
          if (Math.abs(s.t_apex - r.time_s) <= matchWindow) {
            matched = true;
            break;
          }
        }
        r._has_matching_shot = matched;
      });
      const filtered = reps.filter((r) => r._has_matching_shot);
      // Re-index reps after filtering so indices stay 1..N contiguous.
      annotatedReps = filtered.map((r, i) => {
        const { _has_matching_shot, ...rest } = r;
        return { ...rest, index: i + 1 };
      });
    }
    annotatedReps = annotateRepsWithOutcomes(annotatedReps, shot_outcomes.shots);
    makes_vs_misses = makesVsMissesStats(annotatedReps);
  }

  // Pickleball-specific: stroke breakdown + ready-position scoring
  let pickleball_stats = null;
  if (sport === "pickleball" && reps.length > 0) {
    pickleball_stats = {
      stroke_breakdown: strokeBreakdown(reps),
      ready_position: readyPositionStats(frames, reps),
    };
  }

  return {
    sport,
    rep_count: annotatedReps.length,
    duration_seconds: +duration.toFixed(2),
    fps_estimate: +fps.toFixed(1),
    overall_score: overall,
    consistency,
    reps: annotatedReps,
    best_rep,
    worst_rep,
    summary_stats,
    coaching_cues: cues,
    no_reps_detected: annotatedReps.length === 0,
    shot_outcomes,
    makes_vs_misses,
    pickleball_stats,
  };
}

/** Convenience: time of best/worst rep — used to seek and capture keyframes. */
export function getKeyframeTimestamps(analysis) {
  const out = [];
  if (analysis.best_rep) out.push({ label: "best_rep", time_s: analysis.best_rep.time_s, score: analysis.best_rep.score });
  if (analysis.worst_rep && analysis.worst_rep.index !== analysis.best_rep?.index) {
    out.push({ label: "worst_rep", time_s: analysis.worst_rep.time_s, score: analysis.worst_rep.score });
  }
  return out;
}
