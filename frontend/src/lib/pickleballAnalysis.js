/**
 * Pickleball-specific analysis: stroke classification, contact-point analysis,
 * ready-position tracking between shots.
 *
 * All inputs are MediaPipe pose-landmark frames. Outputs are merged into the
 * session summary alongside the generic rep data.
 */

import { L, angle } from "./repDetectionConstants.js";

/**
 * Classify a single pickleball stroke based on contact-frame landmarks +
 * recent wrist trajectory.
 *
 * Returns one of:
 *   "dink" — soft contact below waist, gentle low-to-high path
 *   "drop" — soft contact at waist/below, lifting low-to-high path (4th shot)
 *   "drive" — fast horizontal contact at waist/chest, forward weight transfer
 *   "volley" — contact at chest/shoulder with minimal back-swing
 *   "overhead" — contact above shoulder, downward strike
 *   "serve" — first stroke of session, contact above shoulder, ascending path
 */
export function classifyStroke({ contactFrame, prevFrames, isFirstStroke }) {
  const { lm } = contactFrame;
  if (!lm) return "unknown";

  // Determine swing arm: more-extended elbow at contact
  const lExt = angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_ELBOW], lm[L.LEFT_WRIST]) ?? 0;
  const rExt = angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_ELBOW], lm[L.RIGHT_WRIST]) ?? 0;
  const isLeft = lExt > rExt;
  const wrist = isLeft ? lm[L.LEFT_WRIST] : lm[L.RIGHT_WRIST];
  const shoulder = isLeft ? lm[L.LEFT_SHOULDER] : lm[L.RIGHT_SHOULDER];
  const hip = isLeft ? lm[L.LEFT_HIP] : lm[L.RIGHT_HIP];
  const oppHip = isLeft ? lm[L.RIGHT_HIP] : lm[L.LEFT_HIP];

  if (!wrist || !shoulder || !hip) return "unknown";

  // Body-relative wrist height: 0 = at hip, +1 = at head, -1 = at knee
  const torsoH = Math.max(0.05, hip.y - shoulder.y);
  const wristRel = (hip.y - wrist.y) / torsoH; // hip=0, shoulder=1

  // Pre-contact vertical wrist motion (rising = negative dy, falling = positive)
  let dy = 0;
  let dx = 0;
  if (prevFrames && prevFrames.length > 0) {
    const earliest = prevFrames[0];
    if (earliest.lm) {
      const earlyW = isLeft ? earliest.lm[L.LEFT_WRIST] : earliest.lm[L.RIGHT_WRIST];
      if (earlyW) {
        dy = wrist.y - earlyW.y; // positive = wrist moved down
        dx = wrist.x - earlyW.x;
      }
    }
  }
  const horizontalSpeed = Math.abs(dx);
  const verticalSpeed = Math.abs(dy);

  // OVERHEAD: contact well above shoulder + rapid downward motion
  if (wristRel > 1.4 && dy > 0.04) return "overhead";

  // SERVE: first stroke, contact above shoulder, with rising path
  if (isFirstStroke && wristRel > 1.0 && dy < 0) return "serve";

  // DRIVE: high horizontal speed always wins (even at chest height where
  // volley is the alternative). Drives are defined by *speed*.
  if (horizontalSpeed >= 0.04 && wristRel >= -0.2 && wristRel <= 1.3) {
    return "drive";
  }

  // VOLLEY: contact between waist and shoulder + minimal vertical pre-motion
  // (no big back-swing). Lower horizontal speed than a drive.
  if (wristRel > 0.4 && wristRel <= 1.4 && verticalSpeed < 0.03) {
    return "volley";
  }

  // DROP: contact at waist/below with stronger lift than dink (significant dy).
  // Check BEFORE dink because the dink criteria is broader.
  if (wristRel <= 0.6 && dy < -0.012 && horizontalSpeed < 0.06) {
    return "drop";
  }

  // DINK: contact at or below waist, minimal motion in any direction.
  if (wristRel <= 0.5 && horizontalSpeed < 0.03) {
    return "dink";
  }

  // Fallback: classify by height
  if (wristRel > 1.0) return "volley";
  if (wristRel > 0.4) return "drive";
  return "dink";
}

