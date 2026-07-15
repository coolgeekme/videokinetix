import { api } from "./api";

const TRACK_FRAME_WIDTH = 640;

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode tracking frame"))),
      "image/jpeg",
      0.62
    );
  });
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
  constructor(apiClient = api) {
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

  async process(video, detector, timestampMs) {
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
      const detections = (result?.detections || []).map((detection) => {
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
      const blob = await canvasBlob(this.canvas);
      const form = new FormData();
      form.append("detections", JSON.stringify({ detections }));
      form.append("timestamp", String(timestampMs / 1000));
      form.append("frame", blob, "tracking-frame.jpg");
      const response = await this.api.post(
        `/tracking/sessions/${this.sessionId}/frame`,
        form,
        { headers: { "Content-Type": "multipart/form-data" }, timeout: 15000 }
      );
      return normalizeTrackedBoxes(response.data?.tracks, width, height);
    } finally {
      this.inFlight = false;
    }
  }
}

