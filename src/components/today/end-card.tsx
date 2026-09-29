"use client";

import { useState } from "react";
import { ArrowRight, Check, CheckCircle2 } from "lucide-react";

import type { Task } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SessionView } from "@/services/session";
import { formatHumanDuration } from "@/shared/session-timer";

export interface EndCardHintResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/**
 * Ending has already saved the Session and its real time. This compact
 * follow-up only handles the two optional writes: completing the Task and
 * leaving a resume hint. Neither can put the saved time at risk.
 */
export function EndCard({
  session,
  task,
  onCompleteTask,
  onSaveHint,
  onReloadHintVersion,
  onClose,
}: {
  session: SessionView;
  task: Task | null;
  onCompleteTask: (
    taskId: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  onSaveHint: (
    hint: string | null,
    expectedVersion: number,
  ) => Promise<EndCardHintResult>;
  onReloadHintVersion: () => Promise<number | null>;
  onClose: (needsRefresh: boolean) => void;
}) {
  const [taskState, setTaskState] = useState<
    "idle" | "saving" | "done" | "error"
  >("idle");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [hint, setHint] = useState(session.resumeHint ?? "");
  const [hintVersion, setHintVersion] = useState(session.resumeHintVersion);
  const [hintState, setHintState] = useState<
    "idle" | "saving" | "conflict" | "error"
  >("idle");
  const [hintError, setHintError] = useState<string | null>(null);
  const initialHint = session.resumeHint?.trim() ?? "";
  const normalizedHint = hint.trim();
  const hintChanged = normalizedHint !== initialHint;

  const handleCompleteTask = async () => {
    if (!task) return;
    setTaskState("saving");
    setTaskError(null);
    const result = await onCompleteTask(task.id);
    if (result.ok) {
      setTaskState("done");
    } else {
      setTaskState("error");
      setTaskError(result.message ?? "任务完成失败，可以重试。");
    }
  };

  const attemptSave = async (
    text: string | null,
    expectedVersion: number,
  ): Promise<"saved" | "conflict" | "error"> => {
    const result = await onSaveHint(text, expectedVersion);
    if (result.ok) return "saved";
    if (result.code === "VERSION_CONFLICT") return "conflict";
    setHintError(result.message ?? "接续提示保存失败，可重试。");
    return "error";
  };

  const saveHint = async () => {
    setHintState("saving");
    setHintError(null);
    const text = hint.trim() || null;

    let outcome = await attemptSave(text, hintVersion);
    if (outcome === "saved") return true;

    if (outcome === "conflict") {
      // Rebase once while preserving the text typed on this device.
      const latest = await onReloadHintVersion();
      if (latest !== null) {
        outcome = await attemptSave(text, latest);
        if (outcome === "saved") {
          setHintVersion(latest + 1);
          return true;
        }
      }
      setHintState("conflict");
      setHintError("接续提示在其他端被修改。你的输入还在，可以再次保存。");
      return false;
    }

    setHintState("error");
    return false;
  };

  const handleSaveAndClose = async () => {
    // Finishing already saved the Session. An untouched optional hint should
    // close locally instead of writing the same empty value back to the DB.
    if (!hintChanged) {
      onClose(taskState === "done");
      return;
    }
    if (await saveHint()) onClose(taskState === "done");
  };

  return (
    <div className="mx-auto max-w-3xl py-1">
      <div className="completion-summary-enter flex items-center gap-4">
        <span className="completion-check-enter relative flex size-12 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-800">
          <span
            className="completion-check-ring pointer-events-none absolute inset-0 rounded-full border border-emerald-500/70"
            aria-hidden="true"
          />
          <CheckCircle2 className="size-5.5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-emerald-800">专注已保存</p>
          <h2 className="mt-0.5 text-3xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-4xl">
            {formatHumanDuration(session.durationSeconds ?? 0)}
          </h2>
        </div>
      </div>

      <section
        className={`mt-6 grid overflow-hidden rounded-2xl border border-stone-200 bg-stone-50/70 ${task ? "sm:grid-cols-2" : ""}`}
        aria-labelledby="execution-context-title"
      >
        <h3 id="execution-context-title" className="sr-only">
          本次专注内容
        </h3>
        <div className="min-w-0 p-4 sm:p-5">
          <p className="text-xs font-medium text-stone-500">目标</p>
          <p className="mt-1.5 truncate text-base font-semibold text-stone-950">
            {session.goal.title}
          </p>
        </div>

        {task && (
          <div className="min-w-0 border-t border-stone-200 p-4 sm:border-t-0 sm:border-l sm:p-5">
            <p className="text-xs font-medium text-stone-500">本次任务</p>
            <div className="mt-1.5 flex min-w-0 items-center justify-between gap-4">
              <p className="min-w-0 truncate text-base font-semibold text-stone-950">
                {task.title}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={
                  taskState === "done" ? "任务已完成" : "标记任务完成"
                }
                disabled={taskState === "saving" || taskState === "done"}
                onClick={handleCompleteTask}
                className={`h-8 shrink-0 gap-1.5 rounded-lg px-3 shadow-none ${
                  taskState === "done"
                    ? "completion-check-enter border-emerald-700 bg-emerald-700 text-white disabled:opacity-100"
                    : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"
                }`}
              >
                <Check className="size-3.5" aria-hidden="true" />
                {taskState === "saving"
                  ? "标记中…"
                  : taskState === "done"
                    ? "已完成"
                    : "标记完成"}
              </Button>
            </div>
            {taskError && (
              <p role="alert" className="mt-2 text-xs text-red-700">
                {taskError}
              </p>
            )}
          </div>
        )}
      </section>

      {session.noteConflict && (
        <p
          role="alert"
          className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          笔记在其他端有更新，本次未覆盖；当前输入仍可在记录里再次保存。
        </p>
      )}

      <section
        className="mt-7 border-t border-stone-200 pt-7"
        aria-labelledby="resume-hint-title"
      >
        <div>
          <h3
            id="resume-hint-title"
            className="text-base font-semibold text-stone-900"
          >
            给下次留个起点
          </h3>
          <p className="mt-1 text-sm leading-6 text-stone-500">
            写下继续时的第一个具体动作；不写也可以直接返回。
          </p>
        </div>

        <div className="mt-4">
          <label htmlFor="end-hint" className="sr-only">
            下次继续的第一步
          </label>
          <Input
            id="end-hint"
            value={hint}
            onChange={(event) => {
              setHint(event.target.value);
              if (hintState !== "idle") setHintState("idle");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void handleSaveAndClose();
              }
            }}
            placeholder="例如：先补完第二段的例子"
            className="h-11 border-stone-300 bg-white px-3.5 text-base shadow-none focus-visible:border-stone-500 focus-visible:ring-stone-200"
          />
          {(hintError || hintState === "conflict") && (
            <p role="alert" className="text-sm text-red-600">
              {hintError}
            </p>
          )}
        </div>
      </section>

      <div className="mt-6 flex justify-end">
        <Button
          className="h-10 gap-2 rounded-xl bg-stone-900 px-5 text-white hover:bg-stone-800"
          disabled={hintState === "saving" || taskState === "saving"}
          onClick={() => void handleSaveAndClose()}
        >
          {hintState === "saving"
            ? "保存中…"
            : hintChanged
              ? "保存起点并返回"
              : "回到今天"}
          {hintState !== "saving" && (
            <ArrowRight className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </div>
  );
}