/**
 * Compute contact-point metrics for a stroke.
 */
export function contactPointMetrics(contactFrame) {
  const { lm } = contactFrame || {};
  if (!lm) return {};
  const lExt = angle(lm[L.LEFT_SHOULDER], lm[L.LEFT_ELBOW], lm[L.LEFT_WRIST]) ?? 0;
  const rExt = angle(lm[L.RIGHT_SHOULDER], lm[L.RIGHT_ELBOW], lm[L.RIGHT_WRIST]) ?? 0;
  const isLeft = lExt > rExt;
  const wrist = isLeft ? lm[L.LEFT_WRIST] : lm[L.RIGHT_WRIST];
  const shoulder = isLeft ? lm[L.LEFT_SHOULDER] : lm[L.RIGHT_SHOULDER];
  const elbow = isLeft ? lm[L.LEFT_ELBOW] : lm[L.RIGHT_ELBOW];
  const hip = isLeft ? lm[L.LEFT_HIP] : lm[L.RIGHT_HIP];
  const oppShoulder = isLeft ? lm[L.RIGHT_SHOULDER] : lm[L.LEFT_SHOULDER];
  const oppHip = isLeft ? lm[L.RIGHT_HIP] : lm[L.LEFT_HIP];

  if (!wrist || !shoulder || !hip || !elbow) return {};

  const torsoH = Math.max(0.05, hip.y - shoulder.y);
  const wristRel = (hip.y - wrist.y) / torsoH; // 0 hip, 1 shoulder

  // Contact-zone label
  let zone;
  if (wristRel < -0.2) zone = "below_knee";
  else if (wristRel < 0.4) zone = "waist";
  else if (wristRel < 1.0) zone = "chest";
  else if (wristRel < 1.5) zone = "shoulder";
  else zone = "above_head";

  // Distance of contact from center of body (paddle-too-close vs perfect-extension)
  const torsoCenterX =
    (shoulder.x + hip.x + (oppShoulder?.x ?? shoulder.x) + (oppHip?.x ?? hip.x)) / 4;
  const distFromBody = Math.abs(wrist.x - torsoCenterX) / Math.max(0.05, Math.abs(shoulder.x - hip.x) || 0.15);

  // Body rotation = horizontal shoulder-line tilt vs hip-line tilt; higher = more torso turn
  const shoulderLineDx = oppShoulder ? (oppShoulder.x - shoulder.x) : 0;
  const hipLineDx = oppHip ? (oppHip.x - hip.x) : 0;
  const bodyRotation = Math.abs(shoulderLineDx) > 1e-3
    ? Math.round(Math.abs(Math.abs(shoulderLineDx) - Math.abs(hipLineDx)) * 200)
    : 0;

  return {
    contact_height_rel: +wristRel.toFixed(2),
    contact_zone: zone,
    arm_extension_deg: angle(shoulder, elbow, wrist),
    distance_from_body: +distFromBody.toFixed(2),
    body_rotation_score: bodyRotation, // 0 = no rotation, ~30+ = strong torso turn
  };
}

/**
 * Score the athlete's ready position during the rest interval BETWEEN strokes.
 * For each pair of consecutive reps, sample the midpoint frame:
 *   - paddle_up: wrist height should be between waist (0) and chest (~0.8)
 *   - knee_bent: knee angle should be 130-160° (slight athletic flexion)
 *
 * Returns: { ready_score: 0-100, paddle_up_pct, knee_bend_avg, intervals: [...] }
 */
