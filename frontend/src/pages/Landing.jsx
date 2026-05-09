import { Link } from "react-router-dom";
import { ArrowRight, Activity, Brain, Target, Trophy, Camera, ChartLine } from "lucide-react";

const HERO_IMG =
  "https://images.unsplash.com/photo-1776935889501-68e5607fa42a?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDQ2MzR8MHwxfHNlYXJjaHwzfHxhdGhsZXRlJTIwcnVubmluZyUyMGRhcmt8ZW58MHx8fHwxNzc4MTUzODc5fDA&ixlib=rb-4.1.0&q=85";
const BBALL =
  "https://images.unsplash.com/photo-1519432473078-0151c4f90335?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxOTJ8MHwxfHNlYXJjaHwzfHxiYXNrZXRiYWxsJTIwcGxheWVyJTIwZGFya3xlbnwwfHx8fDE3NzgxNTM5MDR8MA&ixlib=rb-4.1.0&q=85";
const RUN =
  "https://images.pexels.com/photos/15875672/pexels-photo-15875672.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940";

const SPORTS = ["Basketball", "Soccer", "Swimming", "Pickleball"];

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-black/60 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2" data-testid="landing-logo">
            <div className="w-8 h-8 bg-[#ff3b30] flex items-center justify-center">
              <span className="font-display font-black text-sm">VK</span>
            </div>
            <span className="font-display font-black text-xl uppercase tracking-tight">
              VisionKinetix<span className="text-[#ff3b30]">.ai</span>
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-8 text-sm">
            <a href="#sports" className="text-zinc-400 hover:text-white font-display uppercase tracking-wide" data-testid="nav-sports">Sports</a>
            <a href="#how" className="text-zinc-400 hover:text-white font-display uppercase tracking-wide" data-testid="nav-how">How it works</a>
            <a href="#features" className="text-zinc-400 hover:text-white font-display uppercase tracking-wide" data-testid="nav-features">Features</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link to="/login" data-testid="login-link" className="text-sm text-zinc-300 hover:text-white font-display uppercase tracking-wide">
              Sign in
            </Link>
            <Link
              to="/register"
              data-testid="register-link"
              className="bg-[#ff3b30] hover:bg-[#ff5c53] text-white font-display uppercase tracking-wide text-sm px-5 py-2.5 transition-colors"
            >
              Get started
            </Link>
          </div>
        </div>
      </header>

      {/* HERO */}
      <section className="relative overflow-hidden border-b border-white/10">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${HERO_IMG})` }}
        />
        <div className="absolute inset-0 bg-black/70" />
        <div className="absolute inset-0 grid-bg opacity-30" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-24 sm:py-32 lg:py-40 grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-8 fade-up">
            <div className="inline-flex items-center gap-2 border border-white/15 px-3 py-1 mb-8">
              <span className="w-2 h-2 bg-[#00ff88] pulse-dot rounded-full" />
              <span className="text-[11px] font-display uppercase tracking-[0.25em] font-bold text-zinc-300">
                AI Motion Capture · Live
              </span>
            </div>
            <h1 className="font-display font-black uppercase tracking-tighter text-5xl sm:text-6xl lg:text-8xl leading-[0.9]">
              Train like the
              <br />
              <span className="text-[#ff3b30]">data</span> never lies.
            </h1>
            <p className="mt-8 max-w-xl text-zinc-300 text-base sm:text-lg leading-relaxed">
              VisionKinetix.ai turns your webcam into a motion-capture lab. Get real-time
              biomechanics, AI form analysis, and 7-day training plans engineered
              for your sport — no markers, no studio.
            </p>
            <div className="mt-10 flex flex-wrap gap-3">
              <Link
                to="/register"
                data-testid="hero-cta-primary"
                className="inline-flex items-center gap-2 bg-[#ff3b30] hover:bg-[#ff5c53] text-white font-display uppercase tracking-wide px-7 py-3.5 transition-colors"
              >
                Start training free <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#how"
                data-testid="hero-cta-secondary"
                className="inline-flex items-center gap-2 border border-white/20 hover:bg-white/5 px-7 py-3.5 font-display uppercase tracking-wide transition-colors"
              >
                See it work
              </a>
            </div>

            <div className="mt-14 grid grid-cols-3 max-w-md gap-6">
              {[
                { v: "33", l: "Tracked joints" },
                { v: "4", l: "Sports launched" },
                { v: "<1s", l: "Per-frame latency" },
              ].map((s) => (
                <div key={s.l} className="border-l-2 border-[#ff3b30] pl-3">
                  <div className="font-display font-black text-3xl">{s.v}</div>
                  <div className="text-[11px] uppercase tracking-widest text-zinc-500 font-bold">
                    {s.l}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-4 hidden lg:block">
            <div className="relative h-full min-h-[420px] border border-white/10 bg-[#121212]">
              <img src={RUN} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />
              <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
              <div className="absolute bottom-6 left-6 right-6">
                <div className="text-[11px] uppercase tracking-widest text-[#00ff88] font-display font-bold mb-2">
                  Live form score
                </div>
                <div className="font-display font-black text-7xl leading-none">87</div>
                <div className="mt-3 flex items-center gap-2 text-xs text-zinc-300">
                  <span className="w-2 h-2 bg-[#00ff88] rounded-full" /> +6 vs last session
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Marquee */}
        <div className="relative border-t border-white/10 py-6 overflow-hidden bg-black">
          <div className="flex marquee whitespace-nowrap">
            {Array.from({ length: 6 }).map((_, i) => (
              <span
                key={i}
                className="font-display font-black text-5xl sm:text-7xl uppercase tracking-tighter mx-12 stroke-text"
              >
                Analyze · Perform · Dominate ·
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* SPORTS */}
      <section id="sports" className="py-20 sm:py-28 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12">
          <div className="flex items-end justify-between mb-12">
            <div>
              <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold mb-3">
                Sport-Agnostic
              </div>
              <h2 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl">
                Built for every athlete
              </h2>
            </div>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {SPORTS.map((s, i) => (
              <div
                key={s}
                data-testid={`sport-card-${s.toLowerCase()}`}
                className="relative border border-white/10 bg-[#121212] aspect-[4/5] overflow-hidden group"
              >
                <img
                  src={i === 0 ? BBALL : RUN}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover opacity-40 group-hover:opacity-60 transition-opacity"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-5">
                  <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-display font-bold">
                    0{i + 1}
                  </div>
                  <h3 className="font-display font-black text-2xl uppercase tracking-tight">
                    {s}
                  </h3>
                </div>
                <div className="absolute top-4 right-4 w-3 h-3 border border-[#00ff88]" />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW */}
      <section id="how" className="py-20 sm:py-28 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12">
          <div className="max-w-2xl mb-16">
            <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold mb-3">
              How it works
            </div>
            <h2 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl">
              Three steps. Real results.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-px bg-white/10 border border-white/10">
            {[
              { n: "01", t: "Capture", d: "Stand in front of your webcam. We map 33 joints in real time using markerless motion capture.", I: Camera },
              { n: "02", t: "Analyze", d: "GPT-5.2 compares your biomechanics to elite athlete benchmarks for your sport.", I: Brain },
              { n: "03", t: "Improve", d: "Get a 7-day personalized plan with drills, cues, and milestones tailored to you.", I: Target },
            ].map((step) => (
              <div key={step.n} className="bg-[#0a0a0a] p-8 sm:p-10 hover:bg-[#121212] transition-colors">
                <step.I className="w-7 h-7 text-[#ff3b30]" strokeWidth={1.5} />
                <div className="mt-8 font-display font-black text-6xl text-zinc-700">
                  {step.n}
                </div>
                <h3 className="mt-2 font-display font-black text-2xl uppercase tracking-tight">
                  {step.t}
                </h3>
                <p className="mt-3 text-zinc-400 text-sm leading-relaxed">{step.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="py-20 sm:py-28 border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-5">
            <div className="text-[11px] uppercase tracking-widest text-[#ff3b30] font-display font-bold mb-3">
              The system
            </div>
            <h2 className="font-display font-black uppercase tracking-tighter text-4xl sm:text-5xl">
              Coaching, scaled.
            </h2>
            <p className="mt-6 text-zinc-400 leading-relaxed">
              Every drill, every cue, every milestone — engineered from your own
              motion data. Train smarter than your competition.
            </p>
          </div>
          <div className="lg:col-span-7 grid sm:grid-cols-2 gap-px bg-white/10 border border-white/10">
            {[
              { I: Activity, t: "Live skeleton overlay", d: "33 joints rendered at 30fps with neon-green wireframe." },
              { I: ChartLine, t: "Form score timeline", d: "Track progress per session, per sport, per joint." },
              { I: Brain, t: "AI biomechanics", d: "Strengths, fixes, severity, elite comparison — every session." },
              { I: Trophy, t: "Goals & milestones", d: "Set targets. Hit them. Earn badges. Compete with yourself." },
            ].map((f) => (
              <div key={f.t} className="bg-[#0a0a0a] p-6 sm:p-8 hover:bg-[#121212] transition-colors">
                <f.I className="w-6 h-6 text-[#00ff88]" strokeWidth={1.5} />
                <h3 className="mt-5 font-display font-bold text-lg uppercase tracking-tight">
                  {f.t}
                </h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 sm:py-32 border-b border-white/10 relative overflow-hidden">
        <div className="absolute inset-0 grid-bg opacity-20" />
        <div className="relative max-w-4xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="font-display font-black uppercase tracking-tighter text-5xl sm:text-7xl leading-none">
            Your edge is
            <br />
            <span className="text-[#ff3b30]">one frame</span> away.
          </h2>
          <Link
            to="/register"
            data-testid="cta-bottom-register"
            className="mt-12 inline-flex items-center gap-2 bg-white text-black hover:bg-zinc-200 font-display uppercase tracking-wide px-8 py-4 transition-colors"
          >
            Start free <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>

      <footer className="bg-black py-12 px-4 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-[#ff3b30] flex items-center justify-center">
              <span className="font-display font-black text-xs">VK</span>
            </div>
            <span className="font-display font-black uppercase tracking-tight">
              VisionKinetix<span className="text-[#ff3b30]">.ai</span>
            </span>
          </div>
          <p className="text-xs text-zinc-500 font-mono">
            © 2026 VisionKinetix.ai · Markerless motion capture for athletes
          </p>
        </div>
      </footer>
    </div>
  );
}
