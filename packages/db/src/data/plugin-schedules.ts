import { and, asc, eq, lte, ne, notInArray } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { pluginSchedules } from "../schema.js";

export interface PluginScheduleRow {
  pluginId: string;
  name: string;
  cron: string;
  nextRunAt: number;
  lastRunAt: number | null;
  lastStatus: "running" | "ok" | "error" | null;
  lastError: string | null;
  updatedAt: number;
}

/**
 * Registration-time upsert (plugin load): inserts the row, and for a row that
 * already exists rewrites cron + next_run_at **only when the cron changed**.
 * last_run_at/last_status/last_error are run history and are kept either way.
 *
 * Leaving `next_run_at` alone for an unchanged cron is what lets a missed tick
 * survive a load. With the same cron, a stored time still ahead of now is
 * already that cron's next occurrence, so recomputing it is a no-op; the only
 * value a recompute *would* move is one that came due while the plugin was not
 * loaded. Moving that one is how a `"0 9 * * *"` schedule on a machine that is
 * asleep or shut down at 09:00 silently never runs at all — every load pushed
 * it to tomorrow, and nothing was ever recorded as skipped. Left where it is,
 * the next sweep claims it: one catch-up run, then back on cadence, because
 * {@link claimPluginScheduledRun} advances from the cron rather than from the
 * time it missed.
 *
 * A changed cron is the one case where the stored time is not this schedule's
 * any more, so it is recomputed and a tick the old cron missed is dropped with
 * it.
 */
export function upsertPluginSchedule(
  db: DbConnection,
  args: { pluginId: string; name: string; cron: string; nextRunAt: number },
): void {
  const updatedAt = Date.now();
  db.insert(pluginSchedules)
    .values({ ...args, updatedAt })
    .onConflictDoUpdate({
      target: [pluginSchedules.pluginId, pluginSchedules.name],
      set: { cron: args.cron, nextRunAt: args.nextRunAt, updatedAt },
      // Unqualified in SQLite's DO UPDATE, this is the row already stored —
      // `excluded.cron` would be the one being registered now.
      setWhere: ne(pluginSchedules.cron, args.cron),
    })
    .run();
}

/** Drop rows whose schedule name is no longer registered by the plugin. */
export function prunePluginSchedules(
  db: DbConnection,
  pluginId: string,
  keepNames: string[],
): void {
  const conditions = [eq(pluginSchedules.pluginId, pluginId)];
  if (keepNames.length > 0) {
    conditions.push(notInArray(pluginSchedules.name, keepNames));
  }
  db.delete(pluginSchedules)
    .where(and(...conditions))
    .run();
}

export function deletePluginSchedules(db: DbConnection, pluginId: string): void {
  db.delete(pluginSchedules)
    .where(eq(pluginSchedules.pluginId, pluginId))
    .run();
}

export function listPluginSchedules(
  db: DbConnection,
  pluginId?: string,
): PluginScheduleRow[] {
  const query = db.select().from(pluginSchedules);
  return (
    pluginId === undefined
      ? query
      : query.where(eq(pluginSchedules.pluginId, pluginId))
  )
    .orderBy(asc(pluginSchedules.pluginId), asc(pluginSchedules.name))
    .all();
}

export function listDuePluginSchedules(
  db: DbConnection,
  args: { now: number; limit: number },
): PluginScheduleRow[] {
  return db
    .select()
    .from(pluginSchedules)
    .where(lte(pluginSchedules.nextRunAt, args.now))
    .orderBy(asc(pluginSchedules.nextRunAt), asc(pluginSchedules.pluginId))
    .limit(args.limit)
    .all();
}

/**
 * Optimistic at-most-once claim: advance next_run_at only if it still equals
 * the expected value. A single UPDATE, so no explicit transaction is needed.
 */
export function claimPluginScheduledRun(
  db: DbConnection,
  args: {
    pluginId: string;
    name: string;
    expectedNextRunAt: number;
    newNextRunAt: number;
    now: number;
  },
): boolean {
  const result = db
    .update(pluginSchedules)
    .set({
      nextRunAt: args.newNextRunAt,
      lastRunAt: args.now,
      lastStatus: "running",
      lastError: null,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(pluginSchedules.pluginId, args.pluginId),
        eq(pluginSchedules.name, args.name),
        eq(pluginSchedules.nextRunAt, args.expectedNextRunAt),
      ),
    )
    .run();
  return result.changes > 0;
}

export function recordPluginScheduleResult(
  db: DbConnection,
  args: {
    pluginId: string;
    name: string;
    status: "ok" | "error";
    error: string | null;
    now: number;
  },
): void {
  db.update(pluginSchedules)
    .set({ lastStatus: args.status, lastError: args.error, updatedAt: args.now })
    .where(
      and(
        eq(pluginSchedules.pluginId, args.pluginId),
        eq(pluginSchedules.name, args.name),
      ),
    )
    .run();
}
