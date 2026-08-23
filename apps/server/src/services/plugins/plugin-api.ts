import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import type Database from "better-sqlite3";
import type { z } from "zod";
/**
 * The two host-owned stores `patcher` reads through, injected rather than reached.
 *
 * They were `db: DbConnection` until the plugin boundary needed this object to
 * build in a plugin's own process too, where there is no patcher.db to open — and
 * where opening one would be the wrong answer anyway. Everything else about
 * these members stays here: the JSON round-trip, the 256KB limit, the error
 * text. Only the last inch is swapped, so the two sides of the boundary cannot
 * disagree about what `patcher.storage.kv` means.
 *
 * Values are raw JSON strings on purpose. Parsing them here keeps
 * `JSON.parse`'s exact failure mode on the plugin's side of any transport.
 */
export interface PluginKvStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, json: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string | undefined): Promise<string[]>;
}

export type PluginSettingsReader = (
  descriptors: PluginSettingDescriptors,
) => Promise<Record<string, unknown>>;
// By subpath, not through `@patcher/domain`'s index, and the reason is measured:
// this module is the one every plugin process loads, and the index runs every
// schema in the package at import time — ~57MB resident, against ~25MB for the
// three files anything here actually uses.
// See apps/server/scripts/measure-plugin-host.mjs.
import type {
  BrowserCommand,
  BrowserCommandValue,
  BrowserControlOperation,
  BrowserRecordOperation,
  BrowserCookie,
  BrowserInteraction,
  BrowserStorageItem,
} from "@patcher/domain/browser-control";
import { PLUGIN_INTERACTION_MAX_TITLE_LENGTH } from "@patcher/domain/plugin-interaction-limits";
import {
  BROWSER_PAGE_STYLE_ID_PATTERN,
  BROWSER_PAGE_STYLE_MAX_CSS_LENGTH,
  BROWSER_PAGE_STYLE_MAX_ID_LENGTH,
  BROWSER_PAGE_STYLE_MAX_MATCHES,
} from "@patcher/domain/browser-page-style";
import {
  BROWSER_PAGE_SCRIPT_ID_PATTERN,
  BROWSER_PAGE_SCRIPT_MAX_CODE_LENGTH,
  BROWSER_PAGE_SCRIPT_MAX_ID_LENGTH,
  BROWSER_PAGE_SCRIPT_MAX_MATCHES,
} from "@patcher/domain/browser-page-script";
import {
  BROWSER_SEARCH_ENGINE_ID_PATTERN,
  BROWSER_SEARCH_ENGINE_MAX_ID_LENGTH,
  BROWSER_SEARCH_ENGINE_MAX_NAME_LENGTH,
  BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER,
  normalizeBrowserSearchEngineTemplate,
  type BrowserSearchEngine,
} from "@patcher/domain/browser-search-engine";
import type {
  AppKeybindingOverride,
  AppKeybindingOverrides,
} from "@patcher/domain/app-keybindings";
import {
  permissionForBrowserCommand,
  type PluginPermission,
} from "@patcher/domain/plugin-permissions";
import type { JsonValue } from "@patcher/domain/json-value";
import type {
  PatcherPluginApi,
  PluginAgentConfiguration,
  PluginAgentConfigurationContext,
  PluginAgentToolContext,
  PluginAgentToolExperimentalStatusLabels,
  PluginAgentToolResult,
  PluginAgents,
  PluginBackground,
  PluginCli,
  PluginCliCommandInfo,
  PluginCliContext,
  PluginCliResult,
  PluginEvents,
  PluginHttp,
  PluginHttpAuthMode,
  PluginHttpHandler,
  PluginKvStorage,
  PluginLogger,
  PluginBrowser,
  PluginBrowserCallOptions,
  PluginBrowserRoutes,
  PluginBrowserVideo,
  PluginMentionItem,
  PluginMentionSearchContext,
  PluginMentionTrigger,
  PluginBrowserAuthProvider,
  PluginBrowserExternalLinkHandler,
  PluginBrowserPdfTextProvider,
  PluginBrowserContextMenuContext,
  PluginBrowserFindContext,
  PluginBrowserSiteInfoContext,
  PluginBrowserSiteInfoRow,
  PluginBrowserTabActionContext,
  PluginBrowserToolbarContext,
  PluginBrowserToolbarState,
  PluginBrowserNewTabContext,
  PluginBrowserNewTabRow,
  PluginBrowserDownloadHandler,
  PluginBrowserHistoryFilter,
  PluginOmniboxRunContext,
  PluginOmniboxRunResult,
  PluginOmniboxSuggestContext,
  PluginOmniboxSuggestion,
  PluginRealtime,
  PluginRpc,
  PluginRpcMethodContract,
  PluginServerApi,
  PluginSettingDescriptors,
  PluginSettingValue,
  PluginSettings,
  PluginSettingsValues,
  PluginStatusApi,
  PluginStorage,
  PluginThreadEventHandler,
  PluginThreadEventName,
  PluginUi,
  StandardSchemaV1,
} from "@patcher/plugin-sdk";
import type { PatcherSdk, ThreadForkArgs, ThreadSpawnArgs } from "@patcher/sdk";
import type { ServerLogger } from "../../types.js";
import type { PluginInteractionResult } from "../interactions/pending-interactions.js";
import { appendPluginLogLine } from "./plugin-log.js";
import {
  applySdkPermissions,
  createPluginPermissionGate,
  type PluginPermissionGate,
} from "./plugin-permission-gate.js";
// The descriptor half, deliberately: plugin-settings.ts also reads and writes
// values, which needs the database — and this module is loaded in every plugin
// process, where that would be ~60MB of native machinery for a validator.
import { registerSettingDescriptors } from "./plugin-setting-descriptors.js";

// The backend plugin API contract lives in @patcher/plugin-sdk (plugin authors
// compile against it); this module implements it. Re-exported so server code
// keeps one import site for plugin API types.
export type {
  PatcherPluginApi,
  PluginAgentConfiguration,
  PluginAgentConfigurationContext,
  PluginAgentToolContentPart,
  PluginAgentToolContext,
  PluginAgentToolExperimentalStatusLabels,
  PluginAgentToolRegistrationBase,
  PluginAgentToolResult,
  PluginAgents,
  PluginBackground,
  PluginCli,
  PluginCliCommandInfo,
  PluginCliContext,
  PluginCliRegistration,
  PluginCliResult,
  PluginEvents,
  PluginHttp,
  PluginHttpAuthMode,
  PluginHttpHandler,
  PluginKvStorage,
  PluginLogger,
  PluginMentionItem,
  PluginMentionProviderRegistration,
  PluginMentionSearchContext,
  PluginMentionTrigger,
  PluginBrowserDownloadHandler,
  PluginBrowserExternalLink,
  PluginBrowserExternalLinkDecision,
  PluginBrowserExternalLinkHandler,
  PluginBrowserHistoryFilter,
  PluginBrowserHistoryRewrite,
  PluginBrowserHistoryVisit,
  PluginOmniboxProviderRegistration,
  PluginOmniboxRunContext,
  PluginOmniboxRunResult,
  PluginOmniboxSuggestContext,
  PluginOmniboxSuggestion,
  PluginRealtime,
  PluginRpc,
  PluginRpcContract,
  PluginRpcError,
  PluginRpcErrorCode,
  PluginRpcHandlers,
  PluginRpcMethodContract,
  PluginRpcValidationIssue,
  PluginServerApi,
  PluginSettings,
  PluginSettingsHandle,
  PluginSettingsValues,
  PluginStatusApi,
  PluginStorage,
  PluginThreadEventHandler,
  PluginThreadEventName,
  PluginThreadEventPayloads,
  PluginUi,
  StandardSchemaV1,
} from "@patcher/plugin-sdk";

/**
 * Thrown when a plugin calls into an API handle that has been invalidated by
 * reload/disable (pi's stale-context discipline): captured `patcher` references
 * from a previous load fail loudly instead of acting on dead state.
 */
export class PluginContextStaleError extends Error {
  constructor(pluginId: string) {
    super(
      `plugin "${pluginId}" used a stale API handle — it was reloaded or disabled; ` +
        `re-entry happens via a fresh factory call`,
    );
    this.name = "PluginContextStaleError";
  }
}

/**
 * Thrown from a background service's `start()` to mark the plugin
 * `needs-configuration` (e.g. no API key yet) instead of crash-looping: the
 * service is not restarted until the plugin is reloaded or its settings are
 * saved (which reloads it). Matched by name too, so plugin code without a
 * runtime import can `throw Object.assign(new Error(msg), { name:
 * "NeedsConfigurationError" })`.
 */
export class NeedsConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NeedsConfigurationError";
  }
}

export function isNeedsConfigurationError(error: unknown): error is Error {
  return error instanceof Error && error.name === "NeedsConfigurationError";
}

/** JSON values ≤256KB; larger writes are rejected with a clear error. */
const KV_VALUE_MAX_BYTES = 256 * 1024;

/**
 * Defaults for the observation calls. A log limit of 100 is a page's worth of
 * chatter without being a wall of it; JPEG at 80 is the quality where a page
 * screenshot stops looking compressed, and the format that keeps one from
 * costing megabytes.
 */
const DEFAULT_BROWSER_LOG_LIMIT = 100;
const DEFAULT_SCREENSHOT_QUALITY = 80;

function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  if (typeof value !== "object" || value === null) return false;
  const standard = Reflect.get(value, "~standard");
  return (
    typeof standard === "object" &&
    standard !== null &&
    Reflect.get(standard, "version") === 1 &&
    typeof Reflect.get(standard, "vendor") === "string" &&
    typeof Reflect.get(standard, "validate") === "function"
  );
}

function readRpcMethodContract(
  method: string,
  value: unknown,
): PluginRpcMethodContract {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `rpc method "${method}" contract must provide input and output Standard Schemas`,
    );
  }
  const input = Reflect.get(value, "input");
  const output = Reflect.get(value, "output");
  if (!isStandardSchema(input)) {
    throw new Error(
      `rpc method "${method}" input must be a Standard Schema v1 validator`,
    );
  }
  if (!isStandardSchema(output)) {
    throw new Error(
      `rpc method "${method}" output must be a Standard Schema v1 validator`,
    );
  }
  return { input, output };
}

/** Per-event handler lists recorded by `patcher.events.on`; dropped with the handle. */
export type PluginThreadEventHandlers = {
  [E in PluginThreadEventName]: Array<PluginThreadEventHandler<E>>;
};

/**
 * Wire surfaces (design §4.6/§4.7). Registration is load-safe: routes and
 * rpc handlers are recorded on the handle; the boot-time dispatcher in
 * routes/plugins.ts looks them up live per request, so reload swaps them
 * without touching Hono's routing table.
 */
export interface PluginHttpRouteRecord {
  /** Uppercased HTTP method. */
  method: string;
  /** Exact-match path starting with "/" (no params/wildcards in V1). */
  path: string;
  auth: PluginHttpAuthMode;
  handler: PluginHttpHandler;
}

/** Runtime shape of a registered rpc method; inputs arrive JSON-parsed. */
export interface PluginRpcHandler {
  inputSchema: StandardSchemaV1;
  outputSchema: StandardSchemaV1;
  handler: (input: never) => unknown;
}

