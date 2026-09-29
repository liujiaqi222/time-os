import { describe, expect, it } from "vitest";

import {
  computeFocusTotals,
  focusSecondsInRange,
  type SessionFocusSlice,
} from "@/shared/focus-intervals";

// A local day in UTC: 2026-09-23 00:00:00Z → 24:00:00Z (half-open).
const range = {
  start: new Date("2026-09-23T00:00:00Z"),
  end: new Date("2026-09-24T00:00:00Z"),
};
const now = new Date("2026-09-23T12:00:00Z");

const hours = (h: number) => h * 3600;

function observedSession(
  overrides: Partial<SessionFocusSlice> & {
    intervals: { startedAt: string; endedAt: string | null }[];
  },
): SessionFocusSlice {
  return {
    id: "s1",
    goalId: "g1",
    status: "completed",
    timeBasis: "observed",
    startedAt: new Date("2026-09-23T09:00:00Z"),
    endedAt: new Date("2026-09-23T10:00:00Z"),
    durationSeconds: null,
    ...overrides,
  };
}

describe("focusSecondsInRange", () => {
  it("counts observed Sessions from their real focus intervals", () => {
    const session = observedSession({
      intervals: [
        { startedAt: "2026-09-23T09:00:00Z", endedAt: "2026-09-23T09:40:00Z" },
        { startedAt: "2026-09-23T09:50:00Z", endedAt: "2026-09-23T10:00:00Z" },
      ],
    });
    expect(focusSecondsInRange(session, range, now)).toBe(40 * 60 + 10 * 60);
  });

  it("clips an open interval of an active Session to now", () => {
    const session = observedSession({
      status: "active",
      startedAt: new Date("2026-09-23T10:00:00Z"),
      endedAt: null,
      intervals: [
        { startedAt: "2026-09-23T10:00:00Z", endedAt: "2026-09-23T11:00:00Z" },
        { startedAt: "2026-09-23T11:15:00Z", endedAt: null },
      ],
    });
    // 1h closed + 45min open clipped to now (12:00).
    expect(focusSecondsInRange(session, range, now)).toBe(hours(1) + 45 * 60);
  });

  it("keeps a paused Session frozen at its closed intervals", () => {
    const session = observedSession({
      status: "paused",
      startedAt: new Date("2026-09-23T09:00:00Z"),
      endedAt: null,
      intervals: [
        { startedAt: "2026-09-23T09:00:00Z", endedAt: "2026-09-23T09:30:00Z" },
      ],
    });
    expect(focusSecondsInRange(session, range, now)).toBe(30 * 60);
  });

  it("splits a cross-midnight Session across the queried day", () => {
    const session = observedSession({
      startedAt: new Date("2026-09-22T22:00:00Z"),
      endedAt: new Date("2026-09-23T02:00:00Z"),
      intervals: [
        { startedAt: "2026-09-22T22:00:00Z", endedAt: "2026-09-23T02:00:00Z" },
      ],
    });
    expect(focusSecondsInRange(session, range, now)).toBe(hours(2));
  });

  it("counts a zero-duration Session as zero", () => {
    const session = observedSession({
      durationSeconds: 0,
      intervals: [
        { startedAt: "2026-09-23T09:00:00Z", endedAt: "2026-09-23T09:00:30Z" },
      ],
    });
    // Sub-second wall time still rounds to a full second of focus; the
    // zero-duration record only arises when the interval is truly empty.
    const empty = observedSession({
      durationSeconds: 0,
      intervals: [],
    });
    expect(focusSecondsInRange(empty, range, now)).toBe(0);
  });

  it("apportions manual / corrected durations by wall overlap", () => {
    const session: SessionFocusSlice = {
      id: "s2",
      goalId: "g1",
      status: "completed",
      timeBasis: "manual",
      startedAt: new Date("2026-09-22T22:00:00Z"),
      endedAt: new Date("2026-09-23T02:00:00Z"),
      durationSeconds: hours(4),
      intervals: [],
    };
    expect(focusSecondsInRange(session, range, now)).toBe(hours(2));

    const capped: SessionFocusSlice = {
      ...session,
      startedAt: new Date("2026-09-22T12:00:00Z"),
      endedAt: new Date("2026-09-24T12:00:00Z"),
      durationSeconds: hours(10),
    };
    // Half the wall time falls inside the day → half the duration, and
    // never more than the declared total.
    expect(focusSecondsInRange(capped, range, now)).toBe(hours(5));
  });

  it("returns zero for cancelled Sessions and out-of-range records", () => {
    expect(
      focusSecondsInRange(
        observedSession({
          status: "cancelled",
          intervals: [
            {
              startedAt: "2026-09-23T09:00:00Z",
              endedAt: "2026-09-23T10:00:00Z",
            },
          ],
        }),
        range,
        now,
      ),
    ).toBe(0);
    expect(
      focusSecondsInRange(
        observedSession({
          startedAt: new Date("2026-09-20T09:00:00Z"),
          endedAt: new Date("2026-09-20T10:00:00Z"),
          intervals: [
            {
              startedAt: "2026-09-20T09:00:00Z",
              endedAt: "2026-09-20T10:00:00Z",
            },
          ],
        }),
        range,
        now,
      ),
    ).toBe(0);
  });
});

describe("computeFocusTotals", () => {
  it("aggregates per Goal across multiple Sessions", () => {
    const sessions: SessionFocusSlice[] = [
      observedSession({
        id: "s1",
        goalId: "g1",
        intervals: [
          {
            startedAt: "2026-09-23T09:00:00Z",
            endedAt: "2026-09-23T10:00:00Z",
          },
        ],
      }),
      observedSession({
        id: "s2",
        goalId: "g2",
        intervals: [
          {
            startedAt: "2026-09-23T11:00:00Z",
            endedAt: "2026-09-23T11:10:00Z",
          },
        ],
      }),
      {
        id: "s3",
        goalId: "g1",
        status: "completed",
        timeBasis: "manual",
        startedAt: new Date("2026-09-23T08:00:00Z"),
        endedAt: new Date("2026-09-23T08:30:00Z"),
        durationSeconds: 30 * 60,
        intervals: [],
      },
    ];
    const totals = computeFocusTotals(sessions, range, now);
    expect(totals.totalFocusSeconds).toBe(hours(1) + 10 * 60 + 30 * 60);
    expect(totals.goalFocusSeconds.get("g1")).toBe(hours(1) + 30 * 60);
    expect(totals.goalFocusSeconds.get("g2")).toBe(10 * 60);
  });
});
