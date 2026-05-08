import { useEffect, useState } from "react";
import { api, errMsg } from "@/lib/api";
import { Target, Check, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

const SPORTS = ["basketball", "soccer", "swimming", "pickleball"];
const FILTER_SPORTS = [{ id: "all", name: "All" }, ...SPORTS.map((s) => ({ id: s, name: s }))];

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [athletes, setAthletes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [filterAthlete, setFilterAthlete] = useState("all");
  const [filterSport, setFilterSport] = useState("all");
  const [form, setForm] = useState({
    athlete_id: "",
    sport: "basketball",
    title: "",
    target_score: 85,
    target_date: "",
  });

  const refresh = () => {
    const params = [];
    if (filterAthlete !== "all") params.push(`athlete_id=${filterAthlete}`);
    if (filterSport !== "all") params.push(`sport=${filterSport}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return api.get(`/goals${qs}`).then((r) => setGoals(r.data.goals));
  };

  useEffect(() => {
    api.get("/athletes").then((r) => {
      setAthletes(r.data.athletes);
      if (r.data.athletes.length && !form.athlete_id) {
        setForm((f) => ({ ...f, athlete_id: r.data.athletes[0].id }));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterAthlete, filterSport]);

  const create = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.athlete_id) return;
    try {
      await api.post("/goals", {
        ...form,
        target_date: form.target_date || null,
      });
      setForm({
        athlete_id: form.athlete_id,
        sport: "basketball",
        title: "",
        target_score: 85,
        target_date: "",
      });
      setShowForm(false);
      await refresh();
      toast.success("Goal created");
    } catch (err) {
      toast.error(errMsg(err, "Failed to create goal"));
    }
  };

  const toggle = async (g) => {
    await api.patch(`/goals/${g.id}`, {
      completed: !g.completed,
      progress: !g.completed ? 100 : 0,
    });
    refresh();
  };

  const remove = async (g) => {
    if (!window.confirm("Delete this goal?")) return;
    try {
      await api.delete(`/goals/${g.id}`);
      setGoals((arr) => arr.filter((x) => x.id !== g.id));
      toast.success("Goal deleted");
    } catch {
      toast.error("Failed to delete");
    }
  };

  const athleteMap = Object.fromEntries(athletes.map((a) => [a.id, a]));

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
            Targets
          </div>
          <h1 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl mt-1">
            Goals
          </h1>
        </div>
        <button
          data-testid="new-goal-btn"
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-2 bg-[#ff3b30] hover:bg-[#ff5c53] text-white font-display uppercase tracking-wide px-5 py-2.5 transition-colors"
        >
          <Plus className="w-4 h-4" /> New goal
        </button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-widest font-display font-bold text-zinc-500 mb-1">
            Athlete
          </div>
          <select
            data-testid="filter-athlete"
            value={filterAthlete}
            onChange={(e) => setFilterAthlete(e.target.value)}
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
            value={filterSport}
            onChange={(e) => setFilterSport(e.target.value)}
            className="bg-[#121212] border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30] text-sm capitalize"
          >
            {FILTER_SPORTS.map((s) => (
              <option key={s.id} value={s.id} className="capitalize">
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={create}
          data-testid="goal-form"
          className="bg-[#121212] border border-white/10 p-5 space-y-4"
        >
          <div>
            <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
              Title
            </label>
            <input
              data-testid="goal-title"
              type="text"
              maxLength={140}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              className="mt-2 w-full bg-black border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30]"
              placeholder="e.g. Reach 85+ shooting form score"
            />
          </div>
          <div className="grid sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
                Athlete
              </label>
              <select
                data-testid="goal-athlete"
                value={form.athlete_id}
                onChange={(e) => setForm({ ...form, athlete_id: e.target.value })}
                required
                className="mt-2 w-full bg-black border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30]"
              >
                {athletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.is_self ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
                Sport
              </label>
              <select
                data-testid="goal-sport"
                value={form.sport}
                onChange={(e) => setForm({ ...form, sport: e.target.value })}
                className="mt-2 w-full bg-black border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30] capitalize"
              >
                {SPORTS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
                Target score
              </label>
              <input
                data-testid="goal-target-score"
                type="number"
                min={0}
                max={100}
                value={form.target_score}
                onChange={(e) =>
                  setForm({ ...form, target_score: parseInt(e.target.value || 0) })
                }
                className="mt-2 w-full bg-black border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30]"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
                Target date
              </label>
              <input
                data-testid="goal-target-date"
                type="date"
                value={form.target_date}
                onChange={(e) => setForm({ ...form, target_date: e.target.value })}
                className="mt-2 w-full bg-black border border-white/10 px-3 py-2 outline-none focus:border-[#ff3b30]"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              data-testid="goal-submit"
              type="submit"
              className="bg-[#ff3b30] hover:bg-[#ff5c53] text-white font-display uppercase tracking-wide px-5 py-2"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="border border-white/10 hover:bg-white/5 px-5 py-2 font-display uppercase tracking-wide"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : goals.length === 0 ? (
        <div className="border border-white/10 bg-[#121212] p-12 text-center">
          <Target className="w-10 h-10 text-zinc-700 mx-auto" strokeWidth={1.5} />
          <p className="mt-4 text-sm text-zinc-400">No goals match this filter.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-4">
          {goals.map((g) => {
            const a = athleteMap[g.athlete_id];
            return (
              <div
                key={g.id}
                data-testid={`goal-${g.id}`}
                className={`border p-5 transition-colors ${
                  g.completed
                    ? "border-[#00ff88]/40 bg-[#00ff88]/5"
                    : "border-white/10 bg-[#121212]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest font-display font-bold text-zinc-400 capitalize">
                      {a ? `${a.name} · ` : ""}{g.sport} · target {g.target_score}
                    </div>
                    <h3 className="mt-2 font-display font-bold uppercase tracking-tight">
                      {g.title}
                    </h3>
                    {g.target_date && (
                      <div className="mt-1 text-xs font-mono text-zinc-500">
                        by {g.target_date}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      data-testid={`delete-goal-${g.id}`}
                      onClick={() => remove(g)}
                      className="w-8 h-8 border border-white/10 hover:border-[#ff3b30] hover:text-[#ff3b30] text-zinc-400 flex items-center justify-center transition-colors"
                      title="Delete goal"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                    <button
                      data-testid={`toggle-goal-${g.id}`}
                      onClick={() => toggle(g)}
                      className={`w-8 h-8 border flex items-center justify-center transition-colors ${
                        g.completed
                          ? "bg-[#00ff88] border-[#00ff88] text-black"
                          : "border-white/20 hover:border-white/50"
                      }`}
                    >
                      {g.completed && <Check className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
