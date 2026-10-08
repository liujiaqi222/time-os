import { asc, eq, inArray, isNull, and, sql } from "drizzle-orm";

import type { AuthenticatedContext } from "@/auth/context";
import type { Database } from "@/db/client";
import {
  appSettings,
  sessionPhases,
  focusIntervals,
  goals,
  sessions,
  tasks,
  type Distraction,
  type FocusInterval,
  type Goal,
  type Session,
  type SessionPhase,
  type Task,
} from "@/db/schema";
import { DomainError } from "@/shared/domain-error";
import {
  sessionAdvanceSchema,
  type SessionAdvanceInput,
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

import { configOf, projectPhases } from "@/shared/pomodoro";
import {
  loadPhases,
  openPhase,
  settlePhase,
  pausePhase,
  resumePhase,
  endPhase,
} from "@/services/session-phases";

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
  phases?: ReturnType<typeof projectPhases>["phases"];
  phase?: ReturnType<typeof projectPhases>["phase"];
  completedFocusCount?: number;
  nextBreakKind?: string;
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
    phaseId: row.phase_id == null ? null : String(row.phase_id),
    deadlineAt: nullableDate(row.deadline_at),
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
  phases?: JsonRecord[];
  note_conflict?: boolean;
}

function phaseFromJson(row: JsonRecord): SessionPhase {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    kind: row.kind as SessionPhase["kind"],
    sequence: Number(row.sequence),
    startedAt: dateValue(row.started_at),
    deadlineAt: nullableDate(row.deadline_at),
    pausedAt: nullableDate(row.paused_at),
    remainingMs: Number(row.remaining_ms),
    endedAt: nullableDate(row.ended_at),
    complete: Boolean(row.complete),
    advanceAction:
      row.advance_action == null ? null : String(row.advance_action),
    nextPhaseId: row.next_phase_id == null ? null : String(row.next_phase_id),
  };
}

