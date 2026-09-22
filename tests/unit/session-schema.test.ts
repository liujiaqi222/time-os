import { describe, expect, it } from "vitest";

import {
  distractionCreateSchema,
  sessionFinishSchema,
  sessionReviewSchema,
  sessionStartSchema,
} from "@/shared/schemas/session";

describe("session schemas", () => {
  it("validates valid session start input", () => {
    const valid = sessionStartSchema.safeParse({
      trackId: "123e4567-e89b-12d3-a456-426614174000",
      taskId: "123e4567-e89b-12d3-a456-426614174001",
      plannedMinutes: 25,
      idempotencyKey: "key-123",
    });
    expect(valid.success).toBe(true);
  });

  it("allows session start without task or plannedMinutes", () => {
    const valid = sessionStartSchema.safeParse({
      trackId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(valid.success).toBe(true);
  });

  it("rejects non-positive plannedMinutes", () => {
    const invalid = sessionStartSchema.safeParse({
      trackId: "123e4567-e89b-12d3-a456-426614174000",
      plannedMinutes: 0,
    });
    expect(invalid.success).toBe(false);
  });

  it("validates session review input with outcomes", () => {
    for (const outcome of ["continue_later", "completed", "skip"] as const) {
      const valid = sessionReviewSchema.safeParse({
        sessionId: "123e4567-e89b-12d3-a456-426614174000",
        note: "Good progress",
        outcome,
      });
      expect(valid.success).toBe(true);
    }
  });

  it("validates session finish input", () => {
    const valid = sessionFinishSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      note: "All done",
      outcome: "completed",
    });
    expect(valid.success).toBe(true);
  });

  it("validates distraction creation allowing empty text", () => {
    const validEmpty = distractionCreateSchema.safeParse({});
    expect(validEmpty.success).toBe(true);

    const validWithText = distractionCreateSchema.safeParse({
      text: "Email arrived",
    });
    expect(validWithText.success).toBe(true);
  });
});
