"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Pause, Play } from "lucide-react";

import {
  archiveDistractionAction,
  cancelSessionAction,
  createDistractionAction,
  finishSessionReviewAction,
  pauseSessionAction,
  resumeSessionAction,
  updateDistractionAction,
  updateSessionNoteAction,
} from "@/app/(app)/session-actions";
import { isTypingElement } from "@/shared/keyboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentSeconds } from "@/components/use-current-seconds";
import { CancelDialog } from "@/components/focus/cancel-dialog";
import { DistractionPanel } from "@/components/focus/distraction-panel";
import { ReviewDialog } from "@/components/focus/review-dialog";
import { useDistractions } from "@/components/focus/use-distractions";
import { useFocusSession } from "@/components/focus/use-focus-session";
import { useNoteAutosave } from "@/components/focus/use-note-autosave";
import { useSessionReview } from "@/components/focus/use-session-review";
import type { SessionWithRelations } from "@/services/session";
import type { SessionOutcome } from "@/shared/schemas/session";
import {
  calculateElapsedSeconds,
  formatHumanDuration,
  formatTimeDigits,
} from "@/shared/session-timer";

/**
 * Focus page view (PRD §8.2): timer, pause/resume, quick note, distractions
 * and finish. Pure composition — each concern lives in its own hook or
 * dialog module under components/focus/.
 */
