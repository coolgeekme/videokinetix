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
- **Recording-tracking fix (Feb 2026)**: Skeleton was freezing on the first frame after Start because (1) video seeked back to trim-start (often 0), invalidating the locked anchor, and (2) the strict 0.18 anchor-distance threshold rejected the now-far-away pose, forcing tracking-lost. Fixes:
  - Only seek backward if `currentTime < trimStart` — preserves user's scrubbed position.
  - Refresh `lastSeenAtRef` to "now" right before play so grace period starts fresh.
  - Relaxed anchor threshold to **3x** during recording (`runningRef.current`) and always adopt the single detected pose when only one person is in frame.
  - Replaced smart-ROI / tile detection during recording with **plain full-frame detection** — simpler, more reliable, fast enough for 1-athlete tracking.
  - Detect-error logging upgraded from silent `console.debug` to loud `console.warn("[PoseCanvas] detect error", err)` so iOS Safari issues surface in remote console viewers.
- **iOS Safari video render fix (Feb 2026)**: Init now does play→seek→pause to warm up the iOS video decoder + skip past opening black frames.
- **Custom play/pause overlay (Feb 2026)**: Bottom-left Play/Pause pill (`data-testid="video-play-pause-btn"`) since native `<video controls>` are blocked by the canvas overlay.
- **Reset target on video change (Feb 2026)**: `targetAnchorRef` and tracking state reset whenever `videoSrc`/`mode` changes.
- **Tile detection FIX (Feb 2026)**: Fixed `ReferenceError: hasTargetRef is not defined` that was silently swallowed — selection phase now properly runs full-frame + left + right tile detection so distant/small athletes appear.

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