/** Runtime record of a registered native tool. */
export interface PluginAgentToolRecord {
  name: string;
  description: string;
  /** Native timeline labels, null when the standard Patcher title should render. */
  experimentalStatusLabels: PluginAgentToolExperimentalStatusLabels | null;
  /** Instructions snippet for the thread-instructions assembly; null when
   * the registration carried none (description-only). */
  instructions: string | null;
  /** JSON-schema object sent to providers as the tool's input schema. */
  inputSchema: unknown;
  /** Validates raw arguments: zod-backed for zod registrations,
   * pass-through for raw JSON-schema ones. */
  parse(
    input: unknown,
  ): { ok: true; value: unknown } | { ok: false; error: string };
  execute(
    params: unknown,
    ctx: PluginAgentToolContext,
  ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
}

/**
 * Core `patcher` CLI top-level command names (plus commander's built-in help).
 * Plugin CLI commands may not shadow these. Maintained by hand — kept in
 * sync with apps/cli/src/index.ts by
 * apps/cli/src/__tests__/plugin-cli-proxy.test.ts.
 */
export const RESERVED_PATCHER_CLI_COMMANDS: readonly string[] = [
  // "automation" is intentionally absent: the builtin automations plugin owns it.
  "environment",
  "guide",
  "help",
  "manager",
  "plugin",
  "project",
  "provider",
  "skill",
  "status",
  "theme",
  "thread",
];

/**
 * Built-in dynamic tool names plugins may not shadow. Maintained by hand —
 * kept in sync with the built-in tools in
 * services/threads/thread-runtime-config.ts by
 * test/services/plugins/plugin-agent-tools.test.ts.
 */
export const RESERVED_AGENT_TOOL_NAMES: readonly string[] = [
  "update_environment_directory",
];

/** Runtime record of a registered mention provider. */
export interface PluginMentionProviderRecord {
  id: string;
  label: string;
  triggers: readonly PluginMentionTrigger[];
  search: (
    ctx: PluginMentionSearchContext,
  ) => PluginMentionItem[] | Promise<PluginMentionItem[]>;
  resolve: (
    itemId: string,
  ) => { context: string } | Promise<{ context: string }>;
}

/** Runtime record of a registered omnibox provider. */
export interface PluginOmniboxProviderRecord {
  id: string;
  label: string;
  suggest: (
    ctx: PluginOmniboxSuggestContext,
  ) => PluginOmniboxSuggestion[] | Promise<PluginOmniboxSuggestion[]>;
  /** Null when the provider registered no `run` handler. */
  run:
    | ((
        itemId: string,
        ctx: PluginOmniboxRunContext,
      ) =>
        | PluginOmniboxRunResult
        | void
        | Promise<PluginOmniboxRunResult | void>)
    | null;
}

/** Runtime record of a registered background service. */
export interface PluginBackgroundServiceRecord {
  name: string;
  start: (signal: AbortSignal) => void | Promise<void>;
}

/** Runtime record of a registered schedule; cron is validated at registration. */
export interface PluginScheduleRecord {
  name: string;
  cron: string;
  fn: () => void | Promise<void>;
}

/** Validated record of the plugin's `patcher.cli.register` call. */
export interface PluginCliRegistrationRecord {
  name: string;
  summary: string;
  commands: PluginCliCommandInfo[];
  run: (
    argv: string[],
    ctx: PluginCliContext,
  ) => PluginCliResult | Promise<PluginCliResult>;
}

const PLUGIN_HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

// Rpc method names become URL path segments.
const RPC_METHOD_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Service/schedule names appear in status text and plugin_schedules rows.
const BACKGROUND_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

// CLI command names become `patcher <name>` invocations.
const CLI_COMMAND_NAME_PATTERN = /^[a-z0-9-]+$/;

// Agent tool names are shown to (and called by) the model.
const AGENT_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS = 4096;
/** Status labels ride on every tool-call event and share one timeline row. */
const PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS = 80;

// Thread action ids become URL path segments.

// Mention provider ids prefix wire item ids ("<providerId>:<itemId>"), so
// ":" is excluded to keep the split unambiguous.
const MENTION_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const OMNIBOX_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
export const PLUGIN_MENTION_TRIGGER_VALUES = [
  "@",
  "#",
  "$",
  "!",
  "~",
] as const satisfies readonly PluginMentionTrigger[];
const DEFAULT_PLUGIN_MENTION_TRIGGERS = [
  "@",
] as const satisfies readonly PluginMentionTrigger[];

function isPluginMentionTrigger(value: unknown): value is PluginMentionTrigger {
  return (
    typeof value === "string" &&
    (PLUGIN_MENTION_TRIGGER_VALUES as readonly string[]).includes(value)
  );
}

function normalizeMentionProviderTriggers(
  providerId: string,
  triggers: unknown,
): readonly PluginMentionTrigger[] {
  if (triggers === undefined) {
    return DEFAULT_PLUGIN_MENTION_TRIGGERS;
  }
  if (!Array.isArray(triggers)) {
    throw new Error(
      `mention provider "${providerId}" triggers must be an array`,
    );
  }
  if (triggers.length === 0) {
    throw new Error(
      `mention provider "${providerId}" triggers must include at least one trigger`,
    );
  }
  const seen = new Set<PluginMentionTrigger>();
  const normalized: PluginMentionTrigger[] = [];
  for (const trigger of triggers) {
    if (!isPluginMentionTrigger(trigger)) {
      throw new Error(
        `mention provider "${providerId}" trigger ${JSON.stringify(trigger)} is invalid; use one of ${PLUGIN_MENTION_TRIGGER_VALUES.join(" ")}`,
      );
    }
    if (seen.has(trigger)) {
      throw new Error(
        `mention provider "${providerId}" trigger ${JSON.stringify(trigger)} is duplicated`,
      );
    }
    seen.add(trigger);
    normalized.push(trigger);
  }
  return normalized;
}

export type PluginSettingsListener = (
  next: Record<string, PluginSettingValue | undefined>,
  prev: Record<string, PluginSettingValue | undefined>,
) => void;

export interface PluginApiHandle {
  api: PatcherPluginApi;
  /** Dispose hooks in registration order (runner executes them LIFO). */
  disposeHooks: Array<() => void | Promise<void>>;
  /** Settings schema + change listeners recorded by `settings.define`. */
  settings: {
    descriptors: PluginSettingDescriptors;
    listeners: PluginSettingsListener[];
  };
  /** Every database handle vended by `storage.database()`; closed on dispose. */
  databaseHandles: Database.Database[];
  /** Thread lifecycle handlers recorded by `patcher.events.on`. */
  threadEventHandlers: PluginThreadEventHandlers;
  /** HTTP routes recorded by `patcher.http.route`; dropped with the handle. */
  httpRoutes: PluginHttpRouteRecord[];
  /** RPC handlers recorded by `patcher.rpc.register`; dropped with the handle. */
  rpcHandlers: Map<string, PluginRpcHandler>;
  /** Background services recorded by `patcher.background.service`. */
  backgroundServices: PluginBackgroundServiceRecord[];
  /** Schedules recorded by `patcher.background.schedule`. */
  schedules: PluginScheduleRecord[];
  /** The plugin's CLI command (`patcher.cli.register`); null when none. */
  cli: { registration: PluginCliRegistrationRecord | null };
  /** Native tools recorded by `patcher.agents.registerTool`. */
  agentTools: PluginAgentToolRecord[];
  /** Per-resolution selector from `patcher.agents.configure` (at most one). */
  agentConfigurationProvider: PluginAgentConfigurationProvider | null;
  /**
   * Dynamic thread-instructions provider from
   * `patcher.agents.contributeInstructions` (at most one; null when none).
   */
  instructionProvider: PluginInstructionProvider | null;
  /** Mention providers recorded by `patcher.ui.registerMentionProvider`. */
  mentionProviders: PluginMentionProviderRecord[];
  /** Omnibox providers recorded by `patcher.browser.registerOmniboxProvider`. */
  omniboxProviders: PluginOmniboxProviderRecord[];
  /** Download handlers recorded by `patcher.browser.registerDownloadHandler`. */
  downloadHandlers: PluginBrowserDownloadHandler[];
  /** Keybindings recorded by `patcher.ui.registerKeybinding`. */
  keybindings: AppKeybindingOverrides;
  /** Context-menu items recorded by `patcher.browser.registerContextMenuItem`. */
  contextMenuItems: PluginBrowserContextMenuItemRecord[];
  /** Find-bar buttons recorded by `patcher.browser.registerFindAction`. */
  findActions: PluginBrowserFindActionRecord[];
  /** Tab-menu entries recorded by `patcher.browser.registerTabAction`. */
  tabActions: PluginBrowserTabActionRecord[];
  /** Site-info sections recorded by `patcher.browser.registerSiteInfoProvider`. */
  siteInfoProviders: PluginBrowserSiteInfoProviderRecord[];
  /** Toolbar controls recorded by `patcher.browser.registerToolbarItem`. */
  toolbarItems: PluginBrowserToolbarItemRecord[];
  /** New-tab sections recorded by `patcher.browser.registerNewTabWidget`. */
  newTabWidgets: PluginBrowserNewTabWidgetRecord[];
  /** Commands recorded by `patcher.ui.registerCommand`. */
  commands: PluginCommandRecord[];
  /** Search engines recorded by `patcher.browser.registerSearchEngine`. */
  searchEngines: BrowserSearchEngine[];
  /** Page styles recorded by `patcher.browser.registerPageStyle`. */
  pageStyles: PluginBrowserPageStyleRecord[];
  /** Page scripts recorded by `patcher.browser.registerPageScript`. */
  pageScripts: PluginBrowserPageScriptRecord[];
  /** Auth providers recorded by `patcher.browser.registerAuthProvider`. */
  authProviders: PluginBrowserAuthProvider[];
  /** PDF text providers recorded by `patcher.browser.registerPdfTextProvider`. */
  pdfTextProviders: PluginBrowserPdfTextProvider[];
  /**
   * External-link handlers recorded by
   * `patcher.browser.registerExternalLinkHandler`.
   */
  externalLinkHandlers: PluginBrowserExternalLinkHandler[];
  /** History filters recorded by `patcher.browser.registerHistoryFilter`. */
  historyFilters: PluginBrowserHistoryFilter[];
  /** Publish factory-time host declarations and status only after commit. */
  activate(): void;
  /** Poison every method on the handle. */
  invalidate(): void;
}

/** Runtime shape of a `patcher.browser.registerContextMenuItem` registration. */
export interface PluginBrowserContextMenuItemRecord {
  id: string;
  title: string;
  when: { image: boolean; link: boolean; page: boolean; selection: boolean };
  run: (context: PluginBrowserContextMenuContext) => void | Promise<void>;
}

/** Runtime shape of a `patcher.browser.registerFindAction` registration. */
export interface PluginBrowserFindActionRecord {
  id: string;
  title: string;
  run: (context: PluginBrowserFindContext) => void | Promise<void>;
}

/** Runtime shape of a `patcher.browser.registerTabAction` registration. */
export interface PluginBrowserTabActionRecord {
  id: string;
  title: string;
  run: (context: PluginBrowserTabActionContext) => void | Promise<void>;
}

/**
 * Runtime shape of a `patcher.browser.registerToolbarItem` registration. `state` is
 * null when the plugin did not offer one — the host then asks nothing as the user
 * browses, which is the difference worth keeping visible on the wire.
 */
export interface PluginBrowserToolbarItemRecord {
  id: string;
  title: string;
  icon: string | null;
  state:
    | ((
        context: PluginBrowserToolbarContext,
      ) =>
        | PluginBrowserToolbarState
        | null
        | Promise<PluginBrowserToolbarState | null>)
    | null;
  run: (context: PluginBrowserToolbarContext) => void | Promise<void>;
}

/**
 * Runtime shape of a `patcher.browser.registerPageStyle` registration. `matches` is
 * already checked against the plugin's declared `patcher.sites`, so everything
 * downstream can apply it without re-deciding what the plugin may reach.
 */
export interface PluginBrowserPageStyleRecord {
  id: string;
  matches: string[];
  css: string;
}

/**
 * Runtime shape of a `patcher.browser.registerPageScript` registration. `matches` is
 * checked against `patcher.sites` by the same rule as a page style's, so nothing
 * downstream re-decides where this code may run — and `code` is text all the way
 * to the page, never evaluated in this process.
 */
export interface PluginBrowserPageScriptRecord {
  id: string;
  matches: string[];
  code: string;
}

/** Runtime shape of a `patcher.browser.registerNewTabWidget` registration. */
export interface PluginBrowserNewTabWidgetRecord {
  id: string;
  label: string;
  rows: (
    context: PluginBrowserNewTabContext,
  ) =>
    | PluginBrowserNewTabRow[]
    | null
    | Promise<PluginBrowserNewTabRow[] | null>;
}

/**
 * Runtime shape of a `patcher.ui.registerCommand` registration. The shortcut is
 * normalised here — every modifier explicit — because the app matches against it
 * and a missing boolean would read as "chord with no modifier".
 */
export interface PluginCommandRecord {
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
  run: () => void | Promise<void>;
}

/** Runtime shape of a `patcher.browser.registerSiteInfoProvider` registration. */
export interface PluginBrowserSiteInfoProviderRecord {
  id: string;
  label: string;
  describe: (
    context: PluginBrowserSiteInfoContext,
  ) =>
    | PluginBrowserSiteInfoRow[]
    | null
    | Promise<PluginBrowserSiteInfoRow[] | null>;
}

/** Provider registered by `patcher.agents.contributeInstructions`. */
export type PluginInstructionProvider = (ctx: {
  threadId: string;
  projectId: string;
}) => string | null;

/** Provider registered by `patcher.agents.configure`. */
export type PluginAgentConfigurationProvider = (
  context: PluginAgentConfigurationContext,
) => PluginAgentConfiguration;

/** Duck-typed zod detection: plugin sources may carry their own zod copy,
 * so instanceof is useless — anything with safeParse is treated as zod. */
/**
 * The site patterns one page contribution may use, or a refusal naming the list
 * it has to pick from.
 *
 * Shared by page styles and page scripts because this is the rule the whole
 * consent model rests on, and two copies of it could drift: `matches` must be a
 * **member** of what the manifest declared, verbatim. Not a subset by glob — "is
 * this pattern inside that one" is a question with no answer worth trusting code
 * on a signed-in page to, and the manifest is the line a human read before
 * installing.
 */
function resolveDeclaredMatches(args: {
  kind: string;
  id: string;
  matches: unknown;
  maxMatches: number;
  declared: readonly string[];
  pluginId: string;
}): string[] {
  const { kind, id, matches, maxMatches, declared, pluginId } = args;
  if (
    !Array.isArray(matches) ||
    matches.length === 0 ||
    matches.length > maxMatches
  ) {
    throw new Error(
      `${kind} "${id}" must match between 1 and ${maxMatches} of the plugin's declared sites`,
    );
  }
  for (const pattern of matches) {
    if (typeof pattern !== "string" || !declared.includes(pattern)) {
      throw new Error(
        `${kind} "${id}" matches ${JSON.stringify(pattern)}, which plugin "${pluginId}" does not declare in "patcher.sites". ` +
          (declared.length === 0
            ? `That list is empty — add the site there, then run \`patcher plugin reload ${pluginId}\`.`
            : `It declares: ${declared.join(", ")}.`),
      );
    }
  }
  return [...(matches as string[])];
}

function isZodSchemaLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

/** Compact issue summary from a (possibly foreign-instance) zod error. */
function summarizeParseIssues(error: unknown): string {
  const issues = (
    error as { issues?: Array<{ path?: PropertyKey[]; message?: string }> }
  )?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return issues
      .map((issue) => {
        const path =
          Array.isArray(issue.path) && issue.path.length > 0
            ? issue.path.join(".")
            : "(input)";
        return `${path}: ${issue.message ?? "invalid"}`;
      })
      .join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Wrap the shared server-bound SDK for one plugin: thread creation gets
 * default attribution (`origin: "plugin"`, `originPluginId: <plugin id>`)
 * unless the plugin sets those fields explicitly.
 */
function wrapSdkForPlugin(
  sdk: PatcherSdk,
  pluginId: string,
  gate: PluginPermissionGate,
): PatcherSdk {
  // Attribution first, then the gate: a denied `threads` area replaces this
  // wrapper wholesale, and doing it the other way round would hand the plugin
  // an attribution wrapper over a proxy that throws on every read.
  const attributed: PatcherSdk = {
    ...sdk,
    threads: {
      ...sdk.threads,
      fork(args: ThreadForkArgs) {
        const origin = args.origin ?? "plugin";
        return sdk.threads.fork({
          ...args,
          origin,
          ...(origin === "plugin"
            ? { originPluginId: args.originPluginId ?? pluginId }
            : {}),
        });
      },
      spawn(args: ThreadSpawnArgs) {
        const origin = args.origin ?? "plugin";
        return sdk.threads.spawn({
          ...args,
          origin,
          ...(origin === "plugin"
            ? { originPluginId: args.originPluginId ?? pluginId }
            : {}),
        });
      },
    },
  };
  return applySdkPermissions(attributed, pluginId, gate);
}

export function createPluginApi(options: {
  pluginId: string;
  /**
   * What `patcher.permissions` declared. Absent or empty denies everything gated —
   * there is no legacy "everything" mode, see ./plugin-permission-gate.ts.
   */
  permissions: readonly PluginPermission[] | undefined;
  /**
   * What `patcher.sites` declared: the websites this plugin's page contributions may
   * reach. Absent or empty reaches none, so a `registerPageStyle` or
   * `registerPageScript` call with nothing declared is refused rather than
   * silently applying nowhere.
   */
  sites: readonly string[] | undefined;
  logger: ServerLogger;
  /** `patcher.storage.kv`'s rows; db-backed in the server, a channel call in a
   * plugin process. See {@link PluginKvStore}. */
  kvStore: PluginKvStore;
  /** Resolves declared settings to their current values, secrets included. */
  readSettingsValues: PluginSettingsReader;
  dataDir: string;
  /** Undefined until the server is listening (patcher.sdk is bind-gated). */
  getSdk: () => PatcherSdk | undefined;
  /** Undefined until the server is listening (patcher.server is bind-gated too). */
  getLoopbackBaseUrl: () => string | undefined;
  /** Broadcasts a plugin-signal WS message (hub.notifyPluginSignal). */
  publishSignal: (channel: string, payload: unknown) => void;
  /** Marks the plugin needs-configuration in the loader's status table. */
  reportNeedsConfiguration: (message: string) => void;
  /** Returns the owning plugin id when another plugin already registered
   * this agent tool name (cross-plugin collisions lose, design §4.4). */
  isAgentToolNameTaken: (name: string) => string | undefined;
  /** Records an agent-tool registration problem as the plugin's status
   * detail; the plugin itself keeps running. */
  reportAgentToolProblem: (message: string) => void;
  requestInteraction: (args: {
    threadId: string;
    rendererId: string;
    title: string;
    payload: JsonValue;
    timeoutMs: number;
    signal?: AbortSignal;
  }) => Promise<PluginInteractionResult>;
  /** Performs one `patcher.browser.*` command in the connected app window. */
  requestBrowserCommand: (args: {
    command: BrowserCommand;
    timeoutMs?: number;
    signal?: AbortSignal;
  }) => Promise<BrowserCommandValue>;
  /** Whether any app window can serve browser commands right now. */
  getBrowserHostStatus: () => { connected: boolean; hostCount: number };
}): PluginApiHandle {
  const {
    pluginId,
    permissions,
    sites,
    logger,
    kvStore,
    readSettingsValues,
    dataDir,
    getSdk,
    getLoopbackBaseUrl,
    publishSignal,
    reportNeedsConfiguration,
    isAgentToolNameTaken,
    reportAgentToolProblem,
    requestInteraction,
    requestBrowserCommand,
    getBrowserHostStatus,
  } = options;
  const permissionGate = createPluginPermissionGate(pluginId, permissions);
  let invalidated = false;
  let activated = false;
  let wrappedSdk: PatcherSdk | undefined;
  let pendingNeedsConfiguration: string | null = null;
  const pendingAgentToolProblems: string[] = [];
  const disposeHooks: Array<() => void | Promise<void>> = [];
  const settingsRecord: PluginApiHandle["settings"] = {
    descriptors: {},
    listeners: [],
  };
  const databaseHandles: Database.Database[] = [];
  const threadEventHandlers: PluginThreadEventHandlers = {
    "thread.created": [],
    "thread.active": [],
    "thread.idle": [],
    "thread.failed": [],
    "thread.archived": [],
    "thread.deleted": [],
  };
  const httpRoutes: PluginHttpRouteRecord[] = [];
  const rpcHandlers = new Map<string, PluginRpcHandler>();
  const backgroundServices: PluginBackgroundServiceRecord[] = [];
  const schedules: PluginScheduleRecord[] = [];

  function assertLive(): void {
    if (invalidated) throw new PluginContextStaleError(pluginId);
  }

  const prefix = `[plugin:${pluginId}]`;
  // Every patcher.log line goes to the prefixed server log and, as JSONL, to the
  // per-plugin log file served by GET /plugins/:id/logs (`patcher plugin logs`).
  function emitLog(
    level: "debug" | "info" | "warn" | "error",
    message: string,
  ): void {
    logger[level](`${prefix} ${message}`);
    appendPluginLogLine(dataDir, pluginId, level, message);
  }
  const log: PluginLogger = {
    debug: (message) => emitLog("debug", message),
    info: (message) => emitLog("info", message),
    warn: (message) => emitLog("warn", message),
    error: (message) => emitLog("error", message),
  };

  async function requestInput(
    request: Parameters<PluginUi["requestInput"]>[0],
    requestOptions?: Parameters<PluginUi["requestInput"]>[1],
  ) {
    assertLive();
    if (!request || typeof request !== "object") {
      throw new Error("ui.requestInput requires an options object");
    }
    if (typeof request.threadId !== "string" || request.threadId.length === 0) {
      throw new Error("ui.requestInput threadId must be a non-empty string");
    }
    if (
      typeof request.rendererId !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(request.rendererId)
    ) {
      throw new Error(
        "ui.requestInput rendererId must use letters, digits, '-' or '_'",
      );
    }
    if (
      typeof request.title !== "string" ||
      request.title.trim().length === 0 ||
      request.title.trim().length > PLUGIN_INTERACTION_MAX_TITLE_LENGTH
    ) {
      throw new Error(
        `ui.requestInput title must be 1-${PLUGIN_INTERACTION_MAX_TITLE_LENGTH} characters`,
      );
    }
    let payload: JsonValue;
    try {
      const json = JSON.stringify(request.payload);
      if (json === undefined) throw new Error();
      if (Buffer.byteLength(json, "utf8") > 64 * 1024) {
        throw new Error("ui.requestInput payload exceeds 64 KiB");
      }
      payload = JSON.parse(json) as JsonValue;
    } catch (error) {
      if (error instanceof Error && error.message.includes("64 KiB"))
        throw error;
      throw new Error("ui.requestInput payload must be JSON-serializable");
    }
    const timeoutMs = request.timeoutMs ?? 10 * 60 * 1000;
    if (
      !Number.isInteger(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 60 * 60 * 1000
    ) {
      throw new Error(
        "ui.requestInput timeoutMs must be between 1 and 3600000",
      );
    }
    return requestInteraction({
      threadId: request.threadId,
      rendererId: request.rendererId,
      title: request.title.trim(),
      payload,
      timeoutMs,
      signal: requestOptions?.signal,
    });
  }

  const kv: PluginKvStorage = {
    async get(key) {
      assertLive();
      const raw = await kvStore.get(key);
      if (raw === undefined) return undefined;
      return JSON.parse(raw);
    },
    async set(key, value) {
      assertLive();
      const json = JSON.stringify(value);
      if (json === undefined) {
        throw new Error(`kv value for "${key}" is not JSON-serializable`);
      }
      const bytes = Buffer.byteLength(json, "utf8");
      if (bytes > KV_VALUE_MAX_BYTES) {
        throw new Error(
          `kv value for "${key}" is ${bytes} bytes; the limit is ${KV_VALUE_MAX_BYTES} (256KB). ` +
            `Store large data in storage.database() instead.`,
        );
      }
      await kvStore.set(key, json);
    },
    async delete(key) {
      assertLive();
      await kvStore.delete(key);
    },
    async list(kvPrefix) {
      assertLive();
      return kvStore.list(kvPrefix);
    },
  };

  const storage: PluginStorage = {
    kv,
    database() {
      assertLive();
      const dir = join(dataDir, "plugins", pluginId);
      mkdirSync(dir, { recursive: true });
      const database = new (loadBetterSqlite3())(join(dir, "data.db"));
      database.pragma("journal_mode = WAL");
      database.pragma("busy_timeout = 5000");
      databaseHandles.push(database);
      return database;
    },
    migrate(database, statements) {
      assertLive();
      database.exec(
        "CREATE TABLE IF NOT EXISTS _patcher_migrations (id INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)",
      );
      const applied = new Set(
        (
          database
            .prepare("SELECT id FROM _patcher_migrations")
            .all() as Array<{
            id: number;
          }>
        ).map((row) => row.id),
      );
      const record = database.prepare(
        "INSERT INTO _patcher_migrations (id, applied_at) VALUES (?, ?)",
      );
      database.transaction(() => {
        statements.forEach((statement, index) => {
          if (applied.has(index)) return;
          database.exec(statement);
          record.run(index, Date.now());
        });
      })();
    },
  };

  const settings: PluginSettings = {
    define(descriptors) {
      assertLive();
      const validated = registerSettingDescriptors(
        settingsRecord.descriptors,
        descriptors as Record<string, unknown>,
      );
      type Values = PluginSettingsValues<typeof descriptors>;
      return {
        async get() {
          assertLive();
          // The runtime record is untyped; the descriptor generics are the
          // real contract, re-applied at this boundary.
          return (await readSettingsValues(validated)) as Values;
        },
        onChange(listener) {
          assertLive();
          settingsRecord.listeners.push(listener as PluginSettingsListener);
        },
      };
    },
  };

  // Plugin sources are untyped at runtime (jiti-loaded TS): every wire
  // registration validates loudly instead of failing at dispatch time.
  const http: PluginHttp = {
    route(method, path, handler, opts) {
      assertLive();
      const normalizedMethod = String(method).toUpperCase();
      if (!PLUGIN_HTTP_METHODS.has(normalizedMethod)) {
        throw new Error(
          `invalid http method "${String(method)}" — use one of: ${[...PLUGIN_HTTP_METHODS].join(", ")}`,
        );
      }
      if (typeof path !== "string" || !path.startsWith("/")) {
        throw new Error(
          `http route path must be a string starting with "/", got ${JSON.stringify(path)}`,
        );
      }
      if (typeof handler !== "function") {
        throw new Error(
          `http route handler for ${normalizedMethod} ${path} must be a function`,
        );
      }
      const auth = opts?.auth ?? "local";
      if (auth !== "local" && auth !== "token" && auth !== "none") {
        throw new Error(
          `invalid auth mode "${String(auth)}" for ${normalizedMethod} ${path} — use "local", "token", or "none"`,
        );
      }
      if (
        httpRoutes.some(
          (route) => route.method === normalizedMethod && route.path === path,
        )
      ) {
        throw new Error(
          `http route ${normalizedMethod} ${path} is already registered`,
        );
      }
      httpRoutes.push({ method: normalizedMethod, path, auth, handler });
    },
  };

  const rpc: PluginRpc = {
    register(contract, handlers) {
      assertLive();
      if (
        typeof contract !== "object" ||
        contract === null ||
        Array.isArray(contract)
      ) {
        throw new Error("rpc.register contract must be an object");
      }
      if (
        typeof handlers !== "object" ||
        handlers === null ||
        Array.isArray(handlers)
      ) {
        throw new Error("rpc.register handlers must be an object");
      }

      const pending: Array<[string, PluginRpcHandler]> = [];
      const contractEntries = Object.entries(contract);
      const contractNames = new Set(contractEntries.map(([name]) => name));
      for (const extraName of Object.keys(handlers)) {
        if (!contractNames.has(extraName)) {
          throw new Error(
            `rpc handler "${extraName}" has no matching contract method`,
          );
        }
      }
      for (const [name, methodContractValue] of contractEntries) {
        if (!RPC_METHOD_PATTERN.test(name)) {
          throw new Error(
            `invalid rpc method name "${name}" — use letters, digits, "-" and "_"`,
          );
        }
        const methodContract = readRpcMethodContract(name, methodContractValue);
        const handler = Reflect.get(handlers, name);
        if (typeof handler !== "function") {
          throw new Error(
            `rpc method "${name}" must provide a handler function`,
          );
        }
        if (rpcHandlers.has(name)) {
          throw new Error(`rpc method "${name}" is already registered`);
        }
        pending.push([
          name,
          {
            inputSchema: methodContract.input,
            outputSchema: methodContract.output,
            handler: handler as (input: never) => unknown,
          },
        ]);
      }
      for (const [name, record] of pending) {
        rpcHandlers.set(name, record);
      }
    },
  };

  const realtime: PluginRealtime = {
    publish(channel, payload) {
      assertLive();
      if (typeof channel !== "string" || channel.length === 0) {
        throw new Error("realtime channel must be a non-empty string");
      }
      // JSON round-trip up front: enforces serializability with a clear
      // error at the publish site and strips prototypes/getters before the
      // payload crosses the WS boundary.
      let normalized: unknown = null;
      if (payload !== undefined) {
        let json: string | undefined;
        try {
          json = JSON.stringify(payload);
        } catch {
          json = undefined;
        }
        if (json === undefined) {
          throw new Error(
            `realtime payload for channel "${channel}" is not JSON-serializable`,
          );
        }
        normalized = JSON.parse(json);
      }
      publishSignal(channel, normalized);
    },
  };

  const background: PluginBackground = {
    service(name, service) {
      assertLive();
      if (typeof name !== "string" || !BACKGROUND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid service name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (backgroundServices.some((record) => record.name === name)) {
        throw new Error(`background service "${name}" is already registered`);
      }
      if (typeof service?.start !== "function") {
        throw new Error(
          `background service "${name}" must provide a start(signal) function`,
        );
      }
      backgroundServices.push({ name, start: service.start.bind(service) });
    },
    schedule(name, cron, fn) {
      assertLive();
      if (typeof name !== "string" || !BACKGROUND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid schedule name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (schedules.some((record) => record.name === name)) {
        throw new Error(`schedule "${name}" is already registered`);
      }
      try {
        loadCronParser().CronExpressionParser.parse(String(cron));
      } catch (error) {
        throw new Error(
          `invalid cron ${JSON.stringify(cron)} for schedule "${name}": ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
      if (typeof fn !== "function") {
        throw new Error(`schedule "${name}" must provide a function`);
      }
      schedules.push({ name, cron: String(cron), fn });
    },
  };

  const agentTools: PluginAgentToolRecord[] = [];
  let agentConfigurationProvider: PluginAgentConfigurationProvider | null =
    null;
  let instructionProvider: PluginInstructionProvider | null = null;
  const agents: PluginAgents = {
    configure(provider) {
      assertLive();
      if (agentConfigurationProvider !== null) {
        throw new Error("agent configuration is already registered");
      }
      if (typeof provider !== "function") {
        throw new Error(
          "configure requires a provider function (context) => ({ tools, skills, instructions? })",
        );
      }
      agentConfigurationProvider = provider;
    },
    contributeInstructions(provider) {
      assertLive();
      if (instructionProvider !== null) {
        throw new Error("agent instructions are already registered");
      }
      if (typeof provider !== "function") {
        throw new Error(
          "contributeInstructions requires a provider function (ctx) => string | null",
        );
      }
      instructionProvider = provider;
    },
    registerTool(tool: {
      name: string;
      description: string;
      instructions?: string;
      experimental_statusLabels?: PluginAgentToolExperimentalStatusLabels;
      parameters: unknown;
      execute(
        params: never,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    }) {
      assertLive();
      const name = tool?.name;
      if (typeof name !== "string" || !AGENT_TOOL_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid tool name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (RESERVED_AGENT_TOOL_NAMES.includes(name)) {
        throw new Error(
          `tool name "${name}" is a built-in Patcher tool — pick another name`,
        );
      }
      if (
        typeof tool.description !== "string" ||
        tool.description.trim().length === 0
      ) {
        throw new Error(`tool "${name}" must provide a description`);
      }
      if (
        tool.instructions !== undefined &&
        typeof tool.instructions !== "string"
      ) {
        throw new Error(`tool "${name}" instructions must be a string`);
      }
      if (
        typeof tool.instructions === "string" &&
        tool.instructions.length > PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS
      ) {
        throw new Error(
          `tool "${name}" instructions exceed the ${PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS}-character limit`,
        );
      }
      const experimentalStatusLabels = tool.experimental_statusLabels;
      if (experimentalStatusLabels !== undefined) {
        if (
          typeof experimentalStatusLabels !== "object" ||
          experimentalStatusLabels === null ||
          typeof experimentalStatusLabels.pending !== "string" ||
          typeof experimentalStatusLabels.completed !== "string" ||
          experimentalStatusLabels.pending.trim().length === 0 ||
          experimentalStatusLabels.completed.trim().length === 0
        ) {
          throw new Error(
            `tool "${name}" experimental_statusLabels must provide non-empty pending and completed strings`,
          );
        }
        if (
          experimentalStatusLabels.pending.length >
            PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS ||
          experimentalStatusLabels.completed.length >
            PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS
        ) {
          throw new Error(
            `tool "${name}" experimental_statusLabels exceed the ${PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS}-character limit`,
          );
        }
      }
      if (typeof tool.execute !== "function") {
        throw new Error(
          `tool "${name}" must provide an execute(params, ctx) function`,
        );
      }
      const parameters: unknown = tool.parameters;
      let inputSchema: unknown;
      let parse: PluginAgentToolRecord["parse"];
      if (isZodSchemaLike(parameters)) {
        // The server's own zod 4 converts the schema; a schema from an
        // incompatible zod copy inside the plugin fails here with a clear
        // registration error instead of a broken wire schema later.
        try {
          inputSchema = loadZod().toJSONSchema(parameters as z.ZodType, {
            io: "input",
          });
        } catch (error) {
          throw new Error(
            `tool "${name}" parameters look like a zod schema but could not be converted to JSON Schema (${
              error instanceof Error ? error.message : String(error)
            }) — use zod 4, or pass a plain JSON-schema object`,
          );
        }
        parse = (input) => {
          const result = (parameters as z.ZodType).safeParse(input);
          if (result.success) return { ok: true, value: result.data };
          return { ok: false, error: summarizeParseIssues(result.error) };
        };
      } else if (
        typeof parameters === "object" &&
        parameters !== null &&
        !Array.isArray(parameters)
      ) {
        // Raw JSON-schema escape hatch: round-trip enforces serializability
        // (the schema rides thread.start commands) and strips prototypes.
        try {
          inputSchema = JSON.parse(JSON.stringify(parameters));
        } catch {
          throw new Error(
            `tool "${name}" parameters JSON schema is not JSON-serializable`,
          );
        }
        parse = (input) => ({ ok: true, value: input });
      } else {
        throw new Error(
          `tool "${name}" parameters must be a zod schema or a JSON-schema object`,
        );
      }
      const owner = isAgentToolNameTaken(name);
      if (owner !== undefined) {
        // Cross-plugin collision: the earlier registration wins; this one
        // is dropped and surfaced as a status detail (design §4.4).
        const problem = `tool "${name}" is already registered by plugin "${owner}" — not registered`;
        if (activated) reportAgentToolProblem(problem);
        else pendingAgentToolProblems.push(problem);
        return;
      }
      if (agentTools.some((existing) => existing.name === name)) {
        throw new Error(`tool "${name}" is already registered`);
      }
      const record: PluginAgentToolRecord = {
        name,
        description: tool.description,
        experimentalStatusLabels:
          experimentalStatusLabels === undefined
            ? null
            : {
                pending: experimentalStatusLabels.pending,
                completed: experimentalStatusLabels.completed,
              },
        instructions:
          tool.instructions !== undefined && tool.instructions.trim().length > 0
            ? tool.instructions
            : null,
        inputSchema,
        parse,
        execute: (
          tool.execute as (
            params: unknown,
            ctx: PluginAgentToolContext,
          ) => PluginAgentToolResult | Promise<PluginAgentToolResult>
        ).bind(tool),
      };
      agentTools.push(record);
    },
  };

  const mentionProviders: PluginMentionProviderRecord[] = [];
  const ui: PluginUi = {
    requestInput,
    registerMentionProvider(provider) {
      assertLive();
      const id = provider?.id;
      if (typeof id !== "string" || !MENTION_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid mention provider id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (mentionProviders.some((record) => record.id === id)) {
        throw new Error(`mention provider "${id}" is already registered`);
      }
      if (
        typeof provider.label !== "string" ||
        provider.label.trim().length === 0
      ) {
        throw new Error(`mention provider "${id}" must provide a label`);
      }
      if (typeof provider.search !== "function") {
        throw new Error(
          `mention provider "${id}" must provide a search({ query, projectId, threadId }) function`,
        );
      }
      if (typeof provider.resolve !== "function") {
        throw new Error(
          `mention provider "${id}" must provide a resolve(itemId) function`,
        );
      }
      mentionProviders.push({
        id,
        label: provider.label.trim(),
        triggers: normalizeMentionProviderTriggers(id, provider.triggers),
        search: provider.search.bind(provider),
        resolve: provider.resolve.bind(provider),
      });
    },
    registerKeybinding(keybinding) {
      assertLive();
      const command = loadAppKeybindings().appCommandIdSchema.safeParse(
        keybinding?.command,
      );
      if (!command.success) {
        // Named rather than ignored: a plugin binding a command that does not
        // exist has made a typo, and a silent no-op is the worst way to find
        // out. The message lists nothing — the id space is large — but the
        // value it rejected is in it.
        throw new Error(
          `registerKeybinding: unknown app command ${JSON.stringify(keybinding?.command)}`,
        );
      }
      if (keybindings.some((entry) => entry.command === command.data)) {
        throw new Error(
          `keybinding for "${command.data}" is already registered by this plugin`,
        );
      }
      const requested = keybinding.shortcut;
      if (requested === null || requested === undefined) {
        keybindings.push({ command: command.data, shortcut: null });
        return;
      }
      if (typeof requested.key !== "string" || requested.key.length === 0) {
        throw new Error(
          `registerKeybinding: "${command.data}" needs a non-empty key`,
        );
      }
      keybindings.push({
        command: command.data,
        shortcut: {
          key: requested.key,
          alt: requested.alt ?? false,
          control: requested.control ?? false,
          meta: requested.meta ?? false,
          mod: requested.mod ?? false,
          shift: requested.shift ?? false,
        },
      });
    },
    registerCommand(command) {
      assertLive();
      const id = command?.id;
      if (typeof id !== "string" || !OMNIBOX_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid command id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (commands.some((record) => record.id === id)) {
        throw new Error(`command "${id}" is already registered`);
      }
      if (
        typeof command.title !== "string" ||
        command.title.trim().length === 0
      ) {
        throw new Error(`command "${id}" must provide a title`);
      }
      if (typeof command.run !== "function") {
        throw new Error(`command "${id}" must provide a run() function`);
      }
      const key = command.shortcut?.key;
      if (typeof key !== "string" || key.length === 0) {
        throw new Error(
          `command "${id}" needs a shortcut with a non-empty key — Patcher has no command palette, so a command without one could never run`,
        );
      }
      const shortcut = {
        key,
        alt: command.shortcut.alt ?? false,
        control: command.shortcut.control ?? false,
        meta: command.shortcut.meta ?? false,
        mod: command.shortcut.mod ?? false,
        shift: command.shortcut.shift ?? false,
      };
      // Two of this plugin's own commands on one chord is a mistake it can fix,
      // so it is refused. Two *plugins* claiming one cannot coordinate, so that
      // is resolved by plugin id order instead of refused.
      if (
        commands.some(
          (record) =>
            record.shortcut.key.toLowerCase() === shortcut.key.toLowerCase() &&
            record.shortcut.alt === shortcut.alt &&
            record.shortcut.control === shortcut.control &&
            record.shortcut.meta === shortcut.meta &&
            record.shortcut.mod === shortcut.mod &&
            record.shortcut.shift === shortcut.shift,
        )
      ) {
        throw new Error(
          `command "${id}" wants a shortcut this plugin already bound to another command`,
        );
      }
      commands.push({
        id,
        title: command.title.trim(),
        shortcut,
        run: command.run.bind(command),
      });
    },
  };

  // Argument validation for patcher.browser.*. It happens here rather than on the
  // wire so a plugin's own mistake surfaces as that plugin's error instead of
  // travelling to the app and coming back as a refusal, the same way
  // `requestInput` validates its request before reaching the interaction store.
  function requireTabId(tabId: unknown, method: string): string {
    if (typeof tabId !== "string" || tabId.length === 0) {
      throw new Error(`browser.${method} requires a non-empty tabId`);
    }
    return tabId;
  }

  function optionalTabId(tabId: unknown): string | null {
    if (tabId === undefined || tabId === null) {
      return null;
    }
    if (typeof tabId !== "string" || tabId.length === 0) {
      throw new Error("browser tabId must be a non-empty string when provided");
    }
    return tabId;
  }

  function assertBrowserUrlLength(url: string, method: string): string {
    const { BROWSER_COMMAND_MAX_URL_LENGTH } = loadBrowserControl();
    if (url.length > BROWSER_COMMAND_MAX_URL_LENGTH) {
      throw new Error(
        `browser.${method} url exceeds ${BROWSER_COMMAND_MAX_URL_LENGTH} characters`,
      );
    }
    return url;
  }

  function normalizeBrowserUrlArg(url: unknown, method: string): string | null {
    if (url === undefined || url === null || url === "") {
      return null;
    }
    if (typeof url !== "string") {
      throw new Error(`browser.${method} url must be a string when provided`);
    }
    return assertBrowserUrlLength(url, method);
  }

  function requireNavigationUrl(url: unknown): string {
    if (typeof url !== "string" || url.length === 0) {
      throw new Error("browser.navigation.open requires a non-empty url");
    }
    return assertBrowserUrlLength(url, "navigation.open");
  }

  function normalizeSnapshotMaxDepth(maxDepth: unknown): number | null {
    if (maxDepth === undefined || maxDepth === null) {
      return null;
    }
    if (
      typeof maxDepth !== "number" ||
      !Number.isInteger(maxDepth) ||
      maxDepth < 1 ||
      maxDepth > 100
    ) {
      throw new Error(
        "browser.page.snapshot maxDepth must be an integer between 1 and 100",
      );
    }
    return maxDepth;
  }

  function normalizeSnapshotSelector(selector: unknown): string | null {
    if (selector === undefined || selector === null) {
      return null;
    }
    // Whether it is a *valid* selector only the browser can say, and it does:
    // what is checked here is that it is a string of a sane size.
    const { BROWSER_COMMAND_MAX_SELECTOR_LENGTH } = loadBrowserControl();
    if (
      typeof selector !== "string" ||
      selector.length === 0 ||
      selector.length > BROWSER_COMMAND_MAX_SELECTOR_LENGTH
    ) {
      throw new Error(
        `browser.page.snapshot selector must be a CSS selector of up to ${BROWSER_COMMAND_MAX_SELECTOR_LENGTH} characters`,
      );
    }
    return selector;
  }

  function normalizePageTextMaxLength(maxLength: unknown): number {
    const { BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH } = loadBrowserControl();
    if (maxLength === undefined) {
      return BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH;
    }
    if (
      typeof maxLength !== "number" ||
      !Number.isInteger(maxLength) ||
      maxLength < 1 ||
      maxLength > BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH
    ) {
      throw new Error(
        `browser.page.getText maxLength must be an integer between 1 and ${BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH}`,
      );
    }
    return maxLength;
  }

  /**
   * Apply the SDK's defaults, then validate against the wire schema itself.
   *
   * Re-parsing here rather than hand-checking each field keeps the two from
   * drifting: the app parses the same schema, so anything this accepts is
   * something the app will accept, and a plugin's mistake surfaces as that
   * plugin's error instead of as a refusal that travelled to the app and back.
   */
  function normalizeBrowserAction(action: unknown): BrowserInteraction {
    if (typeof action !== "object" || action === null) {
      throw new Error("browser.page.act requires an action object");
    }
    const record = action as Record<string, unknown>;
    let candidate: unknown = action;
    if (record.action === "click") {
      candidate = {
        action: "click",
        ref: record.ref,
        button: record.button ?? "left",
        clickCount: record.clickCount ?? 1,
        modifiers: record.modifiers ?? [],
      };
    } else if (record.action === "press") {
      candidate = {
        action: "press",
        key: record.key,
        ref: record.ref ?? null,
      };
    }
    const parsed =
      loadBrowserControl().browserInteractionSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      throw new Error(
        `browser.page.act received an invalid action${
          path === "" ? "" : ` (${path})`
        }: ${issue?.message ?? "unrecognized"}`,
      );
    }
    return parsed.data;
  }

  /**
   * How many log entries to hand back. Bounded here rather than left to the
   * schema alone so a plugin asking for a nonsense limit is told which call was
   * wrong.
   */
  function normalizeObservationLimit(limit: unknown, method: string): number {
    if (limit === undefined) {
      return DEFAULT_BROWSER_LOG_LIMIT;
    }
    const { BROWSER_COMMAND_MAX_OBSERVATION_ENTRIES } = loadBrowserControl();
    if (
      typeof limit !== "number" ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > BROWSER_COMMAND_MAX_OBSERVATION_ENTRIES
    ) {
      throw new Error(
        `${method} limit must be an integer between 1 and ${BROWSER_COMMAND_MAX_OBSERVATION_ENTRIES}`,
      );
    }
    return limit;
  }

  function normalizeScreenshotQuality(quality: unknown): number {
    if (quality === undefined) {
      return DEFAULT_SCREENSHOT_QUALITY;
    }
    if (
      typeof quality !== "number" ||
      !Number.isInteger(quality) ||
      quality < 1 ||
      quality > 100
    ) {
      throw new Error(
        "browser.page.screenshot quality must be an integer between 1 and 100",
      );
    }
    return quality;
  }

  function normalizeScreenshotFormat(format: unknown): "png" | "jpeg" {
    if (format === undefined) {
      return "jpeg";
    }
    if (format !== "png" && format !== "jpeg") {
      throw new Error('browser.page.screenshot format must be "png" or "jpeg"');
    }
    return format;
  }

  function normalizeFullPage(fullPage: unknown): boolean {
    if (fullPage === undefined) {
      return false;
    }
    if (typeof fullPage !== "boolean") {
      throw new Error("browser.page.screenshot fullPage must be a boolean");
    }
    return fullPage;
  }

  /**
   * Storage arguments, normalized here for the reason every other browser
   * argument is: a plugin's own mistake should read as that plugin's error
   * rather than as a refusal that travelled to the app and came back.
   *
   * The cookie defaults are the ones a browser applies to a cookie that
   * declares nothing — host-only, path `/`, non-secure, `Lax`, dies with the
   * session — so `setCookies({ name, value })` behaves like `document.cookie =`
   * rather than silently writing something broader.
   */
  function normalizeStorageArea(
    area: unknown,
    method: string,
  ): "local" | "session" {
    if (area !== "local" && area !== "session") {
      throw new Error(`${method} area must be "local" or "session"`);
    }
    return area;
  }

  function normalizeStorageName(name: unknown, method: string): string | null {
    if (name === undefined || name === null) {
      return null;
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(
        `${method} name must be a non-empty string when provided`,
      );
    }
    return name;
  }

  function normalizeCookies(cookies: unknown): BrowserCookie[] {
    if (!Array.isArray(cookies) || cookies.length === 0) {
      throw new Error(
        "browser.storage.setCookies requires at least one cookie",
      );
    }
    return cookies.map((cookie, index) => {
      if (typeof cookie !== "object" || cookie === null) {
        throw new Error(
          `browser.storage.setCookies cookie ${index} must be an object`,
        );
      }
      const record = cookie as Record<string, unknown>;
      const parsed = loadBrowserControl().browserCookieSchema.safeParse({
        name: record.name,
        value: record.value,
        domain: record.domain ?? "",
        path: record.path ?? "/",
        expires: record.expires ?? -1,
        httpOnly: record.httpOnly ?? false,
        secure: record.secure ?? false,
        sameSite: record.sameSite ?? "Lax",
      });
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(
          `browser.storage.setCookies cookie ${index} is invalid${
            issue === undefined
              ? ""
              : ` (${issue.path.join(".")}): ${issue.message}`
          }`,
        );
      }
      return parsed.data;
    });
  }

  function normalizeStorageItems(items: unknown): BrowserStorageItem[] {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error("browser.storage.setItems requires at least one item");
    }
    return items.map((item, index) => {
      const parsed =
        loadBrowserControl().browserStorageItemSchema.safeParse(item);
      if (!parsed.success) {
        throw new Error(
          `browser.storage.setItems item ${index} must be { name, value } strings within the size limits`,
        );
      }
      return parsed.data;
    });
  }

  /**
   * A route, with what an API mock wants without having to say so: 200, an
   * empty body, and a content type read off the body's first character. A mock
   * served as the wrong type fails in a way that looks like the mock never
   * fired, which is an expensive thing to debug.
   */
  function routeCandidate(args: unknown): unknown {
    const record = (
      typeof args === "object" && args !== null ? args : {}
    ) as Record<string, unknown>;
    const body = record.body ?? "";
    return {
      pattern: record.pattern,
      status: record.status ?? 200,
      contentType:
        record.contentType ??
        (typeof body === "string" && /^\s*[[{]/u.test(body)
          ? "application/json"
          : "text/plain"),
      body,
      headers: record.headers ?? [],
    };
  }

  /**
   * Every direct-control operation is checked here, the way `page.act`'s is:
   * against the schema the app will parse it with, so a plugin's own mistake
   * reads as that plugin's error rather than as a refusal that travelled to the
   * browser and back.
   */
  function normalizeControlOperation(
    candidate: unknown,
    method: string,
  ): BrowserControlOperation {
    const parsed =
      loadBrowserControl().browserControlOperationSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      throw new Error(
        `${method} received invalid arguments${
          path === "" ? "" : ` (${path})`
        }: ${issue?.message ?? "unrecognized"}`,
      );
    }
    return parsed.data;
  }

  /** Recording operations, checked here for the same reason control's are. */
  function normalizeRecordOperation(
    candidate: unknown,
    method: string,
  ): BrowserRecordOperation {
    const parsed =
      loadBrowserControl().browserRecordOperationSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      throw new Error(
        `${method} received invalid arguments${
          path === "" ? "" : ` (${path})`
        }: ${issue?.message ?? "unrecognized"}`,
      );
    }
    return parsed.data;
  }

  function normalizeSnapshotGeneration(generation: unknown): number | null {
    if (generation === undefined || generation === null) {
      return null;
    }
    if (
      typeof generation !== "number" ||
      !Number.isInteger(generation) ||
      generation < 0
    ) {
      throw new Error(
        "browser.page.act generation must be a non-negative integer when provided",
      );
    }
    return generation;
  }

  /**
   * Run one command and narrow its result to the variant that command answers
   * with. A mismatch means the app and this contract disagree, which is a bug
   * here rather than something a plugin could have caused.
   */
  async function callBrowser<TType extends BrowserCommandValue["type"]>(
    command: BrowserCommand,
    options: PluginBrowserCallOptions | undefined,
    expected: TType,
  ): Promise<Extract<BrowserCommandValue, { type: TType }>> {
    assertLive();
    // Every patcher.browser call that reaches a page funnels through here, so this
    // is the whole browser half of the gate — and the list of what a plugin
    // host would have to carry over RPC.
    permissionGate.assert(
      permissionForBrowserCommand(command),
      `patcher.browser command "${command.type}"`,
    );
    const value = await requestBrowserCommand({
      command,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    });
    if (value.type !== expected) {
      throw new Error(
        `browser command ${command.type} answered with an unexpected ${value.type} result`,
      );
    }
    return value as Extract<BrowserCommandValue, { type: TType }>;
  }

  /** The three route calls differ only in the operation they send. */
  async function controlRoutes(
    operation: BrowserControlOperation,
    tabId: string | undefined,
    options: PluginBrowserCallOptions | undefined,
  ): Promise<PluginBrowserRoutes> {
    const value = await callBrowser(
      {
        type: "page.control",
        tabId: optionalTabId(tabId),
        generation: null,
        operation,
      },
      options,
      "routes",
    );
    return {
      tabId: value.tabId,
      url: value.url,
      title: value.title,
      routes: value.routes,
      offline: value.offline,
    };
  }

  const omniboxProviders: PluginOmniboxProviderRecord[] = [];
  const downloadHandlers: PluginBrowserDownloadHandler[] = [];
  const contextMenuItems: PluginBrowserContextMenuItemRecord[] = [];
  const findActions: PluginBrowserFindActionRecord[] = [];
  const tabActions: PluginBrowserTabActionRecord[] = [];
  const siteInfoProviders: PluginBrowserSiteInfoProviderRecord[] = [];
  const toolbarItems: PluginBrowserToolbarItemRecord[] = [];
  const newTabWidgets: PluginBrowserNewTabWidgetRecord[] = [];
  const commands: PluginCommandRecord[] = [];
  const searchEngines: BrowserSearchEngine[] = [];
  const pageStyles: PluginBrowserPageStyleRecord[] = [];
  const pageScripts: PluginBrowserPageScriptRecord[] = [];
  const authProviders: PluginBrowserAuthProvider[] = [];
  const pdfTextProviders: PluginBrowserPdfTextProvider[] = [];
  const externalLinkHandlers: PluginBrowserExternalLinkHandler[] = [];
  const historyFilters: PluginBrowserHistoryFilter[] = [];
  const keybindings: AppKeybindingOverride[] = [];
  const browser: PluginBrowser = {
    registerOmniboxProvider(provider) {
      assertLive();
      permissionGate.assert(
        "omnibox.register",
        "patcher.browser.registerOmniboxProvider",
      );
      const id = provider?.id;
      if (typeof id !== "string" || !OMNIBOX_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid omnibox provider id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (omniboxProviders.some((record) => record.id === id)) {
        throw new Error(`omnibox provider "${id}" is already registered`);
      }
      if (
        typeof provider.label !== "string" ||
        provider.label.trim().length === 0
      ) {
        throw new Error(`omnibox provider "${id}" must provide a label`);
      }
      if (typeof provider.suggest !== "function") {
        throw new Error(
          `omnibox provider "${id}" must provide a suggest({ query }) function`,
        );
      }
      if (provider.run !== undefined && typeof provider.run !== "function") {
        throw new Error(
          `omnibox provider "${id}" run must be a function when provided`,
        );
      }
      omniboxProviders.push({
        id,
        label: provider.label.trim(),
        suggest: provider.suggest.bind(provider),
        run: provider.run === undefined ? null : provider.run.bind(provider),
      });
    },
    registerContextMenuItem(item) {
      assertLive();
      permissionGate.assert(
        "contextMenu.register",
        "patcher.browser.registerContextMenuItem",
      );
      const id = item?.id;
      if (typeof id !== "string" || !OMNIBOX_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid context menu item id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (contextMenuItems.some((record) => record.id === id)) {
        throw new Error(`context menu item "${id}" is already registered`);
      }
      if (typeof item.title !== "string" || item.title.trim().length === 0) {
        throw new Error(`context menu item "${id}" must provide a title`);
      }
      if (typeof item.run !== "function") {
        throw new Error(
          `context menu item "${id}" must provide a run(context) function`,
        );
      }
      contextMenuItems.push({
        id,
        title: item.title.trim(),
        when: {
          image: item.when?.image ?? false,
          link: item.when?.link ?? false,
          page: item.when?.page ?? false,
          selection: item.when?.selection ?? false,
        },
        run: item.run.bind(item),
      });
    },
    registerFindAction(action) {
      assertLive();
      permissionGate.assert(
        "find.register",
        "patcher.browser.registerFindAction",
      );
      const id = action?.id;
      if (typeof id !== "string" || !OMNIBOX_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid find action id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (findActions.some((record) => record.id === id)) {
        throw new Error(`find action "${id}" is already registered`);
      }
      if (
        typeof action.title !== "string" ||
        action.title.trim().length === 0
      ) {
        throw new Error(`find action "${id}" must provide a title`);
      }
      if (typeof action.run !== "function") {
        throw new Error(
          `find action "${id}" must provide a run(context) function`,
        );
      }
      findActions.push({
        id,
        title: action.title.trim(),
        run: action.run.bind(action),
      });
    },
    registerTabAction(action) {
      assertLive();
      permissionGate.assert(
        "tabMenu.register",
        "patcher.browser.registerTabAction",
      );
      const id = action?.id;
      if (typeof id !== "string" || !OMNIBOX_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid tab action id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (tabActions.some((record) => record.id === id)) {
        throw new Error(`tab action "${id}" is already registered`);
      }
      if (
        typeof action.title !== "string" ||
        action.title.trim().length === 0
      ) {
        throw new Error(`tab action "${id}" must provide a title`);
      }
      if (typeof action.run !== "function") {
        throw new Error(
          `tab action "${id}" must provide a run(context) function`,
        );
      }
      tabActions.push({
        id,
        title: action.title.trim(),
        run: action.run.bind(action),
      });
    },
    registerSiteInfoProvider(provider) {
      assertLive();
      permissionGate.assert(
        "siteInfo.register",
        "patcher.browser.registerSiteInfoProvider",
      );
      const id = provider?.id;
      if (typeof id !== "string" || !OMNIBOX_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid site info provider id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (siteInfoProviders.some((record) => record.id === id)) {
        throw new Error(`site info provider "${id}" is already registered`);
      }
      if (
        typeof provider.label !== "string" ||
        provider.label.trim().length === 0
      ) {
        throw new Error(`site info provider "${id}" must provide a label`);
      }
      if (typeof provider.describe !== "function") {
        throw new Error(
          `site info provider "${id}" must provide a describe(context) function`,
        );
      }
      siteInfoProviders.push({
        id,
        label: provider.label.trim(),
        describe: provider.describe.bind(provider),
      });
    },
    registerToolbarItem(item) {
      assertLive();
      permissionGate.assert(
        "toolbar.register",
        "patcher.browser.registerToolbarItem",
      );
      const id = item?.id;
      if (typeof id !== "string" || !OMNIBOX_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid toolbar item id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      // One control per plugin, refused here rather than dropped later: the
      // address row has no room to grow, and a plugin that finds out at render
      // time which of its buttons survived cannot do anything about it.
      if (toolbarItems.length > 0) {
        throw new Error(
          `toolbar item "${toolbarItems[0]?.id}" is already registered — a plugin may contribute one toolbar control`,
        );
      }
      if (typeof item.title !== "string" || item.title.trim().length === 0) {
        throw new Error(`toolbar item "${id}" must provide a title`);
      }
      if (typeof item.run !== "function") {
        throw new Error(
          `toolbar item "${id}" must provide a run(context) function`,
        );
      }
      if (item.state !== undefined && typeof item.state !== "function") {
        throw new Error(
          `toolbar item "${id}" state must be a function when provided`,
        );
      }
      const icon = typeof item.icon === "string" ? item.icon.trim() : "";
      toolbarItems.push({
        id,
        title: item.title.trim(),
        icon: icon.length === 0 ? null : icon,
        state: item.state === undefined ? null : item.state.bind(item),
        run: item.run.bind(item),
      });
    },
    registerNewTabWidget(widget) {
      assertLive();
      permissionGate.assert(
        "newTab.register",
        "patcher.browser.registerNewTabWidget",
      );
      const id = widget?.id;
      if (typeof id !== "string" || !OMNIBOX_PROVIDER_ID_PATTERN.test(id)) {
        throw new Error(
          `invalid new tab widget id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (newTabWidgets.some((record) => record.id === id)) {
        throw new Error(`new tab widget "${id}" is already registered`);
      }
      if (
        typeof widget.label !== "string" ||
        widget.label.trim().length === 0
      ) {
        throw new Error(`new tab widget "${id}" must provide a label`);
      }
      if (typeof widget.rows !== "function") {
        throw new Error(
          `new tab widget "${id}" must provide a rows(context) function`,
        );
      }
      newTabWidgets.push({
        id,
        label: widget.label.trim(),
        rows: widget.rows.bind(widget),
      });
    },
    registerSearchEngine(engine) {
      assertLive();
      permissionGate.assert(
        "searchEngine.register",
        "patcher.browser.registerSearchEngine",
      );
      const id = engine?.id;
      if (
        typeof id !== "string" ||
        id.length > BROWSER_SEARCH_ENGINE_MAX_ID_LENGTH ||
        !BROWSER_SEARCH_ENGINE_ID_PATTERN.test(id)
      ) {
        throw new Error(
          `invalid search engine id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (searchEngines.some((record) => record.id === id)) {
        throw new Error(`search engine "${id}" is already registered`);
      }
      const name = engine.name;
      if (
        typeof name !== "string" ||
        name.trim().length === 0 ||
        name.length > BROWSER_SEARCH_ENGINE_MAX_NAME_LENGTH
      ) {
        throw new Error(`search engine "${id}" must provide a name`);
      }
      // Refused at registration rather than at Enter: an engine that cannot be
      // used is a row in the user's setting that silently does nothing.
      const urlTemplate = normalizeBrowserSearchEngineTemplate(
        engine.urlTemplate,
      );
      if (urlTemplate === null) {
        throw new Error(
          `search engine "${id}" needs an https (or loopback) urlTemplate containing ${BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER}`,
        );
      }
      searchEngines.push({ id, name: name.trim(), urlTemplate });
    },
    registerPageStyle(style) {
      assertLive();
      permissionGate.assert(
        "pageStyle.register",
        "patcher.browser.registerPageStyle",
      );
      const id = style?.id;
      if (
        typeof id !== "string" ||
        id.length > BROWSER_PAGE_STYLE_MAX_ID_LENGTH ||
        !BROWSER_PAGE_STYLE_ID_PATTERN.test(id)
      ) {
        throw new Error(
          `invalid page style id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (pageStyles.some((record) => record.id === id)) {
        throw new Error(`page style "${id}" is already registered`);
      }
      const matches = resolveDeclaredMatches({
        kind: "page style",
        id,
        matches: style.matches,
        maxMatches: BROWSER_PAGE_STYLE_MAX_MATCHES,
        declared: sites ?? [],
        pluginId,
      });
      const css = style.css;
      if (
        typeof css !== "string" ||
        css.trim().length === 0 ||
        css.length > BROWSER_PAGE_STYLE_MAX_CSS_LENGTH
      ) {
        throw new Error(
          `page style "${id}" must provide css of up to ${BROWSER_PAGE_STYLE_MAX_CSS_LENGTH} characters`,
        );
      }
      pageStyles.push({ id, matches, css });
    },

    registerPageScript(script) {
      assertLive();
      permissionGate.assert(
        "pageScript.register",
        "patcher.browser.registerPageScript",
      );
      const id = script?.id;
      if (
        typeof id !== "string" ||
        id.length > BROWSER_PAGE_SCRIPT_MAX_ID_LENGTH ||
        !BROWSER_PAGE_SCRIPT_ID_PATTERN.test(id)
      ) {
        throw new Error(
          `invalid page script id ${JSON.stringify(id)} — use letters, digits, "-" and "_"`,
        );
      }
      if (pageScripts.some((record) => record.id === id)) {
        throw new Error(`page script "${id}" is already registered`);
      }
      const matches = resolveDeclaredMatches({
        kind: "page script",
        id,
        matches: script.matches,
        maxMatches: BROWSER_PAGE_SCRIPT_MAX_MATCHES,
        declared: sites ?? [],
        pluginId,
      });
      const code = script.code;
      if (
        typeof code !== "string" ||
        code.trim().length === 0 ||
        code.length > BROWSER_PAGE_SCRIPT_MAX_CODE_LENGTH
      ) {
        throw new Error(
          `page script "${id}" must provide code of up to ${BROWSER_PAGE_SCRIPT_MAX_CODE_LENGTH} characters`,
        );
      }
      // Never parsed here, and never run here: this process hands text to the
      // browser, which hands it to a page. A syntax error is the page console's
      // to report, in the world it would have run in.
      pageScripts.push({ id, matches, code });
    },
    registerAuthProvider(provider) {
      assertLive();
      permissionGate.assert(
        "auth.provide",
        "patcher.browser.registerAuthProvider",
      );
      if (typeof provider !== "function") {
        throw new Error(
          "registerAuthProvider(provider) needs a function taking one challenge",
        );
      }
      authProviders.push(provider);
    },
    registerPdfTextProvider(provider) {
      assertLive();
      permissionGate.assert(
        "pdf.provide",
        "patcher.browser.registerPdfTextProvider",
      );
      if (typeof provider !== "function") {
        throw new Error(
          "registerPdfTextProvider(provider) needs a function taking one document",
        );
      }
      pdfTextProviders.push(provider);
    },
    registerExternalLinkHandler(handler) {
      assertLive();
      permissionGate.assert(
        "externalLink.handle",
        "patcher.browser.registerExternalLinkHandler",
      );
      if (typeof handler !== "function") {
        throw new Error(
          "registerExternalLinkHandler(handler) needs a function taking one link",
        );
      }
      externalLinkHandlers.push(handler);
    },
    registerHistoryFilter(filter) {
      assertLive();
      permissionGate.assert("history", "patcher.browser.registerHistoryFilter");
      if (typeof filter !== "function") {
        throw new Error(
          "registerHistoryFilter(filter) needs a function taking one visit",
        );
      }
      historyFilters.push(filter);
    },
    registerDownloadHandler(handler) {
      assertLive();
      permissionGate.assert(
        "downloads.handle",
        "patcher.browser.registerDownloadHandler",
      );
      if (typeof handler !== "function") {
        throw new Error(
          "registerDownloadHandler(handler) needs a function taking one download",
        );
      }
      downloadHandlers.push(handler);
    },
    tabs: {
      async list(options) {
        return (await callBrowser({ type: "tabs.list" }, options, "tabs")).tabs;
      },
      async open(args, options) {
        return (
          await callBrowser(
            {
              type: "tabs.open",
              url: normalizeBrowserUrlArg(args?.url, "tabs.open"),
              activate: args?.activate ?? true,
            },
            options,
            "tab",
          )
        ).tab;
      },
      async close(args, options) {
        const value = await callBrowser(
          {
            type: "tabs.close",
            tabId: requireTabId(args?.tabId, "tabs.close"),
          },
          options,
          "closed",
        );
        return { closedTabId: value.closedTabId, tabs: value.tabs };
      },
      async activate(args, options) {
        return (
          await callBrowser(
            {
              type: "tabs.activate",
              tabId: requireTabId(args?.tabId, "tabs.activate"),
            },
            options,
            "tab",
          )
        ).tab;
      },
      async pin(args, options) {
        return (
          await callBrowser(
            {
              type: "tabs.pin",
              tabId: requireTabId(args?.tabId, "tabs.pin"),
              pinned: args?.pinned ?? true,
            },
            options,
            "tab",
          )
        ).tab;
      },
      async mute(args, options) {
        return (
          await callBrowser(
            {
              type: "tabs.mute",
              tabId: requireTabId(args?.tabId, "tabs.mute"),
              muted: args?.muted ?? true,
            },
            options,
            "tab",
          )
        ).tab;
      },
      async duplicate(args, options) {
        return (
          await callBrowser(
            {
              type: "tabs.duplicate",
              tabId: requireTabId(args?.tabId, "tabs.duplicate"),
            },
            options,
            "tab",
          )
        ).tab;
      },
      async move(args, options) {
        return (
          await callBrowser(
            {
              type: "tabs.move",
              tabId: requireTabId(args?.tabId, "tabs.move"),
              toIndex: args?.toIndex ?? 0,
            },
            options,
            "tab",
          )
        ).tab;
      },
    },
    page: {
      async snapshot(args, options) {
        const value = await callBrowser(
          {
            type: "page.snapshot",
            tabId: optionalTabId(args?.tabId),
            maxDepth: normalizeSnapshotMaxDepth(args?.maxDepth),
            selector: normalizeSnapshotSelector(args?.selector),
          },
          options,
          "snapshot",
        );
        return {
          tabId: value.tabId,
          url: value.url,
          title: value.title,
          snapshot: value.snapshot,
          generation: value.generation,
          refCount: value.refCount,
          truncated: value.truncated,
        };
      },
      async act(args, options) {
        const value = await callBrowser(
          {
            type: "page.interact",
            tabId: optionalTabId(args?.tabId),
            generation: normalizeSnapshotGeneration(args?.generation),
            interaction: normalizeBrowserAction(args?.action),
          },
          options,
          "interacted",
        );
        return { tabId: value.tabId, url: value.url, title: value.title };
      },
      async screenshot(args, options) {
        const value = await callBrowser(
          {
            type: "page.observe",
            tabId: optionalTabId(args?.tabId),
            observation: {
              kind: "screenshot",
              format: normalizeScreenshotFormat(args?.format),
              quality: normalizeScreenshotQuality(args?.quality),
              fullPage: normalizeFullPage(args?.fullPage),
            },
          },
          options,
          "image",
        );
        return {
          tabId: value.tabId,
          url: value.url,
          title: value.title,
          mimeType: value.mimeType,
          base64: value.base64,
          width: value.width,
          height: value.height,
          fullPage: value.fullPage,
          truncated: value.truncated,
        };
      },
      async pdf(args, options) {
        const value = await callBrowser(
          {
            type: "page.observe",
            tabId: optionalTabId(args?.tabId),
            observation: { kind: "pdf" },
          },
          options,
          "pdf",
        );
        return {
          tabId: value.tabId,
          url: value.url,
          title: value.title,
          base64: value.base64,
          byteLength: value.byteLength,
        };
      },
      async console(args, options) {
        const value = await callBrowser(
          {
            type: "page.observe",
            tabId: optionalTabId(args?.tabId),
            observation: {
              kind: "console",
              limit: normalizeObservationLimit(
                args?.limit,
                "browser.page.console",
              ),
            },
          },
          options,
          "console",
        );
        return {
          tabId: value.tabId,
          url: value.url,
          title: value.title,
          entries: value.entries,
          droppedCount: value.droppedCount,
        };
      },
      async network(args, options) {
        const value = await callBrowser(
          {
            type: "page.observe",
            tabId: optionalTabId(args?.tabId),
            observation: {
              kind: "network",
              limit: normalizeObservationLimit(
                args?.limit,
                "browser.page.network",
              ),
            },
          },
          options,
          "network",
        );
        return {
          tabId: value.tabId,
          url: value.url,
          title: value.title,
          entries: value.entries,
          droppedCount: value.droppedCount,
        };
      },
      async handleDialog(args, options) {
        if (typeof args?.accept !== "boolean") {
          throw new Error("browser.page.handleDialog requires accept: boolean");
        }
        const value = await callBrowser(
          {
            type: "page.handle_dialog",
            tabId: optionalTabId(args.tabId),
            accept: args.accept,
            promptText:
              args.promptText === undefined ? null : String(args.promptText),
          },
          options,
          "answered",
        );
        return value.answered;
      },
      async zoom(args, options) {
        return (
          await callBrowser(
            {
              type: "page.zoom",
              tabId: optionalTabId(args.tabId),
              factor: args.factor,
            },
            options,
            "zoom",
          )
        ).factor;
      },
      async getUrl(args, options) {
        return (
          await callBrowser(
            { type: "page.get_url", tabId: optionalTabId(args?.tabId) },
            options,
            "url",
          )
        ).url;
      },
      async getTitle(args, options) {
        return (
          await callBrowser(
            { type: "page.get_title", tabId: optionalTabId(args?.tabId) },
            options,
            "title",
          )
        ).title;
      },
      async getText(args, options) {
        const value = await callBrowser(
          {
            type: "page.get_text",
            tabId: optionalTabId(args?.tabId),
            maxLength: normalizePageTextMaxLength(args?.maxLength),
          },
          options,
          "text",
        );
        return { text: value.text, truncated: value.truncated };
      },
      async getSelection(args, options) {
        const value = await callBrowser(
          { type: "page.get_selection", tabId: optionalTabId(args?.tabId) },
          options,
          "text",
        );
        return { text: value.text };
      },
    },
    navigation: {
      async open(args, options) {
        return (
          await callBrowser(
            {
              type: "navigation.open",
              tabId: optionalTabId(args?.tabId),
              url: requireNavigationUrl(args?.url),
              newTab: args?.newTab ?? false,
            },
            options,
            "tab",
          )
        ).tab;
      },
      async back(args, options) {
        return (
          await callBrowser(
            { type: "navigation.back", tabId: optionalTabId(args?.tabId) },
            options,
            "tab",
          )
        ).tab;
      },
      async forward(args, options) {
        return (
          await callBrowser(
            { type: "navigation.forward", tabId: optionalTabId(args?.tabId) },
            options,
            "tab",
          )
        ).tab;
      },
      async reload(args, options) {
        return (
          await callBrowser(
            { type: "navigation.reload", tabId: optionalTabId(args?.tabId) },
            options,
            "tab",
          )
        ).tab;
      },
    },
    storage: {
      async cookies(args, options) {
        const value = await callBrowser(
          {
            type: "page.storage",
            tabId: optionalTabId(args?.tabId),
            operation: { kind: "cookies-get" },
          },
          options,
          "cookies",
        );
        return {
          tabId: value.tabId,
          url: value.url,
          title: value.title,
          cookies: value.cookies,
        };
      },
      async setCookies(args, options) {
        const value = await callBrowser(
          {
            type: "page.storage",
            tabId: optionalTabId(args?.tabId),
            operation: {
              kind: "cookies-set",
              cookies: normalizeCookies(args?.cookies),
            },
          },
          options,
          "written",
        );
        return { applied: value.applied, rejected: value.rejected };
      },
      async clearCookies(args, options) {
        const value = await callBrowser(
          {
            type: "page.storage",
            tabId: optionalTabId(args?.tabId),
            operation: {
              kind: "cookies-clear",
              name: normalizeStorageName(
                args?.name,
                "browser.storage.clearCookies",
              ),
            },
          },
          options,
          "removed",
        );
        return { removed: value.removed };
      },
      async items(args, options) {
        const value = await callBrowser(
          {
            type: "page.storage",
            tabId: optionalTabId(args?.tabId),
            operation: {
              kind: "items-get",
              area: normalizeStorageArea(args?.area, "browser.storage.items"),
            },
          },
          options,
          "storage",
        );
        return {
          tabId: value.tabId,
          url: value.url,
          title: value.title,
          area: value.area,
          items: value.items,
          truncated: value.truncated,
        };
      },
      async setItems(args, options) {
        const value = await callBrowser(
          {
            type: "page.storage",
            tabId: optionalTabId(args?.tabId),
            operation: {
              kind: "items-set",
              area: normalizeStorageArea(
                args?.area,
                "browser.storage.setItems",
              ),
              items: normalizeStorageItems(args?.items),
            },
          },
          options,
          "written",
        );
        return { applied: value.applied, rejected: value.rejected };
      },
      async clearItems(args, options) {
        const value = await callBrowser(
          {
            type: "page.storage",
            tabId: optionalTabId(args?.tabId),
            operation: {
              kind: "items-clear",
              area: normalizeStorageArea(
                args?.area,
                "browser.storage.clearItems",
              ),
              name: normalizeStorageName(
                args?.name,
                "browser.storage.clearItems",
              ),
            },
          },
          options,
          "removed",
        );
        return { removed: value.removed };
      },
    },
    control: {
      async evaluate(args, options) {
        const value = await callBrowser(
          {
            type: "page.control",
            tabId: optionalTabId(args?.tabId),
            generation: normalizeSnapshotGeneration(args?.generation),
            operation: normalizeControlOperation(
              {
                kind: "evaluate",
                expression: args?.expression,
                ref: args?.ref ?? null,
              },
              "browser.control.evaluate",
            ),
          },
          options,
          "evaluated",
        );
        return {
          tabId: value.tabId,
          url: value.url,
          title: value.title,
          value: value.value,
          truncated: value.truncated,
        };
      },
      async mouseMove(args, options) {
        const value = await callBrowser(
          {
            type: "page.control",
            tabId: optionalTabId(args?.tabId),
            generation: null,
            operation: normalizeControlOperation(
              { kind: "mouse-move", x: args?.x, y: args?.y },
              "browser.control.mouseMove",
            ),
          },
          options,
          "interacted",
        );
        return { tabId: value.tabId, url: value.url, title: value.title };
      },
      async mouseButton(args, options) {
        const value = await callBrowser(
          {
            type: "page.control",
            tabId: optionalTabId(args?.tabId),
            generation: null,
            operation: normalizeControlOperation(
              {
                kind: "mouse-button",
                button: args?.button ?? "left",
                down: args?.down,
              },
              "browser.control.mouseButton",
            ),
          },
          options,
          "interacted",
        );
        return { tabId: value.tabId, url: value.url, title: value.title };
      },
      async mouseWheel(args, options) {
        const value = await callBrowser(
          {
            type: "page.control",
            tabId: optionalTabId(args?.tabId),
            generation: null,
            operation: normalizeControlOperation(
              {
                kind: "mouse-wheel",
                deltaX: args?.deltaX ?? 0,
                deltaY: args?.deltaY ?? 0,
              },
              "browser.control.mouseWheel",
            ),
          },
          options,
          "interacted",
        );
        return { tabId: value.tabId, url: value.url, title: value.title };
      },
      async route(args, options) {
        return await controlRoutes(
          normalizeControlOperation(
            { kind: "route-set", route: routeCandidate(args) },
            "browser.control.route",
          ),
          args?.tabId,
          options,
        );
      },
      async routes(args, options) {
        return await controlRoutes(
          { kind: "route-list" },
          args?.tabId,
          options,
        );
      },
      async unroute(args, options) {
        return await controlRoutes(
          normalizeControlOperation(
            { kind: "route-clear", pattern: args?.pattern ?? null },
            "browser.control.unroute",
          ),
          args?.tabId,
          options,
        );
      },
      async setOffline(args, options) {
        const value = await callBrowser(
          {
            type: "page.control",
            tabId: optionalTabId(args?.tabId),
            generation: null,
            operation: normalizeControlOperation(
              { kind: "offline", offline: args?.offline },
              "browser.control.setOffline",
            ),
          },
          options,
          "interacted",
        );
        return { tabId: value.tabId, url: value.url, title: value.title };
      },
    },
    recording: {
      async traceStart(args, options) {
        await callBrowser(
          {
            type: "page.record",
            // The trace spans tabs, so it names none.
            tabId: null,
            operation: normalizeRecordOperation(
              { kind: "trace-start", screenshots: args?.screenshots ?? false },
              "browser.recording.traceStart",
            ),
          },
          options,
          "recording",
        );
      },
      async traceStop(options) {
        const value = await callBrowser(
          {
            type: "page.record",
            tabId: null,
            operation: { kind: "trace-stop" },
          },
          options,
          "trace",
        );
        return {
          steps: value.steps,
          droppedSteps: value.droppedSteps,
          droppedImages: value.droppedImages,
          durationMs: value.durationMs,
        };
      },
      async videoStart(args, options) {
        await callBrowser(
          {
            type: "page.record",
            tabId: optionalTabId(args?.tabId),
            operation: normalizeRecordOperation(
              { kind: "video-start", fps: args?.fps ?? 5 },
              "browser.recording.videoStart",
            ),
          },
          options,
          "recording",
        );
      },
      async videoChapter(args, options) {
        await callBrowser(
          {
            type: "page.record",
            tabId: optionalTabId(args?.tabId),
            operation: normalizeRecordOperation(
              { kind: "video-chapter", title: args?.title },
              "browser.recording.videoChapter",
            ),
          },
          options,
          "recording",
        );
      },
      async videoStop(args, options): Promise<PluginBrowserVideo> {
        const value = await callBrowser(
          {
            type: "page.record",
            tabId: optionalTabId(args?.tabId),
            operation: { kind: "video-stop" },
          },
          options,
          "video",
        );
        return {
          tabId: value.tabId,
          url: value.url,
          title: value.title,
          frames: value.frames,
          chapters: value.chapters,
          droppedFrames: value.droppedFrames,
          durationMs: value.durationMs,
        };
      },
    },
    getStatus() {
      const snapshot = getBrowserHostStatus();
      return {
        connected: snapshot.connected,
        windowCount: snapshot.hostCount,
      };
    },
  };

  const cliRecord: PluginApiHandle["cli"] = { registration: null };
  const cli: PluginCli = {
    register(registration) {
      assertLive();
      if (cliRecord.registration !== null) {
        throw new Error("cli command is already registered");
      }
      const name = registration?.name;
      if (typeof name !== "string" || !CLI_COMMAND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid cli command name ${JSON.stringify(name)} — use lowercase letters, digits, and "-"`,
        );
      }
      if (RESERVED_PATCHER_CLI_COMMANDS.includes(name)) {
        throw new Error(
          `cli command name "${name}" is reserved by the Patcher CLI — pick another name`,
        );
      }
      if (
        typeof registration.summary !== "string" ||
        registration.summary.trim().length === 0
      ) {
        throw new Error(`cli command "${name}" must provide a summary`);
      }
      const commands = registration.commands ?? [];
      if (!Array.isArray(commands)) {
        throw new Error(`cli command "${name}" commands must be an array`);
      }
      const validatedCommands = commands.map((command, index) => {
        if (
          typeof command?.name !== "string" ||
          !CLI_COMMAND_NAME_PATTERN.test(command.name) ||
          typeof command.summary !== "string" ||
          typeof command.usage !== "string"
        ) {
          throw new Error(
            `cli command "${name}" commands[${index}] must be { name: [a-z0-9-]+, summary, usage }`,
          );
        }
        return {
          name: command.name,
          summary: command.summary,
          usage: command.usage,
        };
      });
      if (typeof registration.run !== "function") {
        throw new Error(
          `cli command "${name}" must provide a run(argv, ctx) function`,
        );
      }
      cliRecord.registration = {
        name,
        summary: registration.summary,
        commands: validatedCommands,
        run: registration.run.bind(registration),
      };
    },
  };

  const status: PluginStatusApi = {
    needsConfiguration(message) {
      assertLive();
      const normalized =
        typeof message === "string" && message.length > 0
          ? message
          : "needs configuration";
      if (activated) reportNeedsConfiguration(normalized);
      else pendingNeedsConfiguration = normalized;
    },
  };

  const server: PluginServerApi = {
    get loopbackBaseUrl(): string {
      assertLive();
      const baseUrl = getLoopbackBaseUrl();
      if (baseUrl === undefined) {
        throw new Error(
          "patcher.server.loopbackBaseUrl is not available until the server is listening — " +
            "use it inside handlers, services, or timers, not at factory load time",
        );
      }
      return baseUrl;
    },
  };

  const events: PluginEvents = {
    on(event, handler) {
      assertLive();
      // Every event here is a thread event, and the payload is the whole
      // thread — the same data `sdk.threads` and the `thread:changed` feed
      // both charge for. A push costing less than a pull for identical
      // content is a hole, not a convenience.
      permissionGate.assert("threads", "patcher.events.on");
      const handlers = threadEventHandlers[event];
      if (handlers === undefined) {
        // Plugin sources are untyped at runtime; fail loudly at registration
        // instead of silently never firing.
        throw new Error(
          `unknown event "${String(event)}" — supported events: ${Object.keys(
            threadEventHandlers,
          ).join(", ")}`,
        );
      }
      handlers.push(handler);
    },
  };

  const api: PatcherPluginApi = {
    pluginId,
    log,
    settings,
    storage,
    http,
    rpc,
    realtime,
    background,
    cli,
    agents,
    ui,
    browser,
    events,
    status,
    server,
    get sdk(): PatcherSdk {
      assertLive();
      const sdk = getSdk();
      if (!sdk) {
        throw new Error(
          "patcher.sdk is not available until the server is listening — " +
            "use it inside handlers, services, or timers, not at factory load time",
        );
      }
      wrappedSdk ??= wrapSdkForPlugin(sdk, pluginId, permissionGate);
      return wrappedSdk;
    },
    onDispose(hook) {
      assertLive();
      disposeHooks.push(hook);
    },
  };

  return {
    api,
    disposeHooks,
    settings: settingsRecord,
    databaseHandles,
    threadEventHandlers,
    httpRoutes,
    rpcHandlers,
    backgroundServices,
    schedules,
    cli: cliRecord,
    agentTools,
    get agentConfigurationProvider() {
      return agentConfigurationProvider;
    },
    get instructionProvider() {
      return instructionProvider;
    },
    mentionProviders,
    omniboxProviders,
    downloadHandlers,
    keybindings,
    contextMenuItems,
    findActions,
    tabActions,
    siteInfoProviders,
    toolbarItems,
    newTabWidgets,
    commands,
    searchEngines,
    pageStyles,
    pageScripts,
    authProviders,
    pdfTextProviders,
    externalLinkHandlers,
    historyFilters,
    activate() {
      if (activated) return;
      assertLive();
      activated = true;
      for (const problem of pendingAgentToolProblems) {
        reportAgentToolProblem(problem);
      }
      pendingAgentToolProblems.length = 0;
      if (pendingNeedsConfiguration !== null) {
        reportNeedsConfiguration(pendingNeedsConfiguration);
        pendingNeedsConfiguration = null;
      }
    },
    invalidate() {
      invalidated = true;
    },
  };
}

/**
 * Two packages this module needs for one corner of `patcher` each, loaded on the
 * first call rather than at import.
 *
 * This file is the one every plugin process loads, and most of what it drags in
 * is for a part of `patcher` a given plugin never touches: cron parsing costs
 * ~11MB resident and matters only to a plugin with a schedule, the browser
 * control schemas cost ~23MB (~9MB of it zod itself) and matter only to a
 * plugin that drives a tab. Deferring both takes a host process from ~84MB to
 * ~58MB — see apps/server/scripts/measure-plugin-host.mjs.
 *
 * Why `require` and not `await import`: both call sites are synchronous by
 * contract — `patcher.background.schedule()` rejects a bad cron expression before it
 * returns, and the browser argument checks answer inside functions that must
 * not become async. The mechanics, and why a literal specifier is required for
 * this to survive bundling, are written out once at `loadPatcherSdk` in
 * plugin-child-runtime.ts.
 */
let cronParserModule: typeof import("cron-parser") | undefined;

function loadCronParser(): typeof import("cron-parser") {
  cronParserModule ??=
    typeof require === "function"
      ? (require("cron-parser") as typeof import("cron-parser"))
      : (createRequire(import.meta.url)(
          "cron-parser",
        ) as typeof import("cron-parser"));
  return cronParserModule;
}

let browserControlModule:
  | typeof import("@patcher/domain/browser-control")
  | undefined;

function loadBrowserControl(): typeof import("@patcher/domain/browser-control") {
  browserControlModule ??=
    typeof require === "function"
      ? (require("@patcher/domain/browser-control") as typeof import("@patcher/domain/browser-control"))
      : (createRequire(import.meta.url)(
          "@patcher/domain/browser-control",
        ) as typeof import("@patcher/domain/browser-control"));
  return browserControlModule;
}

let zodModule: typeof import("zod") | undefined;

function loadZod(): typeof import("zod") {
  zodModule ??=
    typeof require === "function"
      ? (require("zod") as typeof import("zod"))
      : (createRequire(import.meta.url)("zod") as typeof import("zod"));
  return zodModule;
}

let appKeybindingsModule:
  | typeof import("@patcher/domain/app-keybindings")
  | undefined;

function loadAppKeybindings(): typeof import("@patcher/domain/app-keybindings") {
  appKeybindingsModule ??=
    typeof require === "function"
      ? (require("@patcher/domain/app-keybindings") as typeof import("@patcher/domain/app-keybindings"))
      : (createRequire(import.meta.url)(
          "@patcher/domain/app-keybindings",
        ) as typeof import("@patcher/domain/app-keybindings"));
  return appKeybindingsModule;
}

let betterSqlite3Module: typeof import("better-sqlite3") | undefined;

/**
 * The native database driver, loaded when a plugin opens a database.
 *
 * It is a native module, so this is not only ~2MB resident but a dlopen in
 * every plugin process — for an API most plugins never call.
 *
 * Unlike the loaders above, this one resolves from **disk** in both branches
 * rather than out of the bundle: natives are deliberately external, and the
 * bundle's `require` is the one `scripts/build-utils.mjs` puts in its banner
 * (`createRequire(import.meta.url)`), which resolves `better-sqlite3` from
 * `node_modules` next to the bundle — the same copy, and the same ABI, the
 * server itself loads.
 */
function loadBetterSqlite3(): typeof import("better-sqlite3") {
  betterSqlite3Module ??=
    typeof require === "function"
      ? (require("better-sqlite3") as typeof import("better-sqlite3"))
      : (createRequire(import.meta.url)(
          "better-sqlite3",
        ) as typeof import("better-sqlite3"));
  return betterSqlite3Module;
}
