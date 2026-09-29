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
  focusIntervals,
  goals,
  sessions,
  tasks,
  type Distraction,
  type Goal,
  type Session,
  type Task,
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
/**
 * Goal-direct history (PRD §7.3). Manual logs declare a duration over a
 * wall-clock range with timeBasis manual; corrections of completed records
 * switch the basis to corrected while the original observed intervals stay
 * untouched as the source. Overlaps need explicit allowOverlap.
 */

export interface HistorySession extends Session {
  goal: Goal;
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
  goal: Goal;
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
  existing: Pick<Session, "startedAt" | "endedAt" | "durationSeconds">,
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

  let startedAt = input.startedAt ?? existing.startedAt;
  let endedAt = input.endedAt ?? existing.endedAt;
  let durationSeconds = input.durationSeconds ?? existing.durationSeconds;

  if (input.startedAt && input.endedAt) {
    durationSeconds = Math.floor(
      (input.endedAt.getTime() - input.startedAt.getTime()) / 1000,
    );
  } else if (input.startedAt && input.durationSeconds !== undefined) {
    endedAt = new Date(
      input.startedAt.getTime() + input.durationSeconds * 1000,
    );
  } else if (input.endedAt && input.durationSeconds !== undefined) {
    startedAt = new Date(
      input.endedAt.getTime() - input.durationSeconds * 1000,
    );
  } else if (input.startedAt) {
    endedAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  } else if (input.endedAt) {
    startedAt = new Date(endedAt.getTime() - durationSeconds * 1000);
  } else if (input.durationSeconds !== undefined) {
    startedAt = new Date(endedAt.getTime() - input.durationSeconds * 1000);
  }

  if (endedAt.getTime() <= startedAt.getTime() || durationSeconds <= 0) {
    invalid("Session time range and effective duration must be positive.");
  }
  if (durationSeconds > (endedAt.getTime() - startedAt.getTime()) / 1000) {
    invalid("Effective duration exceeds the wall-clock range.");
  }

  return { startedAt, endedAt, durationSeconds };
}

/**
 * Ownership validation for manual logs / corrections (PRD §7.3): the Goal
 * may be non-active and the Task non-pending, but the Task must still
 * belong to the Goal.
 */
