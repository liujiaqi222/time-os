"use server";

import { redirect } from "next/navigation";

import { sessionContract } from "@/adapters/session-contract";
import { readWebSession } from "@/auth/web-session";
import type { Goal, Task } from "@/db/schema";
import { planningService, selectionService } from "@/services";
import type { Result } from "@/shared/result";

const context = { actor: "web" } as const;

export interface OnboardingCandidate {
  goal: Goal;
  firstTask: Task | null;
  pendingTaskCount: number;
}

async function authorize(): Promise<void> {
  if (!(await readWebSession())) redirect("/login?next=/onboarding");
}

export async function createOnboardingGoalAction(input: {
  title: string;
  description?: string | null;
  idempotencyKey: string;
}): Promise<Result<{ goal: Goal }>> {
  await authorize();
  return sessionContract(async () => {
    const goal = await planningService.createGoal(context, input);
    // Omitted taskId deliberately uses selection_set's automatic semantics.
    // With no Task yet this resolves to goal-only execution.
    await selectionService.set(context, { goalId: goal.id });
    return { goal };
  });
}

export async function checkOnboardingGoalsAction(): Promise<
  Result<OnboardingCandidate[]>
> {
  await authorize();
  return sessionContract(async () => {
    const page = await planningService.listGoals(context, {
      status: "active",
      limit: 100,
    });
    return Promise.all(
      page.items.map(async (goal) => {
        const taskPage = await planningService.listTasks(context, goal.id, {
          status: "pending",
          limit: 100,
        });
        return {
          goal,
          firstTask: taskPage.items[0] ?? null,
          pendingTaskCount: taskPage.items.length,
        };
      }),
    );
  });
}

export async function selectOnboardingGoalAction(
  goalId: string,
): Promise<Result<{ goalId: string }>> {
  await authorize();
  return sessionContract(async () => {
    const selection = await selectionService.set(context, { goalId });
    return { goalId: selection.goal.id };
  });
}
