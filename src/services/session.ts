import { asc, eq, inArray, isNull, and } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import {
  focusIntervals,
  goals,
  sessions,
  tasks,
  type Distraction,
  type FocusInterval,
  type Goal,
  type Session,
  type Task,
} from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  sessionCancelSchema,
  sessionFinishSchema,
  sessionNoteUpdateSchema,
  sessionPauseSchema,
  sessionResumeHintUpdateSchema,
  sessionResumeSchema,
  sessionStartSchema,
  type SessionNoteUpdateInput,
  type SessionResumeHintUpdateInput,
  type SessionStartInput,
} from "@/shared/schemas/session";
import { focusSecondsOfIntervals } from "@/shared/session-timer";
import { applySelection } from "@/services/selection";
import { requestHashOf, withIdempotency } from "@/services/idempotency";
import { lockScope, parsed, type Transaction } from "@/services/service-kit";

export type { Session, FocusInterval } from "@/db/schema";

/**
 * The stopwatch execution loop (PRD §6.1–6.2, §6.5).
 *
 * - start validates the Goal/Task, opens a focus interval and syncs the
 *   selection; pause closes the interval, resume opens a new one, finish
 *   closes and freezes the authoritative duration from the intervals.
 * - pause/resume/finish/cancel are idempotent: a lost response can be
 *   retried without duplicating Sessions or intervals.
 * - note and resumeHint carry independent content versions; a stale
 *   expectedVersion is a VERSION_CONFLICT, never a silent overwrite.
 */

export interface SessionView extends Session {
  goal: Goal;
  task: Task | null;
  intervals: FocusInterval[];
  serverNow: string;
  /** Authoritative focus seconds at serverNow (PRD §6.1). */
  focusSeconds: number;
  /** Operations available in the current state. */
  actions: string[];
  /** Set on finish when the supplied note version was stale. */
  noteConflict?: boolean;
}

export interface SessionDetail extends SessionView {
  distractions: Distraction[];
}

/** Options for finishSession; `id` comes from the call itself. */
export interface SessionFinishOptions {
  note?: string | null;
  noteExpectedVersion?: number;
}

export interface SessionService {
  getActiveSession(context: AuthenticatedContext): Promise<SessionView | null>;
  getSession(context: AuthenticatedContext, id: string): Promise<SessionDetail>;
  startSession(
    context: AuthenticatedContext,
    input: SessionStartInput,
  ): Promise<SessionView>;
  pauseSession(context: AuthenticatedContext, id: string): Promise<SessionView>;
  resumeSession(
    context: AuthenticatedContext,
    id: string,
  ): Promise<SessionView>;
  finishSession(
    context: AuthenticatedContext,
    id: string,
    input?: SessionFinishOptions,
  ): Promise<SessionView>;
  cancelSession(
    context: AuthenticatedContext,
    id: string,
  ): Promise<SessionView>;
  updateNote(
    context: AuthenticatedContext,
    input: SessionNoteUpdateInput,
  ): Promise<SessionView>;
  updateResumeHint(
    context: AuthenticatedContext,
    input: SessionResumeHintUpdateInput,
  ): Promise<SessionView>;
}

export function availableSessionActions(status: Session["status"]): string[] {
  switch (status) {
    case "active":
      return [
        "pause",
        "finish",
        "cancel",
        "note_update",
        "resume_hint_update",
        "distraction_log",
      ];
    case "paused":
      return [
        "resume",
        "finish",
        "cancel",
        "note_update",
        "resume_hint_update",
        "distraction_log",
      ];
    case "completed":
      return ["resume_hint_update"];
    default:
      return [];
  }
}

async function loadIntervals(
  tx: Database | Transaction,
  sessionId: string,
): Promise<FocusInterval[]> {
  return tx
    .select()
    .from(focusIntervals)
    .where(eq(focusIntervals.sessionId, sessionId))
    .orderBy(asc(focusIntervals.startedAt), asc(focusIntervals.id));
}

