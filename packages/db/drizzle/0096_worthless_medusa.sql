-- IF NOT EXISTS on both statements: several migration tests migrate to head,
-- delete the journal rows from a chosen point onwards and re-apply forward, so
-- every migration after that point replays against a schema that already has
-- its changes. A table nothing has applied yet cannot exist for any other
-- reason, so skipping is the right no-op rather than a masked inconsistency.
CREATE TABLE IF NOT EXISTS `env_setup_script_approvals` (
	`project_id` text NOT NULL,
	`script_sha256` text NOT NULL,
	`approved_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `env_setup_script_approvals_project_sha_idx` ON `env_setup_script_approvals` (`project_id`,`script_sha256`);
