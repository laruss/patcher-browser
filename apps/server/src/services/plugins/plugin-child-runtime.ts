/**
 * A plugin, running in its own process.
 *
 * The thing this file does **not** do is build a second `patcher`. `createPluginApi`
 * already takes every host-facing capability as an injected function — that was
 * always the seam, it just pointed at the server — so the plugin's process
 * builds the *same* object with those functions pointed at the channel. One
 * copy of what `patcher.storage.kv.set` means, of the 256KB limit, of every error
 * string, running on both sides of the boundary.
 *
 * This is deliberate and it is the lesson the repo already paid for twice: the
 * fake plugin host drifted from the real one, and the JS permission gate
 * drifted from the HTTP one. A hand-written plugin-side `patcher` would be the third.
 *
 * Not wired into the loader yet: nothing spawns this. It is exercised over a
 * linked port pair and, in one test, as a real forked process.
 */

import { createRequire } from "node:module";
import { Hono } from "hono";
import type { PluginPermission } from "@patcher/domain";
import type { PatcherSdk } from "@patcher/sdk";
import type {
  AppKeybindingOverrides,
  BrowserSearchEngine,
} from "@patcher/domain";
import type { PluginSettingDescriptors } from "@patcher/plugin-sdk";
import type {
  PatcherPluginApi,
  PluginAgentToolExperimentalStatusLabels,
  PluginApiHandle,
  PluginCliCommandInfo,
  PluginHttpAuthMode,
  PluginMentionTrigger,
} from "./plugin-api.js";
import { createPluginApi } from "./plugin-api.js";
import { normalizeBrowserHistoryDecision } from "./plugin-history-filter.js";
import type { PluginCallbackKind } from "./plugin-callbacks.js";
import {
  createPluginChannel,
  type PluginChannel,
  type PluginPort,
} from "./plugin-channel.js";
import {
  createPluginApiFetch,
  pluginApiHeaders,
} from "./plugin-api-identity.js";
import type { PluginHostCallPath } from "./plugin-host-calls.js";
import {
  isResponseLike,
  rebuildHttpRequest,
  reduceHttpResponse,
  type PluginHttpRequestMessage,
} from "./plugin-http-message.js";
import { runAgentToolCall } from "./plugin-agent-tool-call.js";
import { runRpcCall } from "./plugin-rpc-call.js";
import type { PluginServiceCommand } from "./plugin-service-message.js";

/**
 * Everything the process needs to become a particular plugin, sent as the
 * payload of the host's first request.
 *
 * A message rather than argv or the environment: the API key is in here, and a
 * process's command line and environment are readable by anything running as
 * the same user.
 */
export interface PluginHostConfig {
  pluginId: string;
  permissions: readonly PluginPermission[] | undefined;
  /** What `patcher.sites` declared; see the same field on `createPluginApi`. */
  sites: readonly string[] | undefined;
  /** For `patcher.storage.database()`, which this process opens itself. */
  dataDir: string;
  /**
   * Null when the server is not listening yet. A plugin can load before that,
   * and `patcher.server.loopbackBaseUrl` is bind-gated for exactly that reason — so
   * the gate travels rather than being quietly removed. The host pushes
   * `host.loopbackBaseUrl` once it binds.
   */
  loopbackBaseUrl: string | null;
  /** Identifies this plugin's SDK client to /api/v1; see plugin-api-identity. */
  apiKey: string;
  /** Absolute path of the plugin's resolved server entry. */
  serverEntry: string;
  /**
   * The two synchronous host facts, as they stand at bootstrap.
   *
   * They are pushed as notifications afterwards, but the factory runs *during*
   * bootstrap and reads both — `patcher.agents.registerTool` checks the owners map
   * to refuse a name another plugin already took — so an empty starting value
   * is not a stale copy, it is a wrong answer at the only moment it is asked.
   */
  browserStatus?: { connected: boolean; hostCount: number };
  agentToolOwners?: Record<string, string>;
}

