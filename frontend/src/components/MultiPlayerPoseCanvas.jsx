import React, { useEffect, useRef, useState } from "react";
import { Target, AlertTriangle, X, Play, Pause } from "lucide-react";
import { loadPoseLandmarker } from "../lib/mediapipeLoader";
import { analyzeSession } from "../lib/repDetection";
import { assessFrameQuality } from "../lib/frameQuality";

// Up to 4 players — each gets a distinct color for the skeleton + UI.
// Matches the colors used in the slot pills.
const PLAYER_COLORS = ["#ff3b30", "#00e5ff", "#ffd166", "#00ff88"];
const POSE_CONNECTIONS = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];

function hipCenter(lm) {
  const lh = lm?.[23];
  const rh = lm?.[24];
  if (!lh || !rh) return null;
  return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
}
function dist2D(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Multi-player pose tracking canvas (pickleball doubles).
 * Tap up to maxPlayers players to assign them to slots; each slot is
 * tracked through the recording with its own colored skeleton, and on
 * Stop we return one analyzeSession() result per player.
 */
export default function MultiPlayerPoseCanvas({
  onStop,
  mode = "live",
  videoSrc = null,
  sport = "pickleball",
  maxPlayers = 4,
  trimStart = 0,
}) {
  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const landmarkerRef = useRef(null);
  const lastDetectVideoTimeRef = useRef(-1);
  const startedAtRef = useRef(null);
  const runningRef = useRef(false);
  const lastPosesRef = useRef([]);
  // Per-slot tracking refs. playersRef.current = [{ slot, color, anchor, predict, lastSeenAt, frames }]
  const playersRef = useRef([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [running, setRunning] = useState(false);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("idle"); // 'idle' | 'loading' | 'ready' | 'running' | 'analyzing'
  const [error, setError] = useState(null);
  const [personCount, setPersonCount] = useState(0);
  const [videoPaused, setVideoPaused] = useState(true);
  const [frameQuality, setFrameQuality] = useState({ level: "good", issues: [] });
  const lastQualityUpdateRef = useRef(0);

  /* ---------- init ---------- */
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        setStatus("loading");
        const lm = await loadPoseLandmarker(8); // need higher pose count for 4 players
        if (cancelled) return;
        landmarkerRef.current = lm;

        if (mode === "live") {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1280 } },
            audio: false,
          });
          if (cancelled) return;
          const v = videoRef.current;
          v.srcObject = stream;
          await v.play();
        } else if (mode === "upload" && videoSrc) {
          const v = videoRef.current;
          v.src = videoSrc;
          v.loop = false;
          v.muted = true;
          v.playsInline = true;
          await new Promise((r) => {
            if (v.readyState >= 1) r();
            else v.addEventListener("loadedmetadata", () => r(), { once: true });
          });
          try {
            await v.play();
            v.currentTime = trimStart && trimStart > 0
              ? trimStart
              : Math.min(0.5, (v.duration || 1) * 0.05);
            await new Promise((r) => {
              const onSeeked = () => { v.removeEventListener("seeked", onSeeked); r(); };
              v.addEventListener("seeked", onSeeked);
              setTimeout(r, 600);
            });
            v.pause();
          } catch { /* autoplay blocked */ }
          setVideoPaused(v.paused);
        }
        setStatus("ready");
        tick();
      } catch (e) {
        console.error("[MultiPlayerPoseCanvas] init error", e);
        setError(e.message || "Failed to start capture");
        setStatus("idle");
      }
    }
    init();
    return () => {
      cancelled = true;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      const v = videoRef.current;
      if (v?.srcObject) {
        v.srcObject.getTracks().forEach((t) => t.stop());
        v.srcObject = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, videoSrc]);

  /* ---------- play/pause sync ---------- */
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

  function tick() {
    const lm = landmarkerRef.current;
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!lm || !v || !c) {
      animationRef.current = requestAnimationFrame(tick);
      return;
    }
    // Throttle detection to actual video frame changes — rAF fires at 60Hz
    // but videos play at 30fps, so detecting on every tick wastes CPU and
    // makes <video> playback choppy. Skip when currentTime hasn't advanced.
    const lastT = lastDetectVideoTimeRef.current;
    const advanced = v.currentTime !== lastT;
    if (v.readyState >= 2 && v.videoWidth > 0 && advanced && !v.ended) {
      lastDetectVideoTimeRef.current = v.currentTime;
      try {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        const result = lm.detectForVideo(v, performance.now());
        const poses = result?.landmarks || [];
        lastPosesRef.current = poses;
        setPersonCount(poses.length);
        // Throttled frame-quality check
        const nowQ = performance.now();
        if (nowQ - lastQualityUpdateRef.current > 500) {
          lastQualityUpdateRef.current = nowQ;
          setFrameQuality(assessFrameQuality(poses, { sport }));
        }
        // Match each detected pose to nearest player anchor (Hungarian-light)
        matchPosesToPlayers(poses);
        // If running, record per-player frames
        if (runningRef.current && startedAtRef.current != null) {
          const t = (Date.now() - startedAtRef.current) / 1000;
          for (const p of playersRef.current) {
            p.frames.push({ t, lm: p.matchedPose || null });
          }
        }
        drawScene(poses);
      } catch (e) {
        console.warn("[MultiPlayerPoseCanvas] detect error", e);
      }
    }
    animationRef.current = requestAnimationFrame(tick);
  }

  function matchPosesToPlayers(poses) {
    const players = playersRef.current;
    // Reset assignments
    for (const p of players) p.matchedPose = null;
    if (players.length === 0 || poses.length === 0) return;
    // Greedy nearest-pose matching on hip-center, with velocity-aware prediction
    const nowS = performance.now() / 1000;
    const used = new Set();
    // Sort players by descending lock-time (most-recent first) so the
    // freshly-locked one gets first pick of the closest pose.
    const order = [...players].sort((a, b) => b.lastSeenAt - a.lastSeenAt);
    for (const p of order) {
      const pred = p.predict;
      const dt = pred ? Math.min(0.5, nowS - pred.t) : 0;
      const targetX = pred ? pred.x + (pred.vx || 0) * dt : p.anchor.x;
      const targetY = pred ? pred.y + (pred.vy || 0) * dt : p.anchor.y;
      let bestIdx = -1;
      let bestD = 0.4; // generous gate — players move fast in pickleball
      for (let i = 0; i < poses.length; i++) {
        if (used.has(i)) continue;
        const c = hipCenter(poses[i]);
        if (!c) continue;
        const d = dist2D(c, { x: targetX, y: targetY });
        if (d < bestD) { bestD = d; bestIdx = i; }
      }
      if (bestIdx !== -1) {
        used.add(bestIdx);
        p.matchedPose = poses[bestIdx];
        const c = hipCenter(poses[bestIdx]);
        if (c) {
          if (pred) {
            const dtPred = Math.max(0.001, nowS - pred.t);
            const rawVx = (c.x - pred.x) / dtPred;
            const rawVy = (c.y - pred.y) / dtPred;
            const alpha = 0.45;
            p.predict = {
              x: c.x, y: c.y,
              vx: alpha * rawVx + (1 - alpha) * (pred.vx || 0),
              vy: alpha * rawVy + (1 - alpha) * (pred.vy || 0),
              t: nowS,
            };
          } else {
            p.predict = { x: c.x, y: c.y, vx: 0, vy: 0, t: nowS };
          }
          p.anchor = c;
          p.lastSeenAt = nowS;
        }
      }
    }
  }

  function drawScene(poses) {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    const w = c.width;
    const h = c.height;
    ctx.clearRect(0, 0, w, h);
    const players = playersRef.current;
    // Render each detected pose
    poses.forEach((lm) => {
      // Find which player slot owns this pose
      let owner = null;
      for (const p of players) {
        if (p.matchedPose === lm) { owner = p; break; }
      }
      const color = owner ? owner.color : "rgba(255,255,255,0.35)";
      ctx.strokeStyle = color;
      ctx.lineWidth = owner ? 2.5 : 1.5;
      ctx.fillStyle = color;
      ctx.shadowColor = owner ? color : "transparent";
      ctx.shadowBlur = owner ? 6 : 0;
      // Skeleton
      for (const [a, b] of POSE_CONNECTIONS) {
        const pa = lm[a]; const pb = lm[b];
        if (!pa || !pb) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x * w, pa.y * h);
        ctx.lineTo(pb.x * w, pb.y * h);
        ctx.stroke();
      }
      // Hip-center marker + slot label
      const hip = hipCenter(lm);
      if (hip) {
        ctx.beginPath();
        ctx.arc(hip.x * w, hip.y * h, owner ? 7 : 4, 0, Math.PI * 2);
        ctx.fill();
        if (owner) {
          ctx.save();
          ctx.fillStyle = "#000";
          ctx.font = "bold 11px sans-serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(`P${owner.slot + 1}`, hip.x * w, hip.y * h);
          ctx.restore();
        }
      }
    });
    ctx.shadowBlur = 0;
  }

  /* ---------- click → assign or remove player ---------- */
  function handleClick(e) {
    if (running) return;
    const c = canvasRef.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const click = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    const poses = lastPosesRef.current;
    if (!poses.length) return;
    let bestIdx = -1;
    let bestDist = Infinity;
    poses.forEach((lm, i) => {
      const c2 = hipCenter(lm);
      if (!c2) return;
      const d = dist2D(c2, click);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    });
    if (bestIdx === -1 || bestDist >= 0.4) return;
    const c2 = hipCenter(poses[bestIdx]);
    if (!c2) return;
    // If this pose is already owned by a player, remove that player (toggle off)
    for (const p of playersRef.current) {
      if (dist2D(p.anchor, c2) < 0.06) {
        playersRef.current = playersRef.current.filter((q) => q !== p);
        // Re-slot remaining players
        playersRef.current.forEach((q, idx) => { q.slot = idx; q.color = PLAYER_COLORS[idx]; });
        setPlayerCount(playersRef.current.length);
        return;
      }
    }
    if (playersRef.current.length >= maxPlayers) return;
    const slot = playersRef.current.length;
    playersRef.current.push({
      slot,
      color: PLAYER_COLORS[slot],
      anchor: c2,
      predict: { x: c2.x, y: c2.y, vx: 0, vy: 0, t: performance.now() / 1000 },
      lastSeenAt: performance.now() / 1000,
      matchedPose: null,
      frames: [],
    });
    setPlayerCount(playersRef.current.length);
  }

  function clearAll() {
    if (running) return;
    playersRef.current = [];
    setPlayerCount(0);
  }

  /* ---------- play/pause helper ---------- */
  async function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    try { if (v.paused) await v.play(); else v.pause(); } catch { /* */ }
  }

  /* ---------- start / stop ---------- */
  function start() {
    if (playersRef.current.length === 0) {
      setError("Tap each player to lock them in before starting.");
      return;
    }
    setError(null);
    for (const p of playersRef.current) p.frames = [];
    startedAtRef.current = Date.now();
    runningRef.current = true;
    setRunning(true);
    setStatus("running");
    if (mode === "upload") {
      const v = videoRef.current;
      try {
        const ts = trimStart || 0;
        if (v.currentTime < ts) v.currentTime = ts;
        v.play().catch(() => {});
      } catch { /* */ }
    }
  }

  /* ---------- duration tick ---------- */
  useEffect(() => {
    if (!running) return;
    const i = setInterval(() => {
      setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 500);
    return () => clearInterval(i);
  }, [running]);

  async function stop() {
    runningRef.current = false;
    setRunning(false);
    setStatus("analyzing");
    const v = videoRef.current;
    if (v && mode === "upload" && !v.paused) v.pause();
    const playerSummaries = playersRef.current.map((p) => {
      const detected = p.frames.filter((f) => f.lm).length;
      const dur = p.frames.length > 1
        ? p.frames[p.frames.length - 1].t - p.frames[0].t
        : 0;
      let analysis;
      try {
        analysis = analyzeSession(p.frames, sport);
      } catch (e) {
        console.error("[MultiPlayerPoseCanvas] analyze error for slot", p.slot, e);
        analysis = { sport, rep_count: 0, reps: [], no_reps_detected: true };
      }
      return {
        slot: p.slot,
        color: p.color,
        duration_seconds: +dur.toFixed(2),
        frames_detected: detected,
        analysis,
      };
    });
    setStatus("ready");
    if (onStop) onStop({ players: playerSummaries });
  }

  return (
    <div className="space-y-3">
      {/* Player slot pills */}
      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: maxPlayers }).map((_, i) => {
          const p = playersRef.current[i];
          const color = PLAYER_COLORS[i];
          const filled = !!p;
          return (
            <div
              key={i}
              data-testid={`player-slot-${i + 1}`}
              className={`inline-flex items-center gap-1.5 border px-2.5 py-1 transition-all ${
                filled ? "border-current opacity-100" : "border-white/15 opacity-50"
              }`}
              style={{ color: filled ? color : "rgba(255,255,255,0.35)" }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: filled ? color : "rgba(255,255,255,0.3)" }}
              />
              <span className="text-[10px] uppercase tracking-widest font-display font-bold">
                P{i + 1}
              </span>
              {filled && <span className="text-[10px] font-mono">locked</span>}
            </div>
          );
        })}
        {playerCount > 0 && !running && (
          <button
            onClick={clearAll}
            className="text-[10px] uppercase tracking-widest text-zinc-400 hover:text-white px-2 py-1 transition-colors ml-2"
            data-testid="clear-all-players-btn"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Canvas / Video */}
      <div
        ref={containerRef}
        className="relative bg-black border border-white/10 overflow-hidden"
        style={{ aspectRatio: "16/9" }}
      >
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-contain"
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          className="absolute inset-0 w-full h-full object-contain"
        />

        {/* Status pills */}
        <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/70 backdrop-blur px-2.5 py-1 border border-white/10">
          <span className={`w-1.5 h-1.5 rounded-full ${
            status === "running" ? "bg-[#ff3b30] animate-pulse" :
            status === "ready" ? "bg-[#00ff88]" :
            status === "analyzing" ? "bg-[#ffd166] animate-pulse" :
            "bg-zinc-500"
          }`} />
          <span className="text-[10px] uppercase tracking-widest font-display font-bold text-white">
            {status === "loading" ? "Loading model" :
              status === "running" ? `REC · ${duration}s` :
              status === "analyzing" ? "Analyzing…" :
              `Ready · ${personCount} detected`}
          </span>
        </div>

        {/* Frame quality pill */}
        {status === "ready" && personCount > 0 && (
          <div
            data-testid="frame-quality-pill"
            className={`absolute top-11 left-3 flex items-center gap-1.5 backdrop-blur px-2.5 py-1 border pointer-events-none transition-colors ${
              frameQuality.level === "good"
                ? "bg-[#00ff88]/15 border-[#00ff88]/50"
                : frameQuality.level === "fair"
                ? "bg-[#ffab00]/15 border-[#ffab00]/50"
                : "bg-[#ff3b30]/15 border-[#ff3b30]/50"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                frameQuality.level === "good"
                  ? "bg-[#00ff88]"
                  : frameQuality.level === "fair"
                  ? "bg-[#ffab00]"
                  : "bg-[#ff3b30]"
              }`}
            />
            <span
              className={`text-[10px] uppercase tracking-widest font-display font-bold ${
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

        {/* Tap-to-pick instructions */}
        {!running && status === "ready" && !error && playerCount < maxPlayers && (
          <div className="absolute top-12 left-1/2 -translate-x-1/2 max-w-[88%] bg-black/85 backdrop-blur border border-[#ff3b30]/50 px-3 py-1.5 text-center pointer-events-none flex items-center gap-2">
            <Target className="w-3.5 h-3.5 text-[#ff3b30] flex-shrink-0" />
            <span className="text-[10px] uppercase tracking-widest font-display font-bold text-white">
              Tap player {playerCount + 1} of up to {maxPlayers}
            </span>
          </div>
        )}

        {/* Play/Pause overlay */}
        {mode === "upload" && !running && status === "ready" && !error && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            className="absolute bottom-3 left-3 inline-flex items-center gap-2 bg-black/70 backdrop-blur hover:bg-black/90 border border-white/30 px-3 py-2 transition-colors"
            data-testid="mp-play-pause-btn"
          >
            {videoPaused ? <Play className="w-4 h-4 text-white" fill="white" /> : <Pause className="w-4 h-4 text-white" fill="white" />}
            <span className="text-[11px] font-display uppercase tracking-widest font-bold text-white">
              {videoPaused ? "Play" : "Pause"}
            </span>
          </button>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 text-center p-6">
            <p className="text-sm text-red-400 max-w-md">{error}</p>
          </div>
        )}
      </div>

      {/* Capture buttons */}
      <div className="flex gap-3">
        {!running ? (
          <button
            onClick={start}
            disabled={playerCount === 0 || status !== "ready"}
            data-testid="mp-start-btn"
            className="flex-1 bg-[#ff3b30] hover:bg-[#ff5c53] disabled:opacity-40 disabled:cursor-not-allowed text-white font-display uppercase tracking-widest text-sm font-bold py-3 transition-colors"
          >
            Start match capture {playerCount > 0 ? `· ${playerCount} player${playerCount > 1 ? "s" : ""}` : ""}
          </button>
        ) : (
          <button
            onClick={stop}
            data-testid="mp-stop-btn"
            className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-[#ff3b30] text-[#ff3b30] font-display uppercase tracking-widest text-sm font-bold py-3 transition-colors"
          >
            Stop & analyze · {duration}s
          </button>
        )}
      </div>
    </div>
  );
}
