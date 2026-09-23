import { and, asc, eq, gt } from "drizzle-orm";

import { tasks, tracks, type Task } from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import { lockScope, type Transaction } from "@/services/service-kit";

/**
 * The Current Next pointer (PRD §2.2, §6.3) has exactly one implementation.
 * Every caller that transitions a Task or reads the pointer goes through
 * this module, inside a transaction it owns; the module takes care of the
 * `track:{trackId}` advisory lock discipline itself.
 */

export interface TaskTransitionResult {
  affectedTask: Task;
  nextTask: Task | null;
}

/** Read the Task the Current Next pointer references, or null when unset. */
export async function currentNextForTrack(
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

/**
 * Transition a pending Task to `status` and, when the Task was Current Next,
 * advance the pointer to the next pending Task by position (null when none
 * remains). Affects nothing else: finishing the last Task never completes
 * the Track, and transitioning a non-Current-Next Task leaves the pointer
 * alone (PRD §6.3).
 */
export async function transitionTask(
  tx: Transaction,
  id: string,
  status: "completed" | "skipped" | "archived",
): Promise<TaskTransitionResult> {
  const [existing] = await tx
    .select()
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  if (!existing) {
    throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
      taskId: id,
    });
  }

  await lockScope(tx, `track:${existing.trackId}`);

  // Re-read under the lock so a concurrent transition cannot slip through.
  const [fresh] = await tx
    .select()
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  if (!fresh) {
    throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
      taskId: id,
    });
  }
  if (fresh.status !== "pending") {
    throw new DomainError(
      fresh.status === "completed"
        ? "TASK_ALREADY_COMPLETED"
        : "TASK_NOT_PENDING",
      "Only a pending task can transition.",
    );
  }

  const now = new Date();
  const [affectedTask] = await tx
    .update(tasks)
    .set({
      status,
      completedAt: status === "completed" ? now : null,
      updatedAt: now,
    })
    .where(eq(tasks.id, id))
    .returning();
  if (!affectedTask) {
    throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
      taskId: id,
    });
  }

  const [track] = await tx
    .select()
    .from(tracks)
    .where(eq(tracks.id, fresh.trackId))
    .limit(1);

  // Current Next after the transition: untouched pointer stays as-is.
  let nextTask: Task | null = track?.currentTaskId
    ? await currentNextForTrack(tx, fresh.trackId)
    : null;

  if (track?.currentTaskId === id) {
    const [nextPending] = await tx
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
      .set({ currentTaskId: nextPending?.id ?? null, updatedAt: now })
      .where(eq(tracks.id, fresh.trackId));

    nextTask = nextPending ?? null;
  }

  return { affectedTask, nextTask };
}
