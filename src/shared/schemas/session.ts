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
});

export const dashboardQuerySchema = z.object({
  targetDate: z.string().optional(),
  manualTrackId: z.string().uuid().optional(),
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
