/**
 * Shared MediaPipe Tasks Vision loaders. Used by both PoseCanvas (single
 * athlete) and MultiPlayerPoseCanvas (pickleball doubles up to 4 players).
 *
 * Loaded via CDN (Apache 2.0) — no npm install. Each loader is memoized so
 * the same instance is shared across components.
 */

let landmarkerLoaderPromise = null;
export async function loadPoseLandmarker(numPoses = 5) {
  if (landmarkerLoaderPromise) return landmarkerLoaderPromise;
  landmarkerLoaderPromise = (async () => {
    const mod = await import(
      /* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/+esm"
    );
    const { PoseLandmarker, FilesetResolver } = mod;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm"
    );
    return PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
  })();
  return landmarkerLoaderPromise;
}

let personDetectorLoaderPromise = null;

/**
 * Detect full person boxes independently of pose landmarks.
 *
 * A player can remain detectable while several individual joints are hidden.
 * Those boxes are sent to the backend Supervision/BoT-SORT session, then the
 * selected persistent box is used as the ROI for detailed pose capture.
 */
export async function loadPersonDetector() {
  if (personDetectorLoaderPromise) return personDetectorLoaderPromise;
  personDetectorLoaderPromise = (async () => {
    const mod = await import(
      /* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/+esm"
    );
    const { ObjectDetector, FilesetResolver } = mod;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm"
    );
    return ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      categoryAllowlist: ["person"],
      scoreThreshold: 0.18,
      maxResults: 12,
    });
  })();
  return personDetectorLoaderPromise;
}
