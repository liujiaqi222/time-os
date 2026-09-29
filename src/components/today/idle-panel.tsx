"use client";

import { useEffect, useState } from "react";
import { Plus, Play, Sparkles } from "lucide-react";

import {
  listTasksAction,
  quickAddTaskAction,
  selectionSetAction,
} from "@/app/(app)/session-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Task } from "@/db/schema";
import type { DashboardData } from "@/services/dashboard";
import { selectionReasonLabel, taskStatusLabel } from "@/shared/labels";

/**
 * Idle execution panel (PRD §5.1–5.3): resolved execution object with its
 * resume hint, one click to start, quick goal/task switching, optional
 * intent (never auto-created into a Task) and quick Task adding.
 */
export function IdlePanel({
  dashboard,
  busy,
  onStart,
  onRefresh,
  onError,
}: {
  dashboard: DashboardData;
  busy: "none" | "start";
  onStart: (input: { intent: string | null }) => void;
  onRefresh: () => Promise<unknown>;
  onError: (message: string | null) => void;
}) {
  const { selection, resumeHint, goals, todos } = dashboard;
  const [intent, setIntent] = useState("");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [busyQuickAdd, setBusyQuickAdd] = useState(false);
  // Fetched full pending list for the switcher, tagged with the goal it
  // belongs to so a goal switch immediately falls back to the dashboard
  // todos until the fetch lands (no sync setState inside the effect).
  const [fetched, setFetched] = useState<{
    goalId: string;
    tasks: Task[];
  } | null>(null);
  const taskOptions =
    selection && fetched?.goalId === selection.goal.id ? fetched.tasks : todos;

  // Full pending list for the switcher whenever the selected Goal changes.
  useEffect(() => {
    if (!selection) return;
    let cancelled = false;
    const goalId = selection.goal.id;
    void listTasksAction(goalId).then((result) => {
      if (!cancelled && result.ok) {
        setFetched({ goalId, tasks: result.data });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection?.goal.id, selection?.task?.id]);

  if (!selection) return null;

  const handleSelectGoal = async (goalId: string) => {
    onError(null);
    const result = await selectionSetAction({ goalId });
    if (!result.ok) onError(result.error.message);
    await onRefresh();
  };

  const handleSelectTask = async (goalId: string, taskId: string | null) => {
    onError(null);
    const result = await selectionSetAction({ goalId, taskId });
    if (!result.ok) onError(result.error.message);
    await onRefresh();
  };

  const handleQuickAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;
    onError(null);
    setBusyQuickAdd(true);
    const result = await quickAddTaskAction({
      goalId: selection.goal.id,
      title,
    });
    if (result.ok) {
      setNewTaskTitle("");
      // Creating a Task never changes the selection (goal-only survives).
      await onRefresh();
    } else {
      onError(result.error.message);
    }
    setBusyQuickAdd(false);
  };

  return (
    <div className="space-y-6">
      <Card className="border-stone-200 bg-white shadow-[0_18px_55px_rgba(41,37,36,0.10)]">
        <CardContent className="space-y-8 p-6 sm:p-10">
          {/* Goal / task switching */}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="font-mono text-xs tracking-wider text-stone-500 uppercase">
                目标
              </span>
              <select
                value={selection.goal.id}
                onChange={(e) => void handleSelectGoal(e.target.value)}
                className="h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm font-medium"
              >
                {goals.map((item) => (
                  <option key={item.goal.id} value={item.goal.id}>
                    {item.goal.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5">
              <span className="font-mono text-xs tracking-wider text-stone-500 uppercase">
                任务
              </span>
              <select
                value={selection.task?.id ?? ""}
                onChange={(e) =>
                  void handleSelectTask(
                    selection.goal.id,
                    e.target.value || null,
                  )
                }
                className="h-10 w-full rounded-lg border border-stone-200 bg-white px-3 text-sm font-medium"
              >
                <option value="">仅围绕目标执行</option>
                {taskOptions.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Execution object + hint */}
          <div className="space-y-3 text-center">
            <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              {selection.task?.title ?? selection.goal.title}
            </h1>
            <p className="text-xs text-stone-400">
              {selection.goalOnly
                ? "仅围绕目标执行"
                : `目标 · ${selection.goal.title} · ${selectionReasonLabel[selection.reason]}`}
            </p>
            {resumeHint && (
              <p className="mx-auto flex max-w-xl items-start justify-center gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200/70">
                <Sparkles
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  <span className="mr-1 font-medium">接续提示：</span>
                  {resumeHint}
                </span>
              </p>
            )}
          </div>

          {/* Big time + one strong primary action */}
          <div className="space-y-6 py-2">
            <div
              className="font-mono text-6xl font-semibold tracking-tight text-stone-300 tabular-nums sm:text-8xl"
              aria-hidden="true"
            >
              00:00
            </div>
            <div className="flex flex-col items-center gap-3">
              <Button
                size="lg"
                disabled={busy !== "none"}
                onClick={() => onStart({ intent: intent.trim() || null })}
                className="h-14 w-full gap-2 bg-stone-900 text-base text-stone-50 shadow-md hover:bg-stone-800 sm:w-auto sm:min-w-56"
              >
                <Play className="size-5 fill-current" aria-hidden="true" />
                {busy === "start" ? "开始中…" : "开始专注"}
              </Button>
              <label className="block w-full max-w-md">
                <span className="sr-only">本次意图</span>
                <Input
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  placeholder="这次想做什么？可选，不会自动创建任务"
                  className="h-9 text-center"
                />
              </label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* A few todos under the timer (PRD §5.1) */}
      <section aria-labelledby="todos-title" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2
            id="todos-title"
            className="font-mono text-xs tracking-wider text-stone-500 uppercase"
          >
            待办
          </h2>
          <span className="text-xs text-stone-400">
            {goals.find((g) => g.goal.id === selection.goal.id)
              ?.pendingTaskCount ?? taskOptions.length}{" "}
            个待办任务
          </span>
        </div>
        <form onSubmit={handleQuickAddTask} className="flex items-center gap-2">
          <Input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder={`快速添加到「${selection.goal.title}」`}
            maxLength={500}
            className="h-9 text-sm"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-9"
            disabled={busyQuickAdd || !newTaskTitle.trim()}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            添加
          </Button>
        </form>
        {todos.length > 0 ? (
          <ul className="divide-y divide-stone-100 rounded-xl border border-stone-200 bg-white">
            {todos.map((task) => (
              <li
                key={task.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-stone-700 hover:text-stone-950"
                  onClick={() =>
                    void handleSelectTask(selection.goal.id, task.id)
                  }
                >
                  <span className="mr-2 font-mono text-xs text-stone-400">
                    {task.position}
                  </span>
                  {task.title}
                </button>
                <span className="shrink-0 text-xs text-stone-400">
                  {taskStatusLabel[task.status]}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-xl border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">
            这个目标还没有待办任务，可以直接围绕目标开始。
          </p>
        )}
      </section>
    </div>
  );
}
