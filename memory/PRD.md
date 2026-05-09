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
