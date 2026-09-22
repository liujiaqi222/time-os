import Link from "next/link";
import { ArrowRight, CheckCircle2, TimerReset } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { planningService } from "@/services";

export default async function TodayPage() {
  const nextItems = await planningService.getNext({ actor: "web" });
  const tracks = Array.isArray(nextItems) ? nextItems : [];
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
      {tracks.length === 0 ? (
        <Card className="border-dashed border-stone-300 bg-transparent shadow-none">
          <CardContent className="flex min-h-72 flex-col items-start justify-center gap-5 p-8 sm:p-12">
            <span className="grid size-12 place-items-center rounded-full bg-stone-900 text-stone-50">
              <TimerReset aria-hidden="true" />
            </span>
            <div className="max-w-xl space-y-2">
              <h2 className="text-2xl font-medium">还没有可执行的 Track</h2>
              <p className="leading-7 text-stone-600">
                先建立 Goal、Track 与 Task，Time OS
                会把每条推进线的下一步带到这里。
              </p>
            </div>
            <Button
              nativeButton={false}
              variant="outline"
              render={<Link href="/goals" />}
            >
              从 Goals 开始 <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {tracks.map(({ track, task }) => (
            <Card
              key={track.id}
              className={task ? "bg-white" : "border-dashed bg-transparent"}
            >
              <CardContent className="flex min-h-52 flex-col justify-between gap-6 p-6">
                <div className="space-y-2">
                  <p className="font-mono text-xs tracking-[0.16em] text-stone-500 uppercase">
                    {track.title}
                  </p>
                  <h2 className="text-2xl font-medium">
                    {task?.title ?? "尚未选择 Current Next"}
                  </h2>
                  {task?.estimatedMinutes && (
                    <p className="text-sm text-stone-500">
                      预计 {task.estimatedMinutes} 分钟
                    </p>
                  )}
                </div>
                <Button
                  nativeButton={false}
                  variant={task ? "default" : "outline"}
                  render={<Link href={`/tracks/${track.id}`} />}
                >
                  {task ? <CheckCircle2 /> : <TimerReset />}
                  {task ? "查看下一步" : "选择下一步"}
                  <ArrowRight />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
