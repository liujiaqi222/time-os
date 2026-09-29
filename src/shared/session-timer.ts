import type { FocusIntervalSlice } from "@/shared/focus-intervals";

/**
 * Stopwatch helpers (PRD §6.2). The authoritative elapsed time of an
 * observed Session is the sum of its focus intervals — never wall-clock
 * minus stored pause seconds. All instants are server-provided; the client
 * only renders and recalibrates against serverNow.
 */

export type { FocusIntervalSlice };

/** Effective focus seconds of an observed Session at instant `now`. */
export function focusSecondsOfIntervals(
  intervals: readonly FocusIntervalSlice[],
  now: Date = new Date(),
): number {
  let totalMs = 0;
  for (const interval of intervals) {
    const start = new Date(interval.startedAt).getTime();
    const end = new Date(interval.endedAt ?? now).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      totalMs += end - start;
    }
  }
  return Math.floor(totalMs / 1000);
}

/** Remaining live seconds when the client only has serverNow + focus. */
export function liveFocusSeconds(
  focusSecondsAtServer: number,
  serverNow: Date | string,
  now: Date = new Date(),
): number {
  const delta = Math.floor(
    (now.getTime() - new Date(serverNow).getTime()) / 1000,
  );
  return Math.max(0, focusSecondsAtServer + Math.max(0, delta));
}

export function formatTimeDigits(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (hours > 0) {
    const hh = String(hours).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  return `${mm}:${ss}`;
}

export function formatHumanDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}时 ${minutes}分`;
  }
  if (minutes > 0) {
    return `${minutes}分 ${seconds}秒`;
  }
  return `${seconds}秒`;
}
