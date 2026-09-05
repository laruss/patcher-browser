CREATE TABLE `browser_access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`level` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `browser_access_grants_revoked_created_idx` ON `browser_access_grants` (`revoked_at`,`created_at`);