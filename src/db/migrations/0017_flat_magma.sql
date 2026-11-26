ALTER TABLE `activity_emoji` ADD `parent_channel_id` text;--> statement-breakpoint
ALTER TABLE `activity_mentions` ADD `parent_channel_id` text;--> statement-breakpoint
ALTER TABLE `activity_reactions` ADD `parent_channel_id` text;