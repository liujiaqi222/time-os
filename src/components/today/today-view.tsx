"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Flame } from "lucide-react";

import {
  completeTaskAction,
  getDashboardAction,
  getSessionAction,
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
import type { Result } from "@/shared/result";
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
  const [executionHint, setExecutionHint] = useState<{
    sessionId: string;
    hint: string | null;
  } | null>(null);
  const [busy, setBusy] = useState<RunBusyAction>("none");
  const [actionError, setActionError] = useState<string | null>(null);
  const [remoteNotice, setRemoteNotice] = useState<{
    kind: "finished" | "cancelled";
    durationSeconds: number | null;
  } | null>(null);
  const [endCard, setEndCard] = useState<SessionView | null>(null);
  const [completionMoment, setCompletionMoment] = useState(0);
  const [statsRefreshKey, setStatsRefreshKey] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);

  // The Session this page believes is running; null when idle/none.
  const runningIdRef = useRef<string | null>(
    initialDashboard.activeSession?.id ?? null,
  );
  // Set when THIS page ends/cancels so the cross-end detector stays quiet.
  const startKeyRef = useRef<string | null>(null);
  const selfEndRef = useRef(false);

  const mutationEpoch = useRef(0);
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
    if (busy !== "none") mutationEpoch.current += 1;
  }, [busy]);
  const refresh = useCallback(async () => {
    const epoch = mutationEpoch.current;
    const result = await getDashboardAction();
    if (
      result.ok &&
      epoch === mutationEpoch.current &&
      busyRef.current === "none"
    ) {
      setDashboard(result.data);
    }
    return result.ok ? result.data : null;
  }, []);

  useEffect(() => {
    if (statsRefreshKey > 0) void refresh();
  }, [statsRefreshKey, refresh]);

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
    let polling = false;
    let cancelled = false;
    const pollSession = async () => {
      if (polling || busyRef.current !== "none") return;
      polling = true;
      const epoch = mutationEpoch.current;
      try {
        const response = await fetch("/api/session/active", {
          cache: "no-store",
        });
        if (!response.ok) return;
        const result: Result<SessionView | null> = await response.json();
        if (
          cancelled ||
          !result.ok ||
          epoch !== mutationEpoch.current ||
          busyRef.current !== "none"
        )
          return;
        setDashboard((prev) => {
          const next = result.data;
          if (
            next &&
            prev.activeSession?.id === next.id &&
            prev.activeSession.revision > next.revision
          )
            return prev;
          return { ...prev, activeSession: next };
        });
      } catch {
        // A failed read leaves the last authoritative timer anchor intact.
      } finally {
        polling = false;
      }
    };
    const resync = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") resync();
    };
    const poll = setInterval(() => {
      if (document.visibilityState === "visible" && busyRef.current === "none")
        void pollSession();
    }, 5000);
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(poll);
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  // ---- Run actions ---------------------------------------------------------

  const handleStart = async (input: {
    intent: string | null;
    timerMode: "stopwatch" | "pomodoro";
  }) => {
    const selection = dashboard.selection;
    if (!selection || busy !== "none") return;
    setBusy("start");
    setActionError(null);
    setRemoteNotice(null);
    const result: Result<SessionView> = await fetch("/api/session/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goalId: selection.goal.id,
        taskId: selection.task?.id ?? null,
        intent: input.intent,
        timerMode: input.timerMode,
        idempotencyKey: (startKeyRef.current ??= crypto.randomUUID()),
      }),
    })
      .then((response) => response.json())
      .catch(() => ({
        ok: false as const,
        error: {
          code: "DATABASE_UNAVAILABLE" as const,
          message: "连接失败，请重试。",
        },
      }));
    if (result.ok) {
      startKeyRef.current = null;
      setExecutionHint({
        sessionId: result.data.id,
        hint: dashboard.resumeHint,
      });
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
    if (!session || busy !== "none") return false;
    setBusy("finish");
    setActionError(null);
    const result: Result<SessionView> = await fetch("/api/session/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: session.id,
        ...(payload.changed
          ? { note: payload.note, noteExpectedVersion: payload.expectedVersion }
          : {}),
      }),
    })
      .then((response) => response.json())
      .catch(() => ({
        ok: false as const,
        error: {
          code: "DATABASE_UNAVAILABLE" as const,
          message: "保存失败，请重试。",
        },
      }));
    if (result.ok) {
      selfEndRef.current = true;
      runningIdRef.current = null;
      setEndCard(result.data);
      setCompletionMoment((moment) => moment + 1);
      setStatsRefreshKey((key) => key + 1);
      setDashboard((prev) => ({
        ...prev,
        serverNow: result.data.serverNow,
        activeSession: null,
      }));
    } else {
      // Kept the current info and the retry entry (PRD §6.5); if it ended
      // elsewhere, the notice below explains what actually happened.
      await refresh();
      setActionError("结束保存失败：当前信息已保留，可重试。");
    }
    setBusy("none");
    return result.ok;
  };

  const handleCancel = async () => {
    const session = dashboard.activeSession;
    if (!session) return;
    setBusy("cancel");
    setActionError(null);
    const result = await fetch("/api/session/transition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: session.id, operation: "cancel" }),
    })
      .then(async (response) => {
        const result: Result<SessionView> = await response.json();
        if (!response.ok && result.ok) throw new Error("Cancel request failed");
        return result;
      })
      .catch(() => ({
        ok: false as const,
        error: {
          code: "DATABASE_UNAVAILABLE" as const,
          message: "取消失败，请重试。",
        },
      }));
    if (result.ok) {
      selfEndRef.current = true;
      runningIdRef.current = null;
      setCancelOpen(false);
      setStatsRefreshKey((key) => key + 1);
      setDashboard((prev) => ({
        ...prev,
        serverNow: result.data.serverNow,
        activeSession: null,
      }));
    } else {
      await refresh();
      setActionError("取消失败，请重试。");
    }
    setBusy("none");
  };

  const handleSessionUpdated = (view: SessionView) => {
    mutationEpoch.current += 1;
    setDashboard((prev) =>
      prev.activeSession &&
      prev.activeSession.id === view.id &&
      prev.activeSession.revision > view.revision
        ? prev
        : { ...prev, activeSession: view },
    );
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
    <div className="mx-auto w-full max-w-5xl space-y-5 pb-6 sm:space-y-6">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-base font-semibold tracking-normal text-[#b54b35] sm:text-lg">
            今天
          </h1>
          <p className="mt-1 text-sm text-stone-500 sm:mt-2 sm:text-base">
            {initialHeadline}
          </p>
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

      <main className="rounded-3xl bg-white p-5 sm:px-10 sm:py-8 lg:px-12">
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
              resumeHint={
                executionHint?.sessionId === activeSession.id
                  ? executionHint.hint
                  : dashboard.resumeHint
              }
              busy={busy}
              cancelOpen={cancelOpen}
              onBusyChange={setBusy}
              onSessionUpdated={handleSessionUpdated}
              onSessionLost={handleSessionLost}
              timerPreferences={dashboard.timerSettings?.timerPreferences}
              onPreferencesSaved={() => void refresh()}
              onFinishRequested={handleFinish}
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
      className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-[border-color,background-color,transform] ${
        highlighted
          ? "border-[#e8dec1] bg-[#fffdf8]"
          : "border-stone-200 bg-white"
      } ${celebrating ? "focus-stat-celebrate" : ""}`}
      aria-live={celebrating ? "polite" : undefined}
    >
      <span
        className={`relative flex size-5 items-center justify-center rounded-lg [&_svg]:size-3.5 ${
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
      <span className="flex min-w-0 items-baseline gap-1.5">
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
