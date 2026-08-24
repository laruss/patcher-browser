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
  if (threadId === undefined) {
    return fetch(input, init);
  }
  const headers = new Headers(init?.headers);
  // An explicit header wins: a caller that set it meant it.
  if (!headers.has(PATCHER_THREAD_ID_HEADER)) {
    headers.set(PATCHER_THREAD_ID_HEADER, threadId);
  }
  return fetch(input, { ...init, headers });
}

export function createCliPatcherSdk(
  baseUrl: string,
  options: CreateCliPatcherSdkOptions = {},
): PatcherSdk {
  return createNodePatcherSdk({
    baseUrl,
    context: options.context,
    fetch: cliFetch,
  });
}
