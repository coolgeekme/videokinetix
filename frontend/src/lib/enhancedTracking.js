import axios from "axios";
import { api } from "./api";

const TRACK_FRAME_WIDTH = 640;
const POSE_BOX_LANDMARKS = [
  11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
];
const trackingBackendUrl = process.env.REACT_APP_TRACKING_BACKEND_URL;
const trackingApi = trackingBackendUrl
  ? axios.create({
      baseURL: `${trackingBackendUrl.replace(/\/$/, "")}/api`,
      timeout: 15000,
    })
  : api;

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode tracking frame"))),
      "image/jpeg",
      0.62
    );
  });
}

function boxIou(a, b) {
  const x1 = Math.max(a.xyxy[0], b.xyxy[0]);
  const y1 = Math.max(a.xyxy[1], b.xyxy[1]);
  const x2 = Math.min(a.xyxy[2], b.xyxy[2]);
  const y2 = Math.min(a.xyxy[3], b.xyxy[3]);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.xyxy[2] - a.xyxy[0]) * (a.xyxy[3] - a.xyxy[1]);
  const areaB = (b.xyxy[2] - b.xyxy[0]) * (b.xyxy[3] - b.xyxy[1]);
  return intersection / Math.max(1, areaA + areaB - intersection);
}

export function poseDetectionsFromLandmarks(poses, width, height) {
  if (!width || !height) return [];
  return (poses || []).flatMap((pose) => {
    const points = POSE_BOX_LANDMARKS
      .map((index) => pose?.[index])
      .filter(
        (point) =>
          point &&
          Number.isFinite(point.x) &&
          Number.isFinite(point.y) &&
          (point.visibility == null || point.visibility >= 0.15)
      );
    if (points.length < 5) return [];
    const xs = points.map((point) => point.x * width);
    const ys = points.map((point) => point.y * height);
    const rawX1 = Math.min(...xs);
    const rawY1 = Math.min(...ys);
    const rawX2 = Math.max(...xs);
    const rawY2 = Math.max(...ys);
    const boxWidth = Math.max(4, rawX2 - rawX1);
    const boxHeight = Math.max(8, rawY2 - rawY1);
    const visibility = points.reduce(
      (sum, point) => sum + (point.visibility ?? 0.8),
      0
    ) / points.length;
    return [{
      xyxy: [
        Math.max(0, rawX1 - boxWidth * 0.16),
        Math.max(0, rawY1 - boxHeight * 0.14),
        Math.min(width, rawX2 + boxWidth * 0.16),
        Math.min(height, rawY2 + boxHeight * 0.1),
      ],
      confidence: Math.max(0.55, Math.min(0.98, visibility)),
    }];
  });
}

export function mergePersonDetections(detectorDetections, poseDetections) {
  const verifiedPoses = poseDetections || [];
  const remainingDetectorBoxes = (detectorDetections || []).filter(
    (detection) =>
      !verifiedPoses.some((poseDetection) => boxIou(detection, poseDetection) >= 0.45)
  );
  return [...verifiedPoses, ...remainingDetectorBoxes];
}

export function normalizeTrackedBoxes(tracks, width, height) {
  if (!width || !height) return [];
  return (tracks || [])
    .filter((track) => track?.confirmed && track.tracker_id >= 0 && track.xyxy?.length === 4)
    .map((track) => ({
      id: track.tracker_id,
      confidence: track.confidence ?? 0,
      x1: Math.max(0, Math.min(1, track.xyxy[0] / width)),
      y1: Math.max(0, Math.min(1, track.xyxy[1] / height)),
      x2: Math.max(0, Math.min(1, track.xyxy[2] / width)),
      y2: Math.max(0, Math.min(1, track.xyxy[3] / height)),
    }))
    .filter((track) => track.x2 > track.x1 && track.y2 > track.y1);
}

export function findTrackAtPoint(tracks, point) {
  const containing = (tracks || []).filter(
    (track) =>
      point.x >= track.x1 &&
      point.x <= track.x2 &&
      point.y >= track.y1 &&
      point.y <= track.y2
  );
  if (!containing.length) return null;
  // When boxes overlap, the tighter box is normally the person the user meant.
  return containing.reduce((best, track) => {
    const area = (track.x2 - track.x1) * (track.y2 - track.y1);
    const bestArea = (best.x2 - best.x1) * (best.y2 - best.y1);
    return area < bestArea ? track : best;
  });
}

