import { randomUUID } from "node:crypto";
import {
  browserCommandSchema,
  type BrowserCommand,
  type BrowserCommandErrorCode,
  type BrowserCommandValue,
} from "@patcher/domain";
import type {
  BrowserHostSnapshot,
  NotificationHub,
} from "../../ws/hub.js";

/**
 * Server-side half of agent browser control.
 *
 * The browser lives in the app client, not here: tabs are renderer state and
 * pages are Electron `WebContentsView`s. So a browser tool's handler — which
 * runs in this process — has to ask the connected app to act and wait for its
 * answer. This wraps that round trip so callers deal in commands and values
 * rather than in request ids, sockets and timeouts.
 */

export const BROWSER_COMMAND_DEFAULT_TIMEOUT_MS = 10_000;
export const BROWSER_COMMAND_MAX_TIMEOUT_MS = 60_000;

/**
 * A command the browser refused. Carries the machine-readable code so a caller
 * can tell "activate the tab first" from "there is no browser at all".
 *
 * Matched by `name` rather than by `instanceof`, the convention the plugin SDK
 * already relies on (see `NeedsConfigurationError`): no runtime class from this
 * package is shipped to plugins.
 */
export class BrowserCommandError extends Error {
  readonly code: BrowserCommandErrorCode;

  constructor(code: BrowserCommandErrorCode, message: string) {
    super(message);
    this.name = "BrowserCommandError";
    this.code = code;
  }
}

/** The wait was abandoned by its caller — the page itself keeps going. */
export class BrowserCommandAbortedError extends Error {
  constructor() {
    super("The browser command was cancelled");
    this.name = "BrowserCommandAbortedError";
  }
}

export interface BrowserBridgeCallArgs {
  command: BrowserCommand;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface BrowserBridge {
  status(): BrowserHostSnapshot;
  /**
   * Watch for the status changing. Returns the unsubscribe.
   *
   * A caller in this process can read `status()` whenever it likes; one in
   * another process holds a pushed copy and needs to be told.
   */
  onStatusChange(listener: () => void): () => void;
  call(args: BrowserBridgeCallArgs): Promise<BrowserCommandValue>;
}

export interface CreateBrowserBridgeArgs {
  hub: Pick<
    NotificationHub,
    "requestBrowserCommand" | "getBrowserHostSnapshot" | "onBrowserHostsChanged"
  >;
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) {
    return BROWSER_COMMAND_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.floor(timeoutMs), 1), BROWSER_COMMAND_MAX_TIMEOUT_MS);
}

export function createBrowserBridge(
  args: CreateBrowserBridgeArgs,
): BrowserBridge {
  return {
    status() {
      return args.hub.getBrowserHostSnapshot();
    },
    onStatusChange(listener) {
      return args.hub.onBrowserHostsChanged(listener);
    },
    async call({ command, signal, timeoutMs }) {
      if (signal?.aborted === true) {
        throw new BrowserCommandAbortedError();
      }
      // Parse on the way out as well as on the way in: a caller of this service
      // is trusted code, but the command it built may have come from a model.
      const parsed = browserCommandSchema.parse(command);
      const requestId = randomUUID();

      const responsePromise = args.hub.requestBrowserCommand({
        message: { type: "browser-command-request", requestId, command: parsed },
        timeoutMs: clampTimeout(timeoutMs),
      });

      // Abort ends the wait, never the navigation the browser already started.
      // The app's eventual reply then lands as a stale response and is dropped.
      const response = await (signal === undefined
        ? responsePromise
        : Promise.race([
            responsePromise,
            new Promise<never>((_resolve, reject) => {
              const onAbort = () => reject(new BrowserCommandAbortedError());
              signal.addEventListener("abort", onAbort, { once: true });
              void responsePromise.catch(() => undefined).finally(() => {
                signal.removeEventListener("abort", onAbort);
              });
            }),
          ]));

      if (!response.outcome.ok) {
        throw new BrowserCommandError(
          response.outcome.code,
          response.outcome.message,
        );
      }
      return response.outcome.value;
    },
  };
}