/**
 * What the host learns once the factory has run: every registration, minus the
 * functions.
 *
 * This is the data half of each record on `PluginApiHandle`. The server
 * rebuilds the other half — a function that sends over the channel — in
 * ./plugin-remote-handle.ts, so what it ends up holding has the same shape as
 * an in-process handle and every dispatcher reads it unchanged.
 *
 * Anonymous registrations (download, auth and PDF-text providers) carry only a
 * count, because their index *is* their identity: the host iterates them in
 * order and the order is the plugin's registration order on both sides.
 */
export interface PluginRegistrationSnapshot {
  httpRoutes: { method: string; path: string; auth: PluginHttpAuthMode }[];
  rpcMethods: string[];
  backgroundServices: string[];
  schedules: { name: string; cron: string }[];
  cli: {
    name: string;
    summary: string;
    commands: PluginCliCommandInfo[];
  } | null;
  /**
   * Everything about a tool except its validator: the JSON Schema is what the
   * model is shown and is already data, while `parse` stays where the handler
   * is (see plugin-agent-tool-call.ts).
   */
  agentTools: {
    name: string;
    description: string;
    instructions: string | null;
    inputSchema: unknown;
    experimentalStatusLabels: PluginAgentToolExperimentalStatusLabels | null;
  }[];
  hasAgentConfiguration: boolean;
  hasInstructionProvider: boolean;
  mentionProviders: {
    id: string;
    label: string;
    triggers: PluginMentionTrigger[];
  }[];
  /** `hasRun` because a provider may register suggestions and no action. */
  omniboxProviders: { id: string; label: string; hasRun: boolean }[];
  contextMenuItems: {
    id: string;
    title: string;
    when: { image: boolean; link: boolean; page: boolean; selection: boolean };
  }[];
  findActions: { id: string; title: string }[];
  tabActions: { id: string; title: string }[];
  siteInfoProviders: { id: string; label: string }[];
  /** `hasState` because a control may be the same on every page — one that is
   * asks nothing of this process as the user browses. */
  toolbarItems: {
    id: string;
    title: string;
    icon: string | null;
    hasState: boolean;
  }[];
  newTabWidgets: { id: string; label: string }[];
  commands: {
    id: string;
    title: string;
    shortcut: {
      key: string;
      alt: boolean;
      control: boolean;
      meta: boolean;
      mod: boolean;
      shift: boolean;
    };
  }[];
  downloadHandlerCount: number;
  historyFilterCount: number;
  authProviderCount: number;
  pdfTextProviderCount: number;
  externalLinkHandlerCount: number;
  keybindings: AppKeybindingOverrides;
  searchEngines: BrowserSearchEngine[];
  pageStyles: { id: string; matches: string[]; css: string }[];
  pageScripts: { id: string; matches: string[]; code: string }[];
  /** Only the events the plugin actually subscribed to. */
  threadEvents: string[];
  settingsDescriptors: PluginSettingDescriptors;
  hasSettingsListeners: boolean;
}

/**
 * The one request that is not a `PluginCallbackKind`: it makes the process
 * into a plugin, so it necessarily precedes anything the catalogue describes.
 */
export const BOOTSTRAP_METHOD = "bootstrap";

/** The plugin factory a server entry default-exports. */
export type PluginFactory = (patcher: PatcherPluginApi) => unknown;

export interface PluginChildRuntimeOptions {
  port: PluginPort;
  /**
   * Injected so a test can hand over a factory directly. The default imports
   * the entry the way the in-process loader does.
   */
  loadFactory?: (entry: string) => Promise<PluginFactory>;
  onProtocolError?: (problem: string) => void;
}

export interface PluginChildRuntime {
  readonly channel: PluginChannel<PluginHostCallPath, PluginCallbackKind>;
  /** Null until the host's bootstrap request has been served. */
  readonly handle: PluginApiHandle | null;
}

