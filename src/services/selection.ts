import { and, asc, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import {
  appSettings,
  goals,
  sessions,
  tasks,
  type Goal,
  type Task,
} from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  autoTaskIdForGoal,
  resolveExecutionTarget,
  type PendingCandidate,
  type ResolvedSelection,
  type SelectionReason,
} from "@/shared/selection";
import {
  selectionClearSchema,
  selectionSetSchema,
} from "@/shared/schemas/planning";
import { lockScope, parsed, type Transaction } from "@/services/service-kit";

/**
 * The single server-persisted execution selection {goalId, taskId}
 * (PRD §3.5). This module owns the selection columns of app_settings plus
 * the read model that turns the stored value into the effective execution
 * target using the shared resolver (PRD §5.2).
 *
 * Lock order (global convention, see service-kit): any transaction that
 * both checks open-Session state and writes the selection takes
 * `sessions:running` first, then `app:selection`, then `goal:{goalId}`.
 */

export interface StoredSelection {
  goalId: string;
  taskId: string | null;
}

export interface EffectiveSelection {
  goal: Goal;
  task: Task | null;
  goalOnly: boolean;
  reason: SelectionReason;
}

export interface SelectionService {
  /** Effective execution target after applying all §5.2 fallback rules. */
  resolve(context: AuthenticatedContext): Promise<ResolvedSelection | null>;
  /** The raw stored selection, without fallback resolution. */
  getStored(context: AuthenticatedContext): Promise<StoredSelection | null>;
  /**
   * selection_set: omitted taskId auto-resolves inside the Goal; null is
   * explicit goal-only; a uuid pins that pending Task.
   */
  set(
    context: AuthenticatedContext,
    input: { goalId: string; taskId?: string | null },
  ): Promise<EffectiveSelection>;
  clear(context: AuthenticatedContext): Promise<void>;
}

async function pendingCandidates(
  db: Database | Transaction,
  goalId: string,
): Promise<PendingCandidate[]> {
  return db
    .select({ id: tasks.id, position: tasks.position })
    .from(tasks)
    .where(and(eq(tasks.goalId, goalId), eq(tasks.status, "pending")))
    .orderBy(asc(tasks.position));
}

/** Read the stored {goalId, taskId} columns (no validation, no fallback). */
export async function readStoredSelection(
  db: Database | Transaction,
): Promise<StoredSelection | null> {
  const [row] = await db
    .select({
      goalId: appSettings.selectedGoalId,
      taskId: appSettings.selectedTaskId,
    })
    .from(appSettings)
    .limit(1);
  if (!row?.goalId) return null;
  return { goalId: row.goalId, taskId: row.taskId };
}

/**
 * Write the selection inside a transaction. The caller must hold the
 * `app:selection` lock. Upserted so the settings row is guaranteed to
 * exist. Called by selection_set/clear and by session_start's "sync
 * selection on success" rule (PRD §5.3).
 */
export async function applySelection(
  tx: Transaction,
  selection: StoredSelection | null,
): Promise<void> {
  await tx
    .insert(appSettings)
    .values({
      id: "default",
      // Required NOT NULL columns for a first insert; preserved by the
      // conflict update when the row already exists.
      timezone: "UTC",
      weekStartsOn: 1,
      timerMode: "pomodoro",
      selectedGoalId: selection?.goalId ?? null,
      selectedTaskId: selection?.taskId ?? null,
    })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: {
        selectedGoalId: selection?.goalId ?? null,
        selectedTaskId: selection?.taskId ?? null,
        updatedAt: new Date(),
      },
    });
}

/**
 * After a Task transition, advance the stored selection only when it
 * pointed at the affected Task (PRD §5.2): completing a different Task
 * never steals the selection. Atomic with the transition — same tx.
 */
export async function advanceSelectionOnTaskTransition(
  tx: Transaction,
  affected: { goalId: string; taskId: string; nextTaskId: string | null },
): Promise<void> {
  await lockScope(tx, "app:selection");
  const stored = await readStoredSelection(tx);
  if (
    !stored ||
    stored.taskId !== affected.taskId ||
    stored.goalId !== affected.goalId
  ) {
    return;
  }
  await applySelection(tx, {
    goalId: affected.goalId,
    taskId: affected.nextTaskId,
  });
}

