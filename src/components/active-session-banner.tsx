"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Pause } from "lucide-react";

import type { SessionWithRelations } from "@/services/session";
import {
  calculateElapsedSeconds,
  formatTimeDigits,
} from "@/shared/session-timer";
import { Button } from "@/components/ui/button";

export function ActiveSessionBanner({
  session,
}: {
  session: SessionWithRelations;
}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (session.status !== "active") return;

    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timer);
  }, [session.status]);

  const elapsed = calculateElapsedSeconds(session, now);
  const isPaused = session.status === "paused";

  return (
    <div
      role="region"
      aria-label="Active focus session banner"
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
                Paused
              </>
            ) : (
              <>
                <span className="relative flex size-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
                Focusing
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
            {formatTimeDigits(elapsed)}
          </span>
          <Button
            size="sm"
            variant="default"
            nativeButton={false}
            className="h-8 gap-1.5 text-xs"
            render={<Link href={`/focus/${session.id}`} />}
          >
            Return to focus
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
