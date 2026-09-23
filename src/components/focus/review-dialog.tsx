"use client";

import { Loader2, X } from "lucide-react";

import { Modal } from "@/components/focus/modal";
import { Button } from "@/components/ui/button";
import type { SessionWithRelations } from "@/services/session";
import type { SessionOutcome } from "@/shared/schemas/session";
import {
  calculateDurationSecondsOnFinish,
  formatHumanDuration,
} from "@/shared/session-timer";

/**
 * Finish Review dialog (PRD §7.5). Purely presentational: outcome and note
 * are controlled by the page, which owns the two-way sync with the Quick
 * Note.
 */
export function ReviewDialog({
  session,
  now,
  distractionsCount,
  nextTaskPreviewTitle,
  outcome,
  onOutcomeChange,
  note,
  onNoteChange,
  submitting,
  error,
  onClose,
  onSubmit,
}: {
  session: SessionWithRelations;
  now: Date | null;
  distractionsCount: number;
  nextTaskPreviewTitle?: string | null;
  outcome: SessionOutcome;
  onOutcomeChange: (outcome: SessionOutcome) => void;
  note: string;
  onNoteChange: (note: string) => void;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <Modal
      onClose={onClose}
      labelledBy="review-dialog-title"
      overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
      panelClassName="relative w-full max-w-lg space-y-6 rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
    >
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
          onClick={onClose}
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
              calculateDurationSecondsOnFinish(session, now ?? new Date()),
            )}
          </p>
        </div>
        <div>
          <span className="text-xs text-stone-500">打断次数</span>
          <p className="font-semibold text-stone-900">{distractionsCount} 次</p>
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
                outcome === "completed"
                  ? "border-stone-900 bg-stone-50/80"
                  : "border-stone-200 hover:bg-stone-50/50"
              }`}
            >
              <input
                type="radio"
                name="outcome"
                value="completed"
                checked={outcome === "completed"}
                onChange={() => onOutcomeChange("completed")}
                className="mt-0.5"
              />
              <div>
                <p className="font-medium text-stone-900">
                  标记已完成 (Completed)
                </p>
                <p className="text-xs text-stone-500">
                  将任务标记为已完成，自动推进 Current Next 到下一个待办任务
                  {nextTaskPreviewTitle && ` (预计：${nextTaskPreviewTitle})`}。
                </p>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                outcome === "continue_later"
                  ? "border-stone-900 bg-stone-50/80"
                  : "border-stone-200 hover:bg-stone-50/50"
              }`}
            >
              <input
                type="radio"
                name="outcome"
                value="continue_later"
                checked={outcome === "continue_later"}
                onChange={() => onOutcomeChange("continue_later")}
                className="mt-0.5"
              />
              <div>
                <p className="font-medium text-stone-900">
                  稍后继续 (Continue later)
                </p>
                <p className="text-xs text-stone-500">
                  仅结束本次 Session 计时，保留任务为 Pending 和 Current Next。
                </p>
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
                outcome === "skip"
                  ? "border-stone-900 bg-stone-50/80"
                  : "border-stone-200 hover:bg-stone-50/50"
              }`}
            >
              <input
                type="radio"
                name="outcome"
                value="skip"
                checked={outcome === "skip"}
                onChange={() => onOutcomeChange("skip")}
                className="mt-0.5"
              />
              <div>
                <p className="font-medium text-stone-900">跳过任务 (Skip)</p>
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
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="记录总结或后续注意事项..."
          className="w-full resize-none rounded-lg border border-stone-200 p-3 text-sm focus:border-stone-900 focus:outline-hidden"
        />
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Review Modal Actions */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button variant="ghost" disabled={submitting} onClick={onClose}>
          取消
        </Button>
        <Button
          disabled={submitting}
          onClick={onSubmit}
          className="min-w-28 gap-2 bg-stone-900 text-stone-50 hover:bg-stone-800"
        >
          {submitting && (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          )}
          确认完成
        </Button>
      </div>
    </Modal>
  );
}
