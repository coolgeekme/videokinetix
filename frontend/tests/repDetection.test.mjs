/**
 * Rep-detection robustness tests.
 *
 * Run:  cd frontend && node --test tests/repDetection.test.mjs
 *
 * The capture records {t, lm: null} for every frame in which the target wasn't
 * detected, so the timeline stays continuous. A stroke peak can therefore land
 * on a null frame — and the sport-specific `apex` code dereferences landmarks.
 * That threw `TypeError: Cannot read properties of null`, which the caller
 * catches and reports as "no reps detected": a silent degrade on any session
 * with detection gaps. Swimming loses its athlete for a large share of frames,
 * so it hit this routinely.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { analyzeSession } from "../src/lib/repDetection.js";
import { L } from "../src/lib/repDetectionConstants.js";

/** The shipped swimming `apex` body, reproduced so the regression is explicit. */
function swimmingApex(lm) {
  const lY = lm[L.LEFT_WRIST]?.y ?? 1;
  const rY = lm[L.RIGHT_WRIST]?.y ?? 1;
  const isLeft = lY < rY;
  const shoulder = isLeft ? lm[L.LEFT_SHOULDER] : lm[L.RIGHT_SHOULDER];
  const elbow = isLeft ? lm[L.LEFT_ELBOW] : lm[L.RIGHT_ELBOW];
  const wrist = isLeft ? lm[L.LEFT_WRIST] : lm[L.RIGHT_WRIST];
  return { catch_elbow_angle: 120 + (shoulder.y + elbow.y + wrist.y) * 0 };
}

/**
 * A side-on freestyle swimmer: the swimming rep signal is
 * `1 - min(leftWrist.y, rightWrist.y)`, so alternating wrist heights at
 * `periodSec` give one peak per stroke. `nullPeakFrames` blanks the landmarks on
 * the frame carrying each stroke peak, reproducing a detection dropout exactly
 * where it hurts.
 */
function swimFrames({ seconds = 6, fps = 30, periodSec = 1.1, nullPeakFrames = false } = {}) {
  const n = Math.round(seconds * fps);
  const frames = [];
  for (let i = 0; i < n; i++) {
    const t = i / fps;
    const phase = (t / periodSec) % 1;
    // Wrist rises through the first half of the cycle, peaks at phase 0.5.
    const lift = Math.sin(Math.PI * phase);
    const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.55, visibility: 0.95 }));
    lm[0] = { x: 0.35, y: 0.5, visibility: 0.95 };
    lm[L.LEFT_SHOULDER] = { x: 0.42, y: 0.52, visibility: 0.95 };
    lm[L.RIGHT_SHOULDER] = { x: 0.44, y: 0.54, visibility: 0.95 };
    lm[L.LEFT_ELBOW] = { x: 0.5, y: 0.55, visibility: 0.95 };
    lm[L.RIGHT_ELBOW] = { x: 0.52, y: 0.57, visibility: 0.95 };
    lm[L.LEFT_WRIST] = { x: 0.6, y: 0.55 - 0.15 * lift, visibility: 0.95 };
    lm[L.RIGHT_WRIST] = { x: 0.62, y: 0.6, visibility: 0.95 };
    lm[L.LEFT_HIP] = { x: 0.62, y: 0.56, visibility: 0.95 };
    lm[L.RIGHT_HIP] = { x: 0.64, y: 0.58, visibility: 0.95 };
    lm[L.LEFT_KNEE] = { x: 0.72, y: 0.6, visibility: 0.95 };
    lm[L.RIGHT_KNEE] = { x: 0.74, y: 0.62, visibility: 0.95 };
    lm[L.LEFT_ANKLE] = { x: 0.82, y: 0.64, visibility: 0.95 };
    lm[L.RIGHT_ANKLE] = { x: 0.84, y: 0.66, visibility: 0.95 };
    const atPeak = Math.abs(phase - 0.5) < 1 / (2 * periodSec * fps);
    const drop = nullPeakFrames && atPeak;
    frames.push({ t, lm: drop ? null : lm });
  }
  return frames;
}

test("the pre-fix path really did throw on a null landmark frame", () => {
  // Documents why the filter exists: this is the exact call analyzeSession used
  // to make with a peak that landed on an undetected frame.
  assert.throws(() => swimmingApex(null), TypeError);
});

test("analysis survives stroke peaks that land on undetected frames", () => {
  const frames = swimFrames({ nullPeakFrames: true });
  const nulls = frames.filter((f) => !f.lm).length;
  assert.ok(nulls >= 4, `expected the fixture to blank several frames, got ${nulls}`);

  let analysis;
  assert.doesNotThrow(() => {
    analysis = analyzeSession(frames, "swimming");
  }, "a detection gap at a stroke peak must not throw");

  assert.ok(Array.isArray(analysis.reps));
  // Every reported rep must sit on a frame that actually has landmarks.
  for (const r of analysis.reps) {
    assert.ok(frames[r.frame_index]?.lm, `rep ${r.index} references an undetected frame`);
    assert.ok(Number.isFinite(r.measurements?.catch_elbow_angle));
  }
});

test("a clean swimming capture still detects its strokes", () => {
  const frames = swimFrames({ seconds: 6, periodSec: 1.1, nullPeakFrames: false });
  const analysis = analyzeSession(frames, "swimming");
  // ~5.4 strokes in 6s at a 1.1s cycle.
  assert.ok(
    analysis.rep_count >= 4 && analysis.rep_count <= 6,
    `expected ~5 strokes, got ${analysis.rep_count}`
  );
  assert.ok(!analysis.unreliable);
  assert.ok(!analysis.no_reps_detected);
});
