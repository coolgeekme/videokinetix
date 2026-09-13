# VisionKinetix.ai – AI Motion Capture Athlete Training Platform – PRD

## Original Problem Statement
AI-Assisted Sport-Agnostic Athlete Training Platform leveraging FreeMoCap-style markerless motion capture and AI analysis to deliver personalized training programs across basketball, soccer, swimming, and pickleball.

## User Personas
- **Recreational athlete** wanting elite-grade form feedback without a coach
- **Competitive amateur** tracking progress and setting performance targets
- **Coach (future)** managing multiple athletes (deferred)

## Architecture
- **Backend**: FastAPI + MongoDB (motor)
  - JWT (PyJWT) + bcrypt auth
  - GPT-5.2 via emergentintegrations for form analysis & training plans
- **Frontend**: React 19 + Tailwind + shadcn UI + Recharts
  - MediaPipe Pose (CDN) for in-browser motion capture & skeleton overlay
- **Theme**: Dark, Barlow Condensed + Manrope, Red #FF3B30 / Green #00FF88

## Feature (Sep 2026 – v1.7 Capture-quality guard: refuse to analyse a capture that isn't an athlete)
- **Why**: a real user clip (portrait, underwater, swimmer arriving head-on) produced a full report whose every number came from water. BlazePose never found the swimmer — all 85 poses it reported were false positives on the water surface (the distorted reflection of the lane rope) and, close in, on the splash plume. Verified by overlaying detector landmarks on the frames. The old resolver adopted them, so the app "tracked" water for 79 of 120 frames and reported stroke metrics from it. The failure was not an error; it was a fabrication.
- **`frontend/src/lib/captureQuality.js`** (new): `assessCaptureQuality({ frames, tracking })` → `{ level: 'good'|'fair'|'poor'|'unusable', reasons[], advice[], metrics }`. Signals and thresholds were measured, not guessed — comparing the bad clip against six real underwater swim clips (raw detector dumps in `tests/fixtures/`):
  | signal | real clips | the bad clip |
  |---|---|---|
  | median bbox aspect (h/w) | 0.39 – 1.30 | **2.72** (p90 4.77) |
  | median off-frame joints | 0.00 (all six) | **0.18** |
  | mean key-joint visibility | 0.66 – 0.98 | **0.62** |
  A surface reflection is a tall, narrow, vertically smeared streak whose "limbs" run off the top of frame with poor confidence; a swimmer filmed in profile is none of those. Medians, not means, so a few outlier frames can't condemn a good capture. Any single hard failure → `unusable`; on the six real clips nothing real trips any of them (POV surface-swim rates `poor`, not `unusable`).
- **`lib/repDetection.js`**: `analyzeSession(frames, sport, { captureQuality })` short-circuits when the capture is `unusable` — returns `rep_count: 0`, `reps: []`, `overall_score: null`, `unreliable: true` and the reasons, instead of computing metrics from garbage.
- **`backend/ai_service.py`**: refuses the LLM analysis outright for an unusable capture (no model call, so no invented coaching) and reports the measured reasons + the framing fix. Also removed the fabricated `form_score: 60` from the no-reps fallback — a score is now withheld (`None`) when nothing was measured.
- **UI**: `SessionDetail` shows a full-width "This clip couldn't be analysed" banner with the measured reasons and the concrete framing fix, and renders the form score as `—` rather than a number. `PoseCanvas` sends detect-tick tallies (confirmed / coasted / lost) plus the per-frame quality metrics in `pose_summary.capture_quality`.
- **`CameraGuide.jsx`** swimming guidance rewritten from what the measurements showed: side-on at mid-depth, swimmer crossing the middle of the frame, surface as a thin strip, mark the water line, camera still — and an explicit note that head-on clips from the wall usually can't be analysed.
- **Copy fix**: the in-capture warning banner said "Tracking lost — re-locking…" but the tracker no longer silently re-locks; it now reads "Athlete lost — tap to re-lock", matching the tracking pill.
- **Tests**: `frontend/tests/captureQuality.test.mjs` (9 cases) added on top of the tracker suite — total 24, all passing via `node --test tests/`. Includes the real-footage pass direction (a clean clip stays `good`, a clip containing both swimmer and reflection is not refused) and the refusal path through `analyzeSession`.
- **Score withholding is None-safe end to end**: removing the fabricated score exposed `int(analysis.get("form_score", 70))` in `server.py` (which would have raised `TypeError` on a withheld score and otherwise invented a 70), every dashboard/leaderboard aggregate that summed `form_score`, and three pages that rendered the score directly. New `_score_of()` helper returns `int | None` and aggregates SKIP unmeasured sessions rather than counting them as zero; `Sessions`, `AthleteDetail` and `SessionDetail` render `—` in neutral grey. Logic verified against `{82, None, missing, 0, true, 77.6, "70"}` → `[82, None, None, 0, None, 77, None]`.
- **Impact**: a clip like this now fails loudly instead of scoring. Any capture that trips the guard is one where the pose data was never the athlete's.

