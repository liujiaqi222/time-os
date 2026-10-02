CREATE TABLE "session_phases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"kind" "focus_phase" NOT NULL,
	"sequence" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"deadline_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"remaining_ms" integer NOT NULL,
	"ended_at" timestamp with time zone,
	"complete" boolean DEFAULT false NOT NULL,
	"advance_action" text,
	"next_phase_id" uuid,
	CONSTRAINT "session_phases_sequence_unique" UNIQUE("session_id","sequence"),
	CONSTRAINT "session_phases_remaining_nonnegative" CHECK ("session_phases"."remaining_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "app_settings" ALTER COLUMN "timer_mode" SET DEFAULT 'pomodoro';--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "timer_preferences" jsonb;--> statement-breakpoint
ALTER TABLE "focus_intervals" ADD COLUMN "phase_id" uuid;--> statement-breakpoint
ALTER TABLE "focus_intervals" ADD COLUMN "deadline_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "session_phases" ADD CONSTRAINT "session_phases_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_intervals" ADD CONSTRAINT "focus_intervals_phase_id_session_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."session_phases"("id") ON DELETE no action ON UPDATE no action;