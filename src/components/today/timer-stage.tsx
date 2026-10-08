import type { ReactNode } from "react";

export function TimerStage({
  progress,
  children,
  className = "",
}: {
  progress?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="mt-3 flex w-full flex-col items-center gap-2 sm:mt-6 sm:gap-4">
      <div
        className={`grid h-28 w-full shrink-0 place-items-center sm:h-[clamp(11rem,24vh,16rem)] ${className}`}
      >
        {children}
      </div>
      <div className="flex h-6 w-full max-w-sm items-center justify-center px-4">
        {progress}
      </div>
    </div>
  );
}

export function TimerControls({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-2 sm:gap-3">
      {children}
    </div>
  );
}
