export function getCapturePlaybackPlan({
  currentTime = 0,
  duration = null,
  ended = false,
  trimStart = 0,
  trimEnd = null,
  terminalThreshold = 0.75,
} = {}) {
  const start = Number.isFinite(trimStart) ? Math.max(0, trimStart) : 0;
  const finiteDuration = Number.isFinite(duration) ? duration : null;
  const requestedEnd = Number.isFinite(trimEnd) && trimEnd > start
    ? trimEnd
    : finiteDuration;
  const end = finiteDuration != null && Number.isFinite(requestedEnd)
    ? Math.min(requestedEnd, finiteDuration)
    : requestedEnd;
  const beforeWindow = currentTime < start;
  const nearTerminalFrame = Number.isFinite(end) &&
    currentTime >= end - terminalThreshold;
  return {
    start,
    end,
    shouldRewind: Boolean(ended || beforeWindow || nearTerminalFrame),
  };
}
