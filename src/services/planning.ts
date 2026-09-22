import { createHash } from "node:crypto";

import { and, asc, eq, gt, inArray, ne, sql } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import {
  goals,
  idempotencyRecords,
  sessions,
  tasks,
  tracks,
} from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  goalCreateSchema,
  goalUpdateSchema,
  listSchema,
  nextSetSchema,
  parentStatusSchema,
  reorderSchema,
  taskStatusSchema,
  tasksCreateSchema,
  taskTransitionSchema,
  taskUpdateSchema,
  trackCreateSchema,
  trackUpdateSchema,
  type GoalCreateInput,
  type GoalUpdateInput,
  type ListInput,
  type TasksCreateInput,
  type TaskUpdateInput,
  type TrackCreateInput,
  type TrackUpdateInput,
} from "@/shared/schemas/planning";

export type Goal = typeof goals.$inferSelect;
export type Track = typeof tracks.$inferSelect;
export type Task = typeof tasks.$inferSelect;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface TaskTransitionResult {
  affectedTask: Task;
  nextTask: Task | null;
}

export interface PlanningService {
  listGoals(
    context: AuthenticatedContext,
    input?: ListInput,
  ): Promise<Page<Goal>>;
  createGoal(
    context: AuthenticatedContext,
    input: GoalCreateInput,
  ): Promise<Goal>;
  updateGoal(
    context: AuthenticatedContext,
    input: GoalUpdateInput,
  ): Promise<Goal>;
  reorderGoals(context: AuthenticatedContext, ids: string[]): Promise<Goal[]>;
  listTracks(
    context: AuthenticatedContext,
    goalId: string,
    input?: ListInput,
  ): Promise<Page<Track>>;
  getTrack(context: AuthenticatedContext, id: string): Promise<Track>;
  createTrack(
    context: AuthenticatedContext,
    input: TrackCreateInput,
  ): Promise<Track>;
  updateTrack(
    context: AuthenticatedContext,
    input: TrackUpdateInput,
  ): Promise<Track>;
  reorderTracks(
    context: AuthenticatedContext,
    goalId: string,
    ids: string[],
  ): Promise<Track[]>;
  listTasks(
    context: AuthenticatedContext,
    trackId: string,
    input?: ListInput,
  ): Promise<Page<Task>>;
  createTasks(
    context: AuthenticatedContext,
    input: TasksCreateInput,
  ): Promise<Task[]>;
  updateTask(
    context: AuthenticatedContext,
    input: TaskUpdateInput,
  ): Promise<Task>;
  reorderTasks(
    context: AuthenticatedContext,
    trackId: string,
    ids: string[],
  ): Promise<Task[]>;
  completeTask(
    context: AuthenticatedContext,
    id: string,
  ): Promise<TaskTransitionResult>;
  skipTask(
    context: AuthenticatedContext,
    id: string,
  ): Promise<TaskTransitionResult>;
  archiveTask(
    context: AuthenticatedContext,
    id: string,
  ): Promise<TaskTransitionResult>;
  reopenTask(
    context: AuthenticatedContext,
    id: string,
  ): Promise<TaskTransitionResult>;
  getNext(
    context: AuthenticatedContext,
    trackId?: string,
  ): Promise<Task | null | Array<{ track: Track; task: Task | null }>>;
  setNext(
    context: AuthenticatedContext,
    trackId: string,
    taskId: string | null,
  ): Promise<Task | null>;
}

function invalid(message: string, field?: string): never {
  throw new DomainError(
    "INVALID_INPUT",
    message,
    field ? { field } : undefined,
  );
}

function parsed<T>(
  result:
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: Array<{ message: string; path: PropertyKey[] }> };
      },
): T {
  if (!result.success) {
    invalid(
      result.error.issues[0]?.message ?? "Invalid input.",
      result.error.issues[0]?.path.join("."),
    );
  }
  return result.data;
}

