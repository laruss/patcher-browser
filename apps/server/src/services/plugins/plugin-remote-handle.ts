/**
 * Server-side stand-ins for the things a plugin registered in another process.
 *
 * Every registration the plugin makes stays in its own process; what the
 * server holds is a record of the same shape whose function sends over the
 * channel. This file holds the two whose shape is not a plain call — the two
 * that `plugin-callbacks.ts` singled out as unable to cross — and the rest
 * arrive with the richer registration snapshot.
 */

import type { Context } from "hono";
import type { PluginChannel } from "./plugin-channel.js";
import type { PluginCallbackKind } from "./plugin-callbacks.js";
import type { PluginHostCallPath } from "./plugin-host-calls.js";
import {
  rebuildHttpResponse,
  reduceHttpRequest,
  type PluginHttpResponseMessage,
} from "./plugin-http-message.js";
import type { PluginServiceCommand } from "./plugin-service-message.js";
import { alreadyValidatedElsewhere } from "./plugin-rpc-call.js";
import { readBrowserHistoryDecision } from "./plugin-history-filter.js";
import type {
  PatcherPluginApi,
  PluginAgentToolContext,
  PluginAgentToolResult,
  PluginApiHandle,
  PluginBackgroundServiceRecord,
  PluginHttpRouteRecord,
} from "./plugin-api.js";
import type { PluginBrowserToolbarContext } from "@patcher/plugin-sdk";
import type { PluginRegistrationSnapshot } from "./plugin-child-runtime.js";

type HostChannel = PluginChannel<PluginCallbackKind, PluginHostCallPath>;

/**
 * An HTTP route whose handler lives in the plugin's process.
 *
 * The cost `plugin-http-message.ts` warned about lands here and nowhere else:
 * the request body is read and the response body is buffered, so **a plugin's
 * streaming response stops streaming** once its route runs out of process.
 * Nothing in-tree streams one, and builtins — which are the in-tree ones — stay
 * in the server under `plugin-placement.ts`. An *installed* plugin no longer
 * gets that escape: the shipped policy moves it out, so a route that never ends
 * its body (SSE, say) buffers forever here rather than streaming. That is a
 * real difference between the two placements, not a detail; `PATCHER_PLUGIN_PROCESS`
 * is the way back for a deployment that hits it.
 */
export function remoteHttpRoute(args: {
  channel: HostChannel;
  method: string;
  path: string;
  auth: PluginHttpRouteRecord["auth"];
}): PluginHttpRouteRecord {
  const target = `${args.method} ${args.path}`;
  return {
    method: args.method,
    path: args.path,
    auth: args.auth,
    handler: async (context: Context) => {
      // `clone()` because reducing consumes the body and the server's own
      // error path may still want the original request.
      const message = await reduceHttpRequest(context.req.raw.clone());
      const answer = (await args.channel.request({
        method: "http",
        target,
        payload: message as never,
      })) as unknown as PluginHttpResponseMessage;
      return rebuildHttpResponse(answer);
    },
  };
}

/**
 * A background service that runs in the plugin's process.
 *
 * `plugin-service-message.ts` anticipated two streams of messages and a
 * host-side reducer for the state between them. Applying it showed the channel
 * already carries the whole lifecycle as **one cancellable request**: it stays
 * open for as long as `start` runs, the host's cancel message is the abort the
 * plugin sees, resolving means the service returned and rejecting means it
 * threw. That is precisely the resolve/reject pair the host's existing runner
 * decides on, so the restart policy, the backoff, the crash counter and the
 * "still stabilizing" rule all keep working unchanged and unduplicated.
 *
 * What that makes redundant is `reduceServiceEvent`: it is a second expression
 * of a policy `onServiceSettled` already owns, and that file's own note says
 * why two of those is one too many. The command and event *names* remain the
 * useful part of it.
 *
 * `NeedsConfigurationError` needs no special case — errors cross by name, so
 * `isNeedsConfigurationError` recognises it on this side exactly as it does
 * for an in-process service.
 */
export function remoteBackgroundService(args: {
  channel: HostChannel;
  name: string;
}): PluginBackgroundServiceRecord {
  const start: PluginServiceCommand = { kind: "start", name: args.name };
  return {
    name: args.name,
    start: async (signal: AbortSignal) => {
      await args.channel.request({
        method: "backgroundService",
        target: args.name,
        payload: start as never,
        signal,
      });
    },
  };
}

