import {
  buildTrackingManifest,
  captureManifestFrames,
  lookupManifestFrame,
  lookupManifestTracks,
  linkSwimmingDetections,
  manifestHasPoseForTrack,
  planManifestTimestamps,
  UNDERWATER_POSE_CROP_TOP,
} from "./videoTrackingManifest";

function fakeCanvas(width, height) {
  const context = { drawImage: jest.fn() };
  return {
    width,
    height,
    getContext: () => context,
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
    expect(frames[0].poses).toEqual([]);
    // MediaPipe VIDEO mode timestamps must strictly increase call over call.
    const poseTimestamps = poseLandmarker.detectForVideo.mock.calls.map((call) => call[1]);
    expect(poseTimestamps).toEqual([1, 2, 3]);
  });

  test("uses shared monotonic clocks when MediaPipe graphs are reused by the canvas", async () => {
    const video = fakeVideo({ duration: 1 });
    video.addEventListener = (event, handler) => {
      Promise.resolve().then(handler);
    };
    const canvas = fakeCanvas(640, 360);
    const personDetector = { detectForVideo: jest.fn().mockReturnValue({ detections: [] }) };
    const poseLandmarker = { detectForVideo: jest.fn().mockReturnValue({ landmarks: [] }) };
    let poseClock = 54126.7;
    let personClock = 78000;
    const nextPoseTimestamp = jest.fn(() => (poseClock += 0.01));
    const nextPersonTimestamp = jest.fn(() => (personClock += 0.01));

    await captureManifestFrames({
      video,
      canvas,
      personDetector,
      poseLandmarker,
      sport: "swimming",
      timestamps: [0, 0.5, 1],
      nextPoseTimestamp,
      nextPersonTimestamp,
    });

    poseLandmarker.detectForVideo.mock.calls.forEach((call, index) => {
      expect(call[1]).toBeCloseTo(54126.71 + index * 0.01, 5);
    });
    personDetector.detectForVideo.mock.calls.forEach((call, index) => {
      expect(call[1]).toBeCloseTo(78000.01 + index * 0.01, 5);
    });
    expect(nextPoseTimestamp).toHaveBeenCalledTimes(3);
    expect(nextPersonTimestamp).toHaveBeenCalledTimes(3);
  });

  test("crops out the water-surface reflection and remaps swimmer poses", async () => {
    const video = fakeVideo({ duration: 1, videoWidth: 500, videoHeight: 900 });
    video.addEventListener = (event, handler) => Promise.resolve().then(handler);
    const canvas = fakeCanvas(500, 900);
    const underwaterPoseCanvas = fakeCanvas(500, 900);
    const swimmerPose = Array.from({ length: 33 }, () => ({
      x: 0.5,
      y: 0.5,
      visibility: 0.9,
    }));
    const personDetector = { detectForVideo: jest.fn().mockReturnValue({ detections: [] }) };
    const poseLandmarker = {
      detectForVideo: jest.fn().mockReturnValue({ landmarks: [swimmerPose] }),
    };

    const frames = await captureManifestFrames({
      video,
      canvas,
      underwaterPoseCanvas,
      personDetector,
      poseLandmarker,
      sport: "swimming",
      timestamps: [0],
    });

    expect(poseLandmarker.detectForVideo).toHaveBeenCalledWith(underwaterPoseCanvas, 1);
    expect(frames[0].poses[0][0].y).toBeCloseTo(
      UNDERWATER_POSE_CROP_TOP + 0.5 * (1 - UNDERWATER_POSE_CROP_TOP),
      5
    );
    expect(underwaterPoseCanvas.getContext("2d").drawImage).toHaveBeenCalled();
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

  test("resolves swimming identities locally without the slow batch request", async () => {
    const video = autoSeek(fakeVideo({ duration: 0.2 }));
    const personDetector = {
      detectForVideo: jest.fn().mockReturnValue({ detections: [] }),
    };
    const poseLandmarker = {
      detectForVideo: jest.fn().mockReturnValue({ landmarks: [] }),
    };
    const apiClient = { post: jest.fn() };

    const manifest = await buildTrackingManifest({
      video,
      personDetector,
      poseLandmarker,
      sport: "swimming",
      apiClient,
      canvasFactory: () => fakeCanvas(640, 360),
    });

    expect(manifest.length).toBeGreaterThan(1);
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe("linkSwimmingDetections", () => {
  test("keeps one swimmer ID through missing frames and rapid approach scale", () => {
    const detection = (xyxy) => ({ xyxy, confidence: 0.9 });
    const frames = [
      { detections: [detection([440, 360, 520, 460])] },
      { detections: [] },
      { detections: [] },
      { detections: [detection([360, 280, 620, 650])] },
    ];

    const linked = linkSwimmingDetections(frames, 1000, 1000, 5);

    expect(linked[0][0].tracker_id).toBe(linked[3][0].tracker_id);
    expect(linked[0][0].confirmed).toBe(true);
  });
});

describe("lookupManifestTracks", () => {
  const manifest = [
    { timestamp: 0, tracks: ["a"], poses: ["pose-a"] },
    { timestamp: 1, tracks: ["b"], poses: ["pose-b"] },
    { timestamp: 2, tracks: ["c"], poses: ["pose-c"] },
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

  test("returns the complete nearest frame for synchronized pose playback", () => {
    expect(lookupManifestFrame(manifest, 0.9)).toEqual(manifest[1]);
    expect(lookupManifestFrame([], 1)).toBeNull();
  });

  test("requires the selected track to contain a manifest pose", () => {
    const makePose = (x, y) => Array.from({ length: 33 }, () => ({
      x,
      y,
      visibility: 0.9,
    }));
    const selectedPose = makePose(0.3, 0.65);
    const otherPose = makePose(0.8, 0.65);
    const frame = {
      timestamp: 0,
      tracks: [{ id: 7, x1: 0.15, y1: 0.4, x2: 0.45, y2: 0.9 }],
      poses: [otherPose],
    };
    const centerForPose = (pose) => pose?.[23]
      ? { x: pose[23].x, y: pose[23].y }
      : null;

    expect(manifestHasPoseForTrack(frame, 7, centerForPose)).toBe(false);
    frame.poses = [selectedPose];
    expect(manifestHasPoseForTrack(frame, 7, centerForPose)).toBe(true);
    expect(
      manifestHasPoseForTrack({ ...frame, poses: [] }, 7, centerForPose)
    ).toBe(false);
  });
});
