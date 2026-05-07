import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import SportPicker from "@/components/SportPicker";
import PoseCanvas from "@/components/PoseCanvas";
import { Upload, Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Capture() {
  const [sports, setSports] = useState([]);
  const [sport, setSport] = useState(null);
  const [mode, setMode] = useState("live"); // live | upload
  const [videoSrc, setVideoSrc] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const fileRef = useRef(null);
  const nav = useNavigate();

  useEffect(() => {
    api.get("/sports").then((r) => setSports(r.data.sports));
  }, []);

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
    if (!sport) return;
    setAnalyzing(true);
    try {
      const { data } = await api.post("/sessions", {
        sport,
        mode,
        duration_seconds: summary.duration_seconds,
        pose_summary: summary,
      });
      toast.success("Analysis complete");
      nav(`/app/sessions/${data.id}`);
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Failed to analyze session");
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
          Step 01
        </div>
        <h1 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl mt-1">
          Choose your sport
        </h1>
      </div>

      <SportPicker sports={sports} value={sport} onChange={setSport} />

      {sport && (
        <>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
              Step 02
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
                  Step 03
                </div>
                <h2 className="font-display font-black uppercase tracking-tighter text-3xl sm:text-4xl mt-1">
                  Capture & analyze
                </h2>
              </div>

              <PoseCanvas
                key={`${mode}-${videoSrc || "live"}`}
                mode={mode}
                videoSrc={videoSrc}
                onStop={handleStop}
              />

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
