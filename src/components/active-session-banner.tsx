"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Pause } from "lucide-react";

import { getActiveSessionAction } from "@/app/(app)/session-actions";
import type { SessionView } from "@/services/session";
import { formatTimeDigits } from "@/shared/session-timer";
import { Button } from "@/components/ui/button";
import { useTimerDisplay } from "@/components/today/use-timer-display";

/**
 * Compact unfinished-timer notice for non-execution pages (PRD §5.1): a
 * hint and a way back — never a second timer implementation, and never
 * duplicated on /today itself. The shared layout does not re-render on
 * client navigation, so the banner re-reads the server on every route
 * change while mounted.
 */
export function ActiveSessionBanner({
  initialSession,
}: {
  initialSession: SessionView | null;
}) {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionView | null>(initialSession);

  useEffect(() => {
    if (pathname === "/today") return;
    let cancelled = false;
    void getActiveSessionAction().then((result) => {
      if (!cancelled) setSession(result.ok ? result.data : null);
    });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  if (pathname === "/today" || !session) return null;
  return <SessionBanner session={session} />;
}

function SessionBanner({ session }: { session: SessionView }) {
  const display = useTimerDisplay(session);
  const isPaused = session.status === "paused";
  return (
    <div
      role="region"
      aria-label="进行中的专注提示条"
      className="border-b border-amber-200/80 bg-amber-50/95 text-stone-900 backdrop-blur-md"
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
                {display.due
                  ? "到时等待"
                  : session.phase?.kind === "short_break"
                    ? "短休息中"
                    : session.phase?.kind === "long_break"
                      ? "长休息中"
                      : "专注中"}
              </>
            )}
          </span>

          <div className="flex min-w-0 items-baseline gap-2 truncate text-sm">
            <span className="truncate font-medium">{session.goal.title}</span>
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
            {formatTimeDigits(display.seconds)}
          </span>
          <Button
            size="sm"
            variant="default"
            nativeButton={false}
            className="h-8 gap-1.5 text-xs"
            render={<Link href="/today" />}
          >
            回到今天
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
