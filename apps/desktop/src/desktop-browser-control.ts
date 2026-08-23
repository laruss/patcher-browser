/**
 * The parts of direct tab control that are decisions rather than protocol
 * calls: which URL a route claims, and what an evaluated value looks like by
 * the time an agent reads it.
 *
 * Kept out of the view manager because both are worth being sure about and
 * neither needs an Electron window to check. The rest of Stage E is CDP
 * (`Fetch`, `Input`, `Runtime`, `Network.emulateNetworkConditions`) and lives
 * where the session does.
 *
 * Two properties this module is responsible for:
 *
 * - **A pattern is a pattern, not a program.** Route patterns arrive as text
 *   from a model and become a regular expression here. Every character that is
 *   not a wildcard is escaped, so a pattern containing `(`, `.` or `+` matches
 *   those characters rather than meaning something to the regex engine.
 * - **An evaluated result is text.** What a page returns is page-shaped, and the
 *   only honest thing to carry across a typed wire is its JSON with a length
 *   cap and a flag saying whether that was all of it.
 */

import type { PatcherDesktopBrowserRoute } from "@patcher/desktop-contract";

/**
 * Playwright's URL glob, which is the dialect route patterns are written in:
 * `**` crosses path separators, `*` stops at one, `?` is a single character
 * that is not a separator. A pattern with no wildcard is an exact URL.
 */
export function browserRoutePatternToRegExp(pattern: string): RegExp {
  let source = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index] ?? "";
    if (char === "*") {
      if (pattern[index + 1] === "*") {
        index += 1;
        source += ".*";
      } else {
        source += "[^/]*";
      }
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    // Everything else is a literal. Escaping is the whole point: a query string
    // is full of characters a regex would otherwise read as syntax.
    source += char.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${source}$`, "u");
}

/**
 * The first route that claims this URL, or null.
 *
 * First rather than most-specific, deliberately: Playwright answers with the
 * most recently added matching route, and "the one I just added wins" is the
 * rule a person debugging a mock expects. Callers keep the list newest-first.
 */
export function matchBrowserRoute<TRoute extends PatcherDesktopBrowserRoute>(
  routes: readonly TRoute[],
  url: string,
): TRoute | null {
  for (const route of routes) {
    let matcher: RegExp;
    try {
      matcher = browserRoutePatternToRegExp(route.pattern);
    } catch {
      // A pattern that will not compile matches nothing rather than taking the
      // whole interception down with it — every other request still has to be
      // answered.
      continue;
    }
    if (matcher.test(url)) {
      return route;
    }
  }
  return null;
}

/** Response headers for `Fetch.fulfillRequest`, content type first. */
export function toBrowserFulfillHeaders(
  route: PatcherDesktopBrowserRoute,
): { name: string; value: string }[] {
  return [
    ...(route.contentType.length === 0
      ? []
      : [{ name: "content-type", value: route.contentType }]),
    ...route.headers,
  ];
}

export interface BrowserEvalValue {
  value: string;
  truncated: boolean;
}

/**
 * What an expression returned, as the text an agent reads.
 *
 * `undefined` is spelled out rather than dropped: an expression that returned
 * nothing and one that returned `null` are different answers, and a caller
 * reading an empty string could not tell either from a page that answered "".
 */
export function formatBrowserEvalValue(
  value: unknown,
  maxLength: number,
): BrowserEvalValue {
  let text: string;
  try {
    // `JSON.stringify` answers `undefined` for undefined, a function or a
    // symbol — none of which survived `returnByValue` anyway.
    text = JSON.stringify(value) ?? "undefined";
  } catch {
    // A cycle, or a `toJSON` that threw. The page produced something; saying so
    // beats reporting the whole call as failed.
    text = "[unserializable]";
  }
  return text.length > maxLength
    ? { value: text.slice(0, maxLength), truncated: true }
    : { value: text, truncated: false };
}
