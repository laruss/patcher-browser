import {
  appApiKeyHeaders,
  PATCHER_APP_KEY_HEADER,
} from "@patcher/config/app-key";
import { resolveAppApiKey } from "@patcher/config/app-key-file";
import {
  createNodePatcherSdk,
  type PatcherSdk,
  type PatcherSdkContext,
} from "@patcher/sdk/node";
import { PATCHER_THREAD_ID_HEADER } from "@patcher/server-contract";
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
 * The same key as headers, for the one CLI socket that is not the SDK's: the
 * terminal attach in commands/terminal.ts opens `/ws/terminals/:id` itself, and
 * that route takes the same identity `/api/v1/terminals` does.
 */
export function cliAppKeyHeaders(): Record<string, string> {
  return appApiKeyHeaders(cachedAppApiKey());
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
  const key = cachedAppApiKey();
  if (threadId === undefined && key === undefined) {
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
  if (key !== undefined && !headers.has(PATCHER_APP_KEY_HEADER)) {
    headers.set(PATCHER_APP_KEY_HEADER, key);
  }
  return fetch(input, { ...init, headers });
}

export function createCliPatcherSdk(
  baseUrl: string,
  options: CreateCliPatcherSdkOptions = {},
): PatcherSdk {
  const key = cachedAppApiKey();
  return createNodePatcherSdk({
    // `cliFetch` already signs the HTTP side; this is what reaches the
    // realtime socket, which is not under /api/v1 and is gated separately.
    ...(key === undefined ? {} : { appKey: key }),
    baseUrl,
    context: options.context,
    fetch: cliFetch,
  });
}
