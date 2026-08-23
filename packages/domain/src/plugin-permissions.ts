import type {
  BrowserCommand,
  BrowserControlOperation,
  BrowserObservation,
} from "./browser-control.js";

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
export const PLUGIN_PERMISSIONS = [
  // -- Browser: reading -----------------------------------------------------
  /** Which tabs exist and where they point. */
  "tabs.read",
  /** What a page contains: text, selection, snapshot, screenshot, console. */
  "page.read",
  /** The network log of a browsed page, including request and response headers. */
  "network.observe",

  // -- Browser: acting ------------------------------------------------------
  /**
   * Open, close, activate and navigate tabs, and change a tab's own state —
   * pin it, mute it, duplicate it, move it along the strip.
   */
  "tabs.modify",
  /** Drive a page as a user would: click, type, scroll, answer its dialogs. */
  "page.interact",
  /** Run arbitrary JavaScript inside a browsed page. */
  "page.inject",
  /** Mock, redirect or block what a page's network requests return. */
  "network.intercept",
  /** Read and write a browsed site's cookies and storage — the user's logins. */
  "page.credentials",
  /** Film a tab and record a trace of what was driven. */
  "page.record",

  // -- Browser: contributions -----------------------------------------------
  /** Answer address-bar queries — the provider sees everything typed there. */
  "omnibox.register",
  /** Add page context-menu entries, which receive the selection or link clicked. */
  "contextMenu.register",
  /** Add tab context-menu entries, which receive the tab they were picked on. */
  "tabMenu.register",
  /** Add find-bar buttons, which receive what the user is searching for. */
  "find.register",
  /** Add sections to the site-info popover, which receive the page's address. */
  "siteInfo.register",
  /**
   * Put a control in the browser's own toolbar, which is asked about the page in
   * every tab the user opens — the address is handed over on navigation, not on a
   * click, so this is a standing read of where the user goes.
   */
  "toolbar.register",
  /** Add a section to the new-tab screen. A new tab has no page, so nothing about
   * the user's browsing is disclosed — this buys the placement. */
  "newTab.register",
  /**
   * Apply the plugin's CSS to pages on the sites it declared in `patcher.sites`.
   *
   * The first permission whose answer is a *list of sites* rather than a
   * capability, and it has to be: styling one site the user named and styling
   * every site they visit are not the same risk, and one flag covering both would
   * say neither. It runs no plugin code in the page and reads nothing back, which
   * is what keeps the question down to "where".
   */
  "pageStyle.register",
  /**
   * Run the plugin's own code in the pages of the sites it declared in
   * `patcher.sites`, and let that code call the plugin's own rpc.
   *
   * Separate from `pageStyle.register` over the same list, because a stylesheet
   * and a program are not the same disclosure: this one reads the page — its
   * text, its form fields, whatever the signed-in user can see — and can carry
   * what it reads to the plugin's backend. Granting it for a site is granting
   * the plugin what a browser extension gets there.
   */
  "pageScript.register",
  /**
   * Offer a search engine for the address bar. Offering is not choosing — the
   * user picks one — but a chosen engine receives every word typed there.
   */
  "searchEngine.register",
  /** Handle files the browser downloaded, after they are written. */
  "downloads.handle",
  /** Supply credentials for a site's HTTP authentication challenge. */
  "auth.provide",
  /**
   * Decide where a link the *system* hands Patcher goes, when Patcher is the user's
   * default browser — rewrite it, or take it over entirely.
   *
   * Its own permission rather than part of `tabs.modify`, on the house rule the
   * rest of this group follows: what the holder *sees* is every address the user
   * opens from outside Patcher — Mail, Slack, a terminal — which is a standing read of
   * where the user goes, in the same class as `toolbar.register`. That it can
   * also redirect one is the smaller half.
   */
  "externalLink.handle",
  /** Supply the text of a PDF the browser could not read. */
  "pdf.provide",

  // -- Browser: history -----------------------------------------------------
  /**
   * The browsing history store: read it, search it, add to it, delete from it,
   * and see every visit before it is recorded
   * (`browser.registerHistoryFilter`).
   *
   * One permission rather than a read/write pair because neither gate that
   * enforces it sees the HTTP method — one keys on the `patcher.sdk` area, the other
   * on the URL prefix — so a read-only variant would be a boundary on paper
   * that `DELETE /browser-history/:id` walks straight through.
   */
  "history",

  // -- Host: patcher.sdk areas ---------------------------------------------------
  /** Read and drive agent threads (`sdk.threads`, `sdk.threadSections`). */
  "threads",
  /** Read and write files on the user's hosts (`sdk.files`). */
  "filesystem",
  /** Run commands in terminals on the user's hosts (`sdk.terminals`). */
  "shell",
  /** Projects, environments, hosts, providers, skills, system (`sdk.*`). */
  "workspace",
  /** Install, configure, enable and remove plugins (`sdk.plugins`). */
  "plugins",
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/**
 * A declared set in {@link PLUGIN_PERMISSIONS} order, de-duplicated.
 *
 * Declaration order belongs to whoever wrote the manifest; reported order is
 * ours, so two plugins granted the same things read the same everywhere they
 * are shown.
 */
export function canonicalPermissions(
  declared: readonly PluginPermission[] | undefined,
): readonly PluginPermission[] {
  const set = new Set(declared ?? []);
  return PLUGIN_PERMISSIONS.filter((permission) => set.has(permission));
}

/**
 * Which permission opens each `patcher.sdk` area, keyed by area name.
 *
 * Here rather than beside the server's gate because two hosts enforce it: the
 * Patcher server and `@patcher/plugin-sdk/testing`'s fake. A second copy would drift,
 * and a drifting copy is exactly how a plugin's tests start lying about what
 * its manifest needs.
 *
 * Per area rather than per method: an area is the unit the SDK hands out, and
 * a permission naming methods would need re-checking against every SDK
 * release. The cost is bluntness — `workspace` covers reads and writes alike.
 *
 * `subscribe` is deliberately absent: it is a single function whose argument
 * picks the feed, so it goes through {@link permissionForRealtimeEvent}.
 * Whether this covers every area is checked where `PatcherSdk` is in scope —
 * `@patcher/domain` cannot see that type.
 */
export const PLUGIN_SDK_AREA_PERMISSIONS = {
  browserHistory: "history",
  environments: "workspace",
  files: "filesystem",
  guide: "workspace",
  hosts: "workspace",
  plugins: "plugins",
  projects: "workspace",
  providers: "workspace",
  skills: "workspace",
  status: "workspace",
  system: "workspace",
  terminals: "shell",
  theme: "workspace",
  threadSections: "threads",
  threads: "threads",
  // `as const` so the literal keys survive: the coverage check in the server's
  // gate assigns this to a Record keyed by `keyof PatcherSdk`, and an index
  // signature would satisfy that vacuously.
} as const satisfies Record<string, PluginPermission>;

/**
 * Members whose area grant is not the whole price, because what they touch
 * straddles two areas. Keyed `area.method`; the listed permissions are needed
 * **in addition** to the area's own.
 *
 * The area is the wrong unit for these and there are only three, so they are
 * named rather than absorbed by making every area coarser:
 *
 * - `environments.archiveThreads` archives threads. `POST
 *   /environments/:id/archive-threads` is a workspace route by its path and a
 *   thread mutation by its effect.
 * - `threadSections.list` reads `GET /sidebar-bootstrap`, which answers with
 *   every project and its threads; the SDK keeps only `.sections`, but the
 *   response crossed the boundary whole and a plugin calling the route
 *   directly keeps all of it.
 * - `status.get` reads `GET /threads/:id`, its timeline and its children when
 *   given a `threadId`. Its area reads as workspace and most of what it
 *   returns is thread content.
 *
 * All three were invisible while the only gate was per area. They are listed
 * here so the HTTP gate and the `patcher.sdk` gate charge the same price — a plugin
 * that passes one and is refused by the other is the worst of both, and
 * `status.get` swallows its own request failures, so the mismatch there is a
 * silently empty answer rather than an error.
 */
export const PLUGIN_SDK_METHOD_EXTRA_PERMISSIONS = {
  "environments.archiveThreads": ["threads"],
  "status.get": ["threads"],
  "threadSections.list": ["workspace"],
} as const satisfies Record<string, readonly PluginPermission[]>;

/**
 * What a plugin must hold to reach a path under `/api/v1`.
 *
 * `patcher.sdk` is an HTTP client for this same API, and the server hands every
 * plugin the loopback URL, so gating only the JavaScript object gates only the
 * polite route in. This is the same decision expressed where it can survive a
 * plugin moving out of process — and once it does, this is the whole of the
 * RPC surface.
 *
 * Longest matching prefix wins, and an unmatched path is denied rather than
 * allowed: a route nobody classified is a route nobody thought about, and
 * `apiPathPermissionCoverage` in the server's tests fails on one.
 */
const API_PATH_PERMISSIONS: ReadonlyArray<
  readonly [prefix: string, permissions: readonly PluginPermission[]]
> = [
  ["/browser-history", ["history"]],
  ["/threads", ["threads"]],
  ["/thread-sections", ["threads"]],
  // A plugin reaching another plugin's own routes is ordinary HTTP, not
  // administration: those routes carry their own auth mode (local / token /
  // none), and `plugins` is about installing and configuring, not calling.
  // Empty means classified as costing nothing, which is not the same as
  // unclassified.
  ["/plugins/:id/http", []],
  ["/plugins/:id/rpc", []],
  ["/plugins/:id/assets", []],
  ["/files", ["filesystem"]],
  ["/file-previews", ["filesystem"]],
  ["/terminals", ["shell"]],
  ["/plugins", ["plugins"]],
  ["/projects", ["workspace"]],
  ["/environments", ["workspace"]],
  // Archives the environment's threads, which its path does not say.
  ["/environments/:id/archive-threads", ["workspace", "threads"]],
  ["/hosts", ["workspace"]],
  ["/system", ["workspace"]],
  ["/settings", ["workspace"]],
  ["/skills-registry", ["workspace"]],
  ["/plugin-catalog", ["plugins"]],
  // Answers with every project *and its threads*; the SDK reads only the
  // sections out of it, but the whole response crosses the boundary.
  ["/sidebar-bootstrap", ["workspace", "threads"]],
];

/**
 * The permissions a plugin needs for one `/api/v1` path, or `null` when the
 * path is not classified — which callers must treat as a refusal.
 *
 * `path` may carry the `/api/v1` prefix or not; concrete ids in place of
 * parameters match their pattern (`/threads/abc/send` matches `/threads`).
 */
export function permissionsForApiPath(
  path: string,
): readonly PluginPermission[] | null {
  const normalized = (
    path.startsWith("/api/v1") ? path.slice("/api/v1".length) : path
  ).replace(/\/+$/, "");
  let best: (typeof API_PATH_PERMISSIONS)[number] | undefined;
  for (const entry of API_PATH_PERMISSIONS) {
    // A pattern segment (":id") matches whatever the caller put there.
    const pattern = entry[0]
      .split("/")
      .map((segment) =>
        segment.startsWith(":") ? "[^/]+" : escapeSegment(segment),
      )
      .join("/");
    if (!new RegExp(`^${pattern}(/|$)`).test(normalized)) continue;
    if (best === undefined || entry[0].length > best[0].length) best = entry;
  }
  return best?.[1] ?? null;
}

function escapeSegment(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * What an entity's realtime traffic costs.
 *
 * Realtime is named twice — feeds are `thread:changed`, subscription targets
 * are `thread-detail` — and both reduce to the entity in front. The decision
 * lives here once so the two spellings cannot disagree about the same data.
 *
 * An unrecognised entity is charged `threads`, because the safe default for
 * something nobody classified is the more expensive one.
 */
export function permissionForRealtimeEntity(entity: string): PluginPermission {
  switch (entity) {
    case "project":
    case "environment":
    case "host":
    case "system":
    case "realtime":
      return "workspace";
    default:
      return "threads";
  }
}

/**
 * `sdk.subscribe` is the one member an area grant cannot cover: one of its
 * feeds is thread activity, and charging it to `workspace` would hand every
 * workspace plugin a live view of the user's threads.
 */
export function permissionForRealtimeEvent(event: string): PluginPermission {
  return permissionForRealtimeEntity(event.split(":")[0] ?? "");
}

/**
 * The same question asked of a subscription target, which is how a plugin
 * reaches the feed without going through `patcher.sdk` at all — the websocket is
 * not under `/api/v1`, so the HTTP gate never sees it.
 */
export function permissionForRealtimeTarget(kind: string): PluginPermission {
  return permissionForRealtimeEntity(kind.split("-")[0] ?? "");
}

/** Reading a tab: everything but the network log is what the page rendered. */
function permissionForObservation(
  kind: BrowserObservation["kind"],
): PluginPermission {
  switch (kind) {
    case "network":
      return "network.observe";
    case "screenshot":
    case "pdf":
    case "console":
      return "page.read";
  }
}

/**
 * Direct control of a tab, whose members are grouped by how much they hand
 * over: coordinate input is what a user could do anyway, arbitrary JavaScript
 * is not, and a mocked or severed network is neither.
 */
function permissionForControlOperation(
  kind: BrowserControlOperation["kind"],
): PluginPermission {
  switch (kind) {
    case "evaluate":
      return "page.inject";
    case "route-set":
    case "route-list":
    case "route-clear":
    case "offline":
      return "network.intercept";
    case "mouse-move":
    case "mouse-button":
    case "mouse-wheel":
      return "page.interact";
  }
}

/**
 * The permission one browser command needs.
 *
 * Exhaustive over `BrowserCommand["type"]` and over both sub-unions that split
 * on purpose: adding a command or an operation without deciding what it costs
 * stops compiling here, which is the only place that decision can be
 * forgotten.
 */
export function permissionForBrowserCommand(
  command: BrowserCommand,
): PluginPermission {
  switch (command.type) {
    case "tabs.list":
    case "page.get_url":
    case "page.get_title":
      return "tabs.read";
    case "tabs.open":
    case "tabs.close":
    case "tabs.activate":
    // Pinning, muting and duplicating are the strip's own doing rather than the
    // page's: none of them reaches into what a page contains, and all three are
    // things the user does from the tab's menu. Same permission as opening one.
    case "tabs.pin":
    case "tabs.mute":
    case "tabs.duplicate":
    case "tabs.move":
    case "navigation.open":
    case "navigation.back":
    case "navigation.forward":
    case "navigation.reload":
      return "tabs.modify";
    case "page.get_text":
    case "page.get_selection":
    case "page.snapshot":
      return "page.read";
    case "page.interact":
    case "page.handle_dialog":
    // Zoom is a user-level change to how the page is presented — less than a
    // click, and reachable by anyone who can already click. Charging it to the
    // same permission keeps it from being a cheaper way to change what the user
    // sees. It is not free: Chromium remembers zoom per site, so a plugin
    // setting it here decides what that site looks like next time.
    case "page.zoom":
      return "page.interact";
    case "page.observe":
      return permissionForObservation(command.observation.kind);
    case "page.storage":
      return "page.credentials";
    case "page.control":
      return permissionForControlOperation(command.operation.kind);
    case "page.record":
      return "page.record";
  }
}
