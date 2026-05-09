import { useEffect, useRef, useState, useCallback } from "react";
import { SwitchCamera, Target, AlertTriangle } from "lucide-react";
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
          "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numPoses: 5,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    return landmarker;
  })();
  return landmarkerLoaderPromise;
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
  onReady,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);

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

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState(null);
  const [duration, setDuration] = useState(0);
  const [cameras, setCameras] = useState([]);
  const [cameraIndex, setCameraIndex] = useState(0);
  const [switching, setSwitching] = useState(false);

  const currentCam = cameras[cameraIndex];
  const isFrontCam =
    !currentCam || /front|user|face|selfie/i.test(currentCam.label || "");

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
          if (bestDist > TRACKING_DISTANCE_THRESHOLD) {
            // too far — tracking lost
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
            const tw = 640;
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
              dataUrl: off.toDataURL("image/jpeg", 0.7),
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

  /* ---------------- Pose model + camera setup ---------------- */
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        setStatus("loading");
        const landmarker = await loadPoseLandmarker();
        if (cancelled) return;
        landmarkerRef.current = landmarker;

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
          await new Promise((resolve) => {
            if (video.readyState >= 1) resolve();
            else
              video.addEventListener("loadedmetadata", () => resolve(), {
                once: true,
              });
          });
        }

        setStatus("ready");
        if (onReady) onReady();

        const tick = () => {
          if (cancelled) return;
          const v = videoRef.current;
          const lm = landmarkerRef.current;
          // In LIVE mode the camera always streams (so we require !paused).
          // In UPLOAD mode we run detection even when paused so the user can
          // see skeletons on the current frame and tap the target before pressing Start.
          const ready =
            v && lm && v.readyState >= 2 && v.videoWidth > 0;
          const shouldDetect =
            ready &&
            (mode === "live" ? !v.paused && !v.ended : true);
          if (shouldDetect) {
            try {
              const result = lm.detectForVideo(v, performance.now());
              drawResults(result);
            } catch (err) {
              if (process.env.NODE_ENV !== "production")
                console.debug("detect error", err);
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

  /* ---------------- Subject selection click handler ---------------- */
  const handleCanvasClick = (e) => {
    if (running) return; // can't change target mid-recording
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    let nx = (e.clientX - rect.left) / rect.width;
    const ny = (e.clientY - rect.top) / rect.height;
    // un-mirror click coords if the front camera is mirrored
    if (mode === "live" && isFrontCam) nx = 1 - nx;
    const click = { x: nx, y: ny };
    const poses = lastPosesRef.current;
    if (!poses.length) return;
    let bestIdx = -1;
    let bestDist = Infinity;
    poses.forEach((lm, i) => {
      // compute centroid of upper body (shoulders + hips)
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
    if (bestIdx >= 0 && bestDist < 0.25) {
      const c = hipCenter(poses[bestIdx]);
      if (c) {
        targetAnchorRef.current = c;
        lastSeenAtRef.current = Date.now();
        setHasTarget(true);
        setTrackingLost(false);
      }
    }
  };

  const clearTarget = () => {
    if (running) return;
    targetAnchorRef.current = null;
    lastSeenAtRef.current = null;
    setHasTarget(false);
    setTrackingLost(false);
  };

  /* ---------------- Capture controls ---------------- */
  function start() {
    if (!hasTarget) {
      setError("Tap the athlete you want to track first.");
      return;
    }
    setError(null);
    framesRef.current = [];
    thumbsRef.current = [];
    lastThumbAtRef.current = 0;
    startedAtRef.current = Date.now();
    runningRef.current = true;
    setRunning(true);
    setStatus("running");
    const v = videoRef.current;
    if (v && mode === "upload") {
      try {
        v.currentTime = 0;
      } catch {
        /* ignore */
      }
      const playPromise = v.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(() => {
          setError(
            "Browser blocked auto-play. Tap the video, then press Start again."
          );
        });
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
        const tw = 640;
        const th = Math.round((v.videoHeight / v.videoWidth) * tw) || 360;
        const off = document.createElement("canvas");
        off.width = tw;
        off.height = th;
        const octx = off.getContext("2d");
        octx.drawImage(v, 0, 0, tw, th);
        octx.drawImage(c, 0, 0, tw, th);
        return off.toDataURL("image/jpeg", 0.7);
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
    const frames = framesRef.current;
    const detected = frames.filter((f) => f.lm).length;
    const duration_s =
      frames.length > 1 ? frames[frames.length - 1].t - frames[0].t : 0;
    let analysis;
    try {
      analysis = analyzeSession(frames, sport);
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
    onStop?.(summary);
  }

  /* ---------------- Render ---------------- */
  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        data-testid="pose-canvas-container"
        className="relative bg-black border border-white/10 overflow-hidden aspect-video select-none"
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
          controls={mode === "upload"}
        />
        <canvas
          ref={canvasRef}
          data-testid="pose-canvas"
          onClick={handleCanvasClick}
          className="absolute inset-0 w-full h-full cursor-crosshair"
          style={{
            transform: mode === "live" && isFrontCam ? "scaleX(-1)" : "none",
            pointerEvents: mode === "upload" && !running ? "auto" : "auto",
          }}
        />
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

        {/* tap-to-select instructions overlay */}
        {!hasTarget && status === "ready" && !error && (
          <div
            data-testid="tap-to-select-banner"
            className="absolute bottom-16 left-1/2 -translate-x-1/2 bg-black/85 backdrop-blur border border-[#ff3b30]/50 px-5 py-3 text-center pointer-events-none"
          >
            <Target className="w-5 h-5 text-[#ff3b30] mx-auto" />
            <div className="mt-1 text-[11px] uppercase tracking-widest font-display font-bold text-white">
              {personCount === 0
                ? "Position the athlete in frame"
                : `Tap the athlete to track (${personCount} detected)`}
            </div>
          </div>
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
            className="absolute top-3 right-3 inline-flex items-center gap-2 bg-black/70 backdrop-blur hover:bg-black/90 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 px-3 py-1.5 transition-colors"
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
