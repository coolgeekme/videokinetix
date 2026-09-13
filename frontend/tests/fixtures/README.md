# Test fixtures — real MediaPipe output

These files are **recorded output from BlazePose**, not hand-written data. They exist
because the design of `src/lib/targetTracking.js` was changed by what they showed
(see the module header): a plausible-sounding "the reflection's skeleton must be a
vertically mirrored copy, so its joint geometry will be anti-correlated" test turned
out to be false on real detections, and a pure proximity gate starved the tracker.

## Format

One JSON object per line:

```json
{"t": 560, "w": 960, "h": 540, "poses": [[[x, y, visibility], ... 33 landmarks ...], ...]}
```

`t` is milliseconds, `poses` is one entry per detected person in frame.
Coordinates are normalised to the frame (MediaPipe's own convention, x/y in 0..1).

## Capture recipe

Inference options are the ones `PoseCanvas.jsx` configures:

```
model                            pose_landmarker_full (float16/latest)
running_mode                     VIDEO
num_poses                        5
min_pose_detection_confidence    0.3
min_pose_presence_confidence     0.3
min_tracking_confidence          0.3
```

The browser build was replaced by the equivalent Python tasks runtime
(`mediapipe.tasks.python.vision.PoseLandmarker`) because the headless capture box
has no working WebGL context; both run the same inference graph and options, and
the same `.task` weights. Sampling: 15 Hz over the first 13 s of each source clip.

## Files

### `reflection_composite.jsonl` — the regression case

Source: *Front Crawl Underwater* (Wikimedia Commons, `9/9b/Front_Crawl_Underwater.webm`),
a side view of a freestyle swimmer filmed under water.

Prepared with ffmpeg into the geometry of an underwater shot with a surface
reflection: the lower half of the frame holds the swimmer, the upper half holds a
vertically flipped, slightly blurred/dimmed copy of the same swimmer, standing in
for the mirror image the water surface returns. The waterline is therefore **y = 0.5**:
poses with hip centre `y > 0.5` are the swimmer, `y < 0.5` are the reflection.

```
real (bottom half) <- crop 1920x540+0+270 of the source
reflection (top)   <- vflip, boxblur 3:1, brightness -0.06, saturation 0.85
```

Measured facts (recomputed by the test suite):

| quantity | value |
|---|---|
| frames | 163 |
| only swimmer detected | 82 |
| only reflection detected | 45 |
| both | 10 |
| neither | 26 |
| swimmer frame-to-frame motion step | 0.023 median, 0.098 p90 |
| swimmer ↔ reflection separation | dy 0.55–0.67, \|dx\| ≤ 0.074 |
| joint-geometry correlation, swimmer vs reflection | +0.74, −0.32, +0.59 … (unreliable) |

Replaying the **pre-fix** resolver over this file adopts the reflection on
**49 of 136** adopted frames (36%). The shipped resolver adopts **0** — both with a
waterline configured and without one, because the swimmer↔reflection separation
(0.55+, against a gate capped at 0.22) is what keeps the mirror image out; the
waterline is the belt-and-braces for shallow angles where they sit closer together,
and it is what allows the gate to widen safely after a dropout (recovery).

Swimmer confirmations on this fixture: 84 (52% of frames) with the waterline, 80
without, versus 87 for the old rule — i.e. the fix costs almost nothing in coverage
while removing every wrong lock.

### `underwater_swimmer.jsonl` — the non-regression case

Source: the same clip, unmodified — a swimmer under water, no reflection in frame.
Used to assert the new resolver does not starve normal footage: the old rule and the
new rule should both track ~all of it.

## Regenerating

`videokinetix-repro/extract.py` (a scratch directory next to the repo, not committed)
produced these from the source clips; the clips themselves are not committed (they
are 10 MB+ each, CC-licensed). The browser-based capture harness that was tried
first is there too — it is not usable on a headless box without a working WebGL
context, which is why the equivalent Python tasks runtime was used instead.