async function buildView(
  tx: Database | Transaction,
  session: Session,
  now: Date,
): Promise<SessionView> {
  const [[goal], [task], intervals] = await Promise.all([
    tx.select().from(goals).where(eq(goals.id, session.goalId)).limit(1),
    session.taskId
      ? tx.select().from(tasks).where(eq(tasks.id, session.taskId)).limit(1)
      : Promise.resolve([null]),
    loadIntervals(tx, session.id),
  ]);
  if (!goal)
    throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", {
      goalId: session.goalId,
    });
  return {
    ...session,
    goal,
    task: task ?? null,
    intervals,
    serverNow: now.toISOString(),
    focusSeconds: focusSecondsOfIntervals(intervals, now),
    actions: availableSessionActions(session.status),
  };
}

async function findSessionRow(
  tx: Database | Transaction,
  id: string,
): Promise<Session> {
  if (!id) {
    throw new DomainError("INVALID_INPUT", "Session id is required.", {
      field: "id",
    });
  }
  const [session] = await tx
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  if (!session)
    throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
      sessionId: id,
    });
  return session;
}

/** Close every open interval of the Session at `now` (pause/finish/cancel). */
async function closeOpenIntervals(
  tx: Transaction,
  sessionId: string,
  now: Date,
): Promise<void> {
  await tx
    .update(focusIntervals)
    .set({ endedAt: now, updatedAt: now })
    .where(
      and(
        eq(focusIntervals.sessionId, sessionId),
        isNull(focusIntervals.endedAt),
      ),
    );
}

