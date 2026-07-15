import { findTemplate, prepareTemplate } from "./templateTracker";

test("finds a shifted rim template", () => {
  const templateWidth = 5;
  const templateHeight = 3;
  const pattern = Float32Array.from([
    5, 20, 90, 20, 5,
    20, 120, 240, 120, 20,
    5, 20, 90, 20, 5,
  ]);
  const searchWidth = 16;
  const searchHeight = 10;
  const search = new Float32Array(searchWidth * searchHeight).fill(12);
  const expectedX = 8;
  const expectedY = 5;
  for (let y = 0; y < templateHeight; y += 1) {
    for (let x = 0; x < templateWidth; x += 1) {
      search[(expectedY + y) * searchWidth + expectedX + x] =
        pattern[y * templateWidth + x];
    }
  }

  const match = findTemplate(
    search,
    searchWidth,
    searchHeight,
    prepareTemplate(pattern, templateWidth, templateHeight)
  );
  expect(match.x).toBe(expectedX);
  expect(match.y).toBe(expectedY);
  expect(match.score).toBeGreaterThan(0.99);
});
