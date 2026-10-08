"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getFirstExecutionFeedbackAction } from "@/app/(app)/history/actions";
import { ActivityDay } from "@/components/history/activity-day";
import type { Statistics } from "@/services/statistics";
/** Reads the same calendar as footprints. A read failure never denies saved time. */
export function FirstExecutionFeedback({ id }: { id: string }) {
  const router = useRouter();
  const [data, setData] = useState<{
    today: string;
    calendar: Statistics;
  } | null>(null);
  useEffect(() => {
    let stopped = false;
    void getFirstExecutionFeedbackAction(id)
      .then((result) => {
        if (!stopped && result.ok && result.data) setData(result.data);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [id]);
  if (!data) return null;
  return (
    <section
      aria-label="首次执行足迹"
      className="mt-5 rounded-2xl bg-[#edf3ee] p-4"
    >
      <p className="text-sm font-medium text-[#537d61]">
        第一段投入，已经留下足迹。
      </p>
      <div className="mt-3 grid max-w-sm grid-cols-7 gap-1.5">
        {data.calendar.daily.map((d) => (
          <ActivityDay
            key={d.date}
            day={d}
            today={data.today}
            large
            onSelect={() => router.push("/history")}
          />
        ))}
      </div>
      <p className="mt-3 text-xs text-stone-500">最近七天 · 选择日期去看足迹</p>
    </section>
  );
}
