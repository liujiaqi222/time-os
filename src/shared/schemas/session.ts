import { z } from "zod";

export const sessionStatusSchema = z.enum([
  "active",
  "paused",
  "completed",
  "cancelled",
]);

export const sessionOutcomeSchema = z.enum([
  "continue_later",
  "completed",
  "skip",
]);

export const sessionStartSchema = z.object({
  trackId: z.string().uuid(),
  taskId: z.string().uuid().nullable().optional(),
  plannedMinutes: z.coerce
    .number()
    .int()
    .positive()
    .max(100_000)
    .nullable()
    .optional(),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const sessionPauseSchema = z.object({
  id: z.string().uuid(),
});

export const sessionResumeSchema = z.object({
  id: z.string().uuid(),
});

export const sessionFinishSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().max(20_000).nullable().optional(),
  outcome: sessionOutcomeSchema.optional(),
});

export const sessionFinishInputSchema = z.object({
  note: z.string().trim().max(20_000).nullable().optional(),
});

export const sessionCancelSchema = z.object({
  id: z.string().uuid(),
});

export const sessionNoteUpdateSchema = z.object({
  id: z.string().uuid(),
  note: z.string().trim().max(20_000).nullable().optional(),
});

export const sessionReviewSchema = z.object({
  sessionId: z.string().uuid(),
  note: z.string().trim().max(20_000).nullable().optional(),
  outcome: sessionOutcomeSchema,
});

export const distractionCreateSchema = z.object({
  sessionId: z.string().uuid().optional(),
  text: z.string().trim().max(10_000).nullable().optional(),
});

export const distractionUpdateSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().max(10_000).nullable().optional(),
});

export const distractionUpdateInputSchema = z.object({
  text: z.string().trim().max(10_000).nullable().optional(),
});

export const distractionArchiveSchema = z.object({
  id: z.string().uuid(),
});

export const distractionListSchema = z.object({
  sessionId: z.string().uuid().optional(),
  includeArchived: z.boolean().default(false),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export const dashboardQuerySchema = z.object({
  targetDate: z.string().optional(),
  manualTrackId: z.string().uuid().optional(),
});

const instantSchema = z.string().datetime({ offset: true });
const nullableUuidSchema = z.string().uuid().nullable().optional();

export const sessionListSchema = z.object({
  from: instantSchema.optional(),
  to: instantSchema.optional(),
  trackId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  status: sessionStatusSchema.optional(),
  entryMode: z.enum(["timer", "manual"]).optional(),
  createdVia: z.enum(["web", "mcp"]).optional(),
  includeCancelled: z.boolean().default(false),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const sessionLogSchema = z.object({
  trackId: z.string().uuid(),
  taskId: nullableUuidSchema,
  durationSeconds: z.coerce.number().int().positive().max(31_536_000),
  endedAt: instantSchema.optional(),
  plannedMinutes: z.coerce
    .number()
    .int()
    .positive()
    .max(100_000)
    .nullable()
    .optional(),
  note: z.string().trim().max(20_000).nullable().optional(),
  allowOverlap: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
});

export const sessionUpdateSchema = z.object({
  id: z.string().uuid(),
  trackId: z.string().uuid().optional(),
  taskId: nullableUuidSchema,
  startedAt: instantSchema.optional(),
  endedAt: instantSchema.optional(),
  durationSeconds: z.coerce
    .number()
    .int()
    .positive()
    .max(31_536_000)
    .optional(),
  plannedMinutes: z.coerce
    .number()
    .int()
    .positive()
    .max(100_000)
    .nullable()
    .optional(),
  note: z.string().trim().max(20_000).nullable().optional(),
  allowOverlap: z.boolean().default(false),
});

export const statsQuerySchema = z
  .object({
    period: z.enum(["today", "week", "month", "custom"]).default("today"),
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

export type SessionOutcome = z.infer<typeof sessionOutcomeSchema>;
export type SessionStartInput = z.input<typeof sessionStartSchema>;
export type SessionFinishInput = z.input<typeof sessionFinishInputSchema>;
export type SessionReviewInput = z.input<typeof sessionReviewSchema>;
export type SessionNoteUpdateInput = z.input<typeof sessionNoteUpdateSchema>;
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
