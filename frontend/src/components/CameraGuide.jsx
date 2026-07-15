/**
 * Sport-specific + mode-specific camera setup guidance.
 * Renders an inline SVG diagram + an expandable bullet-tips accordion above
 * the PoseCanvas so users know how to frame their shot.
 */
import { useState } from "react";
import { Camera, ChevronDown } from "lucide-react";

const CAMERA_GUIDES = {
  basketball: {
    label: "Basketball",
    headline: "Side-on at 45° · full body + hoop in frame",
    live_tips: [
      "Phone in landscape, 8-12 ft from the athlete (side-on, slightly angled).",
      "Athlete + hoop both visible — for make/miss tracking, the rim must be clearly in frame.",
      "Camera height: chest-to-shoulder of the athlete. Avoid filming from above (skews shooting elbow angle).",
      "Even lighting — avoid backlight from an open gym door.",
      "Athlete in dark clothing on a light background works best for pose tracking.",
    ],
    upload_tips: [
      "Trim out warmup and dribbling — keep the camera mostly still during shots.",
      "Submit clips with 5-15 shooting reps for best analysis confidence.",
      "Avoid heavily edited / multi-cut TikTok-style footage — single continuous angle works best.",
    ],
  },
  pickleball: {
    label: "Pickleball",
    headline: "Court-side or behind baseline · full court in frame",
    live_tips: [
      "For SOLO practice: side-on at the kitchen line, 6-10 ft away, athlete's full body in frame.",
      "For DOUBLES match: place camera court-side, 6-8 ft up, all 4 players visible at once.",
      "Behind-baseline shots also work for dink drills — captures contact point well.",
      "If recording a wall drill, position camera at 45° so we see both arm extension AND paddle path.",
      "Wear a contrasting shirt vs. the court color — helps pose tracking lock on.",
    ],
    upload_tips: [
      "10-30 seconds of continuous rallies is the sweet spot.",
      "Avoid clips where the athlete walks off-camera for >1 second.",
      "Note the drill in the Session Context field — \"third-shot drops\" gets a very different analysis than \"open-play rally\".",
    ],
  },
  soccer: {
    label: "Soccer",
    headline: "Side-on for shooting form · behind goalkeeper for shot evaluation",
    live_tips: [
      "Shooting drill: side-on at 8-12 ft, plant-foot side, full body in frame.",
      "Penalty / free-kick analysis: place camera 6-8 ft behind the ball, slightly elevated.",
      "Goalkeeper drills: side-on for diving form; from above for positioning.",
      "Keep the camera still — don't pan with the ball during the shot.",
    ],
    upload_tips: [
      "Single-take clips work best. Don't stitch multiple shooting angles.",
      "Trim out ball retrieval between shots.",
    ],
  },
  swimming: {
    label: "Swimming",
    headline: "Side-on preferred · underwater approach works when swimmer is close",
    live_tips: [
      "For underwater head-on capture, keep the camera fully submerged and aim slightly down to avoid surface reflections.",
      "Wait until the swimmer's shoulders and hips are clearly recognizable before starting capture.",
      "For stroke biomechanics, a side-on underwater or pool-deck view remains the most accurate angle.",
      "Keep the camera fixed; bubbles and rapid panning reduce pose confidence.",
    ],
    upload_tips: [
      "30-60 seconds of swim is enough — 4-8 stroke cycles.",
      "Trim out turns at the wall (we don't analyze those yet).",
      "For head-on underwater clips, trim the distant approach where the swimmer is only a few pixels tall.",
      "Surface reflections can resemble another person; fully submerged, slightly downward-facing footage tracks best.",
    ],
  },
};