export function createSelectionService(database: Database): SelectionService {
  async function resolveFromDb(): Promise<ResolvedSelection | null> {
    // Resolve the independent roots together. Remote Postgres latency is much
    // larger than the work in these small reads, so serial roundtrips made the
    // execution dashboard take several seconds even on a warm connection.
    const [openRows, stored, recentRows, firstGoalRows] = await Promise.all([
      database
        .select({ goalId: sessions.goalId, taskId: sessions.taskId })
        .from(sessions)
        .where(inArray(sessions.status, ["active", "paused"] as const))
        .limit(1),
      readStoredSelection(database),
      database
        .select({ goalId: sessions.goalId, taskId: sessions.taskId })
        .from(sessions)
        .where(
          and(
            eq(sessions.status, "completed"),
            isNotNull(sessions.endedAt),
            sql`${sessions.durationSeconds} > 0`,
          ),
        )
        .orderBy(desc(sessions.endedAt), desc(sessions.startedAt))
        .limit(1),
      database
        .select({ id: goals.id })
        .from(goals)
        .where(eq(goals.status, "active"))
        .orderBy(asc(goals.position))
        .limit(1),
    ]);

    const openRow = openRows[0];
    const recentRow = recentRows[0];
    const firstGoalRow = firstGoalRows[0];

    const [
      storedGoal,
      storedCandidates,
      storedTask,
      recentGoal,
      recentCandidates,
      firstGoalCandidates,
    ] = await Promise.all([
      stored
        ? database
            .select({ status: goals.status })
            .from(goals)
            .where(eq(goals.id, stored.goalId))
            .limit(1)
        : Promise.resolve([]),
      stored ? pendingCandidates(database, stored.goalId) : Promise.resolve([]),
      stored?.taskId
        ? database
            .select({ position: tasks.position })
            .from(tasks)
            .where(eq(tasks.id, stored.taskId))
            .limit(1)
        : Promise.resolve([]),
      recentRow
        ? database
            .select({ status: goals.status })
            .from(goals)
            .where(eq(goals.id, recentRow.goalId))
            .limit(1)
        : Promise.resolve([]),
      recentRow
        ? pendingCandidates(database, recentRow.goalId)
        : Promise.resolve([]),
      firstGoalRow
        ? pendingCandidates(database, firstGoalRow.id)
        : Promise.resolve([]),
    ]);
    const storedTaskPending = Boolean(
      stored?.taskId && storedCandidates.some((c) => c.id === stored.taskId),
    );

    return resolveExecutionTarget({
      openSession: openRow
        ? { goalId: openRow.goalId, taskId: openRow.taskId }
        : null,
      stored,
      storedGoalActive: storedGoal?.[0]?.status === "active",
      storedTaskPending,
      storedTaskPosition: storedTask?.[0]?.position ?? null,
      storedGoalCandidates: storedCandidates,
      recent: recentRow
        ? {
            goalId: recentRow.goalId,
            taskId: recentRow.taskId,
            goalActive: recentGoal?.[0]?.status === "active",
            taskPending: Boolean(
              recentRow.taskId &&
              recentCandidates.some((c) => c.id === recentRow.taskId),
            ),
            candidates: recentCandidates,
          }
        : null,
      firstGoal: firstGoalRow
        ? { goalId: firstGoalRow.id, candidates: firstGoalCandidates }
        : null,
    });
  }

  return {
    async resolve(_context) {
      void _context;
      return resolveFromDb();
    },

    async getStored(_context) {
      void _context;
      return readStoredSelection(database);
    },

    async set(_context, input) {
      void _context;
      const value = parsed(selectionSetSchema.safeParse(input));
      return database.transaction(async (tx) => {
        await lockScope(tx, "app:selection");
        await lockScope(tx, `goal:${value.goalId}`);

        const [goal] = await tx
          .select()
          .from(goals)
          .where(eq(goals.id, value.goalId))
          .limit(1);
        if (!goal)
          throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", {
            goalId: value.goalId,
          });
        if (goal.status !== "active")
          throw new DomainError(
            "GOAL_NOT_ACTIVE",
            "Reactivate the Goal before selecting it.",
            { goalId: goal.id },
          );

        const candidates = await pendingCandidates(tx, goal.id);
        let taskId: string | null;

        if (value.taskId === null || value.taskId === undefined) {
          if (value.taskId === null) {
            // Explicit goal-only.
            taskId = null;
          } else {
            // Omitted: auto-resolve inside the Goal (§5.2 tail rule).
            const [recentRow] = await tx
              .select({ taskId: sessions.taskId })
              .from(sessions)
              .where(
                and(
                  eq(sessions.goalId, goal.id),
                  eq(sessions.status, "completed"),
                  isNotNull(sessions.endedAt),
                  sql`${sessions.durationSeconds} > 0`,
                ),
              )
              .orderBy(desc(sessions.endedAt), desc(sessions.startedAt))
              .limit(1);
            const recentTask = recentRow?.taskId ?? null;
            taskId = autoTaskIdForGoal({
              recentTask: recentTask
                ? {
                    taskId: recentTask,
                    taskPending: candidates.some((c) => c.id === recentTask),
                  }
                : null,
              firstPendingTaskId: candidates[0]?.id ?? null,
            });
          }
        } else {
          const [task] = await tx
            .select()
            .from(tasks)
            .where(eq(tasks.id, value.taskId))
            .limit(1);
          if (!task)
            throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
              taskId: value.taskId,
            });
          if (task.goalId !== goal.id)
            throw new DomainError(
              "TASK_NOT_IN_GOAL",
              "Task does not belong to this Goal.",
              { taskId: task.id, goalId: goal.id },
            );
          if (task.status !== "pending")
            throw new DomainError(
              "TASK_NOT_PENDING",
              "Only a pending Task can be selected.",
              { taskId: task.id },
            );
          taskId = task.id;
        }

        await applySelection(tx, { goalId: goal.id, taskId });
        const [selectedTask] = taskId
          ? await tx.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
          : [null];
        return {
          goal,
          task: selectedTask ?? null,
          goalOnly: taskId === null,
          reason: "explicit-selection" as const,
        };
      });
    },

    async clear(_context) {
      void _context;
      parsed(selectionClearSchema.safeParse({}));
      await database.transaction(async (tx) => {
        await lockScope(tx, "app:selection");
        await applySelection(tx, null);
      });
    },
  };
}

/** Next pending Task of a Goal strictly after `position` (or first). */
export async function nextPendingTaskInGoal(
  tx: Database | Transaction,
  goalId: string,
  afterPosition?: number,
): Promise<Task | null> {
  const rows = await tx
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.goalId, goalId),
        eq(tasks.status, "pending"),
        afterPosition === undefined
          ? undefined
          : gt(tasks.position, afterPosition),
      ),
    )
    .orderBy(asc(tasks.position))
    .limit(1);
  return rows[0] ?? null;
}
