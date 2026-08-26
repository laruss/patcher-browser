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
    case "browser-host.register": {
      // The gate one case above says why a subscription is policed here: this
      // socket never passes the request gate, so a message it carries inward
      // is only as safe as what this switch does with it. This is the larger
      // of the two. The browser host answers every browser command the server
      // routes — the agent's tools and every plugin's `patcher.browser` call —
      // so claiming the role reads that stream (urls, `evaluate` sources,
      // cookie values on their way into the session) and decides what the
      // model is told the page said.
      const pluginId = deps.hub.pluginIdForSocket(socket);
      if (pluginId !== null) {
        // No permission grants this and none should: the browser surface is
        // the app's own window, and a plugin reaches it through
        // `patcher.browser`, charged on the host's side of the pipe. A plugin
        // registering here would be answering those calls instead of making
        // them, past a consent prompt that named nothing of the sort.
        deps.logger?.warn(
          `plugin browser-host.register refused: ${pluginId} is not an app window`,
        );
        break;
      }
      const claim = deps.hub.registerBrowserHost(socket, {
        browserHostId: parsed.browserHostId,
      });
      if (!claim.primary) {
        // This window serves nothing until the one driving goes away, and the
        // only other trace of that is `hostCount`. Said out loud so "the agent
        // is driving my other window" is something a log can answer.
        deps.logger?.warn(
          `browser host ${parsed.browserHostId} registered behind ${claim.primaryBrowserHostId}, which is driving`,
        );
      }
      break;
    }
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
