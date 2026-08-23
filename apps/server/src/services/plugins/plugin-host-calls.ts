/**
 * Every call a plugin makes *out* to the host — the other half of
 * ./plugin-callbacks.ts.
 *
 * That file names what the server calls in a plugin and found three shapes
 * that could not cross. This one names what the plugin calls on `patcher`, for the
 * same reason and with the same discipline: the boundary is easier to build
 * from a list than to discover one refusal at a time.
 *
 * Two parts of the surface are deliberately absent, because they already cross
 * and do not belong to this transport:
 *
 * - `patcher.sdk` is a loopback HTTP client that identifies itself
 *   (./plugin-api-identity.ts). A plugin in another process makes the same
 *   requests to the same port; nothing about it changes.
 * - `patcher.browser`'s six command namespaces are one serialisable command union on
 *   a message bus already. They appear here as a single entry rather than
 *   ~40 near-identical ones; the per-command list that matters is
 *   `permissionForBrowserCommand` in @patcher/domain.
 *
 * What is left is the part with no described shape yet, and it has its own
 * obstacles — recorded as `argsCross: false` with a `note`, exactly as the
 * callback catalogue records its own.
 *
 * **Nothing here changes how a call runs today.** `patcher` is still the in-process
 * object; this is the description a transport will implement.
 */

import type { PluginCallbackKind } from "./plugin-callbacks.js";

/**
 * What kind of thing the member is, which decides what a transport owes it.
 *
 * - `read` — a property, not a call. Resolved once when the plugin starts,
 *   because its value does not change for the life of a load.
 * - `call` — request out, response back.
 * - `notify` — one way. The plugin does not wait and cannot be told it failed.
 * - `register` — hands the host a function. These are the entries that create
 *   the other direction: `callbacks` names what the host will later call, and
 *   every one of those is an entry in PLUGIN_CALLBACKS.
 */
export type PluginHostCallCategory = "read" | "call" | "notify" | "register";

export interface PluginHostCallShape {
  category: PluginHostCallCategory;
  /**
   * Whether the arguments survive the boundary as JSON. `false` names a real
   * obstacle and `note` says what it is.
   *
   * For a `register`, this asks about the *registration* minus its handler
   * functions — the handler is not an obstacle, it is the point: it becomes a
   * `callbacks` entry and stays in the plugin's process. An obstacle here means
   * something else in the registration is not data.
   */
  argsCross: boolean;
  /** Whether the return value survives as JSON. */
  resultCrosses: boolean;
  /** The plugin is handed a cancellable operation; see ./plugin-cancellation.ts. */
  cancellable?: true;
  /**
   * The member is **synchronous** and its answer is host state, so it cannot
   * be a request no matter how well its arguments serialise.
   *
   * A separate axis from `argsCross`, and one that only appeared when the
   * plugin process was built: `createPluginApi` takes three of its host
   * capabilities as synchronous functions, and a plugin calls the members
   * behind them without awaiting. The options are to push a copy of the fact
   * (good enough where a stale copy can only worsen an error message) or to
   * move the decision to the host (required where it is authoritative). The
   * note on each says which.
   */
  synchronousHostState?: true;
  /**
   * Which server→plugin calls this registration creates. Empty for a
   * registration that is pure data, which is worth distinguishing: it needs no
   * return path at all.
   */
  callbacks?: readonly PluginCallbackKind[];
  note?: string;
}

/**
 * The complete set, keyed by the path a transport would route on —
 * `patcher.storage.kv.get` is `"storage.kv.get"`.
 *
 * The keys are exact paths rather than a nested shape because that is what a
 * message carries. `settings.<handle>.*` is the one exception: those members
 * exist only on the object `settings.define` returns, so they have no path on
 * `patcher` and the placeholder segment says so.
 */
