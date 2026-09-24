import Link from "next/link";

import { HistoryView } from "@/components/history-view";
import { historyService, settingsService, statisticsService } from "@/services";
import { goalTrackStatusLabel } from "@/shared/labels";
import { addLocalDays, localDateStart } from "@/shared/timezone";

interface HistorySearchParams {
  from?: string;
  to?: string;
  trackId?: string;
  includeCancelled?: string;
  cursor?: string;
}

function uuidOrUndefined(value: string | undefined): string | undefined {
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value
    : undefined;
}

function historyBoundary(
  value: string | undefined,
  timezone: string,
  includeSelectedDay = false,
): string | undefined {
  if (!value) return undefined;
  try {
    const date = includeSelectedDay ? addLocalDays(value, 1) : value;
    return localDateStart(date, timezone).toISOString();
  } catch {
    return undefined;
  }
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams?: Promise<HistorySearchParams>;
}) {
  const query = (await searchParams) ?? {};
  const context = { actor: "web" } as const;
  const settings = await settingsService.get(context);
  const from = historyBoundary(query.from, settings.timezone);
  // The date picker is inclusive for people; the service boundary remains
  // half-open by advancing the selected final local date by one day.
  const to = historyBoundary(query.to, settings.timezone, true);
  const invalidRange = Boolean(from && to && from >= to);

  const [page, targets, today, week] = await Promise.all([
    historyService.listSessions(context, {
      from: invalidRange ? undefined : from,
      to: invalidRange ? undefined : to,
      trackId: uuidOrUndefined(query.trackId),
      includeCancelled: query.includeCancelled === "true",
      cursor: uuidOrUndefined(query.cursor),
      limit: 30,
    }),
    historyService.listTargets(context),
    statisticsService.getStatistics(context, { period: "today" }),
    statisticsService.getStatistics(context, { period: "week" }),
  ]);

  const nextParams = new URLSearchParams();
  if (query.from) nextParams.set("from", query.from);
  if (query.to) nextParams.set("to", query.to);
  if (query.trackId) nextParams.set("trackId", query.trackId);
  if (query.includeCancelled === "true")
    nextParams.set("includeCancelled", "true");
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-4xl font-semibold tracking-tight">回顾</h1>
        <p className="mt-2 text-stone-600">
          可信的专注记录与统计，按 {settings.timezone} 时区计算。
        </p>
      </header>

      <form className="grid gap-3 rounded-xl border bg-white p-4 sm:grid-cols-4">
        <label className="text-sm">
          从
          <input
            type="date"
            name="from"
            defaultValue={query.from}
            className="mt-1 h-9 w-full rounded-lg border px-2"
          />
        </label>
        <label className="text-sm">
          到
          <input
            type="date"
            name="to"
            defaultValue={query.to}
            className="mt-1 h-9 w-full rounded-lg border px-2"
          />
        </label>
        <label className="text-sm">
          推进线
          <select
            name="trackId"
            defaultValue={query.trackId ?? ""}
            className="mt-1 h-9 w-full rounded-lg border bg-white px-2"
          >
            <option value="">全部推进线</option>
            {targets.map(({ track }) => (
              <option key={track.id} value={track.id}>
                {track.title} ({goalTrackStatusLabel[track.status]})
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-3">
          <label className="flex h-9 items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="includeCancelled"
              value="true"
              defaultChecked={query.includeCancelled === "true"}
            />
            含已取消
          </label>
          <button className="h-9 rounded-lg bg-stone-900 px-3 text-sm text-white">
            应用
          </button>
        </div>
      </form>
      {invalidRange && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          开始日期必须早于或等于结束日期，筛选未生效。
        </p>
      )}

      <HistoryView
        sessions={page.items}
        targets={targets}
        timezone={settings.timezone}
        today={today}
        week={week}
      />

      {page.nextCursor && (
        <div className="flex justify-center">
          <Link
            href={`/history?${nextParams.toString()}`}
            className="rounded-lg border bg-white px-4 py-2 text-sm hover:bg-stone-50"
          >
            加载更早的专注记录
          </Link>
        </div>
      )}
    </div>
  );
}
