const BODY_LANDMARKS = [
  0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28,
];

const SHAPE_SEGMENTS = [
  [11, 12], [23, 24], [11, 23], [12, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function visible(point) {
  return point && (point.visibility == null || point.visibility >= 0.2);
}

export function poseCenter(landmarks) {
  const leftHip = landmarks?.[23];
  const rightHip = landmarks?.[24];
  if (visible(leftHip) && visible(rightHip)) {
    return {
      x: (leftHip.x + rightHip.x) / 2,
      y: (leftHip.y + rightHip.y) / 2,
    };
  }

  const points = [11, 12, 23, 24]
    .map((index) => landmarks?.[index])
    .filter(visible);
  if (!points.length) return null;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function poseBox(landmarks) {
  const points = BODY_LANDMARKS
    .map((index) => landmarks?.[index])
    .filter(visible);
  if (points.length < 4) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x1 = Math.min(...xs);
  const y1 = Math.min(...ys);
  const x2 = Math.max(...xs);
  const y2 = Math.max(...ys);
  return {
    x1,
    y1,
    x2,
    y2,
    width: Math.max(0.001, x2 - x1),
    height: Math.max(0.001, y2 - y1),
  };
}

function poseShape(landmarks, box) {
  if (!box) return [];
  const normalizer = Math.max(box.height, 0.05);
  return SHAPE_SEGMENTS.map(([a, b]) => {
    const pa = landmarks?.[a];
    const pb = landmarks?.[b];
    return visible(pa) && visible(pb) ? distance(pa, pb) / normalizer : null;
  });
}

function boxIou(a, b) {
  if (!a || !b) return 0;
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  return intersection / Math.max(areaA + areaB - intersection, 0.0001);
}

function translateBox(box, dx, dy) {
  if (!box) return null;
  return {
    ...box,
    x1: box.x1 + dx,
    x2: box.x2 + dx,
    y1: box.y1 + dy,
    y2: box.y2 + dy,
  };
}

function shapeDifference(a, b) {
  let total = 0;
  let count = 0;
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] == null || b[index] == null) continue;
    total += Math.min(1, Math.abs(a[index] - b[index]) / 0.3);
    count += 1;
  }
  return count >= 4 ? total / count : 0.5;
}

function observation(landmarks, poseIndex) {
  const center = poseCenter(landmarks);
  const box = poseBox(landmarks);
  if (!center || !box) return null;
  return {
    landmarks,
    poseIndex,
    center,
    box,
    scale: Math.sqrt(box.width * box.height),
    shape: poseShape(landmarks, box),
  };
}

/**
 * Lightweight multi-pose identity tracker for the browser capture pipeline.
 *
 * MediaPipe returns poses in confidence order, not identity order. This class
 * assigns persistent IDs by matching all current poses to existing tracks using
 * velocity-predicted position, body-box overlap, scale, and body proportions.
 * Unmatched tracks are retained briefly for occlusion recovery, but an unrelated
 * pose outside the matching gate receives a new ID instead of stealing a lock.
 */
export class PoseIdentityTracker {
  constructor({ maxTrackAgeMs = 1800, matchThreshold = 0.92 } = {}) {
    this.maxTrackAgeMs = maxTrackAgeMs;
    this.matchThreshold = matchThreshold;
    this.nextId = 1;
    this.tracks = new Map();
  }

  reset() {
    this.nextId = 1;
    this.tracks.clear();
  }

  getTrack(trackId) {
    return this.tracks.get(trackId) || null;
  }

  touchTrack(trackId, nowMs = performance.now()) {
    const track = this.tracks.get(trackId);
    if (!track) return false;
    track.updatedAt = nowMs;
    track.lastSeenAt = nowMs;
    return true;
  }

  keepTrackAlive(trackId, nowMs = performance.now()) {
    const track = this.tracks.get(trackId);
    if (!track) return false;
    // Preserve updatedAt so callers can continue extrapolating from the last
    // real observation. Only prevent the selected identity from expiring.
    track.lastSeenAt = nowMs;
    return true;
  }

