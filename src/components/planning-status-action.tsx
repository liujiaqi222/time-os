"use client";

import { useActionState } from "react";
import { Archive, CircleCheck, RotateCcw, CircleMinus } from "lucide-react";

import { updatePlanningStatusAction } from "@/app/(app)/planning-actions";
import { Button } from "@/components/ui/button";

type PlanningStatusState =
  { status: "success" } | { status: "error"; message: string } | undefined;

/**
 * Goal / Task lifecycle transition bound to the shared status action.
 * Domain rejections (e.g. PARENT_HAS_ACTIVE_SESSION) surface inline next
 * to the trigger — never as a raw page error (PRD §8.1). Full management
 * confirmation flows arrive with T10.
 */
export function PlanningStatusAction({
  entityType,
  id,
  action,
  label,
  icon,
  variant = "outline",
}: {
  entityType: "goal" | "task";
  id: string;
  action: string;
  label: string;
  icon?: "check" | "archive" | "reactivate" | "skip";
  variant?: "outline" | "ghost" | "default";
}) {
  const [state, formAction, pending] = useActionState<
    PlanningStatusState,
    FormData
  >(updatePlanningStatusAction, undefined);

  const iconElement =
    icon === "check" ? (
      <CircleCheck className="size-3.5" aria-hidden="true" />
    ) : icon === "archive" ? (
      <Archive className="size-3.5" aria-hidden="true" />
    ) : icon === "reactivate" ? (
      <RotateCcw className="size-3.5" aria-hidden="true" />
    ) : icon === "skip" ? (
      <CircleMinus className="size-3.5" aria-hidden="true" />
    ) : null;

  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start gap-1"
    >
      <input type="hidden" name="entityType" value={entityType} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <Button
        type="submit"
        size="xs"
        variant={variant}
        disabled={pending}
        className={
          variant === "default" ? "bg-stone-900 text-stone-50" : undefined
        }
      >
        {iconElement}
        {pending ? "处理中…" : label}
      </Button>
      {state?.status === "error" && (
        <span role="alert" className="max-w-64 text-left text-xs text-red-600">
          {state.message}
        </span>
      )}
    </form>
  );
}
