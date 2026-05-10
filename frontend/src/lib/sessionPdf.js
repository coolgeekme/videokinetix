/**
 * Build a session-analysis PDF programmatically from session data.
 * No html2canvas — uses jsPDF text/rect primitives so the output is crisp,
 * lightweight (~30 KB), and renders identically in any theme.
 */
import { jsPDF } from "jspdf";

const ACCENT = [255, 59, 48];     // brand red
const GREEN = [0, 200, 110];
const AMBER = [240, 160, 0];
const RED = [220, 60, 50];
const TEXT_DARK = [25, 25, 30];
const TEXT_MUTED = [110, 110, 120];
const BORDER = [220, 220, 225];

function scoreColor(score) {
  if (score == null) return TEXT_MUTED;
  if (score >= 80) return GREEN;
  if (score >= 60) return AMBER;
  return RED;
}

function wrap(doc, text, maxWidth) {
  return doc.splitTextToSize(text || "", maxWidth);
}

export function downloadSessionPDF(session, athlete = null) {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 48; // margin
  let y = M;

  const ensureSpace = (need) => {
    if (y + need > H - M) {
      doc.addPage();
      y = M;
    }
  };

  // --- Header ----
  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, W, 6, "F");
  y = M;
  doc.setTextColor(...TEXT_DARK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("VisionKinetix · Session Report", M, y);
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_MUTED);
  const dateStr = session.created_at
    ? new Date(session.created_at).toLocaleString()
    : "";
  const subtitle = [
    session.sport ? session.sport.toUpperCase() : "—",
    athlete?.name || "",
    dateStr,
  ].filter(Boolean).join("  ·  ");
  doc.text(subtitle, M, y);
  y += 8;
  doc.setDrawColor(...BORDER);
  doc.line(M, y, W - M, y);
  y += 22;

  // --- Score block ----
  const score = session.form_score ?? session.pose_summary?.overall_score ?? null;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(46);
  doc.setTextColor(...scoreColor(score));
  doc.text(score != null ? String(score) : "—", M, y + 8);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...TEXT_MUTED);
  doc.text("FORM SCORE", M + 75, y - 4);
  // Stats column
  const reps = session.rep_count ?? 0;
  const dur = Math.round(session.duration_seconds ?? 0);
  const cons = session.consistency ?? "—";
  doc.setTextColor(...TEXT_DARK);
  doc.setFontSize(11);
  doc.text(`Reps detected:  ${reps}`, M + 75, y + 10);
  doc.text(`Duration:       ${dur}s`, M + 75, y + 24);
  doc.text(`Consistency:    ${cons}`, M + 75, y + 38);
  y += 60;

  // --- Notes ----
  if (session.notes) {
    ensureSpace(60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...ACCENT);
    doc.text("SESSION CONTEXT", M, y);
    y += 14;
    doc.setFont("helvetica", "italic");
    doc.setTextColor(...TEXT_DARK);
    doc.setFontSize(11);
    const lines = wrap(doc, `"${session.notes}"`, W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 14 + 12;
  }

  const a = session.analysis || {};

  // --- AI summary ----
  if (a.summary) {
    ensureSpace(60);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...ACCENT);
    doc.text("ANALYSIS SUMMARY", M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT_DARK);
    doc.setFontSize(11);
    const lines = wrap(doc, a.summary, W - 2 * M);
    doc.text(lines, M, y);
    y += lines.length * 14 + 10;
  }

  // --- Strengths ----
  if (Array.isArray(a.strengths) && a.strengths.length) {
    ensureSpace(40 + a.strengths.length * 14);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...GREEN);
    doc.text("STRENGTHS", M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT_DARK);
    doc.setFontSize(11);
    for (const s of a.strengths) {
      const lines = wrap(doc, `+ ${s}`, W - 2 * M);
      ensureSpace(lines.length * 14);
      doc.text(lines, M, y);
      y += lines.length * 14;
    }
    y += 8;
  }

  // --- Improvements ----
  if (Array.isArray(a.improvements) && a.improvements.length) {
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...AMBER);
    doc.text("IMPROVEMENTS", M, y);
    y += 14;
    doc.setFontSize(11);
    doc.setTextColor(...TEXT_DARK);
    for (const imp of a.improvements) {
      const area = imp.area || "Area";
      const issue = imp.issue || "";
      const fix = imp.fix || "";
      const sev = (imp.severity || "").toUpperCase();
      ensureSpace(60);
      doc.setFont("helvetica", "bold");
      doc.text(`• ${area}`, M, y);
      if (sev) {
        const sevColor = sev === "HIGH" ? RED : sev === "MEDIUM" ? AMBER : TEXT_MUTED;
        doc.setTextColor(...sevColor);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.text(sev, M + 200, y);
        doc.setFontSize(11);
        doc.setTextColor(...TEXT_DARK);
      }
      y += 14;
      doc.setFont("helvetica", "normal");
      if (issue) {
        const lines = wrap(doc, issue, W - 2 * M - 12);
        ensureSpace(lines.length * 14);
        doc.text(lines, M + 12, y);
        y += lines.length * 14;
      }
      if (fix) {
        doc.setFont("helvetica", "italic");
        doc.setTextColor(...TEXT_MUTED);
        const lines = wrap(doc, `Fix: ${fix}`, W - 2 * M - 12);
        ensureSpace(lines.length * 14);
        doc.text(lines, M + 12, y);
        y += lines.length * 14 + 4;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...TEXT_DARK);
      }
    }
    y += 6;
  }

  // --- Elite comparison ----
  if (a.elite_comparison) {
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...ACCENT);
    doc.text("ELITE COMPARISON", M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT_DARK);
    doc.setFontSize(11);
    const lines = wrap(doc, a.elite_comparison, W - 2 * M);
    ensureSpace(lines.length * 14);
    doc.text(lines, M, y);
    y += lines.length * 14 + 10;
  }

  // --- Next focus ----
  if (a.next_focus) {
    ensureSpace(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...ACCENT);
    doc.text("NEXT FOCUS", M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT_DARK);
    doc.setFontSize(11);
    const lines = wrap(doc, a.next_focus, W - 2 * M);
    ensureSpace(lines.length * 14);
    doc.text(lines, M, y);
    y += lines.length * 14 + 10;
  }

  // --- Basketball: shooting stats ----
  if (session.sport === "basketball" && session.shot_outcomes) {
    const so = session.shot_outcomes;
    ensureSpace(50);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...ACCENT);
    doc.text("SHOOTING (ball-tracked)", M, y);
    y += 14;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...TEXT_DARK);
    doc.setFontSize(11);
    doc.text(
      `Makes: ${so.makes ?? 0}    Attempts: ${so.attempts ?? 0}    FG%: ${so.fg_pct != null ? so.fg_pct + "%" : "—"}`,
      M, y
    );
    y += 18;
  }

  // --- Pickleball: stroke breakdown ----
  if (session.sport === "pickleball" && session.pickleball_stats) {
    const sb = session.pickleball_stats.stroke_breakdown || {};
    const rp = session.pickleball_stats.ready_position;
    if (Object.keys(sb).length) {
      ensureSpace(50);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...ACCENT);
      doc.text("STROKE BREAKDOWN", M, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      for (const [type, d] of Object.entries(sb)) {
        ensureSpace(14);
        doc.setTextColor(...TEXT_DARK);
        doc.text(`${type.toUpperCase()}`, M, y);
        doc.setTextColor(...TEXT_MUTED);
        doc.text(`${d.count}×`, M + 90, y);
        doc.setTextColor(...scoreColor(d.avg_score));
        doc.text(`${d.avg_score}`, M + 140, y);
        y += 14;
      }
      y += 6;
    }
    if (rp) {
      ensureSpace(30);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...ACCENT);
      doc.text("READY POSITION", M, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(11);
      doc.setTextColor(...TEXT_DARK);
      doc.text(
        `Score: ${rp.ready_score}    Paddle up: ${rp.paddle_up_pct}%    Knee bend: ${rp.knee_bend_avg ?? "—"}°`,
        M, y
      );
      y += 18;
    }
  }

  // --- Training plan summary (if present) ----
  if (session.training_plan?.days?.length) {
    doc.addPage();
    y = M;
    doc.setFillColor(...ACCENT);
    doc.rect(0, 0, W, 6, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...TEXT_DARK);
    doc.text("7-day Training Plan", M, y);
    y += 24;
    doc.setDrawColor(...BORDER);
    doc.line(M, y, W - M, y);
    y += 16;
    for (const d of session.training_plan.days) {
      ensureSpace(50);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(...ACCENT);
      doc.text(`Day ${d.day}: ${d.focus || ""}`, M, y);
      y += 14;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...TEXT_DARK);
      doc.setFontSize(10);
      if (Array.isArray(d.drills)) {
        for (const drill of d.drills) {
          const line = `• ${drill.name || drill.title || drill}${drill.duration ? ` (${drill.duration})` : ""}`;
          const lines = wrap(doc, line, W - 2 * M - 12);
          ensureSpace(lines.length * 12);
          doc.text(lines, M + 12, y);
          y += lines.length * 12;
        }
      }
      y += 8;
    }
  }

  // Footer on every page
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(`visionkinetix.ai · page ${i} of ${total}`, M, H - 24);
  }

  const fname = `vk-${session.sport || "session"}-${(session.id || "").slice(0, 8)}.pdf`;
  doc.save(fname);
}
