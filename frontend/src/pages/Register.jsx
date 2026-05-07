import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export default function Register() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { register } = useAuth();
  const nav = useNavigate();

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register(name, email, password);
      toast.success("Account created");
      nav("/app/dashboard");
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <Link to="/" className="flex items-center gap-2 mb-10" data-testid="register-brand">
          <div className="w-8 h-8 bg-[#ff3b30] flex items-center justify-center">
            <span className="font-display font-black">K</span>
          </div>
          <span className="font-display font-black uppercase tracking-tight text-xl">Kinetic</span>
        </Link>

        <div className="text-[11px] uppercase tracking-widest text-[#00ff88] font-display font-bold mb-2">
          New athlete
        </div>
        <h1 className="font-display font-black uppercase tracking-tighter text-4xl">
          Create your account
        </h1>
        <p className="text-sm text-zinc-400 mt-2">
          One free account. Four sports. Unlimited sessions.
        </p>

        <form onSubmit={onSubmit} className="mt-10 space-y-5">
          <div>
            <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
              Full name
            </label>
            <input
              data-testid="register-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="mt-2 w-full bg-[#121212] border border-white/10 px-4 py-3 outline-none focus:border-[#ff3b30] transition-colors"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-widest font-display font-bold text-zinc-400">
              Email
            </label>
            <input
              data-testid="register-email"
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
              data-testid="register-password"
              type="password"
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="mt-2 w-full bg-[#121212] border border-white/10 px-4 py-3 outline-none focus:border-[#ff3b30] transition-colors"
            />
            <p className="mt-1.5 text-xs text-zinc-500">Min 6 characters.</p>
          </div>
          <button
            data-testid="register-submit"
            type="submit"
            disabled={loading}
            className="w-full bg-[#ff3b30] hover:bg-[#ff5c53] disabled:opacity-50 text-white font-display uppercase tracking-wide py-3 transition-colors"
          >
            {loading ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="mt-8 text-sm text-zinc-400">
          Have an account?{" "}
          <Link
            to="/login"
            data-testid="link-to-login"
            className="text-[#ff3b30] hover:text-[#ff5c53] font-display uppercase tracking-wide"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