export function FocusView({
  initialSession,
  nextTaskPreviewTitle,
}: {
  initialSession: SessionWithRelations;
  nextTaskPreviewTitle?: string | null;
}) {
  const router = useRouter();
  // Ticking clock for live timers; `null` during SSR/hydration so server and
  // client render the same output (a live timestamp would differ by the
  // network delay and break hydration).
  const currentSeconds = useCurrentSeconds();
  const now = currentSeconds === null ? null : new Date(currentSeconds * 1000);

  const {
    session,
    isPending,
    error: actionError,
    togglePause,
    confirmCancel,
  } = useFocusSession({
    initialSession,
    actions: {
      pause: pauseSessionAction,
      resume: resumeSessionAction,
      cancel: cancelSessionAction,
    },
    onCancelled: () => router.push("/today"),
  });

  // Review dialog state: the page owns the review note because it syncs
  // both ways with the Quick Note (opening seeds it, closing writes back).
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [reviewOutcome, setReviewOutcome] = useState<SessionOutcome>(
    session.taskId ? "completed" : "continue_later",
  );
  const [reviewNote, setReviewNote] = useState(session.note ?? "");

  const {
    note,
    setNote,
    status: noteStatus,
  } = useNoteAutosave({
    sessionId: session.id,
    initialNote: session.note,
    save: updateSessionNoteAction,
    onSaved: (saved) => setReviewNote(saved),
  });

  const distractions = useDistractions({
    initial: session.distractions ?? [],
    actions: {
      create: createDistractionAction,
      update: updateDistractionAction,
      archive: archiveDistractionAction,
    },
  });
  const distractionInputRef = useRef<HTMLInputElement>(null);

  const {
    submitting: reviewSubmitting,
    error: reviewError,
    review,
  } = useSessionReview({
    submit: finishSessionReviewAction,
    onSubmitted: () => router.push("/today"),
  });

  // React Compiler validates manual memoization: setters count as inferred
  // dependencies, so they are listed explicitly. The Modal tolerates
  // changing onClose references via an internal ref anyway.
  const openReview = useCallback(() => {
    setReviewNote(note);
    setIsReviewOpen(true);
  }, [note, setReviewNote, setIsReviewOpen]);

  const closeReview = useCallback(() => {
    // Sync note edits back so they're not lost.
    if (reviewNote !== note) setNote(reviewNote);
    setIsReviewOpen(false);
  }, [reviewNote, note, setNote, setIsReviewOpen]);

  const closeCancel = useCallback(() => {
    setIsCancelOpen(false);
  }, [setIsCancelOpen]);

  const cancelDistractionEdit = distractions.cancelEdit;

  // Keyboard shortcuts (PRD §8.3): Space pause/resume, D distraction, F
  // finish. Dialogs own their Esc handling; Esc here only cancels the
  // inline distraction edit.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelDistractionEdit();
        return;
      }

      // Don't trigger shortcuts when modals are open
      if (isReviewOpen || isCancelOpen) return;

      if (isTypingElement(document.activeElement)) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePause();
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        distractionInputRef.current?.focus();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        openReview();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    cancelDistractionEdit,
    isCancelOpen,
    isReviewOpen,
    openReview,
    togglePause,
  ]);

  // Paused/finished sessions derive elapsed from stored timestamps (stable
  // across server and client). Active sessions tick with `now` and read 0
  // until mounted, keeping SSR output deterministic.
  const elapsedSeconds =
    session.status !== "active"
      ? calculateElapsedSeconds(session)
      : now
        ? calculateElapsedSeconds(session, now)
        : 0;
  const plannedSeconds = session.plannedMinutes
    ? session.plannedMinutes * 60
    : null;
  const isOvertime = plannedSeconds !== null && elapsedSeconds > plannedSeconds;
  const remainingSeconds = plannedSeconds
    ? plannedSeconds - elapsedSeconds
    : null;

  const isPaused = session.status === "paused";

  return (
    <div className="min-h-screen bg-[#f7f5ef] text-stone-900">
      {/* Minimal Header */}
      <header className="border-b border-stone-200/80 bg-[#f7f5ef]/80 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link
            href="/today"
            className="flex items-center gap-2 text-sm text-stone-600 transition hover:text-stone-900"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>返回今日聚焦</span>
          </Link>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
              isPaused
                ? "bg-amber-100 text-amber-900"
                : "bg-emerald-100 text-emerald-800"
            }`}
          >
            {isPaused ? (
              <>
                <Pause className="size-3" aria-hidden="true" />
                已暂停
              </>
            ) : (
              <>
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                专注中
              </>
            )}
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-2xl px-5 py-8 sm:py-12">
        {actionError && (
          <div
            role="alert"
            className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
          >
            {actionError}
          </div>
        )}

        <div className="space-y-8">
          {/* Target Track & Task Info */}
          <div className="space-y-2 text-center">
            <p className="font-mono text-xs tracking-wider text-stone-500 uppercase">
              推进线 · {session.track.title}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              {session.task?.title ?? "自由专注"}
            </h1>
            {session.task?.description && (
              <p className="mx-auto max-w-lg text-sm text-stone-600">
                {session.task.description}
              </p>
            )}
          </div>

          {/* Large Timer Display */}
          <div className="py-6 text-center">
            <div
              className={`font-mono text-6xl font-semibold tracking-tight tabular-nums transition-colors sm:text-7xl ${
                isPaused
                  ? "text-stone-400"
                  : isOvertime
                    ? "text-amber-600"
                    : "text-stone-900"
              }`}
            >
              {plannedSeconds
                ? isOvertime
                  ? `+ ${formatTimeDigits(Math.abs(remainingSeconds ?? 0))}`
                  : formatTimeDigits(remainingSeconds ?? 0)
                : formatTimeDigits(elapsedSeconds)}
            </div>

            <p className="mt-3 font-mono text-xs text-stone-500">
              {isOvertime ? (
                <span className="font-medium text-amber-700">
                  已超时 · 累计已专注 {formatHumanDuration(elapsedSeconds)}
                </span>
              ) : plannedSeconds ? (
                <span>剩余时间 (计划 {session.plannedMinutes} 分钟)</span>
              ) : (
                <span>已专注时长</span>
              )}
            </p>
          </div>

          {/* Primary Action Controls */}
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button
              size="lg"
              variant={isPaused ? "default" : "outline"}
              disabled={isPending}
              onClick={togglePause}
              className="h-12 min-w-32 gap-2 text-base shadow-xs"
            >
              {isPaused ? (
                <>
                  <Play className="size-4 fill-current" aria-hidden="true" />
                  继续 (空格)
                </>
              ) : (
                <>
                  <Pause className="size-4" aria-hidden="true" />
                  暂停 (空格)
                </>
              )}
            </Button>

            <Button
              size="lg"
              disabled={isPending}
              onClick={openReview}
              className="h-12 min-w-32 gap-2 bg-stone-900 text-base text-stone-50 shadow-xs hover:bg-stone-800"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              结束交接 (F)
            </Button>

            <Button
              size="lg"
              variant="ghost"
              disabled={isPending}
              onClick={() => setIsCancelOpen(true)}
              className="h-12 text-sm text-stone-500 hover:text-red-700"
            >
              放弃专注
            </Button>
          </div>

          {/* Quick Note Card */}
          <Card className="border-stone-200/80 bg-white/80 shadow-xs">
            <CardContent className="space-y-3 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="focus-note"
                  className="font-mono text-xs font-medium tracking-wider text-stone-500 uppercase"
                >
                  本次交接笔记
                </label>
                <span className="font-mono text-xs text-stone-400">
                  {noteStatus === "saving" && "正在保存…"}
                  {noteStatus === "saved" && "已自动保存"}
                  {noteStatus === "error" && "保存失败"}
                </span>
              </div>
              <textarea
                id="focus-note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="记录推进进展、代码断点或下一次继续时的起点...（自动保存）"
                className="w-full resize-none rounded-lg border border-stone-200 bg-transparent p-3 text-sm placeholder:text-stone-400 focus:border-stone-900 focus:outline-hidden"
              />
            </CardContent>
          </Card>

          {/* Distractions Card */}
          <DistractionPanel
            sessionId={session.id}
            distractions={distractions}
            inputRef={distractionInputRef}
          />
        </div>
      </main>

      {/* Review Modal */}
      {isReviewOpen && (
        <ReviewDialog
          session={session}
          now={now}
          distractionsCount={distractions.list.length}
          nextTaskPreviewTitle={nextTaskPreviewTitle}
          outcome={reviewOutcome}
          onOutcomeChange={setReviewOutcome}
          note={reviewNote}
          onNoteChange={setReviewNote}
          submitting={reviewSubmitting}
          error={reviewError}
          onClose={closeReview}
          onSubmit={() =>
            review({
              sessionId: session.id,
              note: reviewNote.trim() || null,
              outcome: reviewOutcome,
            })
          }
        />
      )}

      {/* Cancel Confirmation Modal */}
      {isCancelOpen && (
        <CancelDialog
          onClose={closeCancel}
          onConfirm={confirmCancel}
          isPending={isPending}
        />
      )}
    </div>
  );
}
