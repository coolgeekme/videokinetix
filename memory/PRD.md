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
