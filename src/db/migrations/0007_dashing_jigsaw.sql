CREATE TABLE `club_announce_tokens` (
	`token` text PRIMARY KEY NOT NULL,
	`club_id` integer NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`club_id`) REFERENCES `clubs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `club_announce_tokens_club_idx` ON `club_announce_tokens` (`club_id`);