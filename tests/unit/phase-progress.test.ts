// @vitest-environment jsdom
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import { createElement } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PhaseProgress } from "@/components/today/phase-progress";
import type { SessionPhase } from "@/db/schema";

const config = {
  iterations: 4,
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEnabled: true,
};

const createPhase = (
  id: string,
  kind: SessionPhase["kind"],
  sequence: number,
  endedAt: Date | null = null,
): SessionPhase => ({
  id,
  sessionId: "s1",
  kind,
  sequence,
  startedAt: new Date("2026-10-01T00:00:00Z"),
  deadlineAt: new Date("2026-10-01T00:25:00Z"),
  pausedAt: null,
  remainingMs: 0,
  endedAt,
  complete: endedAt !== null,
  advanceAction: null,
  nextPhaseId: null,
});

describe("PhaseProgress", () => {
  it("renders all planned phases with opacity-25 and no halo when idle", () => {
    const { container } = render(createElement(PhaseProgress, { config }));
    const triggers = container.querySelectorAll(
      "[data-slot='tooltip-trigger']",
    );
    expect(triggers.length).toBe(7); // 4 focus + 3 break

    triggers.forEach((trigger) => {
      expect(trigger.className).not.toContain("shadow-[0_0_0_3px");
      const innerDot = trigger.querySelector("span");
      expect(innerDot?.className).toContain("opacity-25");
    });
  });

  it("highlights the active focus phase with solid color and halo", () => {
    const phases = [createPhase("p1", "focus", 1)];
    const { container } = render(
      createElement(PhaseProgress, {
        config,
        phases,
        currentId: "p1",
        isPending: false,
      }),
    );
    const triggers = container.querySelectorAll(
      "[data-slot='tooltip-trigger']",
    );

    // Dot 0 (active focus)
    expect(triggers[0]?.className).toContain("shadow-[0_0_0_3px");
    const innerDot0 = triggers[0]?.querySelector("span");
    expect(innerDot0?.className).not.toContain("opacity-25");
    expect(innerDot0?.className).not.toContain("opacity-70");
    expect(triggers[0]?.getAttribute("aria-current")).toBe("step");

    // Dot 1 (upcoming break)
    expect(triggers[1]?.className).not.toContain("shadow-[0_0_0_3px");
    const innerDot1 = triggers[1]?.querySelector("span");
    expect(innerDot1?.className).toContain("opacity-25");
  });

  it("moves halo to break without highlighting its color when focus is due", () => {
    const phases = [createPhase("p1", "focus", 1)];
    const { container } = render(
      createElement(PhaseProgress, {
        config,
        phases,
        currentId: "p1",
        isPending: true,
      }),
    );
    const triggers = container.querySelectorAll(
      "[data-slot='tooltip-trigger']",
    );

    // Dot 0 (focus that just timed out): ended, no halo
    expect(triggers[0]?.className).not.toContain("shadow-[0_0_0_3px");
    const innerDot0 = triggers[0]?.querySelector("span");
    expect(innerDot0?.className).toContain("opacity-70");

    // Dot 1 (upcoming break): has halo, but dot is faint (opacity-25, not highlighted!)
    expect(triggers[1]?.className).toContain("shadow-[0_0_0_3px");
    const innerDot1 = triggers[1]?.querySelector("span");
    expect(innerDot1?.className).toContain("opacity-25");
    expect(triggers[1]?.getAttribute("aria-current")).toBe("step");
    expect(triggers[1]?.getAttribute("aria-label")).toContain("短休息");
    expect(triggers[1]?.getAttribute("aria-label")).toContain("待开始");
  });

  it("highlights active break with solid color and halo", () => {
    const phases = [
      createPhase("p1", "focus", 1, new Date("2026-10-01T00:25:00Z")),
      createPhase("p2", "short_break", 2),
    ];
    const { container } = render(
      createElement(PhaseProgress, {
        config,
        phases,
        currentId: "p2",
        isPending: false,
      }),
    );
    const triggers = container.querySelectorAll(
      "[data-slot='tooltip-trigger']",
    );

    // Dot 0 (ended focus): opacity-70, no halo
    expect(triggers[0]?.className).not.toContain("shadow-[0_0_0_3px");
    expect(triggers[0]?.querySelector("span")?.className).toContain(
      "opacity-70",
    );

    // Dot 1 (active break): solid, has halo
    expect(triggers[1]?.className).toContain("shadow-[0_0_0_3px");
    const innerDot1 = triggers[1]?.querySelector("span");
    expect(innerDot1?.className).not.toContain("opacity-25");
    expect(innerDot1?.className).not.toContain("opacity-70");
    expect(triggers[1]?.getAttribute("aria-current")).toBe("step");
  });

  it("moves halo to round 2 focus without highlighting red when break is due", () => {
    // Exact user scenario: round 1 focus + rest completed, waiting to start round 2 focus
    const phases = [
      createPhase("p1", "focus", 1, new Date("2026-10-01T00:25:00Z")),
      createPhase("p2", "short_break", 2), // server snapshot has endedAt null until advance
    ];
    const { container } = render(
      createElement(PhaseProgress, {
        config,
        phases,
        currentId: "p2",
        isPending: true,
      }),
    );
    const triggers = container.querySelectorAll(
      "[data-slot='tooltip-trigger']",
    );

    // Dot 0 (focus 1): ended, opacity-70, no halo
    expect(triggers[0]?.className).not.toContain("shadow-[0_0_0_3px");
    expect(triggers[0]?.querySelector("span")?.className).toContain(
      "opacity-70",
    );

    // Dot 1 (break 1): ended, opacity-70, no halo (no longer stuck at break!)
    expect(triggers[1]?.className).not.toContain("shadow-[0_0_0_3px");
    expect(triggers[1]?.querySelector("span")?.className).toContain(
      "opacity-70",
    );

    // Dot 2 (round 2 focus): indicator moved right! Has halo, but red dot is NOT highlighted (opacity-25)
    expect(triggers[2]?.className).toContain("shadow-[0_0_0_3px");
    const innerDot2 = triggers[2]?.querySelector("span");
    expect(innerDot2?.className).toContain("opacity-25");
    expect(innerDot2?.className).toContain("bg-[#d85c41]");
    expect(triggers[2]?.getAttribute("aria-current")).toBe("step");
    expect(triggers[2]?.getAttribute("aria-label")).toContain("第 2 轮专注");
    expect(triggers[2]?.getAttribute("aria-label")).toContain("待开始");

    // Dot 3 onwards: opacity-25, no halo
    expect(triggers[3]?.className).not.toContain("shadow-[0_0_0_3px");
    expect(triggers[3]?.querySelector("span")?.className).toContain(
      "opacity-25",
    );
  });

  it("removes all halos when all rounds are complete", () => {
    const phases = [
      createPhase("p1", "focus", 1, new Date("2026-10-01T00:25:00Z")),
      createPhase("p2", "short_break", 2, new Date("2026-10-01T00:30:00Z")),
      createPhase("p3", "focus", 3, new Date("2026-10-01T00:55:00Z")),
      createPhase("p4", "short_break", 4, new Date("2026-10-01T01:00:00Z")),
      createPhase("p5", "focus", 5, new Date("2026-10-01T01:25:00Z")),
      createPhase("p6", "short_break", 6, new Date("2026-10-01T01:30:00Z")),
      createPhase("p7", "focus", 7),
    ];
    const { container } = render(
      createElement(PhaseProgress, {
        config,
        phases,
        allComplete: true,
      }),
    );
    const triggers = container.querySelectorAll(
      "[data-slot='tooltip-trigger']",
    );

    triggers.forEach((trigger) => {
      expect(trigger.className).not.toContain("shadow-[0_0_0_3px");
      expect(trigger.querySelector("span")?.className).toContain("opacity-70");
      expect(trigger.getAttribute("aria-current")).toBeNull();
    });
  });
});
