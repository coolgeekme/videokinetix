import { useEffect, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Loader2, ArrowRight, Users, FileDown } from "lucide-react";
import { api, errMsg } from "@/lib/api";
import { exportNodeToPdf, pdfFilename } from "@/lib/pdfExport";
import { toast } from "sonner";

const PLAYER_COLORS = ["#ff3b30", "#00e5ff", "#ffd166", "#00ff88"];

export default function MatchDetail() {
  const { matchId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const reportRef = useRef(null);

  const downloadPdf = async () => {
    if (!reportRef.current) return;
    setExportingPdf(true);
    // Let React flush the loading state before html2canvas blocks the main thread
    await new Promise((r) => setTimeout(r, 50));
    try {
      const filename = pdfFilename(
        "visionkinetix",
        "match",
        matchId || "report",
      );
      await exportNodeToPdf(reportRef.current, filename);
      toast.success("Match report downloaded");
    } catch (err) {
      console.error("PDF export error", err);
      toast.error("Failed to export PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    setLoadError(null);
    api
      .get(`/matches/${matchId}`)
      .then((r) => setData(r.data))
      .catch((err) => setLoadError(errMsg(err, "Failed to load match")))
      .finally(() => setLoading(false));
  }, [matchId]);

  if (loading)
    return (
      <div className="flex items-center justify-center py-16" data-testid="match-loading">
        <Loader2 className="w-6 h-6 text-[#ff3b30] animate-spin mr-3" />
        <span className="text-sm text-zinc-400 font-display uppercase tracking-widest">
          Loading match…
        </span>
      </div>
    );

  if (loadError || !data)
    return (
      <div className="space-y-4 py-8" data-testid="match-error">
        <div className="border border-[#ff3b30]/40 bg-[#ff3b30]/5 p-6">
          <div className="text-[10px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
            Couldn't load match
          </div>
          <p className="mt-2 text-sm text-zinc-300">
            {loadError || "Match not found."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => window.location.reload()}
              className="bg-[#ff3b30] hover:bg-[#ff5c53] text-white font-display uppercase tracking-wide text-xs px-4 py-2 transition-colors"
            >
              Retry
            </button>
            <Link
              to="/app/sessions"
              className="border border-white/10 hover:border-white/30 text-zinc-300 font-display uppercase tracking-wide text-xs px-4 py-2 transition-colors"
            >
              All sessions
            </Link>
          </div>
        </div>
      </div>
    );

  const sessions = data.sessions || [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div ref={reportRef} className="space-y-6 flex-1 min-w-0">
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#00e5ff] font-display font-bold flex items-center gap-2">
              <Users className="w-3.5 h-3.5" />
              Doubles match · {sessions.length} player{sessions.length !== 1 ? "s" : ""}
            </div>
            <h1 className="font-display font-black uppercase tracking-tighter text-3xl sm:text-5xl mt-1">
              Match analysis
            </h1>
            <p className="mt-2 text-xs text-zinc-500 font-mono">
              match_id: {matchId}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="match-player-grid">
            {sessions.map((s) => {
          const color = PLAYER_COLORS[(s.player_slot ?? 1) - 1] || "#ff3b30";
          const score = s.form_score ?? s.pose_summary?.overall_score ?? 0;
          const a = s.analysis || {};
          const pb = s.pickleball_stats || {};
          const sb = pb.stroke_breakdown || {};
          const rp = pb.ready_position || null;
          return (
            <Link
              to={`/app/sessions/${s.id}`}
              key={s.id}
              data-testid={`match-player-card-${s.player_slot}`}
              className="block border bg-[#0f0f0f] hover:bg-[#141414] transition-colors p-5"
              style={{ borderColor: `${color}55` }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                  />
                  <div>
                    <div
                      className="font-display font-black uppercase tracking-tight text-xl"
                      style={{ color }}
                    >
                      Player {s.player_slot}
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold mt-0.5">
                      {s.rep_count ?? 0} strokes · {Math.round(s.duration_seconds ?? 0)}s
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className="font-display font-black text-3xl leading-none"
                    style={{
                      color: score >= 80 ? "#00ff88" : score >= 60 ? "#ffab00" : "#ff3b30",
                    }}
                  >
                    {score}
                  </div>
                  <div className="text-[9px] uppercase tracking-widest text-zinc-500 mt-1">
                    form
                  </div>
                </div>
              </div>

              {/* Stroke breakdown mini bars */}
              {Object.keys(sb).length > 0 && (
                <div className="mt-4 space-y-1.5">
                  {Object.entries(sb).slice(0, 4).map(([type, d]) => (
                    <div key={type} className="flex items-center gap-2 text-xs">
                      <span className="font-display uppercase tracking-widest font-bold text-zinc-300 w-16 flex-shrink-0">
                        {type}
                      </span>
                      <span className="text-zinc-500 font-mono w-7 text-center text-[10px]">
                        {d.count}×
                      </span>
                      <div className="flex-1 h-1.5 bg-white/5 relative overflow-hidden">
                        <div
                          className="absolute inset-y-0 left-0"
                          style={{
                            width: `${d.avg_score}%`,
                            background:
                              d.avg_score >= 80 ? "#00ff88" : d.avg_score >= 60 ? "#ffab00" : "#ff3b30",
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-zinc-400 w-8 text-right">
                        {d.avg_score}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Ready position summary */}
              {rp && (
                <div className="mt-4 flex items-center gap-4 text-[10px] uppercase tracking-widest font-display font-bold">
                  <div>
                    <span className="text-zinc-500">Ready </span>
                    <span
                      style={{
                        color:
                          rp.ready_score >= 80 ? "#00ff88" : rp.ready_score >= 60 ? "#ffab00" : "#ff3b30",
                      }}
                    >
                      {rp.ready_score}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Paddle up </span>
                    <span className="text-white">{rp.paddle_up_pct}%</span>
                  </div>
                </div>
              )}

              {/* AI summary teaser */}
              {a.summary && (
                <p className="mt-4 text-xs text-zinc-400 leading-relaxed line-clamp-3">
                  {a.summary}
                </p>
              )}

              <div className="mt-4 flex items-center justify-end text-[10px] uppercase tracking-widest font-display font-bold text-zinc-500 hover:text-white transition-colors">
                Full report
                <ArrowRight className="w-3 h-3 ml-1.5" />
              </div>
            </Link>
          );
        })}
      </div>
        </div>
        <div className="md:w-auto md:pt-2">
          <button
            data-testid="download-match-pdf-btn"
            onClick={downloadPdf}
            disabled={exportingPdf}
            className="inline-flex items-center gap-2 text-xs uppercase tracking-widest font-display font-bold text-zinc-200 hover:text-white border border-white/10 hover:border-white/30 px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            {exportingPdf ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Building PDF
              </>
            ) : (
              <>
                <FileDown className="w-4 h-4" /> Download PDF
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
