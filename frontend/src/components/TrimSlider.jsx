import { useEffect, useRef, useState } from "react";
import { Scissors } from "lucide-react";

function fmt(s) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

/**
 * Dual-handle trim slider for upload mode. Reports a [start, end] window in seconds.
 * Lets the user scrub within the window by clicking on the bar (sets the video's
 * currentTime so the pose model runs detection on the chosen frame).
 */
export default function TrimSlider({ duration, value, onChange, onScrubTo }) {
  const [start, end] = value;
  const ref = useRef(null);
  const [dragging, setDragging] = useState(null); // 'start' | 'end' | null

  const pctStart = duration > 0 ? (start / duration) * 100 : 0;
  const pctEnd = duration > 0 ? (end / duration) * 100 : 100;

  useEffect(() => {
    if (!dragging) return;
    const move = (clientX) => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const t = ((clientX - rect.left) / rect.width) * duration;
      const clamped = Math.max(0, Math.min(duration, t));
      if (dragging === "start") {
        const newStart = Math.min(clamped, end - 0.2);
        onChange([Math.max(0, newStart), end]);
        if (onScrubTo) onScrubTo(Math.max(0, newStart));
      } else if (dragging === "end") {
        const newEnd = Math.max(clamped, start + 0.2);
        onChange([start, Math.min(duration, newEnd)]);
        if (onScrubTo) onScrubTo(Math.min(duration, newEnd));
      }
    };
    const onMouseMove = (e) => move(e.clientX);
    const onTouchMove = (e) => move(e.touches[0]?.clientX ?? 0);
    const stop = () => setDragging(null);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("touchmove", onTouchMove);
    window.addEventListener("mouseup", stop);
    window.addEventListener("touchend", stop);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("mouseup", stop);
      window.removeEventListener("touchend", stop);
    };
  }, [dragging, duration, end, start, onChange, onScrubTo]);

  const onBarClick = (e) => {
    if (dragging) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const t = ((e.clientX - rect.left) / rect.width) * duration;
    if (onScrubTo) onScrubTo(Math.max(0, Math.min(duration, t)));
  };

  if (!Number.isFinite(duration) || duration <= 0) return null;

  return (
    <div className="bg-[#121212] border border-white/10 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] uppercase tracking-widest font-display font-bold text-zinc-400 inline-flex items-center gap-1.5">
          <Scissors className="w-3 h-3" /> Analysis window
        </div>
        <div className="text-xs font-mono text-zinc-300">
          {fmt(start)} → {fmt(end)}{" "}
          <span className="text-zinc-500">({fmt(end - start)})</span>
        </div>
      </div>
      <div
        ref={ref}
        data-testid="trim-slider"
        className="relative h-10 bg-black/60 border border-white/10 cursor-pointer"
        onClick={onBarClick}
      >
        {/* selected window */}
        <div
          className="absolute top-0 bottom-0 bg-[#ff3b30]/20 border-l border-r border-[#ff3b30]"
          style={{ left: `${pctStart}%`, width: `${pctEnd - pctStart}%` }}
        />
        {/* start handle */}
        <button
          type="button"
          aria-label="Trim start"
          data-testid="trim-handle-start"
          onMouseDown={(e) => {
            e.stopPropagation();
            setDragging("start");
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            setDragging("start");
          }}
          className="absolute top-0 bottom-0 w-3 bg-[#ff3b30] hover:bg-[#ff5c53] cursor-ew-resize -translate-x-1/2"
          style={{ left: `${pctStart}%` }}
        />
        {/* end handle */}
        <button
          type="button"
          aria-label="Trim end"
          data-testid="trim-handle-end"
          onMouseDown={(e) => {
            e.stopPropagation();
            setDragging("end");
          }}
          onTouchStart={(e) => {
            e.stopPropagation();
            setDragging("end");
          }}
          className="absolute top-0 bottom-0 w-3 bg-[#ff3b30] hover:bg-[#ff5c53] cursor-ew-resize -translate-x-1/2"
          style={{ left: `${pctEnd}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-2 text-[10px] font-mono text-zinc-500">
        <span>0:00</span>
        <span>{fmt(duration)}</span>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Drag the red handles to set when analysis starts and stops. Click anywhere
        on the bar to jump to that moment so you can pick the right athlete.
      </p>
    </div>
  );
}
