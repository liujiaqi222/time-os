"use client";

import { Modal } from "@/components/focus/modal";
import { Button } from "@/components/ui/button";

export function ConfirmationDialog({
  titleId,
  title,
  description,
  confirmLabel,
  cancelLabel = "先不操作",
  pending = false,
  error,
  tone = "default",
  confirmType = "button",
  onClose,
  onConfirm,
}: {
  titleId: string;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  pending?: boolean;
  error?: string | null;
  tone?: "default" | "danger";
  confirmType?: "button" | "submit";
  onClose: () => void;
  onConfirm?: () => void;
}) {
  return (
    <Modal
      onClose={() => {
        if (!pending) onClose();
      }}
      labelledBy={titleId}
      panelClassName="w-full max-w-md space-y-5 rounded-2xl border border-stone-200 bg-white p-6 shadow-2xl"
    >
      <div className="space-y-2">
        <h2 id={titleId} className="text-xl font-semibold text-stone-900">
          {title}
        </h2>
        <div className="text-sm leading-6 text-stone-600">{description}</div>
      </div>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onClose}
        >
          {cancelLabel}
        </Button>
        <Button
          type={confirmType}
          variant={tone === "danger" ? "outline" : "default"}
          disabled={pending}
          onClick={onConfirm}
          className={
            tone === "danger"
              ? "border-red-200 text-red-700 hover:bg-red-50"
              : undefined
          }
        >
          {pending ? "正在处理…" : confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
