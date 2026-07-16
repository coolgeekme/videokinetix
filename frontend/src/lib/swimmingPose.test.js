import {
  hasUsableSwimmingUpperBody,
  swimmingArmExtensionSignal,
  swimmingUpperBodyAnchor,
} from "./swimmingPose";

function pose() {
  return Array.from({ length: 33 }, () => null);
}

test("anchors a head-on swimmer from shoulders when hips are hidden", () => {
  const landmarks = pose();
  landmarks[11] = { x: 0.3, y: 0.45, visibility: 0.9 };
  landmarks[12] = { x: 0.5, y: 0.55, visibility: 0.9 };
  landmarks[23] = { x: 0.95, y: 0.95, visibility: 0.02 };
  landmarks[24] = { x: 0.95, y: 0.95, visibility: 0.02 };

  expect(swimmingUpperBodyAnchor(landmarks)).toEqual({ x: 0.4, y: 0.5 });
});

test("accepts shoulder and arm motion without visible hips", () => {
  const landmarks = pose();
  landmarks[11] = { x: 0.4, y: 0.5, visibility: 0.8 };
  landmarks[13] = { x: 0.3, y: 0.55, visibility: 0.8 };
  landmarks[15] = { x: 0.2, y: 0.6, visibility: 0.8 };

  expect(hasUsableSwimmingUpperBody(landmarks)).toBe(true);
});

test("arm extension signal is independent of screen orientation", () => {
  const horizontal = pose();
  horizontal[11] = { x: 0.4, y: 0.5, visibility: 0.9 };
  horizontal[12] = { x: 0.6, y: 0.5, visibility: 0.9 };
  horizontal[15] = { x: 0.1, y: 0.5, visibility: 0.9 };
  horizontal[16] = { x: 0.7, y: 0.5, visibility: 0.9 };

  const vertical = pose();
  vertical[11] = { x: 0.5, y: 0.4, visibility: 0.9 };
  vertical[12] = { x: 0.5, y: 0.6, visibility: 0.9 };
  vertical[15] = { x: 0.5, y: 0.1, visibility: 0.9 };
  vertical[16] = { x: 0.5, y: 0.7, visibility: 0.9 };

  expect(swimmingArmExtensionSignal(horizontal)).toBeCloseTo(
    swimmingArmExtensionSignal(vertical),
    5
  );
});
