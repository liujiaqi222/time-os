import { z } from "zod";
import { timezoneSchema } from "./timezone";

export const sessionStatusSchema = z.enum([
  "active",
  "paused",
  "completed",
  "cancelled",
]);

export const timerModeSchema = z.enum(["stopwatch", "pomodoro"]);
export const timerConfigSchema = z
  .object({
    focusMinutes: z.number().int().min(1).max(180).default(25),
    shortBreakMinutes: z.number().int().min(1).max(180).default(5),
    longBreakMinutes: z.number().int().min(1).max(180).default(15),
    iterations: z.number().int().min(1).max(12).default(4),
    longBreakEnabled: z.boolean().default(true),
    soundEnabled: z.boolean().default(true),
  })
  .strict();
export type TimerConfig = z.output<typeof timerConfigSchema>;
export const sessionAdvanceSchema = z
  .object({
    id: z.string().uuid(),
    expectedPhaseId: z.string().uuid(),
    action: z.enum(["start_break", "start_next_focus"]),
  })
  .strict();
export type SessionAdvanceInput = z.input<typeof sessionAdvanceSchema>;

const instantSchema = z.string().datetime({ offset: true });
const nullableUuidSchema = z.string().uuid().nullable().optional();
const versionSchema = z.coerce.number().int().min(0);
const idempotencyKey = z.string().trim().min(1).max(200).optional();
const noteText = z.string().trim().max(20_000).nullable();
const intentText = z.string().trim().max(2_000).nullable();

/**
 * session_start (PRD §9.2): the execution object must be explicit.
 * Omitted or null taskId both mean goal-only; attaching a Task requires
 * its exact id. This deliberately does NOT reuse selection_set's
 * omitted-means-auto semantics.
 */
export const sessionStartSchema = z
  .object({
    goalId: z.string().uuid(),
    taskId: nullableUuidSchema,
    timerMode: timerModeSchema,
    intent: intentText.optional(),
    idempotencyKey,
  })
  .strict();

export const sessionPauseSchema = z.object({ id: z.string().uuid() });
export const sessionResumeSchema = z.object({ id: z.string().uuid() });

/** session_finish only ends and saves; task completion is a separate action. */
export const sessionFinishSchema = z
  .object({
    id: z.string().uuid(),
    note: noteText.optional(),
    noteExpectedVersion: versionSchema.optional(),
  })
  .strict();

export const sessionCancelSchema = z.object({ id: z.string().uuid() });

export const sessionNoteUpdateSchema = z
  .object({
    id: z.string().uuid(),
    note: noteText,
    expectedVersion: versionSchema,
  })
  .strict();

export const sessionResumeHintUpdateSchema = z
  .object({
    id: z.string().uuid(),
    resumeHint: noteText,
    expectedVersion: versionSchema,
  })
  .strict();

export const distractionCreateSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    text: z.string().trim().max(10_000).nullable().optional(),
  })
  .strict();

export const distractionUpdateSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().max(10_000).nullable().optional(),
});

export const distractionUpdateInputSchema = z.object({
  text: z.string().trim().max(10_000).nullable().optional(),
});

export const distractionArchiveSchema = z.object({ id: z.string().uuid() });

export const distractionListSchema = z.object({
  sessionId: z.string().uuid().optional(),
  includeArchived: z.boolean().default(false),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const dashboardQuerySchema = z.object({}).strict();

export const sessionListSchema = z.object({
  from: instantSchema.optional(),
  to: instantSchema.optional(),
  goalId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  status: sessionStatusSchema.optional(),
  entryMode: z.enum(["timer", "manual"]).optional(),
  createdVia: z.enum(["web", "mcp"]).optional(),
  includeCancelled: z.boolean().default(false),
  dateMode: z.enum(["started", "focus"]).default("started"),
  now: instantSchema.optional(),
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** Manual logging (PRD §7.3): Goal + positive duration, everything else optional. */
export const sessionLogSchema = z
  .object({
    goalId: z.string().uuid(),
    taskId: nullableUuidSchema,
    durationSeconds: z.coerce.number().int().positive().max(31_536_000),
    startedAt: instantSchema.optional(),
    endedAt: instantSchema.optional(),
    intent: intentText.optional(),
    note: noteText.optional(),
    resumeHint: noteText.optional(),
    allowOverlap: z.boolean().default(false),
    idempotencyKey,
  })
  .strict();

export const sessionUpdateSchema = z
  .object({
    id: z.string().uuid(),
    goalId: z.string().uuid().optional(),
    taskId: nullableUuidSchema,
    startedAt: instantSchema.optional(),
    endedAt: instantSchema.optional(),
    durationSeconds: z.coerce
      .number()
      .int()
      .positive()
      .max(31_536_000)
      .optional(),
    intent: intentText.optional(),
    note: noteText.optional(),
    expectedRevision: versionSchema.optional(),
    expectedNoteVersion: versionSchema.optional(),
    resumeHint: noteText.optional(),
    expectedResumeHintVersion: versionSchema.optional(),
    allowOverlap: z.boolean().default(false),
  })
  .strict();

export const statsQuerySchema = z
  .object({
    period: z
      .enum(["today", "week", "month", "custom", "all"])
      .default("today"),
    goalId: z.string().uuid().optional(),
    timezone: timezoneSchema.optional(),
    weekStartsOn: z.coerce.number().int().min(0).max(1).optional(),
    daily: z.boolean().default(false),
    from: z.string().optional(),
    to: z.string().optional(),
    now: instantSchema.optional(),
  })
  .superRefine((value, issue) => {
    if (value.period === "custom" && (!value.from || !value.to)) {
      issue.addIssue({
        code: "custom",
        message: "Custom statistics require both from and to.",
        path: [!value.from ? "from" : "to"],
      });
    }
  });

export type SessionStartInput = z.input<typeof sessionStartSchema>;
export type SessionFinishInput = z.input<typeof sessionFinishSchema>;
export type SessionNoteUpdateInput = z.input<typeof sessionNoteUpdateSchema>;
export type SessionResumeHintUpdateInput = z.input<
  typeof sessionResumeHintUpdateSchema
>;
export type DistractionCreateInput = z.input<typeof distractionCreateSchema>;
export type DistractionUpdateInput = z.input<
  typeof distractionUpdateInputSchema
>;
export type DistractionListInput = z.input<typeof distractionListSchema>;
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
export type SessionListInput = z.input<typeof sessionListSchema>;
export type SessionLogInput = z.input<typeof sessionLogSchema>;
export type SessionUpdateInput = z.input<typeof sessionUpdateSchema>;
export type StatsQueryInput = z.input<typeof statsQuerySchema>;
