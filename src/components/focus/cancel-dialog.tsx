"use client";

import { Modal } from "@/components/focus/modal";
import { Button } from "@/components/ui/button";

/** Cancel confirmation dialog for a running session (PRD §7.6). */
export function CancelDialog({
  onClose,
  onConfirm,
  isPending,
}: {
  onClose: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  return (
    <Modal
      onClose={onClose}
      labelledBy="cancel-dialog-title"
      panelClassName="w-full max-w-md space-y-5 rounded-2xl bg-white p-6 shadow-2xl"
    >
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
        <Button variant="ghost" disabled={isPending} onClick={onClose}>
          继续专注
        </Button>
        <Button
          variant="outline"
          disabled={isPending}
          onClick={onConfirm}
          className="border-red-200 text-red-700 hover:bg-red-50"
        >
          放弃专注
        </Button>
      </div>
    </Modal>
  );
}
