// Portable type declarations for `@patcher/plugin-sdk`. Unpublished Patcher
// workspace contracts are flattened; public subpaths may reuse the
// package root without requiring any other @patcher/* package.
//
// Confused by the API, or need a symbol that isn't here? Clone the Patcher repo
// and read the real source: https://github.com/laruss/patcher-browser

import { PatcherPluginApi, PluginSettingValue, PluginAgentToolExperimentalStatusLabels, PluginAgentToolContext, PluginAgentToolResult, PluginCliCommandInfo, PluginCliContext, PluginCliResult, PluginHttpAuthMode, PluginHttpHandler, PluginMentionTrigger, PluginMentionSearchContext, PluginMentionItem, PluginBrowserConsoleEntry, PluginBrowserNetworkEntry, PluginBrowserCookie, PluginBrowserStorageItem, PluginBrowserErrorCode, JsonValue, PluginCliExecutionResult, PluginThreadEventName, PluginThreadEventPayloads, PluginAgentConfigurationContext, PluginSettingDescriptors, PluginAgentConfiguration, PluginOmniboxSuggestContext, PluginOmniboxSuggestion, PluginOmniboxRunContext, PluginOmniboxRunResult, PluginKeybinding, PluginBrowserDownloadHandler, PluginBrowserContextMenuItemRegistration, PluginBrowserFindActionRegistration, PluginBrowserTabActionRegistration, PluginBrowserSiteInfoProviderRegistration, PluginBrowserToolbarItemRegistration, PluginBrowserNewTabWidgetRegistration, PluginCommandRegistration, PluginBrowserSearchEngineRegistration, PluginBrowserPageStyleRegistration, PluginBrowserPageScriptRegistration, PluginBrowserAuthProvider, PluginBrowserPdfTextProvider, PluginBrowserExternalLinkHandler, PluginBrowserHistoryFilter, PluginInteractionRequest } from '@patcher/plugin-sdk';

/**
 * What a plugin declares it will use, and what the host lets it reach.
 *
 * Read this before adding one: **in-process, these are not a security boundary
 * and cannot be.** A plugin's `server.ts` is a Node module loaded into the Patcher
 * server, so it can `import("node:child_process")`, read another plugin's
 * secrets off disk, or skip `patcher.sdk` entirely and call the loopback API it is
 * handed in `patcher.server.loopbackBaseUrl`. A gate on the `patcher` object stops none
 * of that. Plan §9 asks for isolation and plan Phase 7 is where it comes from.
 *
 * What these are for until then, in the order the value actually arrives:
 *
 * 1. **The specification of the Phase 7 RPC surface.** Every entry names an
 *    operation that must cross a process boundary once plugins move out. A
 *    plugin host built without this list would isolate the plugin and then hand
 *    it back everything over RPC.
 * 2. **A legible contract.** An agent-generated plugin that reaches for
 *    something it did not declare fails at the call with the permission named,
 *    which is a fixable message rather than silent extra behaviour.
 * 3. **Something to show the user** at install time, and in the plugin's detail.
 *
 * Undeclared means denied. A plugin with no `patcher.permissions` reaches nothing
 * gated — there is no legacy "everything" mode, because a default of "all"
 * would leave the list describing intentions instead of the boundary.
 */
/**
 * Every permission, grouped by what it opens. The array is the source of truth:
 * the zod schema, the manifest validator and the docs guard all read it.
 */
declare const PLUGIN_PERMISSIONS: readonly ["tabs.read", "page.read", "network.observe", "tabs.modify", "page.interact", "page.inject", "network.intercept", "page.credentials", "page.record", "omnibox.register", "contextMenu.register", "tabMenu.register", "find.register", "siteInfo.register", "toolbar.register", "newTab.register", "pageStyle.register", "pageScript.register", "searchEngine.register", "downloads.handle", "auth.provide", "externalLink.handle", "pdf.provide", "history", "threads", "filesystem", "shell", "workspace", "plugins"];
type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/**
 * The fake host's half of `patcher.permissions`.
 *
 * It exists so a plugin's unit tests cannot pass on a manifest the real host
 * would refuse. The default is the host's default — **declared nothing,
 * reaches nothing gated** — so a suite that exercises `patcher.browser` or
 * `patcher.sdk` must say what the plugin asks for, and saying it wrong fails here
 * instead of on someone's machine.
 *
 * Say it by reading the plugin's own manifest, so the test cannot drift from
 * what ships — see {@link pluginPermissionsFromManifest}.
 *
 * Refusals mirror the server's by `name`, not by class — no runtime class
 * crosses that boundary, and tests match on the name.
 */
