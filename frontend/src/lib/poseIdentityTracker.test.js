import { PoseIdentityTracker } from "./poseIdentityTracker";

function makePose(x, y = 0.55, size = 1) {
  const pose = Array.from({ length: 33 }, () => ({ x, y, visibility: 1 }));
  const sx = 0.08 * size;
  const sy = 0.12 * size;
  pose[0] = { x, y: y - sy * 2.5, visibility: 1 };
  pose[11] = { x: x - sx, y: y - sy, visibility: 1 };
  pose[12] = { x: x + sx, y: y - sy, visibility: 1 };
  pose[13] = { x: x - sx * 1.4, y, visibility: 1 };
  pose[14] = { x: x + sx * 1.4, y, visibility: 1 };
  pose[15] = { x: x - sx * 1.6, y: y + sy, visibility: 1 };
  pose[16] = { x: x + sx * 1.6, y: y + sy, visibility: 1 };
  pose[23] = { x: x - sx * 0.65, y, visibility: 1 };
  pose[24] = { x: x + sx * 0.65, y, visibility: 1 };
  pose[25] = { x: x - sx * 0.65, y: y + sy * 1.5, visibility: 1 };
  pose[26] = { x: x + sx * 0.65, y: y + sy * 1.5, visibility: 1 };
  pose[27] = { x: x - sx * 0.65, y: y + sy * 3, visibility: 1 };
  pose[28] = { x: x + sx * 0.65, y: y + sy * 3, visibility: 1 };
  return pose;
}

describe("PoseIdentityTracker", () => {
  test("keeps IDs stable when MediaPipe changes detection order", () => {
    const tracker = new PoseIdentityTracker();
    const first = tracker.update([makePose(0.25), makePose(0.75, 0.55, 1.2)], 0);
    const leftId = first.byPoseIndex.get(0).id;
    const rightId = first.byPoseIndex.get(1).id;

    const second = tracker.update(
      [makePose(0.72, 0.55, 1.2), makePose(0.28)],
      40
    );
    expect(second.byPoseIndex.get(0).id).toBe(rightId);
    expect(second.byPoseIndex.get(1).id).toBe(leftId);
  });

  test("uses motion prediction to preserve crossing identities", () => {
    const tracker = new PoseIdentityTracker();
    let result = tracker.update([makePose(0.2), makePose(0.8, 0.55, 1.2)], 0);
    const movingRightId = result.byPoseIndex.get(0).id;
    const movingLeftId = result.byPoseIndex.get(1).id;

    result = tracker.update([makePose(0.35), makePose(0.65, 0.55, 1.2)], 100);
    result = tracker.update([makePose(0.52, 0.55, 1.2), makePose(0.48)], 200);

    expect(result.byPoseIndex.get(0).id).toBe(movingLeftId);
    expect(result.byPoseIndex.get(1).id).toBe(movingRightId);
  });

  test("recovers the same ID after a short occlusion", () => {
    const tracker = new PoseIdentityTracker({ maxTrackAgeMs: 1500 });
    let result = tracker.update([makePose(0.3)], 0);
    const id = result.byPoseIndex.get(0).id;
    tracker.update([], 300);
    tracker.update([], 600);
    result = tracker.update([makePose(0.34)], 800);
    expect(result.byPoseIndex.get(0).id).toBe(id);
  });

  test("does not assign a distant replacement to the selected track", () => {
    const tracker = new PoseIdentityTracker();
    let result = tracker.update([makePose(0.15)], 0);
    const selectedId = result.byPoseIndex.get(0).id;
    result = tracker.update([makePose(0.85)], 100);

    expect(result.byPoseIndex.get(0).id).not.toBe(selectedId);
    expect(tracker.getTrack(selectedId).landmarks).toBeNull();
  });

  test("keeps a paused upload selection alive when recording starts", () => {
    const tracker = new PoseIdentityTracker({ maxTrackAgeMs: 1000 });
    let result = tracker.update([makePose(0.4)], 0);
    const selectedId = result.byPoseIndex.get(0).id;
    expect(tracker.touchTrack(selectedId, 5000)).toBe(true);

    result = tracker.update([makePose(0.41)], 5040);
    expect(result.byPoseIndex.get(0).id).toBe(selectedId);
  });

  test("binds a targeted ROI pose to the selected identity", () => {
    const tracker = new PoseIdentityTracker();
    let result = tracker.update([makePose(0.45)], 0);
    const selectedId = result.byPoseIndex.get(0).id;

    // Simulate the large geometry change between a crouched full-frame pose
    // and the first close-up moving frame. Ordinary matching may reject this,
    // but the user-selected ROI is authoritative.
    result = tracker.update([makePose(0.7, 0.62, 0.55)], 40, {
      forcedTrackId: selectedId,
    });

    expect(result.byPoseIndex.get(0).id).toBe(selectedId);
    expect(result.tracks.filter((track) => track.landmarks)).toHaveLength(1);
  });
});
