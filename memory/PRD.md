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
- **iOS Safari video render fix (Feb 2026)**: Uploaded videos rendered as a black frame on iOS until `.play()` was called (iOS quirk). Init now performs play→seek→pause to warm up the decoder + skip past the opening black frame. Detection now sees actual pixels from the get-go.
- **Custom play/pause overlay (Feb 2026)**: Native `<video controls>` are blocked by the canvas overlay (which handles tap-to-select). Added a bottom-left Play/Pause pill button (`data-testid="video-play-pause-btn"`) so mobile users can scrub through the video to find an athlete-rich frame.
- **Reset target on video change (Feb 2026)**: `targetAnchorRef` and tracking state now reset whenever `videoSrc`/`mode` changes — prevents stale anchor from a previous upload triggering smart-ROI on coordinates that no longer match.
- **Smart-ROI tracking during recording (Feb 2026)**: Once a target is locked AND user clicks Start, detection switches from 3x tile-detection to a **single** detection on a tile (50% wide × 70% tall) centered around the target's last hip position. ROI follows the athlete frame-to-frame. Falls back to full-frame on ROI miss.
- **Tile detection FIX (Feb 2026)**: Fixed `ReferenceError: hasTargetRef is not defined` in `PoseCanvas.jsx` that was silently swallowed by try/catch — meaning tile-detection NEVER ran. Selection phase now runs full-frame + left + right tile detection with hip-center dedupe so distant/small athletes appear in the multi-pose preview.

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
