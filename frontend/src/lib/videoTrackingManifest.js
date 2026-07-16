import {
  mergePersonDetections,
  normalizeTrackedBoxes,
  poseDetectionsFromLandmarks,
  removeUnderwaterReflections,
} from "./enhancedTracking";
import { api } from "./api";
import axios from "axios";

// Mirrors backend/tracking_service.py's MAX_BATCH_FRAMES; keep in sync.
export const MANIFEST_MAX_FRAMES = 2400;
// Dense enough that consecutive samples overlap heavily even for a sprinting
// athlete -- the live path's 7fps cadence is what forced BoT-SORT's loose
// association thresholds in the first place (see BOT_SORT_BATCH_OPTIONS).
export const MANIFEST_FRAME_STEP_SECONDS = 1 / 15;

const trackingBackendUrl = process.env.REACT_APP_TRACKING_BACKEND_URL;
const trackingApi = trackingBackendUrl
  ? axios.create({
      baseURL: `${trackingBackendUrl.replace(/\/$/, "")}/api`,
      timeout: 60000,
    })
  : api;

function seekTo(video, time) {
  return new Promise((resolve) => {
    if (Math.abs((video.currentTime ?? 0) - time) < 0.001) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener?.("seeked", finish);
      resolve();
    };
    video.addEventListener?.("seeked", finish, { once: true });
    video.currentTime = time;
    // Safety net: some browsers don't fire `seeked` for a no-op or dropped
    // seek near the end of a clip.
    setTimeout(finish, 500);
  });
}

/** Evenly-spaced sample timestamps covering the whole clip, capped for cost. */
export function planManifestTimestamps(
  duration,
  stepSeconds = MANIFEST_FRAME_STEP_SECONDS,
  maxFrames = MANIFEST_MAX_FRAMES
) {
  if (!duration || duration <= 0) return [];
  const count = Math.min(maxFrames, Math.max(1, Math.ceil(duration / stepSeconds)));
  const times = [];
  for (let index = 0; index < count; index += 1) {
    times.push(Math.min(duration, index * stepSeconds));
  }
  return times;
}

/**
 * Seeks through the whole clip once, collecting merged person-detector +
 * pose-derived boxes per sampled timestamp. Unlike the live capture loop,
 * nothing here is throttled to a wall-clock budget -- every timestamp is
 * captured before moving to the next one.
 */
export async function captureManifestFrames({
  video,
  canvas,
  personDetector,
  poseLandmarker,
  sport,
  timestamps,
  onProgress,
  signal,
}) {
  const ctx = canvas.getContext("2d");
  const frames = [];
  let poseTimestampMs = 0;
  for (let index = 0; index < timestamps.length; index += 1) {
    if (signal?.aborted) break;
    const timestamp = timestamps[index];
    await seekTo(video, timestamp);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // MediaPipe's VIDEO running mode requires strictly increasing timestamps;
    // the real video timestamp isn't usable here because seeking can revisit
    // times out of order relative to the previous call.
    poseTimestampMs += 1;
    const poseResult = poseLandmarker.detectForVideo(canvas, poseTimestampMs);
    const poses = poseResult?.landmarks || [];
    const detectionResult = personDetector.detectForVideo(canvas, poseTimestampMs);

    let detectorDetections = (detectionResult?.detections || []).map((detection) => {
      const box = detection.boundingBox;
      return {
        xyxy: [
          box.originX,
          box.originY,
          box.originX + box.width,
          box.originY + box.height,
        ],
        confidence: detection.categories?.[0]?.score ?? 0,
      };
    });
    let poseDetections = poseDetectionsFromLandmarks(poses, canvas.width, canvas.height);
    const underwaterApproach = sport === "swimming" && canvas.height > canvas.width;
    if (underwaterApproach) {
      detectorDetections = removeUnderwaterReflections(detectorDetections, canvas.height);
      poseDetections = removeUnderwaterReflections(poseDetections, canvas.height);
    }
    const detections = mergePersonDetections(detectorDetections, poseDetections);
    frames.push({ timestamp, detections });
    onProgress?.((index + 1) / timestamps.length);
  }
  return frames;
}

/**
 * Builds a full-clip athlete identity manifest before interactive review
 * starts. This replaces the live per-frame flow's ~140ms-throttled HTTP call
 * (EnhancedTrackingClient.process) with one batch resolution over every
 * sampled frame, run at a dense, even cadence with no real-time deadline and
 * no network jitter between samples.
 *
 * Returns null (not an error) when preconditions aren't met, so callers can
 * fall back to the existing live tracking path unchanged.
 */
export async function buildTrackingManifest({
  video,
  personDetector,
  poseLandmarker,
  sport,
  onProgress,
  signal,
  apiClient = trackingApi,
  frameWidth = 640,
  canvasFactory = () => document.createElement("canvas"),
}) {
  if (!video?.duration || !personDetector || !poseLandmarker) return null;

  const width = Math.min(frameWidth, video.videoWidth || frameWidth);
  const height = Math.max(
    1,
    Math.round(((video.videoHeight || 360) / (video.videoWidth || frameWidth)) * width)
  );
  const canvas = canvasFactory();
  canvas.width = width;
  canvas.height = height;

  const wasPaused = video.paused;
  const originalTime = video.currentTime;

  const timestamps = planManifestTimestamps(video.duration);
  if (!timestamps.length) return null;

  const frames = await captureManifestFrames({
    video,
    canvas,
    personDetector,
    poseLandmarker,
    sport,
    timestamps,
    onProgress,
    signal,
  });

  try {
    await seekTo(video, originalTime);
    if (!wasPaused) await video.play?.();
  } catch {
    // Best-effort restore; the caller drives real playback state afterward.
  }

  if (signal?.aborted || !frames.length) return null;

  const response = await apiClient.post("/tracking/batch", {
    frames: frames.map((frame) => ({
      timestamp: frame.timestamp,
      detections: frame.detections,
    })),
  });
  const perFrameTracks = response.data?.frames || [];

  return frames.map((frame, index) => ({
    timestamp: frame.timestamp,
    tracks: normalizeTrackedBoxes(perFrameTracks[index], width, height),
  }));
}

/** Nearest-sample lookup so playback can query the manifest by video time. */
export function lookupManifestTracks(manifest, videoTimeSeconds) {
  if (!manifest?.length) return null;
  let lo = 0;
  let hi = manifest.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (manifest[mid].timestamp < videoTimeSeconds) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0) {
    const prev = manifest[lo - 1];
    const current = manifest[lo];
    if (
      Math.abs(prev.timestamp - videoTimeSeconds) <=
      Math.abs(current.timestamp - videoTimeSeconds)
    ) {
      return prev.tracks;
    }
  }
  return manifest[lo].tracks;
}
