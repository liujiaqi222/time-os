"use client";

import { useEffect, useState } from "react";
import { Plus, Play, Sparkles } from "lucide-react";

import {
  listTasksAction,
  quickAddTaskAction,
  selectionSetAction,
} from "@/app/(app)/session-actions";
import { FocusClock } from "@/components/today/focus-clock";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [showIntent, setShowIntent] = useState(false);
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
    <div className="space-y-10">
      <div className="flex flex-col items-center pt-2">
        <div className="flex w-full flex-col items-center gap-1 sm:flex-row sm:justify-center sm:gap-2">
          <SwitchSelect
            label="目标"
            value={selection.goal.id}
            onChange={(goalId) => void handleSelectGoal(goalId)}
            options={goals.map((item) => ({
              value: item.goal.id,
              label: item.goal.title,
            }))}
          />
          <span className="hidden text-stone-300 sm:inline" aria-hidden="true">
            ·
          </span>
          <SwitchSelect
            label="任务"
            value={selection.task?.id ?? ""}
            onChange={(taskId) =>
              void handleSelectTask(selection.goal.id, taskId || null)
            }
            options={[
              { value: "", label: "仅围绕目标执行" },
              ...taskOptions.map((task) => ({
                value: task.id,
                label: task.title,
              })),
            ]}
          />
        </div>

        <div className="mt-9 space-y-2 text-center">
          {!selection.goalOnly && (
            <p className="text-sm text-stone-500">{selection.goal.title}</p>
          )}
          <h1 className="max-w-xl text-3xl font-semibold tracking-[-0.035em] text-balance text-stone-950 sm:text-5xl sm:leading-tight">
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

        <div className="mt-8 flex items-center justify-center sm:mt-10">
          <FocusClock value="00:00" aria-hidden="true" />
        </div>

        <div className="mt-8 flex w-full flex-col items-center gap-3 sm:mt-10">
          <Button
            size="lg"
            disabled={busy !== "none"}
            onClick={() => onStart({ intent: intent.trim() || null })}
            className="h-13 w-full max-w-xs gap-2 rounded-xl bg-[#d85c41] px-6 text-base text-white shadow-sm hover:bg-[#c84f36]"
          >
            <Play className="size-4 fill-current" aria-hidden="true" />
            {busy === "start" ? "开始中…" : "开始专注"}
          </Button>
          {showIntent ? (
            <div className="w-full max-w-sm rounded-xl border border-stone-200 bg-stone-50 p-3 text-left">
              <div className="flex items-baseline justify-between gap-3">
                <label
                  htmlFor="session-intent"
                  className="text-sm font-medium text-stone-700"
                >
                  本次说明
                </label>
                <button
                  type="button"
                  className="text-xs text-stone-400 hover:text-stone-700"
                  onClick={() => {
                    setShowIntent(false);
                    setIntent("");
                  }}
                >
                  移除
                </button>
              </div>
              <Input
                id="session-intent"
                value={intent}
                onChange={(e) => setIntent(e.target.value)}
                placeholder="例如：先梳理首页结构"
                className="mt-2 h-10 border-stone-300 bg-white shadow-none"
                autoFocus
              />
              <p className="mt-2 text-xs leading-5 text-stone-500">
                只附在这次专注记录里，不会加入下面的目标任务。
              </p>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-stone-500"
              onClick={() => setShowIntent(true)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              添加本次说明
            </Button>
          )}
        </div>
      </div>

      <section
        aria-labelledby="todos-title"
        className="space-y-3 rounded-2xl border border-stone-200 bg-stone-50 p-5 sm:p-6"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="todos-title" className="text-sm font-semibold text-stone-800">
            目标任务
          </h2>
          <span className="text-xs text-stone-400">
            {pendingCount} 项未完成
          </span>
        </div>
        <p className="text-xs leading-5 text-stone-500">
          任务会持续保留。点击一项，即可设为本次专注内容。
        </p>
        <form onSubmit={handleQuickAddTask} className="flex items-center gap-2">
          <Input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder={`给「${selection.goal.title}」添加任务`}
            maxLength={500}
            className="h-10 bg-white text-sm"
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="h-10 bg-white"
            disabled={busyQuickAdd || !newTaskTitle.trim()}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            创建
          </Button>
        </form>
        {todos.length > 0 ? (
          <ul className="divide-y divide-stone-200 overflow-hidden rounded-xl border border-stone-200 bg-white">
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
            这个目标还没有任务。可以直接围绕目标专注，也可以先创建一项。
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
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select
      items={options}
      value={value}
      onValueChange={(nextValue) => onChange(nextValue ?? "")}
    >
      <SelectTrigger
        aria-label={label}
        className="h-9 max-w-64 min-w-0 gap-2 border-stone-200 bg-white px-3 text-stone-800 shadow-none hover:border-stone-300"
      >
        <span className="shrink-0 text-xs text-stone-400">{label}</span>
        <SelectValue className="max-w-44 min-w-0 font-medium text-stone-900" />
      </SelectTrigger>
      <SelectContent
        align="start"
        alignItemWithTrigger={false}
        className="max-w-80 border-stone-200 bg-white"
      >
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
