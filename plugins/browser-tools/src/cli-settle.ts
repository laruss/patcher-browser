import type {
  PatcherPluginApi,
  PluginBrowserCallOptions,
} from "@patcher/plugin-sdk";

/**
 * Waiting for a page to stop fetching, which is what "loaded" has to mean here.
 *
 * On anything that renders itself the document finishes before its content
 * does, so every command that changes the page settles before it answers. There
 * is nothing to ask the browser for but its own network log, so quiet is
 * measured rather than observed: read the last few entries, and call it quiet
 * when they stop changing for long enough.
 */

/**
 * How many network entries a settle fingerprints. More than one because two
 * requests can finish in the same millisecond and a single-entry window would
 * then look unchanged; few enough that the check stays one small read.
 */
const NETWORK_FINGERPRINT_LIMIT = 5;

export function delay(
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * What the tab's network log looks like right now, as one comparable string.
 *
 * Deliberately a fingerprint rather than a timestamp comparison. Entries are
 * stamped by the machine running the desktop app, and this code runs in the
 * server process — which on a remote install is a different machine with a
 * different clock. Two samples taken here, an interval apart measured here, say
 * "nothing finished in between" without either clock having to agree with the
 * other.
 */
async function networkFingerprint(
  patcher: PatcherPluginApi,
  tabId: string | undefined,
  options: PluginBrowserCallOptions,
): Promise<string> {
  const log = await patcher.browser.page.network(
    { tabId, limit: NETWORK_FINGERPRINT_LIMIT },
    options,
  );
  return `${log.droppedCount}|${log.entries
    .map((entry) => `${entry.timestamp}:${entry.method}:${entry.url}`)
    .join("|")}`;
}

interface QuietArgs {
  patcher: PatcherPluginApi;
  tabId: string | undefined;
  budgetMs: number;
  idleMs: number;
  pollIntervalMs: number;
  options: PluginBrowserCallOptions;
}

/**
 * Wait until the tab has finished no request for `idleMs`, or until the budget
 * runs out.
 *
 * This is what a page load event cannot tell you. On anything built as a
 * single-page app the document is "loaded" before its content is fetched, so a
 * read taken the moment a navigation settles returns the frame around the page
 * — and reports it as the page, which is the expensive kind of wrong: the caller
 * concludes there is nothing there.
 *
 * Never throws. A tab with no live page, a browser that went away, a missing
 * permission — none of those should turn a command that already did its job into
 * a failure, so an unreadable log answers "not quiet" and the caller says so.
 */
export async function waitForQuiet(
  args: QuietArgs,
): Promise<{ quiet: boolean; waitedMs: number; unavailable: boolean }> {
  const { patcher, tabId, budgetMs, idleMs, pollIntervalMs, options } = args;
  const startedAt = Date.now();
  let fingerprint: string;
  try {
    fingerprint = await networkFingerprint(patcher, tabId, options);
  } catch {
    return { quiet: false, waitedMs: 0, unavailable: true };
  }
  let quietSince = Date.now();
  for (;;) {
    const now = Date.now();
    if (now - quietSince >= idleMs) {
      return { quiet: true, waitedMs: now - startedAt, unavailable: false };
    }
    if (now - startedAt >= budgetMs || options.signal?.aborted === true) {
      return { quiet: false, waitedMs: now - startedAt, unavailable: false };
    }
    await delay(
      Math.min(pollIntervalMs, Math.max(1, budgetMs - (now - startedAt))),
      options.signal,
    );
    let next: string;
    try {
      next = await networkFingerprint(patcher, tabId, options);
    } catch {
      return {
        quiet: false,
        waitedMs: Date.now() - startedAt,
        unavailable: true,
      };
    }
    if (next !== fingerprint) {
      fingerprint = next;
      quietSince = Date.now();
    }
  }
}