  assignObservation(track, candidate, nowMs) {
    const dt = Math.max(0.016, (nowMs - track.updatedAt) / 1000);
    const rawVx = (candidate.center.x - track.center.x) / dt;
    const rawVy = (candidate.center.y - track.center.y) / dt;
    const velocityAlpha = 0.45;
    track.vx = velocityAlpha * rawVx + (1 - velocityAlpha) * track.vx;
    track.vy = velocityAlpha * rawVy + (1 - velocityAlpha) * track.vy;
    track.center = candidate.center;
    track.box = candidate.box;
    track.scale = 0.65 * candidate.scale + 0.35 * track.scale;
    track.shape = candidate.shape;
    track.poseIndex = candidate.poseIndex;
    track.landmarks = candidate.landmarks;
    track.updatedAt = nowMs;
    track.lastSeenAt = nowMs;
  }

  update(poses, nowMs = performance.now(), { forcedTrackId = null } = {}) {
    const observations = (poses || [])
      .map((landmarks, poseIndex) => observation(landmarks, poseIndex))
      .filter(Boolean);

    for (const [trackId, track] of this.tracks) {
      if (nowMs - track.lastSeenAt > this.maxTrackAgeMs) {
        this.tracks.delete(trackId);
      } else {
        track.poseIndex = -1;
        track.landmarks = null;
      }
    }

    const matchedTrackIds = new Set();
    const matchedObservationIndexes = new Set();

    // A targeted ROI is created from the exact athlete the user selected. Its
    // single detection should retain that identity even when crouching/running
    // changes the pose shape too sharply for ordinary geometric matching.
    const forcedTrack = forcedTrackId != null ? this.tracks.get(forcedTrackId) : null;
    if (forcedTrack && observations.length === 1) {
      this.assignObservation(forcedTrack, observations[0], nowMs);
      matchedTrackIds.add(forcedTrack.id);
      matchedObservationIndexes.add(0);
    }

    const pairs = [];
    for (const track of this.tracks.values()) {
      if (matchedTrackIds.has(track.id)) continue;
      const elapsedSeconds = Math.min(0.6, Math.max(0, nowMs - track.updatedAt) / 1000);
      const missedSeconds = Math.max(0, nowMs - track.lastSeenAt) / 1000;
      const dx = track.vx * elapsedSeconds;
      const dy = track.vy * elapsedSeconds;
      const predictedCenter = { x: track.center.x + dx, y: track.center.y + dy };
      const predictedBox = translateBox(track.box, dx, dy);

      observations.forEach((candidate, observationIndex) => {
        const centerDistance = distance(predictedCenter, candidate.center);
        const gate = Math.min(
          0.42,
          0.08 + Math.max(track.scale, candidate.scale) * 0.62 + missedSeconds * 0.12
        );
        if (centerDistance > gate) return;

        const positionCost = centerDistance / Math.max(gate, 0.001);
        const overlapCost = 1 - boxIou(predictedBox, candidate.box);
        const scaleCost = Math.min(
          1,
          Math.abs(Math.log(Math.max(candidate.scale, 0.001) / Math.max(track.scale, 0.001)))
        );
        const bodyCost = shapeDifference(track.shape, candidate.shape);
        const cost =
          positionCost * 0.55 +
          overlapCost * 0.23 +
          scaleCost * 0.1 +
          bodyCost * 0.12;
        if (cost <= this.matchThreshold) {
          pairs.push({ track, candidate, observationIndex, cost });
        }
      });
    }

    // Global lowest-cost assignment prevents selection order from deciding who
    // owns an ambiguous pose when athletes cross paths.
    pairs.sort((a, b) => a.cost - b.cost);
    for (const pair of pairs) {
      if (
        matchedTrackIds.has(pair.track.id) ||
        matchedObservationIndexes.has(pair.observationIndex)
      ) continue;

      const { track, candidate } = pair;
      this.assignObservation(track, candidate, nowMs);
      matchedTrackIds.add(track.id);
      matchedObservationIndexes.add(pair.observationIndex);
    }

    observations.forEach((candidate, observationIndex) => {
      if (matchedObservationIndexes.has(observationIndex)) return;
      const id = this.nextId;
      this.nextId += 1;
      this.tracks.set(id, {
        id,
        center: candidate.center,
        box: candidate.box,
        scale: candidate.scale,
        shape: candidate.shape,
        vx: 0,
        vy: 0,
        poseIndex: candidate.poseIndex,
        landmarks: candidate.landmarks,
        updatedAt: nowMs,
        lastSeenAt: nowMs,
      });
    });

    const byPoseIndex = new Map();
    for (const track of this.tracks.values()) {
      if (track.poseIndex >= 0 && track.landmarks) {
        byPoseIndex.set(track.poseIndex, track);
      }
    }
    return { byPoseIndex, tracks: Array.from(this.tracks.values()) };
  }
}
