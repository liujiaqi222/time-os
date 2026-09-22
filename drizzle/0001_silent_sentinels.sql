ALTER TABLE "tracks" DROP CONSTRAINT "tracks_current_task_id_tasks_id_fk";
--> statement-breakpoint
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_current_task_track_fk" FOREIGN KEY ("current_task_id","id") REFERENCES "public"."tasks"("id","track_id") ON DELETE no action ON UPDATE no action;