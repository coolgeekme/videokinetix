import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Trophy,
  Flame,
  Users,
  ArrowRight,
  Crown,
} from "lucide-react";

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get("/dashboard/overview")
      .then((r) => setData(r.data))
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
    { l: "Athletes", v: data.total_athletes, I: Users, c: "#007aff" },
    { l: "Sessions", v: data.total_sessions, I: Activity, c: "#00ff88" },
    { l: "Avg score", v: data.average_score, I: Trophy, c: "#ff3b30" },
    { l: "Streak (days)", v: data.streak_days, I: Flame, c: "#ffab00" },
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
              Form score timeline · all athletes
            </h3>
            <span className="text-[11px] uppercase tracking-widest text-zinc-500 font-mono">
              {data.timeline.length} sessions
            </span>
          </div>
          {data.timeline.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.timeline}>
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
                    formatter={(value, _name, item) => [
                      `${value} (${item?.payload?.athlete_name || "—"})`,
                      "score",
                    ]}
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
          {Object.keys(data.by_sport).length === 0 ? (
            <p className="text-sm text-zinc-500">No sessions yet.</p>
          ) : (
            <ul className="space-y-3">
              {Object.entries(data.by_sport).map(([sport, count]) => {
                const max = Math.max(...Object.values(data.by_sport));
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
        </div>
      </div>

      {/* Leaderboard */}
      <div className="bg-[#121212] border border-white/10">
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="font-display font-bold uppercase tracking-tight text-lg flex items-center gap-2">
            <Crown className="w-4 h-4 text-[#ffab00]" /> Athlete leaderboard
          </h3>
          <Link
            to="/app/athletes"
            data-testid="dashboard-manage-athletes"
            className="text-xs uppercase tracking-widest font-display font-bold text-[#ff3b30] hover:text-[#ff5c53]"
          >
            Manage roster →
          </Link>
        </div>
        {data.leaderboard.length === 0 ? (
          <p className="text-sm text-zinc-500 p-5">No athletes yet.</p>
        ) : (
          <div className="divide-y divide-white/5">
            {data.leaderboard.map((row, i) => (
              <Link
                key={row.athlete_id}
                to={`/app/athletes/${row.athlete_id}`}
                data-testid={`leaderboard-row-${row.athlete_id}`}
                className="flex items-center justify-between px-5 py-4 hover:bg-white/5 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <div
                    className={`font-display font-black text-2xl w-8 ${
                      i === 0
                        ? "text-[#ffab00]"
                        : i === 1
                          ? "text-zinc-300"
                          : i === 2
                            ? "text-orange-400"
                            : "text-zinc-600"
                    }`}
                  >
                    {i + 1}
                  </div>
                  <div
                    className={`w-9 h-9 flex items-center justify-center font-display font-black ${
                      row.is_self
                        ? "bg-[#ff3b30] text-white"
                        : "bg-white/5 border border-white/10"
                    }`}
                  >
                    {row.name?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div>
                    <div className="font-display font-bold uppercase tracking-tight">
                      {row.name}
                      {row.is_self && (
                        <span className="ml-2 text-[10px] tracking-widest text-[#ff3b30]">
                          YOU
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-zinc-500 font-mono">
                      {row.sessions} sessions
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div
                    className={`font-display font-black text-2xl ${
                      row.avg_score >= 80
                        ? "text-[#00ff88]"
                        : row.avg_score >= 60
                          ? "text-[#ffab00]"
                          : "text-zinc-500"
                    }`}
                  >
                    {row.avg_score || "—"}
                  </div>
                  <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold">
                    avg · best {row.best_score}
                  </div>
                </div>
              </Link>
            ))}
          </div>
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
