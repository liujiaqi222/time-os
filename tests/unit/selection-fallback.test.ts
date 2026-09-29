import { describe, expect, it } from "vitest";

import {
  autoTaskIdForGoal,
  resolveExecutionTarget,
  type SelectionResolverInput,
} from "@/shared/selection";

/**
 * The §5.2 fallback table (PRD §5.2). Each case pins one rule of the
 * deterministic selection resolver, including the omitted-vs-null
 * difference in autoTaskIdForGoal.
 */

const candidates = (...ids: string[]) =>
  ids.map((id, index) => ({ id, position: index + 1 }));

const base: SelectionResolverInput = {
  openSession: null,
  stored: null,
  storedGoalActive: false,
  storedTaskPending: false,
  storedTaskPosition: null,
  storedGoalCandidates: [],
  recent: null,
  firstGoal: null,
};

describe("resolveExecutionTarget", () => {
  it("rule 1: an unfinished Session always wins", () => {
    expect(
      resolveExecutionTarget({
        ...base,
        openSession: { goalId: "g1", taskId: "t2" },
        stored: { goalId: "g2", taskId: null },
        storedGoalActive: true,
        firstGoal: { goalId: "g3", candidates: candidates("t9") },
      }),
    ).toEqual({
      goalId: "g1",
      taskId: "t2",
      reason: "active-session",
    });
  });

  it("rule 2: a valid stored selection is kept, including goal-only", () => {
    expect(
      resolveExecutionTarget({
        ...base,
        stored: { goalId: "g1", taskId: null },
        storedGoalActive: true,
      }),
    ).toEqual({
      goalId: "g1",
      taskId: null,
      reason: "explicit-selection",
    });
    expect(
      resolveExecutionTarget({
        ...base,
        stored: { goalId: "g1", taskId: "t2" },
        storedGoalActive: true,
        storedTaskPending: true,
        storedTaskPosition: 2,
        storedGoalCandidates: candidates("t1", "t2"),
      }),
    ).toEqual({
      goalId: "g1",
      taskId: "t2",
      reason: "explicit-selection",
    });
  });

  it("rule 3: a stale selected Task falls back inside the same Goal", () => {
    // Dense positions: t1=1, stale t2=2, t3=3, t4=4. The completed t2
    // keeps its position, so the next pending after position 2 is t3.
    const dense = [
      { id: "t1", position: 1 },
      { id: "t3", position: 3 },
      { id: "t4", position: 4 },
    ];
    expect(
      resolveExecutionTarget({
        ...base,
        stored: { goalId: "g1", taskId: "t2" },
        storedGoalActive: true,
        storedTaskPending: false,
        storedTaskPosition: 2,
        storedGoalCandidates: dense,
      }),
    ).toEqual({ goalId: "g1", taskId: "t3", reason: "task-fallback" });

    // No later pending → first pending in the Goal.
    expect(
      resolveExecutionTarget({
        ...base,
        stored: { goalId: "g1", taskId: "t3" },
        storedGoalActive: true,
        storedTaskPending: false,
        storedTaskPosition: 3,
        storedGoalCandidates: [
          { id: "t1", position: 1 },
          { id: "t4", position: 4 },
        ],
      }),
    ).toEqual({ goalId: "g1", taskId: "t4", reason: "task-fallback" });

    // No candidate at all → goal-only.
    expect(
      resolveExecutionTarget({
        ...base,
        stored: { goalId: "g1", taskId: "t1" },
        storedGoalActive: true,
        storedTaskPending: false,
        storedTaskPosition: 1,
        storedGoalCandidates: [],
      }),
    ).toEqual({ goalId: "g1", taskId: null, reason: "task-fallback" });
  });

  it("rule 3 does not apply under an inactive Goal — falls through to rule 4", () => {
    expect(
      resolveExecutionTarget({
        ...base,
        stored: { goalId: "g1", taskId: "t1" },
        storedGoalActive: false,
        storedTaskPosition: 1,
        storedGoalCandidates: candidates("t1"),
        recent: {
          goalId: "g2",
          taskId: "r1",
          goalActive: true,
          taskPending: true,
          candidates: candidates("r1"),
        },
      }),
    ).toEqual({ goalId: "g2", taskId: "r1", reason: "recent-goal" });
  });

  it("rule 4: the recent effective Session's Goal, its Task when still pending", () => {
    expect(
      resolveExecutionTarget({
        ...base,
        recent: {
          goalId: "g1",
          taskId: "t2",
          goalActive: true,
          taskPending: true,
          candidates: candidates("t1", "t2"),
        },
      }),
    ).toEqual({ goalId: "g1", taskId: "t2", reason: "recent-goal" });

    // Original Task no longer pending → first pending of that Goal.
    expect(
      resolveExecutionTarget({
        ...base,
        recent: {
          goalId: "g1",
          taskId: "t2",
          goalActive: true,
          taskPending: false,
          candidates: candidates("t1", "t3"),
        },
      }),
    ).toEqual({ goalId: "g1", taskId: "t1", reason: "recent-goal" });

    // A goal-only recent Session has no original Task: take the Goal's
    // first pending Task (PRD §5.2 rule 4 "否则取该目标第一个 pending Task").
    expect(
      resolveExecutionTarget({
        ...base,
        recent: {
          goalId: "g1",
          taskId: null,
          goalActive: true,
          taskPending: false,
          candidates: candidates("t1"),
        },
      }),
    ).toEqual({ goalId: "g1", taskId: "t1", reason: "recent-goal" });

    // No pending Task at all in the recent Goal → goal-only.
    expect(
      resolveExecutionTarget({
        ...base,
        recent: {
          goalId: "g1",
          taskId: "t2",
          goalActive: true,
          taskPending: false,
          candidates: [],
        },
      }),
    ).toEqual({ goalId: "g1", taskId: null, reason: "recent-goal" });
  });

  it("rule 5: first active Goal by position, first pending or goal-only", () => {
    expect(
      resolveExecutionTarget({
        ...base,
        firstGoal: { goalId: "g1", candidates: candidates("t2", "t1") },
      }),
    ).toEqual({ goalId: "g1", taskId: "t2", reason: "first-goal" });
    expect(
      resolveExecutionTarget({
        ...base,
        firstGoal: { goalId: "g1", candidates: [] },
      }),
    ).toEqual({ goalId: "g1", taskId: null, reason: "first-goal" });
  });

  it("returns null when there is nothing executable at all", () => {
    expect(resolveExecutionTarget(base)).toBeNull();
  });
});

describe("autoTaskIdForGoal", () => {
  it("prefers the recent effective Session's pending Task", () => {
    expect(
      autoTaskIdForGoal({
        recentTask: { taskId: "t2", taskPending: true },
        firstPendingTaskId: "t1",
      }),
    ).toBe("t2");
  });

  it("falls back to the first pending Task when the recent one is done", () => {
    expect(
      autoTaskIdForGoal({
        recentTask: { taskId: "t2", taskPending: false },
        firstPendingTaskId: "t1",
      }),
    ).toBe("t1");
    expect(
      autoTaskIdForGoal({
        recentTask: null,
        firstPendingTaskId: "t1",
      }),
    ).toBe("t1");
  });

  it("goal-only when the Goal has no pending Task", () => {
    expect(
      autoTaskIdForGoal({
        recentTask: { taskId: "t2", taskPending: false },
        firstPendingTaskId: null,
      }),
    ).toBeNull();
  });
});
