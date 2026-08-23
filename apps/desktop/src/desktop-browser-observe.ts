/**
 * What the shell remembers about a tab so an agent can ask about it later.
 *
 * Screenshots and PDFs are produced on demand and need nothing kept. The console
 * and network logs are the opposite: the events happen whether or not anyone is
 * watching, and by the time a command asks for them they are long gone. So both
 * are recorded from the moment a tab is created, into a fixed-size ring.
 *
 * Recording from tab creation is the whole reason these use Electron's own
 * `console-message` and `webRequest` events rather than the CDP `Runtime`/`Log`/
 * `Network` domains the plan first sketched. A CDP buffer would only start at
 * the first automation command, so the honest answer to "what did this page log"
 * would always be "nothing yet, reload and ask again" — and enabling a domain
 * would attach the debugger, which moves that tab's dialogs off Chromium's
 * native path for a human who only wanted to look.
 *
 * What that costs, stated rather than discovered: `console-message` hands over
 * text Chromium has already flattened, so there are no structured arguments and
 * no stack traces, and `webRequest` sees headers and status but never bodies.
 * Both are what an agent needs to answer "did this page error" and "what did it
 * call"; neither is a DevTools panel.
 */

import {
  PATCHER_DESKTOP_BROWSER_MAX_CONSOLE_TEXT_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH,
  type PatcherDesktopBrowserConsoleEntry,
  type PatcherDesktopBrowserNetworkEntry,
} from "@patcher/desktop-contract";

/**
 * Entries kept per tab, per log. Sized to cover a page load's worth of requests
 * and a normal page's chatter while costing a bounded amount of memory per tab —
 * this is page-controlled content, so an unbounded log is a page-controlled
 * allocation.
 */
export const PATCHER_BROWSER_OBSERVATION_BUFFER_SIZE = 200;

/**
 * A fixed-size ring that counts what it threw away.
 *
 * The count is the point. Without it a caller cannot tell a quiet page from a
 * page whose first hundred messages were evicted before it asked.
 */
export class BrowserObservationLog<TEntry> {
  private readonly entries: TEntry[] = [];
  private dropped = 0;

  constructor(private readonly capacity: number) {}

  record(entry: TEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.capacity) {
      this.entries.shift();
      this.dropped += 1;
    }
  }

  /** The most recent `limit` entries, still in the order they happened. */
  read(limit: number): { entries: TEntry[]; droppedCount: number } {
    const kept = this.entries.slice(Math.max(0, this.entries.length - limit));
    return {
      entries: kept,
      // Everything the caller is not seeing, whether the ring dropped it or the
      // limit did: one number, one meaning.
      droppedCount: this.dropped + (this.entries.length - kept.length),
    };
  }

  clear(): void {
    this.entries.length = 0;
    this.dropped = 0;
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Chromium's four levels; anything else is treated as ordinary output. */
function consoleLevel(raw: unknown): PatcherDesktopBrowserConsoleEntry["level"] {
  return raw === "debug" || raw === "warning" || raw === "error" ? raw : "info";
}

/** The `console-message` details object, as much of it as this needs. */
export interface BrowserConsoleMessageDetails {
  level?: unknown;
  message?: unknown;
  lineNumber?: unknown;
  sourceId?: unknown;
}

export function toBrowserConsoleEntry(
  details: BrowserConsoleMessageDetails,
  now: number,
): PatcherDesktopBrowserConsoleEntry {
  const line = details.lineNumber;
  return {
    level: consoleLevel(details.level),
    text: truncate(
      typeof details.message === "string" ? details.message : "",
      PATCHER_DESKTOP_BROWSER_MAX_CONSOLE_TEXT_LENGTH,
    ),
    source: truncate(
      typeof details.sourceId === "string" ? details.sourceId : "",
      PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH,
    ),
    line:
      typeof line === "number" && Number.isFinite(line) && line > 0
        ? Math.floor(line)
        : 0,
    timestamp: now,
  };
}

/** The `webRequest` details object, as much of it as this needs. */
export interface BrowserNetworkRequestDetails {
  url?: unknown;
  method?: unknown;
  resourceType?: unknown;
  statusCode?: unknown;
  fromCache?: unknown;
  error?: unknown;
  timestamp?: unknown;
}

export function toBrowserNetworkEntry(
  details: BrowserNetworkRequestDetails,
  now: number,
): PatcherDesktopBrowserNetworkEntry {
  const status = details.statusCode;
  const timestamp = details.timestamp;
  // A `webRequest` error string is the raw `net::ERR_*` name. Left as it is:
  // it is the thing worth searching for, and rewording it would only make it
  // harder to look up.
  const error = typeof details.error === "string" ? details.error : "";
  return {
    method: truncate(
      typeof details.method === "string" ? details.method : "",
      16,
    ),
    url: truncate(
      typeof details.url === "string" ? details.url : "",
      PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH,
    ),
    resourceType: truncate(
      typeof details.resourceType === "string" ? details.resourceType : "other",
      32,
    ),
    status:
      typeof status === "number" && Number.isFinite(status) && status > 0
        ? Math.floor(status)
        : null,
    fromCache: details.fromCache === true,
    error:
      error.length === 0
        ? null
        : truncate(error, PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
    timestamp:
      typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0
        ? Math.floor(timestamp)
        : now,
  };
}
