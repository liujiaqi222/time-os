import { describe, expect, it } from "vitest";

import {
  focusSecondsOfIntervals,
  formatHumanDuration,
  formatTimeDigits,
  liveFocusSeconds,
} from "@/shared/session-timer";

describe("focusSecondsOfIntervals", () => {
  it("sums closed intervals into whole seconds", () => {
    expect(
      focusSecondsOfIntervals(
        [
          {
            startedAt: new Date("2026-09-22T10:00:00Z"),
            endedAt: new Date("2026-09-22T10:20:30Z"),
          },
          {
            startedAt: new Date("2026-09-22T10:25:00Z"),
            endedAt: new Date("2026-09-22T10:25:30Z"),
          },
        ],
        new Date("2026-09-22T11:00:00Z"),
      ),
    ).toBe(20 * 60 + 30 + 30);
  });

  it("extends the open interval to now", () => {
    expect(
      focusSecondsOfIntervals(
        [
          {
            startedAt: new Date("2026-09-22T10:00:00Z"),
            endedAt: new Date("2026-09-22T10:10:00Z"),
          },
          { startedAt: new Date("2026-09-22T10:20:00Z"), endedAt: null },
        ],
        new Date("2026-09-22T10:25:30Z"),
      ),
    ).toBe(10 * 60 + 5 * 60 + 30);
  });

  it("tolerates empty and inverted intervals", () => {
    expect(focusSecondsOfIntervals([], new Date())).toBe(0);
    expect(
      focusSecondsOfIntervals(
        [
          {
            startedAt: new Date("2026-09-22T10:00:00Z"),
            endedAt: new Date("2026-09-22T09:59:00Z"),
          },
        ],
        new Date("2026-09-22T11:00:00Z"),
      ),
    ).toBe(0);
  });

  it("keeps a paused Session frozen when every interval is closed", () => {
    const intervals = [
      {
        startedAt: new Date("2026-09-22T10:00:00Z"),
        endedAt: new Date("2026-09-22T10:30:00Z"),
      },
    ];
    const early = focusSecondsOfIntervals(
      intervals,
      new Date("2026-09-22T10:31:00Z"),
    );
    const late = focusSecondsOfIntervals(
      intervals,
      new Date("2026-09-23T10:00:00Z"),
    );
    expect(early).toBe(late);
    expect(early).toBe(30 * 60);
  });
});

describe("liveFocusSeconds", () => {
  it("adds the wall-clock delta since serverNow", () => {
    expect(
      liveFocusSeconds(
        120,
        "2026-09-22T10:00:00Z",
        new Date("2026-09-22T10:01:10Z"),
      ),
    ).toBe(120 + 70);
  });

  it("never counts backwards before serverNow", () => {
    expect(
      liveFocusSeconds(
        120,
        "2026-09-22T10:00:00Z",
        new Date("2026-09-22T09:58:00Z"),
      ),
    ).toBe(120);
  });
});

describe("formatting", () => {
  it("formats digits with minute precision until an hour", () => {
    expect(formatTimeDigits(0)).toBe("00:00");
    expect(formatTimeDigits(65)).toBe("01:05");
    expect(formatTimeDigits(3600 + 125)).toBe("01:02:05");
  });

  it("formats human durations", () => {
    expect(formatHumanDuration(45)).toBe("45秒");
    expect(formatHumanDuration(5 * 60 + 9)).toBe("5分 9秒");
    expect(formatHumanDuration(2 * 3600 + 25 * 60)).toBe("2时 25分");
  });
});
