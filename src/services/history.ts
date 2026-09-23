import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  ne,
  or,
  type SQL,
} from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import {
  distractions,
  sessions,
  tasks,
  tracks,
  type Distraction,
  type Session,
  type Task,
  type Track,
} from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  sessionListSchema,
  sessionLogSchema,
  sessionUpdateSchema,
  type SessionListInput,
  type SessionLogInput,
  type SessionUpdateInput,
} from "@/shared/schemas/session";
import { requestHashOf, withIdempotency } from "@/services/idempotency";
import {
  invalid,
  lockScope,
  parsed,
  type Transaction,
} from "@/services/service-kit";

export interface HistorySession extends Session {
  track: Track;
  task: Task | null;
}

export interface HistorySessionDetail extends HistorySession {
  distractions: Distraction[];
}

export interface SessionPage {
  items: HistorySession[];
  nextCursor: string | null;
}

export interface SessionTarget {
  track: Track;
  tasks: Task[];
}

export interface NormalizedSessionTime {
  startedAt: Date;
  endedAt: Date;
  durationSeconds: number;
}

export interface HistoryService {
  listSessions(
    context: AuthenticatedContext,
    input?: SessionListInput,
  ): Promise<SessionPage>;
  getSession(
    context: AuthenticatedContext,
    id: string,
  ): Promise<HistorySessionDetail>;
  logSession(
    context: AuthenticatedContext,
    input: SessionLogInput,
  ): Promise<Session>;
  updateSession(
    context: AuthenticatedContext,
    input: SessionUpdateInput,
  ): Promise<Session>;
  listTargets(context: AuthenticatedContext): Promise<SessionTarget[]>;
}

export function normalizeManualSession(input: {
  durationSeconds: number;
  endedAt?: Date;
  now: Date;
}): NormalizedSessionTime {
  const endedAt = input.endedAt ?? input.now;
  if (input.durationSeconds <= 0)
    invalid("Session duration must be positive.", "durationSeconds");
  return {
    startedAt: new Date(endedAt.getTime() - input.durationSeconds * 1000),
    endedAt,
    durationSeconds: input.durationSeconds,
  };
}

export function normalizeSessionCorrection(
  existing: Pick<
    Session,
    "startedAt" | "endedAt" | "durationSeconds" | "totalPausedSeconds"
  >,
  input: {
    startedAt?: Date;
    endedAt?: Date;
    durationSeconds?: number;
  },
): NormalizedSessionTime {
  if (!existing.endedAt || existing.durationSeconds == null) {
    invalid("Only a completed Session has correctable history.");
  }

  const supplied = [
    input.startedAt,
    input.endedAt,
    input.durationSeconds,
  ].filter((value) => value !== undefined).length;
  if (supplied === 3) {
    invalid(
      "Provide at most two time fields: start/end, start/duration, or end/duration.",
    );
  }

  const pausedSeconds = existing.totalPausedSeconds;
  let startedAt = input.startedAt ?? existing.startedAt;
  let endedAt = input.endedAt ?? existing.endedAt;
  let durationSeconds = input.durationSeconds ?? existing.durationSeconds;

  if (input.startedAt && input.endedAt) {
    durationSeconds =
      Math.floor((input.endedAt.getTime() - input.startedAt.getTime()) / 1000) -
      pausedSeconds;
  } else if (input.startedAt && input.durationSeconds !== undefined) {
    endedAt = new Date(
      input.startedAt.getTime() +
        (input.durationSeconds + pausedSeconds) * 1000,
    );
  } else if (input.endedAt && input.durationSeconds !== undefined) {
    startedAt = new Date(
      input.endedAt.getTime() - (input.durationSeconds + pausedSeconds) * 1000,
    );
  } else if (input.startedAt) {
    endedAt = new Date(
      input.startedAt.getTime() + (durationSeconds + pausedSeconds) * 1000,
    );
  } else if (input.endedAt) {
    startedAt = new Date(
      input.endedAt.getTime() - (durationSeconds + pausedSeconds) * 1000,
    );
  } else if (input.durationSeconds !== undefined) {
    startedAt = new Date(
      endedAt.getTime() - (input.durationSeconds + pausedSeconds) * 1000,
    );
  }

  if (endedAt.getTime() <= startedAt.getTime() || durationSeconds <= 0) {
    invalid("Session time range and effective duration must be positive.");
  }
  if (
    durationSeconds + pausedSeconds >
    (endedAt.getTime() - startedAt.getTime()) / 1000
  ) {
    invalid("Effective duration and paused time exceed the wall-clock range.");
  }

  return { startedAt, endedAt, durationSeconds };
}