async function defaultLoadFactory(entry: string): Promise<PluginFactory> {
  const { createJiti } = await import("jiti");
  const { pluginExternalsAlias } = await import("./plugin-externals-alias.js");
  // The same alias the in-process loader uses. Without it the first plugin
  // that imports `@patcher/plugin-sdk` — which is most of them — fails to load, and
  // all the server sees is a process that died on bootstrap.
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    ...(pluginExternalsAlias === undefined
      ? {}
      : { alias: pluginExternalsAlias }),
  });
  const mod = (await jiti.import(entry)) as { default?: unknown };
  if (typeof mod.default !== "function") {
    throw new Error(
      `server entry must default-export a factory (patcher) => void, got ${typeof mod.default}`,
    );
  }
  return mod.default as PluginFactory;
}

export function createPluginChildRuntime(
  options: PluginChildRuntimeOptions,
): PluginChildRuntime {
  let handle: PluginApiHandle | null = null;
  /**
   * Set once the host's `dispose` has run. In-process, disposal drops the
   * whole loaded plugin so nothing can dispatch into it again; here the
   * registered closures are still perfectly callable objects in this heap, so
   * refusing is explicit. Without this a reloaded plugin's predecessor would
   * keep answering from the same process.
   */
  let disposed = false;

  /**
   * Host facts this process cannot ask for, because the members that need them
   * are synchronous. They arrive as notifications and are cached; the host
   * stays the authority, and a stale copy here can only produce a worse error
   * message, never a wrong decision.
   */
  let browserStatus = { connected: false, hostCount: 0 };
  let agentToolOwners: Record<string, string> = {};
  let loopbackBaseUrl: string | null = null;
  /** Dropped when the loopback URL changes, mirroring `pluginSdks.clear()`. */
  let sdk: PatcherSdk | undefined;

  const channel = createPluginChannel<PluginHostCallPath, PluginCallbackKind>({
    port: options.port,
    name: "plugin-host",
    ...(options.onProtocolError
      ? { onProtocolError: options.onProtocolError }
      : {}),
    onNotify: ({ method, payload }) => {
      // The two pushed facts above. Anything else is a host that knows
      // something this version does not, which is not an error.
      if (method === "host.browserStatus") {
        browserStatus = payload as unknown as typeof browserStatus;
      } else if (method === "host.agentToolOwners") {
        agentToolOwners = payload as Record<string, string>;
      } else if (method === "host.loopbackBaseUrl") {
        loopbackBaseUrl = typeof payload === "string" ? payload : null;
        // A client built before the bind pointed nowhere useful, exactly as in
        // the server's own bindSdk.
        sdk = undefined;
      }
    },
    onRequest: async ({ method, target, payload, signal }) => {
      if (method === BOOTSTRAP_METHOD) {
        return (await bootstrap(
          payload as unknown as PluginHostConfig,
        )) as never;
      }
      // The plugin's own return value. `parseMessage` on the far side is what
      // decides whether it survived, which is the only honest place for that
      // check: this process cannot vouch for what a plugin returns.
      return (await dispatchCallback(
        method as PluginCallbackKind,
        target,
        payload,
        signal,
      )) as never;
    },
  });

  const call = (
    method: PluginHostCallPath,
    payload: unknown,
    signal?: AbortSignal,
  ) =>
    channel.request({
      method,
      payload: payload as never,
      ...(signal === undefined ? {} : { signal }),
    });
  const send = (method: PluginHostCallPath, payload: unknown): void => {
    channel.notify({ method, payload: payload as never });
  };

  async function bootstrap(
    config: PluginHostConfig,
  ): Promise<PluginRegistrationSnapshot> {
    if (handle !== null) {
      throw new Error("this plugin process has already been bootstrapped");
    }
    loopbackBaseUrl = config.loopbackBaseUrl;
    if (config.browserStatus !== undefined)
      browserStatus = config.browserStatus;
    if (config.agentToolOwners !== undefined) {
      agentToolOwners = config.agentToolOwners;
    }
    const built = createPluginApi({
      pluginId: config.pluginId,
      permissions: config.permissions,
      sites: config.sites,
      dataDir: config.dataDir,
      logger: {
        debug: (message: string) => send("log.debug", message),
        info: (message: string) => send("log.info", message),
        warn: (message: string) => send("log.warn", message),
        error: (message: string) => send("log.error", message),
      },
      kvStore: {
        get: (key) =>
          call("storage.kv.get", { key }) as Promise<string | undefined>,
        set: async (key, json) => {
          await call("storage.kv.set", { key, json });
        },
        delete: async (key) => {
          await call("storage.kv.delete", { key });
        },
        list: (prefix) =>
          call("storage.kv.list", { prefix: prefix ?? null }) as Promise<
            string[]
          >,
      },
      readSettingsValues: (descriptors) =>
        call("settings.<handle>.get", { descriptors }) as Promise<
          Record<string, unknown>
        >,
      getSdk: () => {
        // Bind-gated like the server's: no URL yet means no client, and
        // plugin-api.ts turns that into the same "not until the server is
        // listening" error a plugin sees in-process.
        if (loopbackBaseUrl === null) return undefined;
        // Built once, lazily: the SDK opens a websocket, and a plugin that
        // never touches patcher.sdk should not have one.
        const patcherSdk = loadPatcherSdk();
        sdk ??= patcherSdk.createNodePatcherSdk({
          baseUrl: loopbackBaseUrl,
          // The same two identity wrappers the in-process client gets, for the
          // same two reasons: the timeout fetch must not be dropped, and /ws
          // is outside /api/v1 so the socket has to identify itself too.
          fetch: createPluginApiFetch({
            pluginId: config.pluginId,
            key: config.apiKey,
            fetch: patcherSdk.createRequestTimeoutFetch({
              timeoutMs: patcherSdk.DEFAULT_PATCHER_REQUEST_TIMEOUT_MS,
            }),
          }),
          websocket: patcherSdk.createNodeWebsocketFactory({
            headers: pluginApiHeaders({
              pluginId: config.pluginId,
              key: config.apiKey,
            }),
          }),
        });
        return sdk;
      },
      getLoopbackBaseUrl: () => loopbackBaseUrl ?? undefined,
      publishSignal: (signalChannel, signalPayload) => {
        send("realtime.publish", {
          channel: signalChannel,
          payload: signalPayload,
        });
      },
      reportNeedsConfiguration: (message) => {
        send("status.needsConfiguration", message);
      },
      reportAgentToolProblem: (message) => {
        send("agents.registerTool", { problem: message });
      },
      // Synchronous, so it reads the copy the host pushed: at bootstrap, and
      // again whenever a plugin commits or is disposed. The host stays the
      // authority because it is the only side that sees every plugin — no
      // process can answer this about the others — and the copy is only ever
      // used to produce the same registration error a plugin gets in-process.
      isAgentToolNameTaken: (name) => {
        const owner = agentToolOwners[name];
        return owner === undefined || owner === config.pluginId
          ? undefined
          : owner;
      },
      getBrowserHostStatus: () => browserStatus,
      requestInteraction: (args) =>
        call(
          "ui.requestInput",
          {
            threadId: args.threadId,
            rendererId: args.rendererId,
            title: args.title,
            payload: args.payload,
            timeoutMs: args.timeoutMs,
          },
          args.signal,
        ) as never,
      requestBrowserCommand: (args) =>
        call(
          "browser.<command>",
          { command: args.command, timeoutMs: args.timeoutMs ?? null },
          args.signal,
        ) as never,
    });
    handle = built;

    const loadFactory = options.loadFactory ?? defaultLoadFactory;
    try {
      const factory = await loadFactory(config.serverEntry);
      await factory(built.api);
    } catch (error) {
      // The same rollback the in-process loader performs when a factory
      // throws. It matters more here: this process is shared, so a database
      // the half-loaded plugin opened stays open in it for the life of the
      // host, and the failure is reported as the load error either way.
      await releaseResources(built, { runDisposeHooks: false });
      handle = null;
      throw error;
    }
    built.activate();
    return snapshot(built);
  }

  /**
   * Everything the plugin holds that this process would otherwise keep.
   *
   * Best effort by design: it runs on paths where something has already gone
   * wrong (a factory that threw, a channel the host abandoned), and one bad
   * hook must not stop the rest from being released.
   *
   * `runDisposeHooks` is false for a factory that threw, matching the
   * in-process rollback exactly: a plugin that never finished loading never
   * had its hooks called there either.
   */
  async function releaseResources(
    live: PluginApiHandle,
    args: { runDisposeHooks: boolean },
  ): Promise<void> {
    if (args.runDisposeHooks) {
      for (const hook of [...live.disposeHooks].reverse()) {
        try {
          await hook();
        } catch {
          // The failure that brought us here is the actionable one.
        }
      }
    }
    for (const database of live.databaseHandles.splice(0)) {
      try {
        database.close();
      } catch {
        // Already closed, which is one of the ordinary outcomes.
      }
    }
    live.invalidate();
  }

  async function dispatchCallback(
    kind: PluginCallbackKind,
    target: string | undefined,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    const live = handle;
    if (live === null) {
      throw new Error(
        `plugin process received "${kind}" before it was bootstrapped`,
      );
    }
    if (disposed && kind !== "dispose") {
      throw new Error(
        `plugin process received "${kind}" after the plugin was disposed`,
      );
    }
    const result = await dispatchToRegistration({
      handle: live,
      kind,
      target,
      payload,
      signal,
    });
    if (kind === "dispose") disposed = true;
    return result;
  }

  // A channel the host drops without a `dispose` first — a start it abandoned,
  // a bootstrap it gave up on — still leaves a fully live plugin in this
  // process, and this process is shared. Nothing will ever call it again, so
  // its hooks run and its databases close here instead.
  options.port.onClose(() => {
    const live = handle;
    if (live === null || disposed) return;
    disposed = true;
    void releaseResources(live, { runDisposeHooks: true });
  });

  return {
    channel,
    get handle() {
      return handle;
    },
  };
}

