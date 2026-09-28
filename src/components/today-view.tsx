"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRight, Clock, Play, Plus, TimerReset } from "lucide-react";

import { startSessionAction } from "@/app/(app)/session-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DashboardData, ActiveTrackItem } from "@/services/dashboard";
import { formatHumanDuration } from "@/shared/session-timer";

export function TodayView({
  dashboard,
  defaultFocusMinutes,
}: {
  dashboard: DashboardData;
  defaultFocusMinutes: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activeSessionAlert, setActiveSessionAlert] = useState<{
    sessionId: string;
    trackTitle: string;
  } | null>(null);

  const { activeSession, todayStats, selectedTrack, activeTracks } = dashboard;

  const handleStartSession = async (
    trackItem: ActiveTrackItem,
    customMinutes?: number,
  ) => {
    setErrorMsg(null);
    setActiveSessionAlert(null);

    if (activeSession) {
      setActiveSessionAlert({
        sessionId: activeSession.id,
        trackTitle: activeSession.track.title,
      });
      return;
    }

    const plannedMinutes =
      customMinutes ??
      trackItem.currentNextTask?.estimatedMinutes ??
      defaultFocusMinutes;

    startTransition(async () => {
      const result = await startSessionAction({
        trackId: trackItem.track.id,
        taskId: trackItem.currentNextTask?.id ?? null,
        plannedMinutes,
      });

      if (!result.ok) {
        if (
          result.error.code === "ACTIVE_SESSION_EXISTS" &&
          result.error.context?.sessionId
        ) {
          setActiveSessionAlert({
            sessionId: String(result.error.context.sessionId),
            trackTitle: "正在进行的专注",
          });
        } else {
          setErrorMsg(result.error.message);
        }
        return;
      }

      router.push(`/focus/${result.data.id}`);
    });
  };

  if (activeTracks.length === 0) {
    return (
      <div className="space-y-10">
        <header className="space-y-2">
          <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
            今天
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            准备开始什么？
          </h1>
        </header>

        <Card className="border-dashed border-stone-300 bg-transparent shadow-none">
          <CardContent className="flex min-h-72 flex-col items-start justify-center gap-5 p-8 sm:p-12">
            <span className="grid size-12 place-items-center rounded-full bg-stone-900 text-stone-50">
              <TimerReset aria-hidden="true" />
            </span>
            <div className="max-w-xl space-y-2">
              <h2 className="text-2xl font-medium">还没有可执行的推进线</h2>
              <p className="leading-7 text-stone-600">
                先建立目标、推进线与任务，这里会把每条线的下一步带给你。
              </p>
            </div>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/goals" />}
            >
              从计划开始 <ArrowRight aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const secondaryTracks = activeTracks.filter(
    (t) => t.track.id !== selectedTrack?.track.id,
  );

  return (
    <div className="space-y-10">
      <header className="space-y-3">
        <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
          今天
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          现在推进什么？
        </h1>
        <p className="text-sm text-stone-500">
          今日专注 {formatHumanDuration(todayStats.totalFocusSeconds)} · 已完成{" "}
          {todayStats.completedTasksCount} · 专注 {todayStats.sessionCount} 次
        </p>
      </header>

      {activeSessionAlert && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">已经有一段专注在进行</p>
              <p className="text-sm text-amber-700">
                请先完成或取消当前的专注，再开始新的。
              </p>
            </div>
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href={`/focus/${activeSessionAlert.sessionId}`} />}
            >
              返回正在进行的专注
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {errorMsg}
        </div>
      )}

      {selectedTrack && (
        <section aria-labelledby="focus-now-title">
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="focus-now-title"
              className="font-mono text-xs tracking-wider text-stone-500 uppercase"
            >
              现在推进
            </h2>
            <span className="text-xs text-stone-500">
              {selectedTrack.goal.title} / {selectedTrack.track.title}
            </span>
          </div>

          <Card className="relative overflow-hidden border border-stone-200/90 bg-white/85 shadow-[0_18px_55px_rgba(41,37,36,0.08)]">
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1.5 bg-amber-400"
            />
            <CardContent className="flex flex-col justify-between gap-8 py-3 pr-6 pl-7 sm:py-5 sm:pr-10 sm:pl-10">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200/70">
                    {selectedTrack.track.title}
                  </span>
                  {selectedTrack.todayFocusSeconds > 0 && (
                    <span className="text-xs text-stone-500">
                      今日已投入{" "}
                      {formatHumanDuration(selectedTrack.todayFocusSeconds)}
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    {selectedTrack.currentNextTask?.title ?? "还没有下一步"}
                  </h3>
                  {selectedTrack.currentNextTask?.description && (
                    <p className="line-clamp-2 max-w-2xl leading-6 text-stone-600">
                      {selectedTrack.currentNextTask.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 text-sm text-stone-500">
                  <Clock className="size-4" aria-hidden="true" />
                  <span>
                    预计{" "}
                    <strong className="font-semibold text-stone-800">
                      {selectedTrack.currentNextTask?.estimatedMinutes ??
                        defaultFocusMinutes}{" "}
                      分钟
                    </strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {activeSession ? (
                  <Button
                    size="lg"
                    nativeButton={false}
                    className="w-full bg-stone-900 text-white hover:bg-stone-700 sm:w-auto"
                    render={<Link href={`/focus/${activeSession.id}`} />}
                  >
                    返回正在进行的专注
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                ) : (
                  <>
                    <Button
                      size="lg"
                      disabled={isPending}
                      onClick={() => handleStartSession(selectedTrack)}
                      className="w-full bg-stone-900 text-white hover:bg-stone-700 sm:w-auto"
                    >
                      <Play
                        className="size-4 fill-current"
                        aria-hidden="true"
                      />
                      {selectedTrack.currentNextTask
                        ? "开始专注"
                        : "开始自由专注"}
                    </Button>

                    {!selectedTrack.currentNextTask && (
                      <Button
                        size="lg"
                        variant="outline"
                        nativeButton={false}
                        className="w-full bg-white sm:w-auto"
                        render={
                          <Link href={`/tracks/${selectedTrack.track.id}`} />
                        }
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        添加任务
                      </Button>
                    )}
                  </>
                )}

                <Button
                  size="lg"
                  variant="ghost"
                  nativeButton={false}
                  className="w-full text-stone-500 hover:bg-stone-100 hover:text-stone-900 sm:w-auto"
                  render={<Link href={`/tracks/${selectedTrack.track.id}`} />}
                >
                  查看推进线详情
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {secondaryTracks.length > 0 && (
        <section aria-labelledby="other-tracks-title" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2
              id="other-tracks-title"
              className="font-mono text-xs tracking-wider text-stone-500 uppercase"
            >
              今天关注
            </h2>
            <span className="text-xs text-stone-500">
              {secondaryTracks.length} 条推进线
            </span>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {secondaryTracks.map((item) => (
              <Card
                key={item.track.id}
                className="group relative border border-stone-200/80 bg-white transition hover:border-stone-300 hover:shadow-xs"
              >
                <CardContent className="flex min-h-44 flex-col justify-between gap-6 p-6">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-stone-500">
                        {item.goal.title} / {item.track.title}
                      </span>
                      {item.todayFocusSeconds > 0 && (
                        <span className="font-mono text-xs text-stone-400">
                          {formatHumanDuration(item.todayFocusSeconds)}
                        </span>
                      )}
                    </div>

                    <h3 className="text-xl font-medium text-stone-900">
                      {item.currentNextTask?.title ?? "暂无待办任务"}
                    </h3>

                    {item.currentNextTask?.estimatedMinutes && (
                      <p className="text-xs text-stone-500">
                        预计 {item.currentNextTask.estimatedMinutes} 分钟
                      </p>
                    )}
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => handleStartSession(item)}
                      className="gap-1.5 text-xs"
                    >
                      <Play className="size-3" aria-hidden="true" />
                      开始
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
