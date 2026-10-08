import { cn } from "cn";

/**
 * Stable digit slots keep the clock still as time changes. A light sans-serif
 * face avoids slashed zeroes, with small separators and explicit unit labels.
 */
export function FocusClock({
  value,
  tone = "running",
  className,
  ...rest
}: React.ComponentProps<"div"> & {
  value: string;
  /** `idle` softens the not-yet-started 00:00 on the execution home. */
  tone?: "running" | "paused" | "idle";
}) {
  const groups = value.split(":");
  const wide = value.length > 5;

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 font-sans leading-none font-light tabular-nums",
        wide
          ? "text-[2.75rem] sm:text-[5rem]"
          : "text-[3.5rem] sm:text-[clamp(5rem,8vw,7rem)]",
        tone === "paused"
          ? "text-stone-400"
          : tone === "idle"
            ? "text-stone-600"
            : "text-stone-950",
        className,
      )}
      style={{ fontVariantNumeric: "tabular-nums lining-nums" }}
      {...rest}
    >
      <span className="sr-only">{value}</span>
      <span aria-hidden="true" className="flex items-center">
        {groups.map((group, groupIndex) => (
          <span key={groupIndex} className="flex items-center">
            {groupIndex > 0 && <ClockColon />}
            <span className="grid grid-rows-[1em_12px] gap-2 sm:gap-4">
              <span className="flex items-center">
                {group.split("").map((digit, digitIndex) => (
                  <span
                    key={digitIndex}
                    className="inline-flex w-[0.62em] items-center justify-center"
                  >
                    {digit}
                  </span>
                ))}
              </span>
              <span className="text-center text-[10px]/3 font-medium tracking-widest text-stone-400">
                {groups.length === 3
                  ? ["时", "分", "秒"][groupIndex]
                  : ["分", "秒"][groupIndex]}
              </span>
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

function ClockColon() {
  return (
    <span className="mx-[0.13em] mb-5 flex h-[0.3em] flex-col items-center justify-between opacity-40 sm:mb-7">
      <span className="block size-[0.045em] rounded-full bg-current" />
      <span className="block size-[0.045em] rounded-full bg-current" />
    </span>
  );
}
