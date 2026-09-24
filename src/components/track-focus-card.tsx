"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, Clock, Play } from "lucide-react";

import { setNextAction } from "@/app/(app)/planning-actions";
import { startSessionAction } from "@/app/(app)/session-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CurrentTask = {
  id: string;
  title: string;
  description: string | null;
  estimatedMinutes: number | null;
};

export function TrackFocusCard({
  trackId,
  current,
  taskCount,
  defaultFocusMinutes,
  activeSessionId,
}: {
  trackId: string;
  current: CurrentTask | null;
  taskCount: number;
  defaultFocusMinutes: number;
  activeSessionId: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function startFocus() {
    setError(null);
    startTransition(async () => {
      const result = await startSessionAction({
        trackId,
        taskId: current?.id ?? null,
        plannedMinutes: current?.estimatedMinutes ?? defaultFocusMinutes,
      });

      if (!result.ok) {
        if (
          result.error.code === "ACTIVE_SESSION_EXISTS" &&
          result.error.context?.sessionId
        ) {
          router.push(`/focus/${String(result.error.context.sessionId)}`);
          return;
        }

        setError(result.error.message);
        return;
      }

      router.push(`/focus/${result.data.id}`);
    });
  }

  return (
    <Card
      className={
        current
          ? "relative border-stone-200/90 bg-white/85 shadow-[0_16px_45px_rgba(41,37,36,0.07)]"
          : "border-dashed border-stone-300 bg-transparent shadow-none"
      }
    >
      {current && (
        <div
          aria-hidden="true"
          className="absolute inset-y-0 left-0 w-1.5 bg-amber-400"
        />
      )}
      <CardHeader className={current ? "pl-7 sm:pl-9" : undefined}>
        <p className="font-mono text-xs tracking-[0.16em] text-stone-500 uppercase">
          下一步
        </p>
        <CardTitle className="text-2xl sm:text-3xl">
          {current
            ? current.title
            : taskCount
              ? "尚未选择下一步"
              : "还没有任务"}
        </CardTitle>
      </CardHeader>
      <CardContent className={current ? "space-y-5 pl-7 sm:pl-9" : "space-y-4"}>
        <p className="max-w-2xl leading-6 text-stone-600">
          {current
            ? current.description || "这是这条推进线现在唯一需要关注的下一步。"
            : taskCount
              ? "从下方待办任务中选择一个设为下一步。"
              : "先添加一个任务，首个待办任务会自动成为下一步。"}
        </p>

        {current && (
          <div className="flex items-center gap-2 text-sm text-stone-500">
            <Clock className="size-4" aria-hidden="true" />
            预计 {current.estimatedMinutes ?? defaultFocusMinutes} 分钟
          </div>
        )}

        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {activeSessionId ? (
            <Button
              nativeButton={false}
              size="lg"
              className="w-full sm:w-auto"
              render={<Link href={`/focus/${activeSessionId}`} />}
            >
              返回正在进行的专注
              <ArrowRight aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              className="w-full sm:w-auto"
              disabled={isPending}
              onClick={startFocus}
            >
              <Play className="fill-current" aria-hidden="true" />
              {isPending ? "正在开始…" : current ? "开始专注" : "开始自由专注"}
            </Button>
          )}

          {current && (
            <form action={setNextAction}>
              <input type="hidden" name="trackId" value={trackId} />
              <input type="hidden" name="taskId" value="" />
              <Button
                type="submit"
                size="lg"
                variant="ghost"
                className="w-full text-stone-500 sm:w-auto"
              >
                重新选择下一步
              </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
