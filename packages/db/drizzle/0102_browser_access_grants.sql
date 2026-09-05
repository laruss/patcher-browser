CREATE TABLE `browser_access_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`level` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer
);
