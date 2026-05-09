import { useEffect, useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize2, SwitchCamera, Target, AlertTriangle, Play, Pause } from "lucide-react";
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
  trimStart = 0,
  trimEnd = null,
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

  /* ---------------- Reset target tracking when video source changes ---------------- */
  useEffect(() => {
    targetAnchorRef.current = null;
    lastSeenAtRef.current = null;
    lastPosesRef.current = [];
    setHasTarget(false);
    setTrackingLost(false);
    setPersonCount(0);
  }, [videoSrc, mode]);

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
                // Smart ROI: target is locked → run a single detection on a tile
                // centered around the target's last-known hip position. Single
                // inference (fast → keeps up with playback) and higher-resolution
                // view of the target athlete. ROI follows the athlete frame-to-
                // frame via the updated anchor in drawResults().
                if (!cropCanvasRef.current) cropCanvasRef.current = document.createElement("canvas");
                const roiW = 0.5;
                const roiH = 0.7;
                const ax = targetAnchorRef.current.x;
                const ay = targetAnchorRef.current.y;
                const x0 = Math.max(0, Math.min(1 - roiW, ax - roiW / 2));
                const y0 = Math.max(0, Math.min(1 - roiH, ay - roiH / 2));
                const tw = 640;
                const th = Math.round((roiH / roiW) * tw * (v.videoHeight / v.videoWidth)) || 480;
                const cc = cropCanvasRef.current;
                cc.width = tw;
                cc.height = th;
                const cctx = cc.getContext("2d");
                cctx.drawImage(
                  v,
                  x0 * v.videoWidth, y0 * v.videoHeight,
                  roiW * v.videoWidth, roiH * v.videoHeight,
                  0, 0, tw, th
                );
                const ts = performance.now();
                const r = lm.detectForVideo(cc, ts);
                if (r && r.landmarks && r.landmarks.length) {
                  result = {
                    ...r,
                    landmarks: r.landmarks.map((pose) =>
                      pose.map((p) => ({
                        ...p,
                        x: x0 + p.x * roiW,
                        y: y0 + p.y * roiH,
                      }))
                    ),
                  };
                } else {
                  // ROI miss → fall back to full-frame so we don't lose the
                  // athlete entirely if they walked outside the ROI bounds.
                  result = lm.detectForVideo(v, ts + 1);
                }
              } else if (mode === "upload") {
                // Selection phase (no target locked): full-frame + left/right
                // half-tile detection with hip-center dedupe. Surfaces small or
                // distant athletes that full-frame alone would miss so the user
                // can tap-to-pick them.
                if (!cropCanvasRef.current) cropCanvasRef.current = document.createElement("canvas");
                const tw = 640;
                const th = Math.round((v.videoHeight / v.videoWidth) * tw) || 360;
                const cc = cropCanvasRef.current;
                cc.width = tw;
                cc.height = th;
                const cctx = cc.getContext("2d");
                const ts = performance.now();
                const fullR = lm.detectForVideo(v, ts);
                cctx.drawImage(v, 0, 0, v.videoWidth * 0.6, v.videoHeight, 0, 0, tw, th);
                const leftR = lm.detectForVideo(cc, ts + 0.1);
                cctx.drawImage(v, v.videoWidth * 0.4, 0, v.videoWidth * 0.6, v.videoHeight, 0, 0, tw, th);
                const rightR = lm.detectForVideo(cc, ts + 0.2);
                const fullPoses = fullR?.landmarks || [];
                const leftPoses = (leftR?.landmarks || []).map((pose) =>
                  pose.map((p) => ({ ...p, x: p.x * 0.6, y: p.y }))
                );
                const rightPoses = (rightR?.landmarks || []).map((pose) =>
                  pose.map((p) => ({ ...p, x: 0.4 + p.x * 0.6, y: p.y }))
                );
                const all = [...fullPoses, ...leftPoses, ...rightPoses];
                const dedup = [];
                for (const p of all) {
                  const c = hipCenter(p);
                  if (!c) continue;
                  const visSum = p.reduce((s, pt) => s + (pt.visibility || 0), 0);
                  const dupIdx = dedup.findIndex((q) => {
                    const qc = hipCenter(q.pose);
                    return qc && dist2D(c, qc) < 0.07;
                  });
                  if (dupIdx === -1) dedup.push({ pose: p, vis: visSum });
                  else if (visSum > dedup[dupIdx].vis) dedup[dupIdx] = { pose: p, vis: visSum };
                }
                result = { landmarks: dedup.map((d) => d.pose) };
              } else {
                result = lm.detectForVideo(v, performance.now());
              }
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

  /* ---------------- Subject selection click handler ---------------- */
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
    // Click radius scales inversely with zoom (smaller in image space when zoomed)
    if (bestIdx >= 0 && bestDist < 0.25 / zoom) {
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

  // Suppress click after a pan-drag so dragging doesn't accidentally lock onto someone
  const handleCanvasClickGuarded = (e) => {
    const p = panningRef.current;
    if (p && p.moved) return;
    handleCanvasClick(e);
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
        v.currentTime = Math.max(0, trimStart || 0);
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
