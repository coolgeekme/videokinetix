# Vision Kinetix

Motion-capture training analysis with persistent athlete identity tracking.

## Enhanced tracking architecture

The capture flow deliberately separates identity from biomechanics:

1. MediaPipe Object Detector finds all person boxes in the browser.
2. The backend converts those boxes into `supervision.Detections`.
3. Roboflow BoT-SORT assigns persistent player IDs and compensates for camera movement.
4. The selected tracked box becomes a padded, high-resolution MediaPipe Pose ROI.
5. Pose landmarks are mapped back to full-frame coordinates for rep and form analysis.

If the selected player is occluded, the recording stores an explicit landmark gap. It
does not silently use the pose of a player crossing through the selected box.

## Test the branch locally (Windows PowerShell)

The frontend and backend from this branch must run together. Pointing the branch
frontend at `https://visionkinetix.ai` will use the published backend, which does not
have branch-only tracking endpoints until a backend preview is deployed.

Use Python 3.12 for the tracking backend. From the repository root:

```powershell
git switch feature/persistent-athlete-tracking
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn server:app --reload --port 8000
```

The existing backend environment variables, including `MONGO_URL` and `DB_NAME`,
must be available in `backend/.env`.

In a second PowerShell window:

```powershell
cd "C:\Users\reggi\Documents\Vision Kinetix\frontend"
$env:REACT_APP_BACKEND_URL="http://localhost:8000"
npm.cmd install --legacy-peer-deps
npm.cmd start
```

Open `http://localhost:3000/app/capture`. The lower-left status must say
**BoT-SORT identity**. If it says **Local pose fallback**, the branch backend or its
tracking dependencies are not available.

## Verification

```powershell
cd frontend
npm.cmd test -- --watchAll=false
npm.cmd run build
```

Backend tracking sessions are currently process-local. Production should run one API
worker for tracking requests or use sticky routing/shared session state.
