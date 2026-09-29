import { asc, eq, inArray, isNull, and, sql } from "drizzle-orm";

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

type JsonRecord = Record<string, unknown>;

function dateValue(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function nullableDate(value: unknown): Date | null {
  return value == null ? null : dateValue(value);
}

function sessionFromJson(row: JsonRecord): Session {
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    taskId: row.task_id == null ? null : String(row.task_id),
    status: row.status as Session["status"],
    entryMode: row.entry_mode as Session["entryMode"],
    createdVia: row.created_via as Session["createdVia"],
    timerMode: row.timer_mode as Session["timerMode"],
    timeBasis: row.time_basis as Session["timeBasis"],
    timerConfig: row.timer_config,
    intent: row.intent == null ? null : String(row.intent),
    note: row.note == null ? null : String(row.note),
    resumeHint: row.resume_hint == null ? null : String(row.resume_hint),
    noteVersion: Number(row.note_version),
    resumeHintVersion: Number(row.resume_hint_version),
    revision: Number(row.revision),
    startedAt: dateValue(row.started_at),
    endedAt: nullableDate(row.ended_at),
    durationSeconds:
      row.duration_seconds == null ? null : Number(row.duration_seconds),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  };
}

function goalFromJson(row: JsonRecord): Goal {
  return {
    id: String(row.id),
    title: String(row.title),
    description: row.description == null ? null : String(row.description),
    status: row.status as Goal["status"],
    position: Number(row.position),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  };
}

function taskFromJson(row: JsonRecord | null): Task | null {
  if (!row) return null;
  return {
    id: String(row.id),
    goalId: String(row.goal_id),
    title: String(row.title),
    description: row.description == null ? null : String(row.description),
    status: row.status as Task["status"],
    position: Number(row.position),
    estimatedMinutes:
      row.estimated_minutes == null ? null : Number(row.estimated_minutes),
    resourceType:
      row.resource_type == null
        ? null
        : (row.resource_type as Task["resourceType"]),
    resourceValue:
      row.resource_value == null ? null : String(row.resource_value),
    note: row.note == null ? null : String(row.note),
    completedAt: nullableDate(row.completed_at),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  };
}

function intervalFromJson(row: JsonRecord): FocusInterval {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    phase: row.phase as FocusInterval["phase"],
    startedAt: dateValue(row.started_at),
    endedAt: nullableDate(row.ended_at),
    createdAt: dateValue(row.created_at),
    updatedAt: dateValue(row.updated_at),
  };
}

interface FastSessionRow extends Record<string, unknown> {
  session: JsonRecord;
  goal: JsonRecord;
  task: JsonRecord | null;
  intervals: JsonRecord[];
  note_conflict?: boolean;
}

