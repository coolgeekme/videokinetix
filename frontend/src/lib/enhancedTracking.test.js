import {
  EnhancedTrackingClient,
  findTrackAtPoint,
  mergePersonDetections,
  normalizeTrackedBoxes,
  paddedTrackRoi,
  poseDetectionsFromLandmarks,
  poseIndexInsideTrack,
  poseMatchesTrack,
  removeUnderwaterReflections,
  removeUnderwaterReflectionPoses,
} from "./enhancedTracking";

describe("enhanced athlete tracking helpers", () => {
  test("recreates a stale backend tracking session and retries the frame", async () => {
    const api = {
      get: jest.fn().mockResolvedValue({ data: { ready: true } }),
      post: jest
        .fn()
        .mockRejectedValueOnce({ response: { status: 404 } })
        .mockResolvedValueOnce({
          data: { session_id: "fresh-session", engine: "roboflow-botsort" },
        })
        .mockResolvedValueOnce({
          data: {
            tracks: [
              {
                tracker_id: 9,
                confirmed: true,
                confidence: 0.9,
                xyxy: [64, 36, 192, 324],
              },
            ],
          },
        }),
    };
    const client = new EnhancedTrackingClient(api);
    client.sessionId = "stale-session";
    client.canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: jest.fn() }),
      toBlob: (callback) => callback(new Blob(["frame"], { type: "image/jpeg" })),
    };
    const video = { videoWidth: 640, videoHeight: 360 };
    const detector = { detectForVideo: jest.fn().mockReturnValue({ detections: [] }) };

    const tracks = await client.process(video, detector, 1000);

    expect(client.sessionId).toBe("fresh-session");
    expect(api.post.mock.calls.map(([url]) => url)).toEqual([
      "/tracking/sessions/stale-session/frame",
      "/tracking/sessions",
      "/tracking/sessions/fresh-session/frame",
    ]);
    expect(tracks).toEqual([
      { id: 9, confidence: 0.9, x1: 0.1, y1: 0.1, x2: 0.3, y2: 0.9 },
    ]);
  });

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

  test("turns visible pose landmarks into a high-confidence person box", () => {
    const pose = Array.from({ length: 33 }, () => null);
    [11, 12, 23, 24, 25, 26].forEach((index, offset) => {
      pose[index] = {
        x: 0.4 + (offset % 2) * 0.1,
        y: 0.2 + Math.floor(offset / 2) * 0.25,
        visibility: 0.9,
      };
    });

    const detections = poseDetectionsFromLandmarks([pose], 640, 360);

    expect(detections).toHaveLength(1);
    expect(detections[0].confidence).toBeCloseTo(0.9);
    expect(detections[0].xyxy[0]).toBeLessThan(0.4 * 640);
    expect(detections[0].xyxy[2]).toBeGreaterThan(0.5 * 640);
  });

  test("keeps detector boxes authoritative and uses poses only for missed people", () => {
    const poseBox = { xyxy: [100, 40, 220, 300], confidence: 0.9 };
    const duplicate = { xyxy: [105, 45, 215, 295], confidence: 0.5 };
    const otherPlayer = { xyxy: [400, 40, 520, 300], confidence: 0.8 };
    const missedPlayerPose = { xyxy: [250, 50, 330, 290], confidence: 0.85 };

    expect(mergePersonDetections(
      [duplicate, otherPlayer],
      [poseBox, missedPlayerPose]
    )).toEqual([
      duplicate,
      otherPlayer,
      missedPlayerPose,
    ]);
  });

  test("rejects a fused pose box spanning two detected athletes", () => {
    const leftPlayer = { xyxy: [80, 40, 140, 300], confidence: 0.8 };
    const rightPlayer = { xyxy: [210, 50, 270, 300], confidence: 0.8 };
    const fusedPose = { xyxy: [70, 30, 280, 310], confidence: 0.95 };

    expect(mergePersonDetections([leftPlayer, rightPlayer], [fusedPose])).toEqual([
      leftPlayer,
      rightPlayer,
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

  test("rejects a skeleton whose core landmarks span neighboring players", () => {
    const pose = Array.from({ length: 33 }, () => null);
    pose[11] = { x: 0.2, y: 0.25, visibility: 0.9 };
    pose[12] = { x: 0.42, y: 0.25, visibility: 0.9 };
    pose[23] = { x: 0.21, y: 0.52, visibility: 0.9 };
    pose[24] = { x: 0.43, y: 0.52, visibility: 0.9 };
    pose[25] = { x: 0.22, y: 0.72, visibility: 0.9 };
    pose[26] = { x: 0.44, y: 0.72, visibility: 0.9 };

    expect(poseMatchesTrack(
      pose,
      { x1: 0.38, y1: 0.15, x2: 0.48, y2: 0.8 }
    )).toBe(false);
  });

  test("accepts a coherent skeleton inside the selected player box", () => {
    const pose = Array.from({ length: 33 }, () => null);
    pose[11] = { x: 0.41, y: 0.25, visibility: 0.9 };
    pose[12] = { x: 0.45, y: 0.25, visibility: 0.9 };
    pose[23] = { x: 0.415, y: 0.5, visibility: 0.9 };
    pose[24] = { x: 0.445, y: 0.5, visibility: 0.9 };
    pose[25] = { x: 0.415, y: 0.68, visibility: 0.9 };
    pose[26] = { x: 0.445, y: 0.68, visibility: 0.9 };

    expect(poseMatchesTrack(
      pose,
      { x1: 0.38, y1: 0.15, x2: 0.48, y2: 0.8 }
    )).toBe(true);
  });

  test("removes surface reflections but keeps the submerged swimmer", () => {
    const reflection = { xyxy: [100, 0, 220, 150], confidence: 0.9 };
    const deepReflection = { xyxy: [80, 90, 240, 310], confidence: 0.8 };
    const swimmer = { xyxy: [90, 170, 260, 430], confidence: 0.7 };
    expect(removeUnderwaterReflections(
      [reflection, deepReflection, swimmer],
      500
    )).toEqual([
      swimmer,
    ]);
  });

  test("removes reflection skeletons before motion capture", () => {
    const makePose = (centerY) => Array.from({ length: 33 }, (_, index) => ({
      x: 0.5 + ((index % 2) ? 0.02 : -0.02),
      y: centerY + ((index % 3) - 1) * 0.04,
      visibility: 0.9,
    }));
    const reflectionPose = makePose(0.18);
    const swimmerPose = makePose(0.68);

    expect(removeUnderwaterReflectionPoses([reflectionPose, swimmerPose])).toEqual([
      swimmerPose,
    ]);
  });

  test("keeps a distant real swimmer near the waterline", () => {
    const makePose = (centerY) => Array.from({ length: 33 }, (_, index) => ({
      x: 0.5 + ((index % 2) ? 0.02 : -0.02),
      y: centerY + ((index % 3) - 1) * 0.025,
      visibility: 0.9,
    }));
    const surfaceReflection = makePose(0.29);
    const distantSwimmer = makePose(0.43);

    expect(
      removeUnderwaterReflectionPoses([surfaceReflection, distantSwimmer])
    ).toEqual([distantSwimmer]);
  });
});
