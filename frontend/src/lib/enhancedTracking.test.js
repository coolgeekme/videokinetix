import {
  EnhancedTrackingClient,
  findTrackAtPoint,
  normalizeTrackedBoxes,
  paddedTrackRoi,
  poseIndexInsideTrack,
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
