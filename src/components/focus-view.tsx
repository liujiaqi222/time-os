"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  Edit2,
  Loader2,
  Pause,
  Play,
  X,
} from "lucide-react";

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
import { Input } from "@/components/ui/input";
import { useCurrentSeconds } from "@/components/use-current-seconds";
import type { Distraction, SessionWithRelations } from "@/services/session";
import type { SessionOutcome } from "@/shared/schemas/session";
import {
  calculateDurationSecondsOnFinish,
  calculateElapsedSeconds,
  formatHumanDuration,
  formatTimeDigits,
} from "@/shared/session-timer";

export function FocusView({
  initialSession,
  nextTaskPreviewTitle,
}: {
  initialSession: SessionWithRelations;
  nextTaskPreviewTitle?: string | null;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  // Ticking clock for live timers; `null` during SSR/hydration so server and
  // client render the same output (a live timestamp would differ by the
  // network delay and break hydration).
  const currentSeconds = useCurrentSeconds();
  const now = currentSeconds === null ? null : new Date(currentSeconds * 1000);

  // Controls transition
  const [isPending, startTransition] = useTransition();

  // Modals state
  const [isReviewOpen, setIsReviewOpen] = useState(false);
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const reviewModalRef = useRef<HTMLDivElement>(null);
  const cancelModalRef = useRef<HTMLDivElement>(null);

  // Review modal state
  const [reviewOutcome, setReviewOutcome] = useState<SessionOutcome>(
    session.taskId ? "completed" : "continue_later",
  );
  const [reviewNote, setReviewNote] = useState(session.note ?? "");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  // Note autosave state
  const [noteText, setNoteText] = useState(session.note ?? "");
  const [noteStatus, setNoteStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const lastSavedNoteRef = useRef(session.note ?? "");

  // Distraction state
  const [distractionsList, setDistractionsList] = useState<Distraction[]>(
    session.distractions ?? [],
  );
  const [distractionText, setDistractionText] = useState("");
  const [editingDistractionId, setEditingDistractionId] = useState<
    string | null
  >(null);
  const [editingText, setEditingText] = useState("");
  const distractionInputRef = useRef<HTMLInputElement>(null);
  const [distractionError, setDistractionError] = useState<string | null>(null);

  // Focus trap for modals
  useEffect(() => {
    const modalRef = isReviewOpen
      ? reviewModalRef.current
      : isCancelOpen
        ? cancelModalRef.current
        : null;
    if (!modalRef) return;

    const focusableSelector =
      'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

    // Focus the first focusable element on open
    const firstFocusable =
      modalRef.querySelector<HTMLElement>(focusableSelector);
    firstFocusable?.focus();

    const handleTrapFocus = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusableElements =
        modalRef.querySelectorAll<HTMLElement>(focusableSelector);
      if (focusableElements.length === 0) return;

      const first = focusableElements[0]!;
      const last = focusableElements[focusableElements.length - 1]!;

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleTrapFocus);
    return () => document.removeEventListener("keydown", handleTrapFocus);
  }, [isReviewOpen, isCancelOpen]);

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

  // Debounced note save
  useEffect(() => {
    if (noteText === lastSavedNoteRef.current) return;

    setNoteStatus("saving");
    const timeout = setTimeout(async () => {
      const result = await updateSessionNoteAction(session.id, noteText);
      if (result.ok) {
        lastSavedNoteRef.current = noteText;
        setNoteStatus("saved");
        setReviewNote(noteText);
      } else {
        setNoteStatus("error");
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [noteText, session.id]);

  // Toggle pause/resume
  const handleTogglePause = useCallback(() => {
    setActionError(null);
    if (session.status === "active") {
      startTransition(async () => {
        const result = await pauseSessionAction(session.id);
        if (result.ok) {
          setSession((prev) => ({
            ...prev,
            status: "paused",
            pausedAt: result.data.pausedAt,
          }));
        } else {
          setActionError(result.error.message);
        }
      });
    } else if (session.status === "paused") {
      startTransition(async () => {
        const result = await resumeSessionAction(session.id);
        if (result.ok) {
          setSession((prev) => ({
            ...prev,
            status: "active",
            pausedAt: null,
            totalPausedSeconds: result.data.totalPausedSeconds,
          }));
        } else {
          setActionError(result.error.message);
        }
      });
    }
  }, [session.id, session.status]);

  // Handle distraction creation
  const handleCreateDistraction = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setDistractionError(null);
    const textToSave = distractionText.trim() || null;
    const result = await createDistractionAction({
      sessionId: session.id,
      text: textToSave,
    });
    if (result.ok) {
      setDistractionsList((prev) => [...prev, result.data]);
      setDistractionText("");
    } else {
      setDistractionError(result.error.message);
    }
  };

  // Handle distraction archive
  const handleArchiveDistraction = async (id: string) => {
    setDistractionError(null);
    const result = await archiveDistractionAction(id);
    if (result.ok) {
      setDistractionsList((prev) => prev.filter((d) => d.id !== id));
    } else {
      setDistractionError(result.error.message);
    }
  };

  // Handle distraction update
  const handleSaveDistractionEdit = async (id: string) => {
    setDistractionError(null);
    const result = await updateDistractionAction(id, {
      text: editingText.trim() || null,
    });
    if (result.ok) {
      setDistractionsList((prev) =>
        prev.map((d) => (d.id === id ? result.data : d)),
      );
      setEditingDistractionId(null);
    } else {
      setDistractionError(result.error.message);
    }
  };

  // Handle cancel session
  const handleConfirmCancel = async () => {
    setActionError(null);
    startTransition(async () => {
      const result = await cancelSessionAction(session.id);
      if (result.ok) {
        router.push("/today");
      } else {
        setActionError(result.error.message);
      }
    });
  };

  // Handle submit review
  const handleSubmitReview = async () => {
    setReviewSubmitting(true);
    setReviewError(null);

    const result = await finishSessionReviewAction({
      sessionId: session.id,
      note: reviewNote.trim() || null,
      outcome: reviewOutcome,
    });

    setReviewSubmitting(false);

    if (result.ok) {
      router.push("/today");
    } else {
      setReviewError(`${result.error.code}: ${result.error.message}`);
    }
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isReviewOpen) setIsReviewOpen(false);
        if (isCancelOpen) setIsCancelOpen(false);
        if (editingDistractionId) setEditingDistractionId(null);
        return;
      }

      // Don't trigger shortcuts when modals are open
      if (isReviewOpen || isCancelOpen) return;

      if (isTypingElement(document.activeElement)) return;

      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePause();
      } else if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        distractionInputRef.current?.focus();
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setReviewNote(noteText);
        setIsReviewOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    editingDistractionId,
    handleTogglePause,
    isCancelOpen,
    isReviewOpen,
    noteText,
  ]);

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
            <span>返回 Today</span>
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
              {session.track.title}
            </p>
            <h1 className="text-2xl font-semibold tracking-tight text-stone-900 sm:text-3xl">
              {session.task?.title ?? "无结构专注 (Unstructured Focus)"}
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
                  已超时 (Overtime) · 累计已专注{" "}
                  {formatHumanDuration(elapsedSeconds)}
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
              onClick={handleTogglePause}
              className="h-12 min-w-32 gap-2 text-base shadow-xs"
            >
              {isPaused ? (
                <>
                  <Play className="size-4 fill-current" aria-hidden="true" />
                  继续 (Space)
                </>
              ) : (
                <>
                  <Pause className="size-4" aria-hidden="true" />
                  暂停 (Space)
                </>
              )}
            </Button>

            <Button
              size="lg"
              disabled={isPending}
              onClick={() => {
                setReviewNote(noteText);
                setIsReviewOpen(true);
              }}
              className="h-12 min-w-32 gap-2 bg-stone-900 text-base text-stone-50 shadow-xs hover:bg-stone-800"
            >
              <CheckCircle2 className="size-4" aria-hidden="true" />
              完成 (F)
            </Button>

            <Button
              size="lg"
              variant="ghost"
              disabled={isPending}
              onClick={() => setIsCancelOpen(true)}
              className="h-12 text-sm text-stone-500 hover:text-red-700"
            >
              取消
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
                  Quick Note
                </label>
                <span className="font-mono text-xs text-stone-400">
                  {noteStatus === "saving" && "Saving..."}
                  {noteStatus === "saved" && "Saved"}
                  {noteStatus === "error" && "Error saving"}
                </span>
              </div>
              <textarea
                id="focus-note"
                rows={3}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="记录灵感、进展或下一步想法 (自动保存)..."
                className="w-full resize-none rounded-lg border border-stone-200 bg-transparent p-3 text-sm placeholder:text-stone-400 focus:border-stone-900 focus:outline-hidden"
              />
            </CardContent>
          </Card>

          {/* Distractions Card */}
          <Card className="border-stone-200/80 bg-white/80 shadow-xs">
            <CardContent className="space-y-4 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-medium tracking-wider text-stone-500 uppercase">
                  Distractions (按 D 快速记录)
                </span>
                <span className="font-mono text-xs text-stone-400">
                  {distractionsList.length} 条打断
                </span>
              </div>

              {/* Distraction Form */}
              <form
                onSubmit={handleCreateDistraction}
                className="flex items-center gap-2"
              >
                <Input
                  ref={distractionInputRef}
                  value={distractionText}
                  onChange={(e) => setDistractionText(e.target.value)}
                  placeholder="记录打断 (可留空)..."
                  className="h-9 text-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  className="h-9"
                >
                  记录
                </Button>
              </form>

              {distractionError && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                >
                  {distractionError}
                </div>
              )}

              {/* Distractions List */}
              {distractionsList.length > 0 && (
                <ul className="divide-y divide-stone-100 rounded-lg border border-stone-100 bg-stone-50/50">
                  {distractionsList.map((d) => (
                    <li
                      key={d.id}
                      className="flex items-center justify-between gap-3 p-3 text-sm"
                    >
                      {editingDistractionId === d.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleSaveDistractionEdit(d.id);
                          }}
                          className="flex flex-1 items-center gap-2"
                        >
                          <Input
                            value={editingText}
                            onChange={(e) => setEditingText(e.target.value)}
                            className="h-8 text-xs"
                            autoFocus
                          />
                          <Button
                            type="submit"
                            size="sm"
                            className="h-8 text-xs"
                          >
                            保存
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={() => setEditingDistractionId(null)}
                          >
                            取消
                          </Button>
                        </form>
                      ) : (
                        <>
                          <span className="truncate text-stone-700">
                            {d.text || "(快速打断记录)"}
                          </span>
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-7 p-0 text-stone-400 hover:text-stone-700"
                              onClick={() => {
                                setEditingDistractionId(d.id);
                                setEditingText(d.text ?? "");
                              }}
                              aria-label="编辑打断"
                            >
                              <Edit2 className="size-3.5" aria-hidden="true" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="size-7 p-0 text-stone-400 hover:text-stone-700"
                              onClick={() => handleArchiveDistraction(d.id)}
                              aria-label="归档打断"
                            >
                              <Archive
                                className="size-3.5"
                                aria-hidden="true"
                              />
                            </Button>
                          </div>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </main>

      {/* Review Modal */}
      {isReviewOpen && (
        <div
          ref={reviewModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
        >
          <div className="relative w-full max-w-lg space-y-6 rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
            <div className="flex items-start justify-between">
              <div>
                <h2
                  id="review-dialog-title"
                  className="text-2xl font-semibold text-stone-900"
                >
                  专注回顾 (Finish Review)
                </h2>
                <p className="mt-1 text-sm text-stone-500">
                  确认实际执行成果，完成状态将原子保存到数据表。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (reviewNote !== noteText) setNoteText(reviewNote);
                  setIsReviewOpen(false);
                }}
                className="rounded-lg p-1 text-stone-400 hover:text-stone-700"
              >
                <X className="size-5" aria-hidden="true" />
              </button>
            </div>

            {/* Session Summary */}
            <div className="grid grid-cols-2 gap-3 rounded-xl bg-stone-50 p-4 font-mono text-sm">
              <div>
                <span className="text-xs text-stone-500">实际专注时长</span>
                <p className="font-semibold text-stone-900">
                  {formatHumanDuration(
                    calculateDurationSecondsOnFinish(
                      session,
                      now ?? new Date(),
                    ),
                  )}
                </p>
              </div>
              <div>
                <span className="text-xs text-stone-500">打断次数</span>
                <p className="font-semibold text-stone-900">
                  {distractionsList.length} 次
                </p>
              </div>
            </div>

            {/* Task Outcome Options */}
            {session.taskId ? (
              <div className="space-y-3">
                <label className="text-xs font-medium tracking-wider text-stone-500 uppercase">
                  当前任务结算
                </label>
                <div className="space-y-2">
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                      reviewOutcome === "completed"
                        ? "border-stone-900 bg-stone-50/80"
                        : "border-stone-200 hover:bg-stone-50/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="outcome"
                      value="completed"
                      checked={reviewOutcome === "completed"}
                      onChange={() => setReviewOutcome("completed")}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="font-medium text-stone-900">
                        标记已完成 (Completed)
                      </p>
                      <p className="text-xs text-stone-500">
                        将任务标记为已完成，自动推进 Current Next
                        到下一个待办任务
                        {nextTaskPreviewTitle &&
                          ` (预计：${nextTaskPreviewTitle})`}
                        。
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                      reviewOutcome === "continue_later"
                        ? "border-stone-900 bg-stone-50/80"
                        : "border-stone-200 hover:bg-stone-50/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="outcome"
                      value="continue_later"
                      checked={reviewOutcome === "continue_later"}
                      onChange={() => setReviewOutcome("continue_later")}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="font-medium text-stone-900">
                        稍后继续 (Continue later)
                      </p>
                      <p className="text-xs text-stone-500">
                        仅结束本次 Session 计时，保留任务为 Pending 和 Current
                        Next。
                      </p>
                    </div>
                  </label>

                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                      reviewOutcome === "skip"
                        ? "border-stone-900 bg-stone-50/80"
                        : "border-stone-200 hover:bg-stone-50/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="outcome"
                      value="skip"
                      checked={reviewOutcome === "skip"}
                      onChange={() => setReviewOutcome("skip")}
                      className="mt-0.5"
                    />
                    <div>
                      <p className="font-medium text-stone-900">
                        跳过任务 (Skip)
                      </p>
                      <p className="text-xs text-stone-500">
                        将任务标记为 Skipped，自动推进 Current Next 到下一项。
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 text-sm text-stone-700">
                本次为无结构专注 (无关联任务)，结束计时后将归档到今日统计中。
              </div>
            )}

            {/* Note Field in Review */}
            <div className="space-y-1.5">
              <label
                htmlFor="review-note"
                className="text-xs font-medium tracking-wider text-stone-500 uppercase"
              >
                专注笔记 (Session Note)
              </label>
              <textarea
                id="review-note"
                rows={3}
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="记录总结或后续注意事项..."
                className="w-full resize-none rounded-lg border border-stone-200 p-3 text-sm focus:border-stone-900 focus:outline-hidden"
              />
            </div>

            {reviewError && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                {reviewError}
              </div>
            )}

            {/* Review Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="ghost"
                disabled={reviewSubmitting}
                onClick={() => {
                  // Sync note edits back so they're not lost
                  if (reviewNote !== noteText) {
                    setNoteText(reviewNote);
                  }
                  setIsReviewOpen(false);
                }}
              >
                取消
              </Button>
              <Button
                disabled={reviewSubmitting}
                onClick={handleSubmitReview}
                className="min-w-28 gap-2 bg-stone-900 text-stone-50 hover:bg-stone-800"
              >
                {reviewSubmitting && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                确认完成
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Modal */}
      {isCancelOpen && (
        <div
          ref={cancelModalRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
        >
          <div className="w-full max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-2xl">
            <div className="space-y-2">
              <h2
                id="cancel-dialog-title"
                className="text-xl font-semibold text-stone-900"
              >
                确定取消本次专注吗？
              </h2>
              <p className="text-sm text-stone-600">
                取消后本次记录不会计入今日统计与历史专注时长，且不可恢复。
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="ghost"
                disabled={isPending}
                onClick={() => setIsCancelOpen(false)}
              >
                保留本次专注
              </Button>
              <Button
                variant="outline"
                disabled={isPending}
                onClick={handleConfirmCancel}
                className="border-red-200 text-red-700 hover:bg-red-50"
              >
                确定取消
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
