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
  phase?: string;
  deadlineAt?: Date | string | null;
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

function apportionedSeconds(
  session: SessionFocusSlice,
  range: { start: Date; end: Date },
): number {
  const startMs = new Date(session.startedAt).getTime();
  const endMs = session.endedAt ? new Date(session.endedAt).getTime() : null;
  const duration = session.durationSeconds ?? 0;
  if (endMs === null || endMs <= startMs || duration <= 0) return 0;

  const allocated = (at: Date) =>
    Math.floor(
      (duration *
        Math.max(0, Math.min(endMs - startMs, at.getTime() - startMs))) /
        (endMs - startMs),
    );
  return Math.max(0, allocated(range.end) - allocated(range.start));
}

/** Focus seconds contributed by one Session to a half-open range. */
export function focusSecondsInRange(
  session: SessionFocusSlice,
  range: { start: Date; end: Date },
  now: Date,
): number {
  if (session.status === "cancelled") return 0;

  if (session.timeBasis === "observed") {
    let beforeEndMs = 0;
    let beforeStartMs = 0;
    for (const interval of session.intervals) {
      if (interval.phase && interval.phase !== "focus") continue;
      const startMs = new Date(interval.startedAt).getTime();
      const endMs = Math.min(
        new Date(interval.endedAt ?? now).getTime(),
        now.getTime(),
        interval.deadlineAt
          ? new Date(interval.deadlineAt).getTime()
          : Infinity,
      );
      if (endMs <= startMs) continue;
      beforeEndMs += Math.max(
        0,
        Math.min(endMs, range.end.getTime()) - startMs,
      );
      beforeStartMs += Math.max(
        0,
        Math.min(endMs, range.start.getTime()) - startMs,
      );
    }
    return Math.floor(beforeEndMs / 1000) - Math.floor(beforeStartMs / 1000);
  }

  return apportionedSeconds(session, {
    start: range.start,
    end: new Date(Math.min(range.end.getTime(), now.getTime())),
  });
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
