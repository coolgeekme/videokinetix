import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

const SPORTS = [
  { id: "all", name: "All" },
  { id: "basketball", name: "Basketball" },
  { id: "soccer", name: "Soccer" },
  { id: "swimming", name: "Swimming" },
  { id: "pickleball", name: "Pickleball" },
];

export default function TrainingPlans() {
  const [plans, setPlans] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [athleteId, setAthleteId] = useState("all");
  const [sport, setSport] = useState("all");

  const refresh = () => {
    const params = [];
    if (athleteId !== "all") params.push(`athlete_id=${athleteId}`);
    if (sport !== "all") params.push(`sport=${sport}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return api.get(`/training-plans${qs}`).then((r) => setPlans(r.data.plans));
  };

  useEffect(() => {
    api.get("/athletes").then((r) => setAthletes(r.data.athletes));
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, sport]);

  const athleteMap = useMemo(
    () => Object.fromEntries(athletes.map((a) => [a.id, a])),
    [athletes]
  );

  const handleDelete = async (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Delete this training plan?")) return;
    try {
      await api.delete(`/training-plans/${id}`);
      setPlans((arr) => arr.filter((p) => p.id !== id));
      toast.success("Plan deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
          Programs
        </div>
        <h1 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl mt-1">
          Training plans
        </h1>
      </div>

      <div className="flex flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest font-display font-bold text-zinc-500 mb-1">
            Athlete
          </div>
          <select
            data-testid="filter-athlete"
            value={athleteId}
            onChange={(e) => setAthleteId(e.target.value)}
            className="bg-[#121212] border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30] text-sm"
          >
            <option value="all">All athletes</option>
            {athletes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}{a.is_self ? " (you)" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-widest font-display font-bold text-zinc-500 mb-1">
            Sport
          </div>
          <select
            data-testid="filter-sport"
            value={sport}
            onChange={(e) => setSport(e.target.value)}
            className="bg-[#121212] border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30] text-sm capitalize"
          >
            {SPORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : plans.length === 0 ? (
        <div className="border border-white/10 bg-[#121212] p-12 text-center">
          <Sparkles className="w-10 h-10 text-zinc-700 mx-auto" strokeWidth={1.5} />
          <p className="mt-4 text-sm text-zinc-400">
            No plans match this filter. Generate one from any session analysis.
          </p>
          <Link
            to="/app/sessions"
            data-testid="plans-go-sessions"
            className="mt-6 inline-block text-[#ff3b30] hover:text-[#ff5c53] font-display uppercase tracking-wide"
          >
            Go to sessions →
          </Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((p) => {
            const a = athleteMap[p.athlete_id];
            return (
              <div
                key={p.id}
                data-testid={`plan-card-${p.id}`}
                className="relative group border border-white/10 bg-[#121212] p-5 hover:border-[#ff3b30] transition-colors"
              >
                <Link to={`/app/sessions/${p.session_id}`} className="block">
                  <div className="text-[10px] uppercase tracking-widest text-[#ffab00] font-display font-bold pr-8 capitalize">
                    {a ? `${a.name} · ` : ""}{p.sport} · {p.duration_days} days
                  </div>
                  <h3 className="mt-2 font-display font-black uppercase tracking-tight text-xl group-hover:text-[#ff3b30] transition-colors">
                    {p.title}
                  </h3>
                  {p.focus_areas?.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {p.focus_areas.slice(0, 3).map((f, i) => (
                        <span
                          key={i}
                          className="text-[10px] uppercase tracking-widest font-display font-bold border border-white/10 px-2 py-0.5 text-zinc-400"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  )}
                  <p className="mt-4 text-xs text-zinc-500 font-mono">
                    {new Date(p.created_at).toLocaleDateString()}
                  </p>
                </Link>
                <button
                  data-testid={`delete-plan-${p.id}`}
                  onClick={(e) => handleDelete(e, p.id)}
                  className="absolute top-3 right-3 p-2 text-zinc-500 hover:text-[#ff3b30] hover:bg-white/5 transition-colors"
                  title="Delete plan"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
