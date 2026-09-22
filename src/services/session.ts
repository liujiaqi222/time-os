import { createHash } from "node:crypto";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
} from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import {
  appSettings,
  distractions,
  goals,
  idempotencyRecords,
  sessions,
  tasks,
  tracks,
} from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  distractionArchiveSchema,
  distractionCreateSchema,
  distractionListSchema,
  distractionUpdateInputSchema,
  sessionCancelSchema,
  sessionFinishInputSchema,
  sessionNoteUpdateSchema,
  sessionPauseSchema,
  sessionResumeSchema,
  sessionReviewSchema,
  sessionStartSchema,
  type DistractionCreateInput,
  type DistractionListInput,
  type DistractionUpdateInput,
  type SessionFinishInput,
  type SessionReviewInput,
  type SessionStartInput,
} from "@/shared/schemas/session";
import { calculateDurationSecondsOnFinish } from "@/shared/session-timer";
import { getLocalDayRange } from "@/shared/timezone";

export type Session = typeof sessions.$inferSelect;
export type Distraction = typeof distractions.$inferSelect;
export type Track = typeof tracks.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Goal = typeof goals.$inferSelect;

export interface SessionWithRelations extends Session {
  track: Track;
  task: Task | null;
  distractions?: Distraction[];
}

export interface TodayStats {
  totalFocusSeconds: number;
  completedTasksCount: number;
  sessionCount: number;
}

export interface ActiveTrackItem {
  track: Track;
  goal: Goal;
  currentNextTask: Task | null;
  todayFocusSeconds: number;
}

export interface DashboardData {
  activeSession: SessionWithRelations | null;
  todayStats: TodayStats;
  selectedTrack: ActiveTrackItem | null;
  activeTracks: ActiveTrackItem[];
}

export interface SessionReviewResult {
  session: Session;
  task: Task | null;
  nextTask: Task | null;
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function invalid(message: string, field?: string): never {
  throw new DomainError(
    "INVALID_INPUT",
    message,
    field ? { field } : undefined,
  );
}

function parsed<T>(
  result:
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: Array<{ message: string; path: PropertyKey[] }> };
      },
): T {
  if (!result.success) {
    invalid(
      result.error.issues[0]?.message ?? "Invalid input.",
      result.error.issues[0]?.path.join("."),
    );
  }
  return result.data;
}

