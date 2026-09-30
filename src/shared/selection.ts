/**
 * Deterministic execution-target resolution (PRD §5.2).
 *
 * One pure implementation shared by the dashboard read model, Web actions
 * and MCP tools. The service layer gathers the snapshot inputs; the rules
 * below are the single source of truth for "what will run next":
 *
 * 1. An unfinished Session always wins — resume it instead of picking anew.
 * 2. A still-valid stored selection is kept, including explicit goal-only.
 * 3. A selected Task that became non-executable falls back inside the same
 *    Goal: next pending by position → first pending → goal-only.
 * 4. Without a valid selection, the most recent effective Session's active
 *    Goal wins: its original Task if still pending → first pending →
 *    goal-only.
 * 5. Otherwise the first active Goal by position: first pending Task or
 *    goal-only. No active Goal at all → null (show goal guidance).
 */

export type SelectionReason =
  | "active-session"
  | "explicit-selection"
  | "task-fallback"
  | "recent-goal"
  | "first-goal";

export interface ResolvedSelection {
  goalId: string;
  /** null = explicit goal-only execution for this Goal. */
  taskId: string | null;
  reason: SelectionReason;
}

/** Pending Task candidates of one Goal, ordered by position. */
export interface PendingCandidate {
  id: string;
  position: number;
}

export interface SelectionResolverInput {
  /** The single unfinished Session, when one exists. */
  openSession: { goalId: string; taskId: string | null } | null;
  /** The stored {goalId, taskId} selection, when set. */
  stored: { goalId: string; taskId: string | null } | null;
  /** Whether the stored selection's Goal is still active (rule 2/3). */
  storedGoalActive: boolean;
  /** Whether the stored Task is still pending and in the stored Goal. */
  storedTaskPending: boolean;
  /** Last known position of the stored Task (needed even when it is no
   *  longer pending, because rule 3 compares against it). */
  storedTaskPosition: number | null;
  /** Pending Tasks of the stored Goal (needed for rule 3). */
  storedGoalCandidates: PendingCandidate[];
  /** Most recent effective (non-cancelled, > 0s) Session, if any. */
  recent: {
    goalId: string;
    taskId: string | null;
    goalActive: boolean;
    taskPending: boolean;
    candidates: PendingCandidate[];
  } | null;
  /** First active Goal by position, with its pending Tasks. */
  firstGoal: {
    goalId: string;
    candidates: PendingCandidate[];
  } | null;
}

function firstPendingAfter(
  candidates: PendingCandidate[],
  position?: number,
): string | null {
  const after = candidates.find(
    (candidate) => position === undefined || candidate.position > position,
  );
  return after?.id ?? null;
}

export function resolveExecutionTarget(
  input: SelectionResolverInput,
): ResolvedSelection | null {
  // 1. Unfinished Session is the current execution object.
  if (input.openSession) {
    return {
      goalId: input.openSession.goalId,
      taskId: input.openSession.taskId,
      reason: "active-session",
    };
  }

  // 2. Stored selection still valid → keep it (including goal-only).
  if (input.stored && input.storedGoalActive) {
    if (!input.stored.taskId || input.storedTaskPending) {
      return {
        goalId: input.stored.goalId,
        taskId: input.stored.taskId,
        reason: "explicit-selection",
      };
    }

    // 3. Selected Task no longer executable → fall back in the same Goal.
    const fallback = firstPendingAfter(
      input.storedGoalCandidates,
      input.storedTaskPosition ?? undefined,
    );
    return {
      goalId: input.stored.goalId,
      taskId: fallback,
      reason: "task-fallback",
    };
  }

  // 4. Most recent effective Session's active Goal.
  if (input.recent?.goalActive) {
    if (input.recent.taskId && input.recent.taskPending) {
      return {
        goalId: input.recent.goalId,
        taskId: input.recent.taskId,
        reason: "recent-goal",
      };
    }
    return {
      goalId: input.recent.goalId,
      taskId: firstPendingAfter(input.recent.candidates),
      reason: "recent-goal",
    };
  }

  // 5. First active Goal by position.
  if (input.firstGoal) {
    return {
      goalId: input.firstGoal.goalId,
      taskId: firstPendingAfter(input.firstGoal.candidates),
      reason: "first-goal",
    };
  }

  return null;
}

/**
 * Auto Task resolution when a caller selects a Goal but omits taskId
 * (PRD §5.2 tail): prefer the pending Task of that Goal's most recent
 * effective Session, then the first pending Task, otherwise goal-only.
 * This is the *set* semantics — deliberately different from
 * session_start, where an omitted taskId means goal-only.
 */
export function autoTaskIdForGoal(input: {
  recentTask: { taskId: string | null; taskPending: boolean } | null;
  firstPendingTaskId: string | null;
}): string | null {
  if (input.recentTask?.taskId && input.recentTask.taskPending) {
    return input.recentTask.taskId;
  }
  return input.firstPendingTaskId;
}
