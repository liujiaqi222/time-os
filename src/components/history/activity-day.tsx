"use client";
import type { DailyStatistics } from "@/services/statistics";
import { durationLabel } from "@/shared/duration-label";
export function activityTone(seconds: number) {
  return seconds === 0
    ? "bg-stone-100"
    : seconds < 900
      ? "bg-[#d4e2d6]"
      : seconds < 3600
        ? "bg-[#94b29c]"
        : "bg-[#537d61]";
}
export function ActivityDay({
  day,
  today,
  large = false,
  onSelect,
}: {
  day: DailyStatistics;
  today: string;
  large?: boolean;
  onSelect: () => void;
}) {
  const future = day.date > today;
  const label = `${day.date}，${future ? "尚未到来" : `${durationLabel(day.focusSeconds)}，${day.sessionCount} 次执行，${day.completedTaskCount} 件完成事项`}`;
  return (
    <button
      type="button"
      disabled={future}
      title={label}
      aria-label={label}
      onClick={onSelect}
      className={`${large ? "flex aspect-square min-h-10 flex-col items-center justify-center rounded-lg text-sm" : "h-[14px] w-[14px] rounded-[3px]"} ${future ? "bg-stone-100 text-stone-400" : activityTone(day.focusSeconds)} ${day.focusSeconds >= 3600 ? "text-white" : "text-stone-700"} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#537d61] disabled:cursor-default`}
    >
      {large && (
        <>
          <span>{Number(day.date.slice(-2))}</span>
          {day.focusSeconds > 0 && (
            <span aria-hidden="true" className="text-[10px]">
              {day.focusSeconds < 60
                ? `${day.focusSeconds}秒`
                : `${Math.floor(day.focusSeconds / 60)}分`}
            </span>
          )}
        </>
      )}
    </button>
  );
}
