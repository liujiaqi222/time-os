import Link from "next/link";
import {
  Archive,
  ArrowRight,
  CircleCheck,
  Plus,
  RotateCcw,
} from "lucide-react";

import {
  createGoalAction,
  createTrackAction,
  reorderGoalsAction,
  reorderTracksAction,
  updateGoalAction,
  updateTrackAction,
} from "@/app/(app)/planning-actions";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { SortableList } from "@/components/sortable-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { planningService } from "@/services";

const context = { actor: "web" } as const;

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showAll = view === "all";
  const allGoals = await planningService.listGoals(context, {
    includeArchived: true,
    limit: 100,
  });
  const visibleGoals = showAll
    ? allGoals.items
    : allGoals.items.filter((goal) => goal.status === "active");
  const goalsWithTracks = await Promise.all(
    visibleGoals.map(async (goal) => {
      const allTracks = (
        await planningService.listTracks(context, goal.id, {
          includeArchived: true,
          limit: 100,
        })
      ).items;
      return {
        goal,
        allTracks,
        tracks: showAll
          ? allTracks
          : allTracks.filter((track) => track.status === "active"),
      };
    }),
  );

  return (
    <div className="space-y-8">
      <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="space-y-2">
          <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
            Planning
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">Goals</h1>
          <p className="max-w-2xl leading-7 text-stone-600">
            把方向拆成 Track，再为每条推进线保留一个明确的 Current Next。
          </p>
        </div>
        <Button
          nativeButton={false}
          variant="outline"
          render={<Link href={showAll ? "/goals" : "/goals?view=all"} />}
        >
          {showAll ? "只看 Active" : "查看 Completed / Archived"}
        </Button>
      </header>

      <Card className="bg-white/70">
        <CardHeader>
          <CardTitle>新建 Goal</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            action={createGoalAction}
            className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto]"
          >
            <Input
              name="title"
              placeholder="例如：发布 Time OS MVP"
              required
              maxLength={240}
            />
            <Input name="description" placeholder="为什么值得推进（可选）" />
            <Button type="submit">
              <Plus />
              创建
            </Button>
          </form>
        </CardContent>
      </Card>

      {showAll || visibleGoals.length === allGoals.items.length ? (
        <SortableList
          key={goalsWithTracks.map(({ goal }) => goal.id).join(":")}
          label="拖动调整 Goal 顺序"
          items={goalsWithTracks.map(({ goal }) => ({
            id: goal.id,
            label: goal.title,
          }))}
          onReorder={reorderGoalsAction}
        />
      ) : (
        <p className="text-xs text-stone-500">
          要调整完整 Goal 顺序，请先显示 Completed / Archived。
        </p>
      )}

      {goalsWithTracks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-stone-600">
          还没有 Goal。先建立一个值得持续推进的方向。
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
                        {goal.status}
                      </span>
                    </div>
                    {goal.description && (
                      <p className="text-stone-600">{goal.description}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    {goal.status === "active" ? (
                      <>
                        <form action={updateGoalAction}>
                          <input type="hidden" name="id" value={goal.id} />
                          <input
                            type="hidden"
                            name="status"
                            value="completed"
                          />
                          <ConfirmSubmit>
                            <CircleCheck />
                            Complete
                          </ConfirmSubmit>
                        </form>
                        <form action={updateGoalAction}>
                          <input type="hidden" name="id" value={goal.id} />
                          <input type="hidden" name="status" value="archived" />
                          <ConfirmSubmit>
                            <Archive />
                            Archive
                          </ConfirmSubmit>
                        </form>
                      </>
                    ) : (
                      <form action={updateGoalAction}>
                        <input type="hidden" name="id" value={goal.id} />
                        <input type="hidden" name="status" value="active" />
                        <Button size="xs" variant="outline" type="submit">
                          <RotateCcw />
                          Reactivate
                        </Button>
                      </form>
                    )}
                  </div>
                </div>
                <details className="mt-3 text-sm">
                  <summary className="cursor-pointer text-stone-500">
                    编辑 Goal
                  </summary>
                  <form
                    action={updateGoalAction}
                    className="mt-3 grid gap-3 sm:grid-cols-2"
                  >
                    <input type="hidden" name="id" value={goal.id} />
                    <Input name="title" defaultValue={goal.title} required />
                    <Input
                      name="description"
                      defaultValue={goal.description ?? ""}
                      placeholder="描述（可选）"
                    />
                    <Button
                      className="sm:col-span-2 sm:justify-self-start"
                      type="submit"
                      variant="outline"
                    >
                      保存修改
                    </Button>
                  </form>
                </details>
              </CardHeader>
              <CardContent className="space-y-4">
                <form
                  action={createTrackAction}
                  className="grid gap-3 sm:grid-cols-[1fr_1.3fr_auto]"
                >
                  <input type="hidden" name="goalId" value={goal.id} />
                  <Input name="title" placeholder="新 Track" required />
                  <Input name="description" placeholder="推进范围（可选）" />
                  <Button type="submit" variant="secondary">
                    <Plus />
                    添加 Track
                  </Button>
                </form>
                {showAll || tracks.length === allTracks.length ? (
                  <SortableList
                    key={tracks.map((track) => track.id).join(":")}
                    label="拖动调整 Track 顺序"
                    items={tracks.map((track) => ({
                      id: track.id,
                      label: track.title,
                    }))}
                    onReorder={reorderTracksAction.bind(null, goal.id)}
                  />
                ) : (
                  <p className="text-xs text-stone-500">
                    要调整完整 Track 顺序，请先显示 Completed / Archived。
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
                            {track.status}
                          </p>
                        </div>
                        <Button
                          nativeButton={false}
                          size="xs"
                          variant="ghost"
                          render={<Link href={`/tracks/${track.id}`} />}
                        >
                          Open <ArrowRight />
                        </Button>
                      </div>
                      {track.description && (
                        <p className="mt-3 text-sm text-stone-600">
                          {track.description}
                        </p>
                      )}
                      <details className="mt-3 text-xs text-stone-500">
                        <summary className="cursor-pointer">编辑与状态</summary>
                        <form
                          action={updateTrackAction}
                          className="mt-3 space-y-2"
                        >
                          <input type="hidden" name="id" value={track.id} />
                          <Input
                            name="title"
                            defaultValue={track.title}
                            required
                          />
                          <Input
                            name="description"
                            defaultValue={track.description ?? ""}
                          />
                          <Button size="xs" variant="outline" type="submit">
                            保存
                          </Button>
                        </form>
                        <div className="mt-2 flex gap-2">
                          {track.status === "active" ? (
                            <>
                              <form action={updateTrackAction}>
                                <input
                                  type="hidden"
                                  name="id"
                                  value={track.id}
                                />
                                <input
                                  type="hidden"
                                  name="status"
                                  value="completed"
                                />
                                <ConfirmSubmit>Complete</ConfirmSubmit>
                              </form>
                              <form action={updateTrackAction}>
                                <input
                                  type="hidden"
                                  name="id"
                                  value={track.id}
                                />
                                <input
                                  type="hidden"
                                  name="status"
                                  value="archived"
                                />
                                <ConfirmSubmit>Archive</ConfirmSubmit>
                              </form>
                            </>
                          ) : (
                            <form action={updateTrackAction}>
                              <input type="hidden" name="id" value={track.id} />
                              <input
                                type="hidden"
                                name="status"
                                value="active"
                              />
                              <Button size="xs" variant="outline" type="submit">
                                Reactivate
                              </Button>
                            </form>
                          )}
                        </div>
                      </details>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
