import { useEffect, useRef, useState } from "react";
import { SwitchCamera } from "lucide-react";
import { analyzeSession, getKeyframeTimestamps } from "@/lib/repDetection";

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

export default function PoseCanvas({ onStop, mode = "live", videoSrc = null, sport = "basketball", onReady }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const poseRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  // Per-frame landmark buffer for rep analysis (only filled while running)
  const framesRef = useRef([]);
  // Thumbnail buffer for keyframe extraction in live mode (timestamp -> dataURL)
  const thumbsRef = useRef([]);
  const lastThumbAtRef = useRef(0);
  const startedAtRef = useRef(null);
  const runningRef = useRef(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | loading | ready | running | error
  const [error, setError] = useState(null);
  const [duration, setDuration] = useState(0);
  const [cameras, setCameras] = useState([]); // [{deviceId, label}]
  const [cameraIndex, setCameraIndex] = useState(0);
  const [switching, setSwitching] = useState(false);

  const currentCam = cameras[cameraIndex];
  // Heuristic: front-facing if label looks like front/user/face, OR if no label yet (default user-facing)
  const isFrontCam = !currentCam || /front|user|face|selfie/i.test(currentCam.label || "");

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

    if (!results.poseLandmarks) {
      // still record the empty frame so timestamps stay continuous
      if (runningRef.current && startedAtRef.current != null) {
        const t = (Date.now() - startedAtRef.current) / 1000;
        framesRef.current.push({ t, lm: null });
      }
      return;
    }
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

    // record landmarks for rep analysis if running
    if (runningRef.current && startedAtRef.current != null) {
      const t = (Date.now() - startedAtRef.current) / 1000;
      framesRef.current.push({
        t,
        // copy minimum required fields for memory efficiency
        lm: lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility })),
      });
      // periodic thumbnail capture for keyframe extraction (live mode only)
      if (mode === "live" && Date.now() - lastThumbAtRef.current > 200) {
        lastThumbAtRef.current = Date.now();
        try {
          const tw = 640;
          const th = Math.round((h / w) * tw);
          const off = document.createElement("canvas");
          off.width = tw;
          off.height = th;
          const octx = off.getContext("2d");
          // mirror if front camera so saved thumb matches what user sees
          if (isFrontCam) {
            octx.translate(tw, 0);
            octx.scale(-1, 1);
          }
          octx.drawImage(video, 0, 0, tw, th);
          // overlay skeleton (reuse current canvas pixels scaled down)
          octx.setTransform(1, 0, 0, 1, 0, 0);
          octx.drawImage(canvas, 0, 0, tw, th);
          thumbsRef.current.push({ t, dataUrl: off.toDataURL("image/jpeg", 0.7) });
          // bound buffer to last 5 minutes worth (~1500 thumbs at 5fps)
          if (thumbsRef.current.length > 1500) thumbsRef.current.shift();
        } catch {
          /* drawImage may throw if video not ready */
        }
      }
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
          // Stop any previous stream first so the OS releases the camera.
          if (streamRef.current) {
            streamRef.current.getTracks().forEach((t) => t.stop());
            streamRef.current = null;
          }

          // Build constraints: prefer specific deviceId once we have it, else
          // fall back to facingMode for the first request (which also prompts
          // for permission so labels become available).
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

          const stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          video.srcObject = stream;
          await video.play();

          // After permission is granted, enumerate cameras (labels are now populated).
          try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cams = devices
              .filter((d) => d.kind === "videoinput")
              .map((d) => ({ deviceId: d.deviceId, label: d.label }));
            // Only update if list actually differs to avoid loops.
            setCameras((prev) => {
              if (
                prev.length === cams.length &&
                prev.every((c, i) => c.deviceId === cams[i].deviceId)
              ) {
                return prev;
              }
              return cams;
            });
            // Sync cameraIndex to whichever device the active track is using.
            const activeId = stream.getVideoTracks()[0]?.getSettings()?.deviceId;
            if (activeId) {
              const idx = cams.findIndex((c) => c.deviceId === activeId);
              if (idx >= 0) {
                setCameraIndex((cur) => (cur === idx ? cur : idx));
              }
            }
          } catch {
            /* enumerate not supported */
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
  }, [mode, videoSrc, cameraIndex]);

  useEffect(() => {
    if (!running) return;
    startedAtRef.current = Date.now();
    const interval = setInterval(() => {
      setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => clearInterval(interval);
  }, [running]);

  function start() {
    framesRef.current = [];
    thumbsRef.current = [];
    lastThumbAtRef.current = 0;
    startedAtRef.current = Date.now();
    runningRef.current = true;
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
        if (videoRef.current && !videoRef.current.paused) {
          videoRef.current.pause();
        }
        setRunning((r) => {
          if (!r) return r;
          setTimeout(() => stop(), 0);
          return r;
        });
      };
    }
  }

  async function captureThumbnailNear(timeS) {
    // Try thumbnail buffer first (live mode); fallback to seeking video (upload mode)
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
    // Upload mode fallback: seek video element to that time and grab a frame
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
          // safety timeout
          setTimeout(resolve, 800);
        });
        const tw = 640;
        const th = Math.round((v.videoHeight / v.videoWidth) * tw) || 360;
        const off = document.createElement("canvas");
        off.width = tw;
        off.height = th;
        const octx = off.getContext("2d");
        octx.drawImage(v, 0, 0, tw, th);
        // overlay the latest skeleton canvas
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

    // Capture keyframes for best/worst rep
    const keyframes = {};
    for (const k of getKeyframeTimestamps(analysis)) {
      const dataUrl = await captureThumbnailNear(k.time_s);
      if (dataUrl) keyframes[k.label] = { time_s: k.time_s, score: k.score, image: dataUrl };
    }

    const summary = {
      ...analysis,
      frames_processed: frames.length,
      frames_detected: detected,
      detection_rate: frames.length ? +(detected / frames.length).toFixed(2) : 0,
      duration_seconds: +duration_s.toFixed(2),
      keyframes,
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
            transform: mode === "live" && isFrontCam ? "scaleX(-1)" : "none",
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
            transform: mode === "live" && isFrontCam ? "scaleX(-1)" : "none",
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
        {mode === "live" && !error && cameras.length > 1 && (
          <button
            type="button"
            data-testid="camera-switch-btn"
            onClick={() => {
              if (running || switching) return;
              setSwitching(true);
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
