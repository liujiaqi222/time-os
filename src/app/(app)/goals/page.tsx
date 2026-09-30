import Link from "next/link";
import { ArrowRight, ChevronDown, Plus } from "lucide-react";

import {
  createGoalAction,
  createTasksAction,
} from "@/app/(app)/planning-actions";
import { TaskItem } from "@/components/goals/task-item";
import { PlanningStatusAction } from "@/components/planning-status-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { planningService } from "@/services";
import type { Goal, Task } from "@/db/schema";
import { goalStatusLabel } from "@/shared/labels";

const context = { actor: "web" } as const;

export default async function GoalsPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  const { view } = (await searchParams) ?? {};
  const showAll = view === "all";
  const allGoals = await planningService.listGoals(context, {
    includeArchived: true,
    limit: 100,
  });
  const visibleGoals = showAll
    ? allGoals.items
    : allGoals.items.filter((goal) => goal.status === "active");

  const tasksByGoal = new Map<string, Task[]>();
  await Promise.all(
    visibleGoals.map(async (goal: Goal) => {
      const page = await planningService.listTasks(context, goal.id, {
        includeArchived: showAll,
        limit: 100,
      });
      tasksByGoal.set(goal.id, page.items);
    }),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-7 sm:space-y-9">
      <header className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
            目标与任务
          </p>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-[-0.035em] text-stone-950 sm:text-4xl">
            想做的事，拆成下一步
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-stone-600 sm:text-base">
            不用一次计划完整。先记下一件真正想推进的事，再补上眼下能做的一步。
          </p>
        </div>
        <Button
          nativeButton={false}
          variant="ghost"
          className="w-fit text-stone-500"
          render={<Link href={showAll ? "/goals" : "/goals?view=all"} />}
        >
          {showAll ? "只看进行中" : "查看已完成与已归档"}
        </Button>
      </header>

      <details className="group rounded-3xl border border-dashed border-stone-300 bg-white/45 transition-colors open:border-solid open:border-stone-200 open:bg-white">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-3xl px-5 py-4 text-sm font-medium text-stone-800 transition-colors outline-none hover:bg-white focus-visible:ring-2 focus-visible:ring-stone-400 sm:px-6 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2">
            <span className="grid size-7 place-items-center rounded-full bg-stone-900 text-white">
              <Plus className="size-4" aria-hidden="true" />
            </span>
            新建目标
          </span>
          <span className="flex items-center gap-2 text-xs font-normal text-stone-400">
            <span className="group-open:hidden">从一句话开始</span>
            <span className="hidden group-open:inline">收起</span>
            <ChevronDown
              className="size-4 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </span>
        </summary>
        <form
          action={createGoalAction}
          className="border-t border-stone-100 px-5 pt-4 pb-5 sm:px-6"
        >
          <p className="mb-2 text-lg font-medium tracking-tight text-stone-900">
            接下来，你想推进什么？
          </p>
          <div className="space-y-2">
            <div>
              <label htmlFor="new-goal-title" className="sr-only">
                目标名称
              </label>
              <Input
                id="new-goal-title"
                name="title"
                placeholder="例如：把产品介绍页改到可以发布"
                required
                maxLength={240}
                className="h-10 rounded-none border-x-0 border-t-0 border-stone-200 px-0 text-base shadow-none focus-visible:border-stone-900 focus-visible:ring-0"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <label htmlFor="new-goal-description" className="sr-only">
                  为什么值得推进
                </label>
                <Input
                  id="new-goal-description"
                  name="description"
                  placeholder="为什么值得推进？可选"
                  maxLength={10_000}
                  className="h-9 rounded-none border-x-0 border-t-0 border-stone-200 px-0 shadow-none focus-visible:border-stone-900 focus-visible:ring-0"
                />
              </div>
              <Button type="submit" className="h-9 px-4 sm:mb-px">
                创建目标
                <ArrowRight aria-hidden="true" />
              </Button>
            </div>
          </div>
        </form>
      </details>

      {visibleGoals.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-stone-300 px-6 py-14 text-center">
          <p className="font-medium text-stone-700">
            {showAll ? "这里还没有目标" : "目前没有进行中的目标"}
          </p>
          <p className="mt-1 text-sm text-stone-500">
            {showAll
              ? "从上面的入口写下一件想推进的事。"
              : "新建一个目标，或去“全部”恢复过去的目标。"}
          </p>
        </section>
      ) : (
        <div className="space-y-5">
          {visibleGoals.map((goal) => {
            const goalTasks = tasksByGoal.get(goal.id) ?? [];
            const pendingCount = goalTasks.filter(
              (task) => task.status === "pending",
            ).length;

            return (
              <article
                key={goal.id}
                className={`overflow-hidden rounded-3xl border bg-white shadow-[0_1px_2px_rgba(28,25,23,0.03)] ${
                  goal.status === "active"
                    ? "border-stone-200"
                    : "border-stone-200/70 opacity-80"
                }`}
                data-goal-status={goal.status}
              >
                <div className="px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            goal.status === "active"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-stone-100 text-stone-500"
                          }`}
                        >
                          {goalStatusLabel[goal.status]}
                        </span>
                        <span className="text-xs text-stone-400">
                          {pendingCount > 0
                            ? `${pendingCount} 个下一步待处理`
                            : "暂时没有待办"}
                        </span>
                      </div>
                      <h2 className="text-xl font-semibold tracking-[-0.02em] text-stone-900 sm:text-2xl">
                        {goal.title}
                      </h2>
                      {goal.description && (
                        <p className="max-w-2xl text-sm leading-6 text-stone-500">
                          {goal.description}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      {goal.status === "active" ? (
                        <>
                          <PlanningStatusAction
                            entityType="goal"
                            id={goal.id}
                            action="completed"
                            label="完成目标"
                            icon="check"
                            variant="outline"
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
                </div>

                <div className="border-t border-stone-100 bg-stone-50/45 px-4 py-3 sm:px-5">
                  <div className="mb-1 flex items-center justify-between px-1">
                    <h3 className="text-xs font-semibold tracking-wide text-stone-500 uppercase">
                      下一步
                    </h3>
                    <span className="text-xs text-stone-400">
                      {goalTasks.length} 项
                    </span>
                  </div>

                  {goalTasks.length > 0 ? (
                    <ul>
                      {goalTasks.map((task) => (
                        <TaskItem
                          key={`${task.id}-${task.status}`}
                          task={task}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="px-1 py-4 text-sm text-stone-500">
                      还没拆出下一步。你也可以直接围绕这个目标开始。
                    </p>
                  )}

                  {goal.status === "active" && (
                    <form
                      action={createTasksAction}
                      className="mt-2 flex items-end gap-2 border-t border-stone-100 px-1 pt-3"
                    >
                      <input type="hidden" name="goalId" value={goal.id} />
                      <label
                        htmlFor={`add-tasks-${goal.id}`}
                        className="sr-only"
                      >
                        快速添加任务（每行一个）
                      </label>
                      <textarea
                        id={`add-tasks-${goal.id}`}
                        name="titles"
                        rows={1}
                        placeholder="添加下一步… 可换行批量输入"
                        className="min-h-9 flex-1 resize-none rounded-xl border border-transparent bg-white px-3 py-2 text-sm shadow-xs placeholder:text-stone-400 focus:border-stone-300 focus:outline-none"
                      />
                      <Button
                        type="submit"
                        size="sm"
                        variant="outline"
                        className="h-9 bg-white px-3"
                      >
                        <Plus aria-hidden="true" />
                        添加
                      </Button>
                    </form>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="flex items-center justify-center gap-2 pt-2 text-sm text-stone-500">
        <span>选好下一步后，去</span>
        <Link
          href="/today"
          className="inline-flex items-center gap-1 font-medium text-stone-900 underline decoration-stone-300 underline-offset-4 hover:decoration-stone-900"
        >
          今天
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
        <span>开始一段专注。</span>
      </div>
    </div>
  );
}
