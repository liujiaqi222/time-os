"use client";

import { useCallback, useState, useTransition } from "react";

import type { Session, SessionWithRelations } from "@/services/session";
import type { Result } from "@/shared/result";

export interface FocusSessionActions {
  pause: (sessionId: string) => Promise<Result<Session>>;
  resume: (sessionId: string) => Promise<Result<Session>>;
  cancel: (sessionId: string) => Promise<Result<Session>>;
}

/**
 * Session lifecycle for the focus page: local session state plus the
 * pause/resume/cancel actions. Server actions are injected, so tests can
 * drive the hook without the network.
 */
export function useFocusSession(options: {
  initialSession: SessionWithRelations;
  actions: FocusSessionActions;
  onCancelled: () => void;
}) {
  const { actions, onCancelled } = options;
  const [session, setSession] = useState(options.initialSession);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const togglePause = useCallback(() => {
    setError(null);
    if (session.status === "active") {
      startTransition(async () => {
        const result = await actions.pause(session.id);
        if (result.ok) {
          setSession((prev) => ({
            ...prev,
            status: "paused",
            pausedAt: result.data.pausedAt,
          }));
        } else {
          setError(result.error.message);
        }
      });
    } else if (session.status === "paused") {
      startTransition(async () => {
        const result = await actions.resume(session.id);
        if (result.ok) {
          setSession((prev) => ({
            ...prev,
            status: "active",
            pausedAt: null,
            totalPausedSeconds: result.data.totalPausedSeconds,
          }));
        } else {
          setError(result.error.message);
        }
      });
    }
  }, [session.id, session.status, actions]);

  const confirmCancel = useCallback(() => {
    setError(null);
    startTransition(async () => {
      const result = await actions.cancel(session.id);
      if (result.ok) {
        onCancelled();
      } else {
        setError(result.error.message);
      }
    });
  }, [session.id, actions, onCancelled]);

  return { session, isPending, error, togglePause, confirmCancel };
}
