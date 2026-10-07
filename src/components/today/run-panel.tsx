"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  LoaderCircle,
  Pause,
  Play,
  SkipForward,
  Square,
  X,
} from "lucide-react";

import {
  archiveDistractionAction,
  createDistractionAction,
  getSessionAction,
  listDistractionsAction,
  updateDistractionAction,
  updateNoteAction,
} from "@/app/(app)/session-actions";
import {
  FocusCapture,
  type CaptureMode,
} from "@/components/focus/focus-capture";
import { useDistractions } from "@/components/focus/use-distractions";
import { PhaseProgress, phaseColors } from "./phase-progress";
import { FocusClock } from "@/components/today/focus-clock";
import { useNoteAutosave } from "@/components/today/use-note-autosave";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useTimerDisplay } from "./use-timer-display";
import { ExecutionHeading } from "./execution-heading";
import { TimerStage } from "./timer-stage";
import { TimerPreferences } from "./timer-preferences";
import { SoundToggle } from "./sound-toggle";
import { configOf } from "@/shared/pomodoro";
import { remindPhaseOnce, unlockTimerSound } from "./timer-sound";
import type { SessionView } from "@/services/session";
import type { Result } from "@/shared/result";
import { isTypingElement } from "@/shared/keyboard";
import { formatTimeDigits } from "@/shared/session-timer";

export type RunBusyAction =
  "none" | "start" | "pause" | "resume" | "finish" | "cancel" | "advance";

/**
 * Running / paused execution panel (PRD §5.1, §6.1–6.5): fixed execution
 * object, authoritative ticking time, one strong primary action, note
 * autosave with content versions, quick distraction log, keyboard
 * shortcuts guarded against inputs and dialogs.
 */
