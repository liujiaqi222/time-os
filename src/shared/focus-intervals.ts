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
 * Focus seconds contributed by one Session to a half-open instant interval.
 *
 * The schema stores aggregate pause time rather than every historical pause
 * interval. When only part of such a Session intersects the query, its stored
 * effective duration is therefore apportioned by real wall-clock overlap.
 * This keeps totals additive across midnight and DST boundaries.
 */
export function focusSecondsInRange(
  session: FocusSessionSlice,
  range: { start: Date; end: Date },
  now: Date,
): number {
  if (session.status === "cancelled") return 0;

  const sessionStartMs = new Date(session.startedAt).getTime();
  let sessionEndMs: number;
  let effectiveSeconds: number;

  if (session.status === "completed") {
    if (session.durationSeconds == null || !session.endedAt) return 0;
    sessionEndMs = new Date(session.endedAt).getTime();
    effectiveSeconds = session.durationSeconds;
  } else if (session.status === "active" || session.status === "paused") {
    sessionEndMs =
      session.status === "paused" && session.pausedAt
        ? new Date(session.pausedAt).getTime()
        : now.getTime();
    effectiveSeconds = calculateDurationSecondsOnFinish(session, now);
  } else {
    return 0;
  }

  const wallMs = sessionEndMs - sessionStartMs;
  if (wallMs <= 0 || effectiveSeconds <= 0) return 0;

  const overlapMs =
    Math.min(sessionEndMs, range.end.getTime()) -
    Math.max(sessionStartMs, range.start.getTime());
  if (overlapMs <= 0) return 0;

  return Math.max(
    0,
    Math.min(
      effectiveSeconds,
      Math.round(effectiveSeconds * (overlapMs / wallMs)),
    ),
  );
}

/** Aggregate Session focus in [range.start, range.end). */
export function computeFocusIntervals(
  sessions: readonly FocusSessionSlice[],
  range: { start: Date; end: Date },
  now: Date,
): FocusIntervalTotals {
  let totalFocusSeconds = 0;
  const trackFocusSeconds = new Map<string, number>();

  for (const session of sessions) {
    const seconds = focusSecondsInRange(session, range, now);
    totalFocusSeconds += seconds;
    trackFocusSeconds.set(
      session.trackId,
      (trackFocusSeconds.get(session.trackId) ?? 0) + seconds,
    );
  }

  return { totalFocusSeconds, trackFocusSeconds };
}
