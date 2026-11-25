CREATE TABLE `autoreplies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`match_type` text DEFAULT 'contains' NOT NULL,
	`case_sensitive` integer DEFAULT 0 NOT NULL,
	`response_components` text NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`election_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`motto` text DEFAULT '' NOT NULL,
	`role_description` text DEFAULT '' NOT NULL,
	`message_id` text,
	`vote_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`election_id`) REFERENCES `elections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `candidates_election_idx` ON `candidates` (`election_id`);--> statement-breakpoint
CREATE TABLE `club_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`club_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `club_members_club_idx` ON `club_members` (`club_id`);--> statement-breakpoint
CREATE INDEX `club_members_user_idx` ON `club_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `clubs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`level` integer DEFAULT 1 NOT NULL,
	`thread_id` text,
	`channel_id` text,
	`voice_channel_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_active_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clubs_name_unique` ON `clubs` (`name`);--> statement-breakpoint
CREATE TABLE `elections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`channel_id` text,
	`starts_at` integer DEFAULT (unixepoch()) NOT NULL,
	`ends_at` integer,
	`winner_id` text
);
--> statement-breakpoint
CREATE TABLE `guild_config` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`starboard_channel_id` text,
	`club_listing_channel_id` text,
	`club_category_id` text,
	`election_channel_id` text,
	`mod_log_channel_id` text,
	`level_up_channel_id` text,
	`president_role_id` text,
	`club_create_min_role_id` text,
	`president_apply_min_role_id` text,
	`starboard_emoji` text DEFAULT '⭐' NOT NULL,
	`starboard_threshold` integer DEFAULT 3 NOT NULL,
	`starboard_credit_min` integer DEFAULT 5 NOT NULL,
	`starboard_credit_max` integer DEFAULT 20 NOT NULL,
	`xp_message_min` integer DEFAULT 15 NOT NULL,
	`xp_message_max` integer DEFAULT 25 NOT NULL,
	`xp_message_cooldown_sec` integer DEFAULT 60 NOT NULL,
	`xp_voice_per_minute` integer DEFAULT 10 NOT NULL,
	`credit_reward_min` integer DEFAULT 1 NOT NULL,
	`credit_reward_max` integer DEFAULT 15 NOT NULL,
	`credit_window_min` integer DEFAULT 200 NOT NULL,
	`credit_window_max` integer DEFAULT 1000 NOT NULL,
	`election_interval_cron` text DEFAULT '0 12 1 */3 *' NOT NULL,
	`server_name_template` text DEFAULT 'Asuka Academy — %s' NOT NULL,
	`moderation_enabled` integer DEFAULT 1 NOT NULL,
	`autoreply_enabled` integer DEFAULT 1 NOT NULL,
	`starboard_enabled` integer DEFAULT 1 NOT NULL,
	`xp_enabled` integer DEFAULT 1 NOT NULL,
	`economy_enabled` integer DEFAULT 1 NOT NULL,
	`clubs_enabled` integer DEFAULT 1 NOT NULL,
	`elections_enabled` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `members` (
	`user_id` text PRIMARY KEY NOT NULL,
	`xp` integer DEFAULT 0 NOT NULL,
	`level` integer DEFAULT 0 NOT NULL,
	`social_credits` integer DEFAULT 0 NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`last_message_xp_at` integer DEFAULT 0 NOT NULL,
	`next_credit_reward_at` integer DEFAULT 0 NOT NULL,
	`joined_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mod_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`user_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`reason` text,
	`metadata` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `president` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`user_id` text,
	`term_start` integer,
	`last_theme_change_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_state` (
	`job_name` text PRIMARY KEY NOT NULL,
	`last_run_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `starboard_posts` (
	`source_message_id` text PRIMARY KEY NOT NULL,
	`source_channel_id` text NOT NULL,
	`author_id` text NOT NULL,
	`starboard_message_id` text,
	`count` integer DEFAULT 0 NOT NULL,
	`rewarded` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `voice_sessions` (
	`user_id` text PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_tick_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `warnings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`moderator_id` text NOT NULL,
	`reason` text DEFAULT 'No reason provided' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `warnings_user_idx` ON `warnings` (`user_id`);