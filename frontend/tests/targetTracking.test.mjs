/**
 * Target-tracking tests.
 *
 * Run:  cd frontend && node --test tests/targetTracking.test.mjs
 *
 * Two kinds of test:
 *   1. Synthetic sequences built to the geometry MEASURED on real footage
 *      (swimmer↔reflection offset 0.55+, motion step 0.023 median).
 *   2. Replays over recorded BlazePose output in tests/fixtures/ — the actual
 *      detector results that shaped this design. See fixtures/README.md.
 *
 * A replica of the pre-fix resolver (`legacyAdopt`) runs over identical input in
 * the regression tests: without it, "the new rule behaves" proves little.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  hipCenter,
  poseStats,
  createTrackingState,
  primeTarget,
  resolveTarget,
  rankSelectionCandidates,
  detectMirrorPairs,
  trackingBadge,
} from "../src/lib/targetTracking.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DT_MS = 1000 / 30;

/* ------------------------------ fixture loading ----------------------------- */

function loadFixture(name) {
  return fs
    .readFileSync(path.join(HERE, "fixtures", name), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const r = JSON.parse(line);
      return {
        t: r.t,
        w: r.w,
        h: r.h,
        // [x, y, visibility] -> landmark objects, as the browser runtime emits.
        poses: r.poses.map((lm) => lm.map(([x, y, visibility]) => ({ x, y, visibility }))),
      };
    });
}

/** The resolver this change replaces (PoseCanvas.jsx before the fix). */
function legacyAdopt(poses, anchor, running = false) {
  if (!poses.length || !anchor) return { idx: -1, anchor };
  let idx = -1;
  let bestD = Infinity;
  poses.forEach((lm, i) => {
    const c = hipCenter(lm);
    if (!c) return;
    const d = Math.hypot(c.x - anchor.x, c.y - anchor.y);
    if (d < bestD) {
      bestD = d;
      idx = i;
    }
  });
  if (idx === -1) return { idx: -1, anchor };
  const threshold = running ? 0.18 * 3 : 0.18;
  if (bestD > threshold && poses.length > 1) return { idx: -1, anchor }; // refuses, keeps anchor
  return { idx, anchor: hipCenter(poses[idx]) }; // single pose: adopted unconditionally
}

/* --------------------------- synthetic sequences --------------------------- */

// A swimmer and its water-surface reflection, built to the measured geometry:
// almost horizontally aligned, separated by `offset` vertically, reflection
// slightly less confident (0.6 vs 0.88).
function makePose({ cx = 0.5, cy = 0.6, height = 0.2, vis = 0.88 } = {}) {
  const s = height;
  const at = (dx, dy, v = vis) => ({ x: cx + dx * 1.6 * s, y: cy + dy * s, visibility: v });
  const lm = new Array(33).fill(null).map(() => ({ x: cx, y: cy, visibility: vis * 0.5 }));
  lm[0] = at(-0.46, -0.9); // head
  lm[11] = at(-0.30, -0.5); // shoulders
  lm[12] = at(-0.28, -0.45);
  lm[13] = at(-0.12, -0.3); // elbows
  lm[14] = at(-0.10, 0.3);
  lm[15] = at(0.02, -0.1); // wrists
  lm[16] = at(0.04, 0.7);
  lm[23] = at(0.06, -0.1); // hips
  lm[24] = at(0.08, 0.1);
  lm[25] = at(0.26, 0.4); // knees
  lm[26] = at(0.28, 0.5);
  lm[27] = at(0.44, 0.7); // ankles
  lm[28] = at(0.46, 0.8);
  return lm;
}

/**
 * Frames where the detector reports the swimmer and its reflection in the pattern
 * measured on real footage: sometimes the swimmer, sometimes only the reflection.
 */
