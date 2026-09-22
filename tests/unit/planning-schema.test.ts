import { describe, expect, it } from "vitest";

import { taskDraftSchema, tasksCreateSchema } from "@/shared/schemas/planning";

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

  it("accepts batches from 1 through 50 only", () => {
    const trackId = "09d86df4-8d8c-4fc2-a718-c72b475b23e2";
    expect(tasksCreateSchema.safeParse({ trackId, tasks: [] }).success).toBe(
      false,
    );
    expect(
      tasksCreateSchema.safeParse({
        trackId,
        tasks: Array.from({ length: 50 }, (_, index) => ({
          title: `Task ${index}`,
        })),
      }).success,
    ).toBe(true);
    expect(
      tasksCreateSchema.safeParse({
        trackId,
        tasks: Array.from({ length: 51 }, (_, index) => ({
          title: `Task ${index}`,
        })),
      }).success,
    ).toBe(false);
  });
});