export function paddedTrackRoi(track, padding = 0.16) {
  if (!track) return null;
  const width = track.x2 - track.x1;
  const height = track.y2 - track.y1;
  const padX = width * padding;
  const padTop = height * padding;
  const padBottom = height * Math.max(padding, 0.22);
  const x1 = Math.max(0, track.x1 - padX);
  const y1 = Math.max(0, track.y1 - padTop);
  const x2 = Math.min(1, track.x2 + padX);
  const y2 = Math.min(1, track.y2 + padBottom);
  return {
    x: x1,
    y: y1,
    width: x2 - x1,
    height: y2 - y1,
    center: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
  };
}

export function poseIndexInsideTrack(poses, track, centerForPose) {
  if (!track) return -1;
  const center = {
    x: (track.x1 + track.x2) / 2,
    y: (track.y1 + track.y2) / 2,
  };
  let bestIndex = -1;
  let bestDistance = Infinity;
  (poses || []).forEach((pose, index) => {
    const poseCenter = centerForPose(pose);
    if (!poseCenter) return;
    const marginX = Math.max(0.015, (track.x2 - track.x1) * 0.12);
    const marginY = Math.max(0.02, (track.y2 - track.y1) * 0.08);
    if (
      poseCenter.x < track.x1 - marginX ||
      poseCenter.x > track.x2 + marginX ||
      poseCenter.y < track.y1 - marginY ||
      poseCenter.y > track.y2 + marginY
    ) return;
    const distance = Math.hypot(poseCenter.x - center.x, poseCenter.y - center.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export class EnhancedTrackingClient {
  constructor(apiClient = trackingApi) {
    this.api = apiClient;
    this.sessionId = null;
    this.canvas = document.createElement("canvas");
    this.inFlight = false;
  }

  async start() {
    const status = await this.api.get("/tracking/status", { timeout: 8000 });
    if (!status.data?.ready) return status.data || { ready: false };
    const created = await this.api.post("/tracking/sessions", null, { timeout: 8000 });
    this.sessionId = created.data.session_id;
    return { ready: true, ...created.data };
  }

  async restart() {
    this.sessionId = null;
    return this.start();
  }

  async stop() {
    const sessionId = this.sessionId;
    this.sessionId = null;
    if (!sessionId) return;
    try {
      await this.api.delete(`/tracking/sessions/${sessionId}`, { timeout: 5000 });
    } catch {
      // Sessions expire server-side; cleanup is best-effort on page unload.
    }
  }

  async process(video, detector, timestampMs, poses = []) {
    if (!this.sessionId || !video?.videoWidth || !detector || this.inFlight) return null;
    this.inFlight = true;
    try {
      const width = Math.min(TRACK_FRAME_WIDTH, video.videoWidth);
      const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width));
      this.canvas.width = width;
      this.canvas.height = height;
      const context = this.canvas.getContext("2d");
      context.drawImage(video, 0, 0, width, height);
      const result = detector.detectForVideo(this.canvas, timestampMs);
      const detectorDetections = (result?.detections || []).map((detection) => {
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
      const poseDetections = poseDetectionsFromLandmarks(poses, width, height);
      const detections = mergePersonDetections(
        detectorDetections,
        poseDetections
      );
      const blob = await canvasBlob(this.canvas);
      const form = new FormData();
      form.append("detections", JSON.stringify({ detections }));
      form.append("timestamp", String(timestampMs / 1000));
      form.append("frame", blob, "tracking-frame.jpg");
      const postFrame = () =>
        this.api.post(`/tracking/sessions/${this.sessionId}/frame`, form, {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 15000,
        });
      let response;
      try {
        response = await postFrame();
      } catch (error) {
        if (error?.response?.status !== 404) throw error;
        // The local/dev tracking service stores sessions in memory. A server
        // restart invalidates the page's old ID, so transparently create a new
        // tracker and retry this frame instead of disabling motion capture.
        const restarted = await this.restart();
        if (!restarted?.ready || !this.sessionId) throw error;
        response = await postFrame();
      }
      return normalizeTrackedBoxes(response.data?.tracks, width, height);
    } finally {
      this.inFlight = false;
    }
  }
}
