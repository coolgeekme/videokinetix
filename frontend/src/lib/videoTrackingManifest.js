import {
  mergePersonDetections,
  normalizeTrackedBoxes,
  poseIndexInsideTrack,
  poseDetectionsFromLandmarks,
  removeUnderwaterReflections,
  removeUnderwaterReflectionPoses,
} from "./enhancedTracking";
import { api } from "./api";
import axios from "axios";

// Mirrors backend/tracking_service.py's MAX_BATCH_FRAMES; keep in sync.
export const MANIFEST_MAX_FRAMES = 2400;
// Dense enough that consecutive samples overlap heavily even for a sprinting
// athlete -- the live path's 7fps cadence is what forced BoT-SORT's loose
// association thresholds in the first place (see BOT_SORT_BATCH_OPTIONS).
export const MANIFEST_FRAME_STEP_SECONDS = 1 / 15;
export const UNDERWATER_POSE_CROP_TOP = 0.32;

function detectionGeometry(detection, width, height) {
  const [x1, y1, x2, y2] = detection.xyxy;
  const boxWidth = Math.max(1, x2 - x1) / width;
  const boxHeight = Math.max(1, y2 - y1) / height;
  return {
    center: {
      x: (x1 + x2) / 2 / width,
      y: (y1 + y2) / 2 / height,
    },
    scale: Math.sqrt(boxWidth * boxHeight),
  };
}

/**
 * A fixed underwater camera normally contains one selected lane/swimmer. The
 * browser can associate its already reflection-filtered boxes locally instead
 * of waiting for a second server-side batch pass. Long gaps are tolerated
 * because a distant swimmer may disappear into bubbles before approaching.
 */