function reflectionSequence({ frames = 90, offset = 0.55, dxPerFrame = 0.0015, swimmerDropout = [30, 42] } = {}) {
  const out = [];
  for (let i = 0; i < frames; i += 1) {
    const cx = 0.3 + dxPerFrame * i;
    const cy = 0.72;
    const poses = [];
    const swimmerVisible = !(i >= swimmerDropout[0] && i < swimmerDropout[1]);
    if (swimmerVisible) poses.push(makePose({ cx, cy }));
    // Reflection-only frames are the dangerous ones: the old rule adopts it for free.
    if (!swimmerVisible || i % 5 !== 0) {
      poses.push(makePose({ cx, cy: cy - offset, vis: 0.6 }));
    }
    out.push({ i, t: i * DT_MS, poses });
  }
  return out;
}

function replayWithNew(frames, { waterline = null, start } = {}) {
  const first = start ?? frames.find((f) => f.poses.length);
  const firstPose = first.poses[0];
  let state = primeTarget(createTrackingState(), firstPose, first.t, waterline);
  let wrong = 0;
  let right = 0;
  let coasted = 0;
  const wrongFrames = [];
  for (const f of frames) {
    const r = resolveTarget({ poses: f.poses, state, nowMs: f.t, waterline });
    state = r.state;
    if (r.targetIdx === -1) {
      coasted += 1;
      continue;
    }
    const c = hipCenter(f.poses[r.targetIdx]);
    const isSwimmer = isSwimmerPose(f, c);
    if (isSwimmer) right += 1;
    else {
      wrong += 1;
      wrongFrames.push(f.i ?? f.t);
    }
  }
  return { wrong, right, coasted, wrongFrames };
}

// Ground truth for the synthetic sequence: the swimmer is the pose at y≈0.72.
// If the swimmer isn't in frame at all, then any pose that was adopted IS the
// reflection — adopting anything there is a failure, not a free pass.
function isSwimmerPose(f, center) {
  const swimmer = f.poses.find((lm) => Math.abs(hipCenter(lm).y - 0.72) < 0.1);
  if (!swimmer) return false;
  return Math.abs(hipCenter(swimmer).y - center.y) < 0.1;
}

function replayWithLegacy(frames) {
  const first = frames.find((f) => f.poses.length);
  let anchor = hipCenter(first.poses[0]);
  let wrong = 0;
  let right = 0;
  for (const f of frames) {
    const res = legacyAdopt(f.poses, anchor);
    if (res.idx !== -1) {
      anchor = res.anchor;
      const c = hipCenter(f.poses[res.idx]);
      if (isSwimmerPose(f, c)) right += 1;
      else wrong += 1;
    }
  }
  return { wrong, right };
}

/* ------------------------------- unit checks ------------------------------- */

test("poseStats reports centre, confidence and completeness", () => {
  const lm = makePose({ cx: 0.3, cy: 0.7, vis: 0.9 });
  const s = poseStats(lm, 0);
  const hip = hipCenter(lm);
  assert.ok(Math.abs(s.center.x - hip.x) < 1e-9);
  assert.ok(Math.abs(s.center.y - hip.y) < 1e-9);
  assert.ok(s.meanVis > 0.5);
  assert.equal(s.complete, 1);
});

test("detectMirrorPairs finds a subject and its reflection using measured geometry", () => {
  const swimmer = makePose({ cx: 0.5, cy: 0.72, vis: 0.85 });
  const refl = makePose({ cx: 0.52, cy: 0.72 - 0.55, vis: 0.6 });
  const pairs = detectMirrorPairs([poseStats(swimmer, 0), poseStats(refl, 1)]);
  assert.equal(pairs.length, 1);
  assert.ok(pairs[0].dy > 0.5);
  assert.equal(pairs[0].likelySubject, 0);
});

test("detectMirrorPairs ignores two subjects that are not vertically stacked", () => {
  const a = makePose({ cx: 0.3, cy: 0.6 });
  const b = makePose({ cx: 0.75, cy: 0.62 });
  assert.equal(detectMirrorPairs([poseStats(a, 0), poseStats(b, 1)]).length, 0);
});

