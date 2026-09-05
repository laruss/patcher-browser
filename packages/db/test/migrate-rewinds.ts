import type { DbConnection } from "../src/index.js";

/**
 * Walking one thing back off the schema, so a migration that adds it can replay.
 *
 * `migrate.test.ts` builds a database at the *current* schema and then rewinds
 * it to a checkpoint — which means everything added since that checkpoint has to
 * come off first, or the replay hits "duplicate column" or "table already
 * exists". One helper per column, and one per table where a migration added a
 * whole one, each idempotent, because a rewind names the ones its scenario needs
 * rather than all of them.
 *
 * They live here rather than beside their callers for a reason with a number on
 * it: `eslint.max-lines.mjs` pins that file, so it can shrink and cannot grow,
 * and the next migration will want a helper of its own. This is the cohesive
 * unit that moves — every member takes only a `DbConnection`, rewinds exactly
 * one column or one table, and knows nothing about the scenarios that call it.
 */

interface TableInfoRow {
  name: string;
  notnull: number;
}

// Migration 0079 adds the side_chat_plugin experiment column alongside the
// side-chat visibility backfill. Rewind scenarios that clear its
// __drizzle_migrations row must also rewind the schema: ALTER TABLE ADD is
// not re-appliable against a column that already exists (the backfill UPDATE
// itself is idempotent).
// Inverse of dropSideChatPluginExperimentColumn: 0084 DROPs the column, so a
// scenario that re-applies 0084 must put it back first.
export function restoreSideChatPluginExperimentColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(system_experiments)")
    .all();
  if (!columns.some((column) => column.name === "side_chat_plugin")) {
    db.$client.exec(
      "ALTER TABLE `system_experiments` ADD `side_chat_plugin` integer DEFAULT false NOT NULL",
    );
  }
}

export function dropSideChatPluginExperimentColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(system_experiments)")
    .all();
  if (columns.some((column) => column.name === "side_chat_plugin")) {
    db.$client
      .prepare("ALTER TABLE system_experiments DROP COLUMN side_chat_plugin")
      .run();
  }
}

// Migration 0082 drops the `plugins` experiment column. Rewind scenarios that
// clear its migration row must restore the column before replaying the
// migration, since ALTER TABLE DROP COLUMN is not re-appliable.
export function restorePluginsExperimentColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(system_experiments)")
    .all();
  if (!columns.some((column) => column.name === "plugins")) {
    db.$client
      .prepare(
        "ALTER TABLE system_experiments ADD `plugins` integer DEFAULT false NOT NULL",
      )
      .run();
  }
}

// Migration 0080 adds the Tools Hub experiment column. Rewind scenarios that
// clear its migration row must drop the column before replaying the migration.
export function dropToolsHubExperimentColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(system_experiments)")
    .all();
  if (columns.some((column) => column.name === "tools_hub")) {
    db.$client
      .prepare("ALTER TABLE system_experiments DROP COLUMN tools_hub")
      .run();
  }
}

// Migration 0087 adds the new onboarding experiment column. Rewind scenarios
// that clear its migration row must drop the column before replay.
export function dropNewOnboardingExperimentColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(system_experiments)")
    .all();
  if (columns.some((column) => column.name === "new_onboarding")) {
    db.$client
      .prepare("ALTER TABLE system_experiments DROP COLUMN new_onboarding")
      .run();
  }
}

// Migration 0097 adds the terminal sandbox flag. Rewind scenarios that clear
// its migration row must drop the column before replay.
export function dropTerminalSandboxedColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(terminal_sessions)")
    .all();
  if (columns.some((column) => column.name === "sandboxed")) {
    db.$client
      .prepare("ALTER TABLE terminal_sessions DROP COLUMN sandboxed")
      .run();
  }
}

// Migration 0083 adds the machine permission ceiling. Rewind scenarios that
// clear its migration row must drop the column before replay.
export function dropHostMaxPermissionModeColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(hosts)")
    .all();
  if (columns.some((column) => column.name === "max_permission_mode")) {
    db.$client
      .prepare("ALTER TABLE hosts DROP COLUMN max_permission_mode")
      .run();
  }
}

// Migration 0081 adds the active-thread Enter behavior preference. Rewind
// scenarios that clear its migration row must drop the column before replay.
export function dropSteerActiveThreadOnEnterColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(app_settings)")
    .all();
  if (
    columns.some((column) => column.name === "steer_active_thread_on_enter")
  ) {
    db.$client
      .prepare(
        "ALTER TABLE app_settings DROP COLUMN steer_active_thread_on_enter",
      )
      .run();
  }
}

export function dropBrowserSearchEngineIdColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(app_settings)")
    .all();
  if (columns.some((column) => column.name === "browser_search_engine_id")) {
    db.$client
      .prepare("ALTER TABLE app_settings DROP COLUMN browser_search_engine_id")
      .run();
  }
}

export function dropCodexNetworkDisabledColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(app_settings)")
    .all();
  if (columns.some((column) => column.name === "codex_network_disabled")) {
    db.$client
      .prepare("ALTER TABLE app_settings DROP COLUMN codex_network_disabled")
      .run();
  }
}

export function dropProviderEgressColumns(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(app_settings)")
    .all();
  for (const column of [
    "provider_egress_confined",
    "provider_egress_allowed_hosts",
  ]) {
    if (columns.some((existing) => existing.name === column)) {
      db.$client
        .prepare(`ALTER TABLE app_settings DROP COLUMN ${column}`)
        .run();
    }
  }
}

export function dropBrowserExternalAccessColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(app_settings)")
    .all();
  if (columns.some((column) => column.name === "browser_external_access")) {
    db.$client
      .prepare("ALTER TABLE app_settings DROP COLUMN browser_external_access")
      .run();
  }
}

export function dropOnboardingCompletedAtColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(app_settings)")
    .all();
  if (columns.some((column) => column.name === "onboarding_completed_at")) {
    db.$client
      .prepare("ALTER TABLE app_settings DROP COLUMN onboarding_completed_at")
      .run();
  }
}

export function dropProjectGitRemoteUrlColumn(db: DbConnection): void {
  const columns = db.$client
    .prepare<[], TableInfoRow>("PRAGMA table_info(projects)")
    .all();
  if (columns.some((column) => column.name === "git_remote_url")) {
    db.$client.prepare("ALTER TABLE projects DROP COLUMN git_remote_url").run();
  }
}

/** Migration 0102 creates it; a replay of 0102 needs it gone. */
export function dropBrowserAccessGrantsTable(db: DbConnection): void {
  db.$client.prepare("DROP TABLE IF EXISTS browser_access_grants").run();
}
