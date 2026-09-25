import { describe, expect, it } from "vitest";

import {
  calculateDurationSecondsOnFinish,
  calculateElapsedSeconds,
  formatHumanDuration,
  formatTimeDigits,
} from "@/shared/session-timer";

describe("session-timer", () => {
  it("calculates elapsed seconds for an active session", () => {
    const startedAt = new Date("2026-09-22T10:00:00Z");
    const now = new Date("2026-09-22T10:25:30Z");
    const elapsed = calculateElapsedSeconds(
      {
        startedAt,
        totalPausedSeconds: 0,
        status: "active",
      },
      now,
    );
    expect(elapsed).toBe(25 * 60 + 30);
  });

  it("deducts accumulated paused seconds for active session", () => {
    const startedAt = new Date("2026-09-22T10:00:00Z");
    const now = new Date("2026-09-22T10:25:30Z");
    const elapsed = calculateElapsedSeconds(
      {
        startedAt,
        totalPausedSeconds: 300,
        status: "active",
      },
      now,
    );
    expect(elapsed).toBe(25 * 60 + 30 - 300);
  });

  it("calculates elapsed time frozen at pausedAt for a paused session", () => {
    const startedAt = new Date("2026-09-22T10:00:00Z");
    const pausedAt = new Date("2026-09-22T10:15:00Z");
    const now = new Date("2026-09-22T10:30:00Z");
    const elapsed = calculateElapsedSeconds(
      {
        startedAt,
        pausedAt,
        totalPausedSeconds: 60,
        status: "paused",
      },
      now,
    );
    // Should use pausedAt (15m), minus 60s totalPaused = 14m (840s)
    expect(elapsed).toBe(14 * 60);
  });

  it("excludes the current paused interval when finishing from paused", () => {
    const startedAt = new Date("2026-09-22T10:00:00Z");
    const pausedAt = new Date("2026-09-22T10:20:00Z");
    const finishNow = new Date("2026-09-22T10:50:00Z"); // 30 minutes later while still paused

    const duration = calculateDurationSecondsOnFinish(
      {
        startedAt,
        pausedAt,
        totalPausedSeconds: 120, // 2 minutes prior pauses
        status: "paused",
      },
      finishNow,
    );

    // Active time was 20m - 2m prior paused = 18m (1080s)
    // The 30m paused interval (10:20 to 10:50) is excluded
    expect(duration).toBe(18 * 60);
  });

  it("returns durationSeconds for completed session", () => {
    const elapsed = calculateElapsedSeconds({
      startedAt: new Date(),
      totalPausedSeconds: 0,
      durationSeconds: 1500,
      status: "completed",
    });
    expect(elapsed).toBe(1500);
  });

  it("formats time digits correctly", () => {
    expect(formatTimeDigits(0)).toBe("00:00");
    expect(formatTimeDigits(65)).toBe("01:05");
    expect(formatTimeDigits(3665)).toBe("01:01:05");
  });

  it("formats human duration correctly", () => {
    expect(formatHumanDuration(45)).toBe("45秒");
    expect(formatHumanDuration(125)).toBe("2分 5秒");
    expect(formatHumanDuration(3720)).toBe("1时 2分");
  });
});
