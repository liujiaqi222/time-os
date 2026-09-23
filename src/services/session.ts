import { eq, inArray } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import { goals, sessions, tasks, tracks } from "@/db/schema";
import type { Distraction, Session, Task, Track } from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  sessionCancelSchema,
  sessionFinishInputSchema,
  sessionNoteUpdateSchema,
  sessionPauseSchema,
  sessionResumeSchema,
  sessionReviewSchema,
  sessionStartSchema,
  type SessionFinishInput,
  type SessionReviewInput,
  type SessionStartInput,
} from "@/shared/schemas/session";
import { calculateDurationSecondsOnFinish } from "@/shared/session-timer";
import { currentNextForTrack, transitionTask } from "@/services/current-next";
import type { DistractionService } from "@/services/distraction";
import { requestHashOf, withIdempotency } from "@/services/idempotency";
import {
  invalid,
  lockScope,
  parsed,
  type Transaction,
} from "@/services/service-kit";

export type { Session } from "@/db/schema";

export interface SessionWithRelations extends Session {
  track: Track;
  task: Task | null;
  distractions?: Distraction[];
}

export interface SessionReviewResult {
  session: Session;
  task: Task | null;
  nextTask: Task | null;
}

export interface SessionService {
  getActiveSession(
    context: AuthenticatedContext,
  ): Promise<SessionWithRelations | null>;
  getSession(
    context: AuthenticatedContext,
    id: string,
  ): Promise<SessionWithRelations>;
  startSession(
    context: AuthenticatedContext,
    input: SessionStartInput,
  ): Promise<Session>;
  pauseSession(context: AuthenticatedContext, id: string): Promise<Session>;
  resumeSession(context: AuthenticatedContext, id: string): Promise<Session>;
  finishSession(
    context: AuthenticatedContext,
    id: string,
    input?: SessionFinishInput,
  ): Promise<Session>;
  cancelSession(context: AuthenticatedContext, id: string): Promise<Session>;
  finishSessionReview(
    context: AuthenticatedContext,
    input: SessionReviewInput,
  ): Promise<SessionReviewResult>;
  updateSessionNote(
    context: AuthenticatedContext,
    id: string,
    note: string | null,
  ): Promise<Session>;
}

