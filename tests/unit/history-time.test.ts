import { describe, expect, it } from "vitest";

import {
  normalizeManualSession,
  normalizeSessionCorrection,
} from "@/services/history";

const completed = {
  startedAt: new Date("2026-01-01T10:00:00Z"),
  endedAt: new Date("2026-01-01T11:00:00Z"),
  durationSeconds: 3600,
};

describe("manual Session time normalization", () => {
  it("derives start from effective duration and end", () => {
    expect(
      normalizeManualSession({
        durationSeconds: 1800,
        endedAt: new Date("2026-01-01T12:00:00Z"),
        now: new Date("2026-02-01T00:00:00Z"),
      }),
    ).toEqual({
      startedAt: new Date("2026-01-01T11:30:00Z"),
      endedAt: new Date("2026-01-01T12:00:00Z"),
      durationSeconds: 1800,
    });
  });

  it("defaults the end to now", () => {
    expect(
      normalizeManualSession({
        durationSeconds: 600,
        now: new Date("2026-01-01T12:00:00Z"),
      }),
    ).toEqual({
      startedAt: new Date("2026-01-01T11:50:00Z"),
      endedAt: new Date("2026-01-01T12:00:00Z"),
      durationSeconds: 600,
    });
  });

  it("rejects non-positive durations", () => {
    expect(() =>
      normalizeManualSession({
        durationSeconds: 0,
        now: new Date("2026-01-01T12:00:00Z"),
      }),
    ).toThrow();
  });
});

describe("Session time correction", () => {
  it("keeps effective duration independent from the wall-clock range", () => {
    expect(
      normalizeSessionCorrection(completed, {
        startedAt: new Date("2026-01-01T09:00:00Z"),
        endedAt: new Date("2026-01-01T10:30:00Z"),
      }),
    ).toEqual({
      startedAt: new Date("2026-01-01T09:00:00Z"),
      endedAt: new Date("2026-01-01T10:30:00Z"),
      durationSeconds: 3600,
    });
  });
  it("supports a corrected declaration of 30 minutes in a one-hour range", () => {
    expect(
      normalizeSessionCorrection(completed, {
        startedAt: new Date("2026-01-01T23:30:00Z"),
        endedAt: new Date("2026-01-02T00:30:00Z"),
        durationSeconds: 1800,
      }).durationSeconds,
    ).toBe(1800);
  });
  it("rejects reversed ranges and duration exceeding the wall clock", () => {
    expect(() =>
      normalizeSessionCorrection(completed, {
        startedAt: new Date("2026-01-01T12:00:00Z"),
      }),
    ).toThrow();
    expect(() =>
      normalizeSessionCorrection(completed, { durationSeconds: 3601 }),
    ).toThrow();
  });
  it("preserves the range when only duration changes", () => {
    expect(
      normalizeSessionCorrection(completed, { durationSeconds: 1800 }),
    ).toEqual({ ...completed, durationSeconds: 1800 });
  });
  it("does not silently move the start when the end changes", () => {
    expect(
      normalizeSessionCorrection(completed, {
        endedAt: new Date("2026-01-01T12:00:00Z"),
      }).startedAt,
    ).toEqual(completed.startedAt);
  });
});