/** The far end of `invokeCallback`: find what the plugin registered, run it. */
async function dispatchToRegistration(args: {
  handle: PluginApiHandle;
  kind: PluginCallbackKind;
  target: string | undefined;
  payload: unknown;
  signal: AbortSignal;
}): Promise<unknown> {
  const { handle, kind, target, payload, signal } = args;
  const missing = (what: string): never => {
    throw new Error(
      `plugin has no ${what}${target === undefined ? "" : ` "${target}"`}`,
    );
  };
  // The exhaustiveness guard is the `default` below, not the absence of one.
  // Dropping `default` does not work here — this function returns `unknown`,
  // so falling out of the switch yields `undefined`, which is a perfectly
  // good `unknown` and compiles silently. Checked by deleting a case: no
  // error until the assignment to `never` was added.
  switch (kind) {
    case "rpc": {
      const record = handle.rpcHandlers.get(target ?? "");
      if (record === undefined) return missing("rpc method");
      // Validation happens here, where the contract's validators are: they are
      // functions and never crossed. The server runs this same call for a
      // plugin loaded in-process, and a rejected input or output comes back as
      // the same `PluginRpcBoundaryError`, matched by name.
      return runRpcCall(record, payload);
    }
    case "schedule": {
      const record = handle.schedules.find((one) => one.name === target);
      if (record === undefined) return missing("schedule");
      return record.fn();
    }
    case "cli": {
      const record = handle.cli.registration;
      if (record === null) return missing("cli command");
      const { argv, ctx, cancellable } = payload as {
        argv: string[];
        ctx: object;
        cancellable?: boolean;
      };
      // Absent in, absent out. A fabricated signal that can never fire is not
      // the same value as no signal, and the plugin contract lets a command
      // check for one.
      return record.run(argv, {
        ...ctx,
        ...(cancellable === false ? {} : { signal }),
      } as never);
    }
    case "agentTool": {
      const record = handle.agentTools.find((one) => one.name === target);
      if (record === undefined) return missing("agent tool");
      const { input, ctx } = payload as { input: unknown; ctx: object };
      // Parameters are checked here because the validator is here: a zod
      // schema is an object full of functions, and only the JSON Schema it
      // produced ever reached the server.
      return runAgentToolCall(record, input, { ...ctx, signal } as never);
    }
    case "agentConfigure": {
      const provider = handle.agentConfigurationProvider;
      if (provider === null) return missing("agent configuration provider");
      return provider(payload as never);
    }
    case "agentInstructions": {
      const provider = handle.instructionProvider;
      if (provider === null) return missing("instruction provider");
      return provider(payload as never);
    }
    case "mentionSearch": {
      const record = handle.mentionProviders.find((one) => one.id === target);
      if (record === undefined) return missing("mention provider");
      return record.search(payload as never);
    }
    case "mentionResolve": {
      const record = handle.mentionProviders.find((one) => one.id === target);
      if (record === undefined) return missing("mention provider");
      const { itemId, ctx } = payload as { itemId: string; ctx: unknown };
      return (record.resolve as (id: string, c: unknown) => unknown)(
        itemId,
        ctx,
      );
    }
    case "browserContextMenu": {
      const record = handle.contextMenuItems.find((one) => one.id === target);
      if (record === undefined) return missing("context menu item");
      return record.run(payload as never);
    }
    case "browserFindAction": {
      const record = handle.findActions.find((one) => one.id === target);
      if (record === undefined) return missing("find action");
      return record.run(payload as never);
    }
    case "browserSiteInfo": {
      const record = handle.siteInfoProviders.find((one) => one.id === target);
      if (record === undefined) return missing("site info provider");
      return record.describe(payload as never);
    }
    case "browserTabAction": {
      const record = handle.tabActions.find((one) => one.id === target);
      if (record === undefined) return missing("tab action");
      return record.run(payload as never);
    }
    case "browserToolbarState": {
      const record = handle.toolbarItems.find((one) => one.id === target);
      if (record === undefined) return missing("toolbar item");
      // A host that asks about a control with no `state` is a host and a
      // snapshot that disagree, which is worth saying rather than answering.
      if (record.state === null) return missing("toolbar item state");
      return record.state(payload as never);
    }
    case "browserToolbarRun": {
      const record = handle.toolbarItems.find((one) => one.id === target);
      if (record === undefined) return missing("toolbar item");
      return record.run(payload as never);
    }
    case "browserNewTabRows": {
      const record = handle.newTabWidgets.find((one) => one.id === target);
      if (record === undefined) return missing("new tab widget");
      return record.rows(payload as never);
    }
    case "uiCommand": {
      const record = handle.commands.find((one) => one.id === target);
      if (record === undefined) return missing("command");
      return record.run();
    }
    // The three anonymous kinds are addressed by index, not iterated here.
    // "first one to answer wins" and "all of them run" are the host's rules,
    // applied across plugins as well as within one — so the host keeps its
    // loop and this side answers for exactly the provider it was asked about.
    case "browserAuth": {
      const provider = handle.authProviders[Number(target)];
      if (provider === undefined) return missing("auth provider");
      return (await provider(payload as never)) ?? null;
    }
    case "browserPdfText": {
      const provider = handle.pdfTextProviders[Number(target)];
      if (provider === undefined) return missing("pdf text provider");
      return (await provider(payload as never)) ?? null;
    }
    case "browserExternalLink": {
      const handler = handle.externalLinkHandlers[Number(target)];
      if (handler === undefined) return missing("external link handler");
      // `?? null` for the reason the two above have it: JSON collapses
      // `undefined` into a missing property, and "declined" has to survive the
      // crossing as a value the host can branch on.
      return (await handler(payload as never)) ?? null;
    }
    case "browserOmniboxSuggest": {
      const record = handle.omniboxProviders.find((one) => one.id === target);
      if (record === undefined) return missing("omnibox provider");
      return record.suggest(payload as never);
    }
    case "browserOmniboxRun": {
      const record = handle.omniboxProviders.find((one) => one.id === target);
      const run = record?.run;
      if (run === undefined || run === null) return missing("omnibox provider");
      const { itemId, ctx } = payload as { itemId: string; ctx: unknown };
      return run(itemId, ctx as never);
    }
    case "browserDownload": {
      const download = handle.downloadHandlers[Number(target)];
      if (download === undefined) return missing("download handler");
      await download(payload as never);
      return null;
    }
    case "browserHistoryFilter": {
      const filter = handle.historyFilters[Number(target)];
      if (filter === undefined) return missing("history filter");
      return normalizeBrowserHistoryDecision(await filter(payload as never));
    }
    case "threadEvent": {
      // Within one plugin these are additive and run in registration order,
      // which is this side's business: the host holds one proxy handler per
      // event and does not know how many are behind it.
      const handlers =
        handle.threadEventHandlers[
          target as keyof typeof handle.threadEventHandlers
        ] ?? [];
      for (const handler of handlers) await handler(payload as never);
      return null;
    }
    case "settingsChange": {
      const { next, prev } = payload as { next: never; prev: never };
      for (const listener of handle.settings.listeners) listener(next, prev);
      return null;
    }
    case "dispose": {
      // LIFO, and the host waits for this answer before calling the plugin
      // gone — the ordering plugin-callbacks.ts named as this kind's content.
      for (const hook of [...handle.disposeHooks].reverse()) await hook();
      for (const database of handle.databaseHandles.splice(0)) database.close();
      handle.invalidate();
      return null;
    }
    case "http": {
      const route = handle.httpRoutes.find(
        (one) => `${one.method} ${one.path}` === target,
      );
      if (route === undefined) return missing("http route");
      // The handler wants a Hono `Context`, which is not a thing to
      // hand-build. A one-route app is: Hono constructs a real Context from a
      // real Request, so `c.req.query()`, `c.req.json()` and the rest behave
      // exactly as they do in the server.
      //
      // The route pattern is `*` because the host already routed — it looked
      // up this handler by an exact method+path compare before sending. The
      // child has nothing left to match, and a second pattern here would be a
      // second router to disagree with the first.
      //
      // The throw has to come back out. Hono's own error handling would turn
      // it into a 500 here, and the host would then see a perfectly ordinary
      // response — losing the failure that `invokeCallback` records against
      // the plugin, and the 500 body it produces in-process. So the handler is
      // wrapped and the error rethrown after `fetch` returns.
      let thrown: unknown;
      let threw = false;
      const app = new Hono();
      app.all("*", async (context) => {
        try {
          const answer = await route.handler(context);
          // Structural, not `instanceof` — see `isResponseLike`.
          if (!isResponseLike(answer)) {
            throw new Error("http route handler must return a Response");
          }
          return answer;
        } catch (error) {
          thrown = error;
          threw = true;
          return new Response(null, { status: 500 });
        }
      });
      const response = await app.fetch(
        rebuildHttpRequest(payload as unknown as PluginHttpRequestMessage),
      );
      if (threw) throw thrown;
      return await reduceHttpResponse(response);
    }
    case "backgroundService": {
      const command = payload as unknown as PluginServiceCommand;
      const record = handle.backgroundServices.find(
        (one) => one.name === (target ?? command.name),
      );
      if (record === undefined) return missing("background service");
      // Not an event stream, which is what ./plugin-service-message.ts
      // anticipated: the request *is* the service's lifetime. It stays open
      // for as long as start() runs, the host's cancel message is the abort
      // signal, resolving means the service returned and rejecting means it
      // threw — which is exactly the pair the host's existing runner already
      // decides on. See that file's note for what became redundant.
      await record.start(signal);
      return null;
    }
    default: {
      const unhandled: never = kind;
      throw new Error(`unhandled plugin callback kind ${String(unhandled)}`);
    }
  }
}

