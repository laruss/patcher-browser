/**
 * The server's half of the plugin→host direction.
 *
 * `plugin-child-runtime.ts` builds `patcher` in the plugin's process with every
 * host-facing capability pointed at the channel. This is the other end of
 * those calls: it receives a `PluginHostCallPath` and performs it against the
 * server's real dependencies.
 *
 * The thing that keeps the two ends honest is that **this takes the same
 * options object `createPluginApi` does**. The loader constructs those
 * capabilities once — `publishSignal`, `requestBrowserCommand`, `kvStore`, and
 * the rest — and hands the same object either to `createPluginApi`
 * (in-process) or to this (out-of-process). There is no second place where a
 * capability could be wired to something slightly different, which is the
 * failure this repo keeps rediscovering.
 */

import type { JsonValue } from "@patcher/domain";
import type {
  PluginNotifyHandler,
  PluginRequestHandler,
} from "./plugin-channel.js";
import type { createPluginApi } from "./plugin-api.js";
import type { PluginHostCallPath } from "./plugin-host-calls.js";

export type PluginHostCapabilities = Parameters<typeof createPluginApi>[0];

export interface PluginHostCallServer {
  onRequest: PluginRequestHandler;
  onNotify: PluginNotifyHandler;
}

/**
 * Paths a plugin process answers itself, so the host receiving one means the
 * two sides disagree about who owns it — worth saying loudly rather than
 * falling through to "unknown".
 */
export const ANSWERED_IN_THE_PLUGIN_PROCESS = new Set<PluginHostCallPath>([
  "pluginId",
  "sdk",
  "server.loopbackBaseUrl",
  "settings.define",
  "settings.<handle>.onChange",
  "storage.database",
  "storage.migrate",
  "browser.getStatus",
  "http.route",
  "rpc.register",
  "background.service",
  "background.schedule",
  "cli.register",
  "agents.configure",
  "agents.contributeInstructions",
  "ui.registerMentionProvider",
  "ui.registerKeybinding",
  "browser.registerOmniboxProvider",
  "browser.registerDownloadHandler",
  "browser.registerHistoryFilter",
  "browser.registerContextMenuItem",
  "browser.registerTabAction",
  "browser.registerSearchEngine",
  "browser.registerPageStyle",
  "browser.registerPageScript",
  "browser.registerSiteInfoProvider",
  "browser.registerToolbarItem",
  "browser.registerNewTabWidget",
  "ui.registerCommand",
  "browser.registerFindAction",
  "browser.registerAuthProvider",
  "browser.registerPdfTextProvider",
  "browser.registerExternalLinkHandler",
  "events.on",
  "onDispose",
]);

/** Paths that are one-way; a request for one is answered with null. */
export const ONE_WAY = new Set<PluginHostCallPath>([
  "log.debug",
  "log.info",
  "log.warn",
  "log.error",
  "realtime.publish",
  "status.needsConfiguration",
  "agents.registerTool",
]);

export function createPluginHostCallServer(
  capabilities: PluginHostCapabilities,
): PluginHostCallServer {
  const body = (payload: JsonValue): Record<string, JsonValue> =>
    (typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload
      : {}) as Record<string, JsonValue>;

  // Standalone consts rather than object methods, because the channel calls
  // these detached: `handler({...})`. A `this.onNotify` inside onRequest would
  // be a TypeError the first time a plugin sent a notification as a request.
  const onNotify: PluginNotifyHandler = ({ method, payload }) => {
    const path = method as PluginHostCallPath;
    const args = body(payload);
    switch (path) {
      case "log.debug":
        capabilities.logger.debug(String(payload));
        return;
      case "log.info":
        capabilities.logger.info(String(payload));
        return;
      case "log.warn":
        capabilities.logger.warn(String(payload));
        return;
      case "log.error":
        capabilities.logger.error(String(payload));
        return;
      case "realtime.publish":
        capabilities.publishSignal(String(args.channel), args.payload);
        return;
      case "status.needsConfiguration":
        capabilities.reportNeedsConfiguration(String(payload));
        return;
      case "agents.registerTool":
        // How the plugin process reports a tool registration the host must
        // reject. The decision is the host's, because it is the only side that
        // sees every plugin — see `synchronousHostState` on this path.
        capabilities.reportAgentToolProblem(String(args.problem));
        return;
      default:
        // An unknown notification is the far side being newer, which is not
        // worth failing anything over — but it is worth saying, because the
        // alternative is a plugin whose calls quietly go nowhere.
        capabilities.logger.warn(
          `plugin ${capabilities.pluginId} sent an unknown notification ` +
            `"${String(path)}"`,
        );
    }
  };

  const onRequest: PluginRequestHandler = async ({
    method,
    payload,
    signal,
  }) => {
    const path = method as PluginHostCallPath;
    const args = body(payload);
    if (ONE_WAY.has(path)) {
      // A plugin that waits for an ack it was never promised still gets one;
      // that is cheaper than a special case and impossible to get wrong.
      onNotify({ method, payload });
      return null;
    }
    switch (path) {
      case "storage.kv.get":
        return (await capabilities.kvStore.get(String(args.key))) ?? null;
      case "storage.kv.set":
        await capabilities.kvStore.set(String(args.key), String(args.json));
        return null;
      case "storage.kv.delete":
        await capabilities.kvStore.delete(String(args.key));
        return null;
      case "storage.kv.list":
        return await capabilities.kvStore.list(
          typeof args.prefix === "string" ? args.prefix : undefined,
        );
      case "settings.<handle>.get":
        // The descriptors travel with the call. The plugin's process owns them
        // — its factory declared them — and the host resolves values for
        // whichever set it is handed, exactly as the in-process handle closes
        // over its own.
        return (await capabilities.readSettingsValues(
          args.descriptors as never,
        )) as JsonValue;
      case "ui.requestInput":
        return (await capabilities.requestInteraction({
          threadId: String(args.threadId),
          rendererId: String(args.rendererId),
          title: String(args.title),
          payload: args.payload as JsonValue,
          timeoutMs: Number(args.timeoutMs),
          signal,
        })) as unknown as JsonValue;
      case "browser.<command>":
        return (await capabilities.requestBrowserCommand({
          command: args.command as never,
          ...(typeof args.timeoutMs === "number"
            ? { timeoutMs: args.timeoutMs }
            : {}),
          signal,
        })) as unknown as JsonValue;
      default:
        if (ANSWERED_IN_THE_PLUGIN_PROCESS.has(path)) {
          throw new Error(
            `"${path}" is answered inside the plugin's own process; the host ` +
              `received it, which means the two sides disagree about it`,
          );
        }
        throw new Error(`unknown plugin host call "${String(path)}"`);
    }
  };

  return { onRequest, onNotify };
}
