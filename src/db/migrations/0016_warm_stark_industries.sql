CREATE TABLE `activity_backfill` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`before_id` text,
	`scanned` integer DEFAULT 0 NOT NULL,
	`done_at` integer,
	`reactions_done_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_commands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`ok` integer NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_credits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`delta` integer NOT NULL,
	`balance_after` integer NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_emoji` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`ts` integer NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`emoji` text NOT NULL,
	`name` text,
	`count` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_emoji_message_emoji_uq` ON `activity_emoji` (`message_id`,`emoji`);--> statement-breakpoint
CREATE INDEX `activity_emoji_emoji_ts_idx` ON `activity_emoji` (`emoji`,`ts`);--> statement-breakpoint
CREATE TABLE `activity_membership` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`ts` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_mentions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`ts` integer NOT NULL,
	`from_user_id` text NOT NULL,
	`to_user_id` text NOT NULL,
	`channel_id` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_mentions_message_to_uq` ON `activity_mentions` (`message_id`,`to_user_id`);--> statement-breakpoint
CREATE INDEX `activity_mentions_ts_idx` ON `activity_mentions` (`ts`);--> statement-breakpoint
CREATE TABLE `activity_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`parent_channel_id` text,
	`ts` integer NOT NULL,
	`reply_to_user_id` text,
	`reply_to_message_id` text,
	`mention_count` integer DEFAULT 0 NOT NULL,
	`attachment_kinds` text DEFAULT '' NOT NULL,
	`link_domains` text DEFAULT '' NOT NULL,
	`sticker_count` integer DEFAULT 0 NOT NULL,
	`length` integer DEFAULT 0 NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_messages_message_id_unique` ON `activity_messages` (`message_id`);--> statement-breakpoint
CREATE INDEX `activity_messages_ts_idx` ON `activity_messages` (`ts`);--> statement-breakpoint
CREATE INDEX `activity_messages_user_ts_idx` ON `activity_messages` (`user_id`,`ts`);--> statement-breakpoint
CREATE INDEX `activity_messages_channel_idx` ON `activity_messages` (`channel_id`);--> statement-breakpoint
CREATE TABLE `activity_reactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`message_id` text NOT NULL,
	`user_id` text NOT NULL,
	`emoji` text NOT NULL,
	`name` text,
	`channel_id` text NOT NULL,
	`message_author_id` text,
	`added_at` integer NOT NULL,
	`removed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_reactions_message_user_emoji_uq` ON `activity_reactions` (`message_id`,`user_id`,`emoji`);--> statement-breakpoint
CREATE INDEX `activity_reactions_added_idx` ON `activity_reactions` (`added_at`);--> statement-breakpoint
CREATE TABLE `activity_voice` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`last_seen_at` integer NOT NULL,
	`muted` integer DEFAULT 0 NOT NULL,
	`deafened` integer DEFAULT 0 NOT NULL,
	`streaming` integer DEFAULT 0 NOT NULL,
	`video` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `activity_voice_user_started_idx` ON `activity_voice` (`user_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `activity_voice_channel_started_idx` ON `activity_voice` (`channel_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `activity_wrapped_links` (
	`user_id` text NOT NULL,
	`year` integer NOT NULL,
	`token` text NOT NULL,
	`data` text NOT NULL,
	`dm_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`opens` integer DEFAULT 0 NOT NULL,
	`last_opened_at` integer,
	PRIMARY KEY(`user_id`, `year`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_wrapped_links_token_unique` ON `activity_wrapped_links` (`token`);--> statement-breakpoint
CREATE TABLE `activity_wrapped_optins` (
	`user_id` text PRIMARY KEY NOT NULL,
	`opted_in_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `activity_wrapped_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`year` integer NOT NULL,
	`status` text NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`processed` integer DEFAULT 0 NOT NULL,
	`sent` integer DEFAULT 0 NOT NULL,
	`failed` integer DEFAULT 0 NOT NULL,
	`started_by` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
ALTER TABLE `guild_config` ADD `activity_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `guild_config` ADD `activity_excluded_channel_ids` text DEFAULT '' NOT NULL;