## Bug fixes (Sep 2026 – v1.6 Swimming: the water surface's reflection stole the target lock)
- **Symptom**: underwater swim captures locked onto the swimmer's *reflection* instead of the swimmer ("capturing the correct swimmer" failure). Every downstream metric — stroke count, catch elbow angle, body roll — was then derived from the mirror image.
- **Root cause** (`PoseCanvas.jsx`): the target resolver picked, each frame, the detected pose whose hip centre was nearest the previous anchor, and **adopted an isolated pose unconditionally** (no distance check when only one pose was detected). Because adopting a pose overwrote the anchor, one bad adoption permanently relocated the lock and the real swimmer could never win it back. Underwater, the water surface is a mirror, so this fires constantly. Measured on real footage (BlazePose full, numPoses 5, conf 0.3): the detector's output alternated between swimmer and reflection — 82 frames swimmer-only, **45 reflection-only**, 10 both, 26 neither — and it re-interprets a vertically flipped person as an *upright* person, so the reflection's joint geometry is **not** anti-correlated with the swimmer's (measured +0.74 / −0.32 / +0.59). Replaying the old rule over that footage: **49 of 136 adopted frames (36%) were the reflection**.
- **Fix**: identity resolution moved to `frontend/src/lib/targetTracking.js`. The anchor is never overwritten by a detection — it coasts on a clamped velocity estimate that *decays while unconfirmed* — and adoption is gated by a motion-scaled radius around the predicted anchor (base 0.10, max 0.22, vs the measured 0.55 swimmer↔reflection separation). Swimming can optionally mark the water surface (tap the water line) so the reflective side is excluded outright; only then may the gate widen after a dropout, because only then is relaxing provably safe. Mirror-image pose pairs are reported so the UI can prompt for the water line instead of guessing.
- **Measured result** on the recorded fixture: reflection adoptions **49 → 0**, swimmer confirmations 87 → 84; on a plain underwater clip with no reflection **99%** of detections stay tracked (old rule 100%), so normal footage is not starved.
- **Tests**: `frontend/tests/targetTracking.test.mjs`, 15 cases including replays over recorded BlazePose output in `frontend/tests/fixtures/` (capture recipe + provenance in that folder's README). Run with `node --test tests/targetTracking.test.mjs`. The pre-fix resolver is included as `legacyAdopt` so each regression test shows old-vs-new on identical input.
- **UI**: tracking pill reports lock state ("Athlete hidden — holding lock" / "Athlete lost — tap to re-lock"); swimming gets a water-line control (set / move / clear) with a skippable placement step; a notice appears when a tap is ambiguous between two mirror-image poses.

## Bug fixes (Feb 2026 – v1.5.1 basketball rep over-counting)
- **8 reps reported for 4 actual shots** (`repDetection.js`): the basketball pose-peak detector was counting every wrist-rise as a rep, including the *catch-the-ball-to-chest* motion that happens ~1s before each shot release. Two fixes:
  1. **`validatePeak` gate**: a peak only counts as a release if the shooting wrist crosses **above the shoulder line** (5% margin). A catch/load motion peaks at chest/chin level (below shoulders) and is now correctly dropped.
  2. **Tighter thresholds**: `minRepIntervalSec` 1.2s → 1.8s; `minProminence` 0.08 → 0.15.
  3. **Ball-trajectory cross-validation**: when ball-tracked shots exist (basketball + locked ball + hoop ROI), reps are filtered to only those within ±1.5s of a real ball-tracked shot — ground-truth filter for cases where pose still trips.
- Verified with synthetic test (simulated 4 shots with catch/load/release/follow-through motions): **OLD = 8 reps, NEW = 4 reps**.

## Feature (Feb 2026 – v1.5 Unlimited video uploads)
- **Removed effective upload size/length limits**. Three changes work together:
  1. `backend/server.py`: `MAX_VIDEO_BYTES` bumped from 80 MB → **2 GB**.
  2. `PoseCanvas.jsx` (`startRecorders`): in upload mode, the **raw** variant is now recorded from `videoElement.captureStream()` instead of re-uploading the original `File`. Because MediaRecorder runs only from Start → Stop, even a 1-hour source video produces just a clip of the trimmed analysis window in storage.
  3. `Capture.jsx`: removed the unused `videoFile` state + fallback re-upload path; updated the Upload card copy to "Any length, any size — trim to the moment you want analyzed."
- Result: users can drag in arbitrarily large/long videos, scrub to the moment, set the trim window, and only the relevant clip is analyzed and (optionally) saved.

## Bug fixes (Feb 2026 – v1.4.3 video-pause regression)
- **Uploaded video kept pausing itself mid-playback (basketball)** (`PoseCanvas.jsx`): on Brave/Windows, running pose + object detection at the full rAF rate (each ~20-30ms) saturated the main thread and starved the `<video>` decoder, causing the browser to auto-pause the video due to buffer underrun. Two fixes: (1) halve the basketball object-detection rate by skipping every other detect tick (`ballDetectFrameSkipRef`) — pose stays at 30Hz, ball runs at ~15Hz which is plenty for shot tracking; (2) listen for `canplay`/`canplaythrough` events while recording and automatically `play()` again if the video is paused due to a buffer event (skips natural trim-end stops).

## Bug fixes (Feb 2026 – v1.4.2 perf)
- **Choppy uploaded-video playback** (`PoseCanvas.jsx` + `MultiPlayerPoseCanvas.jsx`): pose + ball detection was running on every `requestAnimationFrame` tick (~60Hz) but uploaded videos play at 30fps and paused videos don't advance at all. Each detection blocks the main thread ~10-30ms — at 60Hz that consumes 60-100% of one core, starving the `<video>` element and causing it to drop playback frames (visibly choppy on Windows Brave with longer/HEVC clips). Fix: throttle detection to actual video frame changes by tracking `lastDetectVideoTimeRef` and only running when `video.currentTime` has advanced. Paused-frame tap-lock still works because a seek/scrub fires one detection. Net effect: ~50% less CPU during playback, smooth `<video>` rendering.

## Bug fixes (Feb 2026 – v1.4.1)
- **Basketball ball-tracking identity switch** (`PoseCanvas.jsx`): the locked ball would jump to a stationary "court decoy" basketball at shot release because the moving ball was briefly occluded by the shooter's hand, leaving the decoy as the only candidate inside the 0.45-norm gate from the (low-velocity) anchor. Fix: classify each detected ball as **stationary** if a similarly-positioned detection (within 2.5% of frame) has been present in ≥12 of the last 18 frames, and exclude any stationary candidate from the locked-ball candidate pool unless it sits within 5% of the current anchor (i.e., it IS the locked ball). When the moving ball is briefly undetected, the tracker now falls through to its existing 250ms velocity extrapolation instead of stealing onto the decoy.

## Implemented (Feb 2026 – v1.4 Save + Replay Captured Video — Phase C)
- **Emergent object storage integration**: `backend/storage.py` wraps the Emergent objstore API (init_storage at startup, put_object/get_object with 403→re-init retry). All videos prefixed `visionkinetix/videos/{user_id}/{session_id}/`.
- **Endpoints**:
  - `POST /api/sessions/{id}/video` (multipart `variant` + `file`) — uploads raw or overlay variant, validates MIME (mp4/webm/etc.), 80MB cap, soft-deletes prior copy of same variant.
  - `GET /api/sessions/{id}/videos` — list latest stored videos for the session.
  - `GET /api/sessions/{id}/video/{variant}` — streams binary; supports `?auth=<jwt>` query fallback for `<video src>` tags (added to `auth.get_current_user_id`).
  - `DELETE /api/sessions/{id}/video/{variant}` — soft-delete.
  - `POST /api/sessions/{id}/reanalyze` — re-runs LLM analysis on stored `pose_summary`.
  - `DELETE /api/sessions/{id}` now cascade soft-deletes the session's videos.
- **Frontend Capture**: opt-in checkbox "Save video for replay" (default off, `data-testid="save-video-toggle"`). When on, `PoseCanvas` spins up two `MediaRecorder` instances — one on `canvas.captureStream()` of a hidden composite canvas (video + skeleton drawn each frame) for the overlay variant, one on the webcam `MediaStream` for the raw variant (live mode). Uploaded-video mode re-uploads the original `File` as the raw variant. Best-effort upload after session creation.
- **Frontend SessionDetail**: `VideoReplayCard` renders an HTML5 `<video>` player with variant tabs (skeleton overlay / raw) when both exist, a **Re-analyze** button (idempotent LLM rerun on stored pose data), and per-variant delete.
- **Tested**: backend 16/16 pytest pass (`/app/backend/tests/test_videos.py`). Frontend UI validated.

## Implemented (Feb 2026 – v1.3 Theming + PDF Export)
- **Light/Dark theme toggle**: `useTheme` hook with module-level state + subscribers (cross-component sync), preference saved in `localStorage` under `vk_theme`. OS preference respected on first visit. Toggle button (Sun/Moon icon, `data-testid="theme-toggle"`) lives in the Landing header and AppShell header. Light mode is delivered via `html.light` overrides in `index.css` that flip hardcoded `bg-[#0a0a0a]`, `text-white`, `border-white/10`, etc. Red CTAs explicitly retain white text.
- **PDF export for reports**: `lib/pdfExport.js` uses `html2canvas` + `jspdf` to snapshot the SessionDetail or MatchDetail `reportRef` node into a multi-page A4 PDF. Forces a dark snapshot regardless of current theme. Buttons: `data-testid="download-pdf-btn"` on SessionDetail, `data-testid="download-match-pdf-btn"` on MatchDetail. 50ms yield ensures the "Building PDF" spinner renders before html2canvas blocks the main thread.

## Implemented (Feb 2026 – v1.2 Basketball Make/Miss Tracking)
- **MediaPipe Object Detector integration**: ball-tracking via `efficientdet_lite0` model (Apache 2.0, browser-side, free). Loaded lazily for basketball sport only, runs at half framerate for performance.
- **Tap-to-place hoop ROI**: After locking the athlete, basketball capture prompts "Step 2/2 · Tap the rim to place the hoop". Cyan dashed rectangle marks the hoop region. Reposition button available pre-recording.
- **Live make/miss counter**: Real-time pill in top-right showing "Shots: makes/attempts · FG%". Detects shot apex above hoop → tracks descent → counts make if ball passes through ROI from above with downward velocity.
- **Outcome-correlated AI coaching**: `ai_service.analyze_form` for basketball with shot data computes form deltas between makes vs misses (e.g., shooting_elbow_angle on makes 165° vs misses 148°) and prompts GPT-5.2 to identify the largest-delta factor. AI summary cites makes/attempts/FG%.
- **Outcome-driven training plans**: `generate_training_plan` for basketball with shot data requires ≥3 of 7 days target the form factor most correlated with misses.
- **Shooting stats card** in SessionDetail: makes / attempts / FG% display + ✓/✗ markers on the per-rep sparkline for shots paired with outcomes.
- **Live webcam + uploaded video** both supported.

## Implemented (Feb 2026 – v1.1)
- **Tile-detection removal**: Tile detection was passing 3 detectForVideo calls per rAF tick with sub-millisecond timestamps. MediaPipe Tasks rejects sub-ms timestamps as duplicates, silently returning empty results. Detection broke entirely. **Removed** — selection AND recording in upload mode use single full-frame `detectForVideo(v, performance.now())`.
- **Recording-tracking fix**: Skeleton was freezing on Start due to seek-back to trim-start + strict 0.18 anchor threshold. Fixes: only seek backward if `currentTime < trimStart`, refresh `lastSeenAtRef`, relax anchor threshold to 3× during recording, always adopt the single detected pose.
- **iOS Safari video render fix**: Init does play→seek→pause to warm up the iOS video decoder + skip past opening black frames.
- **Custom play/pause overlay**: Bottom-left Play/Pause pill since native `<video controls>` are blocked by canvas overlay.
- **Reset target on video change**: tracking state resets when `videoSrc`/`mode`/`sport` change.
- **Loud detect-error logging**: `console.warn("[PoseCanvas] detect error", err)`.

## Implemented (Feb 2026 – v1.0)
- Auth: register / login / me  (`/api/auth/*`)
- Sports catalog (`/api/sports`) — 4 sports
- Capture flow: live webcam + video upload using MediaPipe Pose
- 33-keypoint skeleton overlay with neon-green wireframe
- Pose summary metrics: knee/elbow angles, shoulder/hip tilts, symmetry, visibility
- AI form analysis (GPT-5.2): form score, strengths, improvements with severity, elite comparison, next focus
- AI 7-day training plan: drills, sets, cues, milestones
- Sessions list + detail view
- Dashboard: stats, form-score timeline (Recharts), per-sport breakdown, streak, recent sessions
- Goals: create / list / toggle complete

## Backlog
- **P1**
  - Coach / team mode (multi-athlete dashboards)
  - Stripe-based freemium + premium tiers
  - Saved skeletal video playback (object storage)
  - Side-by-side benchmark video comparison
- **P2**
  - Community leaderboards & shareable session cards
  - Mobile (React Native) app
  - Wearable / IMU integration (HRV, ground-reaction)
  - Multi-camera FreeMoCap desktop pipeline for 3D capture

## Next Tasks
- Add session video persistence (object storage playbook)
- Stripe freemium gating
- Coach dashboard
