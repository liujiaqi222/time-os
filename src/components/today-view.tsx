"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ArrowRight,
  Bookmark,
  CheckCircle2,
  Clock,
  Flame,
  Play,
  Plus,
  Sparkles,
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
            trackTitle: "当前专注时刻",
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
            今日聚焦
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            开启今日专注
          </h1>
        </header>

        <Card className="border-dashed border-stone-300 bg-white/50 shadow-none">
          <CardContent className="flex min-h-72 flex-col items-start justify-center gap-5 p-8 sm:p-12">
            <span className="grid size-12 place-items-center rounded-full bg-stone-900 text-stone-50">
              <TimerReset aria-hidden="true" />
            </span>
            <div className="max-w-xl space-y-2">
              <h2 className="text-2xl font-medium">还没有进行中的推进线</h2>
              <p className="leading-7 text-stone-600">
                设定你的长期目标与推进线，Time OS
                会将最关键的“当前下一步”带到这里，助你随时开启心流。
              </p>
            </div>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/goals" />}
            >
              前往规划路线 <ArrowRight aria-hidden="true" />
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
      <header className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="space-y-2">
          <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
            今日聚焦
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">专注与执行</h1>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <div className="flex items-center gap-2 rounded-full border border-stone-200/80 bg-white/70 px-3.5 py-1.5 shadow-2xs">
            <Clock className="size-4 text-stone-400" aria-hidden="true" />
            <span className="text-stone-500">今日专注</span>
            <span className="font-semibold text-stone-900">
              {formatHumanDuration(todayStats.totalFocusSeconds)}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-stone-200/80 bg-white/70 px-3.5 py-1.5 shadow-2xs">
            <CheckCircle2
              className="size-4 text-emerald-600"
              aria-hidden="true"
            />
            <span className="text-stone-500">已达成行动</span>
            <span className="font-semibold text-stone-900">
              {todayStats.completedTasksCount}
            </span>
          </div>

          <div className="flex items-center gap-2 rounded-full border border-stone-200/80 bg-white/70 px-3.5 py-1.5 shadow-2xs">
            <Flame className="size-4 text-amber-500" aria-hidden="true" />
            <span className="text-stone-500">专注心流</span>
            <span className="font-semibold text-stone-900">
              {todayStats.sessionCount} 次
            </span>
          </div>
        </div>
      </header>

      {activeSessionAlert && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">已有正在进行的专注时刻</p>
              <p className="text-sm text-amber-700">
                当前专注时段仍在计时中，请先继续完成或结束它。
              </p>
            </div>
            <Button
              size="sm"
              nativeButton={false}
              render={<Link href={`/focus/${activeSessionAlert.sessionId}`} />}
            >
              返回当前专注
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
        <section aria-labelledby="primary-focus-title">
          <div className="mb-3 flex items-center justify-between">
            <h2
              id="primary-focus-title"
              className="font-mono text-xs tracking-wider text-stone-500 uppercase"
            >
              当前核心焦点
            </h2>
            <span className="text-xs text-stone-500">
              长期目标：{selectedTrack.goal.title}
            </span>
          </div>

          <Card className="relative overflow-hidden border border-stone-200/90 bg-white/90 shadow-[0_18px_55px_rgba(41,37,36,0.08)]">
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-1.5 bg-amber-400"
            />
            <CardContent className="flex flex-col justify-between gap-6 py-5 pr-6 pl-7 sm:py-6 sm:pr-10 sm:pl-10">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900 ring-1 ring-amber-200/70">
                    推进线：{selectedTrack.track.title}
                  </span>
                  {selectedTrack.todayFocusSeconds > 0 && (
                    <span className="text-xs text-stone-500">
                      今日已投入{" "}
                      {formatHumanDuration(selectedTrack.todayFocusSeconds)}
                    </span>
                  )}
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs text-stone-400">
                    <Sparkles className="size-3.5 text-amber-500" />
                    <span>即刻行动（当前下一步）</span>
                  </div>
                  <h3 className="text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">
                    {selectedTrack.currentNextTask?.title ??
                      "尚未设定当前下一步行动"}
                  </h3>
                  {selectedTrack.currentNextTask?.description && (
                    <p className="line-clamp-2 max-w-2xl leading-6 text-stone-600">
                      {selectedTrack.currentNextTask.description}
                    </p>
                  )}
                </div>

                {/* Handover note from previous session (Compass philosophy: "我上次做到哪里了？") */}
                {selectedTrack.lastSessionNote ? (
                  <div className="rounded-xl border border-amber-200/90 bg-amber-50/70 p-4 text-sm text-stone-800">
                    <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-900">
                      <Bookmark
                        className="size-3.5 text-amber-600"
                        aria-hidden="true"
                      />
                      <span>📌 上次推进交接笔记</span>
                    </div>
                    <p className="leading-relaxed text-stone-700 italic">
                      “{selectedTrack.lastSessionNote}”
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-stone-200/70 bg-stone-50/60 p-3 text-xs text-stone-500">
                    💡
                    暂无上次交接笔记。完成本次专注时写下一句思考，下次将在这里为你引路。
                  </div>
                )}

                <div className="flex items-center gap-2 text-sm text-stone-500">
                  <Clock className="size-4" aria-hidden="true" />
                  <span>
                    预计投入时长{" "}
                    <strong className="font-semibold text-stone-800">
                      {selectedTrack.currentNextTask?.estimatedMinutes ??
                        defaultFocusMinutes}{" "}
                      分钟
                    </strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-stretch gap-2.5 pt-2 sm:flex-row sm:flex-wrap sm:items-center">
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
                      className="w-full bg-stone-900 text-white shadow-sm hover:bg-stone-700 sm:w-auto"
                    >
                      <Play
                        className="size-4 fill-current"
                        aria-hidden="true"
                      />
                      {selectedTrack.currentNextTask
                        ? `开始专注 (${selectedTrack.currentNextTask.estimatedMinutes ?? defaultFocusMinutes} 分钟)`
                        : "开始自由专注"}
                    </Button>

                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleStartSession(selectedTrack, 25)}
                        className="bg-white text-xs text-stone-600"
                        title="以番茄钟 25 分钟开始"
                      >
                        25m
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => handleStartSession(selectedTrack, 45)}
                        className="bg-white text-xs text-stone-600"
                        title="以深度专注 45 分钟开始"
                      >
                        45m
                      </Button>
                    </div>

                    {!selectedTrack.currentNextTask && (
                      <Button
                        size="lg"
                        variant="outline"
                        nativeButton={false}
                        className="w-full bg-white sm:w-auto"
                        render={
                          <Link
                            href={`/goals?trackId=${selectedTrack.track.id}`}
                          />
                        }
                      >
                        <Plus className="size-4" aria-hidden="true" />
                        添加行动项
                      </Button>
                    )}
                  </>
                )}

                <Button
                  size="lg"
                  variant="ghost"
                  nativeButton={false}
                  className="w-full text-stone-500 hover:bg-stone-100 hover:text-stone-900 sm:w-auto"
                  render={
                    <Link href={`/goals?trackId=${selectedTrack.track.id}`} />
                  }
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
              其他并行推进线
            </h2>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {secondaryTracks.map((item) => (
              <Card
                key={item.track.id}
                className="group relative border border-stone-200/80 bg-white transition hover:border-stone-300 hover:shadow-xs"
              >
                <CardContent className="flex min-h-48 flex-col justify-between gap-5 p-6">
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-stone-500">
                        {item.goal.title} · {item.track.title}
                      </span>
                      {item.todayFocusSeconds > 0 && (
                        <span className="font-mono text-xs text-stone-400">
                          已专注 {formatHumanDuration(item.todayFocusSeconds)}
                        </span>
                      )}
                    </div>

                    <h3 className="text-xl font-medium text-stone-900">
                      {item.currentNextTask?.title ?? "暂无待办行动"}
                    </h3>

                    {item.lastSessionNote ? (
                      <p className="line-clamp-1 text-xs text-stone-500 italic">
                        上次交接：{item.lastSessionNote}
                      </p>
                    ) : item.currentNextTask?.estimatedMinutes ? (
                      <p className="text-xs text-stone-500">
                        预计 {item.currentNextTask.estimatedMinutes} 分钟
                      </p>
                    ) : null}
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
                      设为主焦点
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={() => handleStartSession(item)}
                      className="gap-1.5 bg-white text-xs"
                    >
                      <Play className="size-3" aria-hidden="true" />
                      即刻起跑
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
