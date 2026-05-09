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

## Implemented (Feb 2026 – v1.1)
- **Tile-detection removal (Feb 2026)**: Tile detection was passing 3 detectForVideo calls per rAF tick with sub-millisecond timestamps (`ts`, `ts+0.1`, `ts+0.2`). MediaPipe Tasks rejects sub-ms timestamps as duplicates, silently returning empty results. Detection broke entirely. **Removed tile detection** — now selection AND recording in upload mode use a single full-frame `detectForVideo(v, performance.now())`. Reliable single code path. Tile/deep-scan can be re-added later as an explicit toggle for the rare 2-distant-athlete case.
- **Recording-tracking fix (Feb 2026)**: Skeleton was freezing on Start because (1) video seeked back to trim-start (often 0), invalidating the locked anchor, and (2) the strict 0.18 anchor-distance threshold rejected the now-far-away pose. Fixes:
  - Only seek backward if `currentTime < trimStart` — preserves user's scrubbed position.
  - Refresh `lastSeenAtRef` to "now" right before play.
  - Relax anchor threshold to **3x** during recording; always adopt the single detected pose when only one person is in frame.
- **iOS Safari video render fix (Feb 2026)**: Init does play→seek→pause to warm up the iOS video decoder + skip past opening black frames.
- **Custom play/pause overlay (Feb 2026)**: Bottom-left Play/Pause pill since native `<video controls>` are blocked by the canvas overlay.
- **Reset target on video change (Feb 2026)**: `targetAnchorRef` and tracking state reset whenever `videoSrc`/`mode` changes.
- **Loud detect-error logging (Feb 2026)**: `console.warn("[PoseCanvas] detect error", err)` so iOS Safari issues surface in remote consoles.

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
