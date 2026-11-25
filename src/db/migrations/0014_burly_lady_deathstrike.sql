CREATE TABLE `event_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`mention_role_ids` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_groups_name_unique` ON `event_groups` (`name`);--> statement-breakpoint
CREATE TABLE `event_participants` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_participants_event_idx` ON `event_participants` (`event_id`);--> statement-breakpoint
CREATE INDEX `event_participants_user_idx` ON `event_participants` (`user_id`);--> statement-breakpoint
CREATE TABLE `event_reminders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`offset_minutes` integer DEFAULT 1440 NOT NULL,
	`last_fired_for` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_reminders_event_idx` ON `event_reminders` (`event_id`);--> statement-breakpoint
CREATE TABLE `event_rewards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_id` integer NOT NULL,
	`kind` text NOT NULL,
	`role_id` text,
	`amount` integer,
	`store_item_id` integer,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `event_rewards_event_idx` ON `event_rewards` (`event_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`image_urls` text DEFAULT '[]' NOT NULL,
	`accent_color` integer,
	`group_id` integer,
	`channel_id` text,
	`all_day` integer DEFAULT 0 NOT NULL,
	`start_at` integer NOT NULL,
	`end_at` integer,
	`recurrence` text DEFAULT 'none' NOT NULL,
	`recurrence_interval` integer DEFAULT 1 NOT NULL,
	`recurrence_until` integer,
	`last_rewarded_for` integer DEFAULT 0 NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `event_groups`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `events_start_idx` ON `events` (`start_at`);--> statement-breakpoint
ALTER TABLE `guild_config` ADD `events_channel_id` text;--> statement-breakpoint
ALTER TABLE `guild_config` ADD `events_enabled` integer DEFAULT 1 NOT NULL;