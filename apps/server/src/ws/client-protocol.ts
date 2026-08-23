import {
  clientMessageSchema,
  permissionForRealtimeTarget,
  type PluginPermission,
} from "@patcher/domain";
import { decodeSocketPayload } from "./decode-payload.js";
import type { NotificationHub } from "./hub.js";
import type { WatchInterestCoordinator } from "./watch-interests.js";

interface ClientSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export function onClientSocketOpen(
  hub: NotificationHub,
  socket: ClientSocket,
  pluginId?: string,
): void {
  hub.registerClient(socket, pluginId);
}

export function onClientSocketMessage(
  deps: {
    hub: NotificationHub;
    watchInterests: Pick<
      WatchInterestCoordinator,
      "subscribe" | "unsubscribe" | "releaseSocket"
    >;
    /** Absent in harnesses without a plugin service; no plugin, no gate. */
    plugins?: {
      apiPermissionProblem(
        pluginId: string,
        required: readonly PluginPermission[] | null,
      ): string | null;
    };
    /** Present in the server; absent in the protocol unit tests. */
    logger?: { warn(message: string): void };
  },
  socket: ClientSocket,
  raw: unknown,
): void {
  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeSocketPayload(raw));
  } catch {
    socket.close(1008, "invalid-message");
    return;
  }

  const result = clientMessageSchema.safeParse(decoded);
  if (!result.success) {
    socket.close(1008, "invalid-message");
    return;
  }
  const parsed = result.data;

  switch (parsed.type) {
    case "subscribe": {
      // The websocket is not under `/api/v1`, so the request gate never sees
      // it — and subscriptions are the whole of what it carries inward. A
      // plugin subscribing past its grants would be the one unpoliced route
      // to the very data the permission names.
      const pluginId = deps.hub.pluginIdForSocket(socket);
      // `?? null` is load-bearing: without it an absent plugin service makes
      // the comparison `undefined !== null`, which refuses every subscription
      // on a plugin socket instead of leaving it alone.
      const problem =
        pluginId === null
          ? null
          : (deps.plugins?.apiPermissionProblem(pluginId, [
              permissionForRealtimeTarget(parsed.target.kind),
            ]) ?? null);
      if (problem !== null) {
        // Said out loud rather than dropped: the plugin's client believes it
        // subscribed and will wait for events forever, so a refusal nobody
        // records is a plugin that simply never works with no way to find out
        // why. There is no error frame in this protocol to answer with.
        deps.logger?.warn(
          `plugin subscribe refused (${parsed.target.kind}): ${problem}`,
        );
        // Refused rather than fatal: one subscription a plugin may not have is
        // not a reason to tear down a connection its other feeds are using.
        break;
      }
      deps.hub.subscribe(socket, parsed.target);
      deps.watchInterests.subscribe(socket, parsed.target);
      break;
    }
    case "unsubscribe":
      deps.hub.unsubscribe(socket, parsed.target);
      deps.watchInterests.unsubscribe(socket, parsed.target);
      break;
    case "browser-host.register":
      deps.hub.registerBrowserHost(socket, {
        browserHostId: parsed.browserHostId,
      });
      break;
    case "browser-host.unregister":
      deps.hub.unregisterBrowserHost(socket);
      break;
    case "browser-command.response":
      // A stale response (its request already timed out) or one from a socket
      // that is no longer the addressed host is dropped, not an error: the
      // waiter's own identity check is what enforces that, so correctness never
      // depends on a client behaving.
      deps.hub.recordBrowserCommandResponse({ socket, message: parsed });
      break;
    default: {
      const _exhaustive: never = parsed;
      throw new Error(`Unhandled client message: ${_exhaustive}`);
    }
  }
}

export function onClientSocketClose(
  deps: {
    hub: NotificationHub;
    watchInterests: Pick<WatchInterestCoordinator, "releaseSocket">;
  },
  socket: ClientSocket,
): void {
  deps.watchInterests.releaseSocket(socket);
  deps.hub.unregisterClient(socket);
}
