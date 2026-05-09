import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { api, errMsg } from "@/lib/api";
import SportPicker from "@/components/SportPicker";
import PoseCanvas from "@/components/PoseCanvas";
import { Upload, Camera, Loader2, ArrowRight, User } from "lucide-react";
import { toast } from "sonner";

export default function Capture() {
  const [params] = useSearchParams();
  const [athletes, setAthletes] = useState([]);
  const [athleteId, setAthleteId] = useState(params.get("athlete") || null);
  const [sports, setSports] = useState([]);
  const [sport, setSport] = useState(params.get("sport") || null);
  const [mode, setMode] = useState("live");
  const [videoSrc, setVideoSrc] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
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
      });
      toast.success("Analysis complete");
      nav(`/app/sessions/${data.id}`);
    } catch (err) {
      toast.error(errMsg(err, "Failed to analyze session"));
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

              <PoseCanvas
                key={`${mode}-${videoSrc || "live"}-${athleteId}-${sport}`}
                mode={mode}
                videoSrc={videoSrc}
                sport={sport}
                trimStart={trim[0]}
                trimEnd={trim[1] || null}
                onStop={handleStop}
              />

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
                      gpt-5.2 · elite benchmark comparison
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