export default function CameraGuide({ sport, mode }) {
  const [open, setOpen] = useState(false);
  const guide = CAMERA_GUIDES[sport];
  if (!guide) return null;
  const tips = mode === "upload" ? guide.upload_tips : guide.live_tips;
  return (
    <div
      data-testid="camera-guide"
      className="border border-white/10 bg-[#0f0f0f]"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <Camera className="w-4 h-4 text-[#00e5ff] flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-[#00e5ff] font-display font-bold">
            Camera setup · {guide.label.toLowerCase()}
          </div>
          <div className="text-sm text-white font-display font-bold truncate">
            {guide.headline}
          </div>
        </div>
        <button
          type="button"
          data-testid="camera-guide-toggle"
          onClick={() => setOpen((o) => !o)}
          className="text-[10px] uppercase tracking-widest font-display font-bold text-zinc-400 hover:text-white inline-flex items-center gap-1 transition-colors"
        >
          {open ? "Hide" : "Show tips"}
          <ChevronDown
            className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open && (
        <div className="border-t border-white/5 px-4 py-3 grid md:grid-cols-2 gap-4">
          {/* Inline diagram */}
          <SportDiagram sport={sport} />
          {/* Tips list */}
          <div>
            <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-display font-bold mb-2">
              {mode === "upload" ? "Upload tips" : "Live capture tips"}
            </div>
            <ul className="space-y-1.5 text-xs text-zinc-300 leading-relaxed">
              {tips.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[#00e5ff] flex-shrink-0">·</span>
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function SportDiagram({ sport }) {
  // Each diagram shows the ideal camera placement as a top-down or side
  // schematic. Pure SVG, no external assets.
  const cls = "w-full h-auto bg-black/40";
  if (sport === "basketball") {
    return (
      <svg viewBox="0 0 200 120" className={cls}>
        {/* Hoop */}
        <line x1="20" y1="20" x2="20" y2="55" stroke="#666" strokeWidth="1.5" />
        <line x1="15" y1="30" x2="35" y2="30" stroke="#ff8c00" strokeWidth="2" />
        <text x="40" y="33" fill="#ff8c00" fontSize="7" fontFamily="monospace">HOOP</text>
        {/* Athlete */}
        <circle cx="100" cy="55" r="4" fill="#fff" />
        <line x1="100" y1="59" x2="100" y2="80" stroke="#fff" strokeWidth="1.5" />
        <line x1="100" y1="80" x2="92" y2="100" stroke="#fff" strokeWidth="1.5" />
        <line x1="100" y1="80" x2="108" y2="100" stroke="#fff" strokeWidth="1.5" />
        <line x1="100" y1="68" x2="112" y2="62" stroke="#fff" strokeWidth="1.5" />
        <text x="92" y="115" fill="#fff" fontSize="7" fontFamily="monospace">athlete</text>
        {/* Camera */}
        <rect x="160" y="56" width="14" height="10" stroke="#00e5ff" fill="none" strokeWidth="1.5" />
        <circle cx="167" cy="61" r="2" fill="#00e5ff" />
        <text x="155" y="80" fill="#00e5ff" fontSize="7" fontFamily="monospace">camera</text>
        {/* Angle line */}
        <line x1="160" y1="61" x2="105" y2="59" stroke="#00e5ff" strokeDasharray="3,3" strokeWidth="1" />
        <text x="125" y="50" fill="#00e5ff" fontSize="6" fontFamily="monospace">side-on · ~45°</text>
      </svg>
    );
  }
  if (sport === "pickleball") {
    return (
      <svg viewBox="0 0 200 120" className={cls}>
        {/* Court (top-down) */}
        <rect x="35" y="25" width="130" height="70" stroke="#666" fill="none" strokeWidth="1.5" />
        <line x1="100" y1="25" x2="100" y2="95" stroke="#666" strokeWidth="1" />
        <rect x="78" y="46" width="44" height="28" stroke="#666" fill="none" strokeDasharray="2,2" strokeWidth="1" />
        <text x="82" y="63" fill="#666" fontSize="6" fontFamily="monospace">kitchen</text>
        {/* Players */}
        <circle cx="55" cy="40" r="3" fill="#ff3b30" />
        <circle cx="55" cy="80" r="3" fill="#00e5ff" />
        <circle cx="145" cy="40" r="3" fill="#ffd166" />
        <circle cx="145" cy="80" r="3" fill="#00ff88" />
        {/* Camera */}
        <rect x="92" y="103" width="16" height="11" stroke="#00e5ff" fill="none" strokeWidth="1.5" />
        <circle cx="100" cy="109" r="2" fill="#00e5ff" />
        <text x="78" y="118" fill="#00e5ff" fontSize="7" fontFamily="monospace">camera · court-side</text>
        {/* View cone */}
        <line x1="100" y1="103" x2="40" y2="30" stroke="#00e5ff" strokeDasharray="2,2" strokeWidth="0.7" />
        <line x1="100" y1="103" x2="160" y2="30" stroke="#00e5ff" strokeDasharray="2,2" strokeWidth="0.7" />
      </svg>
    );
  }
  if (sport === "soccer") {
    return (
      <svg viewBox="0 0 200 120" className={cls}>
        {/* Goal */}
        <rect x="15" y="35" width="6" height="40" stroke="#666" fill="none" strokeWidth="1.5" />
        <text x="2" y="85" fill="#666" fontSize="7" fontFamily="monospace">goal</text>
        {/* Ball */}
        <circle cx="80" cy="55" r="3" fill="#fff" />
        <text x="74" y="70" fill="#fff" fontSize="7" fontFamily="monospace">ball</text>
        {/* Athlete */}
        <circle cx="100" cy="55" r="4" fill="#fff" />
        <line x1="100" y1="59" x2="100" y2="80" stroke="#fff" strokeWidth="1.5" />
        <line x1="100" y1="80" x2="92" y2="100" stroke="#fff" strokeWidth="1.5" />
        <line x1="100" y1="80" x2="108" y2="100" stroke="#fff" strokeWidth="1.5" />
        {/* Camera (side-on) */}
        <rect x="155" y="56" width="14" height="10" stroke="#00e5ff" fill="none" strokeWidth="1.5" />
        <circle cx="162" cy="61" r="2" fill="#00e5ff" />
        <text x="150" y="80" fill="#00e5ff" fontSize="7" fontFamily="monospace">camera · side-on</text>
        <line x1="155" y1="61" x2="104" y2="60" stroke="#00e5ff" strokeDasharray="3,3" strokeWidth="1" />
      </svg>
    );
  }
  if (sport === "swimming") {
    return (
      <svg viewBox="0 0 200 120" className={cls}>
        {/* Pool */}
        <rect x="10" y="40" width="180" height="50" stroke="#00e5ff" fill="none" strokeWidth="1.5" strokeDasharray="0" />
        <path d="M 10 65 Q 50 60, 100 65 T 190 65" stroke="#00e5ff44" strokeWidth="1" fill="none" />
        {/* Swimmer */}
        <ellipse cx="100" cy="65" rx="14" ry="4" fill="#fff" />
        <text x="89" y="80" fill="#fff" fontSize="7" fontFamily="monospace">swimmer</text>
        {/* Camera on deck */}
        <rect x="92" y="22" width="16" height="11" stroke="#00e5ff" fill="none" strokeWidth="1.5" />
        <circle cx="100" cy="28" r="2" fill="#00e5ff" />
        <text x="74" y="18" fill="#00e5ff" fontSize="7" fontFamily="monospace">camera · pool deck</text>
        <line x1="100" y1="33" x2="100" y2="62" stroke="#00e5ff" strokeDasharray="2,2" strokeWidth="0.8" />
        {/* Deck */}
        <line x1="0" y1="40" x2="200" y2="40" stroke="#666" strokeWidth="1" />
      </svg>
    );
  }
  return null;
}
