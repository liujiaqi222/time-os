"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, CircleCheck } from "lucide-react";

import {
  updatePlanningStatusAction,
  type PlanningStatusState,
} from "@/app/(app)/planning-actions";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import { Button } from "@/components/ui/button";

type EntityType = "goal" | "track";
type TargetStatus = "completed" | "archived";

export function PlanningStatusAction({
  entityType,
  entityId,
  entityTitle,
  status,
  blockingSession,
}: {
  entityType: EntityType;
  entityId: string;
  entityTitle: string;
  status: TargetStatus;
  blockingSession?: {
    id: string;
    trackTitle: string;
    status: "active" | "paused";
  } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState<
    PlanningStatusState,
    FormData
  >(updatePlanningStatusAction, undefined);

  const isComplete = status === "completed";
  const entityLabel = entityType === "goal" ? "Goal" : "Track";
  const actionLabel = isComplete ? "完成" : "归档";
  const titleId = `status-dialog-${entityId}-${status}`;

  return (
    <>
      <Button
        type="button"
        size="xs"
        variant={isComplete ? "outline" : "ghost"}
        onClick={() => setOpen(true)}
      >
        {isComplete ? <CircleCheck /> : <Archive />}
        {actionLabel}
      </Button>

      {open && (
        <form action={action}>
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="id" value={entityId} />
          <input type="hidden" name="status" value={status} />
          <ConfirmationDialog
            titleId={titleId}
            title={
              blockingSession
                ? `暂时无法${actionLabel} ${entityLabel}`
                : `${actionLabel}「${entityTitle}」？`
            }
            description={
              blockingSession ? (
                <>
                  「{blockingSession.trackTitle}」中还有一段
                  {blockingSession.status === "paused" ? "已暂停" : "进行中"}
                  的专注。请先完成或取消这段专注，再回来调整计划状态。
                </>
              ) : isComplete ? (
                `完成后，这个 ${entityLabel} 会从进行中的计划中收起；任务和历史记录都会保留，也可以之后重新启用。`
              ) : (
                `归档后，这个 ${entityLabel} 会从进行中的计划中收起；内容不会删除，也可以之后重新启用。`
              )
            }
            confirmLabel={
              blockingSession ? "返回当前专注" : `确认${actionLabel}`
            }
            confirmType={blockingSession ? "button" : "submit"}
            pending={pending}
            error={state?.status === "error" ? state.message : null}
            onClose={() => setOpen(false)}
            onConfirm={
              blockingSession
                ? () => router.push(`/focus/${blockingSession.id}`)
                : undefined
            }
          />
        </form>
      )}
    </>
  );
}
