/**
 * What an external-link handler answered, checked before Patcher acts on it.
 *
 * The value arrives from plugin code — over JSON for an out-of-process plugin,
 * so it can be any shape at all — and what it asks for is a navigation. Two
 * rules follow, and both are enforced here rather than at the route, because
 * this is where the untrusted value lands:
 *
 * - a rewritten address must be `http(s)`, since it opens in a browsed view
 *   where `file:` would be a reader for the local disk and `javascript:` a click
 *   that runs it;
 * - anything else is a decline rather than an error, which leaves the arriving
 *   link to open exactly as it would with no plugins at all.
 */

import type { PluginBrowserExternalLinkDecision } from "./plugin-api.js";

/**
 * The browser's own URL cap, restated rather than imported: the server does not
 * depend on the desktop boundary, and a longer address would be refused by it
 * anyway.
 */
export const EXTERNAL_LINK_URL_MAX_LENGTH = 4_096;

function readRewrittenUrl(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > EXTERNAL_LINK_URL_MAX_LENGTH
  ) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:"
    ? value
    : null;
}

export function readBrowserExternalLinkDecision(
  value: unknown,
): PluginBrowserExternalLinkDecision | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as { handled?: unknown; url?: unknown };
  const handled = record.handled === true;
  const url = readRewrittenUrl(record.url);
  // A handler that decided nothing this side can act on has declined, and the
  // next plugin gets its turn.
  if (!handled && url === null) {
    return null;
  }
  return {
    ...(handled ? { handled: true } : {}),
    ...(url === null ? {} : { url }),
  };
}
