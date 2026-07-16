import { analyzeSession } from "./repDetection";

function swimmingFrame(t) {
  const pose = Array.from({ length: 33 }, () => null);
  const phase = Math.sin(Math.PI * t);
  const leftReach = 0.12 + 0.16 * (1 + phase) / 2;
  const rightReach = 0.12 + 0.16 * (1 - phase) / 2;
  pose[11] = { x: 0.45, y: 0.5, visibility: 0.95 };
  pose[12] = { x: 0.55, y: 0.5, visibility: 0.95 };
  pose[13] = { x: 0.38, y: 0.52, visibility: 0.9 };
  pose[14] = { x: 0.62, y: 0.52, visibility: 0.9 };
  pose[15] = { x: 0.45 - leftReach, y: 0.54, visibility: 0.9 };
  pose[16] = { x: 0.55 + rightReach, y: 0.54, visibility: 0.9 };
  // Head-on underwater capture: hips exist in the model output but are not
  // sufficiently visible to be trusted by motion capture.
  pose[23] = { x: 0.48, y: 0.62, visibility: 0.03 };
  pose[24] = { x: 0.52, y: 0.62, visibility: 0.03 };
  return { t, lm: pose };
}

test("counts alternating horizontal arm cycles without visible hips", () => {
  const frames = Array.from({ length: 181 }, (_, index) =>
    swimmingFrame(index / 30)
  );

  const analysis = analyzeSession(frames, "swimming");

  expect(analysis.rep_count).toBeGreaterThanOrEqual(5);
  expect(analysis.reps.every((rep) => rep.measurements.body_roll_y == null)).toBe(true);
  expect(
    analysis.reps.every((rep) => Number.isFinite(rep.measurements.shoulder_tilt_deg))
  ).toBe(true);
});
