CREATE TABLE `protected_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`source_hash` text NOT NULL,
	`origin` text NOT NULL,
	`account_id` text NOT NULL,
	`version` integer NOT NULL,
	`record` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `protected_credentials_account` ON `protected_credentials` (`owner`,`source_hash`,`origin`,`account_id`);