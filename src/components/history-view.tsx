"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import {
  archiveHistoryDistractionAction,
  cancelHistorySessionAction,
  getHistorySessionAction,
  logSessionAction,
  updateHistoryDistractionAction,
  updateHistorySessionAction,
} from "@/app/(app)/history/actions";
import { ConfirmationDialog } from "@/components/confirmation-dialog";
import type {
  HistorySession,
  HistorySessionDetail,
  SessionTarget,
} from "@/services/history";
import type { Statistics } from "@/services/statistics";
import { getZonedParts, localDateKey } from "@/shared/timezone";
import { useCurrentSeconds } from "@/components/use-current-seconds";
import {
  goalTrackStatusLabel,
  sessionCreatedViaLabel,
  sessionEntryModeLabel,
  sessionStatusLabel,
  taskStatusLabel,
} from "@/shared/labels";

function durationLabel(seconds: number) {
  const roundedMinutes = Math.round(seconds / 60);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  return hours ? `${hours}时 ${minutes}分` : `${minutes}分`;
}

function localInputValue(date: Date | string, timezone: string) {
  const parts = getZonedParts(new Date(date), timezone);
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}T${parts.hour
    .toString()
    .padStart(2, "0")}:${parts.minute.toString().padStart(2, "0")}`;
}

function sessionSeconds(session: HistorySession, nowSeconds: number | null) {
  if (session.status === "cancelled") return 0;
  if (session.status === "completed") return session.durationSeconds ?? 0;
  const end =
    session.status === "paused" && session.pausedAt
      ? new Date(session.pausedAt).getTime() / 1000
      : (nowSeconds ?? new Date(session.startedAt).getTime() / 1000);
  return Math.max(
    0,
    Math.floor(end - new Date(session.startedAt).getTime() / 1000) -
      session.totalPausedSeconds,
  );
}

function ErrorMessage({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
    >
      {error}
    </p>
  );
}

function SessionRow({
  session,
  targets,
  timezone,
}: {
  session: HistorySession;
  targets: SessionTarget[];
  timezone: string;
}) {
  const router = useRouter();
  const nowSeconds = useCurrentSeconds();
  const [detail, setDetail] = useState<HistorySessionDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [trackId, setTrackId] = useState(session.trackId);
  const [taskId, setTaskId] = useState(session.taskId ?? "");
  const [startedAt, setStartedAt] = useState(
    localInputValue(session.startedAt, timezone),
  );
  const [endedAt, setEndedAt] = useState(
    session.endedAt ? localInputValue(session.endedAt, timezone) : "",
  );
  const [plannedMinutes, setPlannedMinutes] = useState(
    session.plannedMinutes?.toString() ?? "",
  );
  const [note, setNote] = useState(session.note ?? "");
  const selectedTarget = targets.find((target) => target.track.id === trackId);

  function loadDetail() {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || detail) return;
    startTransition(async () => {
      const result = await getHistorySessionAction(session.id);
      if (result.ok) setDetail(result.data);
      else setError(result.error.message);
    });
  }

  function save(allowOverlap: boolean) {
    setError(null);
    setOverlap(false);
    startTransition(async () => {
      const result = await updateHistorySessionAction({
        id: session.id,
        trackId,
        taskId: taskId || null,
        startedAtLocal: startedAt,
        endedAtLocal: endedAt,
        plannedMinutes: plannedMinutes ? Number(plannedMinutes) : null,
        note: note || null,
        allowOverlap,
      });
      if (!result.ok) {
        setError(
          result.error.code === "SESSION_TIME_OVERLAP"
            ? "这段专注与已有记录的时间冲突。"
            : result.error.message,
        );
        setOverlap(result.error.code === "SESSION_TIME_OVERLAP");
        return;
      }
      router.refresh();
    });
  }

  function cancel() {
    startTransition(async () => {
      const result = await cancelHistorySessionAction(session.id);
      if (!result.ok) setError(result.error.message);
      else {
        setCancelDialogOpen(false);
        router.refresh();
      }
    });
  }

  return (
    <li className="rounded-xl border bg-white">
      <button
        type="button"
        onClick={loadDetail}
        className="flex w-full items-center justify-between gap-4 p-4 text-left"
        aria-expanded={open}
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="truncate">{session.track.title}</strong>
            <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-600">
              {sessionStatusLabel[session.status]}
            </span>
            {session.entryMode === "manual" && (
              <span className="text-xs text-stone-500">
                {sessionEntryModeLabel.manual}
              </span>
            )}
          </span>
          <span className="mt-1 block truncate text-sm text-stone-600">
            {session.task?.title ?? "自由专注"} ·{" "}
            {new Intl.DateTimeFormat("zh-CN", {
              timeZone: timezone,
              hour: "2-digit",
              minute: "2-digit",
            }).format(new Date(session.startedAt))}
          </span>
        </span>
        <span className="shrink-0 font-mono text-sm font-medium">
          {durationLabel(sessionSeconds(session, nowSeconds))}
        </span>
      </button>

      {open && (
        <div className="space-y-5 border-t p-4">
          {pending && !detail ? (
            <p className="text-sm text-stone-500">加载详情…</p>
          ) : (
            <>
              <dl className="grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-stone-500">来源</dt>
                  <dd>
                    {sessionEntryModeLabel[session.entryMode]} ·{" "}
                    {sessionCreatedViaLabel[session.createdVia]}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">暂停</dt>
                  <dd>{durationLabel(session.totalPausedSeconds)}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">计划</dt>
                  <dd>
                    {session.plannedMinutes
                      ? `${session.plannedMinutes} 分钟`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">有效 / 墙上时间</dt>
                  <dd>
                    {durationLabel(sessionSeconds(session, nowSeconds))} /{" "}
                    {session.endedAt
                      ? durationLabel(
                          Math.max(
                            0,
                            (new Date(session.endedAt).getTime() -
                              new Date(session.startedAt).getTime()) /
                              1000,
                          ),
                        )
                      : "进行中"}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">开始</dt>
                  <dd>
                    {new Intl.DateTimeFormat("zh-CN", {
                      timeZone: timezone,
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(session.startedAt))}
                  </dd>
                </div>
                <div>
                  <dt className="text-stone-500">结束</dt>
                  <dd>
                    {session.endedAt
                      ? new Intl.DateTimeFormat("zh-CN", {
                          timeZone: timezone,
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(session.endedAt))
                      : "进行中"}
                  </dd>
                </div>
              </dl>
              <div className="text-sm">
                <h3 className="text-stone-500">笔记</h3>
                <p className="whitespace-pre-wrap">{session.note || "—"}</p>
              </div>

              {(session.status === "active" || session.status === "paused") && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => setCancelDialogOpen(true)}
                  className="rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                >
                  取消这段专注
                </button>
              )}

              {session.status === "completed" && (
                <div className="space-y-3 rounded-lg bg-stone-50 p-3">
                  <h3 className="font-medium">编辑记录</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      推进线
                      <select
                        value={trackId}
                        onChange={(event) => {
                          setTrackId(event.target.value);
                          setTaskId("");
                        }}
                        className="mt-1 h-9 w-full rounded-lg border bg-white px-2"
                      >
                        {targets.map((target) => (
                          <option key={target.track.id} value={target.track.id}>
                            {target.track.title} (
                            {goalTrackStatusLabel[target.track.status]})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      任务
                      <select
                        value={taskId}
                        onChange={(event) => setTaskId(event.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border bg-white px-2"
                      >
                        <option value="">无任务</option>
                        {selectedTarget?.tasks.map((task) => (
                          <option key={task.id} value={task.id}>
                            {task.title} ({taskStatusLabel[task.status]})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      开始
                      <input
                        type="datetime-local"
                        required
                        value={startedAt}
                        onChange={(event) => setStartedAt(event.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border bg-white px-2"
                      />
                    </label>
                    <label className="text-sm">
                      结束
                      <input
                        type="datetime-local"
                        required
                        value={endedAt}
                        onChange={(event) => setEndedAt(event.target.value)}
                        className="mt-1 h-9 w-full rounded-lg border bg-white px-2"
                      />
                    </label>
                    <label className="text-sm">
                      计划（分钟）
                      <input
                        type="number"
                        min="1"
                        value={plannedMinutes}
                        onChange={(event) =>
                          setPlannedMinutes(event.target.value)
                        }
                        className="mt-1 h-9 w-full rounded-lg border bg-white px-2"
                      />
                    </label>
                    <label className="text-sm sm:col-span-2">
                      笔记
                      <textarea
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                        rows={3}
                        className="mt-1 w-full rounded-lg border bg-white p-2"
                      />
                    </label>
                  </div>
                  <ErrorMessage error={error} />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => save(false)}
                      className="rounded-lg bg-stone-900 px-3 py-2 text-sm text-white disabled:opacity-50"
                    >
                      保存修改
                    </button>
                    {overlap && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => save(true)}
                        className="rounded-lg border border-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                      >
                        确认重叠
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => setCancelDialogOpen(true)}
                      className="rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50"
                    >
                      取消这段专注
                    </button>
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 font-medium">打断</h3>
                {!detail?.distractions.length ? (
                  <p className="text-sm text-stone-500">没有记录的打断。</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.distractions.map((distraction) => (
                      <DistractionRow
                        key={distraction.id}
                        distraction={distraction}
                        onChanged={() => {
                          setDetail(null);
                          setOpen(false);
                          router.refresh();
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {cancelDialogOpen && (
        <ConfirmationDialog
          titleId={`cancel-history-session-${session.id}`}
          title="取消这段专注？"
          description="取消后不会计入统计，但记录仍会保留在审计视图中。这个操作不能直接撤销。"
          confirmLabel="确认取消"
          cancelLabel="保留这段专注"
          pending={pending}
          error={error}
          tone="danger"
          onClose={() => setCancelDialogOpen(false)}
          onConfirm={cancel}
        />
      )}
    </li>
  );
}

function DistractionRow({
  distraction,
  onChanged,
}: {
  distraction: HistorySessionDetail["distractions"][number];
  onChanged: () => void;
}) {
  const [text, setText] = useState(distraction.text ?? "");
  const [pending, startTransition] = useTransition();
  return (
    <li className={`flex gap-2 ${distraction.archivedAt ? "opacity-50" : ""}`}>
      <input
        value={text}
        disabled={pending || Boolean(distraction.archivedAt)}
        onChange={(event) => setText(event.target.value)}
        className="h-8 min-w-0 flex-1 rounded-lg border px-2 text-sm"
        aria-label="打断内容"
      />
      {!distraction.archivedAt && (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await updateHistoryDistractionAction(
                  distraction.id,
                  text || null,
                );
                if (result.ok) onChanged();
              })
            }
            className="rounded-lg border px-2 text-xs"
          >
            保存
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await archiveHistoryDistractionAction(
                  distraction.id,
                );
                if (result.ok) onChanged();
              })
            }
            className="rounded-lg px-2 text-xs text-red-700"
          >
            归档
          </button>
        </>
      )}
    </li>
  );
}

function AddSessionForm({
  targets,
  timezone,
}: {
  targets: SessionTarget[];
  timezone: string;
}) {
  const router = useRouter();
  const [trackId, setTrackId] = useState(targets[0]?.track.id ?? "");
  const [taskId, setTaskId] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [endedAt, setEndedAt] = useState(() =>
    localInputValue(new Date(), timezone),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [overlap, setOverlap] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const [pending, startTransition] = useTransition();
  const selectedTarget = targets.find((target) => target.track.id === trackId);

  function submit(allowOverlap: boolean) {
    setError(null);
    setOverlap(false);
    startTransition(async () => {
      const result = await logSessionAction({
        trackId,
        taskId: taskId || null,
        durationMinutes: Number(durationMinutes),
        endedAtLocal: endedAt,
        note: note || null,
        allowOverlap,
        idempotencyKey,
      });
      if (!result.ok) {
        const context = result.error.context;
        setError(
          result.error.code === "SESSION_TIME_OVERLAP" && context
            ? `这段专注与「${context.track}」的时间冲突（${context.startedAt} – ${context.endedAt ?? "进行中"}）。`
            : result.error.message,
        );
        setOverlap(result.error.code === "SESSION_TIME_OVERLAP");
        return;
      }
      setNote("");
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    });
  }

  if (!targets.length)
    return (
      <p className="text-sm text-stone-500">先创建一条推进线，才能补录时间。</p>
    );

  return (
    <section className="rounded-2xl border bg-stone-50 p-4 sm:p-5">
      <h2 className="text-lg font-semibold">补录一段</h2>
      <p className="mt-1 text-sm text-stone-600">
        时间按 {timezone} 计算；手动补录会立即标记为已完成。
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          推进线
          <select
            value={trackId}
            onChange={(event) => {
              setTrackId(event.target.value);
              setTaskId("");
            }}
            className="mt-1 h-10 w-full rounded-lg border bg-white px-2"
          >
            {targets.map((target) => (
              <option key={target.track.id} value={target.track.id}>
                {target.track.title} (
                {goalTrackStatusLabel[target.track.status]})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          任务（可选）
          <select
            value={taskId}
            onChange={(event) => setTaskId(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border bg-white px-2"
          >
            <option value="">无任务</option>
            {selectedTarget?.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title} ({taskStatusLabel[task.status]})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          时长（分钟）
          <input
            type="number"
            min="1"
            required
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border bg-white px-2"
          />
        </label>
        <label className="text-sm">
          结束于
          <input
            type="datetime-local"
            required
            value={endedAt}
            onChange={(event) => setEndedAt(event.target.value)}
            className="mt-1 h-10 w-full rounded-lg border bg-white px-2"
          />
        </label>
        <label className="text-sm sm:col-span-2 lg:col-span-4">
          笔记
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border bg-white p-2"
          />
        </label>
      </div>
      <div className="mt-3">
        <ErrorMessage error={error} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending || !trackId}
          onClick={() => submit(false)}
          className="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {pending ? "保存中…" : "补录一段"}
        </button>
        {overlap && (
          <button
            type="button"
            disabled={pending}
            onClick={() => submit(true)}
            className="rounded-lg border border-amber-500 bg-amber-50 px-4 py-2 text-sm text-amber-900"
          >
            仍然保存
          </button>
        )}
      </div>
    </section>
  );
}

export function HistoryView({
  sessions,
  targets,
  timezone,
  today,
  week,
}: {
  sessions: HistorySession[];
  targets: SessionTarget[];
  timezone: string;
  today: Statistics;
  week: Statistics;
}) {
  const nowSeconds = useCurrentSeconds();
  const groups = useMemo(() => {
    const grouped = new Map<string, HistorySession[]>();
    for (const session of sessions) {
      const key = localDateKey(new Date(session.startedAt), timezone);
      grouped.set(key, [...(grouped.get(key) ?? []), session]);
    }
    return grouped;
  }, [sessions, timezone]);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-5">
        <Stat label="今日专注" value={durationLabel(today.totalFocusSeconds)} />
        <Stat label="本周专注" value={durationLabel(week.totalFocusSeconds)} />
        <Stat label="本周次数" value={String(week.sessionCount)} />
        <Stat label="本周完成" value={String(week.completedTaskCount)} />
        <Stat label="专注天数" value={String(week.focusDays)} />
      </div>
      {week.byTrack.length > 0 && (
        <section className="rounded-xl border bg-white p-4">
          <h2 className="font-semibold">本周投入分布</h2>
          <ul className="mt-3 space-y-2">
            {week.byTrack.map((track) => (
              <li
                key={track.trackId}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span>
                  {track.title}{" "}
                  <span className="text-stone-400">
                    ({goalTrackStatusLabel[track.status]})
                  </span>
                </span>
                <strong>{durationLabel(track.focusSeconds)}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      <AddSessionForm targets={targets} timezone={timezone} />
      {!sessions.length ? (
        <div className="rounded-2xl border border-dashed p-10 text-center text-stone-500">
          没有符合筛选的专注记录。
        </div>
      ) : (
        [...groups.entries()].map(([date, items]) => (
          <section key={date} className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">
                {new Intl.DateTimeFormat("zh-CN", {
                  timeZone: "UTC",
                  dateStyle: "full",
                }).format(new Date(`${date}T12:00:00Z`))}
              </h2>
              <span className="text-sm text-stone-500">
                {durationLabel(
                  items.reduce(
                    (sum, item) => sum + sessionSeconds(item, nowSeconds),
                    0,
                  ),
                )}
              </span>
            </div>
            <ul className="space-y-2">
              {items.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  targets={targets}
                  timezone={timezone}
                />
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-white p-4">
      <p className="text-xs tracking-wide text-stone-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}
