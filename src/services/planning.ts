import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import {
  goals,
  sessions,
  tasks,
  tracks,
  type Goal,
  type Task,
  type Track,
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
import {
  currentNextForTrack,
  transitionTask,
  type TaskTransitionResult,
} from "@/services/current-next";
import { requestHashOf, withIdempotency } from "@/services/idempotency";
import {
  listPositionPage,
  renumberPositions,
  type Page,
} from "@/services/positioned-list";
import {
  invalid,
  lockScope,
  parsed,
  type Transaction,
} from "@/services/service-kit";

export type { Goal, Track, Task } from "@/db/schema";
export type { TaskTransitionResult } from "@/services/current-next";
export type { Page } from "@/services/positioned-list";

export interface TrackNext {
  track: Track;
  task: Task | null;
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
  listTracksForGoals(
    context: AuthenticatedContext,
    goalIds: string[],
    input?: ListInput,
  ): Promise<Map<string, Page<Track>>>;
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
  getNextForTrack(
    context: AuthenticatedContext,
    trackId: string,
  ): Promise<Task | null>;
  getNextForAllTracks(context: AuthenticatedContext): Promise<TrackNext[]>;
  setNext(
    context: AuthenticatedContext,
    trackId: string,
    taskId: string | null,
  ): Promise<Task | null>;
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

export function createPlanningService(database: Database): PlanningService {
  const contextUnused = (_context: AuthenticatedContext) => void _context;

  // Task transitions and Current Next advancement live in the current-next
  // module — the same implementation the Session finish review uses
  // (PRD §6.3). This module only owns the transaction boundary.
  async function transition(
    id: string,
    status: "completed" | "skipped" | "archived",
  ): Promise<TaskTransitionResult> {
    parsed(taskTransitionSchema.safeParse({ id }));
    return database.transaction((tx) => transitionTask(tx, id, status));
  }

  return {
    async listGoals(context, input = {}) {
      contextUnused(context);
      const query = parsed(listSchema.safeParse(input));
      const status = query.status
        ? parsed(parentStatusSchema.safeParse(query.status))
        : undefined;
      return listPositionPage(database, goals, {
        filters: [
          ...(status
            ? [eq(goals.status, status)]
            : query.includeArchived
              ? []
              : [eq(goals.status, "active" as const)]),
        ],
        cursor: query.cursor,
        limit: query.limit,
      });
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
        await renumberPositions(tx, goals, value.ids);
        return tx.select().from(goals).orderBy(asc(goals.position));
      });
    },

    async listTracks(context, goalId, input = {}) {
      contextUnused(context);
      const query = parsed(listSchema.safeParse(input));
      const status = query.status
        ? parsed(parentStatusSchema.safeParse(query.status))
        : undefined;
      return listPositionPage(database, tracks, {
        scope: [eq(tracks.goalId, goalId)],
        filters: [
          ...(status
            ? [eq(tracks.status, status)]
            : query.includeArchived
              ? []
              : [eq(tracks.status, "active" as const)]),
        ],
        cursor: query.cursor,
        limit: query.limit,
      });
    },

    async listTracksForGoals(context, goalIds, input = {}) {
      contextUnused(context);
      const uniqueGoalIds = [...new Set(goalIds)];
      if (uniqueGoalIds.length === 0) return new Map();
      const query = parsed(listSchema.safeParse(input));
      if (query.cursor)
        invalid("Cursor is not supported when listing tracks across goals.");
      const status = query.status
        ? parsed(parentStatusSchema.safeParse(query.status))
        : undefined;
      // Single round trip for every goal; each goal gets at most limit + 1
      // rows so its nextCursor can be computed exactly like listTracks.
      const rows = await database
        .select()
        .from(tracks)
        .where(
          and(
            inArray(tracks.goalId, uniqueGoalIds),
            ...(status
              ? [eq(tracks.status, status)]
              : query.includeArchived
                ? []
                : [eq(tracks.status, "active" as const)]),
          ),
        )
        .orderBy(asc(tracks.goalId), asc(tracks.position))
        .limit(uniqueGoalIds.length * (query.limit + 1));

      const pages = new Map<string, Page<Track>>();
      for (const goalId of uniqueGoalIds)
        pages.set(goalId, { items: [], nextCursor: null });
      for (const row of rows) {
        const page = pages.get(row.goalId);
        if (!page || page.items.length >= query.limit) {
          if (page && page.items.length === query.limit) {
            page.nextCursor = page.items[query.limit - 1]?.id ?? null;
          }
          continue;
        }
        page.items.push(row);
      }
      return pages;
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
        await renumberPositions(
          tx,
          tracks,
          value.ids,
          eq(tracks.goalId, goalId),
        );
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
      return listPositionPage(database, tasks, {
        scope: [eq(tasks.trackId, trackId)],
        filters: [
          ...(status
            ? [eq(tasks.status, status)]
            : query.includeArchived
              ? []
              : [ne(tasks.status, "archived" as const)]),
        ],
        cursor: query.cursor,
        limit: query.limit,
      });
    },

    async createTasks(context, input) {
      contextUnused(context);
      const value = parsed(tasksCreateSchema.safeParse(input));
      const requestHash = requestHashOf({
        trackId: value.trackId,
        tasks: value.tasks,
      });
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

        // Claim / replay / record discipline lives in the idempotency
        // module — the same implementation session_start uses and
        // session_log will reuse (PRD §4.7).
        return withIdempotency({
          tx,
          operation: "tasks_create",
          key: value.idempotencyKey,
          requestHash,
          replay: async (recorded) => {
            const taskIds =
              (recorded as { taskIds?: string[] } | null)?.taskIds ?? [];
            if (!taskIds.length) return null;
            return tx
              .select()
              .from(tasks)
              .where(inArray(tasks.id, taskIds))
              .orderBy(asc(tasks.position));
          },
          run: async () => {
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
            return {
              value: created,
              result: { taskIds: created.map((task) => task.id) },
              resultRef: created[0]?.id ?? null,
            };
          },
        });
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
        await renumberPositions(
          tx,
          tasks,
          value.ids,
          eq(tasks.trackId, trackId),
        );
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
          nextTask: await currentNextForTrack(tx, existing.trackId),
        };
      });
    },

    async getNextForTrack(context, trackId) {
      contextUnused(context);
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
    },

    async getNextForAllTracks(context) {
      contextUnused(context);
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
