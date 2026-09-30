"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { planningContract } from "@/adapters/planning-contract";
import { readWebSession } from "@/auth/web-session";
import { planningService } from "@/services";
import { DomainError } from "@/shared/domain-error";

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
  revalidatePath("/today");
  return result.data;
}

export type PlanningStatusState =
  { status: "success" } | { status: "error"; message: string } | undefined;

function statusErrorMessage(error: { code: string; message: string }): string {
  if (error.code === "PARENT_HAS_ACTIVE_SESSION")
    return "还有未结束的专注关联着它。请先结束或取消这段专注再操作。";
  if (error.code === "GOAL_NOT_FOUND" || error.code === "TASK_NOT_FOUND")
    return "它已不存在，刷新页面后再试。";
  if (error.code === "TASK_NOT_PENDING") return "只有待办任务可以这样操作。";
  if (error.code === "GOAL_NOT_ACTIVE")
    return "目标当前不可编辑，请先重新启用。";
  if (error.code === "INVALID_INPUT") return "操作无效，请刷新页面后再试。";
  return "状态暂时无法更新，请稍后再试。";
}

/** Goal / Task lifecycle transitions from the management page. */
export async function updatePlanningStatusAction(
  _previous_state: PlanningStatusState,
  formData: FormData,
): Promise<PlanningStatusState> {
  await authorize();
  const entityType = String(formData.get("entityType"));
  const id = String(formData.get("id"));
  const action = String(formData.get("action"));

  const result = await planningContract(async () => {
    if (entityType === "goal") {
      if (action === "reactivate")
        return planningService.updateGoal(context, { id, status: "active" });
      if (action === "completed" || action === "archived")
        return planningService.updateGoal(context, { id, status: action });
    }
    if (entityType === "task") {
      if (action === "complete")
        return planningService.completeTask(context, id);
      if (action === "skip") return planningService.skipTask(context, id);
      if (action === "archive") return planningService.archiveTask(context, id);
      if (action === "reopen") return planningService.reopenTask(context, id);
    }
    throw new DomainError("INVALID_INPUT", "Unknown planning action.");
  });

  if (!result.ok)
    return { status: "error", message: statusErrorMessage(result.error) };

  revalidatePath("/goals");
  revalidatePath("/today");
  revalidatePath("/history");
  return { status: "success" };
}

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

export async function createTasksAction(formData: FormData): Promise<void> {
  const titles = String(formData.get("titles") ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (titles.length === 0) return;
  await run(() =>
    planningService.createTasks(context, {
      goalId: String(formData.get("goalId")),
      tasks: titles.slice(0, 50).map((title) => ({ title })),
    }),
  );
}

export async function updateTaskAction(
  _previousState: PlanningStatusState,
  formData: FormData,
): Promise<PlanningStatusState> {
  await authorize();
  const result = await planningContract(() =>
    planningService.updateTask(context, {
      id: String(formData.get("id")),
      title: String(formData.get("title") ?? ""),
    }),
  );

  if (!result.ok)
    return { status: "error", message: statusErrorMessage(result.error) };

  revalidatePath("/goals");
  revalidatePath("/today");
  return { status: "success" };
}

export async function reorderTasksAction(
  goalId: string,
  ids: string[],
): Promise<void> {
  await run(() => planningService.reorderTasks(context, goalId, ids));
}

const optional = (value: FormDataEntryValue | null) => {
  const text = String(value ?? "").trim();
  return text || null;
};
