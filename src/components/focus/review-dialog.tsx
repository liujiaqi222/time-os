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
            专注收尾与推进交接
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            确认本次行动进展，交接笔记将沉淀为下一次启动的指引。
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
          <span className="text-xs text-stone-500">暂存闪念</span>
          <p className="font-semibold text-stone-900">{distractionsCount} 条</p>
        </div>
      </div>

      {/* Task Outcome Options */}
      {session.taskId ? (
        <div className="space-y-3">
          <label className="text-xs font-medium tracking-wider text-stone-500 uppercase">
            当前行动项结算
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
                <p className="font-medium text-stone-900">已搞定，标记为完成</p>
                <p className="text-xs text-stone-500">
                  将行动项标记为已完成，自动推进当前下一步到下一个待办
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
                  稍后继续（保留当前行动项）
                </p>
                <p className="text-xs text-stone-500">
                  结束本次计时，保留此行动项为“当前下一步”。本次交接笔记将作为下次继续的接头暗号。
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
                <p className="font-medium text-stone-900">跳过此步</p>
                <p className="text-xs text-stone-500">
                  跳过此行动项，自动推进当前下一步到下一项。
                </p>
              </div>
            </label>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-200 bg-stone-50/60 p-4 text-sm text-stone-700">
          本次为自由专注 (无关联特定行动项)，结束计时后将归入今日专注统计。
        </div>
      )}

      {/* Note Field in Review */}
      <div className="space-y-1.5">
        <label
          htmlFor="review-note"
          className="text-xs font-medium tracking-wider text-stone-500 uppercase"
        >
          本次推进交接笔记
        </label>
        <p className="text-xs text-stone-500">
          记录本次进展、代码断点或后续思考。下次进入今日主页时将自动为你高亮呈现。
        </p>
        <textarea
          id="review-note"
          rows={3}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="留下一句断点思考，给未来的自己铺路..."
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
          完成并保存交接
        </Button>
      </div>
    </Modal>
  );
}
