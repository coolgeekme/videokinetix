import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import {
  ChevronLeft,
  Activity,
  Trophy,
  Flame,
  ArrowRight,
  Sparkles,
  Target,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SPORTS = [
  { id: "all", name: "All sports", color: "#a1a1aa" },
  { id: "basketball", name: "Basketball", color: "#FF6B35" },
  { id: "soccer", name: "Soccer", color: "#00FF88" },
  { id: "swimming", name: "Swimming", color: "#007AFF" },
  { id: "pickleball", name: "Pickleball", color: "#FFAB00" },
];

export default function AthleteDetail() {
  const { id } = useParams();
  const [athlete, setAthlete] = useState(null);
  const [stats, setStats] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [plans, setPlans] = useState([]);
  const [goals, setGoals] = useState([]);
  const [sport, setSport] = useState("all");
  const [loading, setLoading] = useState(true);

  const sportParam = sport === "all" ? "" : `&sport=${sport}`;

  const load = async () => {
    const [aRes, statsRes, sessRes, planRes, goalRes] = await Promise.all([
      api.get(`/athletes/${id}`),
      api.get(
        `/athletes/${id}/stats${sport === "all" ? "" : `?sport=${sport}`}`
      ),
      api.get(`/sessions?athlete_id=${id}${sportParam}`),
      api.get(`/training-plans?athlete_id=${id}${sportParam}`),
      api.get(`/goals?athlete_id=${id}${sportParam}`),
    ]);
    setAthlete(aRes.data);
    setStats(statsRes.data);
    setSessions(sessRes.data.sessions);
    setPlans(planRes.data.plans);
    setGoals(goalRes.data.goals);
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, sport]);

  const cards = useMemo(
    () => [
      { l: "Sessions", v: stats?.total_sessions ?? 0, I: Activity, c: "#00ff88" },
      { l: "Avg score", v: stats?.average_score ?? 0, I: Trophy, c: "#ff3b30" },
      { l: "Best", v: stats?.best_score ?? 0, I: Trophy, c: "#ffab00" },
      { l: "Streak (days)", v: stats?.streak_days ?? 0, I: Flame, c: "#007aff" },
    ],
    [stats]
  );

  if (loading || !athlete)
    return <p className="text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="space-y-8">
      <Link
        to="/app/athletes"
        data-testid="back-athletes"
        className="inline-flex items-center gap-1 text-xs uppercase tracking-widest font-display font-bold text-zinc-400 hover:text-white"
      >
        <ChevronLeft className="w-4 h-4" /> All athletes
      </Link>

      <div className="flex flex-col lg:flex-row gap-6 lg:items-end lg:justify-between">
        <div className="flex items-center gap-5">
          <div
            className={`w-16 h-16 flex items-center justify-center font-display font-black text-3xl ${
              athlete.is_self ? "bg-[#ff3b30] text-white" : "bg-white/5 text-white border border-white/10"
            }`}
          >
            {athlete.name?.[0]?.toUpperCase()}
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
              {athlete.is_self ? "Your profile" : "Athlete"}
            </div>
            <h1 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl mt-1 leading-none">
              {athlete.name}
            </h1>
            <div className="mt-2 text-sm text-zinc-400 flex flex-wrap gap-3">
              {athlete.age && <span>{athlete.age} years</span>}
              {athlete.primary_sport && (
                <span className="capitalize">· {athlete.primary_sport}</span>
              )}
            </div>
          </div>
        </div>
        <Link
          to={`/app/capture?athlete=${id}${
            athlete.primary_sport ? `&sport=${athlete.primary_sport}` : ""
          }`}
          data-testid="athlete-new-capture"
          className="self-start lg:self-auto inline-flex items-center gap-2 bg-[#ff3b30] hover:bg-[#ff5c53] text-white font-display uppercase tracking-wide px-6 py-3 transition-colors"
        >
          New capture <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      {athlete.notes && (
        <div className="bg-[#121212] border border-white/10 p-4">
          <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold">
            Notes
          </div>
          <p className="mt-1 text-sm text-zinc-300 whitespace-pre-line">
            {athlete.notes}
          </p>
        </div>
      )}

      {/* Sport tabs */}
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {SPORTS.map((s) => (
          <button
            key={s.id}
            data-testid={`sport-tab-${s.id}`}
            onClick={() => setSport(s.id)}
            className={`px-4 py-2 text-sm font-display uppercase tracking-wide transition-colors ${
              sport === s.id
                ? "bg-white text-black"
                : "bg-transparent text-zinc-400 hover:text-white border border-white/10 hover:bg-white/5"
            }`}
            style={
              sport === s.id && s.id !== "all"
                ? { background: s.color, color: "#000" }
                : undefined
            }
          >
            {s.name}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div
            key={c.l}
            data-testid={`athlete-stat-${c.l.toLowerCase().replace(/\s/g, "-")}`}
            className="bg-[#121212] border border-white/10 p-5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
                {c.l}
              </span>
              <c.I className="w-4 h-4" style={{ color: c.c }} strokeWidth={1.5} />
            </div>
            <div className="font-display font-black text-4xl mt-3">{c.v}</div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-[#121212] border border-white/10 p-5">
        <h3 className="font-display font-bold uppercase tracking-tight text-lg mb-4">
          Form score timeline
        </h3>
        {!stats?.timeline?.length ? (
          <p className="text-sm text-zinc-500">No sessions yet for this filter.</p>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.timeline}>
                <CartesianGrid stroke="#1f1f1f" />
                <XAxis dataKey="date" stroke="#52525b" fontSize={11} />
                <YAxis domain={[0, 100]} stroke="#52525b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: "#0a0a0a",
                    border: "1px solid #27272a",
                    borderRadius: 0,
                  }}
                  labelStyle={{ color: "#fff" }}
                />
                <Line
                  type="monotone"
                  dataKey="score"
                  stroke="#00ff88"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "#ff3b30" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Sessions list */}
      <Section
        title="Sessions"
        empty="No sessions yet."
        items={sessions}
        renderItem={(s) => (
          <Link
            key={s.id}
            to={`/app/sessions/${s.id}`}
            data-testid={`athlete-session-${s.id}`}
            className="flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-4">
              <div
                className={`font-display font-black text-2xl w-12 ${
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
                <div className="font-display uppercase tracking-tight font-bold capitalize">
                  {s.sport}
                </div>
                <div className="text-xs text-zinc-500 font-mono">
                  {new Date(s.created_at).toLocaleString()} · {s.mode}
                </div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-zinc-500" />
          </Link>
        )}
      />

      <div className="grid lg:grid-cols-2 gap-6">
        <Section
          title="Training plans"
          empty="No plans yet."
          icon={Sparkles}
          items={plans}
          renderItem={(p) => (
            <Link
              key={p.id}
              to={`/app/sessions/${p.session_id}`}
              data-testid={`athlete-plan-${p.id}`}
              className="block p-4 hover:bg-white/5 transition-colors"
            >
              <div className="text-[10px] uppercase tracking-widest text-[#ffab00] font-display font-bold capitalize">
                {p.sport} · {p.duration_days} days
              </div>
              <div className="mt-1 font-display font-bold uppercase tracking-tight">
                {p.title}
              </div>
              <div className="text-xs text-zinc-500 font-mono mt-1">
                {new Date(p.created_at).toLocaleDateString()}
              </div>
            </Link>
          )}
        />
        <Section
          title="Goals"
          empty="No goals yet."
          icon={Target}
          items={goals}
          renderItem={(g) => (
            <div
              key={g.id}
              data-testid={`athlete-goal-${g.id}`}
              className={`p-4 ${
                g.completed ? "bg-[#00ff88]/5" : ""
              }`}
            >
              <div className="text-[10px] uppercase tracking-widest font-display font-bold text-zinc-400 capitalize">
                {g.sport} · target {g.target_score}
              </div>
              <div className="mt-1 font-display font-bold uppercase tracking-tight">
                {g.title}
              </div>
              {g.completed && (
                <div className="mt-1 text-[10px] uppercase tracking-widest text-[#00ff88] font-display font-bold">
                  ✓ Completed
                </div>
              )}
            </div>
          )}
        />
      </div>
    </div>
  );
}

function Section({ title, empty, items, renderItem, icon: Icon }) {
  return (
    <div className="bg-[#121212] border border-white/10">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <h3 className="font-display font-bold uppercase tracking-tight text-lg flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-zinc-400" strokeWidth={1.5} />}
          {title}
        </h3>
        <span className="text-xs font-mono text-zinc-500">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500 p-5">{empty}</p>
      ) : (
        <div className="divide-y divide-white/5">{items.map(renderItem)}</div>
      )}
    </div>
  );
}
