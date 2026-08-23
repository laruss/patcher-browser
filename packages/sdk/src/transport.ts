import type { ApiClient } from "@patcher/server-contract";
import type {
  FetchImplementation,
  JsonBodyOf,
} from "./response.js";

export type PatcherSdkRuntime = "node" | "browser";

export interface PatcherSdkTransport {
  api: ApiClient["api"];
  baseUrl: string;
  fetch: FetchImplementation;
  realtimeUrl?: string;
  runtime: PatcherSdkRuntime;
  readJson<TResponse extends Response>(
    response: Promise<TResponse>,
  ): Promise<JsonBodyOf<TResponse>>;
  readVoid<TResponse extends Response>(
    response: Promise<TResponse>,
  ): Promise<void>;
  resolve<TResponse extends Response>(
    response: Promise<TResponse>,
  ): Promise<TResponse>;
  websocket?: PatcherRealtimeSocketFactory;
}

/**
 * Raw socket payload. Treated as opaque until decoded — realtime ignores
 * non-string frames.
 */
export interface PatcherRealtimeSocketMessageEvent {
  data: unknown;
}

/**
 * Minimal runtime-agnostic socket shape consumed by the realtime client.
 * Default factories adapt the environment's WebSocket (browser/Node global,
 * or the `ws` package on older Node) to this interface; custom `websocket`
 * factories can wrap any implementation the same way.
 */
export interface PatcherRealtimeSocket {
  close(): void;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: PatcherRealtimeSocketMessageEvent) => void) | null;
  onopen: (() => void) | null;
  readyState: number;
  send(data: string): void;
}

export type PatcherRealtimeSocketFactory = (url: string) => PatcherRealtimeSocket;

export interface PatcherSdkContext {}

export interface CreateHttpTransportArgs {
  baseUrl?: string;
  fetch?: FetchImplementation;
  realtimeUrl?: string;
  runtime: PatcherSdkRuntime;
  websocket?: PatcherRealtimeSocketFactory;
}
