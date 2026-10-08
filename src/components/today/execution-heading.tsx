import type { ReactNode } from "react";
import { ChevronDown, Sparkles } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ExecutionHeading({
  goal,
  task,
  resumeHint,
  children,
}: {
  goal: string;
  task?: string | null;
  resumeHint?: string | null;
  children?: ReactNode;
}) {
  return (
    <>
      {children ?? (
        <TooltipProvider delay={200}>
          <div className="flex w-full flex-col items-stretch rounded-2xl border border-stone-200 bg-white p-1.5 shadow-[0_1px_2px_rgba(28,25,23,0.05)] sm:w-auto sm:flex-row sm:items-center sm:rounded-full sm:p-1">
            {(
              [
                ["目标", goal],
                ["任务", task ?? "不设任务"],
              ] as const
            ).map(([label, value], index) => (
              <div key={label} className="contents">
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className="h-px w-full bg-stone-100 sm:mx-1 sm:h-5 sm:w-px sm:bg-stone-200"
                  />
                )}
                <Tooltip>
                  <TooltipTrigger
                    render={<span />}
                    tabIndex={0}
                    aria-label={`${label}：${value}，执行中不可切换`}
                    className="flex w-full cursor-not-allowed rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-stone-300 sm:w-auto sm:rounded-full"
                  >
                    <button
                      type="button"
                      disabled
                      className="pointer-events-none flex h-9 w-full min-w-0 items-center gap-1.5 rounded-[10px] bg-stone-100/70 px-3 text-sm sm:w-auto sm:max-w-56 sm:rounded-full sm:px-3.5"
                    >
                      <span className="shrink-0 text-xs text-stone-400">
                        {label}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-left font-medium text-stone-400">
                        {value}
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className="size-4 shrink-0 text-stone-300"
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="flex flex-col items-start gap-0.5 text-left">
                    <span className="text-background font-medium">{value}</span>
                    <span className="text-background/80 text-[11px] leading-relaxed">
                      执行中不可切换{label}，请先结束或取消本次执行。
                    </span>
                  </TooltipContent>
                </Tooltip>
              </div>
            ))}
          </div>
        </TooltipProvider>
      )}
      {resumeHint && (
        <p className="mt-5 flex max-w-sm items-start gap-2 rounded-2xl bg-amber-50/90 px-3.5 py-2.5 text-left text-sm leading-6 text-amber-950">
          <Sparkles
            className="mt-1 size-3.5 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <span>
            <span className="font-medium">接续提示：</span>
            {resumeHint}
          </span>
        </p>
      )}
    </>
  );
}
