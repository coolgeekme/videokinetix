import { detectShots } from "./shotDetection";

test("uses the tracked hoop position stored with each ball frame", () => {
  const originalHoop = { x: 0.2, y: 0.4, w: 0.1, h: 0.08 };
  const movingHoop = (x, y = 0.42) => ({ x, y, w: 0.1, h: 0.08 });
  const frames = [
    { t: 0.0, x: 0.48, y: 0.62, conf: 1, hoop: movingHoop(0.43) },
    { t: 0.1, x: 0.49, y: 0.52, conf: 1, hoop: movingHoop(0.44) },
    { t: 0.2, x: 0.5, y: 0.36, conf: 1, hoop: movingHoop(0.45) },
    { t: 0.3, x: 0.51, y: 0.28, conf: 1, hoop: movingHoop(0.46) },
    { t: 0.4, x: 0.52, y: 0.36, conf: 1, hoop: movingHoop(0.47) },
    { t: 0.5, x: 0.53, y: 0.44, conf: 1, hoop: movingHoop(0.48) },
    { t: 0.6, x: 0.54, y: 0.52, conf: 1, hoop: movingHoop(0.49) },
    { t: 0.7, x: 0.55, y: 0.58, conf: 1, hoop: movingHoop(0.5) },
  ];

  const result = detectShots(frames, originalHoop);
  expect(result.attempts).toBe(1);
  expect(result.makes).toBe(1);
});
