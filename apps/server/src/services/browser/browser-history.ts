import {
  clearBrowserHistory as clearBrowserHistoryRows,
  deleteBrowserHistoryEntry as deleteBrowserHistoryEntryRow,
  listBrowserHistoryEntries as listBrowserHistoryEntryRows,
  recordBrowserHistoryVisit as recordBrowserHistoryVisitRow,
  type BrowserHistoryEntryRow,
} from "@patcher/db";
import type {
  BrowserHistoryEntry,
  RecordBrowserHistoryVisitRequest,
} from "@patcher/server-contract";
import { ApiError } from "../../errors.js";
import type { PluginService } from "../plugins/plugin-service.js";
import type { AppDeps } from "../../types.js";

/**
 * The browser's history store.
 *
 * It lives here rather than in the app because three things need the same
 * rows: the surface that browses, the omnibox that ranks them, and plugins —
 * and a store in one window's localStorage is reachable by none of the others.
 *
 * The one piece of behaviour above the database is the filter pass: a visit is
 * shown to every plugin's history filter before it is written, so "never record
 * this host" and "strip the tracking parameters" are plugins rather than
 * settings nobody asked for.
 */

export type BrowserHistoryDeps = Pick<AppDeps, "db" | "hub"> & {
  plugins: Pick<PluginService, "applyBrowserHistoryFilters">;
};

export interface ListBrowserHistoryArgs {
  limit: number;
  query?: string;
  scopeId?: string;
}

function toBrowserHistoryEntry(
  row: BrowserHistoryEntryRow,
): BrowserHistoryEntry {
  return {
    id: row.id,
    scopeId: row.scopeId,
    url: row.url,
    title: row.title,
    visitCount: row.visitCount,
    lastVisitedAt: row.lastVisitedAt,
  };
}

/** Null when a plugin's history filter dropped the visit. */
export async function recordBrowserHistoryVisit(
  deps: BrowserHistoryDeps,
  request: RecordBrowserHistoryVisitRequest,
): Promise<BrowserHistoryEntry | null> {
  const filtered = await deps.plugins.applyBrowserHistoryFilters({
    scopeId: request.scopeId,
    url: request.url,
    title: request.title,
    visitedAt: request.visitedAt ?? Date.now(),
  });
  if (filtered === null) {
    return null;
  }
  // A filter may have rewritten the URL to nothing; that is a dropped visit
  // rather than a row keyed on the empty string.
  if (filtered.url.length === 0) {
    return null;
  }
  return toBrowserHistoryEntry(
    recordBrowserHistoryVisitRow(deps.db, {
      scopeId: filtered.scopeId,
      url: filtered.url,
      title: filtered.title,
      visitedAt: filtered.visitedAt,
    }),
  );
}

export function listBrowserHistory(
  deps: Pick<BrowserHistoryDeps, "db">,
  args: ListBrowserHistoryArgs,
): BrowserHistoryEntry[] {
  return listBrowserHistoryEntryRows(deps.db, {
    limit: args.limit,
    ...(args.query === undefined ? {} : { query: args.query }),
    ...(args.scopeId === undefined ? {} : { scopeId: args.scopeId }),
  }).map(toBrowserHistoryEntry);
}

export function deleteBrowserHistoryEntry(
  deps: Pick<BrowserHistoryDeps, "db" | "hub">,
  id: string,
): void {
  if (!deleteBrowserHistoryEntryRow(deps.db, id)) {
    throw new ApiError(404, "not_found", "History entry not found");
  }
  notifyBrowserHistoryChanged(deps);
}

export function clearBrowserHistory(
  deps: Pick<BrowserHistoryDeps, "db" | "hub">,
  args: { scopeId: string | null },
): number {
  const removed = clearBrowserHistoryRows(deps.db, {
    ...(args.scopeId === null ? {} : { scopeId: args.scopeId }),
  });
  if (removed > 0) {
    notifyBrowserHistoryChanged(deps);
  }
  return removed;
}

/**
 * Broadcast for removals only, deliberately.
 *
 * A visit happens on every page load, and telling every open window to re-read
 * its recents that often would be a lot of traffic for a list the window that
 * navigated can refresh on its own. A removal is the opposite: rare, asked for
 * by the user, and a window still showing what was cleared is showing something
 * wrong.
 */
function notifyBrowserHistoryChanged(
  deps: Pick<BrowserHistoryDeps, "hub">,
): void {
  deps.hub.notifySystem(["browser-history-changed"]);
}
