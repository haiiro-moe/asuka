ALTER TABLE `activity_wrapped_runs` ADD `build_failed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `activity_wrapped_runs` ADD `error` text;