async function lockScope(tx: Transaction, scope: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${scope}))`);
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
  createDistraction(
    context: AuthenticatedContext,
    input: DistractionCreateInput,
  ): Promise<Distraction>;
  listDistractions(
    context: AuthenticatedContext,
    input?: DistractionListInput,
  ): Promise<Distraction[]>;
  updateDistraction(
    context: AuthenticatedContext,
    id: string,
    input: DistractionUpdateInput,
  ): Promise<Distraction>;
  archiveDistraction(
    context: AuthenticatedContext,
    id: string,
  ): Promise<Distraction>;
  getDashboard(
    context: AuthenticatedContext,
    options?: { manualTrackId?: string },
  ): Promise<DashboardData>;
  setSelectedTrack(
    context: AuthenticatedContext,
    trackId: string | null,
  ): Promise<void>;
}

export function createSessionService(database: Database): SessionService {
  const contextUnused = (_context: AuthenticatedContext) => void _context;

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
      contextUnused(context);
      return findActiveSessionRow(database);
    },

    async getSession(context, id) {
      contextUnused(context);
      if (!id) invalid("Session ID is required.", "id");

      const rows = await database
        .select({
          session: sessions,
          track: tracks,
          task: tasks,
        })
        .from(sessions)
        .innerJoin(tracks, eq(sessions.trackId, tracks.id))
        .leftJoin(tasks, eq(sessions.taskId, tasks.id))
        .where(eq(sessions.id, id))
        .limit(1);

      if (!rows.length || !rows[0]) {
        throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
          sessionId: id,
        });
      }

      const distractionRows = await database
        .select()
        .from(distractions)
        .where(
          and(eq(distractions.sessionId, id), isNull(distractions.archivedAt)),
        )
        .orderBy(asc(distractions.createdAt));

      return {
        ...rows[0].session,
        track: rows[0].track,
        task: rows[0].task,
        distractions: distractionRows,
      };
    },

    async startSession(context, input) {
      const value = parsed(sessionStartSchema.safeParse(input));
      const requestHash = createHash("sha256")
        .update(
          JSON.stringify({
            trackId: value.trackId,
            taskId: value.taskId ?? null,
            plannedMinutes: value.plannedMinutes ?? null,
          }),
        )
        .digest("hex");

      return database.transaction(async (tx) => {
        await lockScope(tx, "sessions:running");

        // 1. Idempotency check FIRST
        if (value.idempotencyKey) {
          const [record] = await tx
            .select()
            .from(idempotencyRecords)
            .where(
              and(
                eq(idempotencyRecords.operation, "session_start"),
                eq(idempotencyRecords.key, value.idempotencyKey),
              ),
            )
            .limit(1);

          if (record) {
            if (record.requestHash !== requestHash) {
              throw new DomainError(
                "IDEMPOTENCY_KEY_REUSED",
                "This idempotency key was already used with a different payload.",
              );
            }

            const existingSessionId = (
              record.result as { sessionId?: string } | null
            )?.sessionId;
            if (existingSessionId) {
              const [session] = await tx
                .select()
                .from(sessions)
                .where(eq(sessions.id, existingSessionId))
                .limit(1);
              if (session) return session;
            }
          }
        }

        // 2. Check if an active or paused session already exists
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

        // 3. Validate Track and its parent Goal
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

        // 4. Validate Task if provided
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

        if (value.idempotencyKey) {
          await tx
            .insert(idempotencyRecords)
            .values({
              operation: "session_start",
              key: value.idempotencyKey,
              requestHash,
              resultRef: session!.id,
              result: { sessionId: session!.id },
            })
            .onConflictDoNothing();
        }

        return session!;
      });
    },

    async pauseSession(context, id) {
      contextUnused(context);
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

    async resumeSession(context, id) {
      contextUnused(context);
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

    async finishSession(context, id, input) {
      contextUnused(context);
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

    async cancelSession(context, id) {
      contextUnused(context);
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

        if (session.status === "completed") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "A completed session cannot be cancelled.",
          );
        }

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

    async finishSessionReview(context, input) {
      contextUnused(context);
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
            const [track] = await tx
              .select()
              .from(tracks)
              .where(eq(tracks.id, session.trackId))
              .limit(1);
            const [nextTask] = track?.currentTaskId
              ? await tx
                  .select()
                  .from(tasks)
                  .where(eq(tasks.id, track.currentTaskId))
                  .limit(1)
              : [null];
            return {
              session,
              task: task ?? null,
              nextTask: nextTask ?? null,
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

        // If outcome requires a task
        if (value.outcome === "completed" || value.outcome === "skip") {
          if (!session.taskId) {
            throw new DomainError(
              "INVALID_INPUT",
              "Cannot complete or skip a task on a session without a task.",
            );
          }

          await lockScope(tx, `track:${session.trackId}`);

          const [task] = await tx
            .select()
            .from(tasks)
            .where(eq(tasks.id, session.taskId))
            .limit(1);

          if (!task) {
            throw new DomainError("TASK_NOT_FOUND", "Task was not found.", {
              taskId: session.taskId,
            });
          }

          if (task.status !== "pending") {
            throw new DomainError(
              task.status === "completed"
                ? "TASK_ALREADY_COMPLETED"
                : "TASK_NOT_PENDING",
              "Only pending tasks can be completed or skipped.",
            );
          }

          const now = new Date();
          const targetStatus =
            value.outcome === "completed" ? "completed" : "skipped";

          const [resTask] = await tx
            .update(tasks)
            .set({
              status: targetStatus,
              completedAt: value.outcome === "completed" ? now : null,
              updatedAt: now,
            })
            .where(eq(tasks.id, session.taskId))
            .returning();
          updatedTask = resTask!;

          // If this was Current Next, advance Next
          const [track] = await tx
            .select()
            .from(tracks)
            .where(eq(tracks.id, session.trackId))
            .limit(1);

          if (track?.currentTaskId === session.taskId) {
            const [nextPending] = await tx
              .select()
              .from(tasks)
              .where(
                and(
                  eq(tasks.trackId, session.trackId),
                  eq(tasks.status, "pending"),
                  gt(tasks.position, task.position),
                ),
              )
              .orderBy(asc(tasks.position))
              .limit(1);

            await tx
              .update(tracks)
              .set({
                currentTaskId: nextPending?.id ?? null,
                updatedAt: now,
              })
              .where(eq(tracks.id, session.trackId));

            nextTask = nextPending ?? null;
          } else if (track?.currentTaskId) {
            const [current] = await tx
              .select()
              .from(tasks)
              .where(eq(tasks.id, track.currentTaskId))
              .limit(1);
            nextTask = current ?? null;
          }
        } else {
          // continue_later or no outcome
          if (session.taskId) {
            const [task] = await tx
              .select()
              .from(tasks)
              .where(eq(tasks.id, session.taskId))
              .limit(1);
            updatedTask = task ?? null;
          }
          const [track] = await tx
            .select()
            .from(tracks)
            .where(eq(tracks.id, session.trackId))
            .limit(1);
          if (track?.currentTaskId) {
            const [current] = await tx
              .select()
              .from(tasks)
              .where(eq(tasks.id, track.currentTaskId))
              .limit(1);
            nextTask = current ?? null;
          }
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

    async updateSessionNote(context, id, note) {
      contextUnused(context);
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

    async createDistraction(context, input) {
      contextUnused(context);
      const value = parsed(distractionCreateSchema.safeParse(input));

      let targetSessionId = value.sessionId;

      if (!targetSessionId) {
        const activeSession = await findActiveSessionRow(database);
        if (!activeSession) {
          throw new DomainError(
            "SESSION_NOT_FOUND",
            "No active or paused session found.",
          );
        }
        targetSessionId = activeSession.id;
      } else {
        const [existing] = await database
          .select({ id: sessions.id })
          .from(sessions)
          .where(eq(sessions.id, targetSessionId))
          .limit(1);
        if (!existing) {
          throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
            sessionId: targetSessionId,
          });
        }
      }

      const [created] = await database
        .insert(distractions)
        .values({
          sessionId: targetSessionId,
          text: value.text ?? null,
        })
        .returning();

      return created!;
    },

    async listDistractions(context, input = {}) {
      contextUnused(context);
      const query = parsed(distractionListSchema.safeParse(input));

      let targetSessionId = query.sessionId;
      if (!targetSessionId) {
        const active = await findActiveSessionRow(database);
        if (!active) {
          throw new DomainError(
            "SESSION_NOT_FOUND",
            "No active or paused session found.",
          );
        }
        targetSessionId = active.id;
      }

      const conditions = [eq(distractions.sessionId, targetSessionId)];
      if (!query.includeArchived) {
        conditions.push(isNull(distractions.archivedAt));
      }

      return database
        .select()
        .from(distractions)
        .where(and(...conditions))
        .orderBy(asc(distractions.createdAt));
    },

    async updateDistraction(context, id, input) {
      contextUnused(context);
      const value = parsed(distractionUpdateInputSchema.safeParse(input));

      const [updated] = await database
        .update(distractions)
        .set({
          text: value.text ?? null,
          updatedAt: new Date(),
        })
        .where(eq(distractions.id, id))
        .returning();

      if (!updated) {
        throw new DomainError(
          "DISTRACTION_NOT_FOUND",
          "Distraction was not found.",
        );
      }

      return updated;
    },

    async archiveDistraction(context, id) {
      contextUnused(context);
      parsed(distractionArchiveSchema.safeParse({ id }));

      const [archived] = await database
        .update(distractions)
        .set({
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(distractions.id, id))
        .returning();

      if (!archived) {
        throw new DomainError(
          "DISTRACTION_NOT_FOUND",
          "Distraction was not found.",
        );
      }

      return archived;
    },

    async getDashboard(context, options) {
      contextUnused(context);

      const [settings] = await database
        .select()
        .from(appSettings)
        .where(eq(appSettings.id, "default"))
        .limit(1);

      const timezone = settings?.timezone ?? "UTC";
      const now = new Date();
      const { start: todayStart, end: todayEnd } = getLocalDayRange(
        now,
        timezone,
      );

      // 1. Active session
      const activeSession = await findActiveSessionRow(database);

      // 2. Today stats:
      // Completed tasks today
      const completedTasksToday = await database
        .select({ count: sql<number>`count(*)` })
        .from(tasks)
        .where(
          and(
            eq(tasks.status, "completed"),
            isNotNull(tasks.completedAt),
            sql`${tasks.completedAt} >= ${todayStart} and ${tasks.completedAt} <= ${todayEnd}`,
          ),
        );

      const completedTasksCount = Number(completedTasksToday[0]?.count ?? 0);

      // Non-cancelled sessions intersecting today
      const todaySessions = await database
        .select()
        .from(sessions)
        .where(
          and(
            ne(sessions.status, "cancelled"),
            sql`${sessions.startedAt} <= ${todayEnd} and (${sessions.endedAt} is null or ${sessions.endedAt} >= ${todayStart})`,
          ),
        );

      let totalFocusSeconds = 0;
      const trackSecondsMap = new Map<string, number>();

      for (const s of todaySessions) {
        let sec = 0;
        if (s.status === "completed" && s.durationSeconds != null) {
          // Duration of the session falling within today's range
          const sStart = new Date(s.startedAt).getTime();
          const sEnd = s.endedAt
            ? new Date(s.endedAt).getTime()
            : now.getTime();
          const clampedStart = Math.max(sStart, todayStart.getTime());
          const clampedEnd = Math.min(sEnd, todayEnd.getTime());
          if (clampedEnd > clampedStart) {
            const fraction =
              (clampedEnd - clampedStart) / Math.max(1, sEnd - sStart);
            sec = Math.round(s.durationSeconds * Math.min(1, fraction));
          }
        } else if (s.status === "active" || s.status === "paused") {
          sec = calculateDurationSecondsOnFinish(s, now);
        }

        totalFocusSeconds += sec;
        trackSecondsMap.set(
          s.trackId,
          (trackSecondsMap.get(s.trackId) ?? 0) + sec,
        );
      }

      // 3. Active tracks under active goals
      const activeTrackRows = await database
        .select({
          track: tracks,
          goal: goals,
        })
        .from(tracks)
        .innerJoin(goals, eq(tracks.goalId, goals.id))
        .where(and(eq(tracks.status, "active"), eq(goals.status, "active")))
        .orderBy(asc(goals.position), asc(tracks.position));

      const activeTracks: ActiveTrackItem[] = [];

      // Batch-fetch all current next tasks in a single query instead of N+1
      const taskIds = activeTrackRows
        .map((row) => row.track.currentTaskId)
        .filter((id): id is string => id != null);

      const nextTaskMap = new Map<string, Task>();
      if (taskIds.length > 0) {
        const nextTasks = await database
          .select()
          .from(tasks)
          .where(inArray(tasks.id, taskIds));
        for (const t of nextTasks) {
          nextTaskMap.set(t.id, t);
        }
      }

      for (const row of activeTrackRows) {
        const nextTask = row.track.currentTaskId
          ? (nextTaskMap.get(row.track.currentTaskId) ?? null)
          : null;

        activeTracks.push({
          track: row.track,
          goal: row.goal,
          currentNextTask: nextTask,
          todayFocusSeconds: trackSecondsMap.get(row.track.id) ?? 0,
        });
      }

      // 4. Current focus track selection fallback:
      // 0. options?.manualTrackId if valid and active
      // 1. selectedTrackId if valid and active
      // 2. Most recent active track with non-cancelled session activity
      // 3. First active track by Goal.position -> Track.position
      // 4. null
      let selectedTrack: ActiveTrackItem | null = null;

      if (options?.manualTrackId) {
        selectedTrack =
          activeTracks.find((t) => t.track.id === options.manualTrackId) ??
          null;
      }

      if (!selectedTrack && settings?.selectedTrackId) {
        selectedTrack =
          activeTracks.find((t) => t.track.id === settings.selectedTrackId) ??
          null;
      }

      if (!selectedTrack && activeTracks.length > 0) {
        // Query recent session activity among active tracks
        const [recentSession] = await database
          .select({ trackId: sessions.trackId })
          .from(sessions)
          .where(
            and(
              ne(sessions.status, "cancelled"),
              inArray(
                sessions.trackId,
                activeTracks.map((t) => t.track.id),
              ),
            ),
          )
          .orderBy(desc(sessions.startedAt))
          .limit(1);

        if (recentSession) {
          selectedTrack =
            activeTracks.find((t) => t.track.id === recentSession.trackId) ??
            null;
        }
      }

      if (!selectedTrack && activeTracks.length > 0) {
        selectedTrack = activeTracks[0] ?? null;
      }

      return {
        activeSession,
        todayStats: {
          totalFocusSeconds,
          completedTasksCount,
          sessionCount: todaySessions.length,
        },
        selectedTrack,
        activeTracks,
      };
    },

    async setSelectedTrack(context, trackId) {
      contextUnused(context);
      if (trackId) {
        const [track] = await database
          .select({ id: tracks.id })
          .from(tracks)
          .where(eq(tracks.id, trackId))
          .limit(1);
        if (!track) {
          throw new DomainError("TRACK_NOT_FOUND", "Track was not found.", {
            trackId,
          });
        }
      }

      await database
        .update(appSettings)
        .set({
          selectedTrackId: trackId,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, "default"));
    },
  };
}