export function createSessionService(
  database: Database,
  deps: {
    distractionService: Pick<
      import("@/services/distraction").DistractionService,
      "listDistractions"
    >;
  },
): SessionService {
  const { distractionService } = deps;

  async function viewOfRow(
    tx: Database | Transaction,
    session: Session,
    now = new Date(),
  ): Promise<SessionView> {
    return buildView(tx, session, now);
  }

  return {
    async getActiveSession(context) {
      void context;
      const now = new Date();
      const [row] = await database
        .select()
        .from(sessions)
        .where(inArray(sessions.status, ["active", "paused"] as const))
        .limit(1);
      return row ? viewOfRow(database, row, now) : null;
    },

    async getSession(context, id) {
      void context;
      const now = new Date();
      const session = await findSessionRow(database, id);
      const [view, distractionRows] = await Promise.all([
        viewOfRow(database, session, now),
        distractionService.listDistractions(context, {
          sessionId: id,
          includeArchived: true,
        }),
      ]);
      return { ...view, distractions: distractionRows };
    },

    async startSession(context, input) {
      const value = parsed(sessionStartSchema.safeParse(input));
      const requestHash = requestHashOf({
        goalId: value.goalId,
        taskId: value.taskId ?? null,
        timerMode: value.timerMode,
        intent: value.intent ?? null,
      });

      return database.transaction(async (tx) => {
        // Global open-Session exclusivity first, then the selection sync
        // (global lock order: sessions:running → app:selection).
        await lockScope(tx, "sessions:running");
        await lockScope(tx, "app:selection");

        const startedAt = new Date();
        const session = await withIdempotency({
          tx,
          operation: "session_start",
          key: value.idempotencyKey,
          requestHash,
          replay: async (recorded) => {
            const sessionId = (recorded as { sessionId?: string } | null)
              ?.sessionId;
            if (!sessionId) return null;
            const [row] = await tx
              .select()
              .from(sessions)
              .where(eq(sessions.id, sessionId))
              .limit(1);
            return row ?? null;
          },
          run: async () => {
            const [existingOpen] = await tx
              .select({ id: sessions.id })
              .from(sessions)
              .where(inArray(sessions.status, ["active", "paused"] as const))
              .limit(1);
            if (existingOpen) {
              throw new DomainError(
                "ACTIVE_SESSION_EXISTS",
                "An unfinished Session already exists. Finish or cancel it first.",
                { sessionId: existingOpen.id },
              );
            }

            const [goal] = await tx
              .select()
              .from(goals)
              .where(eq(goals.id, value.goalId))
              .limit(1);
            if (!goal)
              throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", {
                goalId: value.goalId,
              });
            if (goal.status !== "active")
              throw new DomainError(
                "GOAL_NOT_ACTIVE",
                "Reactivate the Goal before starting a Session.",
                { goalId: goal.id },
              );

            // Omitted or null taskId = goal-only; an attached Task must be
            // explicit, in the same Goal and pending (PRD §9.2).
            if (value.taskId) {
              const [task] = await tx
                .select()
                .from(tasks)
                .where(eq(tasks.id, value.taskId))
                .limit(1);
              if (!task)
                throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
                  taskId: value.taskId,
                });
              if (task.goalId !== value.goalId)
                throw new DomainError(
                  "TASK_NOT_IN_GOAL",
                  "Task does not belong to this Goal.",
                  { taskId: task.id, goalId: value.goalId },
                );
              if (task.status !== "pending")
                throw new DomainError(
                  "TASK_NOT_PENDING",
                  "Only a pending Task can be executed.",
                  { taskId: task.id },
                );
            }

            const [created] = await tx
              .insert(sessions)
              .values({
                goalId: value.goalId,
                taskId: value.taskId ?? null,
                status: "active",
                entryMode: "timer",
                createdVia: context.actor === "mcp" ? "mcp" : "web",
                timerMode: "stopwatch",
                timeBasis: "observed",
                timerConfig: null,
                intent: value.intent ?? null,
                note: null,
                resumeHint: null,
                startedAt,
                endedAt: null,
                durationSeconds: null,
              })
              .returning();

            await tx.insert(focusIntervals).values({
              sessionId: created!.id,
              phase: "focus",
              startedAt,
            });

            // A successful start syncs the selection (PRD §5.3).
            await applySelection(tx, {
              goalId: value.goalId,
              taskId: value.taskId ?? null,
            });

            return {
              value: created!,
              result: { sessionId: created!.id },
              resultRef: created!.id,
            };
          },
        });

        return viewOfRow(tx, session, startedAt);
      });
    },

    async pauseSession(context, id) {
      void context;
      parsed(sessionPauseSchema.safeParse({ id }));
      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, id);
        const now = new Date();

        if (session.status === "paused") {
          return viewOfRow(tx, session, now);
        }
        if (session.status !== "active") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only an active Session can be paused.",
            { status: session.status },
          );
        }

        await closeOpenIntervals(tx, id, now);
        const [updated] = await tx
          .update(sessions)
          .set({
            status: "paused",
            revision: session.revision + 1,
            updatedAt: now,
          })
          .where(eq(sessions.id, id))
          .returning();
        return viewOfRow(tx, updated!, now);
      });
    },

    async resumeSession(context, id) {
      void context;
      parsed(sessionResumeSchema.safeParse({ id }));
      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, id);
        const now = new Date();

        if (session.status === "active") {
          return viewOfRow(tx, session, now);
        }
        if (session.status !== "paused") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only a paused Session can be resumed.",
            { status: session.status },
          );
        }

        await tx.insert(focusIntervals).values({
          sessionId: id,
          phase: "focus",
          startedAt: now,
        });
        const [updated] = await tx
          .update(sessions)
          .set({
            status: "active",
            revision: session.revision + 1,
            updatedAt: now,
          })
          .where(eq(sessions.id, id))
          .returning();
        return viewOfRow(tx, updated!, now);
      });
    },

    async finishSession(context, id, input) {
      void context;
      const value = parsed(
        sessionFinishSchema.safeParse({ ...(input ?? {}), id }),
      );

      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, value.id);
        const now = new Date();

        // Idempotent: a lost response retry returns the same result.
        if (session.status === "completed") {
          return viewOfRow(tx, session, now);
        }
        if (session.status !== "active" && session.status !== "paused") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only an active or paused Session can be finished.",
            { status: session.status },
          );
        }

        await closeOpenIntervals(tx, id, now);
        const intervals = await loadIntervals(tx, id);
        const durationSeconds = focusSecondsOfIntervals(intervals, now);

        // Optional final note with version check (PRD §6.5): a stale note
        // never overwrites newer content, and never blocks the time save.
        let noteConflict = false;
        let note = session.note;
        let noteVersion = session.noteVersion;
        if (value.note !== undefined) {
          if (
            value.noteExpectedVersion === undefined ||
            value.noteExpectedVersion === session.noteVersion
          ) {
            note = value.note;
            noteVersion = session.noteVersion + 1;
          } else {
            noteConflict = true;
          }
        }

        const [updated] = await tx
          .update(sessions)
          .set({
            status: "completed",
            endedAt: now,
            durationSeconds,
            note,
            noteVersion,
            revision: session.revision + 1,
            updatedAt: now,
          })
          .where(eq(sessions.id, id))
          .returning();

        const view = await viewOfRow(tx, updated!, now);
        return noteConflict ? { ...view, noteConflict: true } : view;
      });
    },

    async cancelSession(context, id) {
      void context;
      parsed(sessionCancelSchema.safeParse({ id }));
      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, id);
        const now = new Date();

        if (session.status === "cancelled") {
          return viewOfRow(tx, session, now);
        }

        await closeOpenIntervals(tx, id, now);
        const [updated] = await tx
          .update(sessions)
          .set({
            status: "cancelled",
            endedAt: now,
            revision: session.revision + 1,
            updatedAt: now,
          })
          .where(eq(sessions.id, id))
          .returning();
        return viewOfRow(tx, updated!, now);
      });
    },

    async updateNote(context, input) {
      void context;
      const value = parsed(sessionNoteUpdateSchema.safeParse(input));
      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${value.id}`);
        const session = await findSessionRow(tx, value.id);
        const now = new Date();

        if (session.status === "cancelled") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "A cancelled Session keeps its text as-is.",
            { status: session.status },
          );
        }
        if (value.expectedVersion !== session.noteVersion) {
          throw new DomainError(
            "VERSION_CONFLICT",
            "The note changed elsewhere. Reload the latest version and retry.",
            {
              expectedVersion: value.expectedVersion,
              currentVersion: session.noteVersion,
            },
          );
        }

        const [updated] = await tx
          .update(sessions)
          .set({
            note: value.note,
            noteVersion: session.noteVersion + 1,
            revision: session.revision + 1,
            updatedAt: now,
          })
          .where(eq(sessions.id, value.id))
          .returning();
        return viewOfRow(tx, updated!, now);
      });
    },

    async updateResumeHint(context, input) {
      void context;
      const value = parsed(sessionResumeHintUpdateSchema.safeParse(input));
      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${value.id}`);
        const session = await findSessionRow(tx, value.id);
        const now = new Date();

        if (session.status === "cancelled") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "A cancelled Session keeps its text as-is.",
            { status: session.status },
          );
        }
        if (value.expectedVersion !== session.resumeHintVersion) {
          throw new DomainError(
            "VERSION_CONFLICT",
            "The resume hint changed elsewhere. Reload the latest version and retry.",
            {
              expectedVersion: value.expectedVersion,
              currentVersion: session.resumeHintVersion,
            },
          );
        }

        const [updated] = await tx
          .update(sessions)
          .set({
            resumeHint: value.resumeHint,
            resumeHintVersion: session.resumeHintVersion + 1,
            revision: session.revision + 1,
            updatedAt: now,
          })
          .where(eq(sessions.id, value.id))
          .returning();
        return viewOfRow(tx, updated!, now);
      });
    },
  };
}
