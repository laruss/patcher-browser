import { and, desc, eq, like, lt, sql } from "drizzle-orm";
import {
  BROWSER_HISTORY_MAX_ENTRIES,
  BROWSER_HISTORY_TITLE_MAX_LENGTH,
} from "@patcher/domain";
import type { DbQueryConnection } from "../connection.js";
import { browserHistoryEntries } from "../schema.js";
import { createBrowserHistoryEntryId } from "../ids.js";

export interface BrowserHistoryEntryRow {
  id: string;
  scopeId: string;
  url: string;
  title: string | null;
  visitCount: number;
  lastVisitedAt: number;
}

export interface RecordBrowserHistoryVisitInput {
  scopeId: string;
  url: string;
  title: string | null;
  /** Defaults to now. Set it to import visits that happened elsewhere. */
  visitedAt?: number;
}

export interface ListBrowserHistoryEntriesArgs {
  limit: number;
  /** Substring of the URL or title, matched case-insensitively. */
  query?: string;
  /** One surface's history; omit for every scope. */
  scopeId?: string;
}

export interface ClearBrowserHistoryArgs {
  /** One surface's history; omit to clear all of it. */
  scopeId?: string;
}

const ROW_COLUMNS = {
  id: browserHistoryEntries.id,
  scopeId: browserHistoryEntries.scopeId,
  url: browserHistoryEntries.url,
  title: browserHistoryEntries.title,
  visitCount: browserHistoryEntries.visitCount,
  lastVisitedAt: browserHistoryEntries.lastVisitedAt,
};

/** What `search_text` holds — see the column's comment for why JS folds it. */
function buildSearchText(url: string, title: string | null): string {
  return `${url}\n${title ?? ""}`.toLowerCase();
}

/** Escapes a user's query so `%` and `_` in it match themselves. */
function likePattern(query: string): string {
  return `%${query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;
}

/**
 * Drop the oldest entries once the store is over its cap.
 *
 * Cuts on `last_visited_at` rather than on row count so entries sharing the
 * cutoff timestamp are kept together: an import that stamps a thousand visits
 * with one timestamp should not lose an arbitrary half of them.
 */
function pruneBrowserHistory(db: DbQueryConnection): void {
  const cutoff = db
    .select({ lastVisitedAt: browserHistoryEntries.lastVisitedAt })
    .from(browserHistoryEntries)
    .orderBy(desc(browserHistoryEntries.lastVisitedAt))
    .limit(1)
    .offset(BROWSER_HISTORY_MAX_ENTRIES - 1)
    .get();
  if (cutoff === undefined) {
    return;
  }
  db.delete(browserHistoryEntries)
    .where(lt(browserHistoryEntries.lastVisitedAt, cutoff.lastVisitedAt))
    .run();
}

/**
 * Record a visit: a new row, or a bump of the one this scope already has for
 * this URL.
 *
 * Read-then-write rather than an upsert because the title needs a decision an
 * `ON CONFLICT` clause makes badly — a page that navigates before its title
 * arrives reports null, and null must not erase the title already stored.
 * Safe without a transaction: better-sqlite3 is synchronous, so nothing
 * interleaves between the read and the write.
 */
export function recordBrowserHistoryVisit(
  db: DbQueryConnection,
  input: RecordBrowserHistoryVisitInput,
): BrowserHistoryEntryRow {
  const visitedAt = input.visitedAt ?? Date.now();
  const title =
    input.title === null
      ? null
      : input.title.slice(0, BROWSER_HISTORY_TITLE_MAX_LENGTH);
  const existing = db
    .select(ROW_COLUMNS)
    .from(browserHistoryEntries)
    .where(
      and(
        eq(browserHistoryEntries.scopeId, input.scopeId),
        eq(browserHistoryEntries.url, input.url),
      ),
    )
    .get();

  if (existing !== undefined) {
    const nextTitle = title ?? existing.title;
    return db
      .update(browserHistoryEntries)
      .set({
        title: nextTitle,
        searchText: buildSearchText(input.url, nextTitle),
        visitCount: existing.visitCount + 1,
        lastVisitedAt: Math.max(visitedAt, existing.lastVisitedAt),
      })
      .where(eq(browserHistoryEntries.id, existing.id))
      .returning(ROW_COLUMNS)
      .get();
  }

  const inserted = db
    .insert(browserHistoryEntries)
    .values({
      id: createBrowserHistoryEntryId(),
      scopeId: input.scopeId,
      url: input.url,
      title,
      searchText: buildSearchText(input.url, title),
      visitCount: 1,
      lastVisitedAt: visitedAt,
    })
    .returning(ROW_COLUMNS)
    .get();
  pruneBrowserHistory(db);
  return inserted;
}

export function listBrowserHistoryEntries(
  db: DbQueryConnection,
  args: ListBrowserHistoryEntriesArgs,
): BrowserHistoryEntryRow[] {
  const conditions = [
    args.scopeId === undefined
      ? undefined
      : eq(browserHistoryEntries.scopeId, args.scopeId),
    args.query === undefined || args.query.length === 0
      ? undefined
      : like(
          browserHistoryEntries.searchText,
          sql`${likePattern(args.query)} escape '\\'`,
        ),
  ].filter((condition) => condition !== undefined);

  return db
    .select(ROW_COLUMNS)
    .from(browserHistoryEntries)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(
      desc(browserHistoryEntries.lastVisitedAt),
      desc(browserHistoryEntries.id),
    )
    .limit(args.limit)
    .all();
}

/** True when the entry existed; false is an id nobody has. */
export function deleteBrowserHistoryEntry(
  db: DbQueryConnection,
  id: string,
): boolean {
  return (
    db
      .delete(browserHistoryEntries)
      .where(eq(browserHistoryEntries.id, id))
      .returning({ id: browserHistoryEntries.id })
      .all().length > 0
  );
}

/** How many entries were removed. */
export function clearBrowserHistory(
  db: DbQueryConnection,
  args: ClearBrowserHistoryArgs = {},
): number {
  return db
    .delete(browserHistoryEntries)
    .where(
      args.scopeId === undefined
        ? undefined
        : eq(browserHistoryEntries.scopeId, args.scopeId),
    )
    .returning({ id: browserHistoryEntries.id })
    .all().length;
}