function snapshot(handle: PluginApiHandle): PluginRegistrationSnapshot {
  return {
    httpRoutes: handle.httpRoutes.map((route) => ({
      method: route.method,
      path: route.path,
      auth: route.auth,
    })),
    rpcMethods: [...handle.rpcHandlers.keys()],
    backgroundServices: handle.backgroundServices.map((one) => one.name),
    schedules: handle.schedules.map((one) => ({
      name: one.name,
      cron: one.cron,
    })),
    cli:
      handle.cli.registration === null
        ? null
        : {
            name: handle.cli.registration.name,
            summary: handle.cli.registration.summary,
            commands: handle.cli.registration.commands,
          },
    agentTools: handle.agentTools.map((one) => ({
      name: one.name,
      description: one.description,
      instructions: one.instructions,
      inputSchema: one.inputSchema,
      experimentalStatusLabels: one.experimentalStatusLabels,
    })),
    hasAgentConfiguration: handle.agentConfigurationProvider !== null,
    hasInstructionProvider: handle.instructionProvider !== null,
    mentionProviders: handle.mentionProviders.map((one) => ({
      id: one.id,
      label: one.label,
      triggers: [...one.triggers],
    })),
    omniboxProviders: handle.omniboxProviders.map((one) => ({
      id: one.id,
      label: one.label,
      hasRun: one.run !== null,
    })),
    contextMenuItems: handle.contextMenuItems.map((one) => ({
      id: one.id,
      title: one.title,
      when: { ...one.when },
    })),
    findActions: handle.findActions.map((one) => ({
      id: one.id,
      title: one.title,
    })),
    tabActions: handle.tabActions.map((one) => ({
      id: one.id,
      title: one.title,
    })),
    siteInfoProviders: handle.siteInfoProviders.map((one) => ({
      id: one.id,
      label: one.label,
    })),
    toolbarItems: handle.toolbarItems.map((one) => ({
      id: one.id,
      title: one.title,
      icon: one.icon,
      hasState: one.state !== null,
    })),
    newTabWidgets: handle.newTabWidgets.map((one) => ({
      id: one.id,
      label: one.label,
    })),
    commands: handle.commands.map((one) => ({
      id: one.id,
      title: one.title,
      shortcut: { ...one.shortcut },
    })),
    downloadHandlerCount: handle.downloadHandlers.length,
    historyFilterCount: handle.historyFilters.length,
    authProviderCount: handle.authProviders.length,
    pdfTextProviderCount: handle.pdfTextProviders.length,
    externalLinkHandlerCount: handle.externalLinkHandlers.length,
    keybindings: handle.keybindings,
    searchEngines: handle.searchEngines,
    pageStyles: handle.pageStyles,
    pageScripts: handle.pageScripts,
    threadEvents: Object.entries(handle.threadEventHandlers)
      .filter(([, handlers]) => (handlers as unknown[]).length > 0)
      .map(([event]) => event),
    settingsDescriptors: handle.settings.descriptors,
    hasSettingsListeners: handle.settings.listeners.length > 0,
  };
}

