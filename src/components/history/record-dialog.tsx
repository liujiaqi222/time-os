"use client";
import { useId, useRef, useState, useTransition } from "react";
import { HistorySelect } from "@/components/history/history-select";
import { useRouter } from "next/navigation";
import {
  logSessionAction,
  updateHistorySessionAction,
  cancelHistorySessionAction,
  getHistorySessionAction,
} from "@/app/(app)/history/actions";
import { DistractionRecord } from "@/components/history/distraction-record";
import { Modal } from "@/components/focus/modal";
import { Button } from "@/components/ui/button";
import type { HistorySessionDetail, SessionTarget } from "@/services/history";
import type { SerializedDomainError } from "@/shared/domain-error";
import { getZonedParts } from "@/shared/timezone";
import { durationLabel } from "@/shared/duration-label";
import {
  goalStatusLabel,
  taskStatusLabel,
  timeBasisLabel,
  sessionCreatedViaLabel,
} from "@/shared/labels";

function localValue(date: Date | string, timezone: string) {
  const p = getZonedParts(new Date(date), timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}
const fieldClass =
  "mt-1 w-full min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm";
function errorMessage(error: SerializedDomainError) {
  if (error.code === "VERSION_CONFLICT")
    return "这条记录已在别处修改。输入仍保留，请加载最新记录后重新核对。";
  if (error.code === "INVALID_INPUT")
    return "请检查时间和时长：有效时长必须大于零，且不能超过起止时间范围。";
  if (error.code === "INVALID_SESSION_STATE")
    return "记录状态已变化，请重新加载。运行中的记录需要先结束。";
  if (error.code === "IDEMPOTENCY_KEY_REUSED")
    return "这次补录已保存，请关闭后重新打开以补录另一段。";
  return "保存失败，输入仍保留，请重试。";
}
export function RecordDialog({
  detail,
  targets,
  timezone,
  now,
  onClose,
}: {
  detail?: HistorySessionDetail;
  targets: SessionTarget[];
  timezone: string;
  now: Date;
  onClose: () => void;
}) {
  const router = useRouter();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [current, setCurrent] = useState(detail);
  const [editing, setEditing] = useState(!detail);
  const [goalId, setGoalId] = useState(
    detail?.goalId ??
      targets.find((t) => t.goal.status === "active")?.goal.id ??
      targets[0]?.goal.id ??
      "",
  );
  const [taskId, setTaskId] = useState(detail?.taskId ?? "");
  const [started, setStarted] = useState(
    detail ? localValue(detail.startedAt, timezone) : "",
  );
  const [ended, setEnded] = useState(
    localValue(detail?.endedAt ?? now, timezone),
  );
  const [minutes, setMinutes] = useState(
    String((detail?.durationSeconds ?? 1800) / 60),
  );
  const [intent, setIntent] = useState(detail?.intent ?? "");
  const [note, setNote] = useState(detail?.note ?? "");
  const [hint, setHint] = useState(detail?.resumeHint ?? "");
  const [key] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<SerializedDomainError | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [pending, startTransition] = useTransition();
  const target = targets.find((t) => t.goal.id === goalId);
  function save(allowOverlap = false) {
    setError(null);
    startTransition(async () => {
      try {
        const result = current
          ? await updateHistorySessionAction({
              id: current.id,
              timezone,
              expectedRevision: current.revision,
              expectedNoteVersion: current.noteVersion,
              expectedResumeHintVersion: current.resumeHintVersion,
              ...(goalId !== current.goalId || taskId !== (current.taskId ?? "")
                ? { goalId, taskId: taskId || null }
                : {}),
              ...(started !== localValue(current.startedAt, timezone)
                ? { startedAtLocal: started }
                : {}),
              ...(ended !== localValue(current.endedAt!, timezone)
                ? { endedAtLocal: ended }
                : {}),
              ...(Math.round(Number(minutes) * 60) !== current.durationSeconds
                ? { durationSeconds: Math.round(Number(minutes) * 60) }
                : {}),
              ...(intent !== (current.intent ?? "")
                ? { intent: intent || null }
                : {}),
              ...(note !== (current.note ?? "") ? { note: note || null } : {}),
              ...(hint !== (current.resumeHint ?? "")
                ? { resumeHint: hint || null }
                : {}),
              allowOverlap,
            })
          : await logSessionAction({
              goalId,
              timezone,
              taskId: taskId || null,
              durationMinutes: Number(minutes),
              startedAtLocal: started || undefined,
              endedAtLocal: ended || undefined,
              intent: intent || null,
              note: note || null,
              resumeHint: hint || null,
              idempotencyKey: key,
              allowOverlap,
            });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        router.refresh();
        onClose();
      } catch {
        setError({ code: "INTERNAL_ERROR", message: "连接失败" });
      }
    });
  }
  function reload() {
    if (!current) return;
    startTransition(async () => {
      try {
        const r = await getHistorySessionAction(current.id);
        if (r.ok) {
          setCurrent(r.data);
          setError(null);
        } else setError(r.error);
      } catch {
        setError({ code: "INTERNAL_ERROR", message: "连接失败" });
      }
    });
  }
  function cancel() {
    if (!current) return;
    startTransition(async () => {
      try {
        const r = await cancelHistorySessionAction(current.id);
        if (r.ok) {
          router.refresh();
          onClose();
        } else setError(r.error);
      } catch {
        setError({ code: "INTERNAL_ERROR", message: "连接失败" });
      }
    });
  }
  const time = (date: Date | string) =>
    new Date(date).toLocaleString("zh-CN", {
      timeZone: timezone,
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  const intervalRows = current?.intervals ?? [];
  const phaseLabel = (kind: string) =>
    kind === "focus" ? "专注" : kind === "long_break" ? "长休息" : "休息";
  return (
    <Modal
      labelledBy="record-title"
      onClose={() => {
        if (!pending) onClose();
      }}
      panelClassName="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-xl sm:p-7"
    >
      <div className="mb-5 flex items-start justify-between gap-3">
        <h2 id="record-title" className="text-xl font-semibold">
          {current ? (editing ? "更正记录" : "执行详情") : "补录一段"}
        </h2>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={onClose}
          aria-label="关闭记录详情"
        >
          关闭
        </Button>
      </div>
      {confirmCancel ? (
        <div className="space-y-4">
          <h3 className="font-medium">取消这段执行？</h3>
          <p className="text-sm leading-6 text-stone-600">
            取消后，这次执行的所有专注段将从首页、日历和目标汇总中排除。原记录仍可从取消审计查看，已完成的任务会保留。
          </p>
          <div className="flex gap-3">
            <Button disabled={pending} onClick={cancel}>
              确认取消
            </Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => setConfirmCancel(false)}
            >
              返回详情
            </Button>
          </div>
        </div>
      ) : editing ? (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-4"
        >
          <div className="min-w-0">
            <label htmlFor={`${formId}-goal`} className="block text-sm">
              目标
            </label>
            <HistorySelect
              id={`${formId}-goal`}
              value={goalId}
              disabled={pending}
              onValueChange={(value) => {
                setGoalId(value);
                setTaskId("");
                setError(null);
              }}
              container={formRef}
              required
              options={targets.map((t) => ({
                value: t.goal.id,
                label: `${t.goal.title} (${goalStatusLabel[t.goal.status]})`,
              }))}
            />
          </div>
          <div className="min-w-0">
            <label htmlFor={`${formId}-task`} className="block text-sm">
              任务（可选）
            </label>
            <HistorySelect
              id={`${formId}-task`}
              value={taskId}
              disabled={pending}
              onValueChange={setTaskId}
              container={formRef}
              options={[
                { value: "", label: "仅围绕目标" },
                ...(target?.tasks.map((t) => ({
                  value: t.id,
                  label: `${t.title} (${taskStatusLabel[t.status]})`,
                })) ?? []),
              ]}
            />
          </div>
          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label htmlFor={`${formId}-start`} className="block text-sm">
                开始于
              </label>
              {!current && (
                <span className="text-xs text-stone-500">
                  （留空按时长计算）
                </span>
              )}
              <input
                id={`${formId}-start`}
                type="datetime-local"
                step="1"
                value={started}
                disabled={pending}
                onChange={(e) => setStarted(e.target.value)}
                required={!!current}
                className={fieldClass}
              />
            </div>
            <div className="min-w-0">
              <label htmlFor={`${formId}-end`} className="block text-sm">
                结束于
              </label>
              <input
                id={`${formId}-end`}
                type="datetime-local"
                step="1"
                value={ended}
                disabled={pending}
                onChange={(e) => setEnded(e.target.value)}
                required
                className={fieldClass}
              />
            </div>
          </div>
          <div className="min-w-0">
            <label htmlFor={`${formId}-duration`} className="block text-sm">
              有效时长（分钟）
            </label>
            <input
              id={`${formId}-duration`}
              type="number"
              min={current?.durationSeconds === 0 ? 0 : 0.016666666}
              step="any"
              value={minutes}
              disabled={pending}
              onChange={(e) => setMinutes(e.target.value)}
              required
              className={fieldClass}
            />
          </div>
          <p className="text-xs leading-5 text-stone-500">
            时区：{timezone}
            。补录和时间更正按起止范围分配有效时长，不推测暂停的位置。
          </p>
          <div className="min-w-0">
            <label htmlFor={`${formId}-intent`} className="block text-sm">
              这次做什么（可选）
            </label>
            <input
              id={`${formId}-intent`}
              value={intent}
              disabled={pending}
              maxLength={2000}
              onChange={(e) => setIntent(e.target.value)}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-note`} className="block text-sm">
              笔记
            </label>
            <textarea
              id={`${formId}-note`}
              value={note}
              disabled={pending}
              maxLength={20000}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className={fieldClass}
            />
          </div>
          <div>
            <label htmlFor={`${formId}-hint`} className="block text-sm">
              下次从哪里继续
            </label>
            <textarea
              id={`${formId}-hint`}
              value={hint}
              disabled={pending}
              maxLength={20000}
              onChange={(e) => setHint(e.target.value)}
              rows={2}
              className={fieldClass}
            />
          </div>
          <Button type="submit" disabled={pending || !goalId}>
            {pending ? "正在保存…" : current ? "保存更正" : "保存补录"}
          </Button>
        </form>
      ) : (
        current && (
          <div className="space-y-5">
            <div>
              <p className="font-medium break-words">{current.goal.title}</p>
              <p className="mt-1 break-words text-stone-600">
                {current.task?.title ?? current.intent ?? "围绕目标执行"}
              </p>
              <p className="mt-3 text-2xl font-semibold">
                {durationLabel(current.durationSeconds ?? 0)}
              </p>
              <p className="mt-2 text-xs text-stone-500">
                {time(current.startedAt)} —{" "}
                {current.endedAt ? time(current.endedAt) : "尚未结束"}
              </p>
              <p className="mt-2 text-xs text-stone-500">
                {timeBasisLabel[current.timeBasis]} ·{" "}
                {sessionCreatedViaLabel[current.createdVia]}
                {current.status === "cancelled" ? " · 已取消，不计入统计" : ""}
              </p>
            </div>
            {current.note && (
              <div>
                <h3 className="text-sm text-stone-500">笔记</h3>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap">
                  {current.note}
                </p>
              </div>
            )}
            {current.resumeHint && (
              <div>
                <h3 className="text-sm text-stone-500">下次从哪里继续</h3>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap">
                  {current.resumeHint}
                </p>
              </div>
            )}
            {current.timeBasis !== "observed" && (
              <p className="rounded-xl bg-stone-50 p-3 text-sm leading-6 text-stone-600">
                {current.timeBasis === "corrected"
                  ? "这是一条更正记录。统计使用当前有效时长，原始计时仅供查阅，不重复计入。"
                  : "这是一条手动补录。有效时长按声明的时间范围分配。"}
              </p>
            )}
            {current.phases.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  番茄轮次（
                  {current.phases.filter((p) => p.kind === "focus").length}{" "}
                  段专注）
                </summary>
                <ol className="mt-3 space-y-2 text-sm text-stone-600">
                  {current.phases.map((p) => (
                    <li key={p.id}>
                      {phaseLabel(p.kind)} · {time(p.startedAt)}
                      {p.endedAt && ` — ${time(p.endedAt)}`}
                      {p.pausedAt && !p.endedAt ? " · 已暂停" : ""}
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {intervalRows.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  {current.timeBasis === "corrected"
                    ? "原始计时区间"
                    : "专注、休息与暂停"}
                </summary>
                <ol className="mt-3 space-y-2 text-sm text-stone-600">
                  {intervalRows.map((i, index) => {
                    const next = intervalRows[index + 1];
                    const end = new Date(
                      Math.min(
                        new Date(i.endedAt ?? now).getTime(),
                        new Date(i.deadlineAt ?? now).getTime(),
                        now.getTime(),
                      ),
                    );
                    const gapEnd = next?.startedAt ?? current.endedAt;
                    const gap = gapEnd
                      ? Math.floor(
                          (new Date(gapEnd).getTime() - end.getTime()) / 1000,
                        )
                      : 0;
                    return (
                      <li key={i.id}>
                        <span>
                          {phaseLabel(i.phase)} · {time(i.startedAt)} —{" "}
                          {time(end)}
                        </span>
                        {gap > 0 && (
                          <p className="mt-1 text-xs text-stone-400">
                            {i.deadlineAt && end >= new Date(i.deadlineAt)
                              ? "到时等待"
                              : "暂停"}{" "}
                            · {durationLabel(gap)}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </details>
            )}
            {current.distractions.length > 0 && (
              <details>
                <summary className="cursor-pointer text-sm font-medium">
                  打断记录
                </summary>
                <ul className="mt-3 space-y-2">
                  {current.distractions.map((record) => (
                    <DistractionRecord key={record.id} record={record} />
                  ))}
                </ul>
              </details>
            )}
            {current.status === "completed" ? (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                <Button variant="outline" onClick={() => setEditing(true)}>
                  更正记录
                </Button>
                <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
                  取消这段执行
                </Button>
              </div>
            ) : (
              current.status !== "cancelled" && (
                <a href="/today" className="text-sm underline">
                  先返回执行页结束计时
                </a>
              )
            )}
          </div>
        )
      )}
      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900"
        >
          {error.code === "SESSION_TIME_OVERLAP" ? (
            <>
              <p className="font-medium">与已有记录时间冲突</p>
              <p className="break-words">
                {String(error.context?.goal ?? "已有执行")} ·{" "}
                {error.context?.startedAt
                  ? time(String(error.context.startedAt))
                  : ""}
                {error.context?.endedAt
                  ? ` — ${time(String(error.context.endedAt))}`
                  : " — 尚未结束"}
              </p>
              <p className="mt-2">
                确认保存后，两条记录各自累计投入，不会自动去重。
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => save(true)}
                className="mt-3"
              >
                仍然保存
              </Button>
            </>
          ) : (
            <>
              <p>{errorMessage(error)}</p>
              {error.code === "VERSION_CONFLICT" && (
                <Button disabled={pending} onClick={reload} className="mt-3">
                  加载最新记录并保留输入
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