function viewFromFastRow(row: FastSessionRow, now: Date): SessionView {
  const session = sessionFromJson(row.session);
  const intervals = row.intervals.map(intervalFromJson);
  return {
    ...session,
    goal: goalFromJson(row.goal),
    task: taskFromJson(row.task),
    intervals,
    serverNow: now.toISOString(),
    focusSeconds: focusSecondsOfIntervals(intervals, now),
    actions: availableSessionActions(session.status),
    ...(row.note_conflict ? { noteConflict: true } : {}),
  };
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

  /**
   * Web starts do not carry an idempotency key. Keep their entire happy path
   * in one PostgreSQL statement so a remote database costs one roundtrip,
   * while the transaction-scoped locks and relational constraints stay the
   * same. A missing row falls back to the detailed path below for its precise
   * domain error.
   */
  async function fastStart(
    context: AuthenticatedContext,
    value: ReturnType<typeof sessionStartSchema.parse>,
  ): Promise<SessionView | null> {
    const startedAt = new Date();
    const taskId = value.taskId ?? null;
    const createdVia = context.actor === "mcp" ? "mcp" : "web";
    const result = await database.execute<FastSessionRow>(sql`
      with first_lock as materialized (
        select pg_advisory_xact_lock(hashtext('sessions:running'))
      ), selection_lock as materialized (
        select pg_advisory_xact_lock(hashtext('app:selection'))
        from first_lock
      ), goal_lock as materialized (
        select pg_advisory_xact_lock(hashtext(${"goal:" + value.goalId}))
        from selection_lock
      ), candidate as materialized (
        select g.id
        from goal_lock
        join goals g on g.id = ${value.goalId}::uuid
        left join tasks t on t.id = ${taskId}::uuid
        where g.status = 'active'
          and (
            ${taskId}::uuid is null
            or (t.goal_id = g.id and t.status = 'pending')
          )
          and not exists (
            select 1 from sessions s where s.status in ('active', 'paused')
          )
        for update of g
      ), new_session as (
        insert into sessions (
          goal_id, task_id, status, entry_mode, created_via, timer_mode,
          time_basis, timer_config, intent, note, resume_hint, started_at
        )
        select
          ${value.goalId}::uuid, ${taskId}::uuid, 'active', 'timer',
          ${createdVia}::session_created_via, 'stopwatch', 'observed', null,
          ${value.intent ?? null}::text, null, null, ${startedAt}
        from candidate
        returning *
      ), new_interval as (
        insert into focus_intervals (session_id, phase, started_at)
        select id, 'focus', started_at from new_session
        returning *
      ), new_selection as (
        insert into app_settings (
          id, timezone, week_starts_on, timer_mode,
          selected_goal_id, selected_task_id
        )
        select 'default', 'UTC', 1, 'stopwatch', goal_id, task_id
        from new_session
        on conflict (id) do update set
          selected_goal_id = excluded.selected_goal_id,
          selected_task_id = excluded.selected_task_id,
          updated_at = ${startedAt}
        returning id
      )
      select
        row_to_json(ns) as session,
        row_to_json(g) as goal,
        case when t.id is null then null else row_to_json(t) end as task,
        json_build_array(row_to_json(ni)) as intervals
      from new_session ns
      join goals g on g.id = ns.goal_id
      left join tasks t on t.id = ns.task_id
      cross join new_interval ni
      cross join new_selection
    `);
    const row = result.rows[0];
    return row ? viewFromFastRow(row, startedAt) : null;
  }

  /** One-statement finish for the same latency-sensitive web path. */
  async function fastFinish(
    value: ReturnType<typeof sessionFinishSchema.parse>,
  ): Promise<SessionView | null> {
    const now = new Date();
    const hasNote = value.note !== undefined;
    const hasExpectedVersion = value.noteExpectedVersion !== undefined;
    const result = await database.execute<FastSessionRow>(sql`
      with session_lock as materialized (
        select pg_advisory_xact_lock(hashtext(${"session:" + value.id}))
      ), target as materialized (
        select s.*
        from session_lock
        join sessions s on s.id = ${value.id}::uuid
        for update of s
      ), closed as (
        update focus_intervals fi
        set ended_at = ${now}, updated_at = ${now}
        from target t
        where fi.session_id = t.id
          and fi.ended_at is null
        returning fi.id
      ), close_marker as materialized (
        select count(*) as closed_count from closed
      ), duration as materialized (
        select coalesce(
          floor(sum(extract(epoch from (
            coalesce(fi.ended_at, ${now}) - fi.started_at
          )))), 0
        )::integer as seconds
        from focus_intervals fi, target t, close_marker
        where fi.session_id = t.id and fi.phase = 'focus'
      ), updated as (
        update sessions s
        set
          status = 'completed',
          ended_at = ${now},
          duration_seconds = duration.seconds,
          note = case
            when ${hasNote}::boolean and (
              not ${hasExpectedVersion}::boolean
              or ${value.noteExpectedVersion ?? null}::integer = t.note_version
            ) then ${value.note ?? null}::text
            else t.note
          end,
          note_version = case
            when ${hasNote}::boolean and (
              not ${hasExpectedVersion}::boolean
              or ${value.noteExpectedVersion ?? null}::integer = t.note_version
            ) then t.note_version + 1
            else t.note_version
          end,
          revision = t.revision + 1,
          updated_at = ${now}
        from target t, duration
        where s.id = t.id and t.status in ('active', 'paused')
        returning s.*
      ), chosen as (
        select * from updated
        union all
        select t.* from target t
        where t.status = 'completed' and not exists (select 1 from updated)
      )
      select
        row_to_json(chosen) as session,
        row_to_json(g) as goal,
        case when task.id is null then null else row_to_json(task) end as task,
        coalesce(
          (
            select json_agg(
              case
                when fi.ended_at is null
                  then jsonb_set(to_jsonb(fi), '{ended_at}', to_jsonb(${now}::timestamptz))
                else to_jsonb(fi)
              end
              order by fi.started_at, fi.id
            )
            from focus_intervals fi
            where fi.session_id = chosen.id
          ),
          '[]'::json
        ) as intervals,
        (
          ${hasNote}::boolean
          and ${hasExpectedVersion}::boolean
          and ${value.noteExpectedVersion ?? null}::integer <> t.note_version
        ) as note_conflict
      from chosen
      join target t on t.id = chosen.id
      join goals g on g.id = chosen.goal_id
      left join tasks task on task.id = chosen.task_id
    `);
    const row = result.rows[0];
    return row ? viewFromFastRow(row, now) : null;
  }

  /**
   * Pause and resume are the most frequently repeated timer mutations. Keep
   * the lock, interval write, Session update and response projection inside a
   * single statement so a remote PostgreSQL database costs one roundtrip.
   * Invalid states return no row and fall back to the detailed path below for
   * the precise domain error.
   */
  async function fastTransition(
    id: string,
    operation: "pause" | "resume",
  ): Promise<SessionView | null> {
    const now = new Date();
    const fromStatus = operation === "pause" ? "active" : "paused";
    const toStatus = operation === "pause" ? "paused" : "active";
    const result = await database.execute<FastSessionRow>(sql`
      with session_lock as materialized (
        select pg_advisory_xact_lock(hashtext(${"session:" + id}))
      ), target as materialized (
        select s.*
        from session_lock
        join sessions s on s.id = ${id}::uuid
        for update of s
      ), closed as (
        update focus_intervals fi
        set ended_at = ${now}, updated_at = ${now}
        from target t
        where ${operation}::text = 'pause'
          and t.status = 'active'
          and fi.session_id = t.id
          and fi.ended_at is null
        returning fi.*
      ), opened as (
        insert into focus_intervals (session_id, phase, started_at)
        select t.id, 'focus', ${now}
        from target t
        where ${operation}::text = 'resume' and t.status = 'paused'
        returning *
      ), write_marker as materialized (
        select
          (select count(*) from closed) +
          (select count(*) from opened) as writes
      ), updated as (
        update sessions s
        set
          status = ${toStatus}::session_status,
          revision = t.revision + 1,
          updated_at = ${now}
        from target t, write_marker
        where s.id = t.id and t.status = ${fromStatus}::session_status
        returning s.*
      ), chosen as (
        select * from updated
        union all
        select t.* from target t
        where t.status = ${toStatus}::session_status
          and not exists (select 1 from updated)
      )
      select
        row_to_json(chosen) as session,
        row_to_json(g) as goal,
        case when task.id is null then null else row_to_json(task) end as task,
        coalesce(
          (
            select json_agg(
              interval_row order by interval_started_at, interval_id
            )
            from (
              select
                coalesce(to_jsonb(c), to_jsonb(fi)) as interval_row,
                fi.started_at as interval_started_at,
                fi.id as interval_id
              from focus_intervals fi
              left join closed c on c.id = fi.id
              where fi.session_id = chosen.id

              union all

              select
                to_jsonb(o) as interval_row,
                o.started_at as interval_started_at,
                o.id as interval_id
              from opened o
            ) all_intervals
          ),
          '[]'::json
        ) as intervals
      from chosen
      join goals g on g.id = chosen.goal_id
      left join tasks task on task.id = chosen.task_id
    `);
    const row = result.rows[0];
    return row ? viewFromFastRow(row, now) : null;
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
      if (!value.idempotencyKey) {
        const fast = await fastStart(context, value);
        if (fast) return fast;
      }
      const requestHash = requestHashOf({
        goalId: value.goalId,
        taskId: value.taskId ?? null,
        timerMode: value.timerMode,
        intent: value.intent ?? null,
      });

      const result = await database.transaction(async (tx) => {
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

        return { session, now: startedAt };
      });
      return viewOfRow(database, result.session, result.now);
    },

    async pauseSession(context, id) {
      void context;
      parsed(sessionPauseSchema.safeParse({ id }));
      const fast = await fastTransition(id, "pause");
      if (fast) return fast;

      const result = await database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, id);
        const now = new Date();

        if (session.status === "paused") {
          return { session, now };
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
        return { session: updated!, now };
      });
      return viewOfRow(database, result.session, result.now);
    },

    async resumeSession(context, id) {
      void context;
      parsed(sessionResumeSchema.safeParse({ id }));
      const fast = await fastTransition(id, "resume");
      if (fast) return fast;

      const result = await database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, id);
        const now = new Date();

        if (session.status === "active") {
          return { session, now };
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
        return { session: updated!, now };
      });
      return viewOfRow(database, result.session, result.now);
    },

    async finishSession(context, id, input) {
      void context;
      const value = parsed(
        sessionFinishSchema.safeParse({ ...(input ?? {}), id }),
      );

      const fast = await fastFinish(value);
      if (fast) return fast;

      const result = await database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, value.id);
        const now = new Date();

        // Idempotent: a lost response retry returns the same result.
        if (session.status === "completed") {
          return { session, now, noteConflict: false };
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

        return { session: updated!, now, noteConflict };
      });
      const view = await viewOfRow(database, result.session, result.now);
      return result.noteConflict ? { ...view, noteConflict: true } : view;
    },

    async cancelSession(context, id) {
      void context;
      parsed(sessionCancelSchema.safeParse({ id }));
      const result = await database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, id);
        const now = new Date();

        if (session.status === "cancelled") {
          return { session, now };
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
        return { session: updated!, now };
      });
      return viewOfRow(database, result.session, result.now);
    },

    async updateNote(context, input) {
      void context;
      const value = parsed(sessionNoteUpdateSchema.safeParse(input));
      const result = await database.transaction(async (tx) => {
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
        return { session: updated!, now };
      });
      return viewOfRow(database, result.session, result.now);
    },

    async updateResumeHint(context, input) {
      void context;
      const value = parsed(sessionResumeHintUpdateSchema.safeParse(input));
      const result = await database.transaction(async (tx) => {
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
        return { session: updated!, now };
      });
      return viewOfRow(database, result.session, result.now);
    },
  };
}
