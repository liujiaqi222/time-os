import { describe, expect, it } from "vitest";

import { computeFocusIntervals } from "@/shared/focus-intervals";

// A local day in UTC: 2026-09-23 00:00:00Z → 23:59:59.999Z.
const range = {
  start: new Date("2026-09-23T00:00:00Z"),
  end: new Date("2026-09-23T23:59:59.999Z"),
};
const now = new Date("2026-09-23T12:00:00Z");

const hours = (h: number) => h * 3600;

describe("computeFocusIntervals", () => {
  it("counts a completed session fully inside the range at full duration", () => {
    const totals = computeFocusIntervals(
      [
        {
          trackId: "t1",
          status: "completed",
          startedAt: new Date("2026-09-23T09:00:00Z"),
          endedAt: new Date("2026-09-23T10:00:00Z"),
          durationSeconds: hours(1),
          totalPausedSeconds: 0,
        },
      ],
      range,
      now,
    );
    expect(totals.totalFocusSeconds).toBe(hours(1));
    expect(totals.trackFocusSeconds.get("t1")).toBe(hours(1));
  });

  it("prorates a cross-midnight session to the part inside the range", () => {
    // Ran 22:00 yesterday → 02:00 today (4h wall clock, 4h focus).
    const totals = computeFocusIntervals(
      [
        {
          trackId: "t1",
          status: "completed",
          startedAt: new Date("2026-09-22T22:00:00Z"),
          endedAt: new Date("2026-09-23T02:00:00Z"),
          durationSeconds: hours(4),
          totalPausedSeconds: 0,
        },
      ],
      range,
      now,
    );
    // Only 02:00 − 00:00 = 2h of the 4h fall inside today.
    expect(totals.totalFocusSeconds).toBe(hours(2));
  });

  it("caps the prorated share at the full stored duration", () => {
    // 48h session spanning the whole range, but stored duration is 10h:
    // the range covers half the wall time, so 5h counts — never more than
    // the stored duration.
    const totals = computeFocusIntervals(
      [
        {
          trackId: "t1",
          status: "completed",
          startedAt: new Date("2026-09-22T12:00:00Z"),
          endedAt: new Date("2026-09-24T12:00:00Z"),
          durationSeconds: hours(10),
          totalPausedSeconds: 0,
        },
      ],
      range,
      now,
    );
    expect(totals.totalFocusSeconds).toBe(hours(5));
  });

  it("counts zero for a session entirely outside the range", () => {
    const totals = computeFocusIntervals(
      [
        {
          trackId: "t1",
          status: "completed",
          startedAt: new Date("2026-09-21T09:00:00Z"),
          endedAt: new Date("2026-09-21T10:00:00Z"),
          durationSeconds: hours(1),
          totalPausedSeconds: 0,
        },
      ],
      range,
      now,
    );
    expect(totals.totalFocusSeconds).toBe(0);
  });

  it("counts an active session live, deducting accumulated pauses", () => {
    const totals = computeFocusIntervals(
      [
        {
          trackId: "t1",
          status: "active",
          startedAt: new Date("2026-09-23T10:00:00Z"),
          endedAt: null,
          durationSeconds: null,
          totalPausedSeconds: 300,
        },
      ],
      range,
      now,
    );
    expect(totals.totalFocusSeconds).toBe(hours(2) - 300);
  });

  it("freezes a paused session at pausedAt, deducting prior pauses", () => {
    const totals = computeFocusIntervals(
      [
        {
          trackId: "t1",
          status: "paused",
          startedAt: new Date("2026-09-23T10:00:00Z"),
          pausedAt: new Date("2026-09-23T11:00:00Z"),
          endedAt: null,
          durationSeconds: null,
          totalPausedSeconds: 60,
        },
      ],
      range,
      now,
    );
    // 1h on the clock minus the 60s paused earlier.
    expect(totals.totalFocusSeconds).toBe(hours(1) - 60);
  });

  it("counts zero for cancelled sessions and null durations", () => {
    const totals = computeFocusIntervals(
      [
        {
          trackId: "t1",
          status: "cancelled",
          startedAt: new Date("2026-09-23T10:00:00Z"),
          endedAt: new Date("2026-09-23T11:00:00Z"),
          durationSeconds: hours(1),
          totalPausedSeconds: 0,
        },
        {
          trackId: "t2",
          status: "completed",
          startedAt: new Date("2026-09-23T10:00:00Z"),
          endedAt: new Date("2026-09-23T11:00:00Z"),
          durationSeconds: null,
          totalPausedSeconds: 0,
        },
      ],
      range,
      now,
    );
    expect(totals.totalFocusSeconds).toBe(0);
    expect(totals.trackFocusSeconds.get("t1")).toBe(0);
    expect(totals.trackFocusSeconds.get("t2")).toBe(0);
  });

  it("aggregates per track across multiple sessions", () => {
    const totals = computeFocusIntervals(
      [
        {
          trackId: "t1",
          status: "completed",
          startedAt: new Date("2026-09-23T09:00:00Z"),
          endedAt: new Date("2026-09-23T10:00:00Z"),
          durationSeconds: hours(1),
          totalPausedSeconds: 0,
        },
        {
          trackId: "t1",
          status: "completed",
          startedAt: new Date("2026-09-23T11:00:00Z"),
          endedAt: new Date("2026-09-23T11:30:00Z"),
          durationSeconds: hours(0.5),
          totalPausedSeconds: 0,
        },
        {
          trackId: "t2",
          status: "completed",
          startedAt: new Date("2026-09-23T09:00:00Z"),
          endedAt: new Date("2026-09-23T09:15:00Z"),
          durationSeconds: 15 * 60,
          totalPausedSeconds: 0,
        },
      ],
      range,
      now,
    );
    expect(totals.totalFocusSeconds).toBe(hours(1) + hours(0.5) + 15 * 60);
    expect(totals.trackFocusSeconds.get("t1")).toBe(hours(1.5));
    expect(totals.trackFocusSeconds.get("t2")).toBe(15 * 60);
  });
});
