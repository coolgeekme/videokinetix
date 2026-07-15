import { assessFrameQuality } from "./frameQuality";

function fullBodyPose(height) {
  const top = 0.3;
  const bottom = top + height;
  const pose = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: (top + bottom) / 2,
    visibility: 0.95,
  }));
  pose[0] = { x: 0.5, y: top, visibility: 0.95 };
  pose[11] = { x: 0.46, y: top + height * 0.25, visibility: 0.95 };
  pose[12] = { x: 0.54, y: top + height * 0.25, visibility: 0.95 };
  pose[15] = { x: 0.44, y: top + height * 0.5, visibility: 0.95 };
  pose[16] = { x: 0.56, y: top + height * 0.5, visibility: 0.95 };
  pose[23] = { x: 0.47, y: top + height * 0.55, visibility: 0.95 };
  pose[24] = { x: 0.53, y: top + height * 0.55, visibility: 0.95 };
  pose[27] = { x: 0.47, y: bottom, visibility: 0.95 };
  pose[28] = { x: 0.53, y: bottom, visibility: 0.95 };
  return pose;
}

describe("assessFrameQuality", () => {
  test("accepts a clear athlete occupying 28% of a 1080p frame", () => {
    const result = assessFrameQuality([fullBodyPose(0.28)], { sport: "basketball" });
    expect(result.issues.some((issue) => issue.includes("very small"))).toBe(false);
  });

  test("warns when an athlete occupies less than 20% of the frame", () => {
    const result = assessFrameQuality([fullBodyPose(0.15)], { sport: "basketball" });
    expect(result.issues).toContain(
      "Athlete very small — zoom in or move camera closer"
    );
  });
});
