/**
 * What a history filter answered, in a shape that survives the plugin
 * boundary.
 *
 * A filter may return nothing (accept the visit), a rewrite (record something
 * else), or `null` (drop it). Two of those are `undefined` and `null`, which a
 * JSON transport cannot tell apart — and confusing them is not a cosmetic bug:
 * a filter that forgets to return would silently erase the user's history. So
 * the decision is normalised into a tagged value on whichever side ran the
 * filter, and both sides use the same function to do it.
 */

// The leaf module rather than `@patcher/domain`, deliberately: this file is reachable
// from the out-of-process plugin host's startup path, and the barrel pulls the
// browser-control schemas and zod behind it — ~38MB per host process for one
// number. See docs/architecture/plugin-transport.md.
import { BROWSER_HISTORY_URL_MAX_LENGTH } from "@patcher/domain/browser-history";
import type {
  PluginBrowserHistoryRewrite,
  PluginBrowserHistoryVisit,
} from "./plugin-api.js";

export type PluginBrowserHistoryDecision =
  | { drop: true }
  | { rewrite: PluginBrowserHistoryRewrite };

export function normalizeBrowserHistoryDecision(
  decision: PluginBrowserHistoryRewrite | null | void,
): PluginBrowserHistoryDecision {
  return decision === null ? { drop: true } : { rewrite: decision ?? {} };
}

/**
 * The inverse, for the side that received a decision and has to present it as
 * an ordinary filter's return value again — a remote filter must be
 * indistinguishable from a local one, or the caller normalises twice and the
 * rewrite disappears into a nested object.
 */
export function readBrowserHistoryDecision(
  value: unknown,
): PluginBrowserHistoryRewrite | null {
  if (value !== null && typeof value === "object" && "drop" in value) {
    return null;
  }
  return value !== null && typeof value === "object" && "rewrite" in value
    ? ((value as { rewrite: PluginBrowserHistoryRewrite }).rewrite ?? {})
    : {};
}

/**
 * Applies what a filter asked for, and ignores what it cannot ask for.
 *
 * A rewrite is the one thing on the write path that no schema has checked: the
 * route validated the *visit*, but this arrives from plugin code — over JSON for
 * an out-of-process plugin, so it can be any shape at all. A URL that is not a
 * string, is empty, or is longer than the store's own cap is dropped rather than
 * written, because the row it would make is one the wire contract cannot
 * describe: reads validate what they return, so such a row breaks the *next*
 * read of the whole list rather than the write that made it.
 */
export function applyBrowserHistoryRewrite(
  visit: PluginBrowserHistoryVisit,
  rewrite: PluginBrowserHistoryRewrite,
): PluginBrowserHistoryVisit {
  const url: unknown = rewrite.url;
  const title: unknown = rewrite.title;
  return {
    ...visit,
    ...(typeof url === "string" &&
    url.length > 0 &&
    url.length <= BROWSER_HISTORY_URL_MAX_LENGTH
      ? { url }
      : {}),
    ...(title === null || typeof title === "string" ? { title } : {}),
  };
}
