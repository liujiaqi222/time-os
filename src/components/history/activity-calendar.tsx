"use client";
import { HistorySelect } from "@/components/history/history-select";
import { useState } from "react";
import type { DailyStatistics } from "@/services/statistics";
import { addLocalDays } from "@/shared/timezone";
import {
  ActivityDay,
  activityTone as tone,
} from "@/components/history/activity-day";

export function ActivityCalendar({
  daily,
  today,
  weekStartsOn,
  onDay,
}: {
  daily: DailyStatistics[];
  today: string;
  weekStartsOn: number;
  onDay: (date: string) => void;
}) {
  const months = [...new Set(daily.map((d) => d.date.slice(0, 7)))];
  const [month, setMonth] = useState(months.at(-1)!);
  const monthDays = daily.filter((d) => d.date.startsWith(month));
  const weekday = (date: string) =>
    (new Date(`${date}T12:00:00Z`).getUTCDay() - weekStartsOn + 7) % 7;
  const dayCell = (d: DailyStatistics, mobile: boolean) => (
    <ActivityDay
      key={d.date}
      day={d}
      today={today}
      large={mobile}
      onSelect={() => onDay(d.date)}
    />
  );
  const padding = daily.length ? weekday(daily[0]!.date) : 0;
  const leading = daily.length
    ? Array.from({ length: padding }, (_, i) => ({
        date: addLocalDays(daily[0]!.date, i - padding),
        focusSeconds: 0,
        sessionCount: 0,
        completedTaskCount: 0,
      }))
    : [];
  const columns = Math.ceil((padding + daily.length) / 7);
  const labels = Array.from({ length: columns }, (_, i) => {
    const date = daily[Math.max(0, i * 7 - padding)]?.date;
    return date &&
      (i === 0 ||
        date.slice(0, 7) !==
          daily[Math.max(0, (i - 1) * 7 - padding)]?.date.slice(0, 7))
      ? `${Number(date.slice(5, 7))}月`
      : "";
  });
  const weekdays =
    weekStartsOn === 1
      ? ["一", "二", "三", "四", "五", "六", "日"]
      : ["日", "一", "二", "三", "四", "五", "六"];
  return (
    <section
      aria-label="活动日历"
      className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6"
    >
      <div className="mb-6 flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">每一段投入，都留在这里</h2>
        <span className="text-xs text-stone-500">最近一年</span>
      </div>
      <div
        className="hidden overflow-x-auto pb-2 lg:block"
        aria-label="全年活动日历，可横向滚动"
        tabIndex={0}
      >
        <div className="min-w-max">
          <div className="mb-2 ml-6 flex gap-[4px]">
            {labels.map((label, i) => (
              <span
                key={i}
                className="w-[14px] overflow-visible text-[10px] whitespace-nowrap text-stone-500"
              >
                {label}
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="grid w-4 grid-rows-7 gap-[4px] text-[10px] leading-[14px] text-stone-400">
              {weekdays.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
            <div className="grid grid-flow-col grid-rows-7 gap-[4px]">
              {leading.map((d) => (
                <span key={d.date} className="size-[14px]" />
              ))}
              {daily.map((d) => dayCell(d, false))}
            </div>
          </div>
        </div>
      </div>
      <div className="lg:hidden">
        <div className="mb-4 flex items-center justify-between gap-3">
          <button
            type="button"
            aria-label="上个月"
            disabled={month === months[0]}
            onClick={() => setMonth(months[months.indexOf(month) - 1]!)}
            className="size-10 rounded-lg border disabled:opacity-30"
          >
            ‹
          </button>
          <HistorySelect
            label="日历月份"
            value={month}
            onValueChange={setMonth}
            options={months.map((m) => ({ value: m, label: m }))}
            className="h-10 min-w-0 bg-white px-3"
          />
          <button
            type="button"
            aria-label="下个月"
            disabled={month === months.at(-1)}
            onClick={() => setMonth(months[months.indexOf(month) + 1]!)}
            className="size-10 rounded-lg border disabled:opacity-30"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {weekdays.map((d) => (
            <span key={d} className="pb-2 text-center text-xs text-stone-400">
              {d}
            </span>
          ))}
          {Array.from(
            { length: monthDays[0] ? weekday(monthDays[0].date) : 0 },
            (_, i) => (
              <span key={`pad${i}`} />
            ),
          )}
          {monthDays.map((d) => dayCell(d, true))}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-stone-500">
        {[
          ["0 秒", 0],
          ["不足 15 分钟", 1],
          ["15–59 分钟", 900],
          ["至少 60 分钟", 3600],
        ].map(([label, value]) => (
          <span key={label} className="flex items-center gap-1.5">
            <i
              aria-hidden="true"
              className={`size-3 rounded-sm ${tone(Number(value))}`}
            />
            {label}
          </span>
        ))}
      </div>
      <p className="mt-3 text-xs leading-5 text-stone-500">
        选择日期查看当天投入。一次跨日执行可以出现在两天，累计次数只算一次。
      </p>
    </section>
  );
}
