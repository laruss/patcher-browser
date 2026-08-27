import {
  appApiKeyHeaders,
  PATCHER_APP_KEY_HEADER,
} from "@patcher/config/app-key";
import { resolveAppApiKey } from "@patcher/config/app-key-file";
import { PATCHER_THREAD_KEY_ENV } from "@patcher/config/thread-api-key";
import {
  createNodePatcherSdk,
  type PatcherSdk,
  type PatcherSdkContext,
} from "@patcher/sdk/node";
import {
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import { resolveContextThreadId } from "./context-env.js";

/**
 * Every CLI call declares the thread it runs inside, when it runs inside one.
 * The header and the reason for it are defined with the rest of the HTTP
 * contract, in @patcher/server-contract.
 */

/**
 * The key that says this is a client the install knows.
 *
 * Resolved once per process: it comes from `PATCHER_APP_KEY` or from a file in
 * the data dir, and neither changes under a running command. Undefined when
 * there is none to find — the request then gets a 401 that says so, which is a
 * better failure than one thrown from inside a `fetch` wrapper.
 */
let appApiKey: string | undefined | null = null;
function cachedAppApiKey(): string | undefined {
  if (appApiKey === null) appApiKey = resolveAppApiKey();
  return appApiKey;
}

/**
 * The key that says this is a specific thread's agent, mid-turn.
 *
 * Present only in the environment Patcher gives a turn's processes, and it
 * takes the place of the app key rather than joining it — a turn is not handed
 * the app key any more, and a CLI inside one must not go looking for it on
 * disk either: reading the file back would undo the whole point of handing over
 * a narrower credential. See `thread-api-key.ts` in @patcher/config.
 */
function cachedThreadApiKey(): string | undefined {
  const value = process.env[PATCHER_THREAD_KEY_ENV]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

/**
 * The app key for the two sockets, or nothing when this CLI is an agent's.
 *
 * `/ws` and `/ws/terminals/:id` both take the app key, and an agent is not the
 * app — so inside a turn the key is not presented, and not even resolved:
 * reading the file to hand it to a socket would be the same escape the HTTP
 * side just stopped handing over. The realtime socket then does not connect,
 * and a terminal attach is refused, which is the answer `/api/v1/terminals`
 * gives an agent too.
 */
function cliSocketAppKey(): string | undefined {
  return cachedThreadApiKey() === undefined ? cachedAppApiKey() : undefined;
}

/**
 * The same key as headers, for the one CLI socket that is not the SDK's: the
 * terminal attach in commands/terminal.ts opens `/ws/terminals/:id` itself, and
 * that route takes the same identity `/api/v1/terminals` does.
 */
export function cliAppKeyHeaders(): Record<string, string> {
  return appApiKeyHeaders(cliSocketAppKey());
}

function declaredThreadId(): string | undefined {
  try {
    return resolveContextThreadId();
  } catch {
    // A malformed PATCHER_THREAD_ID is a bad reason to fail every CLI call.
    // The commands that actually need the id report it themselves.
    return undefined;
  }
}

export interface CreateCliPatcherSdkOptions {
  context?: PatcherSdkContext;
}

export function cliFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const threadId = declaredThreadId();
  const threadKey = cachedThreadApiKey();
  const key = threadKey === undefined ? cachedAppApiKey() : undefined;
  if (threadId === undefined && threadKey === undefined && key === undefined) {
    return fetch(input, init);
  }
  // Seeded from the `Request` when the caller built one and named no init
  // headers: an `init.headers` replaces a `Request`'s header list rather than
  // merging into it, so building from `init` alone would drop the caller's.
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  // An explicit header wins: a caller that set it meant it.
  if (threadId !== undefined && !headers.has(PATCHER_THREAD_ID_HEADER)) {
    headers.set(PATCHER_THREAD_ID_HEADER, threadId);
  }
  if (threadKey !== undefined && !headers.has(PATCHER_THREAD_KEY_HEADER)) {
    headers.set(PATCHER_THREAD_KEY_HEADER, threadKey);
  }
  if (key !== undefined && !headers.has(PATCHER_APP_KEY_HEADER)) {
    headers.set(PATCHER_APP_KEY_HEADER, key);
  }
  return fetch(input, { ...init, headers });
}

export function createCliPatcherSdk(
  baseUrl: string,
  options: CreateCliPatcherSdkOptions = {},
): PatcherSdk {
  const key = cliSocketAppKey();
  return createNodePatcherSdk({
    // `cliFetch` already signs the HTTP side; this is what reaches the
    // realtime socket, which is not under /api/v1 and is gated separately.
    ...(key === undefined ? {} : { appKey: key }),
    baseUrl,
    context: options.context,
    fetch: cliFetch,
  });
}
