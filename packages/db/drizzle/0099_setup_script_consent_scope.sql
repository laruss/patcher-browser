-- The old table is dropped rather than migrated: its rows say "this project
-- allowed these bytes" and cannot say on which machine or in which checkout,
-- which is the ambiguity this table exists to remove. Carrying them forward
-- would grandfather exactly that. The cost is one question asked again.
--
-- IF NOT EXISTS / IF EXISTS on every statement: several migration tests migrate
-- to head, rewind the schema and re-apply forward, so this replays against a
-- schema that may already have its changes.
CREATE TABLE IF NOT EXISTS `env_setup_script_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`host_id` text NOT NULL,
	`source_path` text NOT NULL,
	`script_sha256` text NOT NULL,
	`script_path` text NOT NULL,
	`script_byte_length` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `env_setup_script_consents_scope_idx` ON `env_setup_script_consents` (`project_id`,`host_id`,`source_path`,`script_sha256`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `env_setup_script_consents_project_idx` ON `env_setup_script_consents` (`project_id`);--> statement-breakpoint
DROP TABLE IF EXISTS `env_setup_script_approvals`;