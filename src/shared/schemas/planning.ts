import { z } from "zod";

const title = z.string().trim().min(1).max(240);
const description = z.string().trim().max(10_000).nullable().optional();
const idempotencyKey = z.string().trim().min(1).max(200).optional();

export const parentStatusSchema = z.enum(["active", "completed", "archived"]);
export const taskStatusSchema = z.enum([
  "pending",
  "completed",
  "skipped",
  "archived",
]);

export const listSchema = z.object({
  status: z.string().optional(),
  includeArchived: z.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
});

export const goalCreateSchema = z
  .object({ title, description, idempotencyKey })
  .strict();
export const goalUpdateSchema = z
  .object({
    id: z.string().uuid(),
    title: title.optional(),
    description,
    status: parentStatusSchema.optional(),
  })
  .refine(
    ({ title, description, status }) =>
      title !== undefined || description !== undefined || status !== undefined,
    "At least one field is required.",
  );

export const resourceSchema = z
  .object({
    resourceType: z.enum(["url", "text"]).nullable().optional(),
    resourceValue: z.string().trim().max(20_000).nullable().optional(),
  })
  .superRefine(({ resourceType, resourceValue }, context) => {
    if ((resourceType == null) !== (resourceValue == null)) {
      context.addIssue({
        code: "custom",
        message: "Resource type and value must be set or cleared together.",
      });
    }
    if (resourceType === "url" && resourceValue) {
      try {
        const url = new URL(resourceValue);
        if (url.protocol !== "http:" && url.protocol !== "https:")
          throw new Error();
      } catch {
        context.addIssue({
          code: "custom",
          message: "Resource URL must use http or https.",
        });
      }
    }
  });

export const taskDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    description: z.string().trim().max(10_000).nullable().optional(),
    estimatedMinutes: z.coerce
      .number()
      .int()
      .positive()
      .max(100_000)
      .nullable()
      .optional(),
    note: z.string().trim().max(20_000).nullable().optional(),
  })
  .and(resourceSchema);

export const tasksCreateSchema = z
  .object({
    goalId: z.string().uuid(),
    tasks: z.array(taskDraftSchema).min(1).max(50),
    idempotencyKey,
  })
  .strict();

export const taskUpdateSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().trim().min(1).max(500).optional(),
    description: z.string().trim().max(10_000).nullable().optional(),
    estimatedMinutes: z.coerce
      .number()
      .int()
      .positive()
      .max(100_000)
      .nullable()
      .optional(),
    note: z.string().trim().max(20_000).nullable().optional(),
  })
  .and(resourceSchema)
  .refine(
    (value) => Object.keys(value).some((key) => key !== "id"),
    "At least one field is required.",
  );

export const reorderSchema = z.object({
  parentId: z.string().uuid().nullable().optional(),
  ids: z.array(z.string().uuid()).min(1),
});

export const taskTransitionSchema = z.object({ id: z.string().uuid() });

/**
 * selection_set semantics (PRD §3.5 / §5.2):
 * - taskId omitted  → auto-resolve the next Task inside the Goal;
 * - taskId = null   → explicit goal-only execution;
 * - taskId = <uuid> → that exact pending Task.
 */
export const selectionSetSchema = z
  .object({
    goalId: z.string().uuid(),
    taskId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const selectionClearSchema = z.object({}).strict();

export type GoalCreateInput = z.input<typeof goalCreateSchema>;
export type GoalUpdateInput = z.input<typeof goalUpdateSchema>;
export type TasksCreateInput = z.input<typeof tasksCreateSchema>;
export type TaskUpdateInput = z.input<typeof taskUpdateSchema>;
export type SelectionSetInput = z.input<typeof selectionSetSchema>;
export type ListInput = z.input<typeof listSchema>;
