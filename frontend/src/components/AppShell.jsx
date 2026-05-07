import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { LayoutDashboard, Camera, ListChecks, Target, LogOut, Activity } from "lucide-react";

const NAV = [
  { to: "/app/dashboard", label: "Dashboard", icon: LayoutDashboard, testid: "nav-dashboard" },
  { to: "/app/capture", label: "Capture", icon: Camera, testid: "nav-capture" },
  { to: "/app/sessions", label: "Sessions", icon: Activity, testid: "nav-sessions" },
  { to: "/app/training-plans", label: "Training", icon: ListChecks, testid: "nav-training" },
  { to: "/app/goals", label: "Goals", icon: Target, testid: "nav-goals" },
];

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const handleLogout = () => {
    logout();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header
        data-testid="app-header"
        className="sticky top-0 z-40 backdrop-blur-xl bg-black/70 border-b border-white/10"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/app/dashboard" className="flex items-center gap-2" data-testid="brand-logo">
            <div className="w-8 h-8 bg-[#ff3b30] flex items-center justify-center">
              <span className="font-display font-black text-white text-lg">K</span>
            </div>
            <span className="font-display font-black text-xl tracking-tight uppercase">
              Kinetic
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                data-testid={n.testid}
                className={({ isActive }) =>
                  `px-4 py-2 text-sm font-medium uppercase tracking-wide font-display transition-colors ${
                    isActive
                      ? "text-white border-b-2 border-[#ff3b30]"
                      : "text-zinc-400 hover:text-white"
                  }`
                }
              >
                <span className="inline-flex items-center gap-2">
                  <n.icon className="w-4 h-4" />
                  {n.label}
                </span>
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden sm:block text-sm text-zinc-400" data-testid="user-name">
              {user?.name}
            </span>
            <button
              data-testid="logout-button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 text-sm text-zinc-300 hover:text-white border border-white/10 px-3 py-1.5 transition-colors hover:bg-white/5"
            >
              <LogOut className="w-4 h-4" /> Sign out
            </button>
          </div>
        </div>
        {/* Mobile nav */}
        <nav className="md:hidden border-t border-white/10 overflow-x-auto">
          <div className="flex">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                data-testid={`${n.testid}-mobile`}
                className={({ isActive }) =>
                  `flex-1 px-3 py-3 text-xs font-display uppercase tracking-wide whitespace-nowrap text-center ${
                    isActive ? "text-white border-t-2 border-[#ff3b30]" : "text-zinc-400"
                  }`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </div>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}
