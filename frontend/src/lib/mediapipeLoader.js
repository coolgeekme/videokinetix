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
