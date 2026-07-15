import {
  appearanceSimilarity,
  blendAppearance,
  createSpatialColorHistogram,
} from "./appearanceDescriptor";

function solidRegions(top, bottom, width = 8, height = 8) {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const color = y < height / 2 ? top : bottom;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      rgba.set([...color, 255], i);
    }
  }
  return { rgba, width, height };
}

test("spatial clothing colors distinguish crossing athletes", () => {
  const blueShorts = solidRegions([25, 25, 25], [20, 70, 190]);
  const redShorts = solidRegions([25, 25, 25], [190, 35, 35]);
  const same = createSpatialColorHistogram(
    blueShorts.rgba,
    blueShorts.width,
    blueShorts.height
  );
  const other = createSpatialColorHistogram(
    redShorts.rgba,
    redShorts.width,
    redShorts.height
  );

  expect(appearanceSimilarity(same, same)).toBeCloseTo(1, 4);
  expect(appearanceSimilarity(same, other)).toBeLessThan(0.7);
});

test("appearance blending adapts without replacing the identity", () => {
  const a = createSpatialColorHistogram(
    solidRegions([20, 20, 20], [20, 70, 190]).rgba,
    8,
    8
  );
  const b = createSpatialColorHistogram(
    solidRegions([35, 35, 35], [30, 85, 205]).rgba,
    8,
    8
  );
  const blended = blendAppearance(a, b);
  expect(appearanceSimilarity(a, blended)).toBeGreaterThan(0.9);
});
