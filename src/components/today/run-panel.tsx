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
import { DistractionPanel } from "@/components/focus/distraction-panel";
import { useDistractions } from "@/components/focus/use-distractions";
import type { Distraction } from "@/db/schema";
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
}) {
  const currentSeconds = useCurrentSeconds();
  const now = currentSeconds === null ? null : new Date(currentSeconds * 1000);
  const isPaused = session.status === "paused";

  // Authoritative seconds at serverNow, then live-ticked from the client
  // clock — a refresh recalibrates from the server (never localStorage).
  const elapsed = isPaused
    ? session.focusSeconds
    : liveFocusSeconds(
        session.focusSeconds,
        session.serverNow,
        now ?? new Date(session.serverNow),
      );

  const distractionInputRef = useRef<HTMLInputElement>(null);

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

  const togglePause = async () => {
    if (busy !== "none") return;
    if (session.status === "active") {
      const result = await pauseSessionAction(session.id);
      if (result.ok) onSessionUpdated(result.data);
      else onSessionLost();
    } else if (session.status === "paused") {
      const result = await resumeSessionAction(session.id);
      if (result.ok) onSessionUpdated(result.data);
      else onSessionLost();
    }
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
      if (cancelOpen || isTypingElement(document.activeElement)) return;
      if (e.code === "Space") {
        e.preventDefault();
        void togglePause();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        void handleFinish();
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        distractionInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelOpen, session.status, busy, noteAutosave.note]);

  return (
    <div>
      <div className="flex flex-col items-center pt-2 text-center">
        <p className="text-sm text-stone-500">{session.goal.title}</p>
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
        <p className="mt-4">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isPaused
                ? "bg-amber-100 text-amber-900"
                : "bg-emerald-100 text-emerald-800"
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
            className="h-12 w-full gap-2 rounded-full bg-stone-950 px-5 text-base text-stone-50 hover:bg-stone-800 sm:w-auto sm:min-w-40"
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
            className="h-12 w-full gap-2 rounded-full border-stone-300 bg-white/80 px-5 text-base sm:w-auto sm:min-w-40"
          >
            <Square className="size-4" aria-hidden="true" />
            {busy === "finish" ? "结束保存中…" : "结束并保存（F）"}
          </Button>
          <Button
            size="lg"
            variant="ghost"
            disabled={busy !== "none"}
            onClick={onOpenCancel}
            className="h-12 w-full gap-2 rounded-full text-sm text-stone-500 hover:text-red-700 sm:w-auto"
          >
            <X className="size-4" aria-hidden="true" />
            取消
          </Button>
        </div>
      </div>

      <section className="mt-12 space-y-3 border-t border-stone-200/80 pt-8">
        <div className="flex items-center justify-between">
          <label
            htmlFor="focus-note"
            className="text-sm font-medium text-stone-700"
          >
            随手记
          </label>
          <span className="text-xs text-stone-400">
            {noteAutosave.status === "saving" && "保存中…"}
            {noteAutosave.status === "saved" && "已保存"}
            {noteAutosave.status === "error" && "保存失败"}
          </span>
        </div>
        <textarea
          id="focus-note"
          rows={3}
          value={noteAutosave.note}
          onChange={(e) => noteAutosave.setNote(e.target.value)}
          placeholder="记录想法、进展或下一步（自动保存）…"
          className="w-full resize-none rounded-2xl border border-stone-200/80 bg-white/70 p-4 text-sm placeholder:text-stone-400 focus:border-stone-400 focus:outline-hidden"
        />
        {noteAutosave.status === "conflict" && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            <span>笔记在其他端有更新。你的输入已保留。</span>
            <span className="flex gap-2">
              <Button
                size="xs"
                variant="outline"
                onClick={() => void noteAutosave.resolveConflict()}
              >
                用我的版本保存
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void noteAutosave.dismissConflict()}
              >
                放弃我的修改
              </Button>
            </span>
          </div>
        )}
      </section>

      <DistractionSection
        sessionId={session.id}
        inputRef={distractionInputRef}
      />
    </div>
  );
}

/** Loads existing distractions once, then mounts the live panel. */
function DistractionSection({
  sessionId,
  inputRef,
}: {
  sessionId: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [loaded, setLoaded] = useState<Distraction[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listDistractionsAction(sessionId).then((result) => {
      if (!cancelled) setLoaded(result.ok ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (loaded === null) return null;
  return (
    <LoadedDistractions
      sessionId={sessionId}
      initial={loaded}
      inputRef={inputRef}
    />
  );
}

function LoadedDistractions({
  sessionId,
  initial,
  inputRef,
}: {
  sessionId: string;
  initial: Distraction[];
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const distractions = useDistractions({
    initial,
    actions: {
      create: createDistractionAction,
      update: updateDistractionAction,
      archive: archiveDistractionAction,
    },
  });
  return (
    <DistractionPanel
      sessionId={sessionId}
      distractions={distractions}
      inputRef={inputRef}
    />
  );
}
