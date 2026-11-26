CREATE TABLE `activity_wrapped_server` (
	`year` integer PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`data` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`announced_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_wrapped_server_token_unique` ON `activity_wrapped_server` (`token`);--> statement-breakpoint
CREATE TABLE `activity_wrapped_signup` (
	`year` integer PRIMARY KEY NOT NULL,
	`channel_id` text,
	`message_id` text,
	`buttons` integer DEFAULT 1 NOT NULL,
	`closed` integer DEFAULT 0 NOT NULL,
	`posted_at` integer,
	`closed_at` integer
);
--> statement-breakpoint
ALTER TABLE `activity_wrapped_runs` ADD `announce` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `activity_wrapped_runs` DROP COLUMN `send_dms`;