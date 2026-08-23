// URLs macOS hands this app because the user made Patcher their browser: a link
// clicked in Mail, a Slack message, `open https://…` from a terminal.
//
// They arrive on `open-url`, which fires before `app.whenReady()` when the click
// is what launched Patcher — before there is a window, a renderer or a server to show
// them in. So the shell **queues** them and the renderer **pulls**: main holds
// what arrived, the surface drains it when it mounts, and the push on the
// pending channel is only a nudge for the case where the app was already
// running. One queue drained once is what keeps a cold start from opening the
// same link twice.

/**
 * How many URLs the queue holds before the oldest is dropped.
 *
 * A bound, not a policy: the queue only grows while nothing is there to drain it
 * — a startup that failed, a window that never opened — and dropping the
 * *oldest* keeps the link the user clicked most recently, which is the one they
 * are waiting on.
 */
export const EXTERNAL_URL_QUEUE_LIMIT = 16;

export interface ExternalUrlQueue {
  /** True when the URL was accepted; false for anything that is not `http(s)`. */
  push(rawUrl: string): boolean;
  /** Empties the queue and returns what was in it, oldest first. */
  takeAll(): string[];
}

/**
 * `http(s)` only, normalized by the URL parser.
 *
 * The same rule the "open in the system browser" channel applies, mirrored: there
 * the URL comes from a possibly-hostile page, here from whatever app asked macOS
 * to open it. Neither is this shell's own input, and the browsed view refuses
 * everything else anyway (`isAllowedBrowserUrl`), so a `file:` or custom-scheme
 * URL that reached the queue would only become a tab that shows nothing.
 */
export function normalizeExternalUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return parsed.toString();
}

export function createExternalUrlQueue(): ExternalUrlQueue {
  const urls: string[] = [];

  return {
    push(rawUrl): boolean {
      const url = normalizeExternalUrl(rawUrl);
      if (url === null) {
        return false;
      }
      urls.push(url);
      if (urls.length > EXTERNAL_URL_QUEUE_LIMIT) {
        urls.splice(0, urls.length - EXTERNAL_URL_QUEUE_LIMIT);
      }
      return true;
    },
    takeAll(): string[] {
      return urls.splice(0, urls.length);
    },
  };
}
