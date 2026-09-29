"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";

import {
  cancelSessionAction,
  completeTaskAction,
  createGoalAction,
  finishSessionAction,
  getDashboardAction,
  getSessionAction,
  startSessionAction,
  updateResumeHintAction,
} from "@/app/(app)/session-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { EndCard } from "@/components/today/end-card";
import { IdlePanel } from "@/components/today/idle-panel";
import { RunPanel, type RunBusyAction } from "@/components/today/run-panel";
import type { DashboardData } from "@/services/dashboard";
import type { SessionView } from "@/services/session";
import { formatHumanDuration } from "@/shared/session-timer";

/**
 * The execution home (PRD §5). One page owns the whole stopwatch loop:
 * idle → running/paused → finish (direct save) → optional completion and
 * resume hint → next visit continues. Server state is the source of
 * truth — refresh, focus and reconnect all re-read it.
 */
export function TodayView({
  initialDashboard,
}: {
  initialDashboard: DashboardData;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState<RunBusyAction>("none");
  const [actionError, setActionError] = useState<string | null>(null);
  const [remoteNotice, setRemoteNotice] = useState<{
    kind: "finished" | "cancelled";
    durationSeconds: number | null;
  } | null>(null);
  const [endCard, setEndCard] = useState<SessionView | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [newGoalTitle, setNewGoalTitle] = useState("");
  const [busyGoal, setBusyGoal] = useState(false);

  // The Session this page believes is running; null when idle/none.
  const runningIdRef = useRef<string | null>(
    initialDashboard.activeSession?.id ?? null,
  );
  // Set when THIS page ends/cancels so the cross-end detector stays quiet.
  const selfEndRef = useRef(false);

  const refresh = useCallback(async () => {
    const result = await getDashboardAction();
    if (result.ok) setDashboard(result.data);
    return result.ok ? result.data : null;
  }, []);

  const checkRemoteEnd = useCallback(async (sessionId: string) => {
    const result = await getSessionAction(sessionId);
    if (!result.ok) return;
    if (result.data.status === "completed") {
      setRemoteNotice({
        kind: "finished",
        durationSeconds: result.data.durationSeconds,
      });
    } else if (result.data.status === "cancelled") {
      setRemoteNotice({ kind: "cancelled", durationSeconds: null });
    }
  }, []);

  // Another tab / device ended or cancelled the Session we were showing
  // (PRD §5): stop the old UI and surface the actual result.
  const activeId = dashboard.activeSession?.id ?? null;
  useEffect(() => {
    if (activeId) {
      runningIdRef.current = activeId;
      return;
    }
    const previous = runningIdRef.current;
    runningIdRef.current = null;
    if (previous && !selfEndRef.current && !endCard) {
      void checkRemoteEnd(previous);
    }
    selfEndRef.current = false;
  }, [activeId, endCard, checkRemoteEnd]);

  // Browser refresh already re-renders from the server; refocus and
  // reconnect re-read it too (PRD §5).
  useEffect(() => {
    const resync = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") resync();
    };
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // ---- Run actions ---------------------------------------------------------

  const handleStart = async (input: { intent: string | null }) => {
    const selection = dashboard.selection;
    if (!selection || busy !== "none") return;
    setBusy("start");
    setActionError(null);
    setRemoteNotice(null);
    const result = await startSessionAction({
      goalId: selection.goal.id,
      taskId: selection.task?.id ?? null,
      intent: input.intent,
    });
    if (result.ok) {
      await refresh();
    } else if (result.error.code === "ACTIVE_SESSION_EXISTS") {
      await refresh();
      setActionError("另一处已经开始了一段专注，已为你定位到当前记录。");
    } else if (result.error.code === "GOAL_NOT_ACTIVE") {
      await refresh();
      setActionError("这个目标已不可执行，请重新选择一个目标。");
    } else {
      setActionError(result.error.message);
    }
    setBusy("none");
  };

  const handleFinish = async (payload: {
    note: string | null;
    expectedVersion: number;
    changed: boolean;
  }) => {
    const session = dashboard.activeSession;
    if (!session || busy !== "none") return;
    setBusy("finish");
    setActionError(null);
    const result = await finishSessionAction({
      sessionId: session.id,
      ...(payload.changed
        ? { note: payload.note, noteExpectedVersion: payload.expectedVersion }
        : {}),
    });
    if (result.ok) {
      selfEndRef.current = true;
      runningIdRef.current = null;
      setEndCard(result.data);
      await refresh();
    } else {
      // Kept the current info and the retry entry (PRD §6.5); if it ended
      // elsewhere, the notice below explains what actually happened.
      await refresh();
      setActionError("结束保存失败：当前信息已保留，可重试。");
    }
    setBusy("none");
  };

  const handleCancel = async () => {
    const session = dashboard.activeSession;
    if (!session) return;
    setBusy("cancel");
    setActionError(null);
    const result = await cancelSessionAction(session.id);
    if (result.ok) {
      selfEndRef.current = true;
      runningIdRef.current = null;
      setCancelOpen(false);
      await refresh();
    } else {
      await refresh();
      setActionError("取消失败，请重试。");
    }
    setBusy("none");
  };

  const handleSessionUpdated = (view: SessionView) => {
    setDashboard((prev) => ({ ...prev, activeSession: view }));
  };

  const handleSessionLost = async () => {
    // Pause/resume hit an invalid state — the Session ended elsewhere.
    await refresh();
    setActionError("当前专注已更新，请看下方的实际结果。");
  };

  // ---- End card helpers ----------------------------------------------------

  const completeFromEndCard = async (taskId: string) => {
    const result = await completeTaskAction(taskId);
    return result.ok
      ? { ok: true }
      : { ok: false, message: result.error.message };
  };

  const saveHintFromEndCard = async (
    hint: string | null,
    expectedVersion: number,
  ) => {
    if (!endCard) return { ok: false };
    const result = await updateResumeHintAction({
      sessionId: endCard.id,
      resumeHint: hint,
      expectedVersion,
    });
    if (result.ok) {
      setEndCard((prev) =>
        prev
          ? {
              ...prev,
              resumeHint: result.data.resumeHint,
              resumeHintVersion: result.data.resumeHintVersion,
            }
          : prev,
      );
      return { ok: true };
    }
    return {
      ok: false,
      code: result.error.code,
      message: result.error.message,
    };
  };

  const reloadHintVersion = async () => {
    if (!endCard) return null;
    const result = await getSessionAction(endCard.id);
    return result.ok ? result.data.resumeHintVersion : null;
  };

  // ---- Empty state ----------------------------------------------------------

  const handleCreateFirstGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = newGoalTitle.trim();
    if (!title) return;
    setBusyGoal(true);
    setActionError(null);
    const result = await createGoalAction({ title });
    if (result.ok) {
      setNewGoalTitle("");
      await refresh();
    } else {
      setActionError(result.error.message);
    }
    setBusyGoal(false);
  };

  const { activeSession, selection, goals, todayStats } = dashboard;

  return (
    <div className="mx-auto w-full max-w-xl space-y-6 pb-4">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-stone-500">
          今日已投入 {formatHumanDuration(todayStats.totalFocusSeconds)} ·{" "}
          {todayStats.sessionCount} 次执行
        </p>
        {activeSession && (
          <p className="text-xs text-stone-400">
            Space 暂停 / 继续 · F 结束 · D 打断
          </p>
        )}
      </header>

      {remoteNotice && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
        >
          <span>
            {remoteNotice.kind === "finished"
              ? `这段专注已在另一端结束并保存${
                  remoteNotice.durationSeconds != null
                    ? `，实际 ${formatHumanDuration(remoteNotice.durationSeconds)}`
                    : ""
                }。`
              : "这段专注已在另一端取消，不计入统计。"}
          </span>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setRemoteNotice(null)}
          >
            知道了
          </Button>
        </div>
      )}

      {actionError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {actionError}
        </div>
      )}

      {endCard ? (
        <EndCard
          session={endCard}
          task={endCard.task}
          onCompleteTask={completeFromEndCard}
          onSaveHint={saveHintFromEndCard}
          onReloadHintVersion={reloadHintVersion}
          onClose={() => {
            setEndCard(null);
            void refresh();
          }}
        />
      ) : activeSession ? (
        <RunPanel
          key={activeSession.id}
          session={activeSession}
          busy={busy}
          cancelOpen={cancelOpen}
          onSessionUpdated={handleSessionUpdated}
          onSessionLost={handleSessionLost}
          onFinishRequested={(payload) => void handleFinish(payload)}
          onOpenCancel={() => setCancelOpen(true)}
        />
      ) : selection ? (
        <IdlePanel
          dashboard={dashboard}
          busy={busy === "start" ? "start" : "none"}
          onStart={(input) => void handleStart(input)}
          onRefresh={refresh}
          onError={setActionError}
        />
      ) : (
        <div className="flex flex-col items-start gap-5 pt-8">
          <div className="space-y-2">
            <h2 className="text-2xl font-medium tracking-tight">
              {goals.length === 0
                ? "最近，有什么事是你真的想推进的？"
                : "当前没有可执行的目标"}
            </h2>
            <p className="text-sm leading-6 text-stone-500">
              输入一个目标标题即可开始。目标只在这里创建，一次专注也只需要一次点击。
            </p>
          </div>
          <form
            onSubmit={handleCreateFirstGoal}
            className="flex w-full flex-col gap-2 sm:flex-row"
          >
            <Input
              value={newGoalTitle}
              onChange={(e) => setNewGoalTitle(e.target.value)}
              placeholder="例如：把产品介绍页改完"
              maxLength={240}
              className="h-11 flex-1 bg-white/70 text-base"
              aria-label="目标标题"
            />
            <Button
              type="submit"
              size="lg"
              disabled={busyGoal || !newGoalTitle.trim()}
              className="h-11 gap-1.5 rounded-full px-4"
            >
              <Plus className="size-4" aria-hidden="true" />
              {busyGoal ? "创建中…" : "创建目标"}
            </Button>
          </form>
        </div>
      )}

      {cancelOpen && activeSession && (
        <ConfirmationDialog
          titleId="cancel-session-title"
          title="取消这段专注？"
          description={
            <>
              记录会保留但从统计中排除，且不能恢复计时。若想保留已发生的投入，请改用「结束并保存」。
            </>
          }
          confirmLabel="确定取消"
          tone="danger"
          pending={busy === "cancel"}
          onClose={() => setCancelOpen(false)}
          onConfirm={() => void handleCancel()}
        />
      )}
    </div>
  );
}
