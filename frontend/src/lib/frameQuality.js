/**
 * Frame quality assessment from MediaPipe pose landmarks.
 * Used by PoseCanvas + MultiPlayerPoseCanvas to show a live green/yellow/red
 * "Frame quality" badge so users can self-correct camera framing in real time.
 */
export function assessFrameQuality(poses, { sport, cameraAspect } = {}) {
  if (!poses || poses.length === 0) {
    return { level: "poor", issues: ["No athlete detected — step into frame"] };
  }
  const primary = poses[0];
  const issues = [];

  // Swimming uses the torso and arms as its useful signal; feet commonly
  // disappear in bubbles or perspective in an underwater head-on view.
  const head = primary[0];
  const ankleL = primary[27];
  const ankleR = primary[28];
  const headVis = (head?.visibility ?? 0) > 0.5;
  const feetVis =
    (ankleL?.visibility ?? 0) > 0.4 || (ankleR?.visibility ?? 0) > 0.4;
  if (sport === "swimming") {
    const coreIndices = [11, 12, 15, 16, 23, 24];
    const visibleCore = coreIndices.filter(
      (index) => (primary[index]?.visibility ?? 0) > 0.35
    ).length;
    if (visibleCore < 4) {
      issues.push("Swimmer pose obscured — wait until shoulders and hips are visible");
    }
  } else {
    if (!headVis) issues.push("Head out of frame — tilt camera up");
    if (!feetVis) issues.push("Feet not visible — step back or pan down");
  }

  let visSum = 0;
  let visN = 0;
  for (const point of primary) {
    if (point?.visibility != null) {
      visSum += point.visibility;
      visN += 1;
    }
  }
  const avgVis = visN ? visSum / visN : 0;
  if (avgVis < 0.4) {
    issues.push(
      sport === "swimming"
        ? "Underwater pose confidence low — wait until swimmer is closer"
        : "Low pose confidence — improve lighting"
    );
  }

  // Standing-sport framing uses head-to-feet height. That measurement is not
  // meaningful for a foreshortened swimmer approaching the camera.
  if (sport !== "swimming" && headVis && feetVis) {
    const topY = Math.min(head.y, (primary[11]?.y ?? 1), (primary[12]?.y ?? 1));
    const botY = Math.max(ankleL?.y ?? 0, ankleR?.y ?? 0);
    const heightPct = botY - topY;
    if (heightPct < 0.2) {
      issues.push("Athlete very small — zoom in or move camera closer");
    } else if (heightPct > 0.95) {
      issues.push("Too close — step camera back");
    }
  }

  const hipL = primary[23];
  const hipR = primary[24];
  if (hipL && hipR) {
    const cx = (hipL.x + hipR.x) / 2;
    if (cx < 0.1) issues.push("Athlete near left edge");
    else if (cx > 0.9) issues.push("Athlete near right edge");
  }

  if (sport === "basketball") {
    if ((primary[15]?.visibility ?? 0) < 0.3 && (primary[16]?.visibility ?? 0) < 0.3) {
      issues.push("Wrist hidden — change angle");
    }
  } else if (sport === "swimming" && (cameraAspect == null || cameraAspect >= 1)) {
    // This cue applies only to a landscape side view. A portrait underwater
    // approach is intentionally head-on and should not be told to rotate.
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
