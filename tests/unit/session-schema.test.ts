import { describe, expect, it } from "vitest";

import {
  distractionCreateSchema,
  sessionFinishSchema,
  sessionNoteUpdateSchema,
  sessionResumeHintUpdateSchema,
  sessionStartSchema,
  sessionLogSchema,
} from "@/shared/schemas/session";

const goalId = "123e4567-e89b-12d3-a456-426614174000";
const taskId = "123e4567-e89b-12d3-a456-426614174001";
const sessionId = "123e4567-e89b-12d3-a456-426614174002";

describe("session schemas", () => {
  it("accepts a goal-direct stopwatch start with an explicit Task", () => {
    const valid = sessionStartSchema.safeParse({
      goalId,
      taskId,
      timerMode: "stopwatch",
      intent: "写初稿",
      idempotencyKey: "key-123",
    });
    expect(valid.success).toBe(true);
  });

  it("treats both omitted and null taskId as goal-only", () => {
    expect(
      sessionStartSchema.safeParse({ goalId, timerMode: "stopwatch" }).success,
    ).toBe(true);
    expect(
      sessionStartSchema.safeParse({
        goalId,
        taskId: null,
        timerMode: "stopwatch",
      }).success,
    ).toBe(true);
  });

  it("requires goalId and rejects the removed trackId field", () => {
    expect(
      sessionStartSchema.safeParse({ timerMode: "stopwatch" }).success,
    ).toBe(false);
    expect(
      sessionStartSchema.safeParse({
        trackId: taskId,
        goalId,
        timerMode: "stopwatch",
      }).success,
    ).toBe(false);
  });

  it("accepts pomodoro with the same Goal/Task contract", () => {
    expect(
      sessionStartSchema.safeParse({
        goalId,
        timerMode: "pomodoro",
      }).success,
    ).toBe(true);
  });

  it("session_finish ends only — the legacy outcome field is rejected", () => {
    expect(
      sessionFinishSchema.safeParse({ id: sessionId, note: "All done" })
        .success,
    ).toBe(true);
    expect(
      sessionFinishSchema.safeParse({
        id: sessionId,
        outcome: "completed",
      }).success,
    ).toBe(false);
  });

  it("note and hint updates carry a required expected version", () => {
    expect(
      sessionNoteUpdateSchema.safeParse({ id: sessionId, note: "text" })
        .success,
    ).toBe(false);
    expect(
      sessionNoteUpdateSchema.safeParse({
        id: sessionId,
        note: "text",
        expectedVersion: 3,
      }).success,
    ).toBe(true);
    expect(
      sessionResumeHintUpdateSchema.safeParse({
        id: sessionId,
        resumeHint: null,
        expectedVersion: 0,
      }).success,
    ).toBe(true);
  });

  it("manual log requires a Goal and a positive duration", () => {
    expect(
      sessionLogSchema.safeParse({ goalId, durationSeconds: 1800 }).success,
    ).toBe(true);
    expect(
      sessionLogSchema.safeParse({ goalId, durationSeconds: 0 }).success,
    ).toBe(false);
    expect(
      sessionLogSchema.safeParse({
        trackId: goalId,
        durationSeconds: 1800,
      }).success,
    ).toBe(false);
  });

  it("validates distraction creation allowing empty text", () => {
    expect(distractionCreateSchema.safeParse({}).success).toBe(true);
    expect(
      distractionCreateSchema.safeParse({ text: "Email arrived" }).success,
    ).toBe(true);
  });
});