/**
 * The `patcher.permissions` of the plugin owning `from`, read off disk.
 *
 * Pass `import.meta.url` from the test. Reading the real manifest is the whole
 * point: a hand-written list in the test would be a second declaration, free
 * to say the plugin needs something it does not, or — worse — to keep passing
 * after the manifest drops an entry the code still uses.
 *
 * Walks up to the nearest `package.json` that declares `patcher.server`, so tests
 * in subdirectories work without naming a path.
 */
declare function pluginPermissionsFromManifest(from: string): readonly PluginPermission[];
/**
 * The `patcher.sites` of the plugin owning `from`, read off disk.
 *
 * The companion to {@link pluginPermissionsFromManifest}, and needed for the
 * same reason plus one of its own: a page style names one of these patterns, so
 * a test that listed them by hand could register a style against a site the
 * manifest never declared — which is the one thing an install refuses.
 */
declare function pluginSitesFromManifest(from: string): readonly string[];
interface FakePermissionGate {
    has(permission: PluginPermission): boolean;
    assert(permission: PluginPermission, what: string): void;
    readonly granted: readonly PluginPermission[];
}

type PatcherSdk = PatcherPluginApi["sdk"];
/**
 * Recordable `patcher.sdk` stand-in for {@link createFakePluginHost}. Every call
 * through the fake is recorded (post plugin-attribution defaulting, so
 * assertions see what the server would receive); calls without a stubbed
 * implementation throw with a message naming the exact path to stub.
 */
/** One recorded `patcher.sdk` call. `path` is dot-joined, e.g. "threads.spawn". */
interface FakeSdkCall {
    path: string;
    args: unknown[];
}
/**
 * A stub keeps the real method's parameter types but may return anything —
 * tests usually only build the fields the plugin reads, not the full wire
 * response.
 */
type LooseStub<F> = F extends (...args: infer A) => unknown ? (...args: A) => unknown : never;
/**
 * Stub implementations keyed like `PatcherSdk`: an object per area with a subset
 * of its methods, or a function for the root-level members (`on`).
 */