/**
 * Everything a plugin registered in another process, as a `PluginApiHandle`.
 *
 * The point is that the server does not learn there is a boundary: every
 * dispatcher in plugin-service.ts reads `handle.contextMenuItems`,
 * `handle.mentionProviders` and the rest exactly as it does for an in-process
 * plugin, and the functions it finds there happen to send a message.
 */
export function createRemotePluginApiHandle(args: {
  channel: HostChannel;
  pluginId: string;
  snapshot: PluginRegistrationSnapshot;
}): PluginApiHandle {
  const { channel, snapshot } = args;
  const call = (
    method: PluginCallbackKind,
    target: string | undefined,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> =>
    channel.request({
      method,
      ...(target === undefined ? {} : { target }),
      payload: payload as never,
      ...(signal === undefined ? {} : { signal }),
    });

  const notLocal = (what: string): never => {
    throw new Error(
      `${what} is not available for plugin "${args.pluginId}": it runs in its ` +
        `own process, so there is no in-process object to hand back`,
    );
  };

  return {
    // `patcher` lives in the plugin's process. Nothing on the server should reach
    // for it, and a thrown explanation beats a plausible-looking empty object.
    get api(): PatcherPluginApi {
      return notLocal("patcher.api");
    },
    // Dispose hooks, database handles and the settings descriptors all belong
    // to the far side. The host's dispose path sends the `dispose` callback,
    // which is what runs the hooks and closes the databases over there.
    disposeHooks: [],
    databaseHandles: [],
    settings: {
      descriptors: snapshot.settingsDescriptors,
      listeners: snapshot.hasSettingsListeners
        ? [
            (next, prev) => {
              void call("settingsChange", undefined, { next, prev });
            },
          ]
        : [],
    },
    threadEventHandlers: Object.fromEntries(
      snapshot.threadEvents.map((event) => [
        event,
        [
          (payload: unknown) =>
            call("threadEvent", event, payload) as Promise<void>,
        ],
      ]),
    ) as PluginApiHandle["threadEventHandlers"],
    httpRoutes: snapshot.httpRoutes.map((route) =>
      remoteHttpRoute({ channel, ...route }),
    ),
    // The contract's validators stay in the plugin's process and run there,
    // around the handler (plugin-rpc-call.ts). What is left on this side is
    // routing: a method the dispatcher can find and call, whose schemas accept
    // what they are given because the real check already happened.
    rpcHandlers: new Map(
      snapshot.rpcMethods.map((method) => [
        method,
        {
          inputSchema: alreadyValidatedElsewhere,
          outputSchema: alreadyValidatedElsewhere,
          handler: (input: never) => call("rpc", method, input),
        },
      ]),
    ),
    backgroundServices: snapshot.backgroundServices.map((name) =>
      remoteBackgroundService({ channel, name }),
    ),
    schedules: snapshot.schedules.map((schedule) => ({
      name: schedule.name,
      cron: schedule.cron,
      fn: () => call("schedule", schedule.name, null) as Promise<void>,
    })),
    cli: {
      registration:
        snapshot.cli === null
          ? null
          : {
              name: snapshot.cli.name,
              summary: snapshot.cli.summary,
              commands: snapshot.cli.commands,
              run: (argv, ctx) => {
                // The signal is a channel, not a value: it travels as the
                // request's cancellation rather than inside the payload.
                const { signal, ...rest } = ctx as typeof ctx & {
                  signal?: AbortSignal;
                };
                // `cancellable` says whether there was one at all: an absent
                // signal has to stay absent on the far side, because a CLI
                // context can be handed over without one and a plugin can
                // tell the two apart (see plugin-cancellation.ts).
                return call(
                  "cli",
                  snapshot.cli?.name,
                  { argv, ctx: rest, cancellable: signal !== undefined },
                  signal,
                ) as never;
              },
            },
    },
    agentTools: snapshot.agentTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      instructions: tool.instructions,
      experimentalStatusLabels: tool.experimentalStatusLabels,
      // The JSON Schema the model is shown: derived at registration and data
      // ever since, so it crosses as itself.
      inputSchema: tool.inputSchema,
      // The validator did not cross; it runs in the plugin's process, around
      // the handler. Checking again here could only disagree with it.
      parse: (input: unknown) => ({ ok: true as const, value: input }),
      execute: (input: unknown, ctx: PluginAgentToolContext) => {
        const { signal, ...rest } = ctx;
        return call(
          "agentTool",
          tool.name,
          { input, ctx: rest },
          signal,
        ) as Promise<PluginAgentToolResult>;
      },
    })),
    agentConfigurationProvider: snapshot.hasAgentConfiguration
      ? (context) => call("agentConfigure", undefined, context) as never
      : null,
    instructionProvider: snapshot.hasInstructionProvider
      ? (context) => call("agentInstructions", undefined, context) as never
      : null,
    mentionProviders: snapshot.mentionProviders.map((provider) => ({
      id: provider.id,
      label: provider.label,
      triggers: provider.triggers,
      search: (context) => call("mentionSearch", provider.id, context) as never,
      resolve: (itemId) =>
        call("mentionResolve", provider.id, { itemId }) as never,
    })),
    omniboxProviders: snapshot.omniboxProviders.map((provider) => ({
      id: provider.id,
      label: provider.label,
      suggest: (context) =>
        call("browserOmniboxSuggest", provider.id, context) as never,
      run: provider.hasRun
        ? (itemId, context) =>
            call("browserOmniboxRun", provider.id, {
              itemId,
              ctx: context,
            }) as never
        : null,
    })),
    contextMenuItems: snapshot.contextMenuItems.map((item) => ({
      id: item.id,
      title: item.title,
      when: item.when,
      run: (context) =>
        call("browserContextMenu", item.id, context) as Promise<void>,
    })),
    findActions: snapshot.findActions.map((action) => ({
      id: action.id,
      title: action.title,
      run: (context) =>
        call("browserFindAction", action.id, context) as Promise<void>,
    })),
    siteInfoProviders: snapshot.siteInfoProviders.map((provider) => ({
      id: provider.id,
      label: provider.label,
      describe: (context) =>
        call("browserSiteInfo", provider.id, context) as never,
    })),
    tabActions: snapshot.tabActions.map((action) => ({
      id: action.id,
      title: action.title,
      run: (context) =>
        call("browserTabAction", action.id, context) as Promise<void>,
    })),
    toolbarItems: snapshot.toolbarItems.map((item) => ({
      id: item.id,
      title: item.title,
      icon: item.icon,
      // Null rather than a function that would ask the far side for a state it
      // never registered: `hasState` is what the host reads to decide whether to
      // ask at all, and a stub here would make every navigation a round trip.
      state: item.hasState
        ? (context: PluginBrowserToolbarContext) =>
            call("browserToolbarState", item.id, context) as never
        : null,
      run: (context) =>
        call("browserToolbarRun", item.id, context) as Promise<void>,
    })),
    newTabWidgets: snapshot.newTabWidgets.map((widget) => ({
      id: widget.id,
      label: widget.label,
      rows: (context) => call("browserNewTabRows", widget.id, context) as never,
    })),
    commands: snapshot.commands.map((command) => ({
      id: command.id,
      title: command.title,
      shortcut: { ...command.shortcut },
      run: () => call("uiCommand", command.id, {}) as Promise<void>,
    })),
    // Anonymous on both sides, so the index is the name. Rebuilding the same
    // number of them keeps the host's own rules — first answer wins for auth
    // and PDF text, every one runs for downloads — where they already are.
    downloadHandlers: byIndex(
      snapshot.downloadHandlerCount,
      (index, download) => call("browserDownload", String(index), download),
    ) as PluginApiHandle["downloadHandlers"],
    authProviders: byIndex(snapshot.authProviderCount, (index, challenge) =>
      call("browserAuth", String(index), challenge),
    ) as PluginApiHandle["authProviders"],
    pdfTextProviders: byIndex(
      snapshot.pdfTextProviderCount,
      (index, document) => call("browserPdfText", String(index), document),
    ) as PluginApiHandle["pdfTextProviders"],
    externalLinkHandlers: byIndex(
      snapshot.externalLinkHandlerCount,
      (index, link) => call("browserExternalLink", String(index), link),
    ) as PluginApiHandle["externalLinkHandlers"],
    historyFilters: byIndex(snapshot.historyFilterCount, (index, visit) =>
      call("browserHistoryFilter", String(index), visit).then(
        readBrowserHistoryDecision,
      ),
    ) as PluginApiHandle["historyFilters"],
    keybindings: snapshot.keybindings,
    // Data, like the keybindings above: nothing calls back into the plugin, so
    // the remote handle carries the rows rather than proxies.
    searchEngines: snapshot.searchEngines,
    pageStyles: snapshot.pageStyles,
    pageScripts: snapshot.pageScripts,
    activate: () => {},
    invalidate: () => {},
  };
}

function byIndex(
  count: number,
  make: (index: number, argument: unknown) => Promise<unknown>,
): Array<(argument: unknown) => Promise<unknown>> {
  return Array.from(
    { length: count },
    (_, index) => (argument: unknown) => make(index, argument),
  );
}
