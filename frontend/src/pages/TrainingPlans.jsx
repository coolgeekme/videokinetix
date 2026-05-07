import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Sparkles } from "lucide-react";

export default function TrainingPlans() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/training-plans")
      .then((r) => setPlans(r.data.plans))
      .finally(() => setLoading(false));
  }, []);

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

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : plans.length === 0 ? (
        <div className="border border-white/10 bg-[#121212] p-12 text-center">
          <Sparkles className="w-10 h-10 text-zinc-700 mx-auto" strokeWidth={1.5} />
          <p className="mt-4 text-sm text-zinc-400">
            No plans yet. Generate one from any session analysis.
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
          {plans.map((p) => (
            <Link
              key={p.id}
              to={`/app/sessions/${p.session_id}`}
              data-testid={`plan-card-${p.id}`}
              className="group border border-white/10 bg-[#121212] p-5 hover:border-[#ff3b30] transition-colors"
            >
              <div className="text-[10px] uppercase tracking-widest text-[#ffab00] font-display font-bold">
                {p.sport} · {p.duration_days} days
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
          ))}
        </div>
      )}
    </div>
  );
}
