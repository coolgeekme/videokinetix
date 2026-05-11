import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { errMsg } from "@/lib/api";
import { ChevronLeft, Sparkles, Loader2, Trash2, FileDown } from "lucide-react";
import { toast } from "sonner";
import { exportNodeToPdf, pdfFilename } from "@/lib/pdfExport";

const SEVERITY = {
  high: "#ff3b30",
  medium: "#ffab00",
  low: "#00ff88",
};

export default function SessionDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [session, setSession] = useState(null);
  const [athlete, setAthlete] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const reportRef = useRef(null);

  const downloadPdf = async () => {
    if (!reportRef.current) return;
    setExportingPdf(true);
    try {
      const dateStr = new Date(session.created_at || Date.now())
        .toISOString()
        .slice(0, 10);
      const filename = pdfFilename(
        "visionkinetix",
        session.sport,
        athlete?.name || "session",
        dateStr,
      );
      await exportNodeToPdf(reportRef.current, filename);
      toast.success("Report downloaded");
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
      .get(`/sessions/${id}`)
      .then(async (r) => {
        setSession(r.data);
        if (r.data.athlete_id) {
          try {
            const ar = await api.get(`/athletes/${r.data.athlete_id}`);
            setAthlete(ar.data);
          } catch {
            /* athlete may have been deleted */
          }
        }
      })
      .catch((err) => {
        setLoadError(errMsg(err, "Failed to load session"));
      })
      .finally(() => setLoading(false));
  }, [id]);

  const generatePlan = async () => {
    setGenerating(true);
    try {
      const { data } = await api.post(`/sessions/${id}/training-plan`);
      setSession((s) => ({ ...s, training_plan: data }));
      toast.success("Training plan generated");
    } catch (err) {
      toast.error(errMsg(err, "Failed to generate plan"));
    } finally {
      setGenerating(false);
    }
  };

  const deleteSession = async () => {
    if (!window.confirm("Delete this session and its training plan? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await api.delete(`/sessions/${id}`);
      toast.success("Session deleted");
      nav("/app/sessions");
    } catch {
      toast.error("Failed to delete");
      setDeleting(false);
    }
  };

  const deletePlan = async () => {
    if (!session?.training_plan?.id) return;
    if (!window.confirm("Delete this training plan?")) return;
    setDeletingPlan(true);
    try {
      await api.delete(`/training-plans/${session.training_plan.id}`);
      setSession((s) => ({ ...s, training_plan: null }));
      toast.success("Plan deleted");
    } catch {
      toast.error("Failed to delete plan");
    } finally {
      setDeletingPlan(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center justify-center py-16" data-testid="session-loading">
        <Loader2 className="w-6 h-6 text-[#ff3b30] animate-spin mr-3" />
        <span className="text-sm text-zinc-400 font-display uppercase tracking-widest">Loading session…</span>
      </div>
    );
  if (loadError || !session)
    return (
      <div className="space-y-4 py-8" data-testid="session-error">
        <div className="border border-[#ff3b30]/40 bg-[#ff3b30]/5 p-6">
          <div className="text-[10px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
            Couldn't load session
          </div>
          <p className="mt-2 text-sm text-zinc-300">
            {loadError || "Session not found. It may have been deleted, or the network connection dropped while loading."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              data-testid="session-retry-btn"
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

  const a = session.analysis || {};
  const score = session.form_score;
  const scoreColor =
    score >= 80 ? "#00ff88" : score >= 60 ? "#ffab00" : "#ff3b30";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <Link
          to="/app/sessions"
          data-testid="back-sessions"
          className="inline-flex items-center gap-1 text-xs uppercase tracking-widest font-display font-bold text-zinc-400 hover:text-white"
        >
          <ChevronLeft className="w-4 h-4" /> All sessions
        </Link>
        <div className="flex items-center gap-2">
          <button
            data-testid="download-pdf-btn"
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
          <button
            data-testid="delete-session-btn"
            onClick={deleteSession}
            disabled={deleting}
            className="inline-flex items-center gap-2 text-xs uppercase tracking-widest font-display font-bold text-zinc-400 hover:text-[#ff3b30] border border-white/10 hover:border-[#ff3b30]/40 px-3 py-1.5 transition-colors disabled:opacity-40"
          >
            <Trash2 className="w-4 h-4" /> Delete session
          </button>
        </div>
      </div>

      <div ref={reportRef} className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-[#121212] border border-white/10 p-6">
          <div className="text-[11px] uppercase tracking-widest text-zinc-400 font-display font-bold">
            Form score
            {athlete && (
              <Link
                to={`/app/athletes/${athlete.id}`}
                className="ml-2 text-[#ff3b30] hover:text-[#ff5c53] normal-case"
                data-testid="session-athlete-link"
              >
                · {athlete.name}
              </Link>
            )}
          </div>
          <div
            className="font-display font-black text-8xl mt-2 leading-none"
            style={{ color: scoreColor }}
            data-testid="session-form-score"
          >
            {score}
          </div>
          <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold">
                Sport
              </div>
              <div className="capitalize font-display font-bold mt-1">{session.sport}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold">
                Reps
              </div>
              <div className="font-display font-bold mt-1">
                {session.rep_count ?? 0}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold">
                Duration
              </div>
              <div className="font-display font-bold mt-1">
                {Math.round(session.duration_seconds)}s
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold">
                Consistency
              </div>
              <div className="font-display font-bold mt-1">
                {session.consistency != null ? `${session.consistency}%` : "—"}
              </div>
            </div>
          </div>
          {/* Rep score sparkline */}
          {Array.isArray(session.reps) && session.reps.length > 0 && (
            <div className="mt-6 border-t border-white/10 pt-4">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold mb-2">
                Per-rep score
              </div>
              <div className="flex items-end gap-1 h-16" data-testid="rep-sparkline">
                {session.reps.map((r) => {
                  const s = r.score ?? 0;
                  const color =
                    s >= 80 ? "#00ff88" : s >= 60 ? "#ffab00" : "#ff3b30";
                  const strokeBadge =
                    r.stroke_type
                      ? r.stroke_type === "dink"
                        ? "Di"
                        : r.stroke_type === "drive"
                        ? "Dr"
                        : r.stroke_type === "drop"
                        ? "Dp"
                        : r.stroke_type === "volley"
                        ? "V"
                        : r.stroke_type === "overhead"
                        ? "O"
                        : r.stroke_type === "serve"
                        ? "S"
                        : null
                      : null;
                  return (
                    <div
                      key={r.index}
                      title={`Rep ${r.index}: ${s}${r.stroke_type ? ` · ${r.stroke_type}` : ""}${typeof r.made === "boolean" ? (r.made ? " · MAKE" : " · MISS") : ""}`}
                      className="flex-1 transition-opacity hover:opacity-80 relative"
                      style={{
                        height: `${Math.max(6, s)}%`,
                        background: color,
                        minWidth: 4,
                      }}
                    >
                      {typeof r.made === "boolean" && (
                        <span
                          className="absolute -top-3 left-1/2 -translate-x-1/2 text-[8px] font-bold"
                          style={{ color: r.made ? "#00ff88" : "#ff3b30" }}
                        >
                          {r.made ? "✓" : "✗"}
                        </span>
                      )}
                      {strokeBadge && (
                        <span
                          className="absolute -top-3 left-1/2 -translate-x-1/2 text-[8px] font-bold text-white/70"
                        >
                          {strokeBadge}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Session notes (user-provided context for the AI analysis) */}
          {session.notes && (
            <div className="mt-6 border-t border-white/10 pt-4" data-testid="session-notes-card">
              <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold mb-1.5">
                Session context
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed italic">
                &ldquo;{session.notes}&rdquo;
              </p>
            </div>
          )}

          {/* Pickleball: Stroke breakdown + ready-position card */}
          {session.sport === "pickleball" && session.pickleball_stats && (
            <div className="mt-6 border-t border-white/10 pt-4 space-y-4" data-testid="pickleball-stats">
              {session.pickleball_stats.stroke_breakdown && Object.keys(session.pickleball_stats.stroke_breakdown).length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-widest text-[#00e5ff] font-display font-bold mb-2">
                    Stroke breakdown
                  </div>
                  <div className="space-y-1.5">
                    {Object.entries(session.pickleball_stats.stroke_breakdown).map(([type, data]) => (
                      <div key={type} className="flex items-center gap-3 text-sm" data-testid={`stroke-row-${type}`}>
                        <span className="font-display uppercase tracking-widest text-xs font-bold text-white w-20 flex-shrink-0">
                          {type}
                        </span>
                        <span className="text-zinc-400 font-mono text-xs w-12 text-center">
                          {data.count}×
                        </span>
                        <div className="flex-1 h-2 bg-white/5 relative overflow-hidden">
                          <div
                            className="absolute inset-y-0 left-0 transition-all"
                            style={{
                              width: `${data.avg_score}%`,
                              background:
                                data.avg_score >= 80
                                  ? "#00ff88"
                                  : data.avg_score >= 60
                                  ? "#ffab00"
                                  : "#ff3b30",
                            }}
                          />
                        </div>
                        <span className="text-xs font-mono text-white w-10 text-right">{data.avg_score}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {session.pickleball_stats.ready_position && (
                <div className="border-t border-white/5 pt-3">
                  <div className="text-[10px] uppercase tracking-widest text-[#00e5ff] font-display font-bold mb-2">
                    Ready position · between shots
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div>
                      <div
                        className="font-display font-black text-3xl"
                        style={{
                          color:
                            session.pickleball_stats.ready_position.ready_score >= 80
                              ? "#00ff88"
                              : session.pickleball_stats.ready_position.ready_score >= 60
                              ? "#ffab00"
                              : "#ff3b30",
                        }}
                      >
                        {session.pickleball_stats.ready_position.ready_score}
                      </div>
                      <div className="text-[9px] uppercase tracking-widest text-zinc-500 mt-1">Ready score</div>
                    </div>
                    <div>
                      <div className="font-display font-black text-3xl text-white">
                        {session.pickleball_stats.ready_position.paddle_up_pct}%
                      </div>
                      <div className="text-[9px] uppercase tracking-widest text-zinc-500 mt-1">Paddle up</div>
                    </div>
                    <div>
                      <div className="font-display font-black text-3xl text-white">
                        {session.pickleball_stats.ready_position.knee_bend_avg
                          ? `${session.pickleball_stats.ready_position.knee_bend_avg}°`
                          : "—"}
                      </div>
                      <div className="text-[9px] uppercase tracking-widest text-zinc-500 mt-1">Knee bend</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Basketball: Shooting stats card */}
          {session.sport === "basketball" && session.shot_outcomes && (
            <div className="mt-6 border-t border-white/10 pt-4" data-testid="shooting-stats">
              <div className="text-[10px] uppercase tracking-widest text-[#00e5ff] font-display font-bold mb-2">
                Shooting · ball-tracked
              </div>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <div className="font-display font-black text-3xl" style={{ color: "#00ff88" }}>
                    {session.shot_outcomes.makes ?? 0}
                  </div>
                  <div className="text-[9px] uppercase tracking-widest text-zinc-500 mt-1">Makes</div>
                </div>
                <div>
                  <div className="font-display font-black text-3xl text-white">
                    {session.shot_outcomes.attempts ?? 0}
                  </div>
                  <div className="text-[9px] uppercase tracking-widest text-zinc-500 mt-1">Attempts</div>
                </div>
                <div>
                  <div className="font-display font-black text-3xl" style={{ color: "#00e5ff" }}>
                    {session.shot_outcomes.fg_pct != null ? `${session.shot_outcomes.fg_pct}%` : "—"}
                  </div>
                  <div className="text-[9px] uppercase tracking-widest text-zinc-500 mt-1">FG%</div>
                </div>
              </div>
              {session.makes_vs_misses && Object.keys(session.makes_vs_misses).length > 0 && (
                <div className="mt-3 text-[10px] text-zinc-500 leading-snug">
                  AI plan now targets the form factors most correlated with misses.
                </div>
              )}
            </div>
          )}
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-[#121212] border border-white/10 p-6">
            <div className="text-[11px] uppercase tracking-widest text-[#00ff88] font-display font-bold">
              AI Analysis
            </div>
            <h2 className="mt-1 font-display font-black uppercase tracking-tight text-2xl">
              Biomechanics report
            </h2>
            <p className="mt-4 text-zinc-300 leading-relaxed">{a.summary}</p>

            {a.elite_comparison && (
              <div className="mt-5 border-l-2 border-[#ff3b30] pl-4 text-sm text-zinc-300 italic">
                {a.elite_comparison}
              </div>
            )}

            {a.next_focus && (
              <div className="mt-5 bg-black/40 border border-white/5 p-4">
                <div className="text-[10px] uppercase tracking-widest text-[#ffab00] font-display font-bold">
                  Next focus
                </div>
                <p className="mt-1 text-sm">{a.next_focus}</p>
              </div>
            )}
          </div>

          {/* Visual evidence: best vs worst rep */}
          {(session.keyframes?.best_rep || session.keyframes?.worst_rep) && (
            <div className="bg-[#121212] border border-white/10 p-6">
              <h3 className="font-display font-bold uppercase tracking-tight text-lg">
                Visual evidence
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                Skeleton frame at the apex of your best vs worst rep.
              </p>
              <div className="mt-4 grid sm:grid-cols-2 gap-4">
                {session.keyframes?.best_rep && (
                  <KeyframeCard
                    label="Best rep"
                    accent="#00ff88"
                    data={session.keyframes.best_rep}
                  />
                )}
                {session.keyframes?.worst_rep && (
                  <KeyframeCard
                    label="Worst rep"
                    accent="#ff3b30"
                    data={session.keyframes.worst_rep}
                  />
                )}
              </div>
            </div>
          )}

          {/* AI rep callouts */}
          {Array.isArray(a.rep_callouts) && a.rep_callouts.length > 0 && (
            <div className="bg-[#121212] border border-white/10 p-6">
              <h3 className="font-display font-bold uppercase tracking-tight text-lg">
                Rep callouts
              </h3>
              <ul className="mt-3 space-y-2">
                {a.rep_callouts.map((c, i) => (
                  <li
                    key={i}
                    data-testid={`rep-callout-${i}`}
                    className="flex items-start gap-3 text-sm"
                  >
                    <span
                      className="font-display font-black w-12 text-right"
                      style={{
                        color:
                          c.label === "best"
                            ? "#00ff88"
                            : c.label === "worst"
                              ? "#ff3b30"
                              : "#ffab00",
                      }}
                    >
                      #{c.rep_index}
                    </span>
                    <span className="text-zinc-300 flex-1">
                      <span className="text-[10px] uppercase tracking-widest font-display font-bold text-zinc-500 mr-2">
                        {c.label}
                      </span>
                      {c.comment}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.strengths?.length > 0 && (
            <div className="bg-[#121212] border border-white/10 p-6">
              <h3 className="font-display font-bold uppercase tracking-tight text-lg">
                Strengths
              </h3>
              <ul className="mt-3 space-y-2">
                {a.strengths.map((s, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="text-[#00ff88] font-mono">+</span>
                    <span className="text-zinc-300">{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {a.improvements?.length > 0 && (
            <div className="bg-[#121212] border border-white/10 p-6">
              <h3 className="font-display font-bold uppercase tracking-tight text-lg">
                Improvements
              </h3>
              <div className="mt-3 space-y-3">
                {a.improvements.map((it, i) => (
                  <div
                    key={i}
                    data-testid={`improvement-${i}`}
                    className="border border-white/5 p-4"
                    style={{ borderLeftColor: SEVERITY[it.severity] || "#52525b", borderLeftWidth: 3 }}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display font-bold uppercase tracking-tight">
                        {it.area}
                      </span>
                      <span
                        className="text-[10px] uppercase tracking-widest font-display font-bold"
                        style={{ color: SEVERITY[it.severity] || "#a1a1aa" }}
                      >
                        {it.severity}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-400 mt-1">{it.issue}</p>
                    <p className="text-sm text-zinc-200 mt-2">
                      <span className="text-[#00ff88] font-mono">→ </span>
                      {it.fix}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Training plan */}
          <div className="bg-[#121212] border border-white/10 p-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h3 className="font-display font-bold uppercase tracking-tight text-lg">
                Training plan
              </h3>
              {!session.training_plan && (
                <button
                  data-testid="generate-plan-btn"
                  onClick={generatePlan}
                  disabled={generating}
                  className="inline-flex items-center gap-2 bg-[#ff3b30] hover:bg-[#ff5c53] disabled:opacity-50 text-white font-display uppercase tracking-wide px-5 py-2.5 transition-colors text-sm"
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Generating
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" /> Generate AI plan
                    </>
                  )}
                </button>
              )}
              {session.training_plan && (
                <button
                  data-testid="delete-plan-btn"
                  onClick={deletePlan}
                  disabled={deletingPlan}
                  className="inline-flex items-center gap-2 text-xs uppercase tracking-widest font-display font-bold text-zinc-400 hover:text-[#ff3b30] border border-white/10 hover:border-[#ff3b30]/40 px-3 py-1.5 transition-colors disabled:opacity-40"
                >
                  <Trash2 className="w-4 h-4" /> Delete plan
                </button>
              )}
            </div>
            {session.training_plan ? (
              <PlanView plan={session.training_plan} />
            ) : (
              <p className="mt-4 text-sm text-zinc-500">
                Generate a personalized 7-day plan from this analysis.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KeyframeCard({ label, accent, data }) {
  return (
    <div className="border border-white/10 bg-black/40">
      {data.image && (
        <img
          src={data.image}
          alt={label}
          data-testid={`keyframe-${label.toLowerCase().replace(/\s/g, "-")}`}
          className="w-full aspect-video object-cover"
        />
      )}
      <div className="p-3 flex items-center justify-between">
        <div>
          <div
            className="text-[10px] uppercase tracking-widest font-display font-bold"
            style={{ color: accent }}
          >
            {label}
          </div>
          <div className="text-xs text-zinc-500 font-mono mt-0.5">
            t = {data.time_s}s
          </div>
        </div>
        <div
          className="font-display font-black text-3xl"
          style={{ color: accent }}
        >
          {data.score ?? "—"}
        </div>
      </div>
    </div>
  );
}

function PlanView({ plan }) {
  return (
    <div className="mt-5 space-y-5">
      <div>
        <div className="text-[10px] uppercase tracking-widest text-[#ffab00] font-display font-bold">
          Plan
        </div>
        <h4 className="font-display font-black uppercase tracking-tight text-2xl">
          {plan.title}
        </h4>
      </div>

      {plan.focus_areas?.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {plan.focus_areas.map((f, i) => (
            <span
              key={i}
              className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-300 border border-white/10 px-2.5 py-1"
            >
              {f}
            </span>
          ))}
        </div>
      )}

      {plan.weekly_schedule?.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-3">
          {plan.weekly_schedule.map((d) => (
            <div key={d.day} className="border border-white/10 p-4 bg-black/30">
              <div className="flex justify-between items-baseline">
                <div>
                  <span className="text-[10px] uppercase tracking-widest font-mono text-zinc-500">
                    Day {d.day}
                  </span>
                  <h5 className="font-display font-bold uppercase tracking-tight">
                    {d.name}
                  </h5>
                </div>
                <span className="text-xs font-mono text-zinc-400">
                  {d.duration_min}min
                </span>
              </div>
              {d.drills?.length > 0 && (
                <ul className="mt-3 space-y-2 text-sm">
                  {d.drills.map((dr, i) => (
                    <li key={i} className="text-zinc-300">
                      <div className="flex justify-between">
                        <span className="font-bold">{dr.name}</span>
                        <span className="text-zinc-500 font-mono text-xs">
                          {dr.sets}
                        </span>
                      </div>
                      {dr.cue && (
                        <p className="text-xs text-[#00ff88] mt-0.5">→ {dr.cue}</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {plan.form_cues?.length > 0 && (
        <div className="border-t border-white/10 pt-4">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold">
            Top cues
          </div>
          <ul className="mt-2 space-y-1.5 text-sm text-zinc-200">
            {plan.form_cues.map((c, i) => (
              <li key={i}>
                <span className="text-[#ff3b30] font-mono">› </span>
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

