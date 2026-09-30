"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Circle,
  CircleCheck,
  ListTodo,
  Loader2,
  Play,
  Plus,
  Sparkles,
} from "lucide-react";

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
  onOptimisticTaskAdd,
  onOptimisticTaskResolve,
  onOptimisticTaskRevert,
  onOptimisticSelectTask,
}: {
  dashboard: DashboardData;
  busy: "none" | "start";
  onStart: (input: { intent: string | null }) => void;
  onRefresh: () => Promise<unknown>;
  onError: (message: string | null) => void;
  onOptimisticTaskAdd?: (task: Task) => void;
  onOptimisticTaskResolve?: (tempId: string, realTask: Task) => void;
  onOptimisticTaskRevert?: (tempId: string, goalId: string) => void;
  onOptimisticSelectTask?: (goalId: string, task: Task | null) => void;
}) {
  const { selection, resumeHint, goals, todos } = dashboard;
  const [intent, setIntent] = useState("");
  const [showIntent, setShowIntent] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
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
    const previousSelection = selection;
    const nextTask = taskId
      ? (taskOptions.find((t) => t.id === taskId) ?? null)
      : null;
    onOptimisticSelectTask?.(goalId, nextTask);

    try {
      const result = await selectionSetAction({ goalId, taskId });
      if (!result.ok) {
        onOptimisticSelectTask?.(
          previousSelection.goal.id,
          previousSelection.task,
        );
        onError(result.error.message);
      } else {
        // Background sync without blocking UI
        void onRefresh();
      }
    } catch {
      onOptimisticSelectTask?.(
        previousSelection.goal.id,
        previousSelection.task,
      );
      onError("切换任务失败，请稍后重试");
    }
  };

  const handleQuickAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newTaskTitle.trim();
    if (!title) return;
    onError(null);
    setNewTaskTitle("");

    const goalId = selection.goal.id;
    const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const optimisticTask: Task = {
      id: tempId,
      goalId,
      title,
      description: null,
      status: "pending",
      position: (todos[todos.length - 1]?.position ?? 0) + 1,
      estimatedMinutes: null,
      resourceType: null,
      resourceValue: null,
      note: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    onOptimisticTaskAdd?.(optimisticTask);

    try {
      const result = await quickAddTaskAction({
        goalId,
        title,
      });

      if (result.ok && result.data[0]) {
        const createdTask = result.data[0];
        onOptimisticTaskResolve?.(tempId, createdTask);
        setFetched((prev) =>
          prev && prev.goalId === goalId
            ? { ...prev, tasks: [...prev.tasks, createdTask] }
            : prev,
        );
        // Non-blocking background sync for final consistency.
        void onRefresh();
      } else {
        onOptimisticTaskRevert?.(tempId, goalId);
        setNewTaskTitle((prev) => (prev ? prev : title));
        onError(result.ok ? "创建任务失败" : result.error.message);
      }
    } catch {
      onOptimisticTaskRevert?.(tempId, goalId);
      setNewTaskTitle((prev) => (prev ? prev : title));
      onError("网络请求失败，请稍后重试");
    }
  };

  const pendingCount =
    goals.find((item) => item.goal.id === selection.goal.id)
      ?.pendingTaskCount ?? taskOptions.length;

  return (
    <div className="space-y-10">
      <div className="flex flex-col items-center pt-2">
        {/* Execution context switcher: one segmented pill for 目标 + 任务. */}
        <div className="flex w-full flex-col items-stretch rounded-2xl border border-stone-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(28,25,23,0.05)] sm:w-auto sm:flex-row sm:items-center sm:rounded-full sm:p-1">
          <SwitchSelect
            label="目标"
            value={selection.goal.id}
            onChange={(goalId) => void handleSelectGoal(goalId)}
            options={goals.map((item) => ({
              value: item.goal.id,
              label: item.goal.title,
            }))}
          />
          <span
            aria-hidden="true"
            className="h-px w-full bg-stone-100 sm:mx-1 sm:h-5 sm:w-px sm:bg-stone-200"
          />
          <SwitchSelect
            label="任务"
            value={selection.task?.id ?? ""}
            onChange={(taskId) =>
              void handleSelectTask(selection.goal.id, taskId || null)
            }
            options={[
              { value: "", label: "不设任务" },
              ...taskOptions
                .filter((task) => !task.id.startsWith("temp-"))
                .map((task) => ({
                  value: task.id,
                  label: task.title,
                })),
            ]}
          />
        </div>

        <div className="mt-7 space-y-2 text-center sm:mt-9">
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

        <div className="mt-7 flex flex-col items-center sm:mt-9">
          <FocusClock value="00:00" tone="idle" aria-hidden="true" />
          <p className="mt-4">
            <span className="inline-flex items-center rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-500">
              准备开始
            </span>
          </p>
        </div>

        <div className="mt-7 flex w-full flex-col items-center gap-3 sm:mt-8">
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
        className="space-y-4 rounded-2xl border border-stone-200 bg-stone-50 p-5 sm:p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-baseline gap-2">
            <h2
              id="todos-title"
              className="text-sm font-semibold text-stone-800"
            >
              目标任务
            </h2>
            <span className="text-xs text-stone-400">
              {pendingCount} 项未完成
            </span>
          </div>
          <Button
            variant="ghost"
            size="xs"
            nativeButton={false}
            render={<Link href="/goals" />}
            className="gap-0.5 text-stone-500"
          >
            管理
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </Button>
        </div>

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
            disabled={!newTaskTitle.trim()}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            创建
          </Button>
        </form>

        {todos.length > 0 ? (
          <>
            <p className="text-xs text-stone-400">
              点击任务设为本次专注；再次点击可取消。
            </p>
            <ul className="divide-y divide-stone-100 overflow-hidden rounded-xl border border-stone-200 bg-white">
              {todos.map((task) => {
                const selected = selection.task?.id === task.id;
                const isOptimistic = task.id.startsWith("temp-");
                return (
                  <li key={task.id}>
                    <button
                      type="button"
                      disabled={isOptimistic}
                      aria-pressed={selected}
                      onClick={() =>
                        void handleSelectTask(
                          selection.goal.id,
                          selected ? null : task.id,
                        )
                      }
                      className={`group flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${
                        selected ? "bg-[#fdf6f1]" : "hover:bg-stone-50"
                      } ${isOptimistic ? "cursor-default opacity-75" : ""}`}
                    >
                      {isOptimistic ? (
                        <Loader2
                          className="size-4 shrink-0 animate-spin text-stone-400"
                          aria-hidden="true"
                        />
                      ) : selected ? (
                        <CircleCheck
                          className="size-4 shrink-0 text-[#d85c41]"
                          aria-hidden="true"
                        />
                      ) : (
                        <Circle
                          className="size-4 shrink-0 text-stone-300"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={`min-w-0 flex-1 truncate ${
                          selected
                            ? "font-medium text-stone-950"
                            : "text-stone-700"
                        }`}
                      >
                        {task.title}
                      </span>
                      <span
                        className={`shrink-0 text-xs ${
                          isOptimistic
                            ? "text-stone-400"
                            : selected
                              ? "font-medium text-[#b54b35]"
                              : "hidden text-stone-400 group-hover:inline"
                        }`}
                      >
                        {isOptimistic
                          ? "创建中…"
                          : selected
                            ? "本次专注"
                            : "设为本次"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {pendingCount > todos.length && (
              <Link
                href="/goals"
                className="flex items-center justify-center gap-1 rounded-xl border border-dashed border-stone-200 py-2.5 text-xs text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-800"
              >
                还有 {pendingCount - todos.length} 项未完成，到管理页查看全部
                <ArrowUpRight className="size-3.5" aria-hidden="true" />
              </Link>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-stone-200 bg-white/60 px-4 py-7 text-center">
            <ListTodo className="size-5 text-stone-300" aria-hidden="true" />
            <p className="max-w-xs text-sm leading-6 text-stone-500">
              还没有任务。可以直接围绕目标专注，或在上面创建一项。
            </p>
          </div>
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
        className="h-9 w-full min-w-0 gap-1.5 rounded-[10px] border-transparent bg-transparent px-3 text-stone-800 shadow-none hover:bg-stone-100 sm:w-auto sm:max-w-56 sm:rounded-full sm:px-3.5"
      >
        <span className="shrink-0 text-xs text-stone-400">{label}</span>
        <SelectValue className="min-w-0 flex-1 text-left font-medium text-stone-900" />
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