export function RunPanel({
  session,
  busy,
  cancelOpen,
  onSessionUpdated,
  onSessionLost,
  onFinishRequested,
  onOpenCancel,
  onBusyChange,
  timerPreferences,
  resumeHint,
  onPreferencesSaved,
}: {
  timerPreferences?: unknown;
  resumeHint?: string | null;
  onPreferencesSaved: () => void;
  session: SessionView;
  busy: RunBusyAction;
  cancelOpen: boolean;
  onSessionUpdated: (view: SessionView) => void;
  onSessionLost: () => void;
  onFinishRequested: (payload: {
    note: string | null;
    expectedVersion: number;
    changed: boolean;
  }) => void;
  onOpenCancel: () => void;
  onBusyChange: (action: RunBusyAction) => void;
}) {
  const display = useTimerDisplay(session);
  const isPaused = session.status === "paused";
  const due = display.due;
  const phase = session.phase;
  const rest = phase && phase.kind !== "focus";
  const config = configOf(session.timerConfig);
  // The local deadline may arrive before the next server snapshot.
  const completedFocusCount =
    (session.completedFocusCount ?? 0) +
    (due && phase?.kind === "focus" && !phase.complete ? 1 : 0);
  const pendingBreak = due && phase?.kind === "focus";
  const pendingFocus = due && !!rest;
  const breakKind =
    config.longBreakEnabled &&
    completedFocusCount > 0 &&
    completedFocusCount % 4 === 0
      ? "long_break"
      : "short_break";
  const displayKind = pendingFocus
    ? "focus"
    : pendingBreak
      ? breakKind
      : (phase?.kind ?? "focus");
  const colors = phaseColors[displayKind];
  const clockSeconds = pendingBreak
    ? (breakKind === "long_break"
        ? config.longBreakMinutes
        : config.shortBreakMinutes) * 60
    : pendingFocus
      ? config.focusMinutes * 60
      : display.seconds;
  const label =
    displayKind === "long_break"
      ? "长休息"
      : displayKind === "short_break"
        ? "休息"
        : session.timerMode === "pomodoro"
          ? "专注"
          : "正计时";
  const [captureMode, setCaptureMode] = useState<CaptureMode>("note");
  const [distractionsReady, setDistractionsReady] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const serverSoundEnabled = configOf(
    timerPreferences ?? session.timerConfig,
  ).soundEnabled;
  const [lastServerSoundEnabled, setLastServerSoundEnabled] =
    useState(serverSoundEnabled);
  const [soundEnabled, setSoundEnabled] = useState(serverSoundEnabled);
  if (lastServerSoundEnabled !== serverSoundEnabled) {
    setLastServerSoundEnabled(serverSoundEnabled);
    setSoundEnabled(serverSoundEnabled);
  }
  useEffect(() => {
    if (due && phase) remindPhaseOnce(phase.id, soundEnabled);
  }, [due, phase, soundEnabled]);

  const captureInputRef = useRef<HTMLInputElement>(null);

  const noteAutosave = useNoteAutosave({
    sessionId: session.id,
    initialNote: session.note,
    initialVersion: session.noteVersion,
    save: async (sessionId, note, expectedVersion) => {
      const result = await updateNoteAction({
        sessionId,
        note: note || null,
        expectedVersion,
      });
      return result.ok ? { ok: true } : { ok: false, code: result.error.code };
    },
    reload: async () => {
      const result = await getSessionAction(session.id);
      if (!result.ok) return null;
      return { note: result.data.note, version: result.data.noteVersion };
    },
  });

  const distractions = useDistractions({
    initial: [],
    actions: {
      create: createDistractionAction,
      update: updateDistractionAction,
      archive: archiveDistractionAction,
    },
  });
  const replaceDistractions = distractions.replace;

  // Preload in the background so opening existing records never renders the
  // note first and the distraction list a beat later.
  useEffect(() => {
    let cancelled = false;
    void listDistractionsAction(session.id).then((result) => {
      if (cancelled) return;
      if (result.ok) replaceDistractions(result.data);
      setDistractionsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [session.id, replaceDistractions]);

  const command = (
    action: "pause" | "resume" | "start_break" | "start_next_focus",
  ) => {
    if (busy !== "none") return;
    unlockTimerSound();
    onBusyChange(
      action.startsWith("start_") ? "advance" : (action as "pause" | "resume"),
    );
    setCommandError(null);
    startTransition(async () => {
      try {
        const advance =
          action === "start_break" || action === "start_next_focus";
        const response = await fetch(
          advance ? "/api/session/advance" : "/api/session/transition",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              advance
                ? { id: session.id, expectedPhaseId: phase!.id, action }
                : { id: session.id, operation: action },
            ),
          },
        );
        const result: Result<SessionView> = await response.json();
        if (result.ok) onSessionUpdated(result.data);
        else {
          setCommandError(
            result.error.code === "STALE_SESSION_PHASE"
              ? "阶段已在另一端更新，已重新同步。"
              : "操作未完成，已重新同步，请重试。",
          );
          onSessionLost();
        }
      } catch {
        setCommandError("连接失败，请重试。计时仍以服务端为准。");
        onSessionLost();
      } finally {
        onBusyChange("none");
      }
    });
  };
  const togglePause = () => {
    if (due) return;
    command(isPaused ? "resume" : "pause");
  };

  // Space pause/resume, F finish, D distraction — only when not typing
  // and no dialog is open (PRD §8.3).
  const handleFinish = async () => {
    if (busy !== "none") return;
    const flushed = await noteAutosave.flush();
    onFinishRequested({
      note: flushed.note,
      expectedVersion: flushed.expectedVersion,
      changed: flushed.changed,
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        cancelOpen ||
        document.querySelector('[role="dialog"]') ||
        isTypingElement(document.activeElement)
      )
        return;
      if (e.code === "Space" && !due) {
        e.preventDefault();
        void togglePause();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        void handleFinish();
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setCaptureMode("distraction");
        captureInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelOpen, session.status, busy, noteAutosave.note, due, phase?.id]);

  return (
    <div onPointerDown={unlockTimerSound}>
      <div className="flex flex-col items-center pt-2 text-center">
        <ExecutionHeading
          goal={session.goal.title}
          task={session.task?.title}
          resumeHint={resumeHint}
        />

        <div className="mt-7 grid w-full grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <div
            role="group"
            aria-label="计时模式"
            className="flex justify-self-center rounded-full bg-stone-100 p-1 sm:col-start-2"
          >
            {(["pomodoro", "stopwatch"] as const).map((value) => (
              <button
                key={value}
                type="button"
                disabled
                aria-pressed={session.timerMode === value}
                className={`cursor-not-allowed rounded-full px-4 py-2 text-sm ${session.timerMode === value ? "bg-white text-[#b54b35] shadow-sm" : "text-stone-600"}`}
              >
                {value === "pomodoro" ? "番茄钟" : "正计时"}
              </button>
            ))}
          </div>
          <div
            aria-hidden={session.timerMode !== "pomodoro"}
            inert={session.timerMode !== "pomodoro"}
            className={`flex items-center justify-center gap-2 sm:col-start-3 sm:justify-start sm:pl-2 ${session.timerMode === "pomodoro" ? "visible" : "invisible"}`}
          >
            <TimerPreferences
              running
              value={timerPreferences}
              onSaved={onPreferencesSaved}
            />
            <SoundToggle
              value={timerPreferences ?? session.timerConfig}
              onChange={setSoundEnabled}
              onSaved={onPreferencesSaved}
            />
          </div>
        </div>
        <TimerStage
          progress={
            phase && (
              <PhaseProgress
                config={session.timerConfig}
                phases={session.phases}
                currentId={phase.id}
              />
            )
          }
          className={`${phase ? colors.surface : "bg-stone-50"} ${isPaused ? "opacity-60" : ""}`}
        >
          <div className="flex flex-col items-center gap-0">
            <p
              role="status"
              className={`text-base leading-none font-medium ${colors.text}`}
            >
              {pendingBreak || pendingFocus
                ? label
                : due
                  ? `${label}已到时`
                  : `${label}${isPaused ? "已暂停" : "中"}`}
            </p>
            <FocusClock
              role="timer"
              aria-label={
                pendingBreak
                  ? "待开始的休息时长"
                  : pendingFocus
                    ? "待开始的专注时长"
                    : session.timerMode === "pomodoro"
                      ? "本段剩余时间"
                      : "已专注时间"
              }
              value={formatTimeDigits(clockSeconds)}
              tone={isPaused ? "paused" : "running"}
              className={`${colors.text} ${formatTimeDigits(clockSeconds).length > 5 ? "text-[2.6rem] sm:text-[3.75rem]" : "text-[3.75rem] sm:text-[5.25rem]"}`}
            />
          </div>
        </TimerStage>
        {commandError && (
          <p role="alert" className="mt-4 text-sm text-red-700">
            {commandError}
          </p>
        )}

        <TooltipProvider delay={200}>
          <div className="mt-7 flex w-full flex-wrap items-center justify-center gap-2">
            {due ? (
              <>
                {!rest && (
                  <Button
                    size="lg"
                    disabled={busy !== "none"}
                    onClick={() => command("start_break")}
                    className={`h-12 rounded-xl px-6 text-white ${breakKind === "long_break" ? "bg-[#b49350] hover:bg-[#9b7c3f]" : "bg-[#70917b] hover:bg-[#5c7c66]"}`}
                  >
                    {breakKind === "long_break" ? "开始长休息" : "开始休息"}
                  </Button>
                )}
                <Button
                  size="lg"
                  variant={rest ? "default" : "outline"}
                  disabled={busy !== "none"}
                  onClick={() => command("start_next_focus")}
                  className={`h-12 rounded-xl px-6 ${rest ? "bg-[#d85c41] text-white hover:bg-[#c84f36]" : ""}`}
                >
                  {!rest && (
                    <SkipForward className="size-4" aria-hidden="true" />
                  )}
                  {rest ? "开始下一轮" : "跳过休息"}
                </Button>
              </>
            ) : (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="lg"
                        disabled={busy !== "none"}
                        onClick={togglePause}
                        className={`h-12 gap-2 rounded-xl px-6 text-base text-white ${rest ? "bg-[#70917b] hover:bg-[#5c7c66]" : "bg-[#d85c41] hover:bg-[#c84f36]"}`}
                      />
                    }
                  >
                    {busy === "pause" || busy === "resume" ? (
                      "处理中…"
                    ) : isPaused ? (
                      <>
                        <Play
                          className="size-4 fill-current"
                          aria-hidden="true"
                        />
                        继续
                      </>
                    ) : (
                      <>
                        <Pause className="size-4" aria-hidden="true" />
                        暂停
                      </>
                    )}
                  </TooltipTrigger>
                  <TooltipContent>
                    {isPaused ? "继续" : "暂停"}（Space）
                  </TooltipContent>
                </Tooltip>
                {rest && (
                  <Button
                    variant="outline"
                    size="lg"
                    disabled={busy !== "none"}
                    onClick={() => command("start_next_focus")}
                    className="h-12 rounded-xl"
                  >
                    <SkipForward className="size-4" aria-hidden="true" />
                    跳过休息
                  </Button>
                )}
              </>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant="outline"
                    disabled={busy !== "none"}
                    onClick={handleFinish}
                    aria-label={busy === "finish" ? "结束保存中" : "结束并保存"}
                    className="size-12 rounded-xl border-stone-300 bg-white"
                  />
                }
              >
                {busy === "finish" ? (
                  <LoaderCircle
                    className="size-5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Square className="size-5" aria-hidden="true" />
                )}
              </TooltipTrigger>
              <TooltipContent>结束并保存（F）</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant="ghost"
                    disabled={busy !== "none"}
                    onClick={onOpenCancel}
                    aria-label="取消本次执行"
                    className="size-12 rounded-xl text-stone-500 hover:text-red-700"
                  />
                }
              >
                <X className="size-5" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent>取消本次执行</TooltipContent>
            </Tooltip>
          </div>
        </TooltipProvider>
      </div>

      {session.intent && (
        <p className="mt-4 text-center text-sm leading-6 text-stone-600">
          {session.intent}
        </p>
      )}

      <FocusCapture
        sessionId={session.id}
        mode={captureMode}
        onModeChange={setCaptureMode}
        inputRef={captureInputRef}
        distractions={distractions}
        distractionsReady={distractionsReady}
        note={noteAutosave.note}
        noteStatus={noteAutosave.status}
        onNoteChange={noteAutosave.setNote}
        onResolveNoteConflict={noteAutosave.resolveConflict}
        onDismissNoteConflict={noteAutosave.dismissConflict}
      />
    </div>
  );
}
