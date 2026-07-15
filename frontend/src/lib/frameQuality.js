/**
 * Frame quality assessment from MediaPipe pose landmarks.
 * Used by PoseCanvas + MultiPlayerPoseCanvas to show a live green/yellow/red
 * "Frame quality" badge so users can self-correct camera framing in real time.
 *
 * Returns: {
 *   level: 'good' | 'fair' | 'poor',
 *   issues: string[]    // ordered by severity, top 1-2 shown to user
 * }
 */
export function assessFrameQuality(poses, { sport } = {}) {
  if (!poses || poses.length === 0) {
    return { level: "poor", issues: ["No athlete detected — step into frame"] };
  }
  const primary = poses[0];
  const issues = [];

  // 1) Full-body visibility — feet (27/28) AND head (0) must be present + visible
  const head = primary[0];
  const ankleL = primary[27];
  const ankleR = primary[28];
  const headVis = (head?.visibility ?? 0) > 0.5;
  const feetVis =
    (ankleL?.visibility ?? 0) > 0.4 || (ankleR?.visibility ?? 0) > 0.4;
  if (!headVis) issues.push("Head out of frame — tilt camera up");
  if (!feetVis) issues.push("Feet not visible — step back or pan down");

  // 2) Average landmark confidence
  let visSum = 0;
  let visN = 0;
  for (const p of primary) {
    if (p?.visibility != null) {
      visSum += p.visibility;
      visN += 1;
    }
  }
  const avgVis = visN ? visSum / visN : 0;
  if (avgVis < 0.4) issues.push("Low pose confidence — improve lighting");

  // 3) Athlete too small in frame. Modern 1080p+ uploads can still provide
  // useful landmarks at ~20% frame height, so only warn below that point.
  if (headVis && feetVis) {
    const topY = Math.min(head.y, (primary[11]?.y ?? 1), (primary[12]?.y ?? 1));
    const botY = Math.max(ankleL?.y ?? 0, ankleR?.y ?? 0);
    const heightPct = botY - topY;
    if (heightPct < 0.2) {
      issues.push("Athlete very small — zoom in or move camera closer");
    } else if (heightPct > 0.95) {
      issues.push("Too close — step camera back");
    }
  }

  // 4) Athlete too close to edge (left/right within 5%)
  const hipL = primary[23];
  const hipR = primary[24];
  if (hipL && hipR) {
    const cx = (hipL.x + hipR.x) / 2;
    if (cx < 0.1) issues.push("Athlete near left edge");
    else if (cx > 0.9) issues.push("Athlete near right edge");
  }

  // 5) Sport-specific
  if (sport === "basketball") {
    // Shooting arm should be visible — wrists
    if ((primary[15]?.visibility ?? 0) < 0.3 && (primary[16]?.visibility ?? 0) < 0.3) {
      issues.push("Wrist hidden — change angle");
    }
  } else if (sport === "swimming") {
    // Side view: shoulders should be roughly aligned horizontally
    const ls = primary[11];
    const rs = primary[12];
    if (ls && rs && Math.abs(ls.y - rs.y) > 0.06) {
      issues.push("Camera angled — try perpendicular side view");
    }
  }

  let level = "good";
  if (issues.length >= 2 || avgVis < 0.35) level = "poor";
  else if (issues.length === 1 || avgVis < 0.55) level = "fair";
  return { level, issues };
}
