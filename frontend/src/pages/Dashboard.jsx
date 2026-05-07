import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Activity, Trophy, Flame, Target, ArrowRight } from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [recent, setRecent] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get("/dashboard/stats"), api.get("/sessions")])
      .then(([s, r]) => {
        setStats(s.data);
        setRecent(r.data.sessions.slice(0, 5));
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-zinc-500 font-display uppercase tracking-widest text-sm">
        Loading…
      </div>
    );
  }

  const cards = [
    { l: "Sessions", v: stats.total_sessions, I: Activity, c: "#00ff88" },
    { l: "Avg score", v: stats.average_score, I: Trophy, c: "#ff3b30" },
    { l: "Best", v: stats.best_score, I: Trophy, c: "#ffab00" },
    { l: "Streak (days)", v: stats.streak_days, I: Flame, c: "#007aff" },
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold">
            Command center
          </div>
          <h1 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl mt-1">
            Welcome, {user?.name?.split(" ")[0]}
          </h1>
        </div>
        <Link
          to="/app/capture"
          data-testid="dashboard-new-session"
          className="self-start sm:self-auto inline-flex items-center gap-2 bg-[#ff3b30] hover:bg-[#ff5c53] text-white font-display uppercase tracking-wide px-6 py-3 transition-colors"
        >
          New capture <ArrowRight className="w-4 h-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div
            key={c.l}
            data-testid={`stat-${c.l.toLowerCase().replace(/\s/g, "-")}`}
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

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-[#121212] border border-white/10 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display font-bold uppercase tracking-tight text-lg">
              Form score timeline
            </h3>
            <span className="text-[11px] uppercase tracking-widest text-zinc-500 font-mono">
              Last {stats.timeline.length} sessions
            </span>
          </div>
          {stats.timeline.length === 0 ? (
            <EmptyChart />
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

        <div className="bg-[#121212] border border-white/10 p-5">
          <h3 className="font-display font-bold uppercase tracking-tight text-lg mb-4">
            By sport
          </h3>
          {Object.keys(stats.by_sport).length === 0 ? (
            <p className="text-sm text-zinc-500">No sessions yet.</p>
          ) : (
            <ul className="space-y-3">
              {Object.entries(stats.by_sport).map(([sport, count]) => {
                const max = Math.max(...Object.values(stats.by_sport));
                const pct = (count / max) * 100;
                return (
                  <li key={sport}>
                    <div className="flex justify-between text-sm">
                      <span className="capitalize font-display uppercase tracking-wide text-zinc-300">
                        {sport}
                      </span>
                      <span className="font-mono text-zinc-400">{count}</span>
                    </div>
                    <div className="mt-1 h-1 bg-white/5">
                      <div
                        className="h-full bg-[#ff3b30]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-6 border-t border-white/10 pt-5">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
              <Target className="w-4 h-4 text-[#00ff88]" />
              Goals
            </div>
            <div className="mt-2 font-mono text-sm text-zinc-300">
              {stats.goals_completed} / {stats.goals_total} completed
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#121212] border border-white/10 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold uppercase tracking-tight text-lg">
            Recent sessions
          </h3>
          <Link
            to="/app/sessions"
            data-testid="view-all-sessions"
            className="text-xs uppercase tracking-widest font-display font-bold text-[#ff3b30] hover:text-[#ff5c53]"
          >
            View all →
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No sessions yet —{" "}
            <Link to="/app/capture" className="text-[#ff3b30]">
              start your first capture
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y divide-white/5">
            {recent.map((s) => (
              <li key={s.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="font-display uppercase tracking-tight font-bold">
                    {s.sport}
                  </div>
                  <div className="text-xs text-zinc-500 font-mono">
                    {new Date(s.created_at).toLocaleString()}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span
                    className={`font-display font-black text-2xl ${
                      s.form_score >= 80
                        ? "text-[#00ff88]"
                        : s.form_score >= 60
                          ? "text-[#ffab00]"
                          : "text-[#ff3b30]"
                    }`}
                  >
                    {s.form_score}
                  </span>
                  <Link
                    to={`/app/sessions/${s.id}`}
                    data-testid={`view-session-${s.id}`}
                    className="text-xs uppercase font-display tracking-widest font-bold text-zinc-300 hover:text-white border border-white/10 px-3 py-1.5 transition-colors hover:bg-white/5"
                  >
                    View
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-72 flex flex-col items-center justify-center text-center">
      <div className="text-[11px] uppercase tracking-widest text-zinc-600 font-display font-bold">
        Awaiting first capture
      </div>
      <Link
        to="/app/capture"
        className="mt-4 text-[#ff3b30] hover:text-[#ff5c53] font-display uppercase tracking-wide"
      >
        Start now →
      </Link>
    </div>
  );
}