export function linkSwimmingDetections(frames, width, height, maxGapFrames = 75) {
  const active = new Map();
  let nextId = 1;
  return (frames || []).map((frame, frameIndex) => {
    const detections = (frame.detections || [])
      .map((detection) => ({
        detection,
        geometry: detectionGeometry(detection, width, height),
      }))
      .sort(
        (a, b) =>
          (b.detection.confidence || 0) - (a.detection.confidence || 0)
      );
    const candidates = [];
    for (const [trackId, track] of active) {
      const gap = frameIndex - track.lastFrame;
      if (gap > maxGapFrames) {
        active.delete(trackId);
        continue;
      }
      detections.forEach((item, detectionIndex) => {
        const distance = Math.hypot(
          item.geometry.center.x - track.center.x,
          item.geometry.center.y - track.center.y
        );
        const gate = Math.min(
          0.58,
          0.1 + gap * 0.012 + Math.max(track.scale, item.geometry.scale) * 0.9
        );
        if (distance > gate) return;
        const scaleCost = Math.min(
          1,
          Math.abs(
            Math.log(
              Math.max(item.geometry.scale, 0.001) /
                Math.max(track.scale, 0.001)
            )
          )
        );
        candidates.push({
          trackId,
          detectionIndex,
          cost: distance / Math.max(gate, 0.001) + scaleCost * 0.15,
        });
      });
    }
    candidates.sort((a, b) => a.cost - b.cost);
    const assignedTracks = new Set();
    const assignedDetections = new Map();
    for (const candidate of candidates) {
      if (
        assignedTracks.has(candidate.trackId) ||
        assignedDetections.has(candidate.detectionIndex)
      ) continue;
      assignedTracks.add(candidate.trackId);
      assignedDetections.set(candidate.detectionIndex, candidate.trackId);
    }

    return detections.map((item, detectionIndex) => {
      let trackId = assignedDetections.get(detectionIndex);
      if (trackId == null) {
        trackId = nextId;
        nextId += 1;
      }
      active.set(trackId, {
        center: item.geometry.center,
        scale: item.geometry.scale,
        lastFrame: frameIndex,
      });
      return {
        confirmed: true,
        tracker_id: trackId,
        xyxy: item.detection.xyxy,
        confidence: item.detection.confidence ?? 0,
      };
    });
  });
}

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
  nextPoseTimestamp,
  nextPersonTimestamp,
  underwaterPoseCanvas,
}) {
  const ctx = canvas.getContext("2d");
  const frames = [];
  let poseTimestampMs = 0;
  let personTimestampMs = 0;
  for (let index = 0; index < timestamps.length; index += 1) {
    if (signal?.aborted) break;
    const timestamp = timestamps[index];
    await seekTo(video, timestamp);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // MediaPipe's VIDEO running mode requires strictly increasing timestamps;
    // the real video timestamp isn't usable here because seeking can revisit
    // times out of order relative to the previous call.
    poseTimestampMs = nextPoseTimestamp?.() ?? poseTimestampMs + 1;
    personTimestampMs = nextPersonTimestamp?.() ?? personTimestampMs + 1;
    const detectionResult = personDetector.detectForVideo(canvas, personTimestampMs);

    let poseInput = canvas;
    let remapUnderwaterPose = false;
    if (sport === "swimming" && underwaterPoseCanvas) {
      underwaterPoseCanvas.width = canvas.width;
      underwaterPoseCanvas.height = canvas.height;
      const poseCtx = underwaterPoseCanvas.getContext("2d");
      const sourceTop = Math.round(video.videoHeight * UNDERWATER_POSE_CROP_TOP);
      const sourceHeight = Math.max(1, video.videoHeight - sourceTop);
      poseCtx.drawImage(
        video,
        0,
        sourceTop,
        video.videoWidth,
        sourceHeight,
        0,
        0,
        underwaterPoseCanvas.width,
        underwaterPoseCanvas.height
      );
      poseInput = underwaterPoseCanvas;
      remapUnderwaterPose = true;
    }
    const poseResult = poseLandmarker.detectForVideo(poseInput, poseTimestampMs);
    let poses = poseResult?.landmarks || [];
    if (remapUnderwaterPose) {
      const cropHeight = 1 - UNDERWATER_POSE_CROP_TOP;
      poses = poses.map((pose) =>
        pose.map((landmark) => ({
          ...landmark,
          y: UNDERWATER_POSE_CROP_TOP + landmark.y * cropHeight,
        }))
      );
    }

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
    const underwaterApproach = sport === "swimming";
    if (underwaterApproach) {
      detectorDetections = removeUnderwaterReflections(detectorDetections, canvas.height);
      poses = removeUnderwaterReflectionPoses(poses);
    }
    let poseDetections = poseDetectionsFromLandmarks(poses, canvas.width, canvas.height);
    if (underwaterApproach) {
      poseDetections = removeUnderwaterReflections(poseDetections, canvas.height);
    }
    const detections = mergePersonDetections(detectorDetections, poseDetections);
    // Keep the pose landmarks captured during the offline pass. Playback can
    // reuse these exact samples for both the visible skeleton and rep analysis
    // instead of running a second, expensive MediaPipe pass in real time.
    frames.push({ timestamp, detections, poses });
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
  nextPoseTimestamp,
  nextPersonTimestamp,
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
  const underwaterPoseCanvas = sport === "swimming" ? canvasFactory() : null;
  if (underwaterPoseCanvas) {
    underwaterPoseCanvas.width = width;
    underwaterPoseCanvas.height = height;
  }

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
    onProgress: (progress) => onProgress?.(progress * 0.96),
    signal,
    nextPoseTimestamp,
    nextPersonTimestamp,
    underwaterPoseCanvas,
  });

  try {
    await seekTo(video, originalTime);
    if (!wasPaused) await video.play?.();
  } catch {
    // Best-effort restore; the caller drives real playback state afterward.
  }

  if (signal?.aborted || !frames.length) return null;

  let perFrameTracks;
  if (sport === "swimming") {
    perFrameTracks = linkSwimmingDetections(frames, width, height);
  } else {
    const response = await apiClient.post("/tracking/batch", {
      frames: frames.map((frame) => ({
        timestamp: frame.timestamp,
        detections: frame.detections,
      })),
    });
    perFrameTracks = response.data?.frames || [];
  }
  onProgress?.(1);

  return frames.map((frame, index) => ({
    timestamp: frame.timestamp,
    tracks: normalizeTrackedBoxes(perFrameTracks[index], width, height),
    poses: frame.poses,
  }));
}

/** Nearest-sample lookup so playback can query the manifest by video time. */
export function lookupManifestFrame(manifest, videoTimeSeconds) {
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
      return prev;
    }
  }
  return manifest[lo];
}

export function lookupManifestTracks(manifest, videoTimeSeconds) {
  return lookupManifestFrame(manifest, videoTimeSeconds)?.tracks ?? null;
}

export function manifestHasPoseForTrack(
  frame,
  trackId,
  centerForPose,
  poseMatchOptions = {}
) {
  if (!frame?.poses?.length) return false;
  if (trackId == null) return true;
  const track = (frame.tracks || []).find((candidate) => candidate.id === trackId);
  if (!track || typeof centerForPose !== "function") return false;
  return poseIndexInsideTrack(
    frame.poses,
    track,
    centerForPose,
    poseMatchOptions
  ) >= 0;
}
