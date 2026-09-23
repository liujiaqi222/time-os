import type { SessionTimerData } from "@/shared/session-timer";
import { calculateDurationSecondsOnFinish } from "@/shared/session-timer";

/** Minimal slice of a Session row needed to compute focus time. */
export interface FocusSessionSlice extends SessionTimerData {
  trackId: string;
  endedAt: Date | string | null;
}

export interface FocusIntervalTotals {
  totalFocusSeconds: number;
  /** Focus seconds attributed to each track within the queried range. */
  trackFocusSeconds: ReadonlyMap<string, number>;
}

/**
 * Compute focus seconds for sessions intersecting [range.start, range.end].
 *
 * - completed sessions count their stored duration, prorated to the part of
 *   the session that falls inside the range (cross-midnight split, PRD §9.3);
 * - active/paused sessions count live at `now`, minus paused time;
 * - cancelled sessions count zero.
 *
 * Pure: no database, no clock. The caller decides the range and "now",
 * which makes timezone and DST cases directly unit-testable.
 */
export function computeFocusIntervals(
  sessions: readonly FocusSessionSlice[],
  range: { start: Date; end: Date },
  now: Date,
): FocusIntervalTotals {
  const rangeStartMs = range.start.getTime();
  const rangeEndMs = range.end.getTime();

  let totalFocusSeconds = 0;
  const trackFocusSeconds = new Map<string, number>();

  for (const session of sessions) {
    let seconds = 0;

    if (session.status === "completed" && session.durationSeconds != null) {
      // Duration of the session falling within the range.
      const sessionStartMs = new Date(session.startedAt).getTime();
      const sessionEndMs = session.endedAt
        ? new Date(session.endedAt).getTime()
        : now.getTime();
      const clampedStartMs = Math.max(sessionStartMs, rangeStartMs);
      const clampedEndMs = Math.min(sessionEndMs, rangeEndMs);
      if (clampedEndMs > clampedStartMs) {
        const fraction =
          (clampedEndMs - clampedStartMs) /
          Math.max(1, sessionEndMs - sessionStartMs);
        seconds = Math.round(session.durationSeconds * Math.min(1, fraction));
      }
    } else if (session.status === "active" || session.status === "paused") {
      seconds = calculateDurationSecondsOnFinish(session, now);
    }

    totalFocusSeconds += seconds;
    trackFocusSeconds.set(
      session.trackId,
      (trackFocusSeconds.get(session.trackId) ?? 0) + seconds,
    );
  }

  return { totalFocusSeconds, trackFocusSeconds };
}
