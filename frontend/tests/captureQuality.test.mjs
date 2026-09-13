/**
 * Capture-quality guard tests.
 *
 * Run:  cd frontend && node --test tests/captureQuality.test.mjs
 *
 * The guard exists because a real user clip produced a confident-looking report
 * whose every number came from water: the pose detector never found the swimmer,
 * so the app tracked the surface reflection instead. These tests pin both
 * directions — a bad capture must be refused, and real footage must not be.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  frameMetrics,
  assessCaptureQuality,
} from "../src/lib/captureQuality.js";
import { analyzeSession } from "../src/lib/repDetection.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function loadFrames(name) {
  return fs
    .readFileSync(path.join(HERE, "fixtures", name), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const r = JSON.parse(l);
      return {
        t: r.t / 1000,
        lm: r.poses.length
          ? r.poses[0].map((p) =>
              Array.isArray(p)
                ? { x: p[0], y: p[1], visibility: p[2] }
                : { x: p.x, y: p.y, visibility: p.v ?? p.visibility ?? 0 }
            )
          : null,
      };
    });
}

/* ------------------------------- frameMetrics ------------------------------ */

test("frameMetrics measures a body in profile", () => {
  // A swimmer side-on: wide, in frame, joints confident.
  const lm = new Array(33).fill(null).map((_, i) => ({
    x: 0.2 + (i % 8) * 0.08,
    y: 0.5 + (i % 5) * 0.01,
    visibility: 0.9,
  }));
  const m = frameMetrics(lm);
  assert.ok(m.aspect < 1, `profile pose should not be tall (aspect ${m.aspect})`);
  assert.equal(m.offFrame, 0);
  assert.equal(m.keyVisibility, 1);
});

test("frameMetrics flags a tall, smeared shape with joints off-frame", () => {
  // The signature of a surface reflection: a vertical streak running off the top
  // of the frame, with the joints poorly located.
  const lm = new Array(33).fill(null).map((_, i) => ({
    x: 0.42 + (i % 3) * 0.01,
    y: -0.1 + (i / 33) * 0.5,
    visibility: 0.2, // below the 0.3 "located" bar
  }));
  const m = frameMetrics(lm);
  assert.ok(m.aspect > 2, `expected a tall shape, got ${m.aspect}`);
  assert.ok(m.offFrame > 0.1, `expected joints off-frame, got ${m.offFrame}`);
  assert.equal(m.keyVisibility, 0);
});

/* --------------------------- real footage: pass ---------------------------- */

test("REAL FOOTAGE: a clean side-on swim clip is rated good", () => {
  const q = assessCaptureQuality({ frames: loadFrames("underwater_swimmer.jsonl") });
  assert.equal(q.level, "good");
  assert.ok(q.metrics.medianAspect < 1.5);
  assert.equal(q.metrics.medianOffFrame, 0);
});

test("REAL FOOTAGE: a clip that contains both swimmer and reflection is not refused", () => {
  // The composite has real swimmer detections in it, so it stays analysable —
  // the guard must not throw away footage just because water is present.
  const q = assessCaptureQuality({ frames: loadFrames("reflection_composite.jsonl") });
  assert.notEqual(q.level, "unusable");
});

/* --------------------------- synthetic: refuse ----------------------------- */

/** A capture whose every "detection" is the tall smeared surface streak. */
function reflectionCapture(frames = 60) {
  return Array.from({ length: frames }, (_, i) => ({
    t: i / 15,
    lm: new Array(33).fill(null).map((_, j) => ({
      x: 0.42 + (j % 3) * 0.01,
      y: -0.12 + (j / 33) * 0.5,
      visibility: 0.4,
    })),
  }));
}

test("a capture of nothing but surface reflection is refused", () => {
  const q = assessCaptureQuality({ frames: reflectionCapture() });
  assert.equal(q.level, "unusable");
  assert.ok(
    q.reasons.some((r) => /reflection/i.test(r)),
    `expected a reflection reason, got ${JSON.stringify(q.reasons)}`
  );
  assert.ok(q.advice.length > 0, "should tell the user how to fix the framing");
});

test("a capture with almost no frames is refused", () => {
  const q = assessCaptureQuality({ frames: reflectionCapture(4).slice(0, 4) });
  assert.equal(q.level, "unusable");
});

test("a low tracking confirmation ratio is reported", () => {
  const frames = reflectionCapture(40).map((f, i) => (i % 4 === 0 ? f : { t: f.t, lm: null }));
  const q = assessCaptureQuality({
    frames,
    tracking: { confirmed: 10, coasted: 90, lost: 0 },
  });
  assert.equal(q.level, "unusable");
  assert.ok(q.metrics.confirmedRatio === 0.1);
});

/* ------------------------- integration with the analysis ------------------ */

test("analysis refuses to report metrics for an unusable capture", () => {
  const frames = reflectionCapture();
  const captureQuality = assessCaptureQuality({ frames });
  const analysis = analyzeSession(frames, "swimming", { captureQuality });
  assert.equal(analysis.reliable, undefined); // only the report-level flag is set
  assert.equal(analysis.unreliable, true);
  assert.equal(analysis.rep_count, 0);
  assert.deepEqual(analysis.reps, []);
  assert.equal(analysis.overall_score, null);
  assert.equal(analysis.no_reps_detected, true);
  assert.equal(analysis.capture_quality.level, "unusable");
});

test("a good capture is analysed normally (guard does not block the happy path)", () => {
  // Synthesised freestyle-ish frames: alternating wrist heights at ~1 stroke/s.
  const frames = Array.from({ length: 180 }, (_, i) => {
    const t = i / 30;
    const phase = (t * 2 * Math.PI) / 1.1;
    const lm = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.55, visibility: 0.95 }));
    lm[0] = { x: 0.35, y: 0.5, visibility: 0.95 };
    lm[11] = { x: 0.42, y: 0.52, visibility: 0.95 };
    lm[12] = { x: 0.44, y: 0.54, visibility: 0.95 };
    lm[13] = { x: 0.5, y: 0.55, visibility: 0.95 };
    lm[14] = { x: 0.52, y: 0.57, visibility: 0.95 };
    lm[15] = { x: 0.6, y: 0.5 + 0.1 * Math.sin(phase), visibility: 0.95 };
    lm[16] = { x: 0.62, y: 0.5 + 0.1 * Math.sin(phase + Math.PI), visibility: 0.95 };
    lm[23] = { x: 0.62, y: 0.56, visibility: 0.95 };
    lm[24] = { x: 0.64, y: 0.58, visibility: 0.95 };
    lm[25] = { x: 0.72, y: 0.6, visibility: 0.95 };
    lm[26] = { x: 0.74, y: 0.62, visibility: 0.95 };
    lm[27] = { x: 0.82, y: 0.64, visibility: 0.95 };
    lm[28] = { x: 0.84, y: 0.66, visibility: 0.95 };
    return { t, lm };
  });
  const captureQuality = assessCaptureQuality({ frames });
  assert.notEqual(captureQuality.level, "unusable");
  const analysis = analyzeSession(frames, "swimming", { captureQuality });
  assert.ok(!analysis.unreliable, "a tracked capture should not be refused");
  assert.ok(analysis.rep_count > 0, `expected strokes to be detected, got ${analysis.rep_count}`);
});
