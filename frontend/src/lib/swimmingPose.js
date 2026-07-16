const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_ELBOW = 13;
const RIGHT_ELBOW = 14;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

export function swimmingLandmarkVisible(point, threshold = 0.18) {
  return Boolean(
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    (point.visibility == null || point.visibility >= threshold)
  );
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Swimming identity anchor that does not depend on hips. A head-on swimmer is
 * foreshortened and the pelvis is frequently hidden by bubbles or the torso,
 * while the shoulder line remains the most stable visible body structure.
 */
export function swimmingUpperBodyAnchor(landmarks) {
  const leftShoulder = landmarks?.[LEFT_SHOULDER];
  const rightShoulder = landmarks?.[RIGHT_SHOULDER];
  if (
    swimmingLandmarkVisible(leftShoulder) &&
    swimmingLandmarkVisible(rightShoulder)
  ) {
    return midpoint(leftShoulder, rightShoulder);
  }

  const upperBody = [
    LEFT_SHOULDER,
    RIGHT_SHOULDER,
    LEFT_ELBOW,
    RIGHT_ELBOW,
    LEFT_WRIST,
    RIGHT_WRIST,
  ]
    .map((index) => landmarks?.[index])
    .filter((point) => swimmingLandmarkVisible(point));
  if (upperBody.length < 2) return null;
  return {
    x: upperBody.reduce((sum, point) => sum + point.x, 0) / upperBody.length,
    y: upperBody.reduce((sum, point) => sum + point.y, 0) / upperBody.length,
  };
}

export function hasUsableSwimmingUpperBody(landmarks) {
  const shoulders = [LEFT_SHOULDER, RIGHT_SHOULDER]
    .map((index) => landmarks?.[index])
    .filter((point) => swimmingLandmarkVisible(point)).length;
  const arms = [LEFT_ELBOW, RIGHT_ELBOW, LEFT_WRIST, RIGHT_WRIST]
    .map((index) => landmarks?.[index])
    .filter((point) => swimmingLandmarkVisible(point)).length;
  return shoulders >= 1 && arms >= 2;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * View-independent freestyle stroke signal. It measures the longer visible
 * shoulder-to-wrist reach, normalized by shoulder width, so horizontal,
 * diagonal, and camera-facing swimmers produce the same kind of cycle.
 */
export function swimmingArmExtensionSignal(landmarks) {
  const leftShoulder = landmarks?.[LEFT_SHOULDER];
  const rightShoulder = landmarks?.[RIGHT_SHOULDER];
  if (
    !swimmingLandmarkVisible(leftShoulder) ||
    !swimmingLandmarkVisible(rightShoulder)
  ) return 0;

  const shoulderWidth = Math.max(0.035, distance(leftShoulder, rightShoulder));
  const reaches = [];
  const leftWrist = landmarks?.[LEFT_WRIST];
  const rightWrist = landmarks?.[RIGHT_WRIST];
  if (swimmingLandmarkVisible(leftWrist)) {
    reaches.push(distance(leftShoulder, leftWrist) / shoulderWidth);
  }
  if (swimmingLandmarkVisible(rightWrist)) {
    reaches.push(distance(rightShoulder, rightWrist) / shoulderWidth);
  }
  return reaches.length ? Math.min(6, Math.max(...reaches)) : 0;
}
