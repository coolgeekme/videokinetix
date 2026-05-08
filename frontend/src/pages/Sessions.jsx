import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Activity, ArrowRight, Trash2 } from "lucide-react";
import { toast } from "sonner";

const SPORTS = [
  { id: "all", name: "All" },
  { id: "basketball", name: "Basketball" },
  { id: "soccer", name: "Soccer" },
  { id: "swimming", name: "Swimming" },
  { id: "pickleball", name: "Pickleball" },
];

export default function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [athleteId, setAthleteId] = useState("all");
  const [sport, setSport] = useState("all");

  const refresh = () => {
    const params = [];
    if (athleteId !== "all") params.push(`athlete_id=${athleteId}`);
    if (sport !== "all") params.push(`sport=${sport}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return api.get(`/sessions${qs}`).then((r) => setSessions(r.data.sessions));
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
    if (!window.confirm("Delete this session and its training plan?")) return;
    setDeletingId(id);
    try {
      await api.delete(`/sessions/${id}`);
      setSessions((arr) => arr.filter((s) => s.id !== id));
      toast.success("Session deleted");
    } catch {
      toast.error("Failed to delete");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
            Archive
          </div>
          <h1 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl mt-1">
            Sessions
          </h1>
        </div>
        <Link
          to="/app/capture"
          data-testid="sessions-new-capture"
          className="self-start sm:self-auto inline-flex items-center gap-2 bg-[#ff3b30] hover:bg-[#ff5c53] text-white font-display uppercase tracking-wide px-6 py-3 transition-colors"
        >
          New capture <ArrowRight className="w-4 h-4" />
        </Link>
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
      ) : sessions.length === 0 ? (
        <div className="border border-white/10 bg-[#121212] p-12 text-center">
          <Activity className="w-10 h-10 text-zinc-700 mx-auto" strokeWidth={1.5} />
          <p className="mt-4 text-sm text-zinc-400">No sessions for this filter.</p>
        </div>
      ) : (
        <div className="border border-white/10 divide-y divide-white/5 bg-[#121212]">
          {sessions.map((s) => {
            const a = athleteMap[s.athlete_id];
            return (
              <Link
                key={s.id}
                to={`/app/sessions/${s.id}`}
                data-testid={`session-row-${s.id}`}
                className="flex items-center justify-between p-5 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-5">
                  <div
                    className={`font-display font-black text-3xl w-16 ${
                      s.form_score >= 80
                        ? "text-[#00ff88]"
                        : s.form_score >= 60
                          ? "text-[#ffab00]"
                          : "text-[#ff3b30]"
                    }`}
                  >
                    {s.form_score}
                  </div>
                  <div>
                    <div className="font-display uppercase tracking-tight font-bold text-lg capitalize">
                      {s.sport}
                      {a && (
                        <span className="ml-3 text-sm text-zinc-400">
                          · {a.name}
                          {a.is_self && (
                            <span className="ml-1 text-[10px] text-[#ff3b30]">
                              YOU
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 font-mono mt-0.5">
                      {new Date(s.created_at).toLocaleString()} · {s.mode} ·{" "}
                      {Math.round(s.duration_seconds)}s
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    data-testid={`delete-session-${s.id}`}
                    onClick={(e) => handleDelete(e, s.id)}
                    disabled={deletingId === s.id}
                    className="p-2 text-zinc-500 hover:text-[#ff3b30] hover:bg-white/5 transition-colors disabled:opacity-40"
                    title="Delete session"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                  <ArrowRight className="w-5 h-5 text-zinc-500" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