export const PLUGIN_HOST_CALLS = {
  // -- Identity and facts ---------------------------------------------------
  pluginId: { category: "read", argsCross: true, resultCrosses: true },
  "server.loopbackBaseUrl": {
    category: "read",
    argsCross: true,
    resultCrosses: true,
    note: "Bind-gated: reading it before the server listens throws. A plugin process started after the server is listening never sees that state, which removes the gate rather than moving it.",
  },
  sdk: {
    category: "read",
    argsCross: true,
    resultCrosses: true,
    note: "Not carried by this transport. The plugin's own SDK client speaks loopback HTTP with its identity headers, so it works from any process; the permission check is already on the server side of that call.",
  },

  // -- Logging --------------------------------------------------------------
  "log.debug": { category: "notify", argsCross: true, resultCrosses: true },
  "log.info": { category: "notify", argsCross: true, resultCrosses: true },
  "log.warn": { category: "notify", argsCross: true, resultCrosses: true },
  "log.error": { category: "notify", argsCross: true, resultCrosses: true },

  // -- Settings -------------------------------------------------------------
  "settings.define": {
    category: "call",
    argsCross: true,
    resultCrosses: false,
    note: "Descriptors are plain data on purpose (so the host can render a form without running plugin code), and that is what crosses. The handle it returns is an object with methods, which does not — but does not need to: the plugin's side builds the handle locally and its two members are the entries below.",
  },
  "settings.<handle>.get": {
    category: "call",
    argsCross: true,
    resultCrosses: true,
  },
  "settings.<handle>.onChange": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["settingsChange"],
  },

  // -- Storage --------------------------------------------------------------
  "storage.kv.get": { category: "call", argsCross: true, resultCrosses: true },
  "storage.kv.set": { category: "call", argsCross: true, resultCrosses: true },
  "storage.kv.delete": {
    category: "call",
    argsCross: true,
    resultCrosses: true,
  },
  "storage.kv.list": { category: "call", argsCross: true, resultCrosses: true },
  "storage.database": {
    category: "call",
    argsCross: true,
    resultCrosses: false,
    note: "Returns a live better-sqlite3 handle: synchronous, with statement objects and iterators. No transport carries that. It is also the reason the host process is Node — the plugin's process opens <dataDir>/plugins/<id>/data.db itself, so the host owes it a path and not a handle. Two processes on one SQLite file is what WAL and busy_timeout are already configured for. See docs/architecture/bb-migration.md § Bun as a runtime.",
  },
  "storage.migrate": {
    category: "call",
    argsCross: false,
    resultCrosses: true,
    note: "Takes the handle above as its first argument, so it moves with it. Pure helper — statements in, transaction run — with nothing host-side about it once the database is local.",
  },

  // -- Backend surfaces -----------------------------------------------------
  "http.route": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["http"],
  },
  "rpc.register": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["rpc"],
    note: "The contract carries Standard Schema validators (`~standard.validate`), which are functions and cannot cross — so they do not: `plugin-rpc-call.ts` holds what an rpc call *is* (validate input, run, validate output, normalize), and the side holding the handler runs it. The host keeps the method name, which is all routing needs. A rejected input or output comes back as the same `PluginRpcBoundaryError`, matched by name.",
  },
  "realtime.publish": {
    category: "notify",
    argsCross: true,
    resultCrosses: true,
  },
  "background.service": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["backgroundService"],
  },
  "background.schedule": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["schedule"],
  },
  "cli.register": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["cli"],
  },

  // -- Agent surfaces -------------------------------------------------------
  "agents.configure": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["agentConfigure"],
  },
  "agents.registerTool": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    synchronousHostState: true,
    callbacks: ["agentTool"],
    note: "`parameters` may be a zod schema, which does not cross — but the registration already derives the JSON Schema the model is shown (`z.toJSONSchema` in plugin-api.ts), and that is the only part the host needs. The validator stays with the handler and runs there (`plugin-agent-tool-call.ts`); both sides refuse bad arguments with the same sentence, so the model's answer does not depend on where the tool runs. What remains is the synchronous part: registration rejects a name another plugin already took via `isAgentToolNameTaken`. No process can answer that about the others, so the plugin process holds a pushed copy for the good error message while the host stays the authority — it is the only place that sees every plugin.",
  },
  "agents.contributeInstructions": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["agentInstructions"],
  },

  // -- UI -------------------------------------------------------------------
  "ui.requestInput": {
    category: "call",
    argsCross: true,
    resultCrosses: true,
    cancellable: true,
  },
  "ui.registerMentionProvider": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["mentionSearch", "mentionResolve"],
  },
  "ui.registerKeybinding": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: [],
    note: "Data only — a command id and a chord. Listed as a registration because that is what it is to the host, but it needs no return path.",
  },

  // -- Browser --------------------------------------------------------------
  "browser.registerOmniboxProvider": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserOmniboxSuggest", "browserOmniboxRun"],
  },
  "browser.registerDownloadHandler": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserDownload"],
  },
  "browser.registerHistoryFilter": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserHistoryFilter"],
  },
  "browser.registerContextMenuItem": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserContextMenu"],
  },
  "browser.registerTabAction": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserTabAction"],
  },
  "browser.registerSearchEngine": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: [],
    note: "Data only — an id, a name and a URL template. The browser formats the template itself, which is what keeps Enter synchronous.",
  },
  "browser.registerPageStyle": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: [],
    note: "Data only, and the first registration whose scope is a list of sites rather than a capability: the css and the matched patterns cross once at load, and nothing is asked of the plugin as the user browses.",
  },
  "browser.registerPageScript": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: [],
    note: "Data only on the way out — the source text and the matched patterns cross once at load, and this process never evaluates them. What the script calls back into is the plugin's own rpc, which already has a channel of its own.",
  },
  "browser.registerSiteInfoProvider": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserSiteInfo"],
  },
  "ui.registerCommand": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["uiCommand"],
    note: "A command of the plugin's own rather than a rebinding of one of Patcher's, so the chord and the title cross with the registration and the press comes back as a callback. Context-free by design — what the command reads, it reads through the gated browser calls.",
  },
  "browser.registerNewTabWidget": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserNewTabRows"],
  },
  "browser.registerToolbarItem": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserToolbarState", "browserToolbarRun"],
    note: "Two callbacks for one registration: what the control looks like for a page, asked as the user navigates, and what pressing it does. `state` is optional, and a registration without one crosses with no state callback at all.",
  },
  "browser.registerFindAction": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserFindAction"],
  },
  "browser.registerAuthProvider": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserAuth"],
  },
  "browser.registerPdfTextProvider": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserPdfText"],
  },
  "browser.registerExternalLinkHandler": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["browserExternalLink"],
  },
  "browser.getStatus": {
    category: "call",
    argsCross: true,
    resultCrosses: true,
    synchronousHostState: true,
    note: "Synchronous, because a plugin reads it from `patcher.agents.configure()` which cannot await. The plugin process holds a pushed copy rather than asking. Safe to be stale: it reports only whether a browser window is connected, and every command through it already fails with BrowserHostUnavailableError when one is not.",
  },
  "browser.<command>": {
    category: "call",
    argsCross: true,
    resultCrosses: true,
    cancellable: true,
    note: "Stands for every method under browser.tabs / page / navigation / storage / control / recording. One entry because they are one thing: a `BrowserCommand` union already travelling over a message bus to the app window. The per-command list is `permissionForBrowserCommand` in @patcher/domain, which is also what gates them.",
  },

  // -- Events, status, hosts ------------------------------------------------
  "events.on": {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["threadEvent"],
  },
  "status.needsConfiguration": {
    category: "notify",
    argsCross: true,
    resultCrosses: true,
  },
  onDispose: {
    category: "register",
    argsCross: true,
    resultCrosses: true,
    callbacks: ["dispose"],
    note: "The hook takes no arguments, so the registration is empty and the ordering is the whole content: LIFO, and the host waits for them before the plugin is gone.",
  },
} as const satisfies Record<string, PluginHostCallShape>;

