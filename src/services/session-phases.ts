import { and, asc, eq, isNull } from "drizzle-orm";
import {
  focusIntervals,
  sessionPhases,
  type Session,
  type SessionPhase,
} from "@/db/schema";
import type { Database } from "@/db/client";
import type { Transaction } from "@/services/service-kit";
import { configOf, phaseRemainingMs } from "@/shared/pomodoro";

export async function loadPhases(tx: Database | Transaction, id: string) {
  return tx
    .select()
    .from(sessionPhases)
    .where(eq(sessionPhases.sessionId, id))
    .orderBy(asc(sessionPhases.sequence));
}

export async function openPhase(
  tx: Transaction,
  session: Session,
  kind: SessionPhase["kind"],
  sequence: number,
  now: Date,
) {
  const config = configOf(session.timerConfig);
  const minutes =
    kind === "focus"
      ? config.focusMinutes
      : kind === "short_break"
        ? config.shortBreakMinutes
        : config.longBreakMinutes;
  const remainingMs = minutes * 60_000;
  const deadlineAt = new Date(now.getTime() + remainingMs);
  const [phase] = await tx
    .insert(sessionPhases)
    .values({
      sessionId: session.id,
      kind,
      sequence,
      startedAt: now,
      deadlineAt,
      remainingMs,
    })
    .returning();
  await tx.insert(focusIntervals).values({
    sessionId: session.id,
    phaseId: phase.id,
    phase: kind,
    startedAt: now,
    deadlineAt,
  });
  return phase;
}

/** Called under the Session lock before every command. Reads use the same deadline projection without writing. */
export async function settlePhase(
  tx: Transaction,
  session: Session,
  now: Date,
) {
  if (session.timerMode !== "pomodoro") return null;
  const phase = (await loadPhases(tx, session.id)).at(-1)!;
  if (!phase.endedAt && !phase.pausedAt && phaseRemainingMs(phase, now) === 0) {
    const [closed] = await tx
      .update(sessionPhases)
      .set({
        endedAt: phase.deadlineAt,
        remainingMs: 0,
        complete: phase.kind === "focus",
      })
      .where(eq(sessionPhases.id, phase.id))
      .returning();
    await tx
      .update(focusIntervals)
      .set({ endedAt: phase.deadlineAt, updatedAt: now })
      .where(
        and(
          eq(focusIntervals.phaseId, phase.id),
          isNull(focusIntervals.endedAt),
        ),
      );
    return closed;
  }
  return phase;
}

export async function pausePhase(
  tx: Transaction,
  phase: SessionPhase,
  now: Date,
) {
  await tx
    .update(sessionPhases)
    .set({
      pausedAt: now,
      remainingMs: phaseRemainingMs(phase, now),
      deadlineAt: null,
    })
    .where(eq(sessionPhases.id, phase.id));
}

export async function resumePhase(
  tx: Transaction,
  phase: SessionPhase,
  now: Date,
) {
  const deadlineAt = new Date(now.getTime() + phase.remainingMs);
  await tx
    .update(sessionPhases)
    .set({ pausedAt: null, deadlineAt })
    .where(eq(sessionPhases.id, phase.id));
  await tx.insert(focusIntervals).values({
    sessionId: phase.sessionId,
    phaseId: phase.id,
    phase: phase.kind,
    startedAt: now,
    deadlineAt,
  });
}

export async function endPhase(
  tx: Transaction,
  phase: SessionPhase | null,
  now: Date,
) {
  if (phase && !phase.endedAt)
    await tx
      .update(sessionPhases)
      .set({ endedAt: now, remainingMs: phaseRemainingMs(phase, now) })
      .where(eq(sessionPhases.id, phase.id));
}
