import { describe, expect, it } from "vitest";

import {
  taskDraftSchema,
  tasksCreateSchema,
  selectionSetSchema,
  goalCreateSchema,
} from "@/shared/schemas/planning";

const goalId = "09d86df4-8d8c-4fc2-a718-c72b475b23e2";

describe("planning schemas", () => {
  it("requires positive estimates and paired resources", () => {
    expect(
      taskDraftSchema.safeParse({ title: "Task", estimatedMinutes: 0 }).success,
    ).toBe(false);
    expect(
      taskDraftSchema.safeParse({ title: "Task", resourceType: "text" })
        .success,
    ).toBe(false);
    expect(
      taskDraftSchema.safeParse({
        title: "Task",
        resourceType: "url",
        resourceValue: "https://example.com",
      }).success,
    ).toBe(true);
  });

  it("accepts batches from 1 through 50 only, keyed to a Goal", () => {
    expect(tasksCreateSchema.safeParse({ goalId, tasks: [] }).success).toBe(
      false,
    );
    expect(
      tasksCreateSchema.safeParse({
        goalId,
        tasks: Array.from({ length: 50 }, (_, index) => ({
          title: `Task ${index}`,
        })),
      }).success,
    ).toBe(true);
    expect(
      tasksCreateSchema.safeParse({
        goalId,
        tasks: Array.from({ length: 51 }, (_, index) => ({
          title: `Task ${index}`,
        })),
      }).success,
    ).toBe(false);
  });

  it("rejects the removed trackId field instead of ignoring it", () => {
    const result = tasksCreateSchema.safeParse({
      trackId: goalId,
      tasks: [{ title: "Task" }],
    });
    expect(result.success).toBe(false);
  });

  it("goal create accepts only the v3 fields", () => {
    expect(
      goalCreateSchema.safeParse({ title: "Ship it", idempotencyKey: "k1" })
        .success,
    ).toBe(true);
    expect(
      goalCreateSchema.safeParse({
        title: "Ship it",
        trackId: goalId,
      }).success,
    ).toBe(false);
  });

  it("selection_set keeps omitted and null taskId distinct", () => {
    // Omitted: the caller wants auto-resolution inside the Goal.
    expect(selectionSetSchema.safeParse({ goalId }).success).toBe(true);
    // Explicit null: goal-only execution.
    const parsed = selectionSetSchema.parse({ goalId, taskId: null });
    expect(parsed.taskId).toBeNull();
    // A pinned Task must be a uuid.
    expect(
      selectionSetSchema.safeParse({
        goalId,
        taskId: "09d86df4-8d8c-4fc2-a718-c72b475b23e2",
      }).success,
    ).toBe(true);
    expect(
      selectionSetSchema.safeParse({ goalId, taskId: "not-a-uuid" }).success,
    ).toBe(false);
  });
});