export function readyPositionStats(frames, reps) {
  if (!reps || reps.length < 2) return null;
  const intervals = [];
  let paddleUpCount = 0;
  let kneeAngleSum = 0;
  let kneeSamples = 0;

  for (let i = 0; i < reps.length - 1; i++) {
    const tMid = (reps[i].time_s + reps[i + 1].time_s) / 2;
    // Find frame nearest tMid
    let nearestIdx = 0;
    let nearestDt = Infinity;
    for (let f = 0; f < frames.length; f++) {
      const dt = Math.abs(frames[f].t - tMid);
      if (dt < nearestDt) {
        nearestDt = dt;
        nearestIdx = f;
      }
    }
    const fr = frames[nearestIdx];
    if (!fr || !fr.lm) continue;
    const lm = fr.lm;
    const ls = lm[L.LEFT_SHOULDER];
    const lh = lm[L.LEFT_HIP];
    if (!ls || !lh) continue;
    const torsoH = Math.max(0.05, lh.y - ls.y);
    // Average wrist height (whichever is higher = paddle hand)
    const lw = lm[L.LEFT_WRIST];
    const rw = lm[L.RIGHT_WRIST];
    const wristY = Math.min(lw?.y ?? 1, rw?.y ?? 1);
    const wristRel = (lh.y - wristY) / torsoH;
    const paddleUp = wristRel > 0.0 && wristRel < 1.2;
    if (paddleUp) paddleUpCount++;

    // Knee angle (use the more-bent knee = lower angle)
    const lAngle = angle(lm[L.LEFT_HIP], lm[L.LEFT_KNEE], lm[L.LEFT_ANKLE]);
    const rAngle = angle(lm[L.RIGHT_HIP], lm[L.RIGHT_KNEE], lm[L.RIGHT_ANKLE]);
    const knee = Math.min(lAngle ?? 180, rAngle ?? 180);
    if (Number.isFinite(knee)) {
      kneeAngleSum += knee;
      kneeSamples++;
    }
    intervals.push({
      between_reps: [reps[i].index, reps[i + 1].index],
      t: +tMid.toFixed(2),
      paddle_up: paddleUp,
      wrist_rel_height: +wristRel.toFixed(2),
      knee_angle: knee != null ? +knee.toFixed(1) : null,
    });
  }

  if (intervals.length === 0) return null;
  const paddleUpPct = Math.round((paddleUpCount / intervals.length) * 100);
  const kneeBendAvg = kneeSamples ? +(kneeAngleSum / kneeSamples).toFixed(1) : null;
  // Score: 60% paddle-up, 40% knee bend (target 130-160°)
  const paddleScore = paddleUpPct;
  let kneeScore = 60;
  if (kneeBendAvg != null) {
    if (kneeBendAvg >= 130 && kneeBendAvg <= 160) kneeScore = 100;
    else if (kneeBendAvg < 130) kneeScore = Math.max(0, 100 - (130 - kneeBendAvg) * 2.5);
    else kneeScore = Math.max(0, 100 - (kneeBendAvg - 160) * 2.5);
  }
  const readyScore = Math.round(paddleScore * 0.6 + kneeScore * 0.4);
  return {
    ready_score: readyScore,
    paddle_up_pct: paddleUpPct,
    knee_bend_avg: kneeBendAvg,
    intervals: intervals.slice(0, 50),
  };
}

/**
 * Aggregate stroke-type counts and per-type score averages.
 */
export function strokeBreakdown(reps) {
  const out = {};
  for (const r of reps) {
    const t = r.stroke_type || "unknown";
    if (!out[t]) out[t] = { count: 0, score_sum: 0, contact_zones: {} };
    out[t].count += 1;
    out[t].score_sum += r.score || 0;
    const zone = r.measurements?.contact_zone;
    if (zone) {
      out[t].contact_zones[zone] = (out[t].contact_zones[zone] || 0) + 1;
    }
  }
  for (const k of Object.keys(out)) {
    out[k].avg_score = Math.round(out[k].score_sum / out[k].count);
    delete out[k].score_sum;
  }
  return out;
}
