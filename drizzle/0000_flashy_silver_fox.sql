CREATE TYPE "public"."focus_phase" AS ENUM('focus', 'short_break', 'long_break');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('url', 'text');--> statement-breakpoint
CREATE TYPE "public"."session_created_via" AS ENUM('web', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."session_entry_mode" AS ENUM('timer', 'manual');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'completed', 'skipped', 'archived');--> statement-breakpoint
CREATE TYPE "public"."time_basis" AS ENUM('observed', 'manual', 'corrected');--> statement-breakpoint
CREATE TYPE "public"."timer_mode" AS ENUM('stopwatch', 'pomodoro');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" varchar(32) PRIMARY KEY DEFAULT 'default' NOT NULL,
	"timezone" varchar(120) NOT NULL,
	"week_starts_on" integer NOT NULL,
	"timer_mode" timer_mode DEFAULT 'stopwatch' NOT NULL,
	"selected_goal_id" uuid,
	"selected_task_id" uuid,
	"setup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton" CHECK ("app_settings"."id" = 'default'),
	CONSTRAINT "app_settings_week_start" CHECK ("app_settings"."week_starts_on" in (0, 1)),
	CONSTRAINT "app_settings_task_requires_goal" CHECK ("app_settings"."selected_task_id" is null or "app_settings"."selected_goal_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "distractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"text" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "focus_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"phase" "focus_phase" DEFAULT 'focus' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "focus_intervals_end_after_start" CHECK ("focus_intervals"."ended_at" is null or "focus_intervals"."ended_at" >= "focus_intervals"."started_at")
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_position_positive" CHECK ("goals"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"operation" varchar(80) NOT NULL,
	"key" varchar(200) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"result_ref" uuid,
	"result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_operation_key_pk" PRIMARY KEY("operation","key")
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"identity_hash" varchar(64) PRIMARY KEY NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_attempts_failed_nonnegative" CHECK ("login_attempts"."failed_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"task_id" uuid,
	"status" "session_status" NOT NULL,
	"entry_mode" "session_entry_mode" NOT NULL,
	"created_via" "session_created_via" NOT NULL,
	"timer_mode" timer_mode NOT NULL,
	"time_basis" time_basis NOT NULL,
	"timer_config" jsonb,
	"intent" text,
	"note" text,
	"resume_hint" text,
	"note_version" integer DEFAULT 0 NOT NULL,
	"resume_hint_version" integer DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_duration_seconds_nonnegative" CHECK ("sessions"."duration_seconds" is null or "sessions"."duration_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" varchar(500) NOT NULL,
	"description" text,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"position" integer NOT NULL,
	"estimated_minutes" integer,
	"resource_type" "resource_type",
	"resource_value" text,
	"note" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_id_goal_unique" UNIQUE("id","goal_id"),
	CONSTRAINT "tasks_position_positive" CHECK ("tasks"."position" > 0),
	CONSTRAINT "tasks_estimated_minutes_positive" CHECK ("tasks"."estimated_minutes" is null or "tasks"."estimated_minutes" > 0),
	CONSTRAINT "tasks_resource_pair" CHECK (("tasks"."resource_type" is null) = ("tasks"."resource_value" is null)),
	CONSTRAINT "tasks_url_protocol" CHECK ("tasks"."resource_type" is distinct from 'url' or "tasks"."resource_value" ~ '^https?://')
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_selected_goal_id_goals_id_fk" FOREIGN KEY ("selected_goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_selection_task_fk" FOREIGN KEY ("selected_task_id","selected_goal_id") REFERENCES "public"."tasks"("id","goal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distractions" ADD CONSTRAINT "distractions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_intervals" ADD CONSTRAINT "focus_intervals_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_task_goal_fk" FOREIGN KEY ("task_id","goal_id") REFERENCES "public"."tasks"("id","goal_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "distractions_session_archived_idx" ON "distractions" USING btree ("session_id","archived_at");--> statement-breakpoint
CREATE INDEX "focus_intervals_session_idx" ON "focus_intervals" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "goals_status_position_idx" ON "goals" USING btree ("status","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_running_unique" ON "sessions" USING btree ((true)) WHERE "sessions"."status" in ('active', 'paused');--> statement-breakpoint
CREATE INDEX "sessions_goal_started_idx" ON "sessions" USING btree ("goal_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_task_idx" ON "sessions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "sessions_status_started_idx" ON "sessions" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_goal_position_unique" ON "tasks" USING btree ("goal_id","position");--> statement-breakpoint
CREATE INDEX "tasks_goal_status_position_idx" ON "tasks" USING btree ("goal_id","status","position");