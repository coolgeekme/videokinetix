import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { errMsg } from "@/lib/api";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const nav = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      toast.success("Welcome back");
      nav("/app/dashboard");
    } catch (err) {
      toast.error(errMsg(err, "Login failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white grid lg:grid-cols-2">
      <div className="hidden lg:block relative overflow-hidden border-r border-white/10">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "url('https://images.unsplash.com/photo-1776935889501-68e5607fa42a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwzfHxhdGhsZXRlJTIwcnVubmluZyUyMGRhcmt8ZW58MHx8fHwxNzc4MTUzODc5fDA&ixlib=rb-4.1.0&q=85')",
          }}
        />
        <div className="absolute inset-0 bg-black/70 grid-bg opacity-90" />
        <div className="relative h-full flex flex-col justify-between p-12">
          <Link to="/" className="flex items-center gap-2" data-testid="login-brand">
            <div className="w-8 h-8 bg-[#ff3b30] flex items-center justify-center">
              <span className="font-display font-black text-white">K</span>
            </div>
            <span className="font-display font-black uppercase tracking-tight text-xl">
              Kinetic
            </span>
          </Link>
          <div>
            <div className="text-[11px] uppercase tracking-widest text-[#00ff88] font-display font-bold mb-3">
              Athlete Login
            </div>
            <h2 className="font-display font-black uppercase tracking-tighter text-5xl">
              Train like the data never lies.
            </h2>
          </div>
          <p className="text-xs font-mono text-zinc-500">v1.0 · markerless · 33 joints</p>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm">
          <Link to="/" className="lg:hidden flex items-center gap-2 mb-8" data-testid="login-brand-mobile">
            <div className="w-8 h-8 bg-[#ff3b30] flex items-center justify-center">
              <span className="font-display font-black">K</span>
            </div>
            <span className="font-display font-black uppercase">Kinetic</span>
          </Link>

          <h1 className="font-display font-black uppercase tracking-tight text-3xl">
            Sign in
          </h1>
          <p className="text-sm text-zinc-400 mt-2">Welcome back, athlete.</p>

          <form onSubmit={onSubmit} className="mt-10 space-y-5">
            <div>
              <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
                Email
              </label>
              <input
                data-testid="login-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="mt-2 w-full bg-[#121212] border border-white/10 px-4 py-3 outline-none focus:border-[#ff3b30] transition-colors"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
                Password
              </label>
              <input
                data-testid="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="mt-2 w-full bg-[#121212] border border-white/10 px-4 py-3 outline-none focus:border-[#ff3b30] transition-colors"
              />
            </div>
            <button
              data-testid="login-submit"
              type="submit"
              disabled={loading}
              className="w-full bg-[#ff3b30] hover:bg-[#ff5c53] disabled:opacity-50 text-white font-display uppercase tracking-wide py-3 transition-colors"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-8 text-sm text-zinc-400">
            New here?{" "}
            <Link
              to="/register"
              data-testid="link-to-register"
              className="text-[#ff3b30] hover:text-[#ff5c53] font-display uppercase tracking-wide"
            >
              Create account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
