import { cn } from "cn";

/**
 * Large stopwatch. Digits sit in `1ch` slots and the colon is two dots,
 * so the pairs share one baseline instead of drifting inside a monospace
 * em box.
 */
export function FocusClock({
  value,
  tone = "running",
  className,
  ...rest
}: React.ComponentProps<"div"> & {
  value: string;
  tone?: "running" | "paused";
}) {
  const groups = value.split(":");
  const wide = value.length > 5;

  return (
    <div
      className={cn(
        "relative flex items-center justify-center font-mono leading-none font-medium tabular-nums",
        wide
          ? "text-[3.35rem] sm:text-[5.75rem]"
          : "text-[4.75rem] sm:text-[7.25rem]",
        tone === "paused" ? "text-stone-400" : "text-stone-950",
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
            {group.split("").map((digit, digitIndex) => (
              <span
                key={digitIndex}
                className="inline-flex w-[1ch] items-center justify-center"
              >
                {digit}
              </span>
            ))}
          </span>
        ))}
      </span>
    </div>
  );
}

function ClockColon() {
  return (
    <span className="mx-[0.14em] flex h-[0.42em] flex-col items-center justify-between">
      <span className="block size-[0.085em] rounded-full bg-current" />
      <span className="block size-[0.085em] rounded-full bg-current" />
    </span>
  );
}
