/**
 * Basketball shot make/miss detection.
 *
 * Inputs:
 *  - ballFrames: [{ t: number_seconds, x: number, y: number, conf: number } | null]
 *    Per-frame ball center in normalized [0,1] image coords. Null = no detection.
 *  - hoopRoi: { x, y, w, h } normalized rect, OR null if not placed.
 *
 * Outputs:
 *  - shots: [{ t_attempt, t_outcome, made: bool, peak_y, ball_path }]
 *  - makes: int
 *  - attempts: int
 *  - fg_pct: int (0-100)
 *
 * Algorithm (simple, real-time-friendly):
 *  - Detect "shot attempts" as segments where ball is rising (y decreasing) and
 *    crosses above an "upper" line (hoop_top - hoop_h * 0.3). The peak (lowest y)
 *    of that segment is the apex.
 *  - Outcome window = 1.2 s after apex while ball is descending.
 *  - "Make" = ball center enters the hoop rectangle from above (cross y=hoop_top)
 *    AND exits from below (cross y=hoop_bottom) within the outcome window AND
 *    while inside [hoop_x, hoop_x+hoop_w] horizontally.
 *  - "Miss" = outcome window expired OR ball never intersected the rectangle.
 *  - Cooldown = 1.0 s after each shot finalizes before a new attempt can begin.
 */

const RISING_VELOCITY = -0.0015; // Δy per frame (normalized) considered "rising"
const DESCENDING_VELOCITY = 0.0015;
const OUTCOME_WINDOW_S = 1.2;
const COOLDOWN_S = 1.0;
const MIN_ATTEMPT_HEIGHT_REL_HOOP = 0.5; // peak must reach at least 50% above hoop top

function vy(prev, curr) {
  if (!prev || !curr) return 0;
  const dt = curr.t - prev.t;
  if (dt <= 0) return 0;
  return (curr.y - prev.y) / dt;
}

/**
 * Detect shots from a sequence of ball positions.
 * @returns { shots, makes, attempts, fg_pct }
 */
export function detectShots(ballFrames, hoopRoi) {
  if (!hoopRoi || !ballFrames || ballFrames.length < 5) {
    return { shots: [], makes: 0, attempts: 0, fg_pct: null, hoop_placed: !!hoopRoi };
  }
  const shots = [];
  let i = 0;
  let lastShotEndT = -Infinity;
  // skip leading nulls
  while (i < ballFrames.length && !ballFrames[i]) i++;

  while (i < ballFrames.length - 2) {
    if (!ballFrames[i] || ballFrames[i].t - lastShotEndT < COOLDOWN_S) {
      i++;
      continue;
    }
    // Look for the start of a rising segment: vy < RISING_VELOCITY
    const prev = ballFrames[i - 1];
    const curr = ballFrames[i];
    if (!prev || !curr) {
      i++;
      continue;
    }
    if (vy(prev, curr) > RISING_VELOCITY) {
      i++;
      continue;
    }
    // Track this rising segment to find apex (min y)
    const t_attempt = curr.t;
    let apexIdx = i;
    let apex = curr;
    let j = i;
    while (j < ballFrames.length - 1) {
      const f = ballFrames[j];
      const fNext = ballFrames[j + 1];
      if (!f) break;
      if (f.y < apex.y) {
        apex = f;
        apexIdx = j;
      }
      if (!fNext) {
        j++;
        break;
      }
      // Stop when ball is no longer rising
      if (vy(f, fNext) > DESCENDING_VELOCITY) {
        // descending phase begins
        break;
      }
      j++;
    }
    // Validate this is a real shot attempt — apex must be above hoop by margin
    const apexHoop = apex.hoop || hoopRoi;
    const heightAboveHoop = apexHoop.y - apex.y; // positive = apex is above hoop top
    if (heightAboveHoop < apexHoop.h * MIN_ATTEMPT_HEIGHT_REL_HOOP) {
      i = j + 1;
      continue;
    }
    // Watch the descent for crossing of the hoop ROI
    const ball_path = [apex];
    let made = false;
    let crossedTop = false;
    let crossedBottom = false;
    let lastF = apex;
    let outcomeT = apex.t;
    let k = apexIdx + 1;
    while (k < ballFrames.length) {
      const f = ballFrames[k];
      if (!f) {
        k++;
        continue;
      }
      if (f.t - apex.t > OUTCOME_WINDOW_S) break;
      ball_path.push(f);
      const currentHoop = f.hoop || hoopRoi;
      const previousHoop = lastF?.hoop || currentHoop;
      const hoopTop = currentHoop.y;
      const hoopBottom = currentHoop.y + currentHoop.h;
      const hoopLeft = currentHoop.x;
      const hoopRight = currentHoop.x + currentHoop.w;
      // Detect crossing of hoopTop (going down)
      if (
        lastF &&
        lastF.y <= previousHoop.y &&
        f.y > hoopTop &&
        f.x >= hoopLeft &&
        f.x <= hoopRight
      ) {
        crossedTop = true;
      }
      // Detect crossing of hoopBottom (going down) AFTER having crossed top
      if (
        crossedTop &&
        lastF &&
        lastF.y <= previousHoop.y + previousHoop.h &&
        f.y > hoopBottom &&
        f.x >= hoopLeft &&
        f.x <= hoopRight
      ) {
        crossedBottom = true;
        outcomeT = f.t;
        break;
      }
      lastF = f;
      k++;
    }
    made = crossedTop && crossedBottom;
    if (!made) outcomeT = ball_path[ball_path.length - 1]?.t ?? apex.t;

    shots.push({
      attempt: shots.length + 1,
      t_attempt,
      t_apex: apex.t,
      t_outcome: outcomeT,
      apex_x: +apex.x.toFixed(4),
      apex_y: +apex.y.toFixed(4),
      hoop_x: +(apexHoop.x + apexHoop.w / 2).toFixed(4),
      made,
      // Down-sample ball_path to at most 6 evenly-spaced points so the payload
      // stays tiny — visualization isn't replayed, this is only for analytics.
      ball_path: (() => {
        const path = ball_path.map((p) => ({
          t: +p.t.toFixed(2),
          x: +p.x.toFixed(4),
          y: +p.y.toFixed(4),
        }));
        if (path.length <= 6) return path;
        const step = (path.length - 1) / 5;
        return [0, 1, 2, 3, 4, 5].map((i) => path[Math.round(i * step)]);
      })(),
    });
    lastShotEndT = outcomeT;
    i = k + 1;
  }

  const attempts = shots.length;
  const makes = shots.filter((s) => s.made).length;
  return {
    shots,
    makes,
    attempts,
    fg_pct: attempts ? Math.round((makes / attempts) * 100) : null,
    hoop_placed: true,
  };
}

