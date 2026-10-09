CREATE TABLE `plugin_site_grants` (
	`plugin_id` text NOT NULL,
	`origin` text NOT NULL,
	`fingerprint` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`plugin_id`, `origin`),
	FOREIGN KEY (`plugin_id`) REFERENCES `plugins`(`id`) ON UPDATE no action ON DELETE cascade
);
