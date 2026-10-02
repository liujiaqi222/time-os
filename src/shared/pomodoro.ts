import type { SessionPhase, Session } from "@/db/schema";
import { timerConfigSchema } from "@/shared/schemas/session";

export function configOf(value: unknown) {
  return timerConfigSchema.parse(value ?? {});
}

export function phaseRemainingMs(phase: SessionPhase, now: Date): number {
  if (phase.endedAt) return 0;
  if (phase.pausedAt) return phase.remainingMs;
  return Math.max(0, new Date(phase.deadlineAt!).getTime() - now.getTime());
}

export function projectPhases(
  session: Pick<Session, "status" | "timerConfig">,
  phases: SessionPhase[],
  now: Date,
) {
  const projected = phases.map((p) => {
    const due = !p.endedAt && !p.pausedAt && phaseRemainingMs(p, now) === 0;
    return due
      ? {
          ...p,
          endedAt: p.deadlineAt,
          remainingMs: 0,
          complete: p.kind === "focus",
        }
      : p;
  });
  const current = projected.at(-1) ?? null;
  const terminal =
    session.status === "completed" || session.status === "cancelled";
  const state = terminal
    ? "ended"
    : current?.endedAt
      ? "due"
      : current?.pausedAt
        ? "paused"
        : "running";
  const completedFocusCount = projected.filter(
    (p) => p.kind === "focus" && p.complete,
  ).length;
  const config = configOf(session.timerConfig);
  const breakKind =
    config.longBreakEnabled &&
    completedFocusCount > 0 &&
    completedFocusCount % 4 === 0
      ? "long_break"
      : "short_break";
  const phaseActions =
    state === "ended"
      ? []
      : state === "due"
        ? current?.kind === "focus"
          ? ["start_break", "start_next_focus"]
          : ["start_next_focus"]
        : [
            state === "paused" ? "resume" : "pause",
            ...(current?.kind !== "focus" ? ["start_next_focus"] : []),
          ];
  return {
    phases: projected,
    phase: current
      ? {
          ...current,
          state,
          remainingSeconds: Math.ceil(phaseRemainingMs(current, now) / 1000),
        }
      : null,
    completedFocusCount,
    nextBreakKind: breakKind,
    phaseActions,
  };
}

/** Client anchor advances by monotonic elapsed time, never by local wall-clock offset. */
export function timerDisplay(
  session: {
    focusSeconds: number;
    status: string;
    timerMode: string;
    phase?: { remainingSeconds: number; state: string; kind: string } | null;
  },
  deltaSeconds: number,
) {
  const delta = Math.max(0, Math.floor(deltaSeconds));
  const phase = session.phase;
  if (session.timerMode === "pomodoro" && phase) {
    const remaining = Math.max(
      0,
      phase.remainingSeconds - (phase.state === "running" ? delta : 0),
    );
    return {
      seconds: remaining,
      due:
        phase.state === "due" || (phase.state === "running" && remaining === 0),
      focusSeconds:
        session.focusSeconds +
        (phase.kind === "focus" && phase.state === "running"
          ? Math.min(delta, phase.remainingSeconds)
          : 0),
    };
  }
  const seconds =
    session.focusSeconds + (session.status === "active" ? delta : 0);
  return { seconds, due: false, focusSeconds: seconds };
}

import type { TimerConfig } from "@/shared/schemas/session";
export function plannedPhases(config: TimerConfig) {
  return Array.from({ length: config.iterations }, (_, index) => {
    const focus = { kind: "focus" as const, minutes: config.focusMinutes };
    if (index === config.iterations - 1) return [focus];
    const long = config.longBreakEnabled && (index + 1) % 4 === 0;
    return [
      focus,
      {
        kind: long ? ("long_break" as const) : ("short_break" as const),
        minutes: long ? config.longBreakMinutes : config.shortBreakMinutes,
      },
    ];
  }).flat();
}
