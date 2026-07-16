import {
  buildTrackingManifest,
  captureManifestFrames,
  lookupManifestTracks,
  planManifestTimestamps,
} from "./videoTrackingManifest";

function fakeCanvas(width, height) {
  return {
    width,
    height,
    getContext: () => ({ drawImage: jest.fn() }),
  };
}

function fakeVideo({ duration, videoWidth = 640, videoHeight = 360, paused = true }) {
  const listeners = new Map();
  return {
    duration,
    videoWidth,
    videoHeight,
    currentTime: 0,
    paused,
    addEventListener(event, handler) {
      listeners.set(event, handler);
    },
    removeEventListener(event) {
      listeners.delete(event);
    },
    set currentTimeAndFire(value) {
      this.currentTime = value;
    },
    play: jest.fn().mockResolvedValue(undefined),
    // Simulates the browser firing `seeked` once the seek "completes".
    __fireSeeked() {
      listeners.get("seeked")?.();
    },
  };
}

describe("planManifestTimestamps", () => {
  test("covers the whole clip at an even cadence, capped at the frame limit", () => {
    const timestamps = planManifestTimestamps(2, 0.5, 100);
    expect(timestamps).toEqual([0, 0.5, 1, 1.5]);
  });

  test("returns nothing for a clip with no known duration", () => {
    expect(planManifestTimestamps(0)).toEqual([]);
    expect(planManifestTimestamps(null)).toEqual([]);
  });

  test("caps sample count for very long clips instead of growing unbounded", () => {
    const timestamps = planManifestTimestamps(10000, 1 / 15, 50);
    expect(timestamps).toHaveLength(50);
  });
});

describe("captureManifestFrames", () => {
  test("samples every planned timestamp and merges detector + pose boxes", async () => {
    const video = fakeVideo({ duration: 1 });
    const canvas = fakeCanvas(640, 360);
    const personDetector = {
      detectForVideo: jest.fn().mockReturnValue({
        detections: [
          {
            boundingBox: { originX: 100, originY: 40, width: 120, height: 260 },
            categories: [{ score: 0.9 }],
          },
        ],
      }),
    };
    const poseLandmarker = { detectForVideo: jest.fn().mockReturnValue({ landmarks: [] }) };

    // seekTo() resolves on a 500ms safety-net timer when `seeked` never
    // fires; fire it synchronously here instead so the test stays fast.
    const originalAddEventListener = video.addEventListener.bind(video);
    video.addEventListener = (event, handler) => {
      originalAddEventListener(event, handler);
      Promise.resolve().then(() => video.__fireSeeked());
    };

    const frames = await captureManifestFrames({
      video,
      canvas,
      personDetector,
      poseLandmarker,
      sport: "basketball",
      timestamps: [0, 0.5, 1],
    });

    expect(frames).toHaveLength(3);
    expect(frames.map((frame) => frame.timestamp)).toEqual([0, 0.5, 1]);
    expect(frames[0].detections).toEqual([
      { xyxy: [100, 40, 220, 300], confidence: 0.9 },
    ]);
    // MediaPipe VIDEO mode timestamps must strictly increase call over call.
    const poseTimestamps = poseLandmarker.detectForVideo.mock.calls.map((call) => call[1]);
    expect(poseTimestamps).toEqual([1, 2, 3]);
  });

  test("stops early once the caller's abort signal fires", async () => {
    const video = fakeVideo({ duration: 1 });
    video.addEventListener = (event, handler) => {
      Promise.resolve().then(handler);
    };
    const canvas = fakeCanvas(640, 360);
    const personDetector = { detectForVideo: jest.fn().mockReturnValue({ detections: [] }) };
    const poseLandmarker = { detectForVideo: jest.fn().mockReturnValue({ landmarks: [] }) };
    const controller = new AbortController();
    controller.abort();

    const frames = await captureManifestFrames({
      video,
      canvas,
      personDetector,
      poseLandmarker,
      sport: "basketball",
      timestamps: [0, 0.5, 1],
      signal: controller.signal,
    });

    expect(frames).toEqual([]);
  });
});

describe("buildTrackingManifest", () => {
  function autoSeek(video) {
    const original = video.addEventListener.bind(video);
    video.addEventListener = (event, handler) => {
      original(event, handler);
      Promise.resolve().then(() => video.__fireSeeked());
    };
    return video;
  }

  test("returns null instead of throwing when preconditions are missing", async () => {
    await expect(buildTrackingManifest({ video: null })).resolves.toBeNull();
    await expect(
      buildTrackingManifest({ video: fakeVideo({ duration: 1 }) })
    ).resolves.toBeNull();
  });

  test("submits every captured frame in one batch call and restores playback position", async () => {
    const video = autoSeek(fakeVideo({ duration: 0.2, paused: false }));
    video.currentTime = 0.15;
    const personDetector = { detectForVideo: jest.fn().mockReturnValue({ detections: [] }) };
    const poseLandmarker = { detectForVideo: jest.fn().mockReturnValue({ landmarks: [] }) };
    const apiClient = {
      post: jest.fn().mockResolvedValue({
        data: { frames: [[], [], []] },
      }),
    };

    const manifest = await buildTrackingManifest({
      video,
      personDetector,
      poseLandmarker,
      sport: "basketball",
      apiClient,
      canvasFactory: () => fakeCanvas(640, 360),
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      "/tracking/batch",
      expect.objectContaining({ frames: expect.any(Array) })
    );
    const [, body] = apiClient.post.mock.calls[0];
    expect(body.frames.length).toBeGreaterThan(1);
    expect(manifest).toHaveLength(body.frames.length);
    // Playback position/state the user was at is restored afterward.
    expect(video.currentTime).toBeCloseTo(0.15, 5);
    expect(video.play).toHaveBeenCalled();
  });
});

describe("lookupManifestTracks", () => {
  const manifest = [
    { timestamp: 0, tracks: ["a"] },
    { timestamp: 1, tracks: ["b"] },
    { timestamp: 2, tracks: ["c"] },
  ];

  test("returns the nearest sample's tracks", () => {
    expect(lookupManifestTracks(manifest, 0.1)).toEqual(["a"]);
    expect(lookupManifestTracks(manifest, 0.9)).toEqual(["b"]);
    expect(lookupManifestTracks(manifest, 1.9)).toEqual(["c"]);
    expect(lookupManifestTracks(manifest, 5)).toEqual(["c"]);
  });

  test("returns null for an empty manifest", () => {
    expect(lookupManifestTracks([], 1)).toBeNull();
    expect(lookupManifestTracks(null, 1)).toBeNull();
  });
});
