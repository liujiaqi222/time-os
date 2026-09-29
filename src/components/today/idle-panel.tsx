"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Plus, Play, Sparkles } from "lucide-react";

import {
  listTasksAction,
  quickAddTaskAction,
  selectionSetAction,
} from "@/app/(app)/session-actions";
import { FocusClock } from "@/components/today/focus-clock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Task } from "@/db/schema";
import type { DashboardData } from "@/services/dashboard";
import { taskStatusLabel } from "@/shared/labels";

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

  const pendingCount =
    goals.find((item) => item.goal.id === selection.goal.id)
      ?.pendingTaskCount ?? taskOptions.length;

  return (
    <div className="space-y-12">
      <div className="flex flex-col items-center pt-2">
        <div className="flex w-full flex-col items-center gap-1 sm:flex-row sm:justify-center sm:gap-2">
          <SwitchSelect
            label="目标"
            value={selection.goal.id}
            onChange={(goalId) => void handleSelectGoal(goalId)}
          >
            {goals.map((item) => (
              <option key={item.goal.id} value={item.goal.id}>
                {item.goal.title}
              </option>
            ))}
          </SwitchSelect>
          <span className="hidden text-stone-300 sm:inline" aria-hidden="true">
            ·
          </span>
          <SwitchSelect
            label="任务"
            value={selection.task?.id ?? ""}
            onChange={(taskId) =>
              void handleSelectTask(selection.goal.id, taskId || null)
            }
          >
            <option value="">仅围绕目标执行</option>
            {taskOptions.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </SwitchSelect>
        </div>

        <div className="mt-10 space-y-2 text-center">
          {!selection.goalOnly && (
            <p className="text-sm text-stone-500">{selection.goal.title}</p>
          )}
          <h1 className="text-3xl font-medium tracking-tight text-balance text-stone-950 sm:text-4xl">
            {selection.task?.title ?? selection.goal.title}
          </h1>
        </div>

        {resumeHint && (
          <p className="mt-5 flex max-w-sm items-start gap-2 rounded-2xl bg-amber-50/90 px-3.5 py-2.5 text-left text-sm leading-6 text-amber-950">
            <Sparkles
              className="mt-1 size-3.5 shrink-0 text-amber-700"
              aria-hidden="true"
            />
            <span>
              <span className="font-medium">接续提示：</span>
              {resumeHint}
            </span>
          </p>
        )}

        <FocusClock
          value="00:00"
          aria-hidden="true"
          className="mt-8 sm:mt-10"
        />

        <div className="mt-8 flex w-full flex-col items-center gap-4 sm:mt-10">
          <Button
            size="lg"
            disabled={busy !== "none"}
            onClick={() => onStart({ intent: intent.trim() || null })}
            className="h-12 w-full max-w-xs gap-2 rounded-full bg-stone-950 px-6 text-base text-stone-50 hover:bg-stone-800"
          >
            <Play className="size-4 fill-current" aria-hidden="true" />
            {busy === "start" ? "开始中…" : "开始专注"}
          </Button>
          <label className="block w-full max-w-sm">
            <span className="sr-only">本次意图</span>
            <Input
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="这次想做什么？可选，不会自动创建任务"
              className="h-10 rounded-none border-0 border-b border-stone-200 bg-transparent px-1 text-center shadow-none focus-visible:border-stone-400 focus-visible:ring-0"
            />
          </label>
        </div>
      </div>

      <section
        aria-labelledby="todos-title"
        className="space-y-3 border-t border-stone-200/80 pt-8"
      >
        <div className="flex items-baseline justify-between">
          <h2 id="todos-title" className="text-sm font-medium text-stone-700">
            待办
          </h2>
          <span className="text-xs text-stone-400">
            {pendingCount} 个待办任务
          </span>
        </div>
        <form onSubmit={handleQuickAddTask} className="flex items-center gap-2">
          <Input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder={`快速添加到「${selection.goal.title}」`}
            maxLength={500}
            className="h-10 bg-white/70 text-sm"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-10 bg-white/70"
            disabled={busyQuickAdd || !newTaskTitle.trim()}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            添加
          </Button>
        </form>
        {todos.length > 0 ? (
          <ul className="divide-y divide-stone-200/70 overflow-hidden rounded-2xl border border-stone-200/80 bg-white/70">
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
                  <span className="mr-2 text-xs text-stone-400 tabular-nums">
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
          <p className="px-1 py-3 text-sm text-stone-500">
            这个目标还没有待办任务，可以直接围绕目标开始。
          </p>
        )}
      </section>
    </div>
  );
}

function SwitchSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex h-9 max-w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-stone-800 transition-colors hover:bg-white/80">
      <span className="shrink-0 text-xs text-stone-400">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-44 min-w-0 cursor-pointer appearance-none truncate bg-transparent text-sm font-medium text-stone-900 outline-none"
      >
        {children}
      </select>
      <ChevronDown
        className="size-3.5 shrink-0 text-stone-400"
        aria-hidden="true"
      />
    </label>
  );
}