async function validateTarget(
  tx: Transaction,
  trackId: string,
  taskId: string | null,
): Promise<void> {
  const [track] = await tx
    .select({ id: tracks.id })
    .from(tracks)
    .where(eq(tracks.id, trackId))
    .limit(1);
  if (!track) {
    throw new DomainError("TRACK_NOT_FOUND", "Track was not found.", {
      trackId,
    });
  }
  if (!taskId) return;

  const [task] = await tx
    .select({ trackId: tasks.trackId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) {
    throw new DomainError("TASK_NOT_FOUND", "Task was not found.", { taskId });
  }
  if (task.trackId !== trackId) {
    throw new DomainError(
      "TASK_NOT_IN_TRACK",
      "Task does not belong to the selected Track.",
      { taskId, trackId },
    );
  }
}

async function ensureNoOverlap(
  tx: Transaction,
  range: { startedAt: Date; endedAt: Date },
  allowOverlap: boolean,
  exceptId?: string,
): Promise<void> {
  if (allowOverlap) return;
  const conditions: SQL[] = [
    ne(sessions.status, "cancelled"),
    lt(sessions.startedAt, range.endedAt),
    or(
      gt(sessions.endedAt, range.startedAt),
      and(
        inArray(sessions.status, ["active", "paused"] as const),
        // A running Session's effective wall range extends through the check.
        lt(sessions.startedAt, range.endedAt),
      ),
    )!,
  ];
  if (exceptId) conditions.push(ne(sessions.id, exceptId));

  const [conflict] = await tx
    .select({
      id: sessions.id,
      trackId: tracks.id,
      trackTitle: tracks.title,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
    })
    .from(sessions)
    .innerJoin(tracks, eq(sessions.trackId, tracks.id))
    .where(and(...conditions))
    .orderBy(asc(sessions.startedAt))
    .limit(1);

  if (conflict) {
    throw new DomainError(
      "SESSION_TIME_OVERLAP",
      "The Session overlaps an existing record. Retry with allowOverlap=true to confirm.",
      {
        sessionId: conflict.id,
        trackId: conflict.trackId,
        track: conflict.trackTitle,
        startedAt: conflict.startedAt.toISOString(),
        endedAt: conflict.endedAt?.toISOString() ?? null,
      },
    );
  }
}

export function createHistoryService(database: Database): HistoryService {
  return {
    async listSessions(_context, input = {}) {
      void _context;
      const query = parsed(sessionListSchema.safeParse(input));
      const from = query.from ? new Date(query.from) : undefined;
      const to = query.to ? new Date(query.to) : undefined;
      if (from && to && from >= to) invalid("from must be before to.", "from");

      const conditions: SQL[] = [];
      if (!query.includeCancelled)
        conditions.push(ne(sessions.status, "cancelled"));
      if (query.status) conditions.push(eq(sessions.status, query.status));
      if (query.trackId) conditions.push(eq(sessions.trackId, query.trackId));
      if (query.taskId) conditions.push(eq(sessions.taskId, query.taskId));
      if (query.entryMode)
        conditions.push(eq(sessions.entryMode, query.entryMode));
      if (query.createdVia)
        conditions.push(eq(sessions.createdVia, query.createdVia));
      if (from) conditions.push(gte(sessions.startedAt, from));
      if (to) conditions.push(lt(sessions.startedAt, to));

      if (query.cursor) {
        const [cursor] = await database
          .select({ id: sessions.id, startedAt: sessions.startedAt })
          .from(sessions)
          .where(eq(sessions.id, query.cursor))
          .limit(1);
        if (!cursor) invalid("Session cursor was not found.", "cursor");
        conditions.push(
          or(
            lt(sessions.startedAt, cursor.startedAt),
            and(
              eq(sessions.startedAt, cursor.startedAt),
              lt(sessions.id, cursor.id),
            ),
          )!,
        );
      }

      const rows = await database
        .select({ session: sessions, track: tracks, task: tasks })
        .from(sessions)
        .innerJoin(tracks, eq(sessions.trackId, tracks.id))
        .leftJoin(tasks, eq(sessions.taskId, tasks.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(sessions.startedAt), desc(sessions.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);
      return {
        items: pageRows.map((row) => ({
          ...row.session,
          track: row.track,
          task: row.task,
        })),
        nextCursor: hasMore ? (pageRows.at(-1)?.session.id ?? null) : null,
      };
    },

    async getSession(_context, id) {
      void _context;
      const [row, distractionRows] = await Promise.all([
        database
          .select({ session: sessions, track: tracks, task: tasks })
          .from(sessions)
          .innerJoin(tracks, eq(sessions.trackId, tracks.id))
          .leftJoin(tasks, eq(sessions.taskId, tasks.id))
          .where(eq(sessions.id, id))
          .limit(1),
        database
          .select()
          .from(distractions)
          .where(eq(distractions.sessionId, id))
          .orderBy(asc(distractions.createdAt), asc(distractions.id))
          .limit(200),
      ]);
      if (!row[0]) {
        throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
          sessionId: id,
        });
      }
      return {
        ...row[0].session,
        track: row[0].track,
        task: row[0].task,
        distractions: distractionRows,
      };
    },

    async logSession(context, input) {
      const value = parsed(sessionLogSchema.safeParse(input));
      const endedAt = value.endedAt ? new Date(value.endedAt) : new Date();
      const normalized = normalizeManualSession({
        durationSeconds: value.durationSeconds,
        endedAt,
        now: new Date(),
      });
      const requestHash = requestHashOf({
        trackId: value.trackId,
        taskId: value.taskId ?? null,
        durationSeconds: value.durationSeconds,
        endedAt: value.endedAt ?? null,
        plannedMinutes: value.plannedMinutes ?? null,
        note: value.note ?? null,
        allowOverlap: value.allowOverlap,
      });

      return database.transaction(async (tx) => {
        await lockScope(tx, "sessions:timeline");
        return withIdempotency({
          tx,
          operation: "session_log",
          key: value.idempotencyKey,
          requestHash,
          replay: async (recorded) => {
            const id = (recorded as { sessionId?: string } | null)?.sessionId;
            if (!id) return null;
            const [session] = await tx
              .select()
              .from(sessions)
              .where(eq(sessions.id, id))
              .limit(1);
            return session ?? null;
          },
          run: async () => {
            await validateTarget(tx, value.trackId, value.taskId ?? null);
            await ensureNoOverlap(tx, normalized, value.allowOverlap);
            const [session] = await tx
              .insert(sessions)
              .values({
                trackId: value.trackId,
                taskId: value.taskId ?? null,
                status: "completed",
                entryMode: "manual",
                createdVia: context.actor === "mcp" ? "mcp" : "web",
                plannedMinutes: value.plannedMinutes ?? null,
                startedAt: normalized.startedAt,
                endedAt: normalized.endedAt,
                durationSeconds: normalized.durationSeconds,
                totalPausedSeconds: 0,
                note: value.note ?? null,
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

    async updateSession(_context, input) {
      void _context;
      const value = parsed(sessionUpdateSchema.safeParse(input));
      return database.transaction(async (tx) => {
        await lockScope(tx, "sessions:timeline");
        await lockScope(tx, `session:${value.id}`);
        const [existing] = await tx
          .select()
          .from(sessions)
          .where(eq(sessions.id, value.id))
          .limit(1);
        if (!existing) {
          throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
            sessionId: value.id,
          });
        }
        if (existing.status !== "completed") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only completed Sessions can be corrected.",
          );
        }

        const trackId = value.trackId ?? existing.trackId;
        const taskId =
          value.taskId === undefined ? existing.taskId : value.taskId;
        await validateTarget(tx, trackId, taskId);
        const normalized = normalizeSessionCorrection(existing, {
          startedAt: value.startedAt ? new Date(value.startedAt) : undefined,
          endedAt: value.endedAt ? new Date(value.endedAt) : undefined,
          durationSeconds: value.durationSeconds,
        });
        await ensureNoOverlap(tx, normalized, value.allowOverlap, existing.id);

        const [updated] = await tx
          .update(sessions)
          .set({
            trackId,
            taskId,
            startedAt: normalized.startedAt,
            endedAt: normalized.endedAt,
            durationSeconds: normalized.durationSeconds,
            plannedMinutes:
              value.plannedMinutes === undefined
                ? existing.plannedMinutes
                : value.plannedMinutes,
            note: value.note === undefined ? existing.note : value.note,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, existing.id))
          .returning();
        return updated!;
      });
    },

    async listTargets(_context) {
      void _context;
      const [trackRows, taskRows] = await Promise.all([
        database.select().from(tracks).orderBy(asc(tracks.title)),
        database
          .select()
          .from(tasks)
          .orderBy(asc(tasks.trackId), asc(tasks.position)),
      ]);
      const tasksByTrack = new Map<string, Task[]>();
      for (const task of taskRows) {
        const list = tasksByTrack.get(task.trackId) ?? [];
        list.push(task);
        tasksByTrack.set(task.trackId, list);
      }
      return trackRows.map((track) => ({
        track,
        tasks: tasksByTrack.get(track.id) ?? [],
      }));
    },
  };
}
