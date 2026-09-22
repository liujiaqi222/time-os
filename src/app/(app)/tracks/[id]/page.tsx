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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { planningService } from "@/services";

const context = { actor: "web" } as const;
const textareaClass =
  "min-h-24 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const selectClass =
  "h-8 rounded-lg border border-input bg-white px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

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
  // Independent reads — run in parallel.
  const [track, allTasks] = await Promise.all([
    planningService.getTrack(context, id),
    planningService
      .listTasks(context, id, {
        includeArchived: true,
        limit: 100,
      })
      .then((page) => page.items),
  ]);
  const visibleTasks = showArchived
    ? allTasks
    : allTasks.filter((task) => task.status !== "archived");
  const current = track.currentTaskId
    ? (allTasks.find((task) => task.id === track.currentTaskId) ?? null)
    : null;
  const canReorderVisible =
    showArchived || visibleTasks.length === allTasks.length;

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
          返回 Goals
        </Button>
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
                Track · {track.status}
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
            {showArchived ? "隐藏 Archived" : "查看 Archived"}
          </Button>
        </div>
      </header>

      <Card
        className={
          current
            ? "border-stone-900 bg-stone-950 text-stone-50"
            : "border-dashed bg-transparent"
        }
      >
        <CardHeader>
          <p className="font-mono text-xs tracking-[0.16em] uppercase opacity-60">
            Current Next
          </p>
          <CardTitle className="text-2xl">
            {current
              ? current.title
              : allTasks.length
                ? "尚未选择下一步"
                : "还没有 Task"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className={current ? "text-stone-300" : "text-stone-600"}>
            {current
              ? "这是这条推进线唯一明确的下一步。排序不会改变它。"
              : allTasks.length
                ? "从下方 pending Task 中显式选择一个 Current Next。"
                : "先添加一个 Task；首个 pending Task 会自动成为 Current Next。"}
          </p>
          {current && (
            <form action={setNextAction}>
              <input type="hidden" name="trackId" value={track.id} />
              <input type="hidden" name="taskId" value="" />
              <Button type="submit" size="sm" variant="secondary">
                清空 Current Next
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-white/70">
          <CardHeader>
            <CardTitle>添加一个 Task</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createTasksAction} className="space-y-3">
              <input type="hidden" name="trackId" value={track.id} />
              <Input name="title" placeholder="明确、可开始的下一步" required />
              <textarea
                name="description"
                className={textareaClass}
                placeholder="完成标准或上下文（可选）"
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  name="estimatedMinutes"
                  type="number"
                  min="1"
                  placeholder="预计分钟"
                />
                <select
                  name="resourceType"
                  className={selectClass}
                  defaultValue=""
                >
                  <option value="">无资源</option>
                  <option value="url">URL</option>
                  <option value="text">Text</option>
                </select>
              </div>
              <Input
                name="resourceValue"
                placeholder="资源链接或文字（需与类型同时填写）"
              />
              <Input name="note" placeholder="备注（可选）" />
              <Button type="submit">
                <Plus />
                添加 Task
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-white/70">
          <CardHeader>
            <CardTitle>批量粘贴</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createTasksAction} className="space-y-3">
              <input type="hidden" name="trackId" value={track.id} />
              <textarea
                name="batch"
                className={`${textareaClass} min-h-40`}
                placeholder={
                  "每行一个 Task，最多 50 个\n整理 Issue 验收标准\n实现服务层\n验证 MCP"
                }
                required
              />
              <Button type="submit" variant="secondary">
                <Plus />
                按行创建
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      {canReorderVisible ? (
        <SortableList
          key={visibleTasks.map((task) => task.id).join(":")}
          label="拖动调整 Task 顺序（Current Next 不会变化）"
          items={visibleTasks.map((task) => ({
            id: task.id,
            label: task.title,
          }))}
          onReorder={reorderTasksAction.bind(null, track.id)}
        />
      ) : (
        <p className="text-xs text-stone-500">
          要调整完整顺序，请先显示 Archived Task。
        </p>
      )}

      <section className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <p className="font-mono text-xs tracking-[0.16em] text-stone-500 uppercase">
              Task list
            </p>
            <h2 className="text-2xl font-semibold">全部步骤</h2>
          </div>
          <span className="text-sm text-stone-500">
            {visibleTasks.length} items
          </span>
        </div>
        {visibleTasks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-stone-300 p-10 text-center text-stone-600">
            这里还没有可见 Task。
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
                            Next
                          </span>
                        )}
                        <span className="rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[10px] text-stone-500 uppercase">
                          {task.status}
                        </span>
                      </div>
                      {task.description && (
                        <p className="text-sm text-stone-600">
                          {task.description}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-3 text-xs text-stone-500">
                        {task.estimatedMinutes && (
                          <span>{task.estimatedMinutes} min</span>
                        )}
                        {task.note && <span>Note: {task.note}</span>}
                        {task.resourceType === "url" && task.resourceValue && (
                          <a
                            href={task.resourceValue}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline"
                          >
                            Open resource <ExternalLink className="size-3" />
                          </a>
                        )}
                        {task.resourceType === "text" && task.resourceValue && (
                          <span>Resource: {task.resourceValue}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {task.status === "pending" ? (
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
                              <Button type="submit" size="xs" variant="outline">
                                <Flag />
                                Set as Next
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
                            <Button type="submit" size="xs">
                              <Check />
                              Complete
                            </Button>
                          </form>
                          <form action={transitionTaskAction}>
                            <input type="hidden" name="id" value={task.id} />
                            <input
                              type="hidden"
                              name="transition"
                              value="skip"
                            />
                            <ConfirmSubmit>
                              <SkipForward />
                              Skip
                            </ConfirmSubmit>
                          </form>
                          <form action={transitionTaskAction}>
                            <input type="hidden" name="id" value={task.id} />
                            <input
                              type="hidden"
                              name="transition"
                              value="archive"
                            />
                            <ConfirmSubmit>Archive</ConfirmSubmit>
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
                            Reopen
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                  <details className="text-sm text-stone-500">
                    <summary className="cursor-pointer">编辑 Task</summary>
                    <form
                      action={updateTaskAction}
                      className="mt-3 grid gap-3 sm:grid-cols-2"
                    >
                      <input type="hidden" name="id" value={task.id} />
                      <Input
                        name="title"
                        defaultValue={task.title}
                        required
                        className="sm:col-span-2"
                      />
                      <Input
                        name="description"
                        defaultValue={task.description ?? ""}
                        placeholder="描述"
                      />
                      <Input
                        name="estimatedMinutes"
                        defaultValue={task.estimatedMinutes ?? ""}
                        type="number"
                        min="1"
                        placeholder="预计分钟"
                      />
                      <select
                        name="resourceType"
                        className={selectClass}
                        defaultValue={task.resourceType ?? ""}
                      >
                        <option value="">无资源</option>
                        <option value="url">URL</option>
                        <option value="text">Text</option>
                      </select>
                      <Input
                        name="resourceValue"
                        defaultValue={task.resourceValue ?? ""}
                        placeholder="资源内容"
                      />
                      <Input
                        name="note"
                        defaultValue={task.note ?? ""}
                        placeholder="备注"
                        className="sm:col-span-2"
                      />
                      <Button
                        type="submit"
                        variant="outline"
                        className="sm:justify-self-start"
                      >
                        保存修改
                      </Button>
                    </form>
                  </details>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>
    </div>
  );
}
