PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_clubs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`thread_id` text,
	`channel_id` text,
	`voice_channel_id` text,
	`activity_points` real DEFAULT 0 NOT NULL,
	`activity_updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_active_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_clubs`("id", "name", "description", "owner_id", "status", "level", "thread_id", "channel_id", "voice_channel_id", "activity_points", "activity_updated_at", "created_at", "last_active_at") SELECT "id", "name", "description", "owner_id", "status", "level", "thread_id", "channel_id", "voice_channel_id", "activity_points", "activity_updated_at", "created_at", "last_active_at" FROM `clubs`;--> statement-breakpoint
DROP TABLE `clubs`;--> statement-breakpoint
ALTER TABLE `__new_clubs` RENAME TO `clubs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `clubs_name_unique` ON `clubs` (`name`);--> statement-breakpoint
ALTER TABLE `club_members` ADD `accepted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_config` ADD `approval_channel_id` text;