export type PluginHostCallPath = keyof typeof PLUGIN_HOST_CALLS;

/** One entry, widened so its optional members are readable. */
export function hostCallShape(path: PluginHostCallPath): PluginHostCallShape {
  return PLUGIN_HOST_CALLS[path];
}

/**
 * The paths that do not yet cross. A transport has to answer for each of
 * these; the notes above say how.
 */
export function unresolvedHostCallPaths(): PluginHostCallPath[] {
  return (Object.keys(PLUGIN_HOST_CALLS) as PluginHostCallPath[]).filter(
    (path) =>
      !PLUGIN_HOST_CALLS[path].argsCross ||
      !PLUGIN_HOST_CALLS[path].resultCrosses,
  );
}

/**
 * The paths whose answer is host state read synchronously. Not a subset of
 * {@link unresolvedHostCallPaths}: their arguments and results serialise
 * perfectly well, which is exactly why they are easy to miss.
 */
export function synchronousHostStatePaths(): PluginHostCallPath[] {
  return (Object.keys(PLUGIN_HOST_CALLS) as PluginHostCallPath[]).filter(
    (path) => hostCallShape(path).synchronousHostState === true,
  );
}

/** Every server→plugin call some registration here produces. */
export function callbacksProducedByRegistrations(): Set<PluginCallbackKind> {
  const produced = new Set<PluginCallbackKind>();
  for (const path of Object.keys(PLUGIN_HOST_CALLS) as PluginHostCallPath[]) {
    // Through hostCallShape, because `as const satisfies` narrows each value
    // to its own literal type and the optional members disappear from it.
    for (const kind of hostCallShape(path).callbacks ?? []) {
      produced.add(kind);
    }
  }
  return produced;
}
