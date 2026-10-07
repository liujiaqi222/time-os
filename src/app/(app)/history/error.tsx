"use client";
import { Button } from "@/components/ui/button";
export default function HistoryError({ reset }: { reset: () => void }) {
  return (
    <section className="mx-auto max-w-lg space-y-4 py-20">
      <h1 className="text-2xl font-semibold">足迹暂时没能加载</h1>
      <p className="text-stone-600">记录仍然保留。请重试以读取真实投入。</p>
      <Button onClick={reset}>重新加载</Button>
    </section>
  );
}
