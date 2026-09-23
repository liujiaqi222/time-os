"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Flame,
  Play,
  Plus,
  Star,
  TimerReset,
} from "lucide-react";

import {
  setSelectedTrackAction,
  startSessionAction,
} from "@/app/(app)/session-actions";
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
            trackTitle: "Current Session",
          });
        } else {
          setErrorMsg(`${result.error.code}: ${result.error.message}`);
        }
        return;
      }

      router.push(`/focus/${result.data.id}`);
    });
  };

  const handleSetSelectedTrack = (trackId: string) => {
    startTransition(async () => {
      await setSelectedTrackAction(trackId);
      router.refresh();
    });
  };

  if (activeTracks.length === 0) {
    return (
      <div className="space-y-10">
        <header className="space-y-2">
          <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
            Today
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
              <h2 className="text-2xl font-medium">还没有可执行的 Track</h2>
              <p className="leading-7 text-stone-600">
                先建立 Goal、Track 与 Task，Time OS
                会把每条推进线的下一步带到这里。
              </p>
            </div>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/goals" />}
            >
              从 Goals 开始 <ArrowRight aria-hidden="true" />
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
      {/* Header & Today Stats */}
      <header className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="space-y-2">
          <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
            Today
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">专注与执行</h1>
        </div>

        {/* Stats Row */}
        <div className="flex flex-wrap gap-4 font-mono text-sm">
          <div className="flex items-center gap-2 rounded-lg border border-stone-200/80 bg-white/80 px-3.5 py-2 shadow-xs">
            <Clock className="size-4 text-stone-400" aria-hidden="true" />
            <span className="text-stone-500">今日专注:</span>
            <span className="font-semibold text-stone-900">
              {formatHumanDuration(todayStats.totalFocusSeconds)}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-stone-200/80 bg-white/80 px-3.5 py-2 shadow-xs">
            <CheckCircle2
              className="size-4 text-emerald-600"
              aria-hidden="true"
            />
            <span className="text-stone-500">已完成:</span>
            <span className="font-semibold text-stone-900">
              {todayStats.completedTasksCount}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-stone-200/80 bg-white/80 px-3.5 py-2 shadow-xs">
            <Flame className="size-4 text-amber-500" aria-hidden="true" />
            <span className="text-stone-500">Session:</span>
            <span className="font-semibold text-stone-900">
              {todayStats.sessionCount}
            </span>
          </div>
        </div>
      </header>

      {/* Active Session Alert when attempting to start another */}
      {activeSessionAlert && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">已有正在运行的 Focus Session</p>
              <p className="text-sm text-amber-700">
                当前正在进行中的专注尚未结束，请先完成或取消当前 Session。
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

      {/* Primary Focus Card (Current Focus) */}
      {selectedTrack && (
        <section aria-labelledby="primary-focus-title">
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="primary-focus-title"
              className="font-mono text-xs tracking-wider text-stone-500 uppercase"
            >
              Current Focus
            </h2>
            <span className="text-xs text-stone-500">
              {selectedTrack.goal.title}
            </span>
          </div>

          <Card className="relative overflow-hidden border-2 border-stone-900 bg-stone-900 text-stone-50 shadow-xl">
            <CardContent className="flex flex-col justify-between gap-8 p-8 sm:p-10">
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-stone-800 px-2.5 py-1 font-mono text-xs text-stone-300">
                    {selectedTrack.track.title}
                  </span>
                  {selectedTrack.todayFocusSeconds > 0 && (
                    <span className="text-xs text-stone-400">
                      今日已投入{" "}
                      {formatHumanDuration(selectedTrack.todayFocusSeconds)}
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    {selectedTrack.currentNextTask?.title ??
                      "尚未设置 Current Next"}
                  </h3>
                  {selectedTrack.currentNextTask?.description && (
                    <p className="line-clamp-2 max-w-2xl text-stone-400">
                      {selectedTrack.currentNextTask.description}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3 text-sm text-stone-400">
                  <Clock className="size-4" aria-hidden="true" />
                  <span>
                    预计时长:{" "}
                    <strong className="font-semibold text-stone-200">
                      {selectedTrack.currentNextTask?.estimatedMinutes ??
                        defaultFocusMinutes}{" "}
                      分钟
                    </strong>
                  </span>
                </div>
              </div>

              {/* Primary Action Button */}
              <div className="flex flex-wrap items-center gap-4">
                {activeSession ? (
                  <Button
                    size="lg"
                    nativeButton={false}
                    className="bg-white text-stone-950 hover:bg-stone-100"
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
                      className="bg-white text-stone-950 hover:bg-stone-100"
                    >
                      <Play
                        className="size-4 fill-current"
                        aria-hidden="true"
                      />
                      {selectedTrack.currentNextTask
                        ? "开始专注 (Start Focus)"
                        : "开始无结构专注 (Start unstructured focus)"}
                    </Button>

                    {!selectedTrack.currentNextTask && (
                      <Button
                        size="lg"
                        variant="outline"
                        nativeButton={false}
                        className="border-stone-700 bg-transparent text-stone-300 hover:bg-stone-800 hover:text-white"
                        render={
                          <Link href={`/tracks/${selectedTrack.track.id}`} />
                        }
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        添加待办 (Add task)
                      </Button>
                    )}
                  </>
                )}

                <Button
                  size="lg"
                  variant="ghost"
                  nativeButton={false}
                  className="text-stone-400 hover:bg-stone-800 hover:text-stone-200"
                  render={<Link href={`/tracks/${selectedTrack.track.id}`} />}
                >
                  查看 Track 详情
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {/* Secondary Tracks */}
      {secondaryTracks.length > 0 && (
        <section aria-labelledby="other-tracks-title" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2
              id="other-tracks-title"
              className="font-mono text-xs tracking-wider text-stone-500 uppercase"
            >
              Other Active Tracks
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {secondaryTracks.map((item) => (
              <Card
                key={item.track.id}
                className="group relative border border-stone-200/80 bg-white transition hover:border-stone-300 hover:shadow-xs"
              >
                <CardContent className="flex min-h-48 flex-col justify-between gap-6 p-6">
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

                  <div className="flex items-center justify-between gap-3 pt-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleSetSelectedTrack(item.track.id)}
                      className="gap-1.5 text-xs text-stone-600 hover:text-stone-900"
                    >
                      <Star className="size-3.5" aria-hidden="true" />
                      设为当前焦点
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => handleStartSession(item)}
                      className="gap-1.5 text-xs"
                    >
                      <Play className="size-3" aria-hidden="true" />
                      直接开始
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
