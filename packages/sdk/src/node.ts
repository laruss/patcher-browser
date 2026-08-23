import { loadCliConfig, type CliConfig } from "@patcher/config/cli";
import {
  createHostDaemonLocalClient,
  DEFAULT_HOST_DAEMON_LOCAL_BIND_HOST,
} from "@patcher/host-daemon-contract";
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

export function createNodeTransport(
  args: CreateNodeTransportArgs = {},
): PatcherSdkTransport {
  return createHttpTransport({
    // Only fall back to CLI config when no base URL is given, so explicitly
    // configured SDKs work in environments without PATCHER_SERVER_URL.
    baseUrl:
      args.baseUrl ?? resolveCliConfig(args.cliConfig).PATCHER_SERVER_URL,
    fetch:
      args.fetch ??
      createRequestTimeoutFetch({
        timeoutMs: args.timeoutMs ?? DEFAULT_PATCHER_REQUEST_TIMEOUT_MS,
      }),
    realtimeUrl: args.realtimeUrl,
    runtime: "node",
    websocket: args.websocket ?? createNodeWebsocketFactory(),
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
