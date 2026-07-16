import {
  mapSwimmingCropLandmark,
  mapSwimmingCropPoses,
} from "./swimmingPoseCrop";

const crop = { x: 0.2, y: 0.1, width: 0.5, height: 0.8 };

test("maps an unrotated swimming crop into full-frame coordinates", () => {
  expect(mapSwimmingCropLandmark({ x: 0.4, y: 0.5 }, crop)).toEqual({
    x: 0.4,
    y: 0.5,
  });
});

test("maps a clockwise pose crop back into the source video", () => {
  const mapped = mapSwimmingCropLandmark(
    { x: 0.25, y: 0.6, visibility: 0.9 },
    crop,
    "clockwise"
  );
  expect(mapped.x).toBeCloseTo(0.5);
  expect(mapped.y).toBeCloseTo(0.7);
  expect(mapped.visibility).toBe(0.9);
});

test("maps a counterclockwise pose crop back into the source video", () => {
  const mapped = mapSwimmingCropLandmark(
    { x: 0.25, y: 0.6 },
    crop,
    "counterclockwise"
  );
  expect(mapped.x).toBeCloseTo(0.4);
  expect(mapped.y).toBeCloseTo(0.3);
});

test("maps every landmark in every detected pose", () => {
  const poses = [[{ x: 0, y: 0 }, { x: 1, y: 1 }]];
  expect(mapSwimmingCropPoses(poses, crop)).toEqual([
    [
      { x: 0.2, y: 0.1 },
      { x: 0.7, y: 0.9 },
    ],
  ]);
});
