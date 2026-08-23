import type {
  BrowserHistoryEntry,
  BrowserHistoryQuery,
} from "@patcher/server-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface BrowserHistoryListArgs {
  /** How many entries, newest first. Defaults to the server's own limit. */
  limit?: number;
  /** Substring of the URL or title, matched case-insensitively. */
  query?: string;
  /** One surface's history — a thread id, or the browser surface's own id. */
  scopeId?: string;
  signal?: AbortSignal;
}

export interface BrowserHistoryRecordArgs {
  scopeId: string;
  url: string;
  title: string | null;
  /** When the visit happened. Defaults to now; set it to import old visits. */
  visitedAt?: number;
}

export interface BrowserHistoryRemoveArgs {
  id: string;
}

export interface BrowserHistoryClearArgs {
  /** One surface's history; omit to clear all of it. */
  scopeId?: string;
}

/**
 * The browser's history store.
 *
 * A real store rather than the browser's private state: a plugin can read what
 * was visited, add visits it imported from somewhere else, and delete what the
 * user should not have kept. What it cannot do from here is see a visit as it
 * happens — that is `patcher.browser.registerHistoryFilter`, which runs before the
 * write and can rewrite or drop it.
 */
export interface BrowserHistoryArea {
  list(args?: BrowserHistoryListArgs): Promise<BrowserHistoryEntry[]>;
  /** Null when a history filter dropped the visit. */
  record(args: BrowserHistoryRecordArgs): Promise<BrowserHistoryEntry | null>;
  remove(args: BrowserHistoryRemoveArgs): Promise<void>;
  /** How many entries were removed. */
  clear(args?: BrowserHistoryClearArgs): Promise<number>;
}

function listQuery(args: BrowserHistoryListArgs): BrowserHistoryQuery {
  return {
    ...(args.limit === undefined ? {} : { limit: String(args.limit) }),
    ...(args.query === undefined ? {} : { query: args.query }),
    ...(args.scopeId === undefined ? {} : { scopeId: args.scopeId }),
  };
}

export function createBrowserHistoryArea(
  args: CreateSdkAreaArgs,
): BrowserHistoryArea {
  const { transport } = args;
  return {
    async list(input = {}) {
      const response = await transport.readJson(
        transport.api.v1["browser-history"].$get(
          { query: listQuery(input) },
          ...signalRequestArgs(input.signal),
        ),
      );
      return response.entries;
    },
    async record(input) {
      const response = await transport.readJson(
        transport.api.v1["browser-history"].$post({
          json: {
            scopeId: input.scopeId,
            url: input.url,
            title: input.title,
            ...(input.visitedAt === undefined
              ? {}
              : { visitedAt: input.visitedAt }),
          },
        }),
      );
      return response.entry;
    },
    async remove(input) {
      await transport.readJson(
        transport.api.v1["browser-history"][":id"].$delete({
          param: { id: input.id },
        }),
      );
    },
    async clear(input = {}) {
      const response = await transport.readJson(
        transport.api.v1["browser-history"].$delete({
          json: { scopeId: input.scopeId ?? null },
        }),
      );
      return response.removed;
    },
  };
}
