import { useEffect, useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize2, SwitchCamera, Target, AlertTriangle, Play, Pause } from "lucide-react";
import { assessFrameQuality } from "../lib/frameQuality";
import { analyzeSession, getKeyframeTimestamps } from "@/lib/repDetection";

// MediaPipe BlazePose body skeleton connections (indices >= 11 only)
const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

// Distinct colours for unselected persons in the multi-pose preview
const PERSON_COLORS = ["#7dd3fc", "#fbbf24", "#c084fc", "#f472b6", "#94a3b8"];
const TARGET_COLOR = "#00ff88"; // green = currently tracked
const JOINT_COLOR_TARGET = "#ff3b30";

// Tracking thresholds (normalized 0-1 coordinates)
const TRACKING_DISTANCE_THRESHOLD = 0.18;
const TRACKING_LOST_GRACE_MS = 1500;

let landmarkerLoaderPromise = null;
async function loadPoseLandmarker() {
  if (landmarkerLoaderPromise) return landmarkerLoaderPromise;
  landmarkerLoaderPromise = (async () => {
    // Dynamic import of MediaPipe Tasks Vision (Apache 2.0). webpackIgnore so CRA
    // doesn't try to bundle the external URL.
    const mod = await import(
      /* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/+esm"
    );
    const { PoseLandmarker, FilesetResolver } = mod;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm"
    );
    const landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 5,
      minPoseDetectionConfidence: 0.3,
      minPosePresenceConfidence: 0.3,
      minTrackingConfidence: 0.3,
    });
    return landmarker;
  })();
  return landmarkerLoaderPromise;
}

let ballDetectorLoaderPromise = null;
async function loadBallDetector() {
  if (ballDetectorLoaderPromise) return ballDetectorLoaderPromise;
  ballDetectorLoaderPromise = (async () => {
    const mod = await import(
      /* webpackIgnore: true */ "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/+esm"
    );
    const { ObjectDetector, FilesetResolver } = mod;
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm"
    );
    const detector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite",
        // GPU is required for the float16 model variant. iOS Safari supports
        // WebGL2 — same delegate that the pose landmarker uses successfully.
        delegate: "GPU",
      },
      // More permissive threshold — basketballs in real-world video are often
      // small/blurry; 0.15 catches more true positives, false positives are
      // filtered downstream by the hoop-ROI shot detector.
      scoreThreshold: 0.15,
      runningMode: "VIDEO",
      categoryAllowlist: ["sports ball"],
      maxResults: 3,
    });
    return detector;
  })();
  return ballDetectorLoaderPromise;
}

function hipCenter(lm) {
  const lh = lm[23];
  const rh = lm[24];
  if (!lh || !rh) return null;
  return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
}

