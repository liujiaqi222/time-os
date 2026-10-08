"use client";
import { HistorySelect } from "@/components/history/history-select";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  getHistoryDayAction,
  getHistorySessionAction,
} from "@/app/(app)/history/actions";
import { ActivityCalendar } from "@/components/history/activity-calendar";
import { RecordDialog } from "@/components/history/record-dialog";
import { Modal } from "@/components/focus/modal";
import { Button } from "@/components/ui/button";
import type {
  HistorySession,
  HistorySessionDetail,
  SessionPage,
  SessionTarget,
} from "@/services/history";
import type { Statistics } from "@/services/statistics";
import type { Goal, Task } from "@/db/schema";
import { durationLabel } from "@/shared/duration-label";
import { formatHumanDuration } from "@/shared/session-timer";
import { localDateKey } from "@/shared/timezone";
import { goalStatusLabel, timeBasisLabel } from "@/shared/labels";

type CompletedPage = {
  items: (Task & { goal: Goal })[];
  nextCursor: string | null;
};
type Day = {
  date: string;
  stats: Statistics;
  page: SessionPage;
  completed: CompletedPage;
};
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-stone-500">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight break-words sm:text-2xl">
        {value}
      </p>
    </div>
  );
}
function SessionList({
  sessions,
  timezone,
  onOpen,
}: {
  sessions: HistorySession[];
  timezone: string;
  onOpen: (id: string) => void;
}) {
  const groups = new Map<string, HistorySession[]>();
  for (const session of sessions) {
    const key = localDateKey(new Date(session.startedAt), timezone);
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  return (
    <div className="space-y-6">
      {[...groups].map(([date, rows]) => (
        <section key={date}>
          <h3 className="mb-3 text-xs font-medium text-stone-500">{date}</h3>
          <ul className="space-y-2">
            {rows.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-stone-200 bg-white"
              >
                <button
                  type="button"
                  onClick={() => onOpen(s.id)}
                  className="flex w-full items-start justify-between gap-3 rounded-xl p-4 text-left hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-[#537d61]"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium break-words">
                      {s.task?.title ?? s.intent ?? s.goal.title}
                    </p>
                    <p className="mt-1 text-xs break-words text-stone-500">
                      {s.goal.title} · {timeBasisLabel[s.timeBasis]}
                      {s.status === "cancelled" ? " · 已取消" : ""}
                    </p>
                    {(s.note || s.resumeHint) && (
                      <p className="mt-2 line-clamp-2 text-xs leading-5 break-words text-stone-500">
                        {s.resumeHint ? `下次：${s.resumeHint}` : s.note}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-stone-600">
                    {s.status === "active"
                      ? "执行中"
                      : s.status === "paused"
                        ? "已暂停"
                        : durationLabel(s.durationSeconds ?? 0)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
function CompletedList({
  items,
  timezone,
}: {
  items: CompletedPage["items"];
  timezone: string;
}) {
  return (
    <ul className="space-y-3">
      {items.map((t) => (
        <li
          key={t.id}
          className="flex items-start gap-3 rounded-xl bg-[#edf3ee] p-4"
        >
          <span aria-hidden="true" className="text-[#537d61]">
            ✓
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium break-words">{t.title}</p>
            <p className="mt-1 text-xs break-words text-stone-500">
              {t.goal.title} ·{" "}
              {localDateKey(new Date(t.completedAt!), timezone)}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
export function HistoryView({
  all,
  week,
  calendar,
  page,
  targets,
  completed,
  includeCancelled,
  selectedGoalId,
}: {
  all: Statistics;
  week: Statistics;
  calendar: Statistics;
  page: SessionPage;
  targets: SessionTarget[];
  completed: CompletedPage;
  includeCancelled: boolean;
  selectedGoalId?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<Day | null>(null);
  const [detail, setDetail] = useState<HistorySessionDetail>();
  const [adding, setAdding] = useState(false);
  const [goalId, setGoalId] = useState(selectedGoalId ?? "");
  const timezone = all.timezone;
  const today = localDateKey(new Date(all.serverNow), timezone);
  function href(params: {
    cursor?: string;
    taskCursor?: string;
    includeCancelled?: boolean;
    goalId?: string;
  }) {
    const search = new URLSearchParams();
    const goal = params.goalId ?? selectedGoalId;
    if (goal) search.set("goalId", goal);
    if (params.includeCancelled ?? includeCancelled)
      search.set("includeCancelled", "true");
    if (params.cursor) search.set("cursor", params.cursor);
    if (params.taskCursor) search.set("taskCursor", params.taskCursor);
    return `/history${search.size ? `?${search}` : ""}`;
  }
  function openDay(date: string, cursor?: string, taskCursor?: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await getHistoryDayAction({
          date,
          timezone,
          weekStartsOn: calendar.weekStartsOn,
          goalId: selectedGoalId || undefined,
          cursor,
          taskCursor,
          now: new Date(calendar.serverNow).toISOString(),
        });
        if (!result.ok) {
          setError("当天记录没能加载，请重新选择日期重试。");
          return;
        }
        setDay({ date, ...result.data });
      } catch {
        setError("连接失败，请重新选择日期重试。");
      }
    });
  }
  function openRecord(id: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await getHistorySessionAction(id);
        if (result.ok) setDetail(result.data);
        else setError("记录详情没能加载，请重试。");
      } catch {
        setError("连接失败，请重试。");
      }
    });
  }
  return (
    <div className="mx-auto max-w-5xl space-y-7 pb-8">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-xs tracking-[0.18em] text-stone-500">
            足迹
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            时间留下的痕迹
          </h1>
          <p className="mt-3 text-sm break-words text-stone-500">
            {selectedGoalId
              ? targets.find((t) => t.goal.id === selectedGoalId)?.goal.title
              : "每一次开始，都有真实的积累。"}
          </p>
        </div>
        {targets.length > 0 && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            补录一段
          </Button>
        )}
      </header>
      <section
        aria-label="投入摘要"
        className="grid grid-cols-2 gap-x-5 gap-y-6 rounded-2xl bg-[#edf3ee] px-5 py-6 sm:grid-cols-4 sm:px-7"
      >
        <Stat
          label="累计投入"
          value={formatHumanDuration(all.totalFocusSeconds)}
        />
        <Stat label="本周投入" value={durationLabel(week.totalFocusSeconds)} />
        <Stat label="累计有效执行" value={`${all.sessionCount} 次`} />
        <Stat label="本周完成事项" value={`${week.completedTaskCount} 件`} />
      </section>
      <ActivityCalendar
        daily={calendar.daily}
        today={today}
        weekStartsOn={calendar.weekStartsOn}
        onDay={(date) => openDay(date)}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <details className="w-full rounded-xl border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-sm text-stone-600">
            {selectedGoalId
              ? `筛选目标：${targets.find((t) => t.goal.id === selectedGoalId)?.goal.title ?? "已选目标"}`
              : "按目标查看 / 取消审计"}
          </summary>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              router.push(
                href({
                  goalId: String(f.get("goalId") ?? ""),
                  includeCancelled: f.get("includeCancelled") === "on",
                }),
              );
            }}
            className="mt-4 flex flex-wrap items-end gap-4"
          >
            <div className="min-w-0 flex-1">
              <label htmlFor="history-goal-filter" className="block text-sm">
                目标
              </label>
              <HistorySelect
                id="history-goal-filter"
                name="goalId"
                value={goalId}
                onValueChange={setGoalId}
                options={[
                  { value: "", label: "全部目标" },
                  ...targets.map((t) => ({
                    value: t.goal.id,
                    label: `${t.goal.title} (${goalStatusLabel[t.goal.status]})`,
                  })),
                ]}
              />
            </div>
            <label className="flex h-10 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="includeCancelled"
                defaultChecked={includeCancelled}
              />
              含已取消
            </label>
            <Button type="submit" variant="outline">
              应用
            </Button>
          </form>
        </details>
      </div>
      {pending && (
        <p role="status" className="text-sm text-stone-500">
          正在读取记录…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"
        >
          {error}
        </p>
      )}
      {all.byGoal.length > 0 && (
        <details className="rounded-xl border border-stone-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-medium">
            目标投入
          </summary>
          <ul className="mt-4 space-y-4">
            {all.byGoal.map((g) => (
              <li key={g.goalId}>
                <div className="flex items-start justify-between gap-3 text-sm">
                  <span className="min-w-0 break-words">{g.title}</span>
                  <span className="shrink-0">
                    {durationLabel(g.focusSeconds)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {g.sessionCount} 次执行 · {g.completedTaskCount} 件完成事项
                </p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {targets.length === 0 ? (
        <section className="rounded-2xl border border-dashed p-8 text-center">
          <p className="text-stone-600">从一个想推进的目标开始。</p>
          <Link
            href="/onboarding"
            className="mt-3 inline-block text-sm underline"
          >
            建立目标
          </Link>
        </section>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          <section aria-label="最近执行">
            <h2 className="mb-5 text-lg font-semibold">最近执行</h2>
            {page.items.length ? (
              <SessionList
                sessions={page.items}
                timezone={timezone}
                onOpen={openRecord}
              />
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-sm leading-6 text-stone-500">
                <p>还没有执行记录。先投入一小段时间，足迹就会留在这里。</p>
                <Link href="/today" className="mt-3 inline-block underline">
                  回到执行
                </Link>
              </div>
            )}
            {page.nextCursor && (
              <Link
                href={href({ cursor: page.nextCursor })}
                className="mt-5 inline-block text-sm underline"
              >
                加载更早的执行记录
              </Link>
            )}
          </section>
          <section aria-label="完成事项">
            <h2 className="mb-5 text-lg font-semibold">完成事项</h2>
            <p className="mb-4 text-xs leading-5 text-stone-500">
              任务完成与执行次数分别记录。重新打开的任务不再计入完成事项。
            </p>
            {completed.items.length ? (
              <CompletedList items={completed.items} timezone={timezone} />
            ) : (
              <p className="text-sm text-stone-400">还没有已完成的任务。</p>
            )}
            {completed.nextCursor && (
              <Link
                href={href({ taskCursor: completed.nextCursor })}
                className="mt-5 inline-block text-sm underline"
              >
                更早的完成事项
              </Link>
            )}
          </section>
        </div>
      )}
      <p className="text-xs text-stone-400">
        按 {timezone} 计算 · 暂停、休息、到时等待与取消记录不计入投入
      </p>
      {day && !detail && !adding && (
        <Modal
          labelledBy="day-title"
          onClose={() => setDay(null)}
          panelClassName="max-h-[90dvh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-7"
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <h2 id="day-title" className="text-xl font-semibold">
              {day.date} 的足迹
            </h2>
            <Button variant="ghost" onClick={() => setDay(null)}>
              关闭
            </Button>
          </div>
          <p className="mb-6 text-sm text-stone-600">
            当天投入 {durationLabel(day.stats.totalFocusSeconds)} ·{" "}
            {day.stats.sessionCount} 次执行 · {day.stats.completedTaskCount}{" "}
            件完成事项
          </p>
          {day.page.items.length ? (
            <>
              <SessionList
                sessions={day.page.items}
                timezone={timezone}
                onOpen={openRecord}
              />
              <p className="mt-3 text-xs text-stone-500">
                记录卡片显示整次执行时长；上方摘要只计算当天投入。
              </p>
            </>
          ) : (
            <p className="text-sm text-stone-500">这一天还没有有效投入。</p>
          )}
          {day.page.nextCursor && (
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => openDay(day.date, day.page.nextCursor!)}
              className="mt-4"
            >
              更多当天记录
            </Button>
          )}
          {day.completed.items.length > 0 && (
            <section className="mt-7">
              <h3 className="mb-3 text-sm font-medium">当天完成事项</h3>
              <CompletedList items={day.completed.items} timezone={timezone} />
              {day.completed.nextCursor && (
                <Button
                  disabled={pending}
                  variant="outline"
                  className="mt-3"
                  onClick={() =>
                    openDay(day.date, undefined, day.completed.nextCursor!)
                  }
                >
                  更多当天完成事项
                </Button>
              )}
            </section>
          )}
          {error && (
            <p role="alert" className="mt-4 text-sm text-amber-900">
              {error}
            </p>
          )}
        </Modal>
      )}
      {(adding || detail) && (
        <RecordDialog
          detail={detail}
          targets={targets}
          timezone={timezone}
          now={new Date(all.serverNow)}
          onClose={() => {
            setAdding(false);
            setDetail(undefined);
          }}
        />
      )}
    </div>
  );
}
