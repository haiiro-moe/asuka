PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_activity_wrapped_links` (
	`user_id` text NOT NULL,
	`year` integer NOT NULL,
	`token` text NOT NULL,
	`data` text NOT NULL,
	`dm_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`opens` integer DEFAULT 0 NOT NULL,
	`last_opened_at` integer,
	`processed_run_id` integer,
	`private` integer DEFAULT 0 NOT NULL,
	`owner_user_id` text DEFAULT '' NOT NULL,
	PRIMARY KEY(`user_id`, `year`, `owner_user_id`)
);
--> statement-breakpoint
INSERT INTO `__new_activity_wrapped_links`("user_id", "year", "token", "data", "dm_status", "created_at", "opens", "last_opened_at", "processed_run_id", "private", "owner_user_id") SELECT "user_id", "year", "token", "data", "dm_status", "created_at", "opens", "last_opened_at", "processed_run_id", "private", "owner_user_id" FROM `activity_wrapped_links`;--> statement-breakpoint
DROP TABLE `activity_wrapped_links`;--> statement-breakpoint
ALTER TABLE `__new_activity_wrapped_links` RENAME TO `activity_wrapped_links`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `activity_wrapped_links_token_unique` ON `activity_wrapped_links` (`token`);