function dist2D(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export default function PoseCanvas({
  onStop,
  mode = "live",
  videoSrc = null,
  sport = "basketball",
  athleteId = null,
  onReady,
  trimStart = 0,
  trimEnd = null,
  saveVideo = false,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

  // Video recording (Phase C) — only used when saveVideo === true
  const compositeCanvasRef = useRef(null);
  const overlayRecorderRef = useRef(null);
  const overlayChunksRef = useRef([]);
  const rawRecorderRef = useRef(null);
  const rawChunksRef = useRef([]);
  const recordedBlobsRef = useRef({ raw: null, overlay: null });

  // Per-frame landmark buffer (only filled while running, only the locked target)
  const framesRef = useRef([]);
  const thumbsRef = useRef([]);
  const lastThumbAtRef = useRef(0);
  const startedAtRef = useRef(null);
  const runningRef = useRef(false);

  // Latest detected poses + target tracking
  const lastPosesRef = useRef([]); // current frame's poses
  const targetAnchorRef = useRef(null); // {x, y} hip center of locked target
  const lastSeenAtRef = useRef(null); // timestamp last frame target was matched
  const [hasTarget, setHasTarget] = useState(false);
  const [trackingLost, setTrackingLost] = useState(false);
  const [personCount, setPersonCount] = useState(0);
  const [frameQuality, setFrameQuality] = useState({ level: "good", issues: [] });
  const lastQualityUpdateRef = useRef(0);

  // Basketball: ball trajectory + hoop ROI for make/miss detection
  const ballDetectorRef = useRef(null);
  const ballFramesRef = useRef([]); // {t, x, y, conf}[] during recording (only when target is locked + running)
  const lastBallRef = useRef(null); // most recent detected target ball {x, y, conf} (live preview)
  const lastBallsRef = useRef([]); // all detected balls in current frame (for multi-ball picker)
  // Per-frame history of ALL detected balls. Used to classify stationary
  // "court decoys" (balls sitting on the floor) so they cannot steal the
  // lock from the in-play shot ball, especially during the release phase
  // when the moving ball is briefly occluded by hand/body.
  const ballAllHistoryRef = useRef([]);
  const ballAnchorRef = useRef(null); // {x, y} when user has explicitly locked a specific ball; null = auto-pick highest-conf
  // Velocity-aware prediction state for the locked ball. Critical for keeping
  // tracking glued to a fast-moving basketball during a shot — frame-to-frame
  // the ball can travel >25% of the canvas, blowing past a naive nearest-anchor
  // gate. We predict the next position from velocity and score detections by
  // (distance-from-predicted) + (size similarity to locked ball) + confidence.
  const ballPredictRef = useRef(null); // {x, y, vx, vy, t}  velocity in normalized-units/sec
  const ballLockedSizeRef = useRef(null); // size at time of lock — preferred during tracking
  // Trust score for visual feedback: 'solid' (high-confidence detection)
  // | 'dashed' (predicted from velocity, no fresh detection) | 'lost'.
  const trackQualityRef = useRef("lost");
  const ballTrailRef = useRef([]); // last ~30 ball positions for live trail render
  const ballDetectFrameSkipRef = useRef(0);
  const lastBallSeenAtRef = useRef(0);
  // Ball preference memory: stores median area (sqrt-area as fraction of frame
  // diagonal) of the user's preferred ball from the last completed session for
  // this athlete. Used to auto-prefer similarly-sized balls during selection.
  const ballAreaSamplesRef = useRef([]); // sqrt(width*height)/diag samples while target is locked
  const preferredBallSizeRef = useRef(null); // {size, conf, savedAt} loaded from localStorage
  const hoopRoiRef = useRef(null); // mirror of hoopRoi state for rAF reads
  const [ballDetectorState, setBallDetectorState] = useState("idle"); // 'idle' | 'loading' | 'ready' | 'failed'
  const [ballSeen, setBallSeen] = useState(false);
  const [hasLockedBall, setHasLockedBall] = useState(false);
  const [ballCount, setBallCount] = useState(0);
  const [hasBallPref, setHasBallPref] = useState(false);
  const [hoopRoi, setHoopRoi] = useState(null); // {x, y, w, h} normalized
  const [placementStep, setPlacementStep] = useState("athlete"); // 'athlete' | 'hoop' | 'ready'
  const [liveMakes, setLiveMakes] = useState(0);
  const [liveAttempts, setLiveAttempts] = useState(0);
  const liveShotStateRef = useRef({
    inAttempt: false,
    apex: null,
    crossedTop: false,
    crossedBottom: false,
    lastShotEndT: -Infinity,
  });

  // Keep hoopRoiRef in sync with state
  useEffect(() => {
    hoopRoiRef.current = hoopRoi;
  }, [hoopRoi]);

  // Ball preference memory: keyed per athlete (and "default" fallback).
  const ballPrefKey = `vk_ballpref_${athleteId || "default"}`;
  function loadBallPref() {
    try {
      const raw = localStorage.getItem(ballPrefKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Stale entries (>180 days) get ignored
      if (parsed?.savedAt) {
        const ageMs = Date.now() - new Date(parsed.savedAt).getTime();
        if (ageMs > 180 * 24 * 60 * 60 * 1000) return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }
  function saveBallPref(size) {
    if (!size || size <= 0) return;
    try {
      localStorage.setItem(
        ballPrefKey,
        JSON.stringify({ size, conf: 1, savedAt: new Date().toISOString() })
      );
    } catch {
      /* private mode etc. */
    }
  }
  // Load preference once when the athlete or sport changes
  useEffect(() => {
    if (sport !== "basketball") {
      preferredBallSizeRef.current = null;
      setHasBallPref(false);
      return;
    }
    const pref = loadBallPref();
    preferredBallSizeRef.current = pref;
    setHasBallPref(!!pref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, sport]);

  function forgetBallPref() {
    try {
      localStorage.removeItem(ballPrefKey);
    } catch {
      /* ignore */
    }
    preferredBallSizeRef.current = null;
    setHasBallPref(false);
  }

  const clearBallLock = () => {
    if (running) return;
    ballAnchorRef.current = null;
    ballLockedSizeRef.current = null;
    ballPredictRef.current = null;
    ballAllHistoryRef.current = [];
    setHasLockedBall(false);
  };

  // Live shot state machine: mirrors shotDetection.js logic for real-time UX
  function evaluateLiveShot(t, ball) {
    const hoop = hoopRoiRef.current;
    if (!hoop) return;
    const state = liveShotStateRef.current;
    const COOLDOWN_S = 1.0;
    if (t - state.lastShotEndT < COOLDOWN_S) return;
    const hoopTop = hoop.y;
    const hoopBottom = hoop.y + hoop.h;
    const hoopLeft = hoop.x;
    const hoopRight = hoop.x + hoop.w;
    // Track apex (highest = lowest y) when ball is well above hoop
    const aboveHoop = ball.y < hoopTop - hoop.h * 0.5;
    if (aboveHoop && (!state.apex || ball.y < state.apex.y)) {
      state.apex = ball;
      state.inAttempt = true;
      state.crossedTop = false;
      state.crossedBottom = false;
    }
    if (!state.inAttempt || !state.apex) return;
    // Watch for crossings during descent
    const inHoopX = ball.x >= hoopLeft && ball.x <= hoopRight;
    if (inHoopX) {
      if (!state.crossedTop && state.lastBall && state.lastBall.y <= hoopTop && ball.y > hoopTop) {
        state.crossedTop = true;
      }
      if (state.crossedTop && !state.crossedBottom && state.lastBall && state.lastBall.y <= hoopBottom && ball.y > hoopBottom) {
        state.crossedBottom = true;
        // MAKE detected
        setLiveMakes((m) => m + 1);
        setLiveAttempts((a) => a + 1);
        state.lastShotEndT = t;
        state.inAttempt = false;
        state.apex = null;
      }
    }
    // Outcome window: if ball has fallen well below hoop without a make, count as miss
    if (state.inAttempt && ball.y > hoopBottom + hoop.h * 2) {
      if (!state.crossedBottom) {
        setLiveAttempts((a) => a + 1);
      }
      state.lastShotEndT = t;
      state.inAttempt = false;
      state.apex = null;
      state.crossedTop = false;
      state.crossedBottom = false;
    }
    state.lastBall = ball;
  }

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [duration, setDuration] = useState(0);
  const [cameras, setCameras] = useState([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [switching, setSwitching] = useState(false);
  const [videoPaused, setVideoPaused] = useState(true);

  // Zoom + pan (for selection precision and small-athlete detection)
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 }); // normalized (0..1) top-left of view rect
  const panningRef = useRef(null); // { startX, startY, panX, panY } during drag
  const cropCanvasRef = useRef(null);

  const currentCam = cameras[cameraIndex];
  const isFrontCam =
    !currentCam || /front|user|face|selfie/i.test(currentCam.label || "");

  // Clamp pan so view rect stays inside [0,1]
  function clampPan(p, z) {
    const max = Math.max(0, 1 - 1 / z);
    return {
      x: Math.min(Math.max(p.x, 0), max),
      y: Math.min(Math.max(p.y, 0), max),
    };
  }

  function changeZoom(nextZoom, focusNorm = { x: 0.5, y: 0.5 }) {
    const z = Math.max(1, Math.min(4, nextZoom));
    if (z === 1) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
      return;
    }
    // Keep focus point stable in screen — adjust pan so focusNorm in image stays at same screen pos
    const screenX = (focusNorm.x - pan.x) * zoom; // 0..1 of current visible
    const screenY = (focusNorm.y - pan.y) * zoom;
    const newPan = clampPan(
      { x: focusNorm.x - screenX / z, y: focusNorm.y - screenY / z },
      z
    );
    setZoom(z);
    setPan(newPan);
  }

  /* ---------------- Drawing + per-frame logic ---------------- */
  const drawResults = useCallback(
    (result) => {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      if (!canvas || !video) return;
      const w = video.videoWidth || canvas.width;
      const h = video.videoHeight || canvas.height;
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, w, h);

      const poses = result?.landmarks || [];
      lastPosesRef.current = poses;
      setPersonCount(poses.length);

      // Frame quality (throttled to 500ms) — gives users live feedback on
      // whether their camera setup is producing analyzable footage.
      const nowQ = performance.now();
      if (nowQ - lastQualityUpdateRef.current > 500) {
        lastQualityUpdateRef.current = nowQ;
        setFrameQuality(assessFrameQuality(poses, { sport }));
      }

      // Identify which detected pose is "the target" via nearest-neighbour tracking
      let targetIdx = -1;
      if (poses.length > 0) {
        if (targetAnchorRef.current) {
          let bestDist = Infinity;
          poses.forEach((lm, i) => {
            const c = hipCenter(lm);
            const d = dist2D(c, targetAnchorRef.current);
            if (d < bestDist) {
              bestDist = d;
              targetIdx = i;
            }
          });
          // Use a more permissive threshold while recording — fast-moving
          // athletes can travel a long way between detection ticks. As long as
          // we have a pose, we update the anchor so it follows the motion.
          // Single-pose case (poses.length === 1) is the dominant scenario for
          // most users and we should always adopt it.
          const adoptThreshold = runningRef.current
            ? TRACKING_DISTANCE_THRESHOLD * 3 // relaxed during recording
            : TRACKING_DISTANCE_THRESHOLD;
          if (bestDist > adoptThreshold && poses.length > 1) {
            targetIdx = -1;
          } else {
            targetAnchorRef.current = hipCenter(poses[targetIdx]);
            lastSeenAtRef.current = Date.now();
          }
        }
      }

      // Draw all poses; highlight the target
      poses.forEach((lm, i) => {
        const isTarget = i === targetIdx;
        const colour = isTarget
          ? TARGET_COLOR
          : PERSON_COLORS[i % PERSON_COLORS.length];
        ctx.lineWidth = isTarget ? 5 : 2;
        ctx.strokeStyle = colour;
        ctx.shadowColor = colour;
        ctx.shadowBlur = isTarget ? 10 : 0;
        ctx.globalAlpha = isTarget ? 1 : 0.55;
        POSE_CONNECTIONS.forEach(([a, b]) => {
          const pa = lm[a];
          const pb = lm[b];
          if (!pa || !pb) return;
          ctx.beginPath();
          ctx.moveTo(pa.x * w, pa.y * h);
          ctx.lineTo(pb.x * w, pb.y * h);
          ctx.stroke();
        });
        ctx.shadowBlur = 0;
        // joints
        ctx.fillStyle = isTarget ? JOINT_COLOR_TARGET : colour;
        lm.forEach((p, j) => {
          if (j < 11) return;
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, isTarget ? 5 : 3, 0, Math.PI * 2);
          ctx.fill();
        });
        // person number badge (above head)
        const head = lm[0];
        if (head && !isTarget) {
          const px = head.x * w;
          const py = head.y * h - 24;
          ctx.globalAlpha = 1;
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.arc(px, py, 14, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "#000";
          ctx.font = "bold 16px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(String(i + 1), px, py);
        }
        ctx.globalAlpha = 1;
      });

      // Draw hoop ROI (cyan rectangle) — only basketball, when placed
      const hoop = hoopRoiRef.current;
      if (hoop) {
        ctx.save();
        ctx.strokeStyle = "#00e5ff";
        ctx.lineWidth = 3;
        ctx.shadowColor = "#00e5ff";
        ctx.shadowBlur = 12;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(hoop.x * w, hoop.y * h, hoop.w * w, hoop.h * h);
        ctx.setLineDash([]);
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#00e5ff";
        ctx.font = "bold 11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText("HOOP", hoop.x * w + 4, hoop.y * h + 4);
        ctx.restore();
      }

      // Draw all detected balls. When multiple, dim non-target ones and
      // number them so the user can tap to pick a specific ball.
      const allBalls = lastBallsRef.current || [];
      const target = lastBallRef.current;
      if (allBalls.length > 0) {
        for (let i = 0; i < allBalls.length; i++) {
          const b = allBalls[i];
          const isTarget = target && Math.abs(b.x - target.x) < 0.001 && Math.abs(b.y - target.y) < 0.001;
          if (isTarget) continue; // target is drawn separately below with trust styling
          ctx.save();
          ctx.fillStyle = "#ffb968";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.arc(b.x * w, b.y * h, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          // Number badge when multiple balls
          if (allBalls.length > 1) {
            ctx.save();
            ctx.fillStyle = "#000";
            ctx.font = "bold 11px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(String(i + 1), b.x * w, b.y * h);
            ctx.restore();
          }
        }
      }
      // Trail from the *target* ball only (already pushed by detector tick)
      const trail = ballTrailRef.current;
      if (trail.length > 0) {
        for (let i = 0; i < trail.length; i++) {
          const p = trail[i];
          const alpha = (i + 1) / trail.length;
          ctx.fillStyle = `rgba(255, 165, 0, ${alpha * 0.55})`;
          ctx.beginPath();
          ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // Target ball with TRUST overlay:
      //  solid  → high-confidence detection match (filled + solid ring)
      //  dashed → extrapolated from velocity (hollow + dashed ring)
      //  lost   → not drawn
      const quality = trackQualityRef.current;
      if (target && quality !== "lost") {
        ctx.save();
        const cx = target.x * w;
        const cy = target.y * h;
        if (quality === "dashed") {
          // Predicted from velocity — yellow dashed ring, no fill
          ctx.strokeStyle = "#ffd166";
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.shadowColor = "#ffd166";
          ctx.shadowBlur = 6;
          ctx.beginPath();
          ctx.arc(cx, cy, 11, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
          // small "?" badge to show it's a guess
          ctx.fillStyle = "#ffd166";
          ctx.font = "bold 9px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("?", cx, cy);
        } else {
          // Solid — confident detection
          ctx.fillStyle = "#ff8c00";
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.shadowColor = "#ff8c00";
          ctx.shadowBlur = 10;
          ctx.beginPath();
          ctx.arc(cx, cy, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }

      // Tracking-lost detection
      if (targetAnchorRef.current && targetIdx === -1) {
        if (
          lastSeenAtRef.current &&
          Date.now() - lastSeenAtRef.current > TRACKING_LOST_GRACE_MS
        ) {
          if (!trackingLost) setTrackingLost(true);
          // try to re-lock onto closest pose to last anchor (relax threshold)
          if (poses.length > 0) {
            let bestDist = Infinity;
            let bestIdx = -1;
            poses.forEach((lm, i) => {
              const c = hipCenter(lm);
              const d = dist2D(c, targetAnchorRef.current);
              if (d < bestDist) {
                bestDist = d;
                bestIdx = i;
              }
            });
            if (bestIdx >= 0) {
              targetAnchorRef.current = hipCenter(poses[bestIdx]);
              lastSeenAtRef.current = Date.now();
              setTrackingLost(false);
            }
          }
        }
      } else if (trackingLost && targetIdx !== -1) {
        setTrackingLost(false);
      }

      // Recording: only record the target's landmarks
      if (
        runningRef.current &&
        startedAtRef.current != null &&
        targetIdx !== -1
      ) {
        const t = (Date.now() - startedAtRef.current) / 1000;
        const lm = poses[targetIdx];
        framesRef.current.push({
          t,
          lm: lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })),
        });
        if (mode === "live" && Date.now() - lastThumbAtRef.current > 200) {
          lastThumbAtRef.current = Date.now();
          try {
            const tw = 480;
            const th = Math.round((h / w) * tw);
            const off = document.createElement("canvas");
            off.width = tw;
            off.height = th;
            const octx = off.getContext("2d");
            if (isFrontCam) {
              octx.translate(tw, 0);
              octx.scale(-1, 1);
            }
            octx.drawImage(video, 0, 0, tw, th);
            octx.setTransform(1, 0, 0, 1, 0, 0);
            octx.drawImage(canvas, 0, 0, tw, th);
            thumbsRef.current.push({
              t,
              dataUrl: off.toDataURL("image/jpeg", 0.55),
            });
            if (thumbsRef.current.length > 1500) thumbsRef.current.shift();
          } catch {
            /* video not ready */
          }
        }
      } else if (
        runningRef.current &&
        startedAtRef.current != null &&
        targetIdx === -1
      ) {
        // record an empty frame so timeline remains continuous
        const t = (Date.now() - startedAtRef.current) / 1000;
        framesRef.current.push({ t, lm: null });
      }
    },
    [mode, isFrontCam, trackingLost]
  );

  /* ---------------- Reset target tracking when video source changes ---------------- */
  useEffect(() => {
    targetAnchorRef.current = null;
    lastSeenAtRef.current = null;
    lastPosesRef.current = [];
    ballFramesRef.current = [];
    ballTrailRef.current = [];
    lastBallRef.current = null;
    lastBallsRef.current = [];
    ballAnchorRef.current = null;
    ballLockedSizeRef.current = null;
    ballPredictRef.current = null;
    trackQualityRef.current = "lost";
    ballAreaSamplesRef.current = [];
    liveShotStateRef.current = {
      inAttempt: false,
      apex: null,
      crossedTop: false,
      crossedBottom: false,
      lastShotEndT: -Infinity,
    };
    setHasTarget(false);
    setTrackingLost(false);
    setPersonCount(0);
    setHoopRoi(null);
    setPlacementStep("athlete");
    setLiveMakes(0);
    setLiveAttempts(0);
    setHasLockedBall(false);
    setBallCount(0);
    setBallSeen(false);
  }, [videoSrc, mode, sport]);

  /* ---------------- Pose model + camera setup ---------------- */
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        setStatus("loading");
        const landmarker = await loadPoseLandmarker();
        if (cancelled) return;
        landmarkerRef.current = landmarker;
        // Load ball detector lazily for basketball only — fail soft if it errors
        if (sport === "basketball") {
          setBallDetectorState("loading");
          try {
            const det = await loadBallDetector();
            if (!cancelled) {
              ballDetectorRef.current = det;
              setBallDetectorState("ready");
            }
          } catch (e) {
            console.warn("[PoseCanvas] ball detector failed to load — make/miss tracking disabled", e);
            if (!cancelled) setBallDetectorState("failed");
          }
        }

        const video = videoRef.current;
        if (mode === "live") {
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }
          const targetDeviceId = cameras[cameraIndex]?.deviceId;
          const constraints = targetDeviceId
            ? {
                video: {
                  deviceId: { exact: targetDeviceId },
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                },
                audio: false,
              }
            : {
                video: {
                  facingMode: "user",
                  width: { ideal: 1280 },
                  height: { ideal: 720 },
                },
                audio: false,
              };
          const stream =
            await navigator.mediaDevices.getUserMedia(constraints);
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          video.srcObject = stream;
          await video.play();

          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cams = devices
              .filter((d) => d.kind === "videoinput")
              .map((d) => ({ deviceId: d.deviceId, label: d.label }));
            setCameras((prev) => {
              if (
                prev.length === cams.length &&
                prev.every((c, i) => c.deviceId === cams[i].deviceId)
              ) {
                return prev;
              }
              return cams;
            });
            const activeId = stream
              .getVideoTracks()[0]
              ?.getSettings()
              ?.deviceId;
            if (activeId) {
              const idx = cams.findIndex((c) => c.deviceId === activeId);
              if (idx >= 0)
                setCameraIndex((cur) => (cur === idx ? cur : idx));
            }
          } catch {
            /* enumerate not supported */
          }
        } else if (mode === "upload" && videoSrc) {
          video.src = videoSrc;
          video.loop = false;
          video.muted = true;
          video.playsInline = true;
          await new Promise((resolve) => {
            if (video.readyState >= 1) resolve();
            else
              video.addEventListener("loadedmetadata", () => resolve(), {
                once: true,
              });
          });
          // iOS Safari quirk: <video> doesn't render any pixels (and detection
          // returns 0 poses) until play() is called at least once. Briefly
          // play→pause to warm up the decoder + skip any black opening frame.
          try {
            await video.play();
            // Seek to the trim start (or just past 0) so we're not stuck on a
            // potentially-blank first frame.
            const seekTo = trimStart && trimStart > 0
              ? trimStart
              : Math.min(0.5, (video.duration || 1) * 0.05);
            video.currentTime = seekTo;
            await new Promise((r) => {
              const onSeeked = () => {
                video.removeEventListener("seeked", onSeeked);
                r();
              };
              video.addEventListener("seeked", onSeeked);
              setTimeout(r, 600);
            });
            video.pause();
          } catch {
            /* autoplay blocked — user will tap the play overlay */
          }
          setVideoPaused(video.paused);
        }

        setStatus("ready");
        if (onReady) onReady();

        const tick = () => {
          if (cancelled) return;
          const v = videoRef.current;
          const lm = landmarkerRef.current;
          const ready =
            v && lm && v.readyState >= 2 && v.videoWidth > 0;
          const shouldDetect =
            ready &&
            (mode === "live" ? !v.paused && !v.ended : true);
          if (shouldDetect) {
            try {
              let result;
              if (zoom > 1.001) {
                // Crop the visible zoom window into an offscreen canvas
                if (!cropCanvasRef.current) cropCanvasRef.current = document.createElement("canvas");
                const tw = 640;
                const th = Math.round((v.videoHeight / v.videoWidth) * tw) || 360;
                const cc = cropCanvasRef.current;
                cc.width = tw;
                cc.height = th;
                const cctx = cc.getContext("2d");
                const sx = pan.x * v.videoWidth;
                const sy = pan.y * v.videoHeight;
                const sw = v.videoWidth / zoom;
                const sh = v.videoHeight / zoom;
                cctx.drawImage(v, sx, sy, sw, sh, 0, 0, tw, th);
                result = lm.detectForVideo(cc, performance.now());
                if (result && result.landmarks) {
                  result = {
                    ...result,
                    landmarks: result.landmarks.map((pose) =>
                      pose.map((p) => ({
                        ...p,
                        x: pan.x + p.x / zoom,
                        y: pan.y + p.y / zoom,
                      }))
                    ),
                  };
                }
              } else if (mode === "upload" && targetAnchorRef.current && runningRef.current) {
                // Recording phase: plain full-frame detection at native resolution.
                // Smart-ROI / tile-detection caused frozen-skeleton bugs because
                // a stale or off-center ROI would persistently miss the athlete.
                // Full-frame is reliable and fast enough for single-athlete
                // tracking during playback; nearest-neighbour pose matching in
                // drawResults() keeps the locked target identified.
                result = lm.detectForVideo(v, performance.now());
              } else {
                // Selection (live or upload, no zoom): single full-frame detection.
                // Tile detection (used to surface tiny far athletes in 2-athlete
                // gym shots) was triggering MediaPipe sub-ms timestamp rejections
                // and silently failing — single full-frame is reliable for the
                // typical 1-athlete case. Multi-athlete deep-scan can be re-added
                // as an optional toggle later.
                result = lm.detectForVideo(v, performance.now());
              }
              drawResults(result);

              // Phase C: composite (video + skeleton) onto a hidden canvas
              // so MediaRecorder can stream an "overlay-burned" video.
              if (saveVideo && runningRef.current && compositeCanvasRef.current) {
                const cc = compositeCanvasRef.current;
                const vw = v.videoWidth || cc.width;
                const vh = v.videoHeight || cc.height;
                if (cc.width !== vw) cc.width = vw;
                if (cc.height !== vh) cc.height = vh;
                const cctx = cc.getContext("2d");
                cctx.drawImage(v, 0, 0, vw, vh);
                if (canvasRef.current)
                  cctx.drawImage(canvasRef.current, 0, 0, vw, vh);
              }

              // Basketball: run object detection every frame for responsive
              // ball tracking (shots happen fast — every-other-frame missed
              // mid-flight balls). EfficientDet-Lite0 on GPU is ~5ms.
              const ballDet = ballDetectorRef.current;
              if (sport === "basketball" && ballDet) {
                {
                  try {
                    const detRes = ballDet.detectForVideo(v, performance.now());
                    const dets = detRes?.detections || [];
                    // Collect ALL detected sports balls so the user can pick
                    // which one to track when multiple are visible.
                    const allBalls = [];
                    const diag = Math.hypot(v.videoWidth, v.videoHeight) || 1;
                    for (const d of dets) {
                      const cat = d.categories?.[0];
                      if (cat?.categoryName !== "sports ball") continue;
                      const bb = d.boundingBox;
                      if (!bb) continue;
                      const sizeNorm = Math.sqrt(bb.width * bb.height) / diag;
                      allBalls.push({
                        x: (bb.originX + bb.width / 2) / v.videoWidth,
                        y: (bb.originY + bb.height / 2) / v.videoHeight,
                        size: sizeNorm,
                        conf: cat.score || 0,
                      });
                    }
                    lastBallsRef.current = allBalls;
                    setBallCount(allBalls.length);

                    // Classify each current ball as "stationary" if a similar
                    // position has been detected in most of the recent frames.
                    // A stationary detection on the court is a decoy that
                    // should never be allowed to steal the lock from the
                    // in-play shot ball.
                    const HIST_WINDOW = 18; // ~600ms at 30fps
                    const HIST_THRESHOLD = 12; // present in ≥2/3 of recent frames
                    const STATIONARY_EPS = 0.025; // 2.5% of normalized space
                    ballAllHistoryRef.current.push(allBalls);
                    if (ballAllHistoryRef.current.length > HIST_WINDOW) {
                      ballAllHistoryRef.current.shift();
                    }
                    const history = ballAllHistoryRef.current;
                    for (const b of allBalls) {
                      let presentInFrames = 0;
                      for (const past of history) {
                        for (const pb of past) {
                          if (
                            Math.hypot(pb.x - b.x, pb.y - b.y) < STATIONARY_EPS
                          ) {
                            presentInFrames++;
                            break;
                          }
                        }
                      }
                      b.stationary = presentInFrames >= HIST_THRESHOLD;
                    }
                    // Pick the *target* ball using one of three strategies:
                    //   1) User locked → predict next position from velocity,
                    //      score detections by distance + size similarity + conf.
                    //   2) No lock but ball-size preference exists → prefer
                    //      similarly-sized ball.
                    //   3) Otherwise → highest-confidence detection.
                    let ball = null;
                    const nowS = performance.now() / 1000;
                    if (allBalls.length > 0) {
                      if (ballAnchorRef.current) {
                        // (1) Velocity-aware tracking — robust to fast motion.
                        const pred = ballPredictRef.current;
                        let predX = ballAnchorRef.current.x;
                        let predY = ballAnchorRef.current.y;
                        if (pred) {
                          const dt = Math.min(0.2, Math.max(0, nowS - pred.t));
                          predX = pred.x + pred.vx * dt;
                          predY = pred.y + pred.vy * dt;
                        }
                        const targetSize = ballLockedSizeRef.current;
                        // Filter candidate pool: a stationary ball that is
                        // NOT at the locked anchor is a court decoy. Reject
                        // it outright so it can never win the lock — this
                        // is the fix for the "lock jumps to a stationary
                        // ball at shot release" bug. The locked ball itself
                        // (if still stationary, e.g., pre-release held ball)
                        // will be at d≈0 from the anchor and pass.
                        const anchor = ballAnchorRef.current;
                        const candidates = allBalls.filter((b) => {
                          if (!b.stationary) return true;
                          const dFromAnchor = Math.hypot(
                            b.x - anchor.x,
                            b.y - anchor.y,
                          );
                          return dFromAnchor < 0.05; // 5% of frame — same ball
                        });
                        let bestScore = -Infinity;
                        for (const b of candidates) {
                          const d = Math.hypot(b.x - predX, b.y - predY);
                          // Size similarity (0 = exact match, 1+ = very different)
                          const sizeDelta = targetSize
                            ? Math.abs(b.size - targetSize) / Math.max(targetSize, 1e-4)
                            : 0;
                          // Composite score — confidence is the base, distance
                          // is the strongest negative term, size similarity is
                          // a tiebreaker. Scaled so a 0.05-distance miss costs
                          // ~0.5 score (i.e. very high-conf detection 0.05 away
                          // still beats a low-conf detection on top of anchor).
                          const score = b.conf - d * 5 - sizeDelta * 0.4;
                          if (score > bestScore) {
                            bestScore = score;
                            ball = b;
                          }
                        }
                        // Generous gate during tracking: 0.45 normalized distance
                        // from the predicted position is enough — we'll trust it.
                        const finalDist = ball
                          ? Math.hypot(ball.x - predX, ball.y - predY)
                          : Infinity;
                        if (finalDist > 0.45) ball = null; // truly lost
                        if (ball) {
                          // Update anchor + velocity (smoothed via EMA so a single
                          // outlier doesn't whipsaw the prediction).
                          if (pred) {
                            const dtPred = Math.max(0.001, nowS - pred.t);
                            const rawVx = (ball.x - pred.x) / dtPred;
                            const rawVy = (ball.y - pred.y) / dtPred;
                            const alpha = 0.55;
                            ballPredictRef.current = {
                              x: ball.x,
                              y: ball.y,
                              vx: alpha * rawVx + (1 - alpha) * pred.vx,
                              vy: alpha * rawVy + (1 - alpha) * pred.vy,
                              t: nowS,
                            };
                          } else {
                            ballPredictRef.current = {
                              x: ball.x, y: ball.y, vx: 0, vy: 0, t: nowS,
                            };
                          }
                          ballAnchorRef.current = { x: ball.x, y: ball.y };
                        }
                      } else if (preferredBallSizeRef.current?.size && allBalls.length > 1) {
                        const targetSize = preferredBallSizeRef.current.size;
                        let bestScore = -Infinity;
                        for (const b of allBalls) {
                          const sizeDelta = Math.abs(b.size - targetSize) / Math.max(targetSize, 1e-4);
                          const score = b.conf - sizeDelta * 0.6;
                          if (score > bestScore) {
                            bestScore = score;
                            ball = b;
                          }
                        }
                      } else {
                        ball = allBalls.reduce((a, b) => (b.conf > (a?.conf || 0) ? b : a), null);
                      }
                    }
                    // Trust score + short-term velocity extrapolation:
                    // when ball is locked but no detection matched this frame,
                    // synthesize a "predicted" position from velocity so the
                    // circle keeps moving with the shot for ~250ms. After that
                    // we declare it truly lost.
                    if (ballAnchorRef.current) {
                      if (ball) {
                        trackQualityRef.current = "solid";
                      } else {
                        const pred = ballPredictRef.current;
                        const dt = pred ? nowS - pred.t : Infinity;
                        if (pred && dt < 0.25) {
                          ball = {
                            x: pred.x + pred.vx * dt,
                            y: pred.y + pred.vy * dt,
                            size: ballLockedSizeRef.current,
                            conf: 0.0,
                            extrapolated: true,
                          };
                          trackQualityRef.current = "dashed";
                        } else {
                          trackQualityRef.current = "lost";
                        }
                      }
                    } else {
                      trackQualityRef.current = ball ? "solid" : "lost";
                    }
                    lastBallRef.current = ball;
                    // While target is locked AND we're not yet recording, sample
                    // its size so we can persist a fresh preference on stop.
                    if (ball && ballAnchorRef.current && ball.size) {
                      ballAreaSamplesRef.current.push(ball.size);
                      if (ballAreaSamplesRef.current.length > 240) {
                        ballAreaSamplesRef.current.shift();
                      }
                    }
                    // Maintain trail (last 30 positions for live render)
                    if (ball) {
                      ballTrailRef.current.push({ ...ball, t: performance.now() / 1000 });
                      if (ballTrailRef.current.length > 30) ballTrailRef.current.shift();
                      lastBallSeenAtRef.current = performance.now();
                      if (!ballSeen) setBallSeen(true);
                    } else if (
                      ballSeen &&
                      performance.now() - lastBallSeenAtRef.current > 1500
                    ) {
                      // Hide the "ball detected" indicator after 1.5s without a hit
                      setBallSeen(false);
                    }
                    // Record ball during capture (skip extrapolated positions —
                    // shot detection should only consume real detections).
                    if (runningRef.current && startedAtRef.current != null) {
                      const t = (Date.now() - startedAtRef.current) / 1000;
                      const recordBall = ball && !ball.extrapolated ? ball : null;
                      ballFramesRef.current.push(recordBall ? { t, ...recordBall } : { t, x: null, y: null, conf: 0 });
                      // Live make/miss detection while recording (real ball only)
                      if (recordBall && hoopRoiRef.current) {
                        evaluateLiveShot(t, recordBall);
                      }
                    }
                  } catch (be) {
                    console.warn("[PoseCanvas] ball detect error", be);
                  }
                }
              }
            } catch (err) {
              // Log loudly so iOS Safari / WebGL issues surface in remote
              // console viewers and aren't swallowed. Also tag the message so
              // we can see it during debugging.
              console.warn("[PoseCanvas] detect error", err);
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch (e) {
        console.error(e);
        setError(e?.message || "Failed to start camera");
        setStatus("error");
      }
    }
    init();
    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      // Don't close the landmarker — we cache it across mounts via the loader promise
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, videoSrc, cameraIndex]);

  /* ---------------- Recording duration tick ---------------- */
  useEffect(() => {
    if (!running) return;
    startedAtRef.current = Date.now();
    const interval = setInterval(() => {
      setDuration(
        Math.floor((Date.now() - startedAtRef.current) / 1000)
      );
    }, 500);
    return () => clearInterval(interval);
  }, [running]);

  /* ---------------- Video play/pause state sync (upload mode) ---------------- */
  useEffect(() => {
    if (mode !== "upload") return;
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setVideoPaused(false);
    const onPause = () => setVideoPaused(true);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    setVideoPaused(v.paused);
    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [mode, videoSrc]);

  const togglePlayPause = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (v.paused) await v.play();
      else v.pause();
    } catch {
      /* play promise rejected (autoplay policy) — user can tap again */
    }
  };

  /* ---------------- Pan / zoom handlers ---------------- */
  const onWheel = (e) => {
    if (running) return;
    e.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const wx = (e.clientX - rect.left) / rect.width;
    const wy = (e.clientY - rect.top) / rect.height;
    // Convert wheel cursor to full-frame coords (not mirror-aware — fine for zoom focus)
    const focus = { x: pan.x + wx / zoom, y: pan.y + wy / zoom };
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    changeZoom(zoom * factor, focus);
  };
  const onPointerDown = (e) => {
    if (running || zoom <= 1.001) return;
    if (e.target.closest("button")) return; // don't start pan on button clicks
    panningRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false,
    };
  };
  const onPointerMove = (e) => {
    const p = panningRef.current;
    if (!p) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = (e.clientX - p.startX) / rect.width / zoom;
    const dy = (e.clientY - p.startY) / rect.height / zoom;
    if (Math.abs(dx) + Math.abs(dy) > 0.005) p.moved = true;
    setPan(clampPan({ x: p.panX - dx, y: p.panY - dy }, zoom));
  };
  const onPointerUp = () => {
    panningRef.current = null;
  };

  /* ---------------- Subject / hoop selection click handler ---------------- */
  const handleCanvasClick = (e) => {
    if (running) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    // Click position within the visible canvas (screen, post-transform)
    const wx = (e.clientX - rect.left) / rect.width; // 0..1 visible
    const wy = (e.clientY - rect.top) / rect.height;
    // Convert to full-frame normalized coords (account for zoom/pan)
    let nx = pan.x + wx / zoom;
    let ny = pan.y + wy / zoom;
    // Mirror compensation (front camera flip is applied via CSS scaleX(-1))
    if (mode === "live" && isFrontCam) {
      nx = pan.x + (1 - wx) / zoom;
    }
    const click = { x: nx, y: ny };

    // Step 2 (basketball only): place hoop ROI centered on click
    if (placementStep === "hoop") {
      const w = 0.12;
      const h = 0.08;
      setHoopRoi({
        x: Math.max(0, Math.min(1 - w, click.x - w / 2)),
        y: Math.max(0, Math.min(1 - h, click.y - h / 2)),
        w,
        h,
      });
      setPlacementStep("ready");
      return;
    }

    // Basketball — when hoop is placed and multiple balls are visible,
    // the user can tap a ball to lock tracking onto it. Check ball-tap
    // BEFORE athlete-tap because balls are smaller/higher targets.
    if (sport === "basketball" && placementStep === "ready") {
      const balls = lastBallsRef.current || [];
      if (balls.length >= 1) {
        let bestB = null;
        let bestBd = Infinity;
        for (const b of balls) {
          const d = dist2D(b, click);
          if (d < bestBd) {
            bestBd = d;
            bestB = b;
          }
        }
        // Generous radius for ball tap (balls are small on screen — phone
        // taps land somewhere near the ball, not exactly on it).
        if (bestB && bestBd < 0.2 / zoom) {
          ballAnchorRef.current = { x: bestB.x, y: bestB.y };
          ballLockedSizeRef.current = bestB.size || null;
          ballPredictRef.current = {
            x: bestB.x,
            y: bestB.y,
            vx: 0,
            vy: 0,
            t: performance.now() / 1000,
          };
          setHasLockedBall(true);
          return;
        }
      }
    }

    // Step 1: pick athlete by tap-nearest pose
    const poses = lastPosesRef.current;
    if (!poses.length) return;
    let bestIdx = -1;
    let bestDist = Infinity;
    poses.forEach((lm, i) => {
      const pts = [11, 12, 23, 24].map((k) => lm[k]).filter(Boolean);
      if (!pts.length) return;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      const d = dist2D({ x: cx, y: cy }, click);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    });
    // Click radius scales inversely with zoom but is generous on mobile —
    // the original 0.25 was too tight on small screens. 0.4 = nearly half
    // the canvas width, but bestDist comparison still picks the closest pose.
    if (bestIdx >= 0 && bestDist < 0.4 / zoom) {
      const c = hipCenter(poses[bestIdx]);
      if (c) {
        targetAnchorRef.current = c;
        lastSeenAtRef.current = Date.now();
        setHasTarget(true);
        setTrackingLost(false);
        // Basketball: prompt the user to place the hoop next
        setPlacementStep(sport === "basketball" ? "hoop" : "ready");
      }
    }
  };

  const clearTarget = () => {
    if (running) return;
    targetAnchorRef.current = null;
    lastSeenAtRef.current = null;
    setHasTarget(false);
    setTrackingLost(false);
    setPlacementStep("athlete");
    setHoopRoi(null);
  };

  const clearHoop = () => {
    if (running) return;
    setHoopRoi(null);
    setPlacementStep("hoop");
  };

  // Suppress click after a pan-drag so dragging doesn't accidentally lock onto someone
  const handleCanvasClickGuarded = (e) => {
    const p = panningRef.current;
    if (p && p.moved) return;
    handleCanvasClick(e);
  };

  /* ---------------- Capture controls ---------------- */
  function pickRecorderMime() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4", // iOS Safari
    ];
    for (const m of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) {
        return m;
      }
    }
    return "";
  }

  function startRecorders() {
    if (typeof MediaRecorder === "undefined") return;
    recordedBlobsRef.current = { raw: null, overlay: null };
    const mimeType = pickRecorderMime();

    // Overlay recorder — captures the composite canvas (video + skeleton).
    try {
      if (!compositeCanvasRef.current) {
        compositeCanvasRef.current = document.createElement("canvas");
      }
      const c = compositeCanvasRef.current;
      // Seed with current frame size so captureStream produces a non-empty track
      const v = videoRef.current;
      const w = (v && v.videoWidth) || 640;
      const h = (v && v.videoHeight) || 360;
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const cctx = c.getContext("2d");
      cctx.fillStyle = "#000";
      cctx.fillRect(0, 0, w, h);
      const overlayStream = c.captureStream(30);
      overlayChunksRef.current = [];
      const opts = mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : { videoBitsPerSecond: 2_500_000 };
      const rec = new MediaRecorder(overlayStream, opts);
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) overlayChunksRef.current.push(e.data);
      };
      rec.start(1000); // gather 1s chunks
      overlayRecorderRef.current = rec;
    } catch (e) {
      console.warn("[PoseCanvas] overlay recorder start failed", e);
      overlayRecorderRef.current = null;
    }

    // Raw recorder — webcam MediaStream (live mode only).
    if (mode === "live" && streamRef.current) {
      try {
        rawChunksRef.current = [];
        const opts = mimeType ? { mimeType, videoBitsPerSecond: 2_500_000 } : { videoBitsPerSecond: 2_500_000 };
        const rec = new MediaRecorder(streamRef.current, opts);
        rec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) rawChunksRef.current.push(e.data);
        };
        rec.start(1000);
        rawRecorderRef.current = rec;
      } catch (e) {
        console.warn("[PoseCanvas] raw recorder start failed", e);
        rawRecorderRef.current = null;
      }
    }
  }

  function stopRecorders() {
    return new Promise((resolve) => {
      const tasks = [];
      const finalize = (rec, chunksRef, key, type) => {
        if (!rec) return;
        tasks.push(
          new Promise((r) => {
            rec.onstop = () => {
              const blob = new Blob(chunksRef.current, { type });
              recordedBlobsRef.current[key] = blob.size > 0 ? blob : null;
              r();
            };
            try {
              if (rec.state !== "inactive") rec.stop();
              else r();
            } catch {
              r();
            }
          }),
        );
      };
      const overlayMime = overlayRecorderRef.current?.mimeType || "video/webm";
      const rawMime = rawRecorderRef.current?.mimeType || "video/webm";
      finalize(overlayRecorderRef.current, overlayChunksRef, "overlay", overlayMime);
      finalize(rawRecorderRef.current, rawChunksRef, "raw", rawMime);
      overlayRecorderRef.current = null;
      rawRecorderRef.current = null;
      Promise.all(tasks).then(() => resolve());
    });
  }

  function start() {
    if (!hasTarget) {
      setError("Tap the athlete you want to track first.");
      return;
    }
    setError(null);
    framesRef.current = [];
    thumbsRef.current = [];
    lastThumbAtRef.current = 0;
    ballFramesRef.current = [];
    ballTrailRef.current = [];
    setLiveMakes(0);
    setLiveAttempts(0);
    liveShotStateRef.current = {
      inAttempt: false,
      apex: null,
      crossedTop: false,
      crossedBottom: false,
      lastShotEndT: -Infinity,
    };
    startedAtRef.current = Date.now();
    runningRef.current = true;
    setRunning(true);
    setStatus("running");

    // Phase C: kick off MediaRecorders if user opted in to save the video.
    if (saveVideo) {
      try {
        startRecorders();
      } catch (e) {
        console.warn("[PoseCanvas] failed to start MediaRecorders", e);
      }
    }
    const v = videoRef.current;
    if (v && mode === "upload") {
      // Only seek backward if user is BEFORE the trim window. If they scrubbed
      // forward to find their athlete, respect that position — otherwise we'd
      // jump back to a frame where the athlete isn't visible and tracking would
      // start from a stale anchor.
      try {
        const ts = trimStart || 0;
        if (v.currentTime < ts) v.currentTime = ts;
      } catch {
        /* ignore */
      }
      // Treat the locked anchor as freshly seen so the first detection during
      // recording doesn't immediately enter the "tracking lost" grace period.
      lastSeenAtRef.current = Date.now();
      const playPromise = v.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(() => {
          setError(
            "Browser blocked auto-play. Tap the video, then press Start again."
          );
        });
      }
      // Auto-stop when reaching the trim end
      const end = trimEnd && trimEnd > (trimStart || 0) ? trimEnd : null;
      if (end != null) {
        const onTime = () => {
          if (!videoRef.current) return;
          if (videoRef.current.currentTime >= end) {
            videoRef.current.removeEventListener("timeupdate", onTime);
            videoRef.current.pause();
            setRunning((r) => {
              if (!r) return r;
              setTimeout(() => stop(), 0);
              return r;
            });
          }
        };
        v.addEventListener("timeupdate", onTime);
      }
      v.onended = () => {
        if (videoRef.current && !videoRef.current.paused) videoRef.current.pause();
        setRunning((r) => {
          if (!r) return r;
          setTimeout(() => stop(), 0);
          return r;
        });
      };
    }
  }

  async function captureThumbnailNear(timeS) {
    const thumbs = thumbsRef.current;
    if (thumbs.length) {
      let best = thumbs[0];
      let bestDist = Math.abs(best.t - timeS);
      for (const th of thumbs) {
        const d = Math.abs(th.t - timeS);
        if (d < bestDist) {
          best = th;
          bestDist = d;
        }
      }
      if (bestDist < 0.6) return best.dataUrl;
    }
    const v = videoRef.current;
    const c = canvasRef.current;
    if (mode === "upload" && v && c) {
      try {
        await new Promise((resolve) => {
          const onSeeked = () => {
            v.removeEventListener("seeked", onSeeked);
            resolve();
          };
          v.addEventListener("seeked", onSeeked);
          v.currentTime = Math.min(timeS, v.duration - 0.05);
          setTimeout(resolve, 800);
        });
        // Smaller + lower-quality thumbnail keeps the upload payload tiny
        // (mobile networks 502 on large multipart-ish bodies).
        const tw = 480;
        const th = Math.round((v.videoHeight / v.videoWidth) * tw) || 270;
        const off = document.createElement("canvas");
        off.width = tw;
        off.height = th;
        const octx = off.getContext("2d");
        octx.drawImage(v, 0, 0, tw, th);
        octx.drawImage(c, 0, 0, tw, th);
        return off.toDataURL("image/jpeg", 0.55);
      } catch {
        return null;
      }
    }
    return null;
  }

  async function stop() {
    runningRef.current = false;
    setRunning(false);
    setStatus("ready");
    const v = videoRef.current;
    if (v && mode === "upload" && !v.paused) {
      try {
        v.pause();
      } catch {
        /* ignore */
      }
    }
    // Persist ball-size preference for this athlete: median of all locked-ball
    // size samples collected during the session. Used next time to auto-prefer
    // similarly-sized balls during selection.
    if (sport === "basketball" && ballAreaSamplesRef.current.length >= 8) {
      const sorted = [...ballAreaSamplesRef.current].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      saveBallPref(median);
      preferredBallSizeRef.current = { size: median, conf: 1, savedAt: new Date().toISOString() };
      setHasBallPref(true);
    }
    const frames = framesRef.current;
    const detected = frames.filter((f) => f.lm).length;
    const duration_s =
      frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
    const ballFrames = ballFramesRef.current.filter((b) => b && b.x != null);
    let analysis;
    try {
      analysis = analyzeSession(frames, sport, {
        ballFrames: ballFrames.length ? ballFrames : null,
        hoopRoi: hoopRoiRef.current,
      });
    } catch (e) {
      console.error("rep analysis failed:", e);
      analysis = { sport, rep_count: 0, reps: [], no_reps_detected: true };
    }
    const keyframes = {};
    for (const k of getKeyframeTimestamps(analysis)) {
      const dataUrl = await captureThumbnailNear(k.time_s);
      if (dataUrl)
        keyframes[k.label] = {
          time_s: k.time_s,
          score: k.score,
          image: dataUrl,
        };
    }
    const summary = {
      ...analysis,
      frames_processed: frames.length,
      frames_detected: detected,
      detection_rate: frames.length
        ? +(detected / frames.length).toFixed(2)
        : 0,
      duration_seconds: +duration_s.toFixed(2),
      keyframes,
    };

    // Phase C: drain MediaRecorders (if any) and pass blobs to the caller.
    let videoBlobs = null;
    if (saveVideo) {
      try {
        await stopRecorders();
        videoBlobs = recordedBlobsRef.current;
      } catch (e) {
        console.warn("[PoseCanvas] stopRecorders failed", e);
      }
    }
    onStop?.(summary, { videoBlobs });
  }

  /* ---------------- Render ---------------- */
  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        data-testid="pose-canvas-container"
        className="relative bg-black border border-white/10 overflow-hidden aspect-video select-none"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        style={{ cursor: zoom > 1 ? (panningRef.current ? "grabbing" : "grab") : "auto" }}
      >
        {/* Zoom + pan layer (also contains the mirror flip for the front camera) */}
        <div
          className="absolute inset-0"
          style={{
            transform: `scale(${zoom}) translate(${-pan.x * 100}%, ${-pan.y * 100}%)`,
            transformOrigin: "0 0",
            willChange: "transform",
          }}
        >
          <video
            ref={videoRef}
            data-testid="pose-video"
            className="absolute inset-0 w-full h-full object-cover"
            style={{
              transform: mode === "live" && isFrontCam ? "scaleX(-1)" : "none",
            }}
            playsInline
            muted
            controls={mode === "upload" && zoom <= 1}
          />
          <canvas
            ref={canvasRef}
            data-testid="pose-canvas"
            onClick={handleCanvasClickGuarded}
            className="absolute inset-0 w-full h-full cursor-crosshair"
            style={{
              transform: mode === "live" && isFrontCam ? "scaleX(-1)" : "none",
              pointerEvents: "auto",
            }}
          />
        </div>
        <div className="absolute inset-0 pointer-events-none grid-bg opacity-30" />

        {/* status pill (top-left) */}
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/70 backdrop-blur px-3 py-1.5 border border-white/10 pointer-events-none">
          <span
            className={`w-2 h-2 rounded-full ${
              running ? "bg-[#ff3b30] pulse-dot" : "bg-zinc-500"
            }`}
          />
          <span className="text-[11px] font-display uppercase tracking-widest font-bold">
            {status === "loading"
              ? "Loading model"
              : running
                ? `REC ${duration}s`
                : status === "ready"
                  ? `Ready · ${personCount} detected`
                  : status === "error"
                    ? "Error"
                    : "Idle"}
          </span>
        </div>

        {/* Frame quality pill (top-left, second row). Live green/yellow/red
            feedback so the user can self-correct camera framing in real time.
            Hidden when loading. */}
        {status === "ready" && personCount > 0 && (
          <div
            data-testid="frame-quality-pill"
            className={`absolute top-12 left-3 flex items-center gap-2 backdrop-blur px-3 py-1.5 border pointer-events-none transition-colors ${
              frameQuality.level === "good"
                ? "bg-[#00ff88]/15 border-[#00ff88]/50"
                : frameQuality.level === "fair"
                ? "bg-[#ffab00]/15 border-[#ffab00]/50"
                : "bg-[#ff3b30]/15 border-[#ff3b30]/50"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                frameQuality.level === "good"
                  ? "bg-[#00ff88]"
                  : frameQuality.level === "fair"
                  ? "bg-[#ffab00]"
                  : "bg-[#ff3b30]"
              }`}
            />
            <span
              className={`text-[10px] font-display uppercase tracking-widest font-bold ${
                frameQuality.level === "good"
                  ? "text-[#00ff88]"
                  : frameQuality.level === "fair"
                  ? "text-[#ffab00]"
                  : "text-[#ff3b30]"
              }`}
            >
              {frameQuality.level === "good"
                ? "Frame: good"
                : frameQuality.issues[0] || `Frame: ${frameQuality.level}`}
            </span>
          </div>
        )}

        {/* tracking pill (top-center) */}
        {hasTarget && !running && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-[#00ff88]/15 border border-[#00ff88]/40 backdrop-blur px-3 py-1.5">
            <Target className="w-3 h-3 text-[#00ff88]" />
            <span className="text-[11px] font-display uppercase tracking-widest font-bold text-[#00ff88]">
              Athlete locked
            </span>
            <button
              onClick={clearTarget}
              data-testid="clear-target-btn"
              className="text-[10px] uppercase tracking-widest text-zinc-400 hover:text-white ml-1"
            >
              change
            </button>
          </div>
        )}
        {hasTarget && running && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/70 backdrop-blur px-3 py-1.5 border border-[#00ff88]/40 pointer-events-none">
            <Target className="w-3 h-3 text-[#00ff88]" />
            <span className="text-[11px] font-display uppercase tracking-widest font-bold text-[#00ff88]">
              Tracking
            </span>
          </div>
        )}

        {/* Ball-locked pill (basketball, after explicit pick, before recording).
            Shows below the athlete pill so user can tap CHANGE to pick a
            different ball. While recording, just shows non-interactive status. */}
        {/* removed: unified into the ball-detector status pill below */}

        {/* tap-to-select / tap-to-place-hoop instructions overlay.
            Top-aligned + small so it doesn't cover the rim or athlete area
            on mobile portrait. */}
        {!running && status === "ready" && !error && placementStep !== "ready" && (
          <div
            data-testid="tap-to-select-banner"
            className="absolute top-12 left-1/2 -translate-x-1/2 max-w-[88%] bg-black/85 backdrop-blur border border-[#ff3b30]/50 px-3 py-1.5 text-center pointer-events-none flex items-center gap-2"
          >
            <Target className="w-3.5 h-3.5 text-[#ff3b30] flex-shrink-0" />
            <div className="text-[10px] sm:text-[11px] uppercase tracking-widest font-display font-bold text-white whitespace-nowrap overflow-hidden text-ellipsis">
              {placementStep === "athlete"
                ? personCount === 0
                  ? "Position athlete in frame"
                  : `Tap athlete (${personCount})`
                : "Tap the rim"}
            </div>
          </div>
        )}

        {/* Live makes / attempts counter (basketball, while recording) */}
        {sport === "basketball" && running && hoopRoi && (
          <div
            data-testid="live-shot-counter"
            className="absolute top-3 right-3 flex items-center gap-2 bg-black/85 backdrop-blur border border-[#00e5ff]/50 px-3 py-1.5 pointer-events-none"
          >
            <span className="text-[10px] font-display uppercase tracking-widest text-[#00e5ff]">Shots</span>
            <span className="text-sm font-bold font-mono text-white">
              {liveMakes}<span className="text-zinc-500">/</span>{liveAttempts}
            </span>
            <span className="text-[10px] font-mono text-zinc-400">
              {liveAttempts ? `${Math.round((liveMakes / liveAttempts) * 100)}%` : "—"}
            </span>
          </div>
        )}

        {/* Ball-detector status pill (basketball, top-right under counter).
            When a ball is locked AND we're not recording, the pill becomes
            a button: tap to clear the lock so the user can pick a different
            ball (e.g., when multiple balls are on the court). */}
        {sport === "basketball" && (
          <div
            data-testid="ball-detector-status"
            className={`absolute right-3 flex items-center gap-1.5 backdrop-blur border px-2.5 py-1 transition-colors ${
              running && hoopRoi ? "top-12" : "top-12"
            } ${
              ballDetectorState === "failed"
                ? "bg-[#ff3b30]/15 border-[#ff3b30]/50"
                : hasLockedBall
                  ? "bg-[#ff8c00]/15 border-[#ff8c00]/60"
                  : ballSeen
                    ? "bg-[#ff8c00]/15 border-[#ff8c00]/60"
                    : ballDetectorState === "ready"
                      ? "bg-black/70 border-white/15"
                      : "bg-black/70 border-white/10"
            } ${(hasLockedBall && !running) ? "pointer-events-auto cursor-pointer hover:bg-[#ff8c00]/25" : (hasBallPref && !running) ? "pointer-events-auto" : "pointer-events-none"}`}
            onClick={hasLockedBall && !running ? clearBallLock : undefined}
            title={hasLockedBall && !running ? "Tap to pick a different ball" : undefined}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                ballDetectorState === "failed"
                  ? "bg-[#ff3b30]"
                  : ballSeen || hasLockedBall
                    ? "bg-[#ff8c00] pulse-dot"
                    : ballDetectorState === "ready"
                      ? "bg-zinc-400"
                      : "bg-zinc-600"
              }`}
            />
            <span
              className={`text-[10px] font-display uppercase tracking-widest font-bold ${
                ballDetectorState === "failed"
                  ? "text-[#ff3b30]"
                  : ballSeen || hasLockedBall
                    ? "text-[#ff8c00]"
                    : "text-zinc-300"
              }`}
            >
              {ballDetectorState === "failed"
                ? "Ball model failed"
                : ballDetectorState === "loading"
                  ? "Loading ball model"
                  : hasLockedBall
                    ? "Ball locked"
                    : ballCount > 1 && !running
                      ? `${ballCount} balls · tap to pick`
                      : ballSeen
                        ? hasBallPref && !running
                          ? "Ball · smart pick"
                          : "Ball tracked"
                        : "Ball: searching"}
            </span>
            {hasLockedBall && !running && (
              <span
                data-testid="clear-ball-lock-btn"
                className="text-[9px] uppercase tracking-widest text-zinc-200 ml-1 underline-offset-2 underline"
              >
                change
              </span>
            )}
            {!hasLockedBall && hasBallPref && !running && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  forgetBallPref();
                }}
                data-testid="forget-ball-pref-btn"
                className="text-[9px] uppercase tracking-widest text-zinc-300 hover:text-white ml-1 underline-offset-2 underline pointer-events-auto"
                title="Clear remembered ball size for this athlete"
              >
                reset
              </button>
            )}
          </div>
        )}

        {/* Hoop reposition button (basketball, after placement, before recording) */}
        {sport === "basketball" && hoopRoi && !running && (
          <button
            type="button"
            data-testid="hoop-reposition-btn"
            onClick={(e) => {
              e.stopPropagation();
              clearHoop();
            }}
            className="absolute top-3 right-3 inline-flex items-center gap-2 bg-[#00e5ff]/15 hover:bg-[#00e5ff]/25 border border-[#00e5ff]/50 px-3 py-1.5 transition-colors"
            title="Move the hoop"
          >
            <span className="text-[11px] font-display uppercase tracking-widest font-bold text-[#00e5ff]">
              Hoop · Reposition
            </span>
          </button>
        )}

        {/* tracking-lost warning */}
        {trackingLost && running && (
          <div className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur border border-[#ffab00]/60 px-5 py-3 text-center pointer-events-none">
            <AlertTriangle className="w-5 h-5 text-[#ffab00] mx-auto" />
            <div className="mt-1 text-[11px] uppercase tracking-widest font-display font-bold text-[#ffab00]">
              Tracking lost — re-locking…
            </div>
          </div>
        )}

        {/* camera switch */}
        {mode === "live" && !error && cameras.length > 1 && (
          <button
            type="button"
            data-testid="camera-switch-btn"
            onClick={() => {
              if (running || switching) return;
              setSwitching(true);
              clearTarget();
              setCameraIndex((i) => (i + 1) % cameras.length);
              setTimeout(() => setSwitching(false), 800);
            }}
            disabled={running || switching}
            className={`absolute right-3 inline-flex items-center gap-2 bg-black/70 backdrop-blur hover:bg-black/90 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 px-3 py-1.5 transition-colors ${
              sport === "basketball" ? "top-14" : "top-3"
            }`}
            title={
              running
                ? "Stop recording before switching cameras"
                : `Switch camera (${cameras.length} available)`
            }
          >
            <SwitchCamera className="w-4 h-4" />
            <span className="text-[11px] font-display uppercase tracking-widest font-bold max-w-[120px] truncate">
              {isFrontCam ? "Front" : "Back"}
              <span className="ml-1 text-zinc-400">
                {cameraIndex + 1}/{cameras.length}
              </span>
            </span>
          </button>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-center p-6">
            <p className="text-sm text-red-400 max-w-md">{error}</p>
          </div>
        )}

        {/* Custom play/pause overlay (upload mode, when not recording).
            Native <video controls> are blocked by the canvas overlay, so we
            provide our own button. Bottom-left so it doesn't block athlete
            selection in the center of the frame. */}
        {mode === "upload" && !running && status === "ready" && !error && (
          <button
            type="button"
            data-testid="video-play-pause-btn"
            onClick={(e) => {
              e.stopPropagation();
              togglePlayPause();
            }}
            className="absolute bottom-3 left-3 inline-flex items-center gap-2 bg-black/70 backdrop-blur hover:bg-black/90 border border-white/30 px-3 py-2 transition-colors"
            title={videoPaused ? "Play video" : "Pause video"}
            aria-label={videoPaused ? "Play video" : "Pause video"}
          >
            {videoPaused ? (
              <Play className="w-4 h-4 text-white" fill="white" />
            ) : (
              <Pause className="w-4 h-4 text-white" fill="white" />
            )}
            <span className="text-[11px] font-display uppercase tracking-widest font-bold text-white">
              {videoPaused ? "Play" : "Pause"}
            </span>
          </button>
        )}

        {/* Zoom controls (bottom-right) */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 pointer-events-auto">
          <button
            type="button"
            data-testid="zoom-in-btn"
            onClick={(e) => {
              e.stopPropagation();
              changeZoom(zoom * 1.4);
            }}
            disabled={zoom >= 4}
            className="w-9 h-9 inline-flex items-center justify-center bg-black/70 backdrop-blur hover:bg-black/90 disabled:opacity-30 border border-white/10 transition-colors"
            title="Zoom in"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-testid="zoom-out-btn"
            onClick={(e) => {
              e.stopPropagation();
              changeZoom(zoom / 1.4);
            }}
            disabled={zoom <= 1.001}
            className="w-9 h-9 inline-flex items-center justify-center bg-black/70 backdrop-blur hover:bg-black/90 disabled:opacity-30 border border-white/10 transition-colors"
            title="Zoom out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-testid="zoom-reset-btn"
            onClick={(e) => {
              e.stopPropagation();
              changeZoom(1);
            }}
            disabled={zoom <= 1.001}
            className="w-9 h-9 inline-flex items-center justify-center bg-black/70 backdrop-blur hover:bg-black/90 disabled:opacity-30 border border-white/10 transition-colors"
            title="Reset zoom"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          {zoom > 1.001 && (
            <div className="text-[10px] font-mono text-zinc-300 text-center bg-black/70 backdrop-blur border border-white/10 px-1 py-0.5 mt-1">
              {zoom.toFixed(1)}×
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        {!running ? (
          <button
            data-testid="start-capture-btn"
            onClick={start}
            disabled={status !== "ready" || !hasTarget}
            className="bg-[#ff3b30] hover:bg-[#ff5c53] disabled:opacity-40 disabled:cursor-not-allowed text-white font-display uppercase tracking-wide px-6 py-3 transition-colors"
            title={!hasTarget ? "Tap the athlete to track first" : ""}
          >
            ● Start capture
          </button>
        ) : (
          <button
            data-testid="stop-capture-btn"
            onClick={stop}
            className="bg-white text-black font-display uppercase tracking-wide px-6 py-3 hover:bg-zinc-200 transition-colors"
          >
            ■ Stop & analyze
          </button>
        )}
        {!hasTarget && status === "ready" && (
          <span className="self-center text-xs text-zinc-500 font-mono">
            ↑ Tap the athlete in the preview to enable Start
          </span>
        )}
      </div>
    </div>
  );
}
