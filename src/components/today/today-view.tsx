"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Flame } from "lucide-react";

import {
  cancelSessionAction,
  completeTaskAction,
  finishSessionAction,
  getDashboardAction,
  getSessionAction,
  startSessionAction,
  updateResumeHintAction,
} from "@/app/(app)/session-actions";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { EndCard } from "@/components/today/end-card";
import { IdlePanel } from "@/components/today/idle-panel";
import { RunPanel, type RunBusyAction } from "@/components/today/run-panel";
import type { Task } from "@/db/schema";
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
  initialHeadline,
  firstRun = false,
}: {
  initialDashboard: DashboardData;
  initialHeadline: string;
  firstRun?: boolean;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState<RunBusyAction>("none");
  const [actionError, setActionError] = useState<string | null>(null);
  const [remoteNotice, setRemoteNotice] = useState<{
    kind: "finished" | "cancelled";
    durationSeconds: number | null;
  } | null>(null);
  const [endCard, setEndCard] = useState<SessionView | null>(null);
  const [completionMoment, setCompletionMoment] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);

  // The Session this page believes is running; null when idle/none.
  const runningIdRef = useRef<string | null>(
    initialDashboard.activeSession?.id ?? null,
  );
  // The portion of today's total already represented by the dashboard read.
  // Timer actions return authoritative durations, so success can update the
  // summary locally instead of blocking on another full dashboard request.
  const dashboardSessionSecondsRef = useRef(
    initialDashboard.activeSession?.focusSeconds ?? 0,
  );
  // Set when THIS page ends/cancels so the cross-end detector stays quiet.
  const selfEndRef = useRef(false);

  const refresh = useCallback(async () => {
    const result = await getDashboardAction();
    if (result.ok) {
      dashboardSessionSecondsRef.current =
        result.data.activeSession?.focusSeconds ?? 0;
      setDashboard(result.data);
    }
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
      dashboardSessionSecondsRef.current = 0;
      setDashboard((prev) => ({
        ...prev,
        serverNow: result.data.serverNow,
        activeSession: result.data,
        resumeHint: null,
      }));
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
      const knownSeconds = dashboardSessionSecondsRef.current;
      const finalSeconds = result.data.durationSeconds ?? 0;
      dashboardSessionSecondsRef.current = 0;
      setEndCard(result.data);
      setCompletionMoment((moment) => moment + 1);
      setDashboard((prev) => ({
        ...prev,
        serverNow: result.data.serverNow,
        activeSession: null,
        todayStats: {
          ...prev.todayStats,
          totalFocusSeconds:
            prev.todayStats.totalFocusSeconds +
            Math.max(0, finalSeconds - knownSeconds),
          sessionCount:
            prev.todayStats.sessionCount +
            (knownSeconds === 0 && finalSeconds > 0 ? 1 : 0),
        },
      }));
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
      const knownSeconds = dashboardSessionSecondsRef.current;
      dashboardSessionSecondsRef.current = 0;
      setDashboard((prev) => ({
        ...prev,
        serverNow: result.data.serverNow,
        activeSession: null,
        todayStats: {
          ...prev.todayStats,
          totalFocusSeconds: Math.max(
            0,
            prev.todayStats.totalFocusSeconds - knownSeconds,
          ),
          sessionCount: Math.max(
            0,
            prev.todayStats.sessionCount - (knownSeconds > 0 ? 1 : 0),
          ),
        },
      }));
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
      setDashboard((prev) => ({
        ...prev,
        resumeHint: result.data.resumeHint,
      }));
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

  // ---- Optimistic Task handlers for IdlePanel ------------------------------

  const handleOptimisticTaskAdd = useCallback((task: Task) => {
    setDashboard((prev) => ({
      ...prev,
      todos: [...prev.todos, task],
      goals: prev.goals.map((item) =>
        item.goal.id === task.goalId
          ? { ...item, pendingTaskCount: item.pendingTaskCount + 1 }
          : item,
      ),
    }));
  }, []);

  const handleOptimisticTaskResolve = useCallback(
    (tempId: string, realTask: Task) => {
      setDashboard((prev) => ({
        ...prev,
        todos: prev.todos.map((task) => (task.id === tempId ? realTask : task)),
      }));
    },
    [],
  );

  const handleOptimisticTaskRevert = useCallback(
    (tempId: string, goalId: string) => {
      setDashboard((prev) => ({
        ...prev,
        todos: prev.todos.filter((task) => task.id !== tempId),
        goals: prev.goals.map((item) =>
          item.goal.id === goalId
            ? {
                ...item,
                pendingTaskCount: Math.max(0, item.pendingTaskCount - 1),
              }
            : item,
        ),
      }));
    },
    [],
  );

  const handleOptimisticSelectTask = useCallback(
    (goalId: string, task: Task | null) => {
      setDashboard((prev) => {
        if (!prev.selection || prev.selection.goal.id !== goalId) return prev;
        return {
          ...prev,
          selection: {
            ...prev.selection,
            task,
            goalOnly: task === null,
            reason: "explicit-selection",
          },
        };
      });
    },
    [],
  );

  const { activeSession, selection, todayStats } = dashboard;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 pb-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.2em] text-[#b54b35] uppercase">
            Today
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.035em] text-stone-950 sm:text-3xl">
            {initialHeadline}
          </h1>
        </div>
        <div className="flex gap-2">
          <StatChip
            icon={<Clock3 aria-hidden="true" />}
            label="今日投入"
            value={formatHumanDuration(todayStats.totalFocusSeconds)}
          />
          <StatChip
            key={`focus-${completionMoment}`}
            icon={<Flame aria-hidden="true" />}
            label="专注"
            value={`${todayStats.sessionCount} 次`}
            highlighted={todayStats.sessionCount > 0}
            celebrating={completionMoment > 0}
          />
        </div>
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

      <main className="rounded-3xl border border-stone-200 bg-white p-5 shadow-[0_12px_35px_rgba(28,25,23,0.06)] sm:p-8">
        <div>
          {endCard ? (
            <EndCard
              session={endCard}
              task={endCard.task}
              onCompleteTask={completeFromEndCard}
              onSaveHint={saveHintFromEndCard}
              onReloadHintVersion={reloadHintVersion}
              onClose={(needsRefresh) => {
                setEndCard(null);
                // The finish result and hint write have already been applied
                // locally. Only a completed Task needs a dashboard reread so
                // selection can advance to the next Task.
                if (needsRefresh) void refresh();
              }}
            />
          ) : activeSession ? (
            <RunPanel
              key={activeSession.id}
              session={activeSession}
              busy={busy}
              cancelOpen={cancelOpen}
              onBusyChange={setBusy}
              onSessionUpdated={handleSessionUpdated}
              onSessionLost={handleSessionLost}
              onFinishRequested={(payload) => void handleFinish(payload)}
              onOpenCancel={() => setCancelOpen(true)}
            />
          ) : selection ? (
            <IdlePanel
              dashboard={dashboard}
              firstRun={firstRun}
              busy={busy === "start" ? "start" : "none"}
              onStart={(input) => void handleStart(input)}
              onRefresh={refresh}
              onError={setActionError}
              onOptimisticTaskAdd={handleOptimisticTaskAdd}
              onOptimisticTaskResolve={handleOptimisticTaskResolve}
              onOptimisticTaskRevert={handleOptimisticTaskRevert}
              onOptimisticSelectTask={handleOptimisticSelectTask}
            />
          ) : (
            <p className="py-10 text-center text-sm text-stone-500">
              当前没有可执行的目标，请从目标管理中重新启用或创建一个目标。
            </p>
          )}
        </div>
      </main>

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

function StatChip({
  icon,
  label,
  value,
  highlighted = false,
  celebrating = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlighted?: boolean;
  celebrating?: boolean;
}) {
  return (
    <div
      className={`flex min-w-28 items-center gap-2.5 rounded-xl border px-3 py-2 transition-[border-color,background-color,transform] ${
        highlighted
          ? "border-[#e8dec1] bg-[#fffdf8]"
          : "border-stone-200 bg-white"
      } ${celebrating ? "focus-stat-celebrate" : ""}`}
      aria-live={celebrating ? "polite" : undefined}
    >
      <span
        className={`relative flex size-7 items-center justify-center rounded-lg [&_svg]:size-3.5 ${
          highlighted
            ? "bg-[#f4e7bd] text-[#8b6416] [&_svg]:fill-current"
            : "bg-stone-100 text-stone-600"
        } ${celebrating ? "focus-flame-celebrate" : ""}`}
      >
        {celebrating && (
          <span
            className="focus-flame-ring pointer-events-none absolute inset-0 rounded-lg border border-[#d9b95f]"
            aria-hidden="true"
          />
        )}
        {icon}
      </span>
      <span className="min-w-0">
        <span
          className={`block text-[10px] font-medium tracking-wide ${
            highlighted ? "text-[#8a7957]" : "text-stone-400"
          }`}
        >
          {label}
        </span>
        <span
          className={`block truncate text-xs font-semibold ${
            highlighted ? "text-stone-950" : "text-stone-800"
          } ${celebrating ? "focus-count-celebrate" : ""}`}
        >
          {value}
        </span>
      </span>
    </div>
  );
}
