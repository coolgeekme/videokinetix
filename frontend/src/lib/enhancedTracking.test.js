import {
  findTrackAtPoint,
  normalizeTrackedBoxes,
  paddedTrackRoi,
  poseIndexInsideTrack,
} from "./enhancedTracking";

describe("enhanced athlete tracking helpers", () => {
  test("normalizes only confirmed Supervision tracks", () => {
    const tracks = normalizeTrackedBoxes(
      [
        { tracker_id: 7, confirmed: true, confidence: 0.8, xyxy: [64, 36, 192, 324] },
        { tracker_id: -1, confirmed: false, confidence: 0.4, xyxy: [0, 0, 10, 10] },
      ],
      640,
      360
    );
    expect(tracks).toEqual([
      { id: 7, confidence: 0.8, x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.9 },
    ]);
  });

  test("uses the tighter box when selectable athletes overlap", () => {
    const broad = { id: 1, x1: 0.1, y1: 0.1, x2: 0.8, y2: 0.9 };
    const tight = { id: 2, x1: 0.35, y1: 0.2, x2: 0.55, y2: 0.8 };
    expect(findTrackAtPoint([broad, tight], { x: 0.45, y: 0.5 })).toBe(tight);
  });

  test("pads a selected player box without leaving the frame", () => {
    expect(paddedTrackRoi({ x1: 0, y1: 0.05, x2: 0.2, y2: 0.9 })).toMatchObject({
      x: 0,
      y: 0,
    });
  });

  test("selects the pose whose hip center is inside the persistent box", () => {
    const poses = [{ center: { x: 0.2, y: 0.5 } }, { center: { x: 0.7, y: 0.5 } }];
    const index = poseIndexInsideTrack(
      poses,
      { x1: 0.6, y1: 0.1, x2: 0.8, y2: 0.9 },
      (pose) => pose.center
    );
    expect(index).toBe(1);
  });
});