function viewFromFastRow(row: FastSessionRow, now: Date): SessionView {
  const session = sessionFromJson(row.session);
  const intervals = row.intervals.map(intervalFromJson);
  const timer =
    session.timerMode === "pomodoro"
      ? projectPhases(session, (row.phases ?? []).map(phaseFromJson), now)
      : null;
  return {
    ...(timer ?? {}),
    ...session,
    goal: goalFromJson(row.goal),
    task: taskFromJson(row.task),
    intervals,
    serverNow: now.toISOString(),
    focusSeconds:
      session.timeBasis === "observed"
        ? focusSecondsOfIntervals(intervals, now)
        : (session.durationSeconds ?? 0),
    actions:
      timer && (session.status === "active" || session.status === "paused")
        ? [
            ...timer.phaseActions,
            "finish",
            "cancel",
            "note_update",
            "resume_hint_update",
            "distraction_log",
          ]
        : availableSessionActions(session.status),
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
  advanceSession(
    context: AuthenticatedContext,
    input: SessionAdvanceInput,
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

async function sessionSnapshot(
  tx: Database | Transaction,
  filter: ReturnType<typeof sql>,
) {
  const result = await tx.execute<FastSessionRow>(sql`
    select row_to_json(s) as session, row_to_json(g) as goal,
      case when t.id is null then null else row_to_json(t) end as task,
      coalesce((select json_agg(fi order by fi.started_at, fi.id) from focus_intervals fi where fi.session_id = s.id), '[]'::json) as intervals,
      coalesce((select json_agg(p order by p.sequence) from session_phases p where p.session_id = s.id), '[]'::json) as phases
    from sessions s join goals g on g.id = s.goal_id left join tasks t on t.id = s.task_id
    where ${filter} limit 1
  `);
  return result.rows[0] ?? null;
}

async function buildView(
  tx: Database | Transaction,
  session: Session,
  now: Date,
): Promise<SessionView> {
  const row = await sessionSnapshot(tx, sql`s.id = ${session.id}::uuid`);
  if (!row)
    throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
      sessionId: session.id,
    });
  return viewFromFastRow(row, now);
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
    clock?: () => Date;
    distractionService: Pick<
      import("@/services/distraction").DistractionService,
      "listDistractions"
    >;
  },
): SessionService {
  const { distractionService } = deps;
  const clock = deps.clock ?? (() => new Date());

  /** A single database snapshot for Session, phases and intervals, including on another device. */
  async function readView(id?: string): Promise<SessionView | null> {
    const row = await sessionSnapshot(
      database,
      id ? sql`s.id = ${id}::uuid` : sql`s.status in ('active', 'paused')`,
    );
    return row ? viewFromFastRow(row, clock()) : null;
  }

  /**
   * Keep fresh starts, including phase creation and retry protection,
   * in one PostgreSQL statement so a remote database costs one roundtrip,
   * while the transaction-scoped locks and relational constraints stay the
   * same. A missing row falls back to the detailed path below for its precise
   * domain error.
   */
  async function fastStart(
    context: AuthenticatedContext,
    value: ReturnType<typeof sessionStartSchema.parse>,
  ): Promise<SessionView | null> {
    const startedAt = clock();
    const taskId = value.taskId ?? null;
    const createdVia = context.actor === "mcp" ? "mcp" : "web";
    const key = value.idempotencyKey ?? null;
    const requestHash = requestHashOf({
      goalId: value.goalId,
      taskId,
      timerMode: value.timerMode,
      intent: value.intent ?? null,
    });
    const defaults = JSON.stringify(configOf(null));
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
        select g.id, gen_random_uuid() as session_id,
          ${defaults}::jsonb || coalesce((select timer_preferences from app_settings where id = 'default'), '{}'::jsonb) as config
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
      ), claimed_key as (
        insert into idempotency_records (operation, key, request_hash, result_ref, result)
        select 'session_start', ${key}::text, ${requestHash}, session_id, jsonb_build_object('sessionId', session_id)
        from candidate where ${key}::text is not null
        on conflict do nothing returning result_ref
      ), new_session as (
        insert into sessions (
          id, goal_id, task_id, status, entry_mode, created_via, timer_mode,
          time_basis, timer_config, intent, note, resume_hint, started_at
        )
        select
          session_id, ${value.goalId}::uuid, ${taskId}::uuid, 'active', 'timer',
          ${createdVia}::session_created_via, ${value.timerMode}::timer_mode, 'observed',
          case when ${value.timerMode} = 'pomodoro' then config else null end,
          ${value.intent ?? null}::text, null, null, ${startedAt}
        from candidate
        where ${key}::text is null or exists (select 1 from claimed_key)
        returning *
      ), new_phase as (
        insert into session_phases (session_id, kind, sequence, started_at, deadline_at, remaining_ms)
        select id, 'focus', 1, started_at,
          started_at + (timer_config->>'focusMinutes')::int * interval '1 minute',
          (timer_config->>'focusMinutes')::int * 60000
        from new_session where timer_mode = 'pomodoro'
        returning *
      ), new_interval as (
        insert into focus_intervals (session_id, phase_id, phase, started_at, deadline_at)
        select ns.id, np.id, 'focus', ns.started_at, np.deadline_at
        from new_session ns left join new_phase np on np.session_id = ns.id
        returning *
      ), new_selection as (
        insert into app_settings (
          id, timezone, week_starts_on, timer_mode,
          selected_goal_id, selected_task_id
        )
        select 'default', 'UTC', 1, timer_mode, goal_id, task_id
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
        json_build_array(row_to_json(ni)) as intervals,
        coalesce((select json_agg(np) from new_phase np), '[]'::json) as phases
      from new_session ns
      join goals g on g.id = ns.goal_id
      left join tasks t on t.id = ns.task_id
      cross join new_interval ni
      cross join new_selection
    `);
    const row = result.rows[0];
    return row ? viewFromFastRow(row, startedAt) : null;
  }

  /** Finish both timer modes in one database roundtrip, including the final note. */
  async function fastFinish(
    value: ReturnType<typeof sessionFinishSchema.parse>,
  ): Promise<SessionView | null> {
    const now = clock();
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
      ), current_phase as materialized (
        select p.* from session_phases p
        join target t on t.id = p.session_id
        order by p.sequence desc limit 1
        for update of p
      ), eligible as materialized (
        select t.* from target t
        where t.revision = (select snapshot.revision from sessions snapshot where snapshot.id = t.id)
      ), phase_changed as (
        update session_phases p
        set ended_at = least(coalesce(cp.deadline_at, ${now}::timestamptz), ${now}::timestamptz),
          complete = cp.complete or (cp.kind = 'focus' and cp.paused_at is null and cp.deadline_at <= ${now}),
          remaining_ms = case when cp.paused_at is not null then cp.remaining_ms
            else greatest(0, extract(epoch from (cp.deadline_at - ${now}::timestamptz)) * 1000)::integer end
        from current_phase cp, eligible t
        where p.id = cp.id and cp.ended_at is null
          and t.status in ('active', 'paused')
        returning p.*
      ), closed as (
        update focus_intervals fi
        set ended_at = least(coalesce(fi.deadline_at, ${now}::timestamptz), ${now}::timestamptz), updated_at = ${now}
        from eligible t
        where fi.session_id = t.id
          and fi.ended_at is null
          and t.status in ('active', 'paused')
        returning fi.*
      ), close_marker as materialized (
        select (select count(*) from closed) + (select count(*) from phase_changed) as closed_count
      ), duration as materialized (
        select coalesce(
          floor(sum(extract(epoch from (
            least(coalesce(fi.ended_at, fi.deadline_at, ${now}::timestamptz), ${now}::timestamptz) - fi.started_at
          )))), 0
        )::integer as seconds
        from focus_intervals fi, eligible t, close_marker
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
        from eligible t, duration
        where s.id = t.id and t.status in ('active', 'paused')
        returning s.*
      ), chosen as (
        select * from updated
        union all
        select t.* from eligible t
        where t.status = 'completed' and not exists (select 1 from updated)
      )
      select
        row_to_json(chosen) as session,
        row_to_json(g) as goal,
        case when task.id is null then null else row_to_json(task) end as task,
        coalesce(
          (
            select json_agg(
              coalesce(to_jsonb(c), to_jsonb(fi))
              order by fi.started_at, fi.id
            )
            from focus_intervals fi
            left join closed c on c.id = fi.id
            where fi.session_id = chosen.id
          ),
          '[]'::json
        ) as intervals,
        coalesce((
          select json_agg(coalesce(to_jsonb(pc), to_jsonb(p)) order by p.sequence)
          from session_phases p left join phase_changed pc on pc.id = p.id
          where p.session_id = chosen.id
        ), '[]'::json) as phases,
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
   * Pause, resume and cancel use the same atomic timer mutation path. Keep
   * the lock, interval write, Session update and response projection inside a
   * single statement so a remote PostgreSQL database costs one roundtrip.
   * Invalid states return no row and fall back to the detailed path below for
   * the precise domain error.
   */
  async function fastTransition(
    id: string,
    operation: "pause" | "resume" | "cancel",
  ): Promise<SessionView | null> {
    const now = clock();
    const fromStatus = operation === "pause" ? "active" : "paused";
    const toStatus =
      operation === "cancel"
        ? "cancelled"
        : operation === "pause"
          ? "paused"
          : "active";
    const result = await database.execute<FastSessionRow>(sql`
      with session_lock as materialized (
        select pg_advisory_xact_lock(hashtext(${"session:" + id}))
      ), locked_session as materialized (
        select s.*
        from session_lock
        join sessions s on s.id = ${id}::uuid
        for update of s
      ), current_phase as materialized (
        select p.* from session_phases p
        join locked_session s on s.id = p.session_id
        order by p.sequence desc limit 1
        for update of p
      ), target as materialized (
        select s.* from locked_session s
        -- A command that waited for another writer must reload in a new statement:
        -- its original snapshot cannot see intervals inserted by that writer.
        where s.revision = (select snapshot.revision from sessions snapshot where snapshot.id = s.id)
          and (${operation}::text = 'cancel' or s.timer_mode = 'stopwatch'
          or exists (
            select 1 from current_phase p where p.ended_at is null
              and (p.paused_at is not null or p.deadline_at > ${now})
          ))
      ), phase_changed as (
        update session_phases p
        set
          paused_at = case when ${operation}::text = 'cancel' then cp.paused_at
            when ${operation}::text = 'pause' then ${now}::timestamptz else null end,
          ended_at = case when ${operation}::text = 'cancel'
            then least(coalesce(cp.deadline_at, ${now}::timestamptz), ${now}::timestamptz)
            else cp.ended_at end,
          complete = cp.complete or (${operation}::text = 'cancel' and cp.kind = 'focus'
            and cp.paused_at is null and cp.deadline_at <= ${now}),
          remaining_ms = case when ${operation}::text = 'cancel' and cp.paused_at is not null
            then cp.remaining_ms
            when ${operation}::text in ('pause', 'cancel')
            then greatest(0, extract(epoch from (cp.deadline_at - ${now}::timestamptz)) * 1000)::integer
            else cp.remaining_ms end,
          deadline_at = case when ${operation}::text = 'resume'
            then ${now}::timestamptz + cp.remaining_ms * interval '1 millisecond'
            when ${operation}::text = 'cancel' then cp.deadline_at else null end
        from current_phase cp, target t
        where p.id = cp.id and t.timer_mode = 'pomodoro'
          and cp.ended_at is null
          and ((${operation}::text = 'cancel' and t.status <> 'cancelled')
            or t.status = ${fromStatus}::session_status and ${operation}::text <> 'cancel')
        returning p.*
      ), closed as (
        update focus_intervals fi
        set ended_at = case when ${operation}::text = 'cancel'
            then least(coalesce(fi.deadline_at, ${now}::timestamptz), ${now}::timestamptz)
            else ${now}::timestamptz end, updated_at = ${now}
        from target t
        where ((${operation}::text = 'cancel' and t.status <> 'cancelled')
          or (${operation}::text = 'pause' and t.status = 'active'))
          and fi.session_id = t.id
          and fi.ended_at is null
        returning fi.*
      ), opened as (
        insert into focus_intervals (session_id, phase, phase_id, started_at, deadline_at)
        select t.id, coalesce(p.kind, 'focus'::focus_phase), p.id, ${now}, p.deadline_at
        from target t
        left join phase_changed p on p.session_id = t.id
        where ${operation}::text = 'resume' and t.status = 'paused'
        returning *
      ), write_marker as materialized (
        select
          (select count(*) from closed) +
          (select count(*) from opened) +
          (select count(*) from phase_changed) as writes
      ), updated as (
        update sessions s
        set
          status = ${toStatus}::session_status,
          revision = t.revision + 1,
          ended_at = case when ${operation}::text = 'cancel' then ${now}::timestamptz else t.ended_at end,
          updated_at = ${now}
        from target t, write_marker
        where s.id = t.id and ((${operation}::text = 'cancel' and t.status <> 'cancelled')
          or (${operation}::text <> 'cancel' and t.status = ${fromStatus}::session_status))
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
        ) as intervals,
        coalesce((
          select json_agg(coalesce(to_jsonb(pc), to_jsonb(p)) order by p.sequence)
          from session_phases p left join phase_changed pc on pc.id = p.id
          where p.session_id = chosen.id
        ), '[]'::json) as phases
      from chosen
      join goals g on g.id = chosen.goal_id
      left join tasks task on task.id = chosen.task_id
    `);
    const row = result.rows[0];
    return row ? viewFromFastRow(row, now) : null;
  }

  /** Atomically settle and open a phase, then read one fresh response snapshot. */
  async function fastAdvance(
    value: SessionAdvanceInput,
  ): Promise<SessionView | null> {
    const now = clock();
    const result = await database.execute<{ id: string }>(sql`
      with session_lock as materialized (
        select pg_advisory_xact_lock(hashtext(${"session:" + value.id}))
      ), locked_session as materialized (
        select s.* from session_lock join sessions s on s.id = ${value.id}::uuid
        for update of s
      ), current_phase as materialized (
        select p.* from session_phases p join locked_session s on s.id = p.session_id
        order by p.sequence desc limit 1 for update of p
      ), target as materialized (
        select s.* from locked_session s, current_phase p
        where s.timer_mode = 'pomodoro' and s.status in ('active', 'paused')
          and s.revision = (select snapshot.revision from sessions snapshot where snapshot.id = s.id)
          and p.id = ${value.expectedPhaseId}::uuid and p.advance_action is null
          and (select count(*) from session_phases fp where fp.session_id = s.id and fp.kind = 'focus')
            < coalesce((s.timer_config->>'iterations')::integer, 4)
          and (
            (p.kind = 'focus' and (p.ended_at is not null or p.paused_at is null and p.deadline_at <= ${now}))
            or (${value.action}::text = 'start_next_focus' and p.kind <> 'focus')
          )
      ), next_kind as materialized (
        select t.*, case when ${value.action}::text = 'start_next_focus' then 'focus'
          when (t.timer_config->>'longBreakEnabled')::boolean and
            (select count(*) from session_phases p where p.session_id = t.id and p.kind = 'focus'
              and (p.complete or p.id = cp.id and cp.paused_at is null and cp.deadline_at <= ${now})) % 4 = 0
            then 'long_break' else 'short_break' end::focus_phase as kind
        from target t, current_phase cp
      ), next_duration as materialized (
        select t.*, (t.timer_config->>case when kind = 'focus' then 'focusMinutes'
          when kind = 'long_break' then 'longBreakMinutes' else 'shortBreakMinutes' end)::integer * 60000 as ms
        from next_kind t
      ), opened_phase as (
        insert into session_phases (session_id, kind, sequence, started_at, deadline_at, remaining_ms)
        select t.id, t.kind, cp.sequence + 1, ${now}, ${now}::timestamptz + t.ms * interval '1 millisecond', t.ms
        from next_duration t, current_phase cp returning *
      ), ended_phase as (
        update session_phases p set
          ended_at = coalesce(cp.ended_at, least(coalesce(cp.deadline_at, ${now}::timestamptz), ${now}::timestamptz)),
          remaining_ms = case when cp.ended_at is not null then cp.remaining_ms
            when cp.paused_at is not null then cp.remaining_ms
            else greatest(0, extract(epoch from (cp.deadline_at - ${now}::timestamptz)) * 1000)::integer end,
          complete = cp.complete or (cp.kind = 'focus' and cp.paused_at is null and cp.deadline_at <= ${now}),
          advance_action = ${value.action}, next_phase_id = np.id
        from current_phase cp, opened_phase np where p.id = cp.id returning p.id
      ), closed_intervals as (
        update focus_intervals fi set ended_at = least(coalesce(fi.deadline_at, ${now}::timestamptz), ${now}::timestamptz), updated_at = ${now}
        from target t where fi.session_id = t.id and fi.ended_at is null returning fi.id
      ), opened_interval as (
        insert into focus_intervals (session_id, phase, phase_id, started_at, deadline_at)
        select p.session_id, p.kind, p.id, p.started_at, p.deadline_at from opened_phase p returning id
      ), marker as materialized (
        select (select count(*) from ended_phase) + (select count(*) from closed_intervals)
          + (select count(*) from opened_interval) as writes
      )
      update sessions s set status = 'active', revision = t.revision + 1, updated_at = ${now}
      from target t, marker where s.id = t.id returning s.id
    `);
    return result.rows[0] ? readView(value.id) : null;
  }

  return {
    async getActiveSession(context) {
      void context;
      return readView();
    },

    async getSession(context, id) {
      parsed(sessionPauseSchema.safeParse({ id }));
      const [view, distractionRows] = await Promise.all([
        readView(id),
        distractionService.listDistractions(context, {
          sessionId: id,
          includeArchived: true,
        }),
      ]);
      if (!view)
        throw new DomainError("SESSION_NOT_FOUND", "Session was not found.", {
          sessionId: id,
        });
      return { ...view, distractions: distractionRows };
    },

    async startSession(context, input) {
      const value = parsed(sessionStartSchema.safeParse(input));
      try {
        const fast = await fastStart(context, value);
        if (fast) return fast;
      } catch (error) {
        // A concurrent statement may acquire its snapshot before waiting for
        // the global lock. The unique constraint arbitrates; retry validation
        // in a fresh transaction to return the normal conflict/replay result.
        const cause =
          (error as { cause?: { code?: string; constraint?: string } }).cause ??
          (error as { code?: string; constraint?: string });
        if (
          cause.code !== "23505" ||
          cause.constraint !== "sessions_one_running_unique"
        )
          throw error;
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

        const startedAt = clock();
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

            await lockScope(tx, `goal:${value.goalId}`);
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

            const [settings] = await tx
              .select()
              .from(appSettings)
              .where(eq(appSettings.id, "default"));
            const [created] = await tx
              .insert(sessions)
              .values({
                goalId: value.goalId,
                taskId: value.taskId ?? null,
                status: "active",
                entryMode: "timer",
                createdVia: context.actor === "mcp" ? "mcp" : "web",
                timerMode: value.timerMode,
                timeBasis: "observed",
                timerConfig:
                  value.timerMode === "pomodoro"
                    ? configOf(settings?.timerPreferences)
                    : null,
                intent: value.intent ?? null,
                note: null,
                resumeHint: null,
                startedAt,
                endedAt: null,
                durationSeconds: null,
              })
              .returning();

            if (value.timerMode === "pomodoro")
              await openPhase(tx, created!, "focus", 1, startedAt);
            else
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

        return {
          session,
          now: startedAt,
          view: await buildView(tx, session, startedAt),
        };
      });
      return result.view;
    },

    async advanceSession(context, input) {
      void context;
      const value = parsed(sessionAdvanceSchema.safeParse(input));
      const fast = await fastAdvance(value);
      if (fast) return fast;
      return database.transaction(async (tx) => {
        await lockScope(tx, `session:${value.id}`);
        const session = await findSessionRow(tx, value.id);
        const now = clock();
        const phase = await settlePhase(tx, session, now);
        const phases = await loadPhases(tx, session.id);
        const expected = phases.find((p) => p.id === value.expectedPhaseId);
        if (expected?.advanceAction === value.action && expected.nextPhaseId)
          return buildView(tx, session, now);
        if (!phase || phase.id !== value.expectedPhaseId)
          throw new DomainError(
            "STALE_SESSION_PHASE",
            "The phase changed. Reload the current Session.",
            {
              sessionId: session.id,
              currentPhaseId: phase?.id ?? null,
              status: session.status,
            },
          );
        const projected = projectPhases(session, phases, now);
        if (!projected.phaseActions.includes(value.action))
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "This action is unavailable in the current phase.",
            { status: session.status },
          );
        await closeOpenIntervals(tx, session.id, now);
        await endPhase(tx, phase, now);
        const next = await openPhase(
          tx,
          session,
          value.action === "start_break"
            ? (projected.nextBreakKind as "short_break" | "long_break")
            : "focus",
          phase.sequence + 1,
          now,
        );
        await tx
          .update(sessionPhases)
          .set({ advanceAction: value.action, nextPhaseId: next.id })
          .where(eq(sessionPhases.id, phase.id));
        const [updated] = await tx
          .update(sessions)
          .set({
            status: "active",
            revision: session.revision + 1,
            updatedAt: now,
          })
          .where(eq(sessions.id, session.id))
          .returning();
        return buildView(tx, updated, now);
      });
    },

    async pauseSession(context, id) {
      void context;
      parsed(sessionPauseSchema.safeParse({ id }));
      const fast = await fastTransition(id, "pause");
      if (fast) return fast;

      const result = await database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, id);
        const now = clock();
        const phase = await settlePhase(tx, session, now);

        if (phase?.endedAt)
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "This phase is due. Choose the next phase or finish.",
          );
        if (session.status === "paused") {
          return { session, now, view: await buildView(tx, session, now) };
        }
        if (session.status !== "active") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only an active Session can be paused.",
            { status: session.status },
          );
        }

        await closeOpenIntervals(tx, id, now);
        if (phase) await pausePhase(tx, phase, now);
        const [updated] = await tx
          .update(sessions)
          .set({
            status: "paused",
            revision: session.revision + 1,
            updatedAt: now,
          })
          .where(eq(sessions.id, id))
          .returning();
        return {
          session: updated!,
          now,
          view: await buildView(tx, updated!, now),
        };
      });
      return result.view;
    },

    async resumeSession(context, id) {
      void context;
      parsed(sessionResumeSchema.safeParse({ id }));
      const fast = await fastTransition(id, "resume");
      if (fast) return fast;

      const result = await database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, id);
        const now = clock();
        const phase = await settlePhase(tx, session, now);

        if (phase?.endedAt)
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "This phase is due. Choose the next phase or finish.",
          );
        if (session.status === "active") {
          return { session, now, view: await buildView(tx, session, now) };
        }
        if (session.status !== "paused") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only a paused Session can be resumed.",
            { status: session.status },
          );
        }

        if (phase) await resumePhase(tx, phase, now);
        else
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
        return {
          session: updated!,
          now,
          view: await buildView(tx, updated!, now),
        };
      });
      return result.view;
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
        const now = clock();
        const phase = await settlePhase(tx, session, now);

        // Idempotent: a lost response retry returns the same result.
        if (session.status === "completed") {
          return {
            session,
            now,
            noteConflict: false,
            view: await buildView(tx, session, now),
          };
        }
        if (session.status !== "active" && session.status !== "paused") {
          throw new DomainError(
            "INVALID_SESSION_STATE",
            "Only an active or paused Session can be finished.",
            { status: session.status },
          );
        }

        await closeOpenIntervals(tx, id, now);
        await endPhase(tx, phase, now);
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

        return {
          session: updated!,
          now,
          noteConflict,
          view: await buildView(tx, updated!, now),
        };
      });
      const view = result.view;
      return result.noteConflict ? { ...view, noteConflict: true } : view;
    },

    async cancelSession(context, id) {
      void context;
      parsed(sessionCancelSchema.safeParse({ id }));
      const fast = await fastTransition(id, "cancel");
      if (fast) return fast;
      const result = await database.transaction(async (tx) => {
        await lockScope(tx, `session:${id}`);
        const session = await findSessionRow(tx, id);
        const now = clock();
        const phase = await settlePhase(tx, session, now);

        if (session.status === "cancelled") {
          return { session, now, view: await buildView(tx, session, now) };
        }

        await closeOpenIntervals(tx, id, now);
        await endPhase(tx, phase, now);
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
        return {
          session: updated!,
          now,
          view: await buildView(tx, updated!, now),
        };
      });
      return result.view;
    },

    async updateNote(context, input) {
      void context;
      const value = parsed(sessionNoteUpdateSchema.safeParse(input));
      const result = await database.transaction(async (tx) => {
        await lockScope(tx, `session:${value.id}`);
        const session = await findSessionRow(tx, value.id);
        const now = clock();
        await settlePhase(tx, session, now);

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
        return {
          session: updated!,
          now,
          view: await buildView(tx, updated!, now),
        };
      });
      return result.view;
    },

    async updateResumeHint(context, input) {
      void context;
      const value = parsed(sessionResumeHintUpdateSchema.safeParse(input));
      const result = await database.transaction(async (tx) => {
        await lockScope(tx, `session:${value.id}`);
        const session = await findSessionRow(tx, value.id);
        const now = clock();
        await settlePhase(tx, session, now);

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
        return {
          session: updated!,
          now,
          view: await buildView(tx, updated!, now),
        };
      });
      return result.view;
    },
  };
}
