/**
 * Focus-time statistics over half-open instant ranges (PRD §7.2).
 *
 * - observed Sessions: focus seconds come from the real focus intervals;
 *   an open interval (active Session) is clipped to `now`.
 * - manual / corrected Sessions: the declared effective duration is
 *   apportioned across the queried range by wall-clock overlap — never
 *   pretending a real pause position was recovered.
 * - cancelled Sessions contribute nothing anywhere.
 */

export interface FocusIntervalSlice {
  startedAt: Date | string;
  endedAt: Date | string | null;
}

export type SessionTimeBasis = "observed" | "manual" | "corrected";

export interface SessionFocusSlice {
  id: string;
  goalId: string;
  status: "active" | "paused" | "completed" | "cancelled";
  timeBasis: SessionTimeBasis;
  startedAt: Date | string;
  endedAt: Date | string | null;
  durationSeconds: number | null;
  intervals: readonly FocusIntervalSlice[];
}

export interface FocusTotals {
  totalFocusSeconds: number;
  /** Focus seconds attributed to each Goal within the queried range. */
  goalFocusSeconds: ReadonlyMap<string, number>;
}

function overlapSeconds(
  startMs: number,
  endMs: number,
  range: { start: Date; end: Date },
): number {
  const from = Math.max(startMs, range.start.getTime());
  const to = Math.min(endMs, range.end.getTime());
  return to > from ? to - from : 0;
}

function apportionedSeconds(
  session: SessionFocusSlice,
  range: { start: Date; end: Date },
): number {
  const startMs = new Date(session.startedAt).getTime();
  const endMs = session.endedAt ? new Date(session.endedAt).getTime() : null;
  const duration = session.durationSeconds ?? 0;
  if (endMs === null || endMs <= startMs || duration <= 0) return 0;

  const overlap = overlapSeconds(startMs, endMs, range);
  if (overlap <= 0) return 0;
  const wall = endMs - startMs;
  return Math.max(
    0,
    Math.min(duration, Math.round((duration * overlap) / wall)),
  );
}

/** Focus seconds contributed by one Session to a half-open range. */
export function focusSecondsInRange(
  session: SessionFocusSlice,
  range: { start: Date; end: Date },
  now: Date,
): number {
  if (session.status === "cancelled") return 0;

  if (session.timeBasis === "observed" && session.intervals.length > 0) {
    let totalMs = 0;
    for (const interval of session.intervals) {
      const startMs = new Date(interval.startedAt).getTime();
      const endMs = new Date(interval.endedAt ?? now).getTime();
      if (endMs <= startMs) continue;
      totalMs += overlapSeconds(startMs, endMs, range);
    }
    return Math.floor(totalMs / 1000);
  }

  // Manual / corrected (and defensive fallback for interval-less
  // observed rows): apportion the declared duration by wall overlap.
  return apportionedSeconds(session, range);
}

/** Aggregate Session focus in [range.start, range.end). */
export function computeFocusTotals(
  sessions: readonly SessionFocusSlice[],
  range: { start: Date; end: Date },
  now: Date,
): FocusTotals {
  let totalFocusSeconds = 0;
  const goalFocusSeconds = new Map<string, number>();

  for (const session of sessions) {
    const seconds = focusSecondsInRange(session, range, now);
    totalFocusSeconds += seconds;
    goalFocusSeconds.set(
      session.goalId,
      (goalFocusSeconds.get(session.goalId) ?? 0) + seconds,
    );
  }

  return { totalFocusSeconds, goalFocusSeconds };
}
