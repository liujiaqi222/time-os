import { ArrowRight, TimerReset } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export default function TodayPage() {
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <p className="font-mono text-xs tracking-[0.18em] text-stone-500 uppercase">
          Today
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          准备开始什么？
        </h1>
      </header>
      <Card className="border-dashed border-stone-300 bg-transparent shadow-none">
        <CardContent className="flex min-h-72 flex-col items-start justify-center gap-5 p-8 sm:p-12">
          <span className="grid size-12 place-items-center rounded-full bg-stone-900 text-stone-50">
            <TimerReset aria-hidden="true" />
          </span>
          <div className="max-w-xl space-y-2">
            <h2 className="text-2xl font-medium">还没有可执行的 Track</h2>
            <p className="leading-7 text-stone-600">
              Time OS 不会填充示例数据。Goal、Track 和 Task 管理将在 T02 实现。
            </p>
          </div>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-stone-700">
            从 Goals 建立第一条推进线 <ArrowRight className="size-4" />
          </span>
        </CardContent>
      </Card>
    </div>
  );
}
