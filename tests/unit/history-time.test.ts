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
  it("normalizes start/end into the derived duration", () => {
    expect(
      normalizeSessionCorrection(completed, {
        startedAt: new Date("2026-01-01T09:00:00Z"),
        endedAt: new Date("2026-01-01T10:30:00Z"),
      }),
    ).toEqual({
      startedAt: new Date("2026-01-01T09:00:00Z"),
      endedAt: new Date("2026-01-01T10:30:00Z"),
      durationSeconds: 5400,
    });
  });

  it("derives an end from start and effective duration", () => {
    expect(
      normalizeSessionCorrection(completed, {
        startedAt: new Date("2026-01-01T12:00:00Z"),
        durationSeconds: 1800,
      }).endedAt,
    ).toEqual(new Date("2026-01-01T12:30:00Z"));
  });

  it("rejects contradictory three-field corrections and non-positive ranges", () => {
    expect(() =>
      normalizeSessionCorrection(completed, {
        startedAt: new Date("2026-01-01T12:00:00Z"),
        endedAt: new Date("2026-01-01T13:00:00Z"),
        durationSeconds: 1,
      }),
    ).toThrow(/at most two time fields/i);

    expect(() =>
      normalizeSessionCorrection(completed, {
        startedAt: new Date("2026-01-01T12:00:00Z"),
        endedAt: new Date("2026-01-01T12:00:00Z"),
      }),
    ).toThrow();
  });

  it("treats the declared duration as authoritative when only it changes", () => {
    expect(
      normalizeSessionCorrection(completed, {
        durationSeconds: 1800,
      }),
    ).toEqual({
      startedAt: new Date("2026-01-01T10:30:00Z"),
      endedAt: new Date("2026-01-01T11:00:00Z"),
      durationSeconds: 1800,
    });
  });

  it("keeps the declared duration when only the end changes", () => {
    expect(
      normalizeSessionCorrection(completed, {
        endedAt: new Date("2026-01-01T12:00:00Z"),
      }),
    ).toEqual({
      startedAt: new Date("2026-01-01T11:00:00Z"),
      endedAt: new Date("2026-01-01T12:00:00Z"),
      durationSeconds: 3600,
    });
  });
});
