"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { planningContract } from "@/adapters/planning-contract";
import { readWebSession } from "@/auth/web-session";
import { planningService } from "@/services";
import type { SerializedDomainError } from "@/shared/domain-error";

const context = { actor: "web" } as const;

async function authorize(): Promise<void> {
  if (!(await readWebSession())) redirect("/login");
}

async function run<T>(work: () => Promise<T>): Promise<T> {
  await authorize();
  const result = await planningContract(work);
  if (!result.ok)
    throw new Error(`${result.error.code}: ${result.error.message}`);
  revalidatePath("/goals");
  revalidatePath("/tracks/[id]", "page");
  revalidatePath("/today");
  return result.data;
}

export type PlanningStatusState =
  { status: "success" } | { status: "error"; message: string } | undefined;

function statusErrorMessage(error: SerializedDomainError): string {
  if (error.code === "PARENT_HAS_ACTIVE_SESSION")
    return "这个计划中还有正在进行或已暂停的专注。请先完成或取消当前专注。";
  if (error.code === "GOAL_NOT_FOUND" || error.code === "TRACK_NOT_FOUND")
    return "这个计划已不存在，刷新页面后再试。";
  if (error.code === "INVALID_INPUT") return "状态操作无效，请刷新页面后再试。";
  return "状态暂时无法更新，请稍后再试。";
}

export async function updatePlanningStatusAction(
  _previousState: PlanningStatusState,
  formData: FormData,
): Promise<PlanningStatusState> {
  await authorize();
  const entityType = String(formData.get("entityType"));
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as "completed" | "archived";

  const result = await planningContract(() => {
    if (entityType === "goal")
      return planningService.updateGoal(context, { id, status });
    if (entityType === "track")
      return planningService.updateTrack(context, { id, status });
    throw new Error("Unknown planning entity type.");
  });

  if (!result.ok)
    return { status: "error", message: statusErrorMessage(result.error) };

  revalidatePath("/goals");
  revalidatePath("/tracks/[id]", "page");
  revalidatePath("/today");
  return { status: "success" };
}

const optional = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text || null;
};

export async function createGoalAction(formData: FormData): Promise<void> {
  await run(() =>
    planningService.createGoal(context, {
      title: String(formData.get("title") ?? ""),
      description: optional(formData.get("description")),
    }),
  );
}

export async function updateGoalAction(formData: FormData): Promise<void> {
  await run(() =>
    planningService.updateGoal(context, {
      id: String(formData.get("id")),
      ...(formData.has("title")
        ? { title: String(formData.get("title")) }
        : {}),
      ...(formData.has("description")
        ? { description: optional(formData.get("description")) }
        : {}),
      ...(formData.has("status")
        ? {
            status: String(formData.get("status")) as
              "active" | "completed" | "archived",
          }
        : {}),
    }),
  );
}

export async function reorderGoalsAction(ids: string[]): Promise<void> {
  await run(() => planningService.reorderGoals(context, ids));
}

export async function createTrackAction(formData: FormData): Promise<void> {
  await run(() =>
    planningService.createTrack(context, {
      goalId: String(formData.get("goalId")),
      title: String(formData.get("title") ?? ""),
      description: optional(formData.get("description")),
    }),
  );
}

export async function updateTrackAction(formData: FormData): Promise<void> {
  await run(() =>
    planningService.updateTrack(context, {
      id: String(formData.get("id")),
      ...(formData.has("title")
        ? { title: String(formData.get("title")) }
        : {}),
      ...(formData.has("description")
        ? { description: optional(formData.get("description")) }
        : {}),
      ...(formData.has("status")
        ? {
            status: String(formData.get("status")) as
              "active" | "completed" | "archived",
          }
        : {}),
    }),
  );
}

export async function reorderTracksAction(
  goalId: string,
  ids: string[],
): Promise<void> {
  await run(() => planningService.reorderTracks(context, goalId, ids));
}

export async function createTasksAction(formData: FormData): Promise<void> {
  const trackId = String(formData.get("trackId"));
  const batch = String(formData.get("batch") ?? "")
    .split(/\r?\n/)
    .map((title) => title.trim())
    .filter(Boolean)
    .map((title) => ({ title }));
  const title = String(formData.get("title") ?? "").trim();
  const task = title
    ? [
        {
          title,
          description: optional(formData.get("description")),
          estimatedMinutes: optional(formData.get("estimatedMinutes"))
            ? Number(formData.get("estimatedMinutes"))
            : null,
          resourceType: optional(formData.get("resourceType")) as
            "url" | "text" | null,
          resourceValue: optional(formData.get("resourceValue")),
          note: optional(formData.get("note")),
        },
      ]
    : batch;
  await run(() =>
    planningService.createTasks(context, { trackId, tasks: task }),
  );
}

export async function updateTaskAction(formData: FormData): Promise<void> {
  await run(() =>
    planningService.updateTask(context, {
      id: String(formData.get("id")),
      title: String(formData.get("title") ?? ""),
      description: optional(formData.get("description")),
      estimatedMinutes: optional(formData.get("estimatedMinutes"))
        ? Number(formData.get("estimatedMinutes"))
        : null,
      resourceType: optional(formData.get("resourceType")) as
        "url" | "text" | null,
      resourceValue: optional(formData.get("resourceValue")),
      note: optional(formData.get("note")),
    }),
  );
}

export async function reorderTasksAction(
  trackId: string,
  ids: string[],
): Promise<void> {
  await run(() => planningService.reorderTasks(context, trackId, ids));
}

export async function transitionTaskAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id"));
  const transition = String(formData.get("transition"));
  await run(() => {
    if (transition === "complete")
      return planningService.completeTask(context, id);
    if (transition === "skip") return planningService.skipTask(context, id);
    if (transition === "archive")
      return planningService.archiveTask(context, id);
    if (transition === "reopen") return planningService.reopenTask(context, id);
    throw new Error("Unknown task transition.");
  });
}

export async function setNextAction(formData: FormData): Promise<void> {
  await run(() =>
    planningService.setNext(
      context,
      String(formData.get("trackId")),
      optional(formData.get("taskId")),
    ),
  );
}
