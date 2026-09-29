"use client";

import { useState } from "react";
import { CheckCircle2, Save } from "lucide-react";

import type { Task } from "@/db/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { SessionView } from "@/services/session";
import { formatHumanDuration } from "@/shared/session-timer";

export interface EndCardHintResult {
  ok: boolean;
  code?: string;
  message?: string;
}

/**
 * End card (PRD §6.5): the Session and its real time are already saved.
 * Completing the Task and saving the resume hint are independent optional
 * actions — each can fail and be retried without touching the record.
 * A stale hint version keeps the local input and rebases onto the latest
 * version once (never silently overwriting another client's text).
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
  onClose: () => void;
}) {
  const [taskState, setTaskState] = useState<
    "idle" | "saving" | "done" | "error"
  >("idle");
  const [taskError, setTaskError] = useState<string | null>(null);
  const [hint, setHint] = useState(session.resumeHint ?? "");
  const [hintVersion, setHintVersion] = useState(session.resumeHintVersion);
  const [hintState, setHintState] = useState<
    "idle" | "saving" | "saved" | "conflict" | "error"
  >("idle");
  const [hintError, setHintError] = useState<string | null>(null);

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

  const handleSaveHint = async () => {
    setHintState("saving");
    setHintError(null);
    const text = hint.trim() || null;

    let outcome = await attemptSave(text, hintVersion);
    if (outcome === "saved") {
      setHintVersion((v) => v + 1);
      setHintState("saved");
      return;
    }
    if (outcome === "conflict") {
      // Recovery: rebase onto the latest server version and retry once,
      // keeping the local text (PRD §6.5).
      const latest = await onReloadHintVersion();
      if (latest !== null) {
        outcome = await attemptSave(text, latest);
        if (outcome === "saved") {
          setHintVersion(latest + 1);
          setHintState("saved");
          return;
        }
      }
      setHintState("conflict");
      setHintError("接续提示在其他端被修改，你的输入已保留，可再次尝试。");
      return;
    }
    setHintState("error");
  };

  return (
    <Card className="border-stone-300 bg-white shadow-[0_18px_55px_rgba(41,37,36,0.10)]">
      <CardContent className="space-y-6 p-6 sm:p-8">
        <div className="space-y-2">
          <p className="flex items-center gap-2 font-mono text-xs tracking-wider text-emerald-700 uppercase">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            专注已保存
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-stone-900">
            本次投入 {formatHumanDuration(session.durationSeconds ?? 0)}
          </h2>
          {session.noteConflict && (
            <p
              role="alert"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            >
              笔记在其他端有更新，本次未覆盖；如需保留当前输入，可在记录里再保存一次。
            </p>
          )}
        </div>

        <div className="space-y-4">
          {task && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50/60 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-800">
                  {task.title}
                </p>
                <p className="text-xs text-stone-500">
                  {taskState === "done"
                    ? "任务已完成"
                    : "这次的任务完成了吗？可选。"}
                </p>
              </div>
              <Button
                size="sm"
                variant={taskState === "done" ? "outline" : "default"}
                disabled={taskState === "saving" || taskState === "done"}
                onClick={handleCompleteTask}
              >
                {taskState === "saving"
                  ? "标记中…"
                  : taskState === "done"
                    ? "已完成"
                    : "任务已完成"}
              </Button>
            </div>
          )}
          {taskError && (
            <p role="alert" className="text-sm text-red-600">
              {taskError}
            </p>
          )}

          <div className="space-y-2">
            <label
              htmlFor="end-hint"
              className="block font-mono text-xs tracking-wider text-stone-500 uppercase"
            >
              接续提示（下次从这里继续）
            </label>
            <Input
              id="end-hint"
              value={hint}
              onChange={(e) => {
                setHint(e.target.value);
                if (hintState === "saved") setHintState("idle");
              }}
              placeholder="例如：下次先补第二段例子"
              className="h-9"
            />
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                disabled={hintState === "saving"}
                onClick={handleSaveHint}
              >
                <Save className="size-3.5" aria-hidden="true" />
                {hintState === "saving"
                  ? "保存中…"
                  : hintState === "saved"
                    ? "已保存"
                    : "保存提示"}
              </Button>
            </div>
            {(hintError || hintState === "conflict") && (
              <p role="alert" className="text-sm text-red-600">
                {hintError}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            回到执行
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