test("selection reports ambiguity between a swimmer and its reflection", () => {
  const swimmer = makePose({ cx: 0.5, cy: 0.72, vis: 0.7 });
  const refl = makePose({ cx: 0.5, cy: 0.17, vis: 0.7 });
  const ranked = rankSelectionCandidates({ poses: [swimmer, refl], point: { x: 0.5, y: 0.445 } });
  assert.equal(ranked.mirrorPairs.length, 1);
  assert.equal(ranked.ambiguous, true);
});

test("selection breaks a tie toward the more confident pose", () => {
  const swimmer = makePose({ cx: 0.5, cy: 0.72, vis: 0.85 });
  const refl = makePose({ cx: 0.5, cy: 0.17, vis: 0.55 });
  const ranked = rankSelectionCandidates({ poses: [swimmer, refl], point: { x: 0.5, y: 0.445 } });
  assert.equal(ranked.ambiguous, false);
  assert.equal(ranked.selection.index, 0);
});

test("selection follows the pose the user tapped", () => {
  const swimmer = makePose({ cx: 0.5, cy: 0.72, vis: 0.85 });
  const refl = makePose({ cx: 0.5, cy: 0.17, vis: 0.55 });
  const ranked = rankSelectionCandidates({ poses: [swimmer, refl], point: { x: 0.5, y: 0.18 } });
  assert.equal(ranked.selection.index, 1);
});

test("an isolated pose far from the expectation is never adopted", () => {
  const state = primeTarget(createTrackingState(), makePose({ cx: 0.2, cy: 0.7 }), 0);
  const r = resolveTarget({
    poses: [makePose({ cx: 0.85, cy: 0.3 })],
    state,
    nowMs: DT_MS,
  });
  assert.equal(r.targetIdx, -1);
  assert.equal(r.status, "coasting");
});

test("identity is held through a dropout, and the gate keeps opening", () => {
  let state = primeTarget(createTrackingState(), makePose({ cx: 0.4, cy: 0.7 }), 0);
  let r = resolveTarget({ poses: [], state, nowMs: 3 * DT_MS });
  assert.equal(r.status, "coasting");
  state = r.state;
  r = resolveTarget({ poses: [], state, nowMs: 4000 });
  assert.equal(r.status, "lost");
  // The swimmer reappears well outside the base gate: the opened gate recovers it.
  state = r.state;
  r = resolveTarget({ poses: [makePose({ cx: 0.47, cy: 0.68 })], state, nowMs: 4100 });
  assert.equal(r.targetIdx, 0);
});

test("badge reflects tracker status", () => {
  assert.equal(trackingBadge({ status: "tracking" }).level, "good");
  assert.equal(trackingBadge({ status: "recovered" }).level, "good");
  assert.equal(trackingBadge({ status: "coasting" }).level, "warn");
  assert.equal(trackingBadge({ status: "lost" }).level, "poor");
});

/* --------------------------- synthetic regression --------------------------- */

test("SYNTHETIC: the old rule follows the reflection; the new rule does not", () => {
  const frames = reflectionSequence();
  const legacy = replayWithLegacy(frames);
  const current = replayWithNew(frames);
  assert.ok(legacy.wrong > 10, `expected the old rule to adopt the reflection, got ${legacy.wrong} frames`);
  assert.equal(current.wrong, 0, `new rule adopted the reflection on frames ${current.wrongFrames.join(",")}`);
  assert.ok(current.right > 30, `new rule starved itself (${current.right} confirmations)`);
});

test("SYNTHETIC: without the waterline the rule still never adopts the reflection", () => {
  // The separation is what protects it, not the waterline: keeping the gate well
  // below the measured 0.55 offset is the primary defence.
  const frames = reflectionSequence({ offset: 0.55 });
  const current = replayWithNew(frames, { waterline: null });
  assert.equal(current.wrong, 0);
});

/* ----------------------------- real-data replays ---------------------------- */

const COMPOSITE = loadFixture("reflection_composite.jsonl");
const PLAIN = loadFixture("underwater_swimmer.jsonl");
const WATERLINE = 0.5; // by construction of the composite: above = reflection

