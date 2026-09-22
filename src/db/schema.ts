import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
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
export const trackStatus = pgEnum("track_status", [
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

export const tracks = pgTable(
  "tracks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "restrict" }),
    title: varchar("title", { length: 240 }).notNull(),
    description: text("description"),
    status: trackStatus("status").default("active").notNull(),
    currentTaskId: uuid("current_task_id"),
    position: integer("position").notNull(),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "tracks_current_task_track_fk",
      columns: [table.currentTaskId, table.id],
      foreignColumns: [tasks.id, tasks.trackId],
    }),
    check("tracks_position_positive", sql`${table.position} > 0`),
    index("tracks_goal_status_position_idx").on(
      table.goalId,
      table.status,
      table.position,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackId: uuid("track_id")
      .notNull()
      .references((): AnyPgColumn => tracks.id, { onDelete: "restrict" }),
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
    uniqueIndex("tasks_track_position_unique").on(
      table.trackId,
      table.position,
    ),
    unique("tasks_id_track_unique").on(table.id, table.trackId),
    index("tasks_track_status_position_idx").on(
      table.trackId,
      table.status,
      table.position,
    ),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => tracks.id, { onDelete: "restrict" }),
    taskId: uuid("task_id"),
    status: sessionStatus("status").notNull(),
    entryMode: sessionEntryMode("entry_mode").notNull(),
    createdVia: sessionCreatedVia("created_via").notNull(),
    plannedMinutes: integer("planned_minutes"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    totalPausedSeconds: integer("total_paused_seconds").default(0).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    note: text("note"),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "sessions_task_track_fk",
      columns: [table.taskId, table.trackId],
      foreignColumns: [tasks.id, tasks.trackId],
    }),
    check(
      "sessions_planned_minutes_positive",
      sql`${table.plannedMinutes} is null or ${table.plannedMinutes} > 0`,
    ),
    check(
      "sessions_paused_seconds_nonnegative",
      sql`${table.totalPausedSeconds} >= 0`,
    ),
    check(
      "sessions_duration_seconds_nonnegative",
      sql`${table.durationSeconds} is null or ${table.durationSeconds} >= 0`,
    ),
    uniqueIndex("sessions_one_running_unique")
      .on(sql`(true)`)
      .where(sql`${table.status} in ('active', 'paused')`),
    index("sessions_track_started_idx").on(table.trackId, table.startedAt),
    index("sessions_task_idx").on(table.taskId),
    index("sessions_status_started_idx").on(table.status, table.startedAt),
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
    defaultFocusMinutes: integer("default_focus_minutes").notNull(),
    weekStartsOn: integer("week_starts_on").notNull(),
    selectedTrackId: uuid("selected_track_id").references(() => tracks.id, {
      onDelete: "set null",
    }),
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    check("app_settings_singleton", sql`${table.id} = 'default'`),
    check("app_settings_focus_positive", sql`${table.defaultFocusMinutes} > 0`),
    check("app_settings_week_start", sql`${table.weekStartsOn} in (0, 1)`),
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

export const loginAttempts = pgTable(
  "login_attempts",
  {
    identityHash: varchar("identity_hash", { length: 64 }).primaryKey(),
    failedCount: integer("failed_count").default(0).notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    blockedUntil: timestamp("blocked_until", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("login_attempts_failed_nonnegative", sql`${table.failedCount} >= 0`),
  ],
);

export type AppSettings = typeof appSettings.$inferSelect;
