CREATE TYPE "public"."goal_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."resource_type" AS ENUM('url', 'text');--> statement-breakpoint
CREATE TYPE "public"."session_created_via" AS ENUM('web', 'mcp');--> statement-breakpoint
CREATE TYPE "public"."session_entry_mode" AS ENUM('timer', 'manual');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'paused', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'completed', 'skipped', 'archived');--> statement-breakpoint
CREATE TYPE "public"."track_status" AS ENUM('active', 'completed', 'archived');--> statement-breakpoint
CREATE TABLE "app_settings" (
	"id" varchar(32) PRIMARY KEY DEFAULT 'default' NOT NULL,
	"timezone" varchar(120) NOT NULL,
	"default_focus_minutes" integer NOT NULL,
	"week_starts_on" integer NOT NULL,
	"selected_track_id" uuid,
	"setup_completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_settings_singleton" CHECK ("app_settings"."id" = 'default'),
	CONSTRAINT "app_settings_focus_positive" CHECK ("app_settings"."default_focus_minutes" > 0),
	CONSTRAINT "app_settings_week_start" CHECK ("app_settings"."week_starts_on" in (0, 1))
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
	"track_id" uuid NOT NULL,
	"task_id" uuid,
	"status" "session_status" NOT NULL,
	"entry_mode" "session_entry_mode" NOT NULL,
	"created_via" "session_created_via" NOT NULL,
	"planned_minutes" integer,
	"started_at" timestamp with time zone NOT NULL,
	"paused_at" timestamp with time zone,
	"total_paused_seconds" integer DEFAULT 0 NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_planned_minutes_positive" CHECK ("sessions"."planned_minutes" is null or "sessions"."planned_minutes" > 0),
	CONSTRAINT "sessions_paused_seconds_nonnegative" CHECK ("sessions"."total_paused_seconds" >= 0),
	CONSTRAINT "sessions_duration_seconds_nonnegative" CHECK ("sessions"."duration_seconds" is null or "sessions"."duration_seconds" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"track_id" uuid NOT NULL,
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
	CONSTRAINT "tasks_id_track_unique" UNIQUE("id","track_id"),
	CONSTRAINT "tasks_position_positive" CHECK ("tasks"."position" > 0),
	CONSTRAINT "tasks_estimated_minutes_positive" CHECK ("tasks"."estimated_minutes" is null or "tasks"."estimated_minutes" > 0),
	CONSTRAINT "tasks_resource_pair" CHECK (("tasks"."resource_type" is null) = ("tasks"."resource_value" is null)),
	CONSTRAINT "tasks_url_protocol" CHECK ("tasks"."resource_type" is distinct from 'url' or "tasks"."resource_value" ~ '^https?://')
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text,
	"status" "track_status" DEFAULT 'active' NOT NULL,
	"current_task_id" uuid,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_position_positive" CHECK ("tracks"."position" > 0)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_selected_track_id_tracks_id_fk" FOREIGN KEY ("selected_track_id") REFERENCES "public"."tracks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "distractions" ADD CONSTRAINT "distractions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_task_track_fk" FOREIGN KEY ("task_id","track_id") REFERENCES "public"."tasks"("id","track_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_current_task_id_tasks_id_fk" FOREIGN KEY ("current_task_id") REFERENCES "public"."tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "distractions_session_archived_idx" ON "distractions" USING btree ("session_id","archived_at");--> statement-breakpoint
CREATE INDEX "goals_status_position_idx" ON "goals" USING btree ("status","position");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_one_running_unique" ON "sessions" USING btree ((true)) WHERE "sessions"."status" in ('active', 'paused');--> statement-breakpoint
CREATE INDEX "sessions_track_started_idx" ON "sessions" USING btree ("track_id","started_at");--> statement-breakpoint
CREATE INDEX "sessions_task_idx" ON "sessions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "sessions_status_started_idx" ON "sessions" USING btree ("status","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_track_position_unique" ON "tasks" USING btree ("track_id","position");--> statement-breakpoint
CREATE INDEX "tasks_track_status_position_idx" ON "tasks" USING btree ("track_id","status","position");--> statement-breakpoint
CREATE INDEX "tracks_goal_status_position_idx" ON "tracks" USING btree ("goal_id","status","position");