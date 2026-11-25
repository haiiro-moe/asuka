ALTER TABLE `clubs` ADD `activity_points` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clubs` ADD `activity_updated_at` integer DEFAULT (unixepoch()) NOT NULL;