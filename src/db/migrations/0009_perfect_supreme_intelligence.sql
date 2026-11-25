CREATE TABLE `election_sabotages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`election_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`purchase_id` integer NOT NULL,
	`buyer_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`type` text NOT NULL,
	`percent` integer,
	`expires_at` integer,
	`restored_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `election_sabotages_election_idx` ON `election_sabotages` (`election_id`);--> statement-breakpoint
CREATE TABLE `store_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`icon_type` text DEFAULT 'emoji' NOT NULL,
	`icon` text DEFAULT '🎁' NOT NULL,
	`price` integer DEFAULT 100 NOT NULL,
	`kind` text NOT NULL,
	`panel` text,
	`role_id` text,
	`sabotage_type` text,
	`sabotage_days` integer,
	`sabotage_percent` integer,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `store_purchases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`item_name` text NOT NULL,
	`kind` text NOT NULL,
	`user_id` text NOT NULL,
	`price` integer NOT NULL,
	`token` text,
	`panel` text,
	`token_opened_at` integer,
	`token_used_at` integer,
	`role_id` text,
	`election_id` integer,
	`target_user_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_purchases_token_unique` ON `store_purchases` (`token`);--> statement-breakpoint
CREATE INDEX `store_purchases_user_idx` ON `store_purchases` (`user_id`);