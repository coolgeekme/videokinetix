import { useEffect, useRef, useState } from "react";
import { SwitchCamera } from "lucide-react";

/**
 * Loads MediaPipe Pose via CDN (lazy) and renders a live skeleton overlay on
 * a video element. Returns metrics summary on stop.
 *
 * Pose connections (MediaPipe BlazePose 33 keypoints):
 *   Face/torso/limbs — we only draw the body skeleton (indexes >= 11).
 */
const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31],
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];

let poseLoaderPromise = null;
function loadPoseLib() {
  if (poseLoaderPromise) return poseLoaderPromise;
  poseLoaderPromise = new Promise((resolve, reject) => {
    if (window.Pose) return resolve(window.Pose);
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/pose.js";
    script.crossOrigin = "anonymous";
    script.onload = () => resolve(window.Pose);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return poseLoaderPromise;
}

export default function PoseCanvas({ onStop, mode = "live", videoSrc = null, onReady }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const poseRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const metricsRef = useRef({
    frames: 0,
    detected: 0,
    visibilitySum: 0,
    leftKneeAngles: [],
    rightKneeAngles: [],
    leftElbowAngles: [],
    rightElbowAngles: [],
    shoulderTilts: [],
    hipTilts: [],
    started: null,
  });
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | running | error
  const [error, setError] = useState(null);
  const [duration, setDuration] = useState(0);
  const [facing, setFacing] = useState("user"); // "user" (front) | "environment" (back)
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false);
  const [switching, setSwitching] = useState(false);

  function angle(a, b, c) {
    const ab = { x: a.x - b.x, y: a.y - b.y };
    const cb = { x: c.x - b.x, y: c.y - b.y };
    const dot = ab.x * cb.x + ab.y * cb.y;
    const magAB = Math.hypot(ab.x, ab.y);
    const magCB = Math.hypot(cb.x, cb.y);
    if (magAB === 0 || magCB === 0) return 0;
    return (Math.acos(Math.min(1, Math.max(-1, dot / (magAB * magCB)))) * 180) / Math.PI;
  }

  function drawResults(results) {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const w = video.videoWidth || canvas.width;
    const h = video.videoHeight || canvas.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, w, h);

    if (!results.poseLandmarks) return;
    const lm = results.poseLandmarks;

    // skeleton lines
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#00ff88";
    ctx.shadowColor = "#00ff88";
    ctx.shadowBlur = 8;
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
    lm.forEach((p, i) => {
      if (i < 11) return;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ff3b30";
      ctx.fill();
    });

    // metrics
    const m = metricsRef.current;
    m.frames += 1;
    m.detected += 1;
    const visibility = lm.reduce((s, p) => s + (p.visibility || 0), 0) / lm.length;
    m.visibilitySum += visibility;

    try {
      m.leftKneeAngles.push(angle(lm[23], lm[25], lm[27]));
      m.rightKneeAngles.push(angle(lm[24], lm[26], lm[28]));
      m.leftElbowAngles.push(angle(lm[11], lm[13], lm[15]));
      m.rightElbowAngles.push(angle(lm[12], lm[14], lm[16]));
      m.shoulderTilts.push(Math.abs(lm[11].y - lm[12].y));
      m.hipTilts.push(Math.abs(lm[23].y - lm[24].y));
    } catch {
      /* missing landmark */
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        setStatus("loading");
        const PoseCtor = await loadPoseLib();
        if (cancelled) return;
        const pose = new PoseCtor({
          locateFile: (file) =>
            `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${file}`,
        });
        pose.setOptions({
          modelComplexity: 1,
          smoothLandmarks: true,
          enableSegmentation: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        pose.onResults(drawResults);
        poseRef.current = pose;

        const video = videoRef.current;
        if (mode === "live") {
          // detect available cameras (only after permission grant works reliably,
          // but enumerateDevices returns labels only after that)
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cams = devices.filter((d) => d.kind === "videoinput");
            setHasMultipleCameras(cams.length > 1);
          } catch {
            /* ignore */
          }
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 1280, height: 720, facingMode: facing },
            audio: false,
          });
          streamRef.current = stream;
          video.srcObject = stream;
          await video.play();
          // re-check camera count post-permission so labels populate
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cams = devices.filter((d) => d.kind === "videoinput");
            setHasMultipleCameras(cams.length > 1);
          } catch {
            /* ignore */
          }
        } else if (mode === "upload" && videoSrc) {
          video.src = videoSrc;
          video.loop = false;
          // wait for metadata so we can seek/play reliably on user gesture
          await new Promise((resolve) => {
            if (video.readyState >= 1) resolve();
            else video.addEventListener("loadedmetadata", () => resolve(), { once: true });
          });
        }

        setStatus("ready");
        if (onReady) onReady();

        const tick = async () => {
          if (cancelled) return;
          if (
            video.readyState >= 2 &&
            !video.paused &&
            !video.ended &&
            poseRef.current
          ) {
            try {
              await poseRef.current.send({ image: video });
            } catch {
              /* ignore frame error */
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
      if (poseRef.current && poseRef.current.close) {
        try {
          poseRef.current.close();
        } catch {
          /* noop */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, videoSrc]);

  useEffect(() => {
    if (!running) return;
    metricsRef.current.started = Date.now();
    const interval = setInterval(() => {
      setDuration(Math.floor((Date.now() - metricsRef.current.started) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [running]);

  function start() {
    metricsRef.current = {
      frames: 0,
      detected: 0,
      visibilitySum: 0,
      leftKneeAngles: [],
      rightKneeAngles: [],
      leftElbowAngles: [],
      rightElbowAngles: [],
      shoulderTilts: [],
      hipTilts: [],
      started: Date.now(),
    };
    setRunning(true);
    setStatus("running");
    // For uploaded video: rewind & play (autoplay was likely blocked at init)
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
          setError("Browser blocked auto-play. Tap the video, then press Start again.");
        });
      }
      v.onended = () => {
        // auto-stop when upload finishes
        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause();
        }
        // call stop only if still running
        setRunning((r) => {
          if (!r) return r;
          // call stop logic on next tick to read latest metrics
          setTimeout(() => stop(), 0);
          return r;
        });
      };
    }
  }

  function stop() {
    setRunning(false);
    setStatus("ready");
    const m = metricsRef.current;
    const avg = (arr) =>
      arr.length ? +(arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(1) : 0;
    const summary = {
      frames_processed: m.frames,
      detection_rate: m.frames ? +(m.detected / m.frames).toFixed(2) : 0,
      avg_visibility: m.frames ? +(m.visibilitySum / m.frames).toFixed(2) : 0,
      avg_left_knee_angle: avg(m.leftKneeAngles),
      avg_right_knee_angle: avg(m.rightKneeAngles),
      avg_left_elbow_angle: avg(m.leftElbowAngles),
      avg_right_elbow_angle: avg(m.rightElbowAngles),
      avg_shoulder_tilt: avg(m.shoulderTilts),
      avg_hip_tilt: avg(m.hipTilts),
      symmetry_score:
        m.leftKneeAngles.length && m.rightKneeAngles.length
          ? +(
              100 -
              Math.abs(avg(m.leftKneeAngles) - avg(m.rightKneeAngles)) * 1.5
            ).toFixed(1)
          : 0,
      duration_seconds: m.started ? (Date.now() - m.started) / 1000 : 0,
    };
    onStop?.(summary);
  }

  return (
    <div className="space-y-4">
      <div
        ref={containerRef}
        data-testid="pose-canvas-container"
        className="relative bg-black border border-white/10 overflow-hidden aspect-video"
      >
        <video
          ref={videoRef}
          data-testid="pose-video"
          className="absolute inset-0 w-full h-full object-cover"
          style={{
            transform:
              mode === "live" && facing === "user" ? "scaleX(-1)" : "none",
          }}
          playsInline
          muted
          controls={mode === "upload"}
        />
        <canvas
          ref={canvasRef}
          data-testid="pose-canvas"
          className="absolute inset-0 w-full h-full"
          style={{
            transform:
              mode === "live" && facing === "user" ? "scaleX(-1)" : "none",
          }}
        />
        {/* tactical grid */}
        <div className="absolute inset-0 pointer-events-none grid-bg opacity-30" />
        {/* status pill */}
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/70 backdrop-blur px-3 py-1.5 border border-white/10">
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
                  ? "Ready"
                  : status === "error"
                    ? "Error"
                    : "Idle"}
          </span>
        </div>

        {/* camera switch (live only) */}
        {mode === "live" && !error && (
          <button
            type="button"
            data-testid="camera-switch-btn"
            onClick={() => {
              if (running || switching) return;
              setSwitching(true);
              setFacing((f) => (f === "user" ? "environment" : "user"));
              setTimeout(() => setSwitching(false), 600);
            }}
            disabled={running || switching}
            className="absolute top-3 right-3 inline-flex items-center gap-2 bg-black/70 backdrop-blur hover:bg-black/90 disabled:opacity-40 disabled:cursor-not-allowed border border-white/10 px-3 py-1.5 transition-colors"
            title={
              running
                ? "Stop recording before switching cameras"
                : facing === "user"
                  ? "Switch to back camera"
                  : "Switch to front camera"
            }
          >
            <SwitchCamera className="w-4 h-4" />
            <span className="text-[11px] font-display uppercase tracking-widest font-bold">
              {facing === "user" ? "Front" : "Back"}
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
            disabled={status !== "ready"}
            className="bg-[#ff3b30] hover:bg-[#ff5c53] disabled:opacity-40 disabled:cursor-not-allowed text-white font-display uppercase tracking-wide px-6 py-3 transition-colors"
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
      </div>
    </div>
  );
}
