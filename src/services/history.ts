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
  sql,
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
  sessionPhases,
  type SessionPhase,
  type FocusInterval,
  type Distraction,
  type Goal,
  type Session,
  type Task,
} from "@/db/schema";
import { historyCursor, readHistoryCursor } from "@/services/history-cursor";
import { focusSecondsSql } from "@/services/focus-query";
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
  phases: SessionPhase[];
  intervals: FocusInterval[];
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
  listCompletedTasks(
    context: AuthenticatedContext,
    input?: {
      goalId?: string;
      from?: string;
      to?: string;
      cursor?: string;
      now?: string;
      limit?: number;
    },
  ): Promise<{ items: (Task & { goal: Goal })[]; nextCursor: string | null }>;
  listTargets(context: AuthenticatedContext): Promise<SessionTarget[]>;
}

export function normalizeManualSession(input: {
  durationSeconds: number;
  endedAt?: Date;
  now: Date;
  startedAt?: Date;
}): NormalizedSessionTime {
  const endedAt = input.endedAt ?? input.now;
  if (input.durationSeconds <= 0)
    invalid("Session duration must be positive.", "durationSeconds");
  const startedAt =
    input.startedAt ??
    new Date(endedAt.getTime() - input.durationSeconds * 1000);
  if (
    endedAt <= startedAt ||
    input.durationSeconds > (endedAt.getTime() - startedAt.getTime()) / 1000
  )
    invalid("Effective duration exceeds the wall-clock range.");
  return {
    startedAt,
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

  const startedAt = input.startedAt ?? existing.startedAt;
  const endedAt = input.endedAt ?? existing.endedAt;
  const durationSeconds = input.durationSeconds ?? existing.durationSeconds;

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

  if (conflict && !allowOverlap) {
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
      if (query.dateMode === "focus") {
        if (!from || !to) invalid("Focus intersection requires from and to.");
        if (to.getTime() - from.getTime() > 367 * 86400000)
          invalid("Focus intersection is limited to one year.");
        conditions.push(lt(sessions.startedAt, to));
        conditions.push(
          or(
            gt(sessions.endedAt, from),
            inArray(sessions.status, ["active", "paused"]),
          )!,
        );
        conditions.push(
          sql`${focusSecondsSql(sql`${sessions}`, sql`${from}::timestamptz`, sql`${to}::timestamptz`, query.now ? new Date(query.now) : new Date())} > 0`,
        );
      } else {
        if (from) conditions.push(gte(sessions.startedAt, from));
        if (to) conditions.push(lt(sessions.startedAt, to));
      }

      if (query.cursor) {
        const cursor = readHistoryCursor(query.cursor, "sessions");
        conditions.push(ne(sessions.id, cursor.id));
        conditions.push(
          or(
            lt(sessions.startedAt, cursor.at),
            and(eq(sessions.startedAt, cursor.at), lt(sessions.id, cursor.id)),
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
        nextCursor: hasMore
          ? historyCursor(
              "sessions",
              pageRows.at(-1)!.session.id,
              pageRows.at(-1)!.session.startedAt,
            )
          : null,
      };
    },

    async getSession(_context, id) {
      void _context;
      const [row, distractionRows, phaseRows, intervalRows] = await Promise.all(
        [
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
          database
            .select()
            .from(sessionPhases)
            .where(eq(sessionPhases.sessionId, id))
            .orderBy(asc(sessionPhases.sequence)),
          database
            .select()
            .from(focusIntervals)
            .where(eq(focusIntervals.sessionId, id))
            .orderBy(asc(focusIntervals.startedAt), asc(focusIntervals.id)),
        ],
      );
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
        phases: phaseRows,
        intervals: intervalRows,
      };
    },

    async logSession(context, input) {
      const value = parsed(sessionLogSchema.safeParse(input));
      const endedAt = value.endedAt ? new Date(value.endedAt) : new Date();
      const normalized = normalizeManualSession({
        durationSeconds: value.durationSeconds,
        startedAt: value.startedAt ? new Date(value.startedAt) : undefined,
        endedAt,
        now: new Date(),
      });
      const requestHash = requestHashOf({
        goalId: value.goalId,
        taskId: value.taskId ?? null,
        durationSeconds: value.durationSeconds,
        startedAt: value.startedAt ?? null,
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
        if (goalId !== existing.goalId && value.taskId === undefined)
          invalid(
            "Choose or explicitly clear the Task when changing Goal.",
            "taskId",
          );
        const taskId =
          value.taskId === undefined ? existing.taskId : value.taskId;
        await validateTarget(tx, goalId, taskId);

        const timeChanged =
          value.startedAt !== undefined ||
          value.endedAt !== undefined ||
          value.durationSeconds !== undefined;
        const recordChanged =
          timeChanged ||
          goalId !== existing.goalId ||
          taskId !== existing.taskId ||
          value.intent !== undefined;
        if (recordChanged && value.expectedRevision === undefined)
          invalid(
            "Time and ownership corrections require expectedRevision.",
            "expectedRevision",
          );
        if (recordChanged && value.expectedRevision !== existing.revision)
          throw new DomainError(
            "VERSION_CONFLICT",
            "The record changed elsewhere. Reload before correcting it.",
            { currentVersion: existing.revision },
          );
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
        if (timeChanged)
          await ensureNoOverlap(
            tx,
            normalized,
            value.allowOverlap,
            existing.id,
          );

        // Independent text versions allow an unrelated hint edit to coexist
        // with a note edit, exactly like the timer's note/hint endpoints.
        for (const [field, content, expected, current] of [
          ["note", value.note, value.expectedNoteVersion, existing.noteVersion],
          [
            "resumeHint",
            value.resumeHint,
            value.expectedResumeHintVersion,
            existing.resumeHintVersion,
          ],
        ] as const) {
          if (content === undefined) continue;
          if (expected === undefined)
            invalid(`Text edits require the ${field} version.`, field);
          if (expected !== current)
            throw new DomainError(
              "VERSION_CONFLICT",
              `The ${field} changed elsewhere. Reload and retry.`,
              { currentVersion: current },
            );
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

    async listCompletedTasks(_context, input = {}) {
      void _context;
      const query = parsed(sessionListSchema.safeParse(input));
      const conditions: SQL[] = [eq(tasks.status, "completed")];
      if (query.now)
        conditions.push(lt(tasks.completedAt, new Date(query.now)));
      if (query.goalId) conditions.push(eq(tasks.goalId, query.goalId));
      if (query.from)
        conditions.push(gte(tasks.completedAt, new Date(query.from)));
      if (query.to) conditions.push(lt(tasks.completedAt, new Date(query.to)));
      if (query.cursor) {
        const cursor = readHistoryCursor(query.cursor, "tasks");
        conditions.push(ne(tasks.id, cursor.id));
        conditions.push(
          or(
            lt(tasks.completedAt, cursor.at),
            and(eq(tasks.completedAt, cursor.at), lt(tasks.id, cursor.id)),
          )!,
        );
      }
      const rows = await database
        .select({ task: tasks, goal: goals })
        .from(tasks)
        .innerJoin(goals, eq(tasks.goalId, goals.id))
        .where(and(...conditions))
        .orderBy(desc(tasks.completedAt), desc(tasks.id))
        .limit(query.limit + 1);
      return {
        items: rows
          .slice(0, query.limit)
          .map((r) => ({ ...r.task, goal: r.goal })),
        nextCursor:
          rows.length > query.limit
            ? historyCursor(
                "tasks",
                rows[query.limit - 1]!.task.id,
                rows[query.limit - 1]!.task.completedAt!,
              )
            : null,
      };
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
