ALTER TABLE `activity_wrapped_links` ADD `processed_run_id` integer;--> statement-breakpoint
ALTER TABLE `activity_wrapped_runs` ADD `send_dms` integer DEFAULT 1 NOT NULL;