async function validateTarget(
  tx: Transaction,
  goalId: string,
  taskId: string | null,
): Promise<void> {
  const [goal] = await tx
    .select({ id: goals.id })
    .from(goals)
    .where(eq(goals.id, goalId))
    .limit(1);
  if (!goal) {
    throw new DomainError("GOAL_NOT_FOUND", "Goal was not found.", { goalId });
  }
  if (!taskId) return;

  const [task] = await tx
    .select({ goalId: tasks.goalId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .limit(1);
  if (!task) {
    throw new DomainError("TASK_NOT_FOUND", "Task was not found.", { taskId });
  }
  if (task.goalId !== goalId) {
    throw new DomainError(
      "TASK_NOT_IN_GOAL",
      "Task does not belong to this Goal.",
      { taskId, goalId },
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
        lt(sessions.startedAt, range.endedAt),
      ),
    )!,
  ];
  if (exceptId) conditions.push(ne(sessions.id, exceptId));

  const [conflict] = await tx
    .select({
      id: sessions.id,
      goalId: goals.id,
      goalTitle: goals.title,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
    })
    .from(sessions)
    .innerJoin(goals, eq(sessions.goalId, goals.id))
    .where(and(...conditions))
    .orderBy(asc(sessions.startedAt))
    .limit(1);

  if (conflict) {
    throw new DomainError(
      "SESSION_TIME_OVERLAP",
      "The Session overlaps an existing record. Retry with allowOverlap=true to confirm.",
      {
        sessionId: conflict.id,
        goalId: conflict.goalId,
        goal: conflict.goalTitle,
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
      if (query.goalId) conditions.push(eq(sessions.goalId, query.goalId));
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
        .select({ session: sessions, goal: goals, task: tasks })
        .from(sessions)
        .innerJoin(goals, eq(sessions.goalId, goals.id))
        .leftJoin(tasks, eq(sessions.taskId, tasks.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(sessions.startedAt), desc(sessions.id))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const pageRows = rows.slice(0, query.limit);
      return {
        items: pageRows.map((row) => ({
          ...row.session,
          goal: row.goal,
          task: row.task,
        })),
        nextCursor: hasMore ? (pageRows.at(-1)?.session.id ?? null) : null,
      };
    },

    async getSession(_context, id) {
      void _context;
      const [row, distractionRows] = await Promise.all([
        database
          .select({ session: sessions, goal: goals, task: tasks })
          .from(sessions)
          .innerJoin(goals, eq(sessions.goalId, goals.id))
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
        goal: row[0].goal,
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
        goalId: value.goalId,
        taskId: value.taskId ?? null,
        durationSeconds: value.durationSeconds,
        endedAt: value.endedAt ?? null,
        intent: value.intent ?? null,
        note: value.note ?? null,
        resumeHint: value.resumeHint ?? null,
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
            await validateTarget(tx, value.goalId, value.taskId ?? null);
            await ensureNoOverlap(tx, normalized, value.allowOverlap);
            const [session] = await tx
              .insert(sessions)
              .values({
                goalId: value.goalId,
                taskId: value.taskId ?? null,
                status: "completed",
                entryMode: "manual",
                createdVia: context.actor === "mcp" ? "mcp" : "web",
                timerMode: "stopwatch",
                timeBasis: "manual",
                intent: value.intent ?? null,
                note: value.note ?? null,
                resumeHint: value.resumeHint ?? null,
                startedAt: normalized.startedAt,
                endedAt: normalized.endedAt,
                durationSeconds: normalized.durationSeconds,
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

        const goalId = value.goalId ?? existing.goalId;
        const taskId =
          value.taskId === undefined ? existing.taskId : value.taskId;
        await validateTarget(tx, goalId, taskId);

        const timeChanged =
          value.startedAt !== undefined ||
          value.endedAt !== undefined ||
          value.durationSeconds !== undefined;
        const normalized = timeChanged
          ? normalizeSessionCorrection(existing, {
              startedAt: value.startedAt
                ? new Date(value.startedAt)
                : undefined,
              endedAt: value.endedAt ? new Date(value.endedAt) : undefined,
              durationSeconds: value.durationSeconds,
            })
          : {
              startedAt: existing.startedAt,
              endedAt: existing.endedAt!,
              durationSeconds: existing.durationSeconds!,
            };
        await ensureNoOverlap(tx, normalized, value.allowOverlap, existing.id);

        // Optional version checks: an explicit expectedVersion that no
        // longer matches is a conflict; omitting it keeps the explicit
        // correction authoritative (PRD §7.3).
        for (const [field, expected, current] of [
          ["note", value.expectedNoteVersion, existing.noteVersion],
          [
            "resume hint",
            value.expectedResumeHintVersion,
            existing.resumeHintVersion,
          ],
        ] as const) {
          if (expected !== undefined && expected !== current) {
            throw new DomainError(
              "VERSION_CONFLICT",
              `The ${field} changed elsewhere. Reload the latest version and retry.`,
              { currentVersion: current },
            );
          }
        }
        const noteChanged =
          value.note !== undefined && value.note !== existing.note;
        const hintChanged =
          value.resumeHint !== undefined &&
          value.resumeHint !== existing.resumeHint;

        // Text-only edits keep the basis; time edits switch to corrected
        // while the original observed intervals remain as the source.
        const [updated] = await tx
          .update(sessions)
          .set({
            goalId,
            taskId,
            startedAt: normalized.startedAt,
            endedAt: normalized.endedAt,
            durationSeconds: normalized.durationSeconds,
            ...(timeChanged ? { timeBasis: "corrected" as const } : {}),
            intent: value.intent === undefined ? existing.intent : value.intent,
            note: noteChanged ? value.note : existing.note,
            ...(noteChanged ? { noteVersion: existing.noteVersion + 1 } : {}),
            resumeHint: hintChanged ? value.resumeHint : existing.resumeHint,
            ...(hintChanged
              ? { resumeHintVersion: existing.resumeHintVersion + 1 }
              : {}),
            revision: existing.revision + 1,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, existing.id))
          .returning();
        return updated!;
      });
    },

    async listTargets(_context) {
      void _context;
      const [goalRows, taskRows] = await Promise.all([
        database.select().from(goals).orderBy(asc(goals.title)),
        database
          .select()
          .from(tasks)
          .orderBy(asc(tasks.goalId), asc(tasks.position)),
      ]);
      const tasksByGoal = new Map<string, Task[]>();
      for (const task of taskRows) {
        const list = tasksByGoal.get(task.goalId) ?? [];
        list.push(task);
        tasksByGoal.set(task.goalId, list);
      }
      return goalRows.map((goal) => ({
        goal,
        tasks: tasksByGoal.get(goal.id) ?? [],
      }));
    },
  };
}

/** Used by statistics to fetch interval rows of observed sessions. */
export async function intervalsOfSessions(
  database: Database,
  sessionIds: string[],
): Promise<Map<string, { startedAt: Date; endedAt: Date | null }[]>> {
  const map = new Map<string, { startedAt: Date; endedAt: Date | null }[]>();
  if (sessionIds.length === 0) return map;
  const rows = await database
    .select({
      sessionId: focusIntervals.sessionId,
      startedAt: focusIntervals.startedAt,
      endedAt: focusIntervals.endedAt,
    })
    .from(focusIntervals)
    .where(inArray(focusIntervals.sessionId, sessionIds))
    .orderBy(asc(focusIntervals.startedAt));
  for (const row of rows) {
    const list = map.get(row.sessionId) ?? [];
    list.push({ startedAt: row.startedAt, endedAt: row.endedAt });
    map.set(row.sessionId, list);
  }
  return map;
}
