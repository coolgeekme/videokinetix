import { getCapturePlaybackPlan } from "./capturePlayback";

describe("capture playback planning", () => {
  test("rewinds a video that already ended", () => {
    expect(getCapturePlaybackPlan({
      currentTime: 35,
      duration: 35,
      ended: true,
    })).toMatchObject({ start: 0, end: 35, shouldRewind: true });
  });

  test("treats the final fraction of a clip as terminal", () => {
    expect(getCapturePlaybackPlan({
      currentTime: 34.4,
      duration: 35,
    }).shouldRewind).toBe(true);
  });

  test("preserves an intentional scrub in the middle of the clip", () => {
    expect(getCapturePlaybackPlan({
      currentTime: 12,
      duration: 35,
    }).shouldRewind).toBe(false);
  });

  test("rewinds to a configured trim start when outside the window", () => {
    expect(getCapturePlaybackPlan({
      currentTime: 2,
      duration: 35,
      trimStart: 5,
      trimEnd: 20,
    })).toEqual({ start: 5, end: 20, shouldRewind: true });
  });
});
