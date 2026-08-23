import { createPatcherSdk, type PatcherSdk } from "./core.js";
import { createHttpTransport } from "./transport-http.js";
import type {
  PatcherRealtimeSocketFactory,
  PatcherSdkContext,
  PatcherSdkTransport,
} from "./transport.js";

export interface CreateBrowserTransportArgs {
  baseUrl?: string;
  fetch?: typeof fetch;
  realtimeUrl?: string;
  websocket?: PatcherRealtimeSocketFactory;
}

export interface CreateBrowserPatcherSdkArgs extends CreateBrowserTransportArgs {
  context?: PatcherSdkContext;
}

export function createBrowserTransport(
  args: CreateBrowserTransportArgs = {},
): PatcherSdkTransport {
  return createHttpTransport({
    baseUrl: args.baseUrl,
    fetch: args.fetch,
    realtimeUrl: args.realtimeUrl,
    runtime: "browser",
    websocket: args.websocket,
  });
}

export function createBrowserPatcherSdk(
  args: CreateBrowserPatcherSdkArgs = {},
): PatcherSdk {
  return createPatcherSdk({
    context: args.context,
    transport: createBrowserTransport(args),
  });
}

export const patcher = createBrowserPatcherSdk();

export { PatcherHttpError, PatcherRequestTimeoutError } from "./response.js";
export type { PatcherHttpErrorArgs } from "./response.js";
export { createPatcherSdk, createHttpTransport };
export type { PatcherSdk, PatcherSdkContext, PatcherSdkTransport };
export type * from "./areas/skills.js";
export type * from "./public-types.js";
