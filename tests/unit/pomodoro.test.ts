import { describe, expect, it } from "vitest";
import type { SessionPhase } from "@/db/schema";
import {
  configOf,
  plannedPhases,
  projectPhases,
  timerDisplay,
} from "@/shared/pomodoro";
import { focusSecondsOfIntervals } from "@/shared/session-timer";
import { focusSecondsInRange } from "@/shared/focus-intervals";
import {
  sessionAdvanceSchema,
  timerConfigSchema,
} from "@/shared/schemas/session";
const start = new Date("2026-10-01T00:00:00Z");
const deadline = new Date(start.getTime() + 1500000);
const phase: SessionPhase = {
  id: "p",
  sessionId: "s",
  kind: "focus",
  sequence: 1,
  startedAt: start,
  deadlineAt: deadline,
  pausedAt: null,
  remainingMs: 1500000,
  endedAt: null,
  complete: false,
  advanceAction: null,
  nextPhaseId: null,
};
const session = { status: "active" as const, timerConfig: {} };
describe("authoritative pomodoro projection", () => {
  it("caps focus at the original deadline after two hours without writes", () => {
    const now = new Date(start.getTime() + 7200000);
    const view = projectPhases(session, [phase], now);
    expect(view.phase).toMatchObject({
      state: "due",
      remainingSeconds: 0,
      endedAt: deadline,
    });
    expect(view.phaseActions).toEqual(["start_break", "start_next_focus"]);
    expect(view.completedFocusCount).toBe(1);
    expect(phase.endedAt).toBeNull();
    const intervals = [
      { startedAt: start, endedAt: null, deadlineAt: deadline, phase: "focus" },
      { startedAt: deadline, endedAt: null, phase: "short_break" },
    ];
    expect(focusSecondsOfIntervals(intervals, now)).toBe(1500);
    expect(
      focusSecondsInRange(
        {
          id: "s",
          goalId: "g",
          status: "active",
          timeBasis: "observed",
          startedAt: start,
          endedAt: null,
          durationSeconds: null,
          intervals,
        },
        { start, end: now },
        now,
      ),
    ).toBe(1500);
  });
  it("projects pause without treating a missing deadline as due", () => {
    const view = projectPhases(
      { ...session, status: "paused" },
      [{ ...phase, deadlineAt: null, pausedAt: start, remainingMs: 900000 }],
      deadline,
    );
    expect(view.phase).toMatchObject({
      state: "paused",
      remainingSeconds: 900,
    });
    expect(view.completedFocusCount).toBe(0);
    expect(view.phaseActions).toEqual(["resume"]);
  });
  it("offers long break on fourth complete focus only, then short on fifth", () => {
    const phases = [1, 2, 3, 4].map((sequence) => ({
      ...phase,
      sequence,
      id: String(sequence),
      endedAt: deadline,
      complete: true,
    }));
    expect(projectPhases(session, phases, deadline).nextBreakKind).toBe(
      "long_break",
    );
    expect(
      projectPhases(
        session,
        [...phases, { ...phases[0], sequence: 5 }],
        deadline,
      ).nextBreakKind,
    ).toBe("short_break");
    expect(
      projectPhases(
        { ...session, timerConfig: { longBreakEnabled: false } },
        phases,
        deadline,
      ).nextBreakKind,
    ).toBe("short_break");
  });
  it("allows early next focus in paused break but does not count a complete focus", () => {
    const view = projectPhases(
      { ...session, status: "paused" },
      [{ ...phase, kind: "long_break", pausedAt: start, deadlineAt: null }],
      deadline,
    );
    expect(view.phaseActions).toEqual(["resume", "start_next_focus"]);
    expect(view.completedFocusCount).toBe(0);
  });
  it("does not allow transitions on ended sessions", () => {
    expect(
      projectPhases({ ...session, status: "completed" }, [phase], deadline)
        .phaseActions,
    ).toEqual([]);
  });
  it("client rendering caps countdown and focus, freezing break and pause contributions", () => {
    const base = {
      timerMode: "pomodoro",
      status: "active",
      focusSeconds: 100,
      phase: { remainingSeconds: 10, kind: "focus", state: "running" },
    };
    expect(timerDisplay(base, 120)).toEqual({
      seconds: 0,
      due: true,
      focusSeconds: 110,
    });
    expect(
      timerDisplay(
        { ...base, phase: { ...base.phase, kind: "short_break" } },
        120,
      ).focusSeconds,
    ).toBe(100);
    expect(
      timerDisplay({ ...base, phase: { ...base.phase, state: "paused" } }, 120)
        .seconds,
    ).toBe(10);
  });
  it("validates config bounds and explicit phase commands", () => {
    expect(configOf(null)).toMatchObject({
      focusMinutes: 25,
      shortBreakMinutes: 5,
      longBreakMinutes: 15,
      longBreakEnabled: true,
    });
    for (const invalid of [0, 181, 1.5])
      expect(
        timerConfigSchema.safeParse({ focusMinutes: invalid }).success,
      ).toBe(false);
    expect(
      sessionAdvanceSchema.safeParse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        action: "start_break",
      }).success,
    ).toBe(false);
  });
});

describe("planned pomodoro rounds", () => {
  it("omits a trailing break and includes the fourth-round long break only when another round follows", () => {
    const single = plannedPhases(configOf({ iterations: 1 }));
    expect(single).toEqual([{ kind: "focus", minutes: 25 }]);
    const plan = plannedPhases(configOf({ iterations: 5 }));
    expect(plan.map((p) => p.kind)).toEqual([
      "focus",
      "short_break",
      "focus",
      "short_break",
      "focus",
      "short_break",
      "focus",
      "long_break",
      "focus",
    ]);
    expect(plan.reduce((sum, p) => sum + p.minutes, 0)).toBe(155);
    expect(
      plannedPhases(configOf({ iterations: 5, longBreakEnabled: false })).some(
        (p) => p.kind === "long_break",
      ),
    ).toBe(false);
  });
  it("accepts old snapshots with the default plan and rejects invalid round counts", () => {
    expect(configOf({ focusMinutes: 50 }).iterations).toBe(4);
    for (const iterations of [0, 13, 1.5])
      expect(timerConfigSchema.safeParse({ iterations }).success).toBe(false);
  });
});
