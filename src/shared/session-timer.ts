export interface SessionTimerData {
  startedAt: Date | string;
  pausedAt?: Date | string | null;
  totalPausedSeconds: number;
  durationSeconds?: number | null;
  status: "active" | "paused" | "completed" | "cancelled";
}

export function calculateElapsedSeconds(
  session: SessionTimerData,
  now: Date = new Date(),
): number {
  if (session.status === "completed" || session.status === "cancelled") {
    return Math.max(0, session.durationSeconds ?? 0);
  }

  const startedAtMs = new Date(session.startedAt).getTime();
  const totalPaused = session.totalPausedSeconds ?? 0;

  if (session.status === "paused" && session.pausedAt) {
    const pausedAtMs = new Date(session.pausedAt).getTime();
    return Math.max(
      0,
      Math.floor((pausedAtMs - startedAtMs) / 1000) - totalPaused,
    );
  }

  const nowMs = now.getTime();
  return Math.max(0, Math.floor((nowMs - startedAtMs) / 1000) - totalPaused);
}

export function calculateDurationSecondsOnFinish(
  session: SessionTimerData,
  now: Date = new Date(),
): number {
  if (session.status === "paused" && session.pausedAt) {
    const startedAtMs = new Date(session.startedAt).getTime();
    const pausedAtMs = new Date(session.pausedAt).getTime();
    const totalPaused = session.totalPausedSeconds ?? 0;
    return Math.max(
      0,
      Math.floor((pausedAtMs - startedAtMs) / 1000) - totalPaused,
    );
  }

  return calculateElapsedSeconds(session, now);
}

export function formatTimeDigits(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");

  if (hours > 0) {
    const hh = String(hours).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  return `${mm}:${ss}`;
}

export function formatHumanDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
