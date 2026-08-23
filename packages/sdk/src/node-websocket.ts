import { WebSocket as NodeWsWebSocket, type RawData } from "ws";
import { wrapStandardWebsocket } from "./realtime-client.js";
import type {
  PatcherRealtimeSocket,
  PatcherRealtimeSocketFactory,
} from "./transport.js";

function decodeWsMessageData(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (Buffer.isBuffer(data)) {
    return data.toString("utf8");
  }
  // Remaining case is an ArrayBuffer; go through Uint8Array so every
  // @types/node Buffer.from overload set accepts it.
  return Buffer.from(new Uint8Array(data)).toString("utf8");
}

/**
 * Adapts a `ws`-package WebSocket to the runtime-agnostic socket shape the
 * realtime client consumes.
 */
export function wrapNodeWsWebsocket(
  url: string,
  options?: { headers?: Readonly<Record<string, string>> },
): PatcherRealtimeSocket {
  const socket = new NodeWsWebSocket(url, options);
  const adapter: PatcherRealtimeSocket = {
    close: () => socket.close(),
    onclose: null,
    onerror: null,
    onmessage: null,
    onopen: null,
    get readyState() {
      return socket.readyState;
    },
    send: (data) => socket.send(data),
  };
  socket.on("open", () => adapter.onopen?.());
  socket.on("message", (data) =>
    adapter.onmessage?.({ data: decodeWsMessageData(data) }),
  );
  socket.on("close", () => adapter.onclose?.());
  socket.on("error", () => adapter.onerror?.());
  return adapter;
}

/**
 * Node 22+ ships a global WebSocket; older supported Node versions (20.x)
 * fall back to the `ws` package so patcher.subscribe works out of the box everywhere.
 *
 * `headers` forces the `ws` path whatever the runtime: the global WebSocket
 * has no way to set request headers, and a socket that has to say who it is
 * cannot fall back to one that cannot.
 */
export function createNodeWebsocketFactory(options?: {
  headers?: Readonly<Record<string, string>>;
}): PatcherRealtimeSocketFactory {
  return (url) => {
    if (options?.headers !== undefined) {
      return wrapNodeWsWebsocket(url, { headers: options.headers });
    }
    if (typeof WebSocket !== "undefined") {
      return wrapStandardWebsocket(new WebSocket(url));
    }
    return wrapNodeWsWebsocket(url);
  };
}
