CREATE INDEX "focus_intervals_session_focus_idx" ON "focus_intervals" USING btree ("session_id","started_at") WHERE "focus_intervals"."phase" = 'focus';--> statement-breakpoint
CREATE INDEX "sessions_started_id_idx" ON "sessions" USING btree ("started_at","id");--> statement-breakpoint
CREATE INDEX "sessions_ended_idx" ON "sessions" USING btree ("ended_at") WHERE "sessions"."status" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "tasks_completed_at_idx" ON "tasks" USING btree ("completed_at","id") WHERE "tasks"."status" = 'completed';