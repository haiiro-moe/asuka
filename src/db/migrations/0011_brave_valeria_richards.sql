CREATE TABLE `anilist_links` (
	`user_id` text PRIMARY KEY NOT NULL,
	`anilist_id` integer NOT NULL,
	`username` text NOT NULL,
	`linked_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot_messages` (
	`key` text PRIMARY KEY NOT NULL,
	`components` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bot_variables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`code` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bot_variables_name_unique` ON `bot_variables` (`name`);--> statement-breakpoint
ALTER TABLE `store_items` ADD `message_key` text;