PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_hosts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`connect_machine_id` text,
	`max_permission_mode` text DEFAULT 'auto' NOT NULL,
	`destroyed_at` integer,
	`last_seen_at` integer,
	`last_rejected_protocol_version` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_hosts`("id", "name", "type", "connect_machine_id", "max_permission_mode", "destroyed_at", "last_seen_at", "last_rejected_protocol_version", "created_at", "updated_at") SELECT "id", "name", "type", "connect_machine_id", "max_permission_mode", "destroyed_at", "last_seen_at", "last_rejected_protocol_version", "created_at", "updated_at" FROM `hosts`;--> statement-breakpoint
DROP TABLE `hosts`;--> statement-breakpoint
ALTER TABLE `__new_hosts` RENAME TO `hosts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `hosts_last_seen_idx` ON `hosts` (`last_seen_at`);--> statement-breakpoint
-- Sandbox became the product default, and the default alone reaches only
-- machines enrolled after it: `upsertHost` writes the value on insert and never
-- on update, deliberately, so a re-enrolment cannot reset an owner's choice.
-- Without this line the change does nothing on any install that already exists.
--
-- A deliberate Full Access cannot be told apart from the old default here, so
-- both are lowered. That direction is the reversible one: a machine that wanted
-- Full Access says so on its next turn with a message naming the limit and whose
-- it is to change, whereas the other direction leaves the sandbox off in silence.
UPDATE `hosts` SET `max_permission_mode` = 'auto' WHERE `max_permission_mode` = 'full';
