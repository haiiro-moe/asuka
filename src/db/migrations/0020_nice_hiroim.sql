ALTER TABLE `activity_wrapped_links` ADD `private` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `activity_wrapped_links` ADD `owner_user_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `activity_wrapped_runs` ADD `kind` text DEFAULT 'real' NOT NULL;--> statement-breakpoint
ALTER TABLE `activity_wrapped_runs` ADD `owner_user_id` text;--> statement-breakpoint
ALTER TABLE `activity_wrapped_runs` ADD `preview` text;--> statement-breakpoint
ALTER TABLE `activity_wrapped_runs` ADD `server_token` text;--> statement-breakpoint
CREATE UNIQUE INDEX `activity_wrapped_runs_server_token_unique` ON `activity_wrapped_runs` (`server_token`);