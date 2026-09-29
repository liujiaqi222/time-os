"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Square, X } from "lucide-react";

import {
  archiveDistractionAction,
  createDistractionAction,
  getSessionAction,
  listDistractionsAction,
  pauseSessionAction,
  resumeSessionAction,
  updateDistractionAction,
  updateNoteAction,
} from "@/app/(app)/session-actions";
import {
  FocusCapture,
  type CaptureMode,
} from "@/components/focus/focus-capture";
import { useDistractions } from "@/components/focus/use-distractions";
import { FocusClock } from "@/components/today/focus-clock";
import { useNoteAutosave } from "@/components/today/use-note-autosave";
import { Button } from "@/components/ui/button";
import { useCurrentSeconds } from "@/components/use-current-seconds";
import type { SessionView } from "@/services/session";
import { isTypingElement } from "@/shared/keyboard";
import { formatTimeDigits, liveFocusSeconds } from "@/shared/session-timer";

export type RunBusyAction =
  "none" | "start" | "pause" | "resume" | "finish" | "cancel";

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
}: {
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
  const currentSeconds = useCurrentSeconds();
  const now = currentSeconds === null ? null : new Date(currentSeconds * 1000);
  const isPaused = session.status === "paused";
  const [captureMode, setCaptureMode] = useState<CaptureMode>("note");
  const [distractionsReady, setDistractionsReady] = useState(false);

  // Authoritative seconds at serverNow, then live-ticked from the client
  // clock — a refresh recalibrates from the server (never localStorage).
  const elapsed = isPaused
    ? session.focusSeconds
    : liveFocusSeconds(
        session.focusSeconds,
        session.serverNow,
        now ?? new Date(session.serverNow),
      );

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

  const togglePause = async () => {
    if (busy !== "none") return;
    const wasActive = session.status === "active";
    const action = wasActive ? "pause" : "resume";
    const optimisticNow = new Date();
    onBusyChange(action);

    // The server remains authoritative, but the local clock can react at the
    // click boundary instead of waiting for a remote database roundtrip. The
    // returned view immediately recalibrates this optimistic state.
    onSessionUpdated({
      ...session,
      status: wasActive ? "paused" : "active",
      serverNow: optimisticNow.toISOString(),
      focusSeconds: wasActive ? elapsed : session.focusSeconds,
      revision: session.revision + 1,
      updatedAt: optimisticNow,
    });

    if (wasActive) {
      const result = await pauseSessionAction(session.id);
      if (result.ok) onSessionUpdated(result.data);
      else onSessionLost();
    } else {
      const result = await resumeSessionAction(session.id);
      if (result.ok) onSessionUpdated(result.data);
      else onSessionLost();
    }
    onBusyChange("none");
  };

  // Space pause/resume, F finish, D distraction — only when not typing
  // and no dialog is open (PRD §8.3).
  const handleFinish = async () => {
    if (busy !== "none") return;
    onBusyChange("finish");
    const flushed = await noteAutosave.flush();
    onFinishRequested({
      note: flushed.note,
      expectedVersion: flushed.expectedVersion,
      changed: flushed.changed,
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (cancelOpen || isTypingElement(document.activeElement)) return;
      if (e.code === "Space") {
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
  }, [cancelOpen, session.status, busy, noteAutosave.note]);

  return (
    <div>
      <div className="flex flex-col items-center pt-2 text-center">
        <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-500">
          {session.goal.title}
        </p>
        <h1 className="mt-1 text-3xl font-medium tracking-tight text-balance text-stone-950 sm:text-4xl">
          {session.task?.title ?? "围绕目标执行"}
        </h1>
        {session.intent && (
          <p className="mt-2 max-w-sm text-sm leading-6 text-stone-600">
            {session.intent}
          </p>
        )}

        <FocusClock
          role="timer"
          aria-label="已专注时间"
          value={formatTimeDigits(elapsed)}
          tone={isPaused ? "paused" : "running"}
          className="mt-8 sm:mt-10"
        />
        <p className="mt-5">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isPaused
                ? "bg-amber-100 text-amber-900"
                : "bg-[#e4f0dc] text-[#3f6b38]"
            }`}
          >
            {isPaused ? "已暂停" : "正计时中"}
          </span>
        </p>

        <div className="mt-7 flex w-full max-w-xs flex-col gap-2 sm:max-w-none sm:flex-row sm:flex-wrap sm:justify-center">
          <Button
            size="lg"
            disabled={busy !== "none"}
            onClick={togglePause}
            className="h-12 w-full gap-2 rounded-xl bg-[#26231f] px-6 text-base text-stone-50 shadow-sm hover:bg-stone-800 sm:w-auto sm:min-w-40"
          >
            {busy === "pause" || busy === "resume" ? (
              "处理中…"
            ) : isPaused ? (
              <>
                <Play className="size-4 fill-current" aria-hidden="true" />
                继续（Space）
              </>
            ) : (
              <>
                <Pause className="size-4" aria-hidden="true" />
                暂停（Space）
              </>
            )}
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={busy !== "none"}
            onClick={handleFinish}
            className="h-12 w-full gap-2 rounded-xl border-stone-300 bg-white px-5 text-base sm:w-auto sm:min-w-40"
          >
            <Square className="size-4" aria-hidden="true" />
            {busy === "finish" ? "结束保存中…" : "结束并保存（F）"}
          </Button>
          <Button
            size="lg"
            variant="ghost"
            disabled={busy !== "none"}
            onClick={onOpenCancel}
            className="h-12 w-full gap-2 rounded-xl text-sm text-stone-500 hover:text-red-700 sm:w-auto"
          >
            <X className="size-4" aria-hidden="true" />
            取消
          </Button>
        </div>
      </div>

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
