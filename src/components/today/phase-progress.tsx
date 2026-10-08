import { configOf, plannedPhases } from "@/shared/pomodoro";
import type { SessionPhase } from "@/db/schema";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export const phaseColors = {
  focus: {
    dot: "bg-[#d85c41]",
    surface: "bg-[#fdf0ea]",
    text: "text-[#b54b35]",
  },
  short_break: {
    dot: "bg-[#70917b]",
    surface: "bg-[#edf3ee]",
    text: "text-[#4f705a]",
  },
  long_break: {
    dot: "bg-[#b49350]",
    surface: "bg-[#faf2df]",
    text: "text-[#8b6b2f]",
  },
};

export function PhaseProgress({
  config,
  phases = [],
  currentId,
  isPending = false,
  allComplete = false,
}: {
  config: unknown;
  phases?: SessionPhase[];
  currentId?: string;
  isPending?: boolean;
  allComplete?: boolean;
}) {
  const settings = configOf(config);
  const timeline = plannedPhases(settings);
  // Keep actual skipped breaks and extra rounds visible without inventing elapsed phases.
  const items = phases.length
    ? [
        ...phases.map((p) => ({
          kind: p.kind,
          minutes:
            settings[
              p.kind === "focus"
                ? "focusMinutes"
                : p.kind === "long_break"
                  ? "longBreakMinutes"
                  : "shortBreakMinutes"
            ],
          id: p.id,
          complete: p.complete,
          ended:
            !!p.endedAt ||
            allComplete ||
            (isPending && (p.id === currentId || !currentId)),
        })),
        ...timeline
          .slice(
            phases.filter((p) => p.kind === "focus").length * 2 -
              (phases.at(-1)?.kind === "focus" ? 1 : 0),
          )
          .map((p) => ({ ...p, id: undefined, complete: false, ended: false })),
      ]
    : timeline.map((p) => ({
        ...p,
        id: undefined,
        complete: false,
        ended: false,
      }));

  const pendingIndex =
    isPending && phases.length < items.length ? phases.length : -1;

  let round = 0;
  return (
    <TooltipProvider delay={200}>
      <div
        className="flex max-w-full flex-wrap justify-center gap-2.5"
        aria-label="番茄钟阶段"
      >
        {items.map((item, index) => {
          if (item.kind === "focus") round++;
          const label = `${item.kind === "focus" ? `第 ${round} 轮专注` : item.kind === "long_break" ? "长休息" : "短休息"} · ${item.minutes} 分钟`;
          const isCurrent =
            !isPending &&
            !allComplete &&
            item.id !== undefined &&
            item.id === currentId;
          const isPendingItem = index === pendingIndex;
          const hasHalo = isCurrent || isPendingItem;
          const statusText = isCurrent
            ? " · 当前阶段"
            : isPendingItem
              ? " · 待开始"
              : item.ended
                ? " · 已结束"
                : " · 待开始";
          const ariaStatus = isCurrent
            ? "，当前阶段"
            : isPendingItem
              ? "，待开始"
              : item.ended
                ? "，已结束"
                : "，待开始";

          return (
            <Tooltip key={item.id ?? `planned-${index}`}>
              <TooltipTrigger
                render={<span />}
                tabIndex={0}
                aria-label={`${label}${ariaStatus}`}
                aria-current={isCurrent || isPendingItem ? "step" : undefined}
                className={`flex h-3 w-1.5 items-center justify-center rounded-full transition-shadow ${hasHalo ? "shadow-[0_0_0_3px_rgba(120,113,108,0.12)]" : ""}`}
              >
                <span
                  className={`size-full rounded-full transition-opacity ${phaseColors[item.kind].dot} ${isCurrent ? "" : item.ended ? "opacity-70" : "opacity-25"}`}
                />
              </TooltipTrigger>
              <TooltipContent>
                {label}
                {statusText}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