async function lockScope(tx: Transaction, scope: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope}))`);
}

async function ensureNoRunningSession(
  tx: Transaction,
  goalId?: string,
  trackId?: string,
): Promise<void> {
  const conditions = [inArray(sessions.status, ["active", "paused"] as const)];
  if (trackId) conditions.push(eq(sessions.trackId, trackId));
  if (goalId) {
    const rows = await tx
      .select({ id: sessions.id })
      .from(sessions)
      .innerJoin(tracks, eq(sessions.trackId, tracks.id))
      .where(and(eq(tracks.goalId, goalId), ...conditions))
      .limit(1);
    if (rows.length)
      throw new DomainError(
        "PARENT_HAS_ACTIVE_SESSION",
        "Finish or cancel the running session first.",
      );
    return;
  }
  const rows = await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(...conditions))
    .limit(1);
  if (rows.length)
    throw new DomainError(
      "PARENT_HAS_ACTIVE_SESSION",
      "Finish or cancel the running session first.",
    );
}

async function assertCompleteOrder(
  tx: Transaction,
  table: typeof goals | typeof tracks | typeof tasks,
  ids: string[],
  condition?: ReturnType<typeof eq>,
): Promise<void> {
  if (new Set(ids).size !== ids.length)
    throw new DomainError(
      "INVALID_POSITION_ORDER",
      "Order contains duplicate IDs.",
    );
  const rows = await tx.select({ id: table.id }).from(table).where(condition);
  const actual = new Set(rows.map((row) => row.id));
  if (actual.size !== ids.length || ids.some((id) => !actual.has(id))) {
    throw new DomainError(
      "INVALID_POSITION_ORDER",
      "Order must contain every item in the container exactly once.",
    );
  }
}

export function createPlanningService(database: Database): PlanningService {
  const contextUnused = (_context: AuthenticatedContext) => void _context;

  async function currentForTrack(
    tx: Transaction,
    trackId: string,
  ): Promise<Task | null> {
    const [row] = await tx
      .select({ task: tasks })
      .from(tracks)
      .leftJoin(tasks, eq(tracks.currentTaskId, tasks.id))
      .where(eq(tracks.id, trackId))
      .limit(1);
    return row?.task ?? null;
  }

  async function transition(
    id: string,
    status: "completed" | "skipped" | "archived",
  ): Promise<TaskTransitionResult> {
    parsed(taskTransitionSchema.safeParse({ id }));
    return database.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);
      if (!existing)
        throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
          taskId: id,
        });
      await lockScope(tx, `track:${existing.trackId}`);
      const [fresh] = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);
      if (!fresh)
        throw new DomainError("TASK_NOT_FOUND", "Task was not found.");
      if (fresh.status !== "pending") {
        throw new DomainError(
          fresh.status === "completed"
            ? "TASK_ALREADY_COMPLETED"
            : "TASK_NOT_PENDING",
          "Only a pending task can change to this status.",
        );
      }
      const [track] = await tx
        .select()
        .from(tracks)
        .where(eq(tracks.id, fresh.trackId))
        .limit(1);
      const [affectedTask] = await tx
        .update(tasks)
        .set({
          status,
          completedAt: status === "completed" ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, id))
        .returning();
      if (!affectedTask)
        throw new DomainError("TASK_NOT_FOUND", "Task was not found.");

      let nextTask = track?.currentTaskId
        ? await currentForTrack(tx, fresh.trackId)
        : null;
      if (track?.currentTaskId === id) {
        [nextTask] = await tx
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.trackId, fresh.trackId),
              eq(tasks.status, "pending"),
              gt(tasks.position, fresh.position),
            ),
          )
          .orderBy(asc(tasks.position))
          .limit(1);
        await tx
          .update(tracks)
          .set({ currentTaskId: nextTask?.id ?? null, updatedAt: new Date() })
          .where(eq(tracks.id, fresh.trackId));
      }
      return { affectedTask, nextTask: nextTask ?? null };
    });
  }

  return {
    async listGoals(context, input = {}) {
      contextUnused(context);
      const query = parsed(listSchema.safeParse(input));
      const status = query.status
        ? parsed(parentStatusSchema.safeParse(query.status))
        : undefined;
      const conditions = [
        ...(status
          ? [eq(goals.status, status)]
          : query.includeArchived
            ? []
            : [eq(goals.status, "active" as const)]),
      ];
      if (query.cursor) {
        const [cursor] = await database
          .select({ position: goals.position })
          .from(goals)
          .where(eq(goals.id, query.cursor))
          .limit(1);
        if (cursor) conditions.push(gt(goals.position, cursor.position));
      }
      const rows = await database
        .select()
        .from(goals)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(asc(goals.position))
        .limit(query.limit + 1);
      return {
        items: rows.slice(0, query.limit),
        nextCursor:
          rows.length > query.limit
            ? (rows[query.limit - 1]?.id ?? null)
            : null,
      };
    },

    async createGoal(context, input) {
      contextUnused(context);
      const value = parsed(goalCreateSchema.safeParse(input));
      return database.transaction(async (tx) => {
        await lockScope(tx, "goals:order");
        const [last] = await tx
          .select({ position: goals.position })
          .from(goals)
          .orderBy(sql`${goals.position} desc`)
          .limit(1);
        const [goal] = await tx
          .insert(goals)
          .values({
            ...value,
            description: value.description ?? null,
            position: (last?.position ?? 0) + 1,
          })
          .returning();
        return goal!;
      });
    },

    async updateGoal(context, input) {
      contextUnused(context);
      const value = parsed(goalUpdateSchema.safeParse(input));
      return database.transaction(async (tx) => {
        await lockScope(tx, `goal:${value.id}`);
        const [existing] = await tx
          .select()
          .from(goals)
          .where(eq(goals.id, value.id))
          .limit(1);
        if (!existing)
          throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", {
            goalId: value.id,
          });
        if (
          value.status &&
          value.status !== "active" &&
          value.status !== existing.status
        )
          await ensureNoRunningSession(tx, value.id);
        const [goal] = await tx
          .update(goals)
          .set({ ...value, id: undefined, updatedAt: new Date() })
          .where(eq(goals.id, value.id))
          .returning();
        return goal!;
      });
    },

    async reorderGoals(context, ids) {
      contextUnused(context);
      const value = parsed(reorderSchema.safeParse({ ids }));
      return database.transaction(async (tx) => {
        await lockScope(tx, "goals:order");
        await assertCompleteOrder(tx, goals, value.ids);
        const offset = value.ids.length + 10_000;
        for (const [index, id] of value.ids.entries())
          await tx
            .update(goals)
            .set({ position: offset + index, updatedAt: new Date() })
            .where(eq(goals.id, id));
        for (const [index, id] of value.ids.entries())
          await tx
            .update(goals)
            .set({ position: index + 1, updatedAt: new Date() })
            .where(eq(goals.id, id));
        return tx.select().from(goals).orderBy(asc(goals.position));
      });
    },

    async listTracks(context, goalId, input = {}) {
      contextUnused(context);
      const query = parsed(listSchema.safeParse(input));
      const status = query.status
        ? parsed(parentStatusSchema.safeParse(query.status))
        : undefined;
      const conditions = [
        eq(tracks.goalId, goalId),
        ...(status
          ? [eq(tracks.status, status)]
          : query.includeArchived
            ? []
            : [eq(tracks.status, "active" as const)]),
      ];
      if (query.cursor) {
        const [cursor] = await database
          .select({ position: tracks.position })
          .from(tracks)
          .where(and(eq(tracks.id, query.cursor), eq(tracks.goalId, goalId)))
          .limit(1);
        if (cursor) conditions.push(gt(tracks.position, cursor.position));
      }
      const rows = await database
        .select()
        .from(tracks)
        .where(and(...conditions))
        .orderBy(asc(tracks.position))
        .limit(query.limit + 1);
      return {
        items: rows.slice(0, query.limit),
        nextCursor:
          rows.length > query.limit
            ? (rows[query.limit - 1]?.id ?? null)
            : null,
      };
    },

    async getTrack(context, id) {
      contextUnused(context);
      const [track] = await database
        .select()
        .from(tracks)
        .where(eq(tracks.id, id))
        .limit(1);
      if (!track)
        throw new DomainError("TRACK_NOT_FOUND", "Track was not found.", {
          trackId: id,
        });
      return track;
    },

    async createTrack(context, input) {
      contextUnused(context);
      const value = parsed(trackCreateSchema.safeParse(input));
      return database.transaction(async (tx) => {
        await lockScope(tx, `tracks:${value.goalId}`);
        const [goal] = await tx
          .select()
          .from(goals)
          .where(eq(goals.id, value.goalId))
          .limit(1);
        if (!goal)
          throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", {
            goalId: value.goalId,
          });
        const [last] = await tx
          .select({ position: tracks.position })
          .from(tracks)
          .where(eq(tracks.goalId, value.goalId))
          .orderBy(sql`${tracks.position} desc`)
          .limit(1);
        const [track] = await tx
          .insert(tracks)
          .values({
            ...value,
            description: value.description ?? null,
            position: (last?.position ?? 0) + 1,
          })
          .returning();
        return track!;
      });
    },

    async updateTrack(context, input) {
      contextUnused(context);
      const value = parsed(trackUpdateSchema.safeParse(input));
      return database.transaction(async (tx) => {
        await lockScope(tx, `track:${value.id}`);
        const [existing] = await tx
          .select()
          .from(tracks)
          .where(eq(tracks.id, value.id))
          .limit(1);
        if (!existing)
          throw new DomainError("TRACK_NOT_FOUND", "Track was not found.", {
            trackId: value.id,
          });
        if (
          value.status &&
          value.status !== "active" &&
          value.status !== existing.status
        )
          await ensureNoRunningSession(tx, undefined, value.id);
        const [track] = await tx
          .update(tracks)
          .set({ ...value, id: undefined, updatedAt: new Date() })
          .where(eq(tracks.id, value.id))
          .returning();
        return track!;
      });
    },

    async reorderTracks(context, goalId, ids) {
      contextUnused(context);
      const value = parsed(reorderSchema.safeParse({ parentId: goalId, ids }));
      return database.transaction(async (tx) => {
        await lockScope(tx, `tracks:${goalId}`);
        await assertCompleteOrder(
          tx,
          tracks,
          value.ids,
          eq(tracks.goalId, goalId),
        );
        const [max] = await tx
          .select({ value: sql<number>`coalesce(max(${tracks.position}), 0)` })
          .from(tracks)
          .where(eq(tracks.goalId, goalId));
        for (const [index, id] of value.ids.entries())
          await tx
            .update(tracks)
            .set({
              position: Number(max?.value ?? 0) + index + 1,
              updatedAt: new Date(),
            })
            .where(eq(tracks.id, id));
        for (const [index, id] of value.ids.entries())
          await tx
            .update(tracks)
            .set({ position: index + 1, updatedAt: new Date() })
            .where(eq(tracks.id, id));
        return tx
          .select()
          .from(tracks)
          .where(eq(tracks.goalId, goalId))
          .orderBy(asc(tracks.position));
      });
    },

    async listTasks(context, trackId, input = {}) {
      contextUnused(context);
      const query = parsed(listSchema.safeParse(input));
      const status = query.status
        ? parsed(taskStatusSchema.safeParse(query.status))
        : undefined;
      const conditions = [
        eq(tasks.trackId, trackId),
        ...(status
          ? [eq(tasks.status, status)]
          : query.includeArchived
            ? []
            : [ne(tasks.status, "archived" as const)]),
      ];
      if (query.cursor) {
        const [cursor] = await database
          .select({ position: tasks.position })
          .from(tasks)
          .where(and(eq(tasks.id, query.cursor), eq(tasks.trackId, trackId)))
          .limit(1);
        if (cursor) conditions.push(gt(tasks.position, cursor.position));
      }
      const rows = await database
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(asc(tasks.position))
        .limit(query.limit + 1);
      return {
        items: rows.slice(0, query.limit),
        nextCursor:
          rows.length > query.limit
            ? (rows[query.limit - 1]?.id ?? null)
            : null,
      };
    },

    async createTasks(context, input) {
      contextUnused(context);
      const value = parsed(tasksCreateSchema.safeParse(input));
      const requestHash = createHash("sha256")
        .update(JSON.stringify({ trackId: value.trackId, tasks: value.tasks }))
        .digest("hex");
      return database.transaction(async (tx) => {
        await lockScope(tx, `track:${value.trackId}`);
        const [track] = await tx
          .select()
          .from(tracks)
          .where(eq(tracks.id, value.trackId))
          .limit(1);
        if (!track)
          throw new DomainError("TRACK_NOT_FOUND", "Track was not found.", {
            trackId: value.trackId,
          });

        if (value.idempotencyKey) {
          const inserted = await tx
            .insert(idempotencyRecords)
            .values({
              operation: "tasks_create",
              key: value.idempotencyKey,
              requestHash,
            })
            .onConflictDoNothing()
            .returning();
          if (!inserted.length) {
            const [record] = await tx
              .select()
              .from(idempotencyRecords)
              .where(
                and(
                  eq(idempotencyRecords.operation, "tasks_create"),
                  eq(idempotencyRecords.key, value.idempotencyKey),
                ),
              )
              .limit(1);
            if (!record || record.requestHash !== requestHash)
              throw new DomainError(
                "IDEMPOTENCY_KEY_REUSED",
                "This idempotency key was already used with a different payload.",
              );
            const taskIds =
              (record.result as { taskIds?: string[] } | null)?.taskIds ?? [];
            return taskIds.length
              ? tx
                  .select()
                  .from(tasks)
                  .where(inArray(tasks.id, taskIds))
                  .orderBy(asc(tasks.position))
              : [];
          }
        }

        const [last] = await tx
          .select({ position: tasks.position })
          .from(tasks)
          .where(eq(tasks.trackId, value.trackId))
          .orderBy(sql`${tasks.position} desc`)
          .limit(1);
        const created = await tx
          .insert(tasks)
          .values(
            value.tasks.map((task, index) => ({
              ...task,
              description: task.description ?? null,
              estimatedMinutes: task.estimatedMinutes ?? null,
              resourceType: task.resourceType ?? null,
              resourceValue: task.resourceValue ?? null,
              note: task.note ?? null,
              trackId: value.trackId,
              position: (last?.position ?? 0) + index + 1,
            })),
          )
          .returning();
        if (!track.currentTaskId && created[0])
          await tx
            .update(tracks)
            .set({ currentTaskId: created[0].id, updatedAt: new Date() })
            .where(eq(tracks.id, track.id));
        if (value.idempotencyKey)
          await tx
            .update(idempotencyRecords)
            .set({
              resultRef: created[0]?.id,
              result: { taskIds: created.map((task) => task.id) },
            })
            .where(
              and(
                eq(idempotencyRecords.operation, "tasks_create"),
                eq(idempotencyRecords.key, value.idempotencyKey),
              ),
            );
        return created;
      });
    },

    async updateTask(context, input) {
      contextUnused(context);
      const value = parsed(taskUpdateSchema.safeParse(input));
      const [task] = await database
        .update(tasks)
        .set({ ...value, id: undefined, updatedAt: new Date() })
        .where(eq(tasks.id, value.id))
        .returning();
      if (!task)
        throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
          taskId: value.id,
        });
      return task;
    },

    async reorderTasks(context, trackId, ids) {
      contextUnused(context);
      const value = parsed(reorderSchema.safeParse({ parentId: trackId, ids }));
      return database.transaction(async (tx) => {
        await lockScope(tx, `track:${trackId}`);
        await assertCompleteOrder(
          tx,
          tasks,
          value.ids,
          eq(tasks.trackId, trackId),
        );
        const [max] = await tx
          .select({ value: sql<number>`coalesce(max(${tasks.position}), 0)` })
          .from(tasks)
          .where(eq(tasks.trackId, trackId));
        for (const [index, id] of value.ids.entries())
          await tx
            .update(tasks)
            .set({
              position: Number(max?.value ?? 0) + index + 1,
              updatedAt: new Date(),
            })
            .where(eq(tasks.id, id));
        for (const [index, id] of value.ids.entries())
          await tx
            .update(tasks)
            .set({ position: index + 1, updatedAt: new Date() })
            .where(eq(tasks.id, id));
        return tx
          .select()
          .from(tasks)
          .where(eq(tasks.trackId, trackId))
          .orderBy(asc(tasks.position));
      });
    },

    async completeTask(context, id) {
      contextUnused(context);
      return transition(id, "completed");
    },
    async skipTask(context, id) {
      contextUnused(context);
      return transition(id, "skipped");
    },
    async archiveTask(context, id) {
      contextUnused(context);
      return transition(id, "archived");
    },

    async reopenTask(context, id) {
      contextUnused(context);
      parsed(taskTransitionSchema.safeParse({ id }));
      return database.transaction(async (tx) => {
        const [existing] = await tx
          .select()
          .from(tasks)
          .where(eq(tasks.id, id))
          .limit(1);
        if (!existing)
          throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
            taskId: id,
          });
        await lockScope(tx, `track:${existing.trackId}`);
        const [affectedTask] = await tx
          .update(tasks)
          .set({ status: "pending", completedAt: null, updatedAt: new Date() })
          .where(eq(tasks.id, id))
          .returning();
        return {
          affectedTask: affectedTask!,
          nextTask: await currentForTrack(tx, existing.trackId),
        };
      });
    },

    async getNext(context, trackId) {
      contextUnused(context);
      if (trackId) {
        const [track] = await database
          .select()
          .from(tracks)
          .where(eq(tracks.id, trackId))
          .limit(1);
        if (!track)
          throw new DomainError("TRACK_NOT_FOUND", "Track was not found.", {
            trackId,
          });
        if (!track.currentTaskId) return null;
        const [task] = await database
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.id, track.currentTaskId),
              eq(tasks.trackId, track.id),
              eq(tasks.status, "pending"),
            ),
          )
          .limit(1);
        if (!task)
          throw new DomainError(
            "INVALID_NEXT_TASK",
            "Track points to an invalid Current Next.",
            { trackId },
          );
        return task;
      }
      const activeTracks = await database
        .select()
        .from(tracks)
        .innerJoin(goals, eq(tracks.goalId, goals.id))
        .where(and(eq(tracks.status, "active"), eq(goals.status, "active")))
        .orderBy(asc(tracks.position));
      return Promise.all(
        activeTracks.map(async ({ tracks: track }) => ({
          track,
          task: track.currentTaskId
            ? ((
                await database
                  .select()
                  .from(tasks)
                  .where(
                    and(
                      eq(tasks.id, track.currentTaskId),
                      eq(tasks.status, "pending"),
                    ),
                  )
                  .limit(1)
              )[0] ?? null)
            : null,
        })),
      );
    },

    async setNext(context, trackId, taskId) {
      contextUnused(context);
      const value = parsed(nextSetSchema.safeParse({ trackId, taskId }));
      return database.transaction(async (tx) => {
        await lockScope(tx, `track:${value.trackId}`);
        const [track] = await tx
          .select()
          .from(tracks)
          .where(eq(tracks.id, value.trackId))
          .limit(1);
        if (!track)
          throw new DomainError("TRACK_NOT_FOUND", "Track was not found.", {
            trackId: value.trackId,
          });
        let task: Task | null = null;
        if (value.taskId) {
          [task] = await tx
            .select()
            .from(tasks)
            .where(eq(tasks.id, value.taskId))
            .limit(1);
          if (!task || task.trackId !== value.trackId)
            throw new DomainError(
              "TASK_NOT_IN_TRACK",
              "Task does not belong to this Track.",
            );
          if (task.status !== "pending")
            throw new DomainError(
              "TASK_NOT_PENDING",
              "Current Next must be pending.",
            );
        }
        await tx
          .update(tracks)
          .set({ currentTaskId: task?.id ?? null, updatedAt: new Date() })
          .where(eq(tracks.id, value.trackId));
        return task;
      });
    },
  };
}