type FakeSdkOverrideTree<T> = {
    [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? LooseStub<T[K]> : FakeSdkOverrideTree<T[K]>;
};
type FakeSdkOverrides = FakeSdkOverrideTree<PatcherSdk>;
interface FakeSdkHarness {
    /** Every `patcher.sdk` call in order, including ones whose stub threw. */
    readonly calls: FakeSdkCall[];
    /** Argument lists of the calls to one dot-joined path. */
    callsTo(path: string): unknown[][];
    /** Add or replace one method's implementation after creation. */
    stub(path: string, implementation: (...args: never[]) => unknown): void;
}
declare function createFakeSdk(options: {
    pluginId: string;
    overrides?: FakeSdkOverrides;
    permissions: FakePermissionGate;
}): {
    sdk: PatcherSdk;
    harness: FakeSdkHarness;
};

/**
 * `createFakePluginHost` — an in-process stand-in for the Patcher server's plugin
 * runtime (apps/server/src/services/plugins/plugin-api.ts), for unit-testing
 * a plugin's `server.ts` without a server. `patcher` satisfies {@link PatcherPluginApi};
 * `harness` drives and inspects it.
 *
 * Faithful where a plugin can observe it: registration name validation and
 * error messages, the kv 256KB cap, append-only database migrations, settings
 * read/update semantics (including onChange), schema-validated rpc/cli
 * invocation shapes (strict JSON boundaries, exit-code normalization), `threads.spawn`
 * attribution, atomic reload, and dispose order (services aborted, hooks LIFO,
 * database closed, stale handles throw). New tests can keep host inputs,
 * assertions, and shutdown explicit through `harness.behavior`,
 * `harness.inspection`, and `harness.lifecycle`; direct members remain aliases.
 *
 * Deliberately different from the real host:
 * - storage is process-local: kv in a Map, `storage.database()` one shared
 *   better-sqlite3 handle in a temp directory (same data across calls, like
 *   the host's shared file), secret settings alongside plain values (no files).
 * - `patcher.sdk` is always bound (no listen gate) and every unstubbed method
 *   throws instead of hitting a server.
 * - http auth modes are recorded but not enforced — signature checks and
 *   token handling inside handlers still run.
 * - background services/schedules never run on timers; `harness.runService`
 *   and `harness.runSchedule` invoke them deterministically.
 */
/** Same shape (and name) the real host throws for stale API handles. */
declare class PluginContextStaleError extends Error {
    constructor(pluginId: string);
}
type FakeLogLevel = "debug" | "info" | "warn" | "error";
interface FakeLogEntry {
    level: FakeLogLevel;
    message: string;
}
interface FakeHttpRouteRecord {
    method: string;
    path: string;
    auth: PluginHttpAuthMode;
    handler: PluginHttpHandler;
}
interface FakeScheduleRecord {
    name: string;
    cron: string;
    fn: () => void | Promise<void>;
}
interface FakeServiceRecord {
    name: string;
    start: (signal: AbortSignal) => void | Promise<void>;
}
interface FakeCliRecord {
    name: string;
    summary: string;
    commands: PluginCliCommandInfo[];
    run: (argv: string[], ctx: PluginCliContext) => PluginCliResult | Promise<PluginCliResult>;
}
interface FakeAgentToolRecord {
    name: string;
    description: string;
    experimentalStatusLabels: PluginAgentToolExperimentalStatusLabels | null;
    instructions: string | null;
    /** JSON-schema object the host would send providers. */
    inputSchema: unknown;
    parse(input: unknown): {
        ok: true;
        value: unknown;
    } | {
        ok: false;
        error: string;
    };
    execute(params: unknown, ctx: PluginAgentToolContext): PluginAgentToolResult | Promise<PluginAgentToolResult>;
}
interface FakeMentionProviderRecord {
    id: string;
    label: string;
    triggers: readonly PluginMentionTrigger[];
    search: (ctx: PluginMentionSearchContext) => PluginMentionItem[] | Promise<PluginMentionItem[]>;
    resolve: (itemId: string) => {
        context: string;
    } | Promise<{
        context: string;
    }>;
}
interface FakeOmniboxProviderRecord {
    id: string;
    label: string;
    suggest: (ctx: PluginOmniboxSuggestContext) => PluginOmniboxSuggestion[] | Promise<PluginOmniboxSuggestion[]>;
    run: ((itemId: string, ctx: PluginOmniboxRunContext) => PluginOmniboxRunResult | void | Promise<PluginOmniboxRunResult | void>) | null;
}
/**
 * A stand-in browser surface for plugins that call `patcher.browser.tabs`/`page`/
 * `navigation`. It models the two properties those calls actually hinge on —
 * which tab is active, and which tabs are **live** (have a real page behind
 * them) — so a plugin's error handling can be exercised without an Electron
 * window anywhere in sight.
 */
interface FakeBrowserDrivers {
    /** Replace the tab model. The first tab is active unless one sets `active`. */
    setTabs(tabs: readonly FakeBrowserTabInput[]): void;
    /**
     * What the page reads answer for a live tab. `console` and `network` are the
     * tab's logs, which `page.console`/`page.network` slice from the end.
     */
    setPageContent(tabId: string, content: {
        text?: string;
        selection?: string;
        snapshot?: string;
        console?: readonly PluginBrowserConsoleEntry[];
        network?: readonly PluginBrowserNetworkEntry[];
        /** What `patcher.browser.storage` reads, and what its writes then change. */
        cookies?: readonly PluginBrowserCookie[];
        localStorage?: readonly PluginBrowserStorageItem[];
        sessionStorage?: readonly PluginBrowserStorageItem[];
        /**
         * What `patcher.browser.control.evaluate` answers with, whatever it was asked.
         * A fake cannot run the expression; what a test can check is that the
         * expression it meant to send is the one that was sent.
         */
        evaluated?: string;
        /** What `patcher.browser.recording.videoStop` hands back, since a fake films nothing. */
        frames?: readonly {
            at: number;
            base64: string;
        }[];
    }): void;
    /** Pretend no app window is connected, so every call fails like production. */
    setConnected(connected: boolean): void;
    /** Whether a tab has a JavaScript dialog waiting to be answered. */
    setPendingDialog(pending: boolean): void;
    /**
     * Make the next browser call fail with this code, the way the host reports a
     * refusal from the app: an Error named "BrowserCommandError" carrying `code`.
     */
    failNextCall(code: PluginBrowserErrorCode, message?: string): void;
}
interface FakeBrowserTabInput {
    tabId: string;
    url?: string;
    title?: string | null;
    active?: boolean;
    /** Defaults to true; set false to model a tab that was never opened on screen. */
    live?: boolean;
    loading?: boolean;
    canGoBack?: boolean;
    canGoForward?: boolean;
}
/** One recorded `patcher.browser.*` call, for assertions. */
interface FakeBrowserCall {
    type: string;
    args: Record<string, unknown>;
}
interface FakeRealtimeSignal {
    channel: string;
    /** JSON-round-tripped, like the WS broadcast; `undefined` → `null`. */
    payload: unknown;
}
/** Everything the plugin registered, exposed raw for assertions. */
interface FakePluginRegistrations {
    settingsDescriptors: PluginSettingDescriptors;
    httpRoutes: FakeHttpRouteRecord[];
    rpcMethods: string[];
    services: FakeServiceRecord[];
    schedules: FakeScheduleRecord[];
    cli: FakeCliRecord | null;
    agentTools: FakeAgentToolRecord[];
    /** Provider from patcher.agents.configure, or null when none registered. */
    agentConfigurationProvider: ((context: PluginAgentConfigurationContext) => PluginAgentConfiguration) | null;
    /** Provider from contributeInstructions, or null when none registered. */
    instructionProvider: ((ctx: {
        threadId: string;
        projectId: string;
    }) => string | null) | null;
    threadEventHandlers: Record<PluginThreadEventName, number>;
    mentionProviders: FakeMentionProviderRecord[];
    omniboxProviders: FakeOmniboxProviderRecord[];
    /** Keybindings from `patcher.ui.registerKeybinding`, in registration order. */
    keybindings: PluginKeybinding[];
    /** Handlers from `patcher.browser.registerDownloadHandler`, in registration order. */
    downloadHandlers: PluginBrowserDownloadHandler[];
    /** Items from `patcher.browser.registerContextMenuItem`, in registration order. */
    contextMenuItems: PluginBrowserContextMenuItemRegistration[];
    /** Buttons from `patcher.browser.registerFindAction`, in registration order. */
    findActions: PluginBrowserFindActionRegistration[];
    /** Entries from `patcher.browser.registerTabAction`, in registration order. */
    tabActions: PluginBrowserTabActionRegistration[];
    /** Providers from `patcher.browser.registerSiteInfoProvider`, in order. */
    siteInfoProviders: PluginBrowserSiteInfoProviderRegistration[];
    /** Controls from `patcher.browser.registerToolbarItem` — at most one. */
    toolbarItems: PluginBrowserToolbarItemRegistration[];
    /** Sections from `patcher.browser.registerNewTabWidget`, in registration order. */
    newTabWidgets: PluginBrowserNewTabWidgetRegistration[];
    /** Commands from `patcher.ui.registerCommand`, in registration order. */
    commands: PluginCommandRegistration[];
    /** Engines from `patcher.browser.registerSearchEngine`, in registration order. */
    searchEngines: PluginBrowserSearchEngineRegistration[];
    /** Styles from `patcher.browser.registerPageStyle`, in registration order. */
    pageStyles: PluginBrowserPageStyleRegistration[];
    /** Scripts from `patcher.browser.registerPageScript`, in registration order. */
    pageScripts: PluginBrowserPageScriptRegistration[];
    /** Providers from `patcher.browser.registerAuthProvider`, in registration order. */
    authProviders: PluginBrowserAuthProvider[];
    /** Providers from `patcher.browser.registerPdfTextProvider`, in order. */
    pdfTextProviders: PluginBrowserPdfTextProvider[];
    /**
     * Handlers from `patcher.browser.registerExternalLinkHandler`, in registration
     * order.
     */
    externalLinkHandlers: PluginBrowserExternalLinkHandler[];
    /** Filters from `patcher.browser.registerHistoryFilter`, in registration order. */
    historyFilters: PluginBrowserHistoryFilter[];
}
/** Read-only state for assertions after a plugin registers or handles work. */
interface FakePluginInspectionState {
    readonly pluginId: string;
    /** Every `patcher.log` line, in order. */
    readonly logEntries: FakeLogEntry[];
    /** Every `patcher.realtime.publish`, payload normalized like the wire. */
    readonly realtimeSignals: FakeRealtimeSignal[];
    /** Every `patcher.status.needsConfiguration` message, in order. */
    readonly needsConfigurationMessages: string[];
    /** Recorded `patcher.sdk` calls + stub control. */
    readonly sdk: FakeSdkHarness;
    readonly registrations: FakePluginRegistrations;
    readonly pendingInteractions: readonly (PluginInteractionRequest & {
        id: string;
    })[];
    /** Every `patcher.browser.*` call, in order. */
    readonly browserCalls: readonly FakeBrowserCall[];
}
/** Deterministic inputs that stand in for behavior normally driven by Patcher. */
interface FakePluginBehaviorDrivers {
    /** Drive the stand-in browser surface behind `patcher.browser.*`. */
    browser: FakeBrowserDrivers;
    submitInteraction(id: string, value: JsonValue): void;
    cancelInteraction(id: string): void;
    /**
     * Apply a settings update the way the host's settings save does:
     * validate against the declared descriptors (`null` unsets), store, and
     * fire `onChange` listeners when effective values changed. Throws on
     * unknown keys or wrong value types.
     */
    setSettings(values: Record<string, PluginSettingValue | null>): Promise<void>;
    /**
     * Invoke a registered rpc method with host semantics: input/output schemas,
     * strict JSON result normalization, and structured failure codes. Rejects
     * with the same message/code/issues the frontend client surfaces.
     */
    callRpc(method: string, input?: unknown): Promise<unknown>;
    /**
     * Invoke the plugin's CLI command with host semantics: the result's
     * exitCode must be a number, stdout/stderr default to "", and a throwing
     * run() becomes `{ exitCode: 1, stderr: "patcher <name> failed: …" }`.
     */
    runCli(argv: string[], ctx?: PluginCliContext): Promise<PluginCliExecutionResult>;
    /**
     * Dispatch a request to a registered `patcher.http` route (exact method+path
     * match, like the host's V1 router) through a real Hono context. Auth
     * modes are not enforced. A throwing handler yields the host's 500
     * `{ ok: false, error: "plugin route failed: …" }` response.
     */
    fetchHttp(method: string, path: string, init?: RequestInit): Promise<Response>;
    /**
     * Start a registered background service once, deterministically. `done`
     * settles when `start` returns; abort `controller` to signal shutdown.
     * A thrown NeedsConfigurationError (matched by name, like the host) is
     * recorded via needsConfiguration and resolves `done`; other errors
     * reject it.
     */
    runService(name: string): {
        controller: AbortController;
        done: Promise<void>;
    };
    /** Run a registered schedule's function once (no timers, no cron sweep). */
    runSchedule(name: string): Promise<void>;
    /**
     * Deliver a thread lifecycle event to every `patcher.events.on` handler. Handlers run
     * sequentially; errors are caught and logged like the host's
     * fire-and-forget dispatch, and returned for assertions.
     */
    emitThreadEvent<E extends PluginThreadEventName>(event: E, payload: PluginThreadEventPayloads[E]): Promise<{
        errors: unknown[];
    }>;
    /**
     * Call a registered agent tool the way a provider tool-call would:
     * arguments go through the tool's parse step (zod-validated for zod
     * registrations; a parse failure throws), then execute. `ctx` fields
     * default to "thread-test"/"project-test" and a fresh signal.
     */
    callAgentTool(name: string, input: unknown, ctx?: Partial<PluginAgentToolContext>): Promise<PluginAgentToolResult>;
    /** Evaluate `patcher.agents.configure` with production validation/fail-closed
     * semantics. With no callback, every registered tool/declared test skill is
     * selected. Callback failures are logged and return empty selections. */
    resolveAgentConfiguration(context: PluginAgentConfigurationContext): Promise<{
        tools: FakeAgentToolRecord[];
        skills: string[];
        instructions: string | null;
    }>;
}
/** Reload/shutdown controls, kept separate from behavior and inspection. */
interface FakePluginLifecycleControls {
    /**
     * Load a replacement against the same persisted settings, kv, and database.
     * The current host remains live when the factory throws; on success its
     * services/hooks are disposed and the returned host becomes current.
     */
    reload(factory: (patcher: PatcherPluginApi) => void | Promise<void>): Promise<FakePluginHost>;
    /**
     * Dispose like a host reload/disable: abort services started via
     * runService, run onDispose hooks LIFO (isolated), close database handles,
     * then poison the `patcher` handle (further use throws
     * PluginContextStaleError). Idempotent.
     */
    dispose(): Promise<void>;
}
/**
 * Complete fake-host harness. Direct members are retained for compatibility;
 * the named views make intent explicit in new tests.
 */
interface FakePluginHarness extends FakePluginInspectionState, FakePluginBehaviorDrivers, FakePluginLifecycleControls {
    readonly behavior: FakePluginBehaviorDrivers;
    readonly inspection: FakePluginInspectionState;
    readonly lifecycle: FakePluginLifecycleControls;
}
interface CreateFakePluginHostOptions {
    /** Defaults to "test-plugin". */
    pluginId?: string;
    /**
     * Value served by `patcher.server.loopbackBaseUrl` (always bound here, like
     * `patcher.sdk`). Defaults to "http://127.0.0.1:38986".
     */
    loopbackBaseUrl?: string;
    /**
     * Pre-seeded stored settings values (as if saved before this load) —
     * including secret ones, which the fake keeps in memory instead of
     * files. Values with the wrong type for their descriptor fall back to
     * the descriptor default on read, like the host.
     */
    settings?: Record<string, PluginSettingValue>;
    /** Initial `patcher.sdk` stubs; extend later via `harness.sdk.stub`. */
    sdk?: FakeSdkOverrides;
    /** Static manifest skill ids available to configure() in this fake host. */
    agentSkillIds?: readonly string[];
    /**
     * What `patcher.permissions` declares. Defaults to none, like the host — so a
     * suite touching `patcher.browser` or `patcher.sdk` must say what the plugin asks
     * for, and cannot pass on a manifest an install would refuse.
     *
     * Read it from the plugin's own manifest so the two cannot drift:
     * `permissions: pluginPermissionsFromManifest(import.meta.url)`.
     */
    permissions?: readonly PluginPermission[];
    /**
     * What `patcher.sites` declares: the websites this plugin's page contributions may
     * reach. Defaults to none, so `registerPageStyle` and `registerPageScript`
     * are refused here exactly as an install would refuse them.
     *
     * Read it from the plugin's own manifest, for the reason the permissions above
     * are: `sites: pluginSitesFromManifest(import.meta.url)`.
     */
    sites?: readonly string[];
}
interface FakePluginHost {
    patcher: PatcherPluginApi;
    harness: FakePluginHarness;
}
declare function createFakePluginHost(options?: CreateFakePluginHostOptions): FakePluginHost;

type ThreadResponse = PluginThreadEventPayloads["thread.created"]["thread"];
/**
 * A complete, deterministic `ThreadResponse` for thread lifecycle event
 * payloads (`harness.emitThreadEvent`). Defaults are the minimal idle
 * thread; override the fields the test cares about. If the contract grows a
 * required field, this builder fails typecheck — update the default here.
 */
declare function makeThreadResponse(overrides?: Partial<ThreadResponse>): ThreadResponse;

export { PluginContextStaleError, createFakePluginHost, createFakeSdk, makeThreadResponse, pluginPermissionsFromManifest, pluginSitesFromManifest };
export type { CreateFakePluginHostOptions, FakeAgentToolRecord, FakeCliRecord, FakeHttpRouteRecord, FakeLogEntry, FakeLogLevel, FakeMentionProviderRecord, FakePermissionGate, FakePluginBehaviorDrivers, FakePluginHarness, FakePluginHost, FakePluginInspectionState, FakePluginLifecycleControls, FakePluginRegistrations, FakeRealtimeSignal, FakeScheduleRecord, FakeSdkCall, FakeSdkHarness, FakeSdkOverrides, FakeServiceRecord };
