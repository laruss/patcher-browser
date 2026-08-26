import { loadCliConfig, type CliConfig } from "@patcher/config/cli";
import {
  createHostDaemonLocalClient,
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
} from "@patcher/host-daemon-contract";
import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import { createPatcherSdk, type PatcherSdk } from "./core.js";
import { createNodeWebsocketFactory } from "./node-websocket.js";
import {
  createRequestTimeoutFetch,
  DEFAULT_PATCHER_REQUEST_TIMEOUT_MS,
  type FetchImplementation,
} from "./response.js";
import { createHttpTransport } from "./transport-http.js";
import type {
  PatcherRealtimeSocketFactory,
  PatcherSdkContext,
  PatcherSdkTransport,
} from "./transport.js";

export interface CreateNodeTransportArgs {
  /**
   * Identifies this client to `/api/v1` and `/ws`.
   *
   * The API refuses a request that is neither a plugin nor a client holding
   * this key; see the header's own note in @patcher/server-contract. Attached
   * to both the HTTP requests and the realtime socket, because `/ws` is not
   * under `/api/v1` and is gated separately.
   *
   * Plugins do not set this: they identify themselves with their own header
   * pair and supply their own `fetch` and `websocket`, which this leaves
   * alone.
   */
  appKey?: string;
  baseUrl?: string;
  cliConfig?: CliConfig;
  fetch?: FetchImplementation;
  realtimeUrl?: string;
  timeoutMs?: number;
  websocket?: PatcherRealtimeSocketFactory;
}

export interface CreateNodePatcherSdkArgs extends CreateNodeTransportArgs {
  context?: PatcherSdkContext;
}

export interface FetchLocalHostIdArgs {
  cliConfig?: CliConfig;
  hostDaemonUrl?: string;
}

function resolveCliConfig(cliConfig?: CliConfig): CliConfig {
  return cliConfig ?? loadCliConfig();
}

function resolveHostDaemonUrl(cliConfig?: CliConfig): string {
  const config = resolveCliConfig(cliConfig);
  return `http://${DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST}:${config.PATCHER_HOST_DAEMON_PORT}`;
}

/**
 * Sign every request as this client, unless the caller already said who it is.
 *
 * Seeded from the `Request` when the caller built one and named no init
 * headers: an `init.headers` replaces a `Request`'s header list rather than
 * merging into it, so building from `init` alone would drop the caller's.
 */
function withAppKey(
  inner: FetchImplementation,
  appKey: string,
): FetchImplementation {
  return (input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (headers.has(PATCHER_APP_KEY_HEADER)) return inner(input, init);
    headers.set(PATCHER_APP_KEY_HEADER, appKey);
    return inner(input, { ...init, headers });
  };
}

export function createNodeTransport(
  args: CreateNodeTransportArgs = {},
): PatcherSdkTransport {
  const baseFetch =
    args.fetch ??
    createRequestTimeoutFetch({
      timeoutMs: args.timeoutMs ?? DEFAULT_PATCHER_REQUEST_TIMEOUT_MS,
    });
  return createHttpTransport({
    // Only fall back to CLI config when no base URL is given, so explicitly
    // configured SDKs work in environments without PATCHER_SERVER_URL.
    baseUrl:
      args.baseUrl ?? resolveCliConfig(args.cliConfig).PATCHER_SERVER_URL,
    fetch:
      args.appKey === undefined
        ? baseFetch
        : withAppKey(baseFetch, args.appKey),
    realtimeUrl: args.realtimeUrl,
    runtime: "node",
    websocket:
      args.websocket ??
      createNodeWebsocketFactory(
        args.appKey === undefined
          ? undefined
          : { headers: { [PATCHER_APP_KEY_HEADER]: args.appKey } },
      ),
  });
}

export function createNodePatcherSdk(
  args: CreateNodePatcherSdkArgs = {},
): PatcherSdk {
  return createPatcherSdk({
    context: args.context,
    transport: createNodeTransport(args),
  });
}

export async function fetchLocalHostId(
  args: FetchLocalHostIdArgs = {},
): Promise<string | null> {
  try {
    const client = createHostDaemonLocalClient(
      args.hostDaemonUrl ?? resolveHostDaemonUrl(args.cliConfig),
    );
    const response = await client.status.$get();
    if (!response.ok) {
      return null;
    }
    const body = await response.json();
    return body.hostId;
  } catch {
    return null;
  }
}

export {
  createPatcherSdk,
  createHttpTransport,
  createNodeWebsocketFactory,
  createRequestTimeoutFetch,
  DEFAULT_PATCHER_REQUEST_TIMEOUT_MS,
};
export { PatcherHttpError, PatcherRequestTimeoutError } from "./response.js";
export { createGuideArea } from "./areas/guide.js";
export {
  DEFAULT_THREAD_WAIT_POLL_INTERVAL_MS,
  DEFAULT_THREAD_WAIT_TIMEOUT_MS,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
} from "./areas/threads.js";
export type {
  PatcherSdk,
  PatcherSdkContext,
  PatcherSdkTransport,
  FetchImplementation,
};
export type * from "./areas/skills.js";
export type {
  PatcherRealtimeSocket,
  PatcherRealtimeSocketFactory,
  PatcherRealtimeSocketMessageEvent,
} from "./transport.js";
export type { PatcherHttpErrorArgs } from "./response.js";
export type * from "./public-types.js";