const isReflection = (lm) => hipCenter(lm).y < WATERLINE;

test("REAL FOOTAGE: the old rule locked the reflection for 36% of adopted frames", () => {
  const start = COMPOSITE.find((f) => f.poses.some((lm) => !isReflection(lm)));
  let anchor = hipCenter(start.poses.find((lm) => !isReflection(lm)));
  let refl = 0;
  let swimmer = 0;
  for (const f of COMPOSITE) {
    const res = legacyAdopt(f.poses, anchor);
    if (res.idx === -1) continue;
    const lm = f.poses[res.idx];
    anchor = res.anchor;
    if (isReflection(lm)) refl += 1;
    else swimmer += 1;
  }
  assert.ok(swimmer > 50, `expected the old rule to mostly track the swimmer (got ${swimmer})`);
  assert.ok(refl / (refl + swimmer) > 0.2, `expected a large reflection share, got ${refl}/${refl + swimmer}`);
});

test("REAL FOOTAGE: the new rule never adopts the reflection", () => {
  const start = COMPOSITE.find((f) => f.poses.some((lm) => !isReflection(lm)));
  const run = (waterline) => {
    let state = primeTarget(
      createTrackingState(),
      start.poses.find((lm) => !isReflection(lm)),
      start.t,
      waterline
    );
    let refl = 0;
    let swimmer = 0;
    const bad = [];
    for (const f of COMPOSITE) {
      const r = resolveTarget({ poses: f.poses, state, nowMs: f.t, waterline });
      state = r.state;
      if (r.targetIdx === -1) continue;
      if (isReflection(f.poses[r.targetIdx])) {
        refl += 1;
        bad.push(f.t);
      } else swimmer += 1;
    }
    return { refl, swimmer, bad };
  };
  // Both configurations must be clean: the swimmer↔reflection separation (0.55+)
  // is what protects the no-waterline case, and the waterline protects shallow
  // angles where the reflection sits closer than the gate.
  const withLine = run(WATERLINE);
  const noLine = run(null);
  assert.equal(withLine.refl, 0, `adopted the reflection at t=${withLine.bad.join(",")}`);
  assert.equal(noLine.refl, 0, `adopted the reflection at t=${noLine.bad.join(",")}`);
  assert.ok(withLine.swimmer >= 30, `swimmer confirmations too low (${withLine.swimmer})`);
  assert.ok(noLine.swimmer >= 30, `swimmer confirmations too low (${noLine.swimmer})`);
});

test("REAL FOOTAGE: the waterline unlocks recovery, so fewer frames are dropped", () => {
  const start = COMPOSITE.find((f) => f.poses.some((lm) => !isReflection(lm)));
  const run = (waterline) => {
    let state = primeTarget(
      createTrackingState(),
      start.poses.find((lm) => !isReflection(lm)),
      start.t,
      waterline
    );
    let adopted = 0;
    for (const f of COMPOSITE) {
      const r = resolveTarget({ poses: f.poses, state, nowMs: f.t, waterline });
      state = r.state;
      if (r.targetIdx !== -1) adopted += 1;
    }
    return adopted;
  };
  const withLine = run(WATERLINE);
  const withoutLine = run(null);
  assert.ok(
    withLine > withoutLine,
    `waterline should improve adoption (with ${withLine} vs without ${withoutLine})`
  );
});

test("REAL FOOTAGE (no reflection): the new rule does not starve normal footage", () => {
  const start = PLAIN.find((f) => f.poses.length);
  let state = primeTarget(createTrackingState(), start.poses[0], start.t);
  let adopted = 0;
  for (const f of PLAIN) {
    const r = resolveTarget({ poses: f.poses, state, nowMs: f.t });
    state = r.state;
    if (r.targetIdx !== -1) adopted += 1;
  }
  const detected = PLAIN.filter((f) => f.poses.length).length;
  const rate = adopted / detected;
  assert.ok(rate > 0.8, `only adopted ${adopted}/${detected} (${(rate * 100).toFixed(0)}%) of a plain clip`);
});
