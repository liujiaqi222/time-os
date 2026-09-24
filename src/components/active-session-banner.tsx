"use client";

import Link from "next/link";
import { ArrowRight, Pause } from "lucide-react";

import type { SessionWithRelations } from "@/services/session";
import {
  calculateElapsedSeconds,
  formatTimeDigits,
} from "@/shared/session-timer";
import { Button } from "@/components/ui/button";
import { useCurrentSeconds } from "@/components/use-current-seconds";

export function ActiveSessionBanner({
  session,
}: {
  session: SessionWithRelations;
}) {
  const currentSeconds = useCurrentSeconds();
  const now = currentSeconds === null ? null : new Date(currentSeconds * 1000);
  const isPaused = session.status === "paused";

  // Paused/finished sessions derive elapsed from stored timestamps, which is
  // identical on server and client. Active sessions need the ticking clock,
  // so they show a placeholder until mounted.
  const elapsed =
    session.status === "active"
      ? now
        ? calculateElapsedSeconds(session, now)
        : null
      : calculateElapsedSeconds(session);

  return (
    <div
      role="region"
      aria-label="进行中的专注提示"
      className="border-b border-amber-200/80 bg-amber-50/90 text-stone-900 transition-colors"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-2.5 sm:flex-nowrap">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${
              isPaused
                ? "bg-amber-200/80 text-amber-900"
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

          <div className="flex min-w-0 items-baseline gap-2 truncate text-sm">
            <span className="truncate font-medium">{session.track.title}</span>
            {session.task && (
              <>
                <span className="text-stone-400">/</span>
                <span className="truncate text-stone-600">
                  {session.task.title}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-semibold text-stone-800 tabular-nums">
            {elapsed === null ? "--:--" : formatTimeDigits(elapsed)}
          </span>
          <Button
            size="sm"
            variant="default"
            nativeButton={false}
            className="h-8 gap-1.5 text-xs"
            render={<Link href={`/focus/${session.id}`} />}
          >
            返回专注
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
