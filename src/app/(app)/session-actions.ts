"use server";

import { redirect } from "next/navigation";

import { sessionContract } from "@/adapters/session-contract";
import { readWebSession } from "@/auth/web-session";
import {
  dashboardService,
  distractionService,
  planningService,
  selectionService,
  sessionService,
  settingsService,
} from "@/services";
import type { DashboardData } from "@/services/dashboard";
import type { Distraction } from "@/db/schema";
import type { Goal, Task } from "@/db/schema";
import type { EffectiveSelection } from "@/services/selection";
import type { SessionDetail, SessionView } from "@/services/session";
import type { Result } from "@/shared/result";
import type {
  TimerConfig,
  SessionAdvanceInput,
  DistractionCreateInput,
  DistractionUpdateInput,
} from "@/shared/schemas/session";

const context = { actor: "web" } as const;

async function authorize(): Promise<void> {
  if (!(await readWebSession())) redirect("/login");
}

async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  await authorize();
  // These authenticated routes are force-dynamic. The client already applies
  // each mutation's returned value, so revalidating here would make Next.js
  // render the current layout and page before returning the action result.
  // That turns a small timer mutation into a full dashboard roundtrip.
  return sessionContract(work);
}

// ---- Dashboard / selection -----------------------------------------------

export async function getDashboardAction(): Promise<Result<DashboardData>> {
  await authorize();
  return sessionContract(() => dashboardService.getDashboard(context));
}

export async function getActiveSessionAction(): Promise<
  Result<SessionView | null>
> {
  await authorize();
  return sessionContract(() => sessionService.getActiveSession(context));
}

export async function selectionSetAction(input: {
  goalId: string;
  taskId?: string | null;
}): Promise<Result<EffectiveSelection>> {
  return run(() => selectionService.set(context, input));
}

export async function selectionClearAction(): Promise<Result<null>> {
  return run(async () => {
    await selectionService.clear(context);
    return null;
  });
}

export async function listTasksAction(goalId: string): Promise<Result<Task[]>> {
  await authorize();
  return sessionContract(async () => {
    const page = await planningService.listTasks(context, goalId, {
      status: "pending",
      limit: 100,
    });
    return page.items;
  });
}

// ---- Execution loop -------------------------------------------------------

export async function startSessionAction(input: {
  goalId: string;
  taskId?: string | null;
  intent?: string | null;
  timerMode?: "stopwatch" | "pomodoro";
  idempotencyKey?: string;
}): Promise<Result<SessionView>> {
  return run(() =>
    sessionService.startSession(context, {
      goalId: input.goalId,
      taskId: input.taskId ?? null,
      timerMode: input.timerMode ?? "pomodoro",
      idempotencyKey: input.idempotencyKey,
      intent: input.intent ?? null,
    }),
  );
}

export async function pauseSessionAction(
  sessionId: string,
): Promise<Result<SessionView>> {
  return run(() => sessionService.pauseSession(context, sessionId));
}

export async function resumeSessionAction(
  sessionId: string,
): Promise<Result<SessionView>> {
  return run(() => sessionService.resumeSession(context, sessionId));
}

export async function finishSessionAction(input: {
  sessionId: string;
  note?: string | null;
  noteExpectedVersion?: number;
}): Promise<Result<SessionView>> {
  return run(() =>
    sessionService.finishSession(context, input.sessionId, {
      note: input.note,
      noteExpectedVersion: input.noteExpectedVersion,
    }),
  );
}

export async function cancelSessionAction(
  sessionId: string,
): Promise<Result<SessionView>> {
  return run(() => sessionService.cancelSession(context, sessionId));
}

export async function getSessionAction(
  sessionId: string,
): Promise<Result<SessionDetail>> {
  await authorize();
  return sessionContract(() => sessionService.getSession(context, sessionId));
}

export async function updateNoteAction(input: {
  sessionId: string;
  note: string | null;
  expectedVersion: number;
}): Promise<Result<SessionView>> {
  return run(() =>
    sessionService.updateNote(context, {
      id: input.sessionId,
      note: input.note,
      expectedVersion: input.expectedVersion,
    }),
  );
}

export async function updateResumeHintAction(input: {
  sessionId: string;
  resumeHint: string | null;
  expectedVersion: number;
}): Promise<Result<SessionView>> {
  return run(() =>
    sessionService.updateResumeHint(context, {
      id: input.sessionId,
      resumeHint: input.resumeHint,
      expectedVersion: input.expectedVersion,
    }),
  );
}

export async function completeTaskAction(
  taskId: string,
): Promise<Result<Task>> {
  return run(() => planningService.completeTask(context, taskId));
}

// ---- First goal (empty state) ---------------------------------------------

export async function createGoalAction(input: {
  title: string;
  description?: string | null;
}): Promise<Result<Goal>> {
  return run(() =>
    planningService.createGoal(context, {
      title: input.title,
      description: input.description ?? null,
    }),
  );
}

export async function quickAddTaskAction(input: {
  goalId: string;
  title: string;
}): Promise<Result<Task[]>> {
  return run(() =>
    planningService.createTasks(context, {
      goalId: input.goalId,
      tasks: [{ title: input.title }],
    }),
  );
}

// ---- Distractions -----------------------------------------------------------

export async function createDistractionAction(
  input: DistractionCreateInput,
): Promise<Result<Distraction>> {
  return run(() => distractionService.createDistraction(context, input));
}

export async function updateDistractionAction(
  id: string,
  input: DistractionUpdateInput,
): Promise<Result<Distraction>> {
  return run(() => distractionService.updateDistraction(context, id, input));
}

export async function archiveDistractionAction(
  id: string,
): Promise<Result<Distraction>> {
  return run(() => distractionService.archiveDistraction(context, id));
}

export async function listDistractionsAction(
  sessionId: string,
): Promise<Result<Distraction[]>> {
  await authorize();
  return sessionContract(() =>
    distractionService.listDistractions(context, { sessionId }),
  );
}

export async function advanceSessionAction(
  input: SessionAdvanceInput,
): Promise<Result<SessionView>> {
  return run(() => sessionService.advanceSession(context, input));
}

export async function saveTimerPreferencesAction(input: {
  timerMode?: "stopwatch" | "pomodoro";
  timerPreferences?: TimerConfig;
}) {
  return run(() => settingsService.update(context, input));
}