export function createSessionService(
  database: Database,
  deps: { distractionService: Pick<DistractionService, "listDistractions"> },
): SessionService {
  const { distractionService } = deps;

  async function findActiveSessionRow(
    tx: Database | Transaction,
  ): Promise<SessionWithRelations | null> {
    const rows = await tx
      .select({
        session: sessions,
        track: tracks,
        task: tasks,
      })
      .from(sessions)
      .innerJoin(tracks, eq(sessions.trackId, tracks.id))
      .leftJoin(tasks, eq(sessions.taskId, tasks.id))
      .where(inArray(sessions.status, ["active", "paused"] as const))
      .limit(1);

    if (!rows.length || !rows[0]) return null;
    return {
      ...rows[0].session,
      track: rows[0].track,
      task: rows[0].task,
    };
  }

  return {
    async getActiveSession(context) {
      void context;
      return findActiveSessionRow(database);
    },

    async getSession(context, id) {
      if (!id) invalid("Session ID is required.", "id");

      // Independent reads — run in parallel (saves a round trip). The
      // Distraction module owns the distraction query; this composite read
      // composes its interface instead of re-querying the table.
      const [rows, distractionRows] = await Promise.all([
        database
          .select({
            session: sessions,
            track: tracks,
            task: tasks,
          })
          .from(sessions)
          .innerJoin(tracks, eq(sessions.trackId, tracks.id))
          .leftJoin(tasks, eq(sessions.taskId, tasks.id))
          .where(eq(sessions.id, id))
          .limit(1),
        distractionService.listDistractions(context, {
          sessionId: id,
          includeArchived: true,
        }),
      ]);

      if (!rows.length || !rows[0]) {
        throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
          sessionId: id,
        });
      }

      return {
        ...rows[0].session,
        track: rows[0].track,
        task: rows[0].task,
        distractions: distractionRows,
      };
    },

    async startSession(context, input) {
      const value = parsed(sessionStartSchema.safeParse(input));
      const requestHash = requestHashOf({
        trackId: value.trackId,
        taskId: value.taskId ?? null,
        plannedMinutes: value.plannedMinutes ?? null,
      });

      return database.transaction(async (tx) => {
        await lockScope(tx, "sessions:running");
        await lockScope(tx, "sessions:timeline");

        // Claim / replay / record discipline lives in the idempotency
        // module — the same implementation tasks_create uses and
        // session_log will reuse (PRD §4.7).
        return withIdempotency({
          tx,
          operation: "session_start",
          key: value.idempotencyKey,
          requestHash,
          replay: async (recorded) => {
            const existingSessionId = (
              recorded as { sessionId?: string } | null
            )?.sessionId;
            if (!existingSessionId) return null;
            const [session] = await tx
              .select()
              .from(sessions)
              .where(eq(sessions.id, existingSessionId))
              .limit(1);
            return session ?? null;
          },
          run: async () => {
            // Check if an active or paused session already exists
            const [existingRunning] = await tx
              .select({ id: sessions.id })
              .from(sessions)
              .where(inArray(sessions.status, ["active", "paused"] as const))
              .limit(1);

            if (existingRunning) {
              throw new DomainError(
                "ACTIVE_SESSION_EXISTS",
                "An active or paused session already exists.",
                { sessionId: existingRunning.id },
              );
            }

            // Validate Track and its parent Goal
            const [trackWithGoal] = await tx
              .select({
                track: tracks,
                goalStatus: goals.status,
              })
              .from(tracks)
              .innerJoin(goals, eq(tracks.goalId, goals.id))
              .where(eq(tracks.id, value.trackId))
              .limit(1);

            if (!trackWithGoal) {
              throw new DomainError("TRACK_NOT_FOUND", "Track was not found.", {
                trackId: value.trackId,
              });
            }

            if (trackWithGoal.goalStatus !== "active") {
              throw new DomainError(
                "GOAL_NOT_ACTIVE",
                "Cannot start a session under an inactive Goal.",
              );
            }

            if (trackWithGoal.track.status !== "active") {
              throw new DomainError(
                "TRACK_NOT_ACTIVE",
                "Cannot start a session under an inactive Track.",
              );
            }

            // Validate Task if provided
            if (value.taskId) {
              const [task] = await tx
                .select()
                .from(tasks)
                .where(eq(tasks.id, value.taskId))
                .limit(1);

              if (!task) {
                throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
                  taskId: value.taskId,
                });
              }

              if (task.trackId !== value.trackId) {
                throw new DomainError(
                  "TASK_NOT_IN_TRACK",
                  "Task does not belong to the selected Track.",
                );
              }

              if (task.status !== "pending") {
                throw new DomainError(
                  task.status === "completed"
                    ? "TASK_ALREADY_COMPLETED"
                    : "TASK_NOT_PENDING",
                  "Only pending tasks can be started.",
                );
              }
            }

            const createdVia = context.actor === "mcp" ? "mcp" : "web";
            const [session] = await tx
              .insert(sessions)
              .values({
                trackId: value.trackId,
                taskId: value.taskId ?? null,
                status: "active",
                entryMode: "timer",
                createdVia,
                plannedMinutes: value.plannedMinutes ?? null,
                startedAt: new Date(),
                totalPausedSeconds: 0,
                durationSeconds: null,
                pausedAt: null,
                note: null,
              })
              .returning();

            return {
              value: session!,
              result: { sessionId: session!.id },
              resultRef: session!.id,
            };
          },
        });
      });
    },

    async pauseSession(_context, id) {
      void _context;
      parsed(sessionPauseSchema.safeParse({ id }));

      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);

        const [session] = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, id))
          .limit(1);

        if (!session) {
          throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
            sessionId: id,
          });
        }

        // Idempotent: already paused
        if (session.status === "paused") {
          return session;
        }

        if (session.status !== "active") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only an active session can be paused.",
          );
        }

        const [updated] = await tx
          .update(sessions)
          .set({
            status: "paused",
            pausedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, id))
          .returning();

        return updated!;
      });
    },

    async resumeSession(_context, id) {
      void _context;
      parsed(sessionResumeSchema.safeParse({ id }));

      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);

        const [session] = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, id))
          .limit(1);

        if (!session) {
          throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
            sessionId: id,
          });
        }

        // Idempotent: already active
        if (session.status === "active") {
          return session;
        }

        if (session.status !== "paused") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only a paused session can be resumed.",
          );
        }

        const now = new Date();
        const pauseElapsed = session.pausedAt
          ? Math.max(
              0,
              Math.floor((now.getTime() - session.pausedAt.getTime()) / 1000),
            )
          : 0;

        const [updated] = await tx
          .update(sessions)
          .set({
            status: "active",
            pausedAt: null,
            totalPausedSeconds: session.totalPausedSeconds + pauseElapsed,
            updatedAt: now,
          })
          .where(eq(sessions.id, id))
          .returning();

        return updated!;
      });
    },

    async finishSession(_context, id, input) {
      void _context;
      if (input) parsed(sessionFinishInputSchema.safeParse(input));

      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);

        const [session] = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, id))
          .limit(1);

        if (!session) {
          throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
            sessionId: id,
          });
        }

        // Idempotent finish
        if (session.status === "completed") {
          return session;
        }

        if (session.status !== "active" && session.status !== "paused") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only active or paused sessions can be finished.",
          );
        }

        const now = new Date();
        const durationSeconds = calculateDurationSecondsOnFinish(session, now);

        const [updated] = await tx
          .update(sessions)
          .set({
            status: "completed",
            endedAt: now,
            durationSeconds,
            pausedAt: null,
            note: input?.note !== undefined ? input.note : session.note,
            updatedAt: now,
          })
          .where(eq(sessions.id, id))
          .returning();

        return updated!;
      });
    },

    async cancelSession(_context, id) {
      void _context;
      parsed(sessionCancelSchema.safeParse({ id }));

      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);

        const [session] = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, id))
          .limit(1);

        if (!session) {
          throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
            sessionId: id,
          });
        }

        // Idempotent cancel
        if (session.status === "cancelled") {
          return session;
        }

        // Completed records may be cancelled as a reversible correction;
        // cancelled records remain readable but can never be revived.
        const now = new Date();
        const [updated] = await tx
          .update(sessions)
          .set({
            status: "cancelled",
            endedAt: now,
            pausedAt: null,
            updatedAt: now,
          })
          .where(eq(sessions.id, id))
          .returning();

        return updated!;
      });
    },

    async finishSessionReview(_context, input) {
      void _context;
      const value = parsed(sessionReviewSchema.safeParse(input));

      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${value.sessionId}`);

        const [session] = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, value.sessionId))
          .limit(1);

        if (!session) {
          throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
            sessionId: value.sessionId,
          });
        }

        // If already completed: idempotent early-return.
        // Safety check: if the task is still pending but outcome requires a
        // status change, the session was likely finished via finishSession()
        // without processing the task. In that case, proceed to apply the
        // task outcome instead of returning stale data.
        if (session.status === "completed") {
          let taskNeedsProcessing = false;
          if (
            session.taskId &&
            (value.outcome === "completed" || value.outcome === "skip")
          ) {
            const [task] = await tx
              .select()
              .from(tasks)
              .where(eq(tasks.id, session.taskId))
              .limit(1);
            if (task?.status === "pending") {
              taskNeedsProcessing = true;
            }
          }

          if (!taskNeedsProcessing) {
            const [task] = session.taskId
              ? await tx
                  .select()
                  .from(tasks)
                  .where(eq(tasks.id, session.taskId))
                  .limit(1)
              : [null];
            return {
              session,
              task: task ?? null,
              nextTask: await currentNextForTrack(tx, session.trackId),
            };
          }
          // Fall through to process the task outcome on the already-completed session
        }

        if (
          session.status !== "active" &&
          session.status !== "paused" &&
          session.status !== "completed"
        ) {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only active or paused sessions can be finished.",
          );
        }

        const sessionAlreadyCompleted = session.status === "completed";

        let updatedTask: Task | null = null;
        let nextTask: Task | null = null;

        if (value.outcome === "completed" || value.outcome === "skip") {
          if (!session.taskId) {
            throw new DomainError(
              "INVALID_INPUT",
              "Cannot complete or skip a task on a session without a task.",
            );
          }

          // The CurrentNext module owns the lock discipline, task validation
          // and pointer advancement — the same implementation Planning
          // transitions use (PRD §6.3).
          const transitioned = await transitionTask(
            tx,
            session.taskId,
            value.outcome === "completed" ? "completed" : "skipped",
          );
          updatedTask = transitioned.affectedTask;
          nextTask = transitioned.nextTask;
        } else {
          // continue_later or no outcome: leave the task and pointer alone.
          if (session.taskId) {
            const [task] = await tx
              .select()
              .from(tasks)
              .where(eq(tasks.id, session.taskId))
              .limit(1);
            updatedTask = task ?? null;
          }
          nextTask = await currentNextForTrack(tx, session.trackId);
        }

        const now = new Date();
        // Skip session finishing if it was already completed (fall-through
        // from the idempotent check above where only the task needed processing)
        if (sessionAlreadyCompleted) {
          // Update the note if a new one was provided
          if (value.note !== undefined && value.note !== session.note) {
            await tx
              .update(sessions)
              .set({ note: value.note, updatedAt: now })
              .where(eq(sessions.id, value.sessionId));
          }
          return {
            session: {
              ...session,
              note: value.note !== undefined ? value.note : session.note,
            },
            task: updatedTask,
            nextTask,
          };
        }

        const durationSeconds = calculateDurationSecondsOnFinish(session, now);

        const [completedSession] = await tx
          .update(sessions)
          .set({
            status: "completed",
            endedAt: now,
            durationSeconds,
            pausedAt: null,
            note: value.note !== undefined ? value.note : session.note,
            updatedAt: now,
          })
          .where(eq(sessions.id, value.sessionId))
          .returning();

        return {
          session: completedSession!,
          task: updatedTask,
          nextTask,
        };
      });
    },

    async updateSessionNote(_context, id, note) {
      void _context;
      parsed(sessionNoteUpdateSchema.safeParse({ id, note }));

      const [existing] = await database
        .select()
        .from(sessions)
        .where(eq(sessions.id, id))
        .limit(1);

      if (!existing) {
        throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
          sessionId: id,
        });
      }

      if (existing.status !== "active" && existing.status !== "paused") {
        throw new DomainError(
          "INVALID_SESSION_STATE",
          "Session note can only be auto-saved while session is active or paused.",
        );
      }

      const [updated] = await database
        .update(sessions)
        .set({
          note,
          updatedAt: new Date(),
        })
        .where(eq(sessions.id, id))
        .returning();

      return updated!;
    },
  };
}
