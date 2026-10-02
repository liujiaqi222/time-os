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
    <div className="mt-4 flex w-full flex-col items-center gap-3">
      <div className="flex h-8 w-full max-w-sm items-center justify-center px-4">
        {progress}
      </div>
      <div
        className={`grid size-64 shrink-0 place-items-center rounded-full transition-colors sm:size-80 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
