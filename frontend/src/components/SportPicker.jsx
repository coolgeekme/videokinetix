import { Dribbble, Goal, Waves, Zap } from "lucide-react";

const ICONS = { Dribbble, Goal, Waves, Zap };

export default function SportPicker({ sports, value, onChange }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      {sports.map((s) => {
        const Icon = ICONS[s.icon] || Zap;
        const active = value === s.id;
        return (
          <button
            key={s.id}
            type="button"
            data-testid={`sport-${s.id}`}
            onClick={() => onChange(s.id)}
            className={`relative text-left p-5 border transition-all group ${
              active
                ? "border-[#ff3b30] bg-[#ff3b30]/5"
                : "border-white/10 hover:border-white/30 bg-[#121212]"
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <Icon
                className="w-7 h-7"
                style={{ color: active ? s.color : "#a1a1aa" }}
                strokeWidth={1.5}
              />
              {active && (
                <span
                  className="text-[10px] uppercase tracking-widest font-display font-bold"
                  style={{ color: s.color }}
                >
                  Selected
                </span>
              )}
            </div>
            <h3 className="font-display font-black text-xl uppercase tracking-tight">
              {s.name}
            </h3>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{s.tagline}</p>
            <div
              className="absolute bottom-0 left-0 h-[2px] transition-all duration-300"
              style={{
                width: active ? "100%" : "0%",
                background: s.color,
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