/**
 * `@patcher/sdk`, loaded the first time a plugin asks for `patcher.sdk` — and loaded
 * *synchronously*, because `getSdk()` is synchronous and the plugin-facing
 * contract (`patcher.sdk.threads.list()`, `patcher.sdk.guide.render()`) has members that
 * answer without awaiting anything.
 *
 * This is the single biggest thing a plugin process pays for. `@patcher/sdk` pulls
 * `createApiClient`, which builds the whole public API surface — every route,
 * every zod schema — at import time: **~100MB resident, in every plugin
 * process, whether or not the plugin ever touches the SDK.** Measured by
 * apps/server/scripts/measure-plugin-host.mjs.
 *
 * A literal `require()` is what makes it deferrable without giving up the
 * synchronous contract. The bundler keeps the module in the bundle and
 * initialises it on the first call, so the process is self-contained and pays
 * nothing until then; under tsx there is no `require` in scope, and
 * `createRequire` resolves it from the workspace. Both branches load the same
 * module — only who resolves it differs.
 */
let patcherSdkModule: typeof import("@patcher/sdk") | undefined;

function loadPatcherSdk(): typeof import("@patcher/sdk") {
  patcherSdkModule ??=
    typeof require === "function"
      ? (require("@patcher/sdk") as typeof import("@patcher/sdk"))
      : (createRequire(import.meta.url)(
          "@patcher/sdk",
        ) as typeof import("@patcher/sdk"));
  return patcherSdkModule;
}
