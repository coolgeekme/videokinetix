import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import SportPicker from "@/components/SportPicker";
import PoseCanvas from "@/components/PoseCanvas";
import MultiPlayerPoseCanvas from "@/components/MultiPlayerPoseCanvas";
import TrimSlider from "@/components/TrimSlider";
import { Upload, Camera, Loader2, ArrowRight, User } from "lucide-react";
import { toast } from "sonner";

// Quick-add note chips per sport — saves typing on mobile and primes the
// user to provide useful context (drill type, intentional form constraints).
const SPORT_SUGGESTIONS = {
  basketball: [
    "Form shooting · no jump",
    "Catch-and-shoot",
    "Pull-up jumper",
    "Free throws",
    "Off-the-dribble",
  ],
  pickleball: [
    "Third-shot drop",
    "Dink rally",
    "Drive return",
    "Overhead smash",
    "Serve technique",
  ],
  soccer: [
    "Instep finish",
    "Curling free kick",
    "Volley practice",
    "Header technique",
  ],
  swimming: [
    "Freestyle catch",
    "Streamline kick",
    "Bilateral breathing",
    "Sprint set",
  ],
};

export default function Capture() {
  const [params] = useSearchParams();
  const [athletes, setAthletes] = useState([]);
  const [athleteId, setAthleteId] = useState(params.get("athlete") || null);
  const [sports, setSports] = useState([]);
  const [sport, setSport] = useState(params.get("sport") || null);
  const [mode, setMode] = useState("live");
  const [matchMode, setMatchMode] = useState(false); // pickleball doubles only
  const [videoSrc, setVideoSrc] = useState(null);
  const [notes, setNotes] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [trim, setTrim] = useState([0, 0]);
  const fileRef = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    Promise.all([api.get("/athletes"), api.get("/sports")]).then(
      ([a, s]) => {
        setAthletes(a.data.athletes);
        setSports(s.data.sports);
        // default to first athlete (Self) if none picked
        if (!athleteId && a.data.athletes.length) {
          setAthleteId(a.data.athletes[0].id);
        }
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedAthlete = athletes.find((a) => a.id === athleteId);

  const onUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Please upload a video file");
      return;
    }
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setMode("upload");
    setVideoDuration(0);
    setTrim([0, 0]);
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      const d =
        probe.duration && Number.isFinite(probe.duration) ? probe.duration : 0;
      setVideoDuration(d);
      setTrim([0, d]);
    };
  };

  const scrubVideoTo = (t) => {
    const v = document.querySelector('[data-testid="pose-video"]');
    if (v && Number.isFinite(t)) {
      try {
        v.currentTime = t;
      } catch {
        /* ignore */
      }
    }
  };

  const handleStop = async (summary) => {
    if (!sport || !athleteId) return;
    setAnalyzing(true);
    try {
      const { data } = await api.post("/sessions", {
        athlete_id: athleteId,
        sport,
        mode,
        duration_seconds: summary.duration_seconds,
        pose_summary: summary,
        notes: notes.trim() || null,
      });
      toast.success("Analysis complete");
      nav(`/app/sessions/${data.id}`);
    } catch (err) {
      toast.error(errMsg(err, "Failed to analyze session"));
    } finally {
      setAnalyzing(false);
    }
  };

  const handleMatchStop = async ({ players }) => {
    if (!sport || !athleteId) return;
    if (!players?.length) {
      toast.error("No players were tracked.");
      return;
    }
    setAnalyzing(true);
    // One UUID groups all per-player sessions for this match.
    const matchId = (window.crypto?.randomUUID && window.crypto.randomUUID()) ||
                    `m-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    try {
      const created = [];
      for (const p of players) {
        const summary = p.analysis;
        if (!summary || (summary.rep_count ?? 0) === 0) {
          // Still create the session so the user can see "no reps detected"
          // for that slot rather than silently dropping it.
        }
        const { data } = await api.post("/sessions", {
          athlete_id: athleteId,
          sport,
          mode,
          duration_seconds: p.duration_seconds,
          pose_summary: summary,
          notes: (notes.trim() ? `${notes.trim()} · ` : "") + `Player ${p.slot + 1} (match)`,
          match_id: matchId,
          player_slot: p.slot + 1,
        });
        created.push(data);
      }
      toast.success(`Match analyzed · ${created.length} player${created.length > 1 ? "s" : ""}`);
      // Land on the first player's session detail. Sessions list will show
      // the match badge so the user can see all 4 from there.
      nav(`/app/sessions/${created[0].id}`);
    } catch (err) {
      toast.error(errMsg(err, "Failed to analyze match"));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Step 1: athlete */}
      <div>
        <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
          Step 01
        </div>
        <h1 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl mt-1">
          Choose athlete
        </h1>
      </div>

      {athletes.length === 0 ? (
        <div className="border border-white/10 bg-[#121212] p-8">
          <p className="text-sm text-zinc-400">
            No athletes yet —{" "}
            <Link
              to="/app/athletes"
              className="text-[#ff3b30] hover:text-[#ff5c53] font-display uppercase tracking-wide"
            >
              add one first
            </Link>
            .
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {athletes.map((a) => {
            const active = athleteId === a.id;
            return (
              <button
                key={a.id}
                data-testid={`pick-athlete-${a.id}`}
                onClick={() => {
                  setAthleteId(a.id);
                  if (a.primary_sport && !sport) setSport(a.primary_sport);
                }}
                className={`p-4 border text-left transition-colors flex items-center gap-3 ${
                  active
                    ? "border-[#ff3b30] bg-[#ff3b30]/5"
                    : "border-white/10 bg-[#121212] hover:border-white/30"
                }`}
              >
                <div
                  className={`w-9 h-9 flex items-center justify-center font-display font-black ${
                    a.is_self ? "bg-[#ff3b30] text-white" : "bg-white/5 border border-white/10"
                  }`}
                >
                  {a.name?.[0]?.toUpperCase() || "?"}
                </div>
                <div className="min-w-0">
                  <div className="font-display font-bold uppercase tracking-tight truncate">
                    {a.name}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold">
                    {a.is_self ? "You" : a.primary_sport || "Athlete"}
                  </div>
                </div>
              </button>
            );
          })}
          <Link
            to="/app/athletes"
            className="p-4 border border-dashed border-white/15 bg-transparent hover:border-white/40 text-zinc-400 hover:text-white flex items-center gap-2 text-sm font-display uppercase tracking-wide transition-colors"
            data-testid="manage-athletes-link"
          >
            <User className="w-4 h-4" /> Manage athletes <ArrowRight className="w-4 h-4 ml-auto" />
          </Link>
        </div>
      )}

      {/* Step 2: sport */}
      {athleteId && (
        <>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
              Step 02
            </div>
            <h2 className="font-display font-black uppercase tracking-tighter text-3xl sm:text-4xl mt-1">
              Choose sport
              {selectedAthlete && (
                <span className="text-zinc-500 font-display text-xl ml-3">
                  for {selectedAthlete.name}
                </span>
              )}
            </h2>
          </div>
          <SportPicker sports={sports} value={sport} onChange={setSport} />
        </>
      )}

      {athleteId && sport && (
        <>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
              Step 03
            </div>
            <h2 className="font-display font-black uppercase tracking-tighter text-3xl sm:text-4xl mt-1">
              Capture mode
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <button
              data-testid="mode-live"
              onClick={() => {
                setMode("live");
                setVideoSrc(null);
              }}
              className={`p-6 border text-left transition-colors ${
                mode === "live"
                  ? "border-[#ff3b30] bg-[#ff3b30]/5"
                  : "border-white/10 bg-[#121212] hover:border-white/30"
              }`}
            >
              <Camera className="w-6 h-6 text-[#00ff88]" strokeWidth={1.5} />
              <h3 className="mt-4 font-display font-black text-xl uppercase tracking-tight">
                Live webcam
              </h3>
              <p className="text-sm text-zinc-400 mt-1">
                Real-time skeleton overlay using MediaPipe. Best for drills.
              </p>
            </button>
            <button
              data-testid="mode-upload"
              onClick={() => {
                setMode("upload");
                fileRef.current?.click();
              }}
              className={`p-6 border text-left transition-colors ${
                mode === "upload"
                  ? "border-[#ff3b30] bg-[#ff3b30]/5"
                  : "border-white/10 bg-[#121212] hover:border-white/30"
              }`}
            >
              <Upload className="w-6 h-6 text-[#007aff]" strokeWidth={1.5} />
              <h3 className="mt-4 font-display font-black text-xl uppercase tracking-tight">
                Upload video
              </h3>
              <p className="text-sm text-zinc-400 mt-1">
                Analyze pre-recorded performances frame by frame.
              </p>
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            onChange={onUpload}
            className="hidden"
            data-testid="video-file-input"
          />

          {(mode === "live" || (mode === "upload" && videoSrc)) && (
            <div className="space-y-4">
              <div>
                <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
                  Step 04
                </div>
                <h2 className="font-display font-black uppercase tracking-tighter text-3xl sm:text-4xl mt-1">
                  Capture & analyze
                </h2>
              </div>

              {/* Session context / notes — optional but improves AI analysis.
                  Helps the coach explain *what* the athlete is working on so
                  the AI doesn't flag intentional choices (e.g., no-jump form
                  shots in basketball) as form errors. */}
              <div className="border border-white/10 bg-[#0f0f0f] p-4">
                <label
                  htmlFor="session-notes"
                  className="text-[10px] uppercase tracking-widest text-zinc-400 font-display font-bold flex items-center gap-2"
                >
                  Session context · optional
                  <span className="text-zinc-600 normal-case tracking-normal text-[10px]">
                    helps the AI analyze correctly
                  </span>
                </label>
                <textarea
                  id="session-notes"
                  data-testid="session-notes-input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, 500))}
                  placeholder={
                    sport === "basketball"
                      ? "e.g., Form shooting from 5 ft, no jump. Focus on follow-through and elbow alignment."
                      : sport === "pickleball"
                      ? "e.g., Practicing third-shot drop technique with consistent paddle face."
                      : sport === "soccer"
                      ? "e.g., Working on instep-curve free kicks, plant foot positioning."
                      : sport === "swimming"
                      ? "e.g., Freestyle stroke drills focusing on high-elbow catch."
                      : "Describe what the athlete is working on — drill type, focus areas, intentional constraints…"
                  }
                  rows={3}
                  maxLength={500}
                  className="mt-2 w-full bg-black/70 border border-white/10 text-sm text-white placeholder:text-zinc-600 p-3 outline-none focus:border-[#ff3b30] resize-none"
                />
                {SPORT_SUGGESTIONS[sport]?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {SPORT_SUGGESTIONS[sport].map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setNotes((cur) => (cur ? `${cur.trim()} · ${s}` : s).slice(0, 500))
                        }
                        data-testid={`note-chip-${s.replace(/\s+/g, "-").toLowerCase()}`}
                        className="text-[10px] uppercase tracking-wider font-display font-bold text-zinc-300 hover:text-white bg-white/5 hover:bg-white/15 border border-white/10 px-2 py-1 transition-colors"
                      >
                        + {s}
                      </button>
                    ))}
                  </div>
                )}
                <div className="mt-1 text-[10px] text-zinc-600 text-right font-mono">
                  {notes.length}/500
                </div>
              </div>

              {/* Pickleball: solo vs doubles match toggle */}
              {sport === "pickleball" && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMatchMode(false)}
                    data-testid="match-mode-solo-btn"
                    className={`flex-1 py-2.5 px-3 border text-[10px] uppercase tracking-widest font-display font-bold transition-colors ${
                      !matchMode
                        ? "border-[#ff3b30] bg-[#ff3b30]/15 text-white"
                        : "border-white/10 text-zinc-400 hover:text-white"
                    }`}
                  >
                    Solo · 1 player
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatchMode(true)}
                    data-testid="match-mode-doubles-btn"
                    className={`flex-1 py-2.5 px-3 border text-[10px] uppercase tracking-widest font-display font-bold transition-colors ${
                      matchMode
                        ? "border-[#00e5ff] bg-[#00e5ff]/15 text-white"
                        : "border-white/10 text-zinc-400 hover:text-white"
                    }`}
                  >
                    Doubles match · up to 4 players
                  </button>
                </div>
              )}

              {matchMode && sport === "pickleball" ? (
                <MultiPlayerPoseCanvas
                  key={`mp-${mode}-${videoSrc || "live"}-${athleteId}`}
                  mode={mode}
                  videoSrc={videoSrc}
                  sport={sport}
                  trimStart={trim[0]}
                  onStop={handleMatchStop}
                />
              ) : (
                <PoseCanvas
                  key={`${mode}-${videoSrc || "live"}-${athleteId}-${sport}`}
                  mode={mode}
                  videoSrc={videoSrc}
                  sport={sport}
                  athleteId={athleteId}
                  trimStart={trim[0]}
                  trimEnd={trim[1] || null}
                  onStop={handleStop}
                />
              )}

              {mode === "upload" && videoDuration > 0 && (
                <TrimSlider
                  duration={videoDuration}
                  value={trim}
                  onChange={setTrim}
                  onScrubTo={scrubVideoTo}
                />
              )}

              {analyzing && (
                <div
                  data-testid="analyzing-overlay"
                  className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
                >
                  <div className="text-center">
                    <Loader2 className="w-10 h-10 text-[#ff3b30] animate-spin mx-auto" />
                    <p className="mt-4 font-display uppercase tracking-widest font-bold text-zinc-300">
                      AI analyzing biomechanics…
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 font-mono">
                      elite benchmark comparison
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
