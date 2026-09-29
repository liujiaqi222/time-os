import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";

import {
  createGoalAction,
  createTasksAction,
} from "@/app/(app)/planning-actions";
import { PlanningStatusAction } from "@/components/planning-status-action";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { planningService } from "@/services";
import type { Goal, Task } from "@/db/schema";
import { goalStatusLabel, taskStatusLabel } from "@/shared/labels";

const context = { actor: "web" } as const;

/**
 * Basic Goal / Task management (T06): create a Goal, quick-add Tasks,
 * complete / skip / archive. The complete three-act onboarding replaces
 * the creation flow in T07; full management visuals arrive with T10.
 */
export default async function GoalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const { view } = (await searchParams) ?? {};
  const showAll = view === "all";

  const [allGoals] = await Promise.all([
    planningService.listGoals(context, { includeArchived: true, limit: 100 }),
  ]);

  const visibleGoals = showAll
    ? allGoals.items
    : allGoals.items.filter((goal) => goal.status === "active");

  // One batched read of every visible goal's tasks.
  const tasksByGoal = new Map<string, Task[]>();
  await Promise.all(
    visibleGoals.map(async (goal: Goal) => {
      const page = await planningService.listTasks(context, goal.id, {
        limit: 100,
      });
      tasksByGoal.set(goal.id, page.items);
    }),
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
            管理
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">目标与任务</h1>
          <p className="max-w-2xl leading-7 text-stone-600">
            目标下直接放任务；执行都在「执行」页开始。这里是基础管理入口。
          </p>
        </div>
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link href={showAll ? "/goals" : "/goals?view=all"} />}
        >
          {showAll ? "只看进行中" : "查看已完成与已归档"}
        </Button>
      </header>

      <details className="group rounded-2xl border border-stone-200 bg-white/70">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-medium text-stone-800">
          <span>新建目标</span>
          <span className="text-sm font-normal text-stone-500 group-open:hidden">
            只需要标题
          </span>
          <span className="hidden text-sm font-normal text-stone-500 group-open:inline">
            收起
          </span>
        </summary>
        <div className="border-t border-stone-200 p-5">
          <form action={createGoalAction} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-goal-title">目标名称</Label>
              <Input
                id="new-goal-title"
                name="title"
                placeholder="例如：把产品介绍页改完"
                required
                maxLength={240}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-goal-description">为什么值得推进</Label>
              <Input
                id="new-goal-description"
                name="description"
                placeholder="可选"
              />
            </div>
            <Button type="submit" className="sm:col-span-2 sm:w-auto">
              <Plus aria-hidden="true" />
              创建目标
            </Button>
          </form>
        </div>
      </details>

      {visibleGoals.length === 0 ? (
        <Card className="border-dashed border-stone-300 bg-transparent shadow-none">
          <CardContent className="p-8 text-center text-stone-500">
            还没有可见的目标。创建一个即可在执行页开始。
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {visibleGoals.map((goal) => {
            const goalTasks = tasksByGoal.get(goal.id) ?? [];
            return (
              <Card
                key={goal.id}
                className="border-stone-200 bg-white/90"
                data-goal-status={goal.status}
              >
                <CardContent className="space-y-4 p-5 sm:p-6">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h2 className="text-xl font-semibold text-stone-900">
                        {goal.title}
                      </h2>
                      <p className="text-xs text-stone-400">
                        {goalStatusLabel[goal.status]} · {goalTasks.length}{" "}
                        个任务
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {goal.status === "active" ? (
                        <>
                          <PlanningStatusAction
                            entityType="goal"
                            id={goal.id}
                            action="completed"
                            label="完成目标"
                            icon="check"
                            variant="default"
                          />
                          <PlanningStatusAction
                            entityType="goal"
                            id={goal.id}
                            action="archived"
                            label="归档"
                            icon="archive"
                            variant="ghost"
                          />
                        </>
                      ) : (
                        <PlanningStatusAction
                          entityType="goal"
                          id={goal.id}
                          action="reactivate"
                          label="重新启用"
                          icon="reactivate"
                          variant="outline"
                        />
                      )}
                    </div>
                  </div>

                  {goal.description && (
                    <p className="text-sm text-stone-600">{goal.description}</p>
                  )}

                  {goal.status === "active" && (
                    <form
                      action={createTasksAction}
                      className="flex items-end gap-2"
                    >
                      <input type="hidden" name="goalId" value={goal.id} />
                      <div className="flex-1 space-y-1">
                        <Label
                          htmlFor={`add-tasks-${goal.id}`}
                          className="font-mono text-xs text-stone-500"
                        >
                          快速添加任务（每行一个）
                        </Label>
                        <textarea
                          id={`add-tasks-${goal.id}`}
                          name="titles"
                          rows={2}
                          placeholder={"整理素材\n写初稿"}
                          className="w-full resize-y rounded-lg border border-stone-200 bg-transparent px-2.5 py-1.5 text-sm placeholder:text-stone-400 focus:border-stone-900 focus:outline-hidden"
                        />
                      </div>
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        className="h-9"
                      >
                        <Plus className="size-3.5" aria-hidden="true" />
                        添加
                      </Button>
                    </form>
                  )}

                  {goalTasks.length > 0 ? (
                    <ul className="divide-y divide-stone-100 rounded-xl border border-stone-100">
                      {goalTasks.map((task) => (
                        <li
                          key={task.id}
                          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
                        >
                          <div className="min-w-0">
                            <p
                              className={`truncate font-medium ${
                                task.status === "pending"
                                  ? "text-stone-800"
                                  : "line-clamp-1 text-stone-400"
                              }`}
                            >
                              {task.title}
                            </p>
                            <p className="text-xs text-stone-400">
                              {taskStatusLabel[task.status]}
                              {task.estimatedMinutes
                                ? ` · 预计 ${task.estimatedMinutes} 分钟`
                                : ""}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            {task.status === "pending" ? (
                              <>
                                <PlanningStatusAction
                                  entityType="task"
                                  id={task.id}
                                  action="complete"
                                  label="完成"
                                  icon="check"
                                />
                                <PlanningStatusAction
                                  entityType="task"
                                  id={task.id}
                                  action="skip"
                                  label="跳过"
                                  variant="ghost"
                                />
                              </>
                            ) : (
                              <PlanningStatusAction
                                entityType="task"
                                id={task.id}
                                action="reopen"
                                label="重新打开"
                                variant="ghost"
                              />
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-stone-500">
                      还没有任务，可以直接围绕目标执行。
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <p className="flex items-center gap-2 text-sm text-stone-500">
        执行从
        <Link
          href="/today"
          className="inline-flex items-center gap-1 font-medium text-stone-900 underline-offset-4 hover:underline"
        >
          执行页
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
        开始。
      </p>
    </div>
  );
}
