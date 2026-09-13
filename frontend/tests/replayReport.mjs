/**
 * One-off verification: replay the shipped resolver and the pre-fix rule over the
 * recorded real-footage fixtures and print the comparison. Not part of the test
 * suite (the same assertions live in tests/targetTracking.test.mjs) — this exists
 * to print the numbers for a report.
 *
 * Run:  node tests/replayReport.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hipCenter,
  createTrackingState,
  primeTarget,
  resolveTarget,
} from "../src/lib/targetTracking.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (n) =>
  fs
    .readFileSync(path.join(HERE, "fixtures", n), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const r = JSON.parse(l);
      return { t: r.t, poses: r.poses.map((lm) => lm.map(([x, y, visibility]) => ({ x, y, visibility }))) };
    });

function legacy(poses, anchor) {
  if (!poses.length || !anchor) return { idx: -1, anchor };
  let idx = -1;
  let best = Infinity;
  poses.forEach((lm, i) => {
    const c = hipCenter(lm);
    if (!c) return;
    const d = Math.hypot(c.x - anchor.x, c.y - anchor.y);
    if (d < best) {
      best = d;
      idx = i;
    }
  });
  if (idx === -1) return { idx: -1, anchor };
  if (best > 0.18 && poses.length > 1) return { idx: -1, anchor };
  return { idx, anchor: hipCenter(poses[idx]) };
}

const WL = 0.5;
const isRefl = (lm) => hipCenter(lm).y < WL;

function reportComposite(frames) {
  const start = frames.find((f) => f.poses.some((lm) => !isRefl(lm)));
  const startPose = start.poses.find((lm) => !isRefl(lm));

  let anchor = hipCenter(startPose);
  let lS = 0;
  let lR = 0;
  for (const f of frames) {
    const r = legacy(f.poses, anchor);
    if (r.idx === -1) continue;
    anchor = r.anchor;
    isRefl(f.poses[r.idx]) ? (lR += 1) : (lS += 1);
  }

  const run = (waterline) => {
    let state = primeTarget(createTrackingState(), startPose, start.t, waterline);
    let s = 0;
    let r = 0;
    let coast = 0;
    for (const f of frames) {
      const res = resolveTarget({ poses: f.poses, state, nowMs: f.t, waterline });
      state = res.state;
      if (res.targetIdx === -1) {
        coast += 1;
        continue;
      }
      isRefl(f.poses[res.targetIdx]) ? (r += 1) : (s += 1);
    }
    return { s, r, coast };
  };

  const noLine = run(null);
  const withLine = run(WL);
  console.log("REFLECTION COMPOSITE (163 frames, real BlazePose output)");
  console.log(`  swimmer detected alone   : ${frames.filter((f) => f.poses.some((l) => !isRefl(l)) && !f.poses.some(isRefl)).length}`);
  console.log(`  reflection detected alone: ${frames.filter((f) => !f.poses.some((l) => !isRefl(l)) && f.poses.some(isRefl)).length}`);
  console.log(`  both / neither           : ${frames.filter((f) => f.poses.some(isRefl) && f.poses.some((l) => !isRefl(l))).length} / ${frames.filter((f) => !f.poses.length).length}`);
  console.log(`  OLD rule: swimmer ${lS}, REFLECTION ${lR}  -> ${((100 * lR) / (lS + lR)).toFixed(0)}% wrongly locked`);
  console.log(`  NEW rule (no waterline)  : swimmer ${noLine.s} (${(100 * noLine.s) / (noLine.s + noLine.r + noLine.coast)}% of frames), reflection ${noLine.r}, coasted ${noLine.coast}`);
  console.log(`  NEW rule (waterline 0.5) : swimmer ${withLine.s} (${(100 * withLine.s) / (withLine.s + withLine.r + withLine.coast)}% of frames), reflection ${withLine.r}, coasted ${withLine.coast}`);
}

function reportPlain(frames) {
  const start = frames.find((f) => f.poses.length);
  let anchor = hipCenter(start.poses[0]);
  let l = 0;
  for (const f of frames) {
    const r = legacy(f.poses, anchor);
    if (r.idx === -1) continue;
    anchor = r.anchor;
    l += 1;
  }
  let state = primeTarget(createTrackingState(), start.poses[0], start.t);
  let n = 0;
  for (const f of frames) {
    const res = resolveTarget({ poses: f.poses, state, nowMs: f.t });
    state = res.state;
    if (res.targetIdx !== -1) n += 1;
  }
  const detected = frames.filter((f) => f.poses.length).length;
  console.log("\nPLAIN UNDERWATER CLIP, no reflection (163 frames)");
  console.log(`  frames with a detection  : ${detected} (${((100 * detected) / frames.length).toFixed(0)}%)`);
  console.log(`  OLD rule adopted        : ${l} (${((100 * l) / detected).toFixed(0)}% of detections)`);
  console.log(`  NEW rule adopted        : ${n} (${((100 * n) / detected).toFixed(0)}% of detections)`);
}

reportComposite(load("reflection_composite.jsonl"));
reportPlain(load("underwater_swimmer.jsonl"));
