import Link from "next/link";
import { ArrowRight, Plus, RotateCcw } from "lucide-react";

import {
  createGoalAction,
  createTrackAction,
  reorderGoalsAction,
  reorderTracksAction,
  updateGoalAction,
  updateTrackAction,
} from "@/app/(app)/planning-actions";
import { PlanningStatusAction } from "@/components/planning-status-action";
import { SortableList } from "@/components/sortable-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { planningService, sessionService } from "@/services";

const context = { actor: "web" } as const;
const statusLabel = {
  active: "进行中",
  completed: "已完成",
  archived: "已归档",
} as const;

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showAll = view === "all";
  const [allGoals, activeSession] = await Promise.all([
    planningService.listGoals(context, {
      includeArchived: true,
      limit: 100,
    }),
    sessionService.getActiveSession(context),
  ]);
  const visibleGoals = showAll
    ? allGoals.items
    : allGoals.items.filter((goal) => goal.status === "active");
  // One batched query for every visible goal instead of one query per goal.
  const tracksByGoal = await planningService.listTracksForGoals(
    context,
    visibleGoals.map((goal) => goal.id),
    { includeArchived: true, limit: 100 },
  );
  const goalsWithTracks = visibleGoals.map((goal) => {
    const allTracks = tracksByGoal.get(goal.id)?.items ?? [];
    return {
      goal,
      allTracks,
      tracks: showAll
        ? allTracks
        : allTracks.filter((track) => track.status === "active"),
    };
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
            规划路线
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">
            目标与推进路线
          </h1>
          <p className="max-w-2xl leading-7 text-stone-600">
            把长远方向拆解为具体的推进线，为每条推进线保留一个明确的“当前下一步”。
          </p>
        </div>
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link href={showAll ? "/goals" : "/goals?view=all"} />}
        >
          {showAll ? "只看进行中" : "查看已完成与已归档"}
        </Button>
      </header>

      <details className="group rounded-2xl border border-stone-200 bg-white/70">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 font-medium text-stone-800">
          <span>新建长期目标</span>
          <span className="text-sm font-normal text-stone-500 group-open:hidden">
            添加一个长期方向
          </span>
          <span className="hidden text-sm font-normal text-stone-500 group-open:inline">
            收起
          </span>
        </summary>
        <div className="border-t border-stone-200 p-5">
          <form action={createGoalAction} className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="new-goal-title">长期目标名称</Label>
              <Input
                id="new-goal-title"
                name="title"
                placeholder="例如：发布 Time OS 个人执行系统"
                required
                maxLength={240}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-goal-description">为什么值得推进</Label>
              <Input
                id="new-goal-description"
                name="description"
                placeholder="可选：愿景、动机或验收指标"
              />
            </div>
            <Button
              type="submit"
              className="sm:col-span-2 sm:justify-self-start"
            >
              <Plus />
              创建长期目标
            </Button>
          </form>
        </div>
      </details>

      {showAll || visibleGoals.length === allGoals.items.length ? (
        <SortableList
          key={goalsWithTracks.map(({ goal }) => goal.id).join(":")}
          label="拖动调整长期目标顺序"
          items={goalsWithTracks.map(({ goal }) => ({
            id: goal.id,
            label: goal.title,
          }))}
          onReorder={reorderGoalsAction}
        />
      ) : (
        <p className="text-xs text-stone-500">
          要调整完整目标顺序，请先显示已完成与已归档项目。
        </p>
      )}

      {goalsWithTracks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-stone-600">
          还没有长期目标。先建立一个值得持续推进的方向。
        </div>
      ) : (
        <div className="space-y-6">
          {goalsWithTracks.map(({ goal, tracks, allTracks }) => (
            <Card
              key={goal.id}
              className={
                goal.status === "active"
                  ? "bg-white"
                  : "bg-stone-100/70 text-stone-600"
              }
            >
              <CardHeader className="border-b">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-xl">{goal.title}</CardTitle>
                      <span className="rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[10px] uppercase">
                        {statusLabel[goal.status]}
                      </span>
                    </div>
                    {goal.description && (
                      <p className="text-stone-600">{goal.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {goal.status === "active" ? (
                      <>
                        <PlanningStatusAction
                          entityType="goal"
                          entityId={goal.id}
                          entityTitle={goal.title}
                          status="completed"
                          blockingSession={
                            activeSession?.track.goalId === goal.id
                              ? {
                                  id: activeSession.id,
                                  trackTitle: activeSession.track.title,
                                  status: activeSession.status as
                                    "active" | "paused",
                                }
                              : null
                          }
                        />
                        <PlanningStatusAction
                          entityType="goal"
                          entityId={goal.id}
                          entityTitle={goal.title}
                          status="archived"
                          blockingSession={
                            activeSession?.track.goalId === goal.id
                              ? {
                                  id: activeSession.id,
                                  trackTitle: activeSession.track.title,
                                  status: activeSession.status as
                                    "active" | "paused",
                                }
                              : null
                          }
                        />
                      </>
                    ) : (
                      <form action={updateGoalAction}>
                        <input type="hidden" name="id" value={goal.id} />
                        <input type="hidden" name="status" value="active" />
                        <Button size="xs" variant="outline" type="submit">
                          <RotateCcw />
                          重新启用
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
                {goal.status === "active" && (
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-stone-500">
                      编辑目标
                    </summary>
                    <form
                      action={updateGoalAction}
                      className="mt-3 grid gap-3 sm:grid-cols-2"
                    >
                      <input type="hidden" name="id" value={goal.id} />
                      <div className="space-y-2">
                        <Label htmlFor={`goal-title-${goal.id}`}>
                          长期目标名称
                        </Label>
                        <Input
                          id={`goal-title-${goal.id}`}
                          name="title"
                          defaultValue={goal.title}
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`goal-description-${goal.id}`}>
                          描述
                        </Label>
                        <Input
                          id={`goal-description-${goal.id}`}
                          name="description"
                          defaultValue={goal.description ?? ""}
                          placeholder="可选"
                        />
                      </div>
                      <Button
                        className="sm:col-span-2 sm:justify-self-start"
                        type="submit"
                        variant="outline"
                      >
                        保存修改
                      </Button>
                    </form>
                  </details>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                {goal.status !== "active" ? (
                  <p className="rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-600">
                    这个目标已{goal.status === "completed" ? "完成" : "归档"}
                    。重新启用后才能调整其中的推进线。
                  </p>
                ) : showAll || tracks.length === allTracks.length ? (
                  <SortableList
                    key={tracks.map((track) => track.id).join(":")}
                    label="拖动调整推进线顺序"
                    items={tracks.map((track) => ({
                      id: track.id,
                      label: track.title,
                    }))}
                    onReorder={reorderTracksAction.bind(null, goal.id)}
                  />
                ) : (
                  <p className="text-xs text-stone-500">
                    要调整完整推进线顺序，请先显示已完成与已归档项目。
                  </p>
                )}
                <div className="grid gap-3 md:grid-cols-2">
                  {tracks.map((track) => (
                    <div
                      key={track.id}
                      className="rounded-xl border border-stone-200 bg-[#faf9f5] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Link
                            href={`/tracks/${track.id}`}
                            className="font-medium hover:underline"
                          >
                            {track.title}
                          </Link>
                          <p className="mt-1 font-mono text-xs text-stone-500 uppercase">
                            {statusLabel[track.status]}
                          </p>
                        </div>
                        <Button
                          nativeButton={false}
                          size="xs"
                          variant="ghost"
                          render={<Link href={`/tracks/${track.id}`} />}
                        >
                          进入推进线 <ArrowRight />
                        </Button>
                      </div>
                      {track.description && (
                        <p className="mt-3 text-sm text-stone-600">
                          {track.description}
                        </p>
                      )}
                      {goal.status === "active" && (
                        <details className="mt-3 text-xs text-stone-500">
                          <summary className="cursor-pointer">
                            {track.status === "active" ? "编辑推进线" : "状态"}
                          </summary>
                          {track.status === "active" && (
                            <form
                              action={updateTrackAction}
                              className="mt-3 grid gap-3 sm:grid-cols-2"
                            >
                              <input type="hidden" name="id" value={track.id} />
                              <div className="space-y-2">
                                <Label htmlFor={`track-title-${track.id}`}>
                                  推进线名称
                                </Label>
                                <Input
                                  id={`track-title-${track.id}`}
                                  name="title"
                                  defaultValue={track.title}
                                  required
                                />
                              </div>
                              <div className="space-y-2">
                                <Label
                                  htmlFor={`track-description-${track.id}`}
                                >
                                  推进范围
                                </Label>
                                <Input
                                  id={`track-description-${track.id}`}
                                  name="description"
                                  defaultValue={track.description ?? ""}
                                  placeholder="可选"
                                />
                              </div>
                              <Button
                                size="xs"
                                variant="outline"
                                type="submit"
                                className="sm:col-span-2 sm:justify-self-start"
                              >
                                保存
                              </Button>
                            </form>
                          )}
                          <div className="mt-2 flex gap-2">
                            {track.status === "active" ? (
                              <>
                                <PlanningStatusAction
                                  entityType="track"
                                  entityId={track.id}
                                  entityTitle={track.title}
                                  status="completed"
                                  blockingSession={
                                    activeSession?.trackId === track.id
                                      ? {
                                          id: activeSession.id,
                                          trackTitle: activeSession.track.title,
                                          status: activeSession.status as
                                            "active" | "paused",
                                        }
                                      : null
                                  }
                                />
                                <PlanningStatusAction
                                  entityType="track"
                                  entityId={track.id}
                                  entityTitle={track.title}
                                  status="archived"
                                  blockingSession={
                                    activeSession?.trackId === track.id
                                      ? {
                                          id: activeSession.id,
                                          trackTitle: activeSession.track.title,
                                          status: activeSession.status as
                                            "active" | "paused",
                                        }
                                      : null
                                  }
                                />
                              </>
                            ) : (
                              <form action={updateTrackAction}>
                                <input
                                  type="hidden"
                                  name="id"
                                  value={track.id}
                                />
                                <input
                                  type="hidden"
                                  name="status"
                                  value="active"
                                />
                                <Button
                                  size="xs"
                                  variant="outline"
                                  type="submit"
                                >
                                  重新启用
                                </Button>
                              </form>
                            )}
                          </div>
                        </details>
                      )}
                    </div>
                  ))}
                </div>
                {goal.status === "active" && (
                  <details className="rounded-xl border border-dashed border-stone-300 bg-stone-50/60">
                    <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-stone-700">
                      ＋ 添加推进线
                    </summary>
                    <form
                      action={createTrackAction}
                      className="grid gap-4 border-t border-stone-200 p-4 sm:grid-cols-2"
                    >
                      <input type="hidden" name="goalId" value={goal.id} />
                      <div className="space-y-2">
                        <Label htmlFor={`new-track-title-${goal.id}`}>
                          推进线名称
                        </Label>
                        <Input
                          id={`new-track-title-${goal.id}`}
                          name="title"
                          placeholder="例如：打磨 Web 核心流程"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`new-track-description-${goal.id}`}>
                          推进范围
                        </Label>
                        <Input
                          id={`new-track-description-${goal.id}`}
                          name="description"
                          placeholder="可选"
                        />
                      </div>
                      <Button
                        type="submit"
                        variant="secondary"
                        className="sm:col-span-2 sm:justify-self-start"
                      >
                        <Plus />
                        创建推进线
                      </Button>
                    </form>
                  </details>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