/**
 * Pair detected shots with detected reps (basketball shot poses) by closest time.
 * Adds `made` to each rep that has a matching shot outcome (within window).
 */
export function annotateRepsWithOutcomes(reps, shots, windowS = 1.5) {
  if (!shots || !shots.length) return reps;
  return reps.map((r) => {
    let best = null;
    let bestDist = Infinity;
    for (const s of shots) {
      const d = Math.abs(s.t_apex - r.time_s);
      if (d < bestDist) {
        bestDist = d;
        best = s;
      }
    }
    if (best && bestDist <= windowS) {
      return { ...r, made: best.made, shot_attempt: best.attempt };
    }
    return r;
  });
}

/**
 * Compute the avg form-measurement deltas between makes vs misses for the
 * outcome-correlated AI coaching prompt.
 */
export function makesVsMissesStats(reps) {
  const annotated = reps.filter((r) => typeof r.made === "boolean");
  if (annotated.length < 2) return null;
  const makes = annotated.filter((r) => r.made);
  const misses = annotated.filter((r) => !r.made);
  if (!makes.length || !misses.length) return null;

  const measurementKeys = new Set();
  for (const r of annotated) {
    Object.keys(r.measurements || {}).forEach((k) => measurementKeys.add(k));
  }
  const stats = {};
  for (const k of measurementKeys) {
    const m = makes.map((r) => r.measurements?.[k]).filter((v) => v != null);
    const x = misses.map((r) => r.measurements?.[k]).filter((v) => v != null);
    if (!m.length || !x.length) continue;
    const mAvg = m.reduce((a, b) => a + b, 0) / m.length;
    const xAvg = x.reduce((a, b) => a + b, 0) / x.length;
    stats[k] = {
      makes_avg: +mAvg.toFixed(1),
      misses_avg: +xAvg.toFixed(1),
      delta: +(mAvg - xAvg).toFixed(1),
      makes_n: m.length,
      misses_n: x.length,
    };
  }
  return Object.keys(stats).length ? stats : null;
}
