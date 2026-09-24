import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Flag,
  Plus,
  RotateCcw,
  SkipForward,
  Star,
} from "lucide-react";

import {
  createTasksAction,
  reorderTasksAction,
  setNextAction,
  transitionTaskAction,
  updateTaskAction,
} from "@/app/(app)/planning-actions";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { SortableList } from "@/components/sortable-list";
import { TrackFocusCard } from "@/components/track-focus-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { planningService, sessionService, settingsService } from "@/services";
import { goalTrackStatusLabel, taskStatusLabel } from "@/shared/labels";

const context = { actor: "web" } as const;
const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const selectClass =
  "h-8 w-full rounded-lg border border-input bg-white px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

export default async function TrackPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
  const showArchived = view === "all";
  const trackPromise = planningService.getTrack(context, id);
  // Independent reads — run in parallel.
  const [track, goal, allTasks, settings, activeSession] = await Promise.all([
    trackPromise,
    trackPromise.then((item) => planningService.getGoal(context, item.goalId)),
    planningService
      .listTasks(context, id, {
        includeArchived: true,
        limit: 100,
      })
      .then((page) => page.items),
    settingsService.get(context),
    sessionService.getActiveSession(context),
  ]);
  const visibleTasks = showArchived
    ? allTasks
    : allTasks.filter((task) => task.status !== "archived");
  const current = track.currentTaskId
    ? (allTasks.find((task) => task.id === track.currentTaskId) ?? null)
    : null;
  const canReorderVisible =
    showArchived || visibleTasks.length === allTasks.length;
  const canEdit = goal.status === "active" && track.status === "active";

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <Button
          nativeButton={false}
          size="sm"
          variant="ghost"
          render={<Link href="/goals" />}
        >
          <ArrowLeft />
          返回计划
        </Button>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
                推进线 · {goalTrackStatusLabel[track.status]}
              </p>
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">
              {track.title}
            </h1>
            {track.description && (
              <p className="max-w-2xl leading-7 text-stone-600">
                {track.description}
              </p>
            )}
          </div>
          <Button
            nativeButton={false}
            variant="outline"
            render={
              <Link
                href={showArchived ? `/tracks/${id}` : `/tracks/${id}?view=all`}
              />
            }
          >
            {showArchived ? "隐藏已归档" : "查看已归档"}
          </Button>
        </div>
      </header>

      {canEdit ? (
        <TrackFocusCard
          trackId={track.id}
          current={current}
          taskCount={allTasks.length}
          defaultFocusMinutes={settings.defaultFocusMinutes}
          activeSessionId={activeSession?.id ?? null}
        />
      ) : (
        <div className="rounded-2xl border border-stone-200 bg-stone-100/70 p-5 text-sm text-stone-600">
          <p className="font-medium text-stone-800">当前为只读状态</p>
          <p className="mt-1">
            {goal.status !== "active"
              ? `所属目标「${goal.title}」已${goal.status === "completed" ? "完成" : "归档"}`
              : `这个推进线已${track.status === "completed" ? "完成" : "归档"}`}
            ，请先在计划页面重新启用，再修改任务或开始专注。
          </p>
        </div>
      )}

      {canEdit && canReorderVisible ? (
        <SortableList
          key={visibleTasks.map((task) => task.id).join(":")}
          label="调整任务顺序（不会改变下一步）"
          items={visibleTasks.map((task) => ({
            id: task.id,
            label: task.title,
          }))}
          onReorder={reorderTasksAction.bind(null, track.id)}
        />
      ) : canEdit ? (
        <p className="text-xs text-stone-500">
          要调整完整顺序，请先显示已归档任务。
        </p>
      ) : null}

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-xs tracking-[0.16em] text-stone-500 uppercase">
              任务列表
            </p>
            <h2 className="text-2xl font-semibold">全部步骤</h2>
          </div>
          <span className="text-sm text-stone-500">
            {visibleTasks.length} 项
          </span>
        </div>
        {visibleTasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-stone-600">
            这里还没有任务。
          </div>
        ) : (
          visibleTasks.map((task) => {
            const isNext = task.id === track.currentTaskId;
            return (
              <Card
                key={task.id}
                className={isNext ? "border-stone-900 bg-white" : "bg-white/75"}
              >
                <CardContent className="space-y-4 pt-1">
                  <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-stone-400">
                          {String(task.position).padStart(2, "0")}
                        </span>
                        <h3
                          className={
                            task.status === "pending"
                              ? "font-medium"
                              : "font-medium text-stone-500 line-through"
                          }
                        >
                          {task.title}
                        </h3>
                        {isNext && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-stone-900 px-2 py-0.5 text-[10px] font-semibold text-white uppercase">
                            <Star className="size-3" />
                            下一步
                          </span>
                        )}
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[10px] text-stone-500 uppercase">
                          {taskStatusLabel[task.status]}
                        </span>
                      </div>
                      {task.description && (
                        <p className="text-sm text-stone-600">
                          {task.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-3 text-xs text-stone-500">
                        {task.estimatedMinutes && (
                          <span>{task.estimatedMinutes} 分钟</span>
                        )}
                        {task.note && <span>备注：{task.note}</span>}
                        {task.resourceType === "url" && task.resourceValue && (
                          <a
                            href={task.resourceValue}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline"
                          >
                            打开资源 <ExternalLink className="size-3" />
                          </a>
                        )}
                        {task.resourceType === "text" && task.resourceValue && (
                          <span>资源：{task.resourceValue}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canEdit &&
                        (task.status === "pending" ? (
                          <>
                            {!isNext && (
                              <form action={setNextAction}>
                                <input
                                  type="hidden"
                                  name="trackId"
                                  value={track.id}
                                />
                                <input
                                  type="hidden"
                                  name="taskId"
                                  value={task.id}
                                />
                                <Button
                                  type="submit"
                                  size="xs"
                                  variant="outline"
                                >
                                  <Flag />
                                  设为下一步
                                </Button>
                              </form>
                            )}
                            <form action={transitionTaskAction}>
                              <input type="hidden" name="id" value={task.id} />
                              <input
                                type="hidden"
                                name="transition"
                                value="complete"
                              />
                              <Button type="submit" size="xs" variant="outline">
                                <Check />
                                完成
                              </Button>
                            </form>
                            <form action={transitionTaskAction}>
                              <input type="hidden" name="id" value={task.id} />
                              <input
                                type="hidden"
                                name="transition"
                                value="skip"
                              />
                              <ConfirmSubmit
                                title={`跳过「${task.title}」？`}
                                description="跳过后会保留这条任务记录；如果它是下一步，将自动推进到下一个待办任务。"
                                confirmLabel="确认跳过"
                              >
                                <SkipForward />
                                跳过
                              </ConfirmSubmit>
                            </form>
                            <form action={transitionTaskAction}>
                              <input type="hidden" name="id" value={task.id} />
                              <input
                                type="hidden"
                                name="transition"
                                value="archive"
                              />
                              <ConfirmSubmit
                                title={`归档「${task.title}」？`}
                                description="归档后任务会从默认列表中收起；内容不会被删除，之后仍可重新打开。"
                                confirmLabel="确认归档"
                              >
                                归档
                              </ConfirmSubmit>
                            </form>
                          </>
                        ) : (
                          <form action={transitionTaskAction}>
                            <input type="hidden" name="id" value={task.id} />
                            <input
                              type="hidden"
                              name="transition"
                              value="reopen"
                            />
                            <Button type="submit" size="xs" variant="outline">
                              <RotateCcw />
                              重新打开
                            </Button>
                          </form>
                        ))}
                    </div>
                  </div>
                  {canEdit && task.status === "pending" && (
                    <details className="text-sm text-stone-500">
                      <summary className="cursor-pointer">编辑任务</summary>
                      <form
                        action={updateTaskAction}
                        className="mt-3 grid gap-3 sm:grid-cols-2"
                      >
                        <input type="hidden" name="id" value={task.id} />
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor={`edit-${task.id}-title`}>
                            任务名称
                          </Label>
                          <Input
                            id={`edit-${task.id}-title`}
                            name="title"
                            defaultValue={task.title}
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`edit-${task.id}-description`}>
                            描述
                          </Label>
                          <Input
                            id={`edit-${task.id}-description`}
                            name="description"
                            defaultValue={task.description ?? ""}
                            placeholder="可选"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`edit-${task.id}-minutes`}>
                            预计分钟
                          </Label>
                          <Input
                            id={`edit-${task.id}-minutes`}
                            name="estimatedMinutes"
                            defaultValue={task.estimatedMinutes ?? ""}
                            type="number"
                            min="1"
                            placeholder="可选"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`edit-${task.id}-resource-type`}>
                            资源类型
                          </Label>
                          <select
                            id={`edit-${task.id}-resource-type`}
                            name="resourceType"
                            className={selectClass}
                            defaultValue={task.resourceType ?? ""}
                          >
                            <option value="">无资源</option>
                            <option value="url">链接</option>
                            <option value="text">文字</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`edit-${task.id}-resource`}>
                            资源内容
                          </Label>
                          <Input
                            id={`edit-${task.id}-resource`}
                            name="resourceValue"
                            defaultValue={task.resourceValue ?? ""}
                            placeholder="链接或文字"
                          />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor={`edit-${task.id}-note`}>备注</Label>
                          <Input
                            id={`edit-${task.id}-note`}
                            name="note"
                            defaultValue={task.note ?? ""}
                            placeholder="可选"
                          />
                        </div>
                        <Button
                          type="submit"
                          variant="outline"
                          className="sm:justify-self-start"
                        >
                          保存修改
                        </Button>
                      </form>
                    </details>
                  )}
                </CardContent>
              </Card>
            );
          })
        )}
      </section>

      {canEdit && (
        <section className="space-y-3" aria-labelledby="add-task-title">
          <div>
            <p className="font-mono text-xs tracking-[0.16em] text-stone-500 uppercase">
              计划工具
            </p>
            <h2 id="add-task-title" className="text-2xl font-semibold">
              添加任务
            </h2>
            <p className="mt-1 text-sm text-stone-500">
              需要规划时再展开，不打断当前的执行节奏。
            </p>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <details className="group rounded-xl border border-stone-200 bg-white/70">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium marker:content-none">
                添加一个任务
                <Plus className="size-4 text-stone-500 transition-transform group-open:rotate-45" />
              </summary>
              <form
                action={createTasksAction}
                className="space-y-4 border-t border-stone-200 px-5 py-5"
              >
                <input type="hidden" name="trackId" value={track.id} />
                <div className="space-y-2">
                  <Label htmlFor="new-task-title">任务名称</Label>
                  <Input
                    id="new-task-title"
                    name="title"
                    placeholder="例如：整理 Issue 验收标准"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-task-description">完成标准或上下文</Label>
                  <textarea
                    id="new-task-description"
                    name="description"
                    className={textareaClass}
                    placeholder="可选"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="new-task-minutes">预计分钟</Label>
                    <Input
                      id="new-task-minutes"
                      name="estimatedMinutes"
                      type="number"
                      min="1"
                      placeholder="例如：25"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-task-resource-type">资源类型</Label>
                    <select
                      id="new-task-resource-type"
                      name="resourceType"
                      className={selectClass}
                      defaultValue=""
                    >
                      <option value="">无资源</option>
                      <option value="url">链接</option>
                      <option value="text">文字</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-task-resource">资源内容</Label>
                  <Input
                    id="new-task-resource"
                    name="resourceValue"
                    placeholder="链接或文字；无资源时留空"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-task-note">备注</Label>
                  <Input id="new-task-note" name="note" placeholder="可选" />
                </div>
                <Button type="submit">
                  <Plus />
                  添加任务
                </Button>
              </form>
            </details>

            <details className="group rounded-xl border border-stone-200 bg-white/70">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-medium marker:content-none">
                批量粘贴
                <Plus className="size-4 text-stone-500 transition-transform group-open:rotate-45" />
              </summary>
              <form
                action={createTasksAction}
                className="space-y-4 border-t border-stone-200 px-5 py-5"
              >
                <input type="hidden" name="trackId" value={track.id} />
                <div className="space-y-2">
                  <Label htmlFor="batch-tasks">任务清单</Label>
                  <textarea
                    id="batch-tasks"
                    name="batch"
                    className={`${textareaClass} min-h-40`}
                    placeholder={
                      "每行一个任务，最多 50 个\n整理 Issue 验收标准\n实现服务层\n验证 MCP"
                    }
                    required
                  />
                </div>
                <Button type="submit" variant="secondary">
                  <Plus />
                  按行创建
                </Button>
              </form>
            </details>
          </div>
        </section>
      )}
    </div>
  );
}
