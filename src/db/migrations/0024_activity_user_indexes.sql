CREATE INDEX `activity_emoji_user_ts_idx` ON `activity_emoji` (`user_id`,`ts`);--> statement-breakpoint
CREATE INDEX `activity_mentions_from_ts_idx` ON `activity_mentions` (`from_user_id`,`ts`);--> statement-breakpoint
CREATE INDEX `activity_reactions_user_added_idx` ON `activity_reactions` (`user_id`,`added_at`);--> statement-breakpoint
CREATE INDEX `activity_voice_open_user_idx` ON `activity_voice` (`user_id`) WHERE "activity_voice"."ended_at" IS NULL;