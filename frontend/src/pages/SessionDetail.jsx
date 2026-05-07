import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { errMsg } from "@/lib/api";
import { ChevronLeft, Sparkles, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

const SEVERITY = {
  high: "#ff3b30",
  medium: "#ffab00",
  low: "#00ff88",
};

export default function SessionDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingPlan, setDeletingPlan] = useState(false);

  useEffect(() => {
    api
      .get(`/sessions/${id}`)
      .then((r) => setSession(r.data))
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
    return <p className="text-sm text-zinc-500">Loading…</p>;
  if (!session)
    return <p className="text-sm text-zinc-500">Session not found.</p>;

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
        <button
          data-testid="delete-session-btn"
          onClick={deleteSession}
          disabled={deleting}
          className="inline-flex items-center gap-2 text-xs uppercase tracking-widest font-display font-bold text-zinc-400 hover:text-[#ff3b30] border border-white/10 hover:border-[#ff3b30]/40 px-3 py-1.5 transition-colors disabled:opacity-40"
        >
          <Trash2 className="w-4 h-4" /> Delete session
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 bg-[#121212] border border-white/10 p-6">
          <div className="text-[11px] uppercase tracking-widest text-zinc-400 font-display font-bold">
            Form score
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
                Mode
              </div>
              <div className="capitalize font-display font-bold mt-1">{session.mode}</div>
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
                Frames
              </div>
              <div className="font-display font-bold mt-1">
                {session.pose_summary?.frames_processed ?? 0}
              </div>
            </div>
          </div>
          <div className="mt-6 border-t border-white/10 pt-4 space-y-2 text-xs font-mono text-zinc-400">
            {Object.entries(session.pose_summary || {}).slice(0, 8).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-zinc-500">{k}</span>
                <span>{typeof v === "number" ? v.toFixed(2) : String(v)}</span>
              </div>
            ))}
          </div>
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
