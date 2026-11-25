CREATE TABLE `anilist_oauth_states` (
	`state` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
DELETE FROM `anilist_links`;--> statement-breakpoint
ALTER TABLE `anilist_links` ADD `access_token` text NOT NULL;--> statement-breakpoint
ALTER TABLE `anilist_links` ADD `token_expires_at` integer NOT NULL;