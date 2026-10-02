import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const goalStatus = pgEnum("goal_status", [
  "active",
  "completed",
  "archived",
]);
export const taskStatus = pgEnum("task_status", [
  "pending",
  "completed",
  "skipped",
  "archived",
]);
export const resourceType = pgEnum("resource_type", ["url", "text"]);
export const sessionStatus = pgEnum("session_status", [
  "active",
  "paused",
  "completed",
  "cancelled",
]);
export const sessionEntryMode = pgEnum("session_entry_mode", [
  "timer",
  "manual",
]);
export const sessionCreatedVia = pgEnum("session_created_via", ["web", "mcp"]);
export const timerMode = pgEnum("timer_mode", ["stopwatch", "pomodoro"]);
export const timeBasis = pgEnum("time_basis", [
  "observed",
  "manual",
  "corrected",
]);
export const focusPhase = pgEnum("focus_phase", [
  "focus",
  "short_break",
  "long_break",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};

export const goals = pgTable(
  "goals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description"),
    status: goalStatus("status").default("active").notNull(),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (table) => [
    check("goals_position_positive", sql`${table.position} > 0`),
    index("goals_status_position_idx").on(table.status, table.position),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 500 }).notNull(),
    description: text("description"),
    status: taskStatus("status").default("pending").notNull(),
    position: integer("position").notNull(),
    estimatedMinutes: integer("estimated_minutes"),
    resourceType: resourceType("resource_type"),
    resourceValue: text("resource_value"),
    note: text("note"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("tasks_position_positive", sql`${table.position} > 0`),
    check(
      "tasks_estimated_minutes_positive",
      sql`${table.estimatedMinutes} is null or ${table.estimatedMinutes} > 0`,
    ),
    check(
      "tasks_resource_pair",
      sql`(${table.resourceType} is null) = (${table.resourceValue} is null)`,
    ),
    check(
      "tasks_url_protocol",
      sql`${table.resourceType} is distinct from 'url' or ${table.resourceValue} ~ '^https?://'`,
    ),
    // Positions are unique and dense within a Goal (PRD §3.2).
    uniqueIndex("tasks_goal_position_unique").on(table.goalId, table.position),
    // Composite key so sessions.goalId can reference (id, goal_id) and the
    // database itself guarantees Session/Task/Goal ownership (PRD §3.3, §10).
    unique("tasks_id_goal_unique").on(table.id, table.goalId),
    index("tasks_goal_status_position_idx").on(
      table.goalId,
      table.status,
      table.position,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "restrict" }),
    taskId: uuid("task_id"),
    status: sessionStatus("status").notNull(),
    entryMode: sessionEntryMode("entry_mode").notNull(),
    createdVia: sessionCreatedVia("created_via").notNull(),
    timerMode: timerMode("timer_mode").notNull(),
    timeBasis: timeBasis("time_basis").notNull(),
    // Snapshot of the timer configuration at start time (pomodoro lengths
    // in T08; stopwatch sessions keep it null).
    timerConfig: jsonb("timer_config"),
    intent: text("intent"),
    note: text("note"),
    resumeHint: text("resume_hint"),
    // Write versions (PRD §6.5): note and resumeHint have independent
    // content versions; revision counts every write to the row.
    noteVersion: integer("note_version").default(0).notNull(),
    resumeHintVersion: integer("resume_hint_version").default(0).notNull(),
    revision: integer("revision").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // Effective focus seconds = sum of focus intervals (observed sessions)
    // or the declared duration (manual / corrected).
    durationSeconds: integer("duration_seconds"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "sessions_task_goal_fk",
      columns: [table.taskId, table.goalId],
      foreignColumns: [tasks.id, tasks.goalId],
    }),
    check(
      "sessions_duration_seconds_nonnegative",
      sql`${table.durationSeconds} is null or ${table.durationSeconds} >= 0`,
    ),
    // At most one unfinished Session per instance (PRD §6.1).
    uniqueIndex("sessions_one_running_unique")
      .on(sql`(true)`)
      .where(sql`${table.status} in ('active', 'paused')`),
    index("sessions_goal_started_idx").on(table.goalId, table.startedAt),
    index("sessions_task_idx").on(table.taskId),
    index("sessions_status_started_idx").on(table.status, table.startedAt),
  ],
);

/** Persistent phases; due remains unfinished and holds the global slot. */
export const sessionPhases = pgTable(
  "session_phases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    kind: focusPhase("kind").notNull(),
    sequence: integer("sequence").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    remainingMs: integer("remaining_ms").notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    complete: boolean("complete").default(false).notNull(),
    advanceAction: text("advance_action"),
    nextPhaseId: uuid("next_phase_id"),
  },
  (table) => [
    unique("session_phases_sequence_unique").on(
      table.sessionId,
      table.sequence,
    ),
    check(
      "session_phases_remaining_nonnegative",
      sql`${table.remainingMs} >= 0`,
    ),
  ],
);
export type SessionPhase = typeof sessionPhases.$inferSelect;

/**
 * Real observed focus intervals (PRD §3.4). start opens an interval,
 * pause/finish/cancel close it, resume opens a new one. Stopwatch sessions
 * only ever write `focus` phases; pomodoro phases arrive in T08.
 */
export const focusIntervals = pgTable(
  "focus_intervals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    phase: focusPhase("phase").default("focus").notNull(),
    phaseId: uuid("phase_id").references(() => sessionPhases.id),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check(
      "focus_intervals_end_after_start",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
    index("focus_intervals_session_idx").on(table.sessionId),
  ],
);

export const distractions = pgTable(
  "distractions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "restrict" }),
    text: text("text"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index("distractions_session_archived_idx").on(
      table.sessionId,
      table.archivedAt,
    ),
  ],
);

export const appSettings = pgTable(
  "app_settings",
  {
    id: varchar("id", { length: 32 }).primaryKey().default("default"),
    timezone: varchar("timezone", { length: 120 }).notNull(),
    weekStartsOn: integer("week_starts_on").notNull(),
    // Preferred timer mode for the next Session (stopwatch in T06; T08
    // makes pomodoro the default for new instances).
    timerMode: timerMode("timer_mode").default("pomodoro").notNull(),
    timerPreferences: jsonb("timer_preferences"),
    // The single execution selection {goalId, taskId} (PRD §3.5).
    // taskId = null means explicit goal-only execution; omitting taskId in
    // a set request means auto-resolve — never persisted as a distinct state.
    selectedGoalId: uuid("selected_goal_id").references(() => goals.id, {
      onDelete: "set null",
    }),
    selectedTaskId: uuid("selected_task_id"),
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("app_settings_singleton", sql`${table.id} = 'default'`),
    check("app_settings_week_start", sql`${table.weekStartsOn} in (0, 1)`),
    check(
      "app_settings_task_requires_goal",
      sql`${table.selectedTaskId} is null or ${table.selectedGoalId} is not null`,
    ),
    foreignKey({
      name: "app_settings_selection_task_fk",
      columns: [table.selectedTaskId, table.selectedGoalId],
      foreignColumns: [tasks.id, tasks.goalId],
    }),
  ],
);

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    operation: varchar("operation", { length: 80 }).notNull(),
    key: varchar("key", { length: 200 }).notNull(),
    requestHash: varchar("request_hash", { length: 64 }).notNull(),
    resultRef: uuid("result_ref"),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.operation, table.key] })],
);

export type AppSettings = typeof appSettings.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type FocusInterval = typeof focusIntervals.$inferSelect;
export type Distraction = typeof distractions.$inferSelect;
