import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { CronExpressionParser } from "cron-parser";
import { Hono } from "hono";
import { z } from "zod";
import { PLUGIN_CLI_OUTPUT_MAX_BYTES } from "../backend-contract.js";
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
  PluginCliExecutionResult,
  PluginCliOutputLimitError,
  PluginCliResult,
  PluginEvents,
  PluginHttp,
  PluginHttpAuthMode,
  PluginHttpHandler,
  PluginInteractionRequest,
  PluginInteractionResult,
  PluginKeybinding,
  PluginKvStorage,
  PluginLogger,
  PluginMentionItem,
  PluginMentionSearchContext,
  PluginMentionTrigger,
  PluginBrowser,
  PluginBrowserContextMenuItemRegistration,
  PluginBrowserAuthProvider,
  PluginBrowserHistoryFilter,
  PluginBrowserExternalLinkHandler,
  PluginBrowserPdfTextProvider,
  PluginBrowserFindActionRegistration,
  PluginBrowserPageScriptRegistration,
  PluginBrowserPageStyleRegistration,
  PluginBrowserSearchEngineRegistration,
  PluginBrowserSiteInfoProviderRegistration,
  PluginBrowserToolbarItemRegistration,
  PluginBrowserNewTabWidgetRegistration,
  PluginCommandRegistration,
  PluginBrowserTabActionRegistration,
  PluginBrowserDownloadHandler,
  PluginBrowserConsoleEntry,
  PluginBrowserCookie,
  PluginBrowserErrorCode,
  PluginBrowserNetworkEntry,
  PluginBrowserRouteState,
  PluginBrowserStorageArea,
  PluginBrowserStorageItem,
  PluginBrowserTab,
  PluginOmniboxRunContext,
  PluginOmniboxRunResult,
  PluginOmniboxSuggestContext,
  PluginOmniboxSuggestion,
  PluginRealtime,
  PluginRpc,
  PluginServerApi,
  PluginSettingDescriptor,
  PluginSettingDescriptors,
  PluginSettingValue,
  PluginSettings,
  PluginSettingsValues,
  PluginStatusApi,
  PluginStorage,
  PluginThreadEventHandler,
  PluginThreadEventName,
  PluginThreadEventPayloads,
  PluginUi,
  PluginRpcError,
  PluginRpcMethodContract,
  PluginRpcValidationIssue,
  StandardSchemaV1,
  StandardSchemaV1Issue,
  StandardSchemaV1Result,
  JsonValue,
} from "@patcher/plugin-sdk";
import type { PluginPermission } from "@patcher/domain";
import {
  BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER,
  normalizeBrowserSearchEngineTemplate,
} from "@patcher/domain/browser-search-engine";
import { BROWSER_PAGE_STYLE_MAX_CSS_LENGTH } from "@patcher/domain/browser-page-style";
import { BROWSER_PAGE_SCRIPT_MAX_CODE_LENGTH } from "@patcher/domain/browser-page-script";
import { createFakePermissionGate } from "./fake-permissions.js";
import {
  createFakeSdk,
  type FakeSdkHarness,
  type FakeSdkOverrides,
} from "./fake-sdk.js";

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
export class PluginContextStaleError extends Error {
  constructor(pluginId: string) {
    super(
      `plugin "${pluginId}" used a stale API handle — it was reloaded or disabled; ` +
        `re-entry happens via a fresh factory call`,
    );
    this.name = "PluginContextStaleError";
  }
}

/** JSON values ≤256KB; larger writes are rejected with a clear error. */
const KV_VALUE_MAX_BYTES = 256 * 1024;
/** Mirrors the server's pending-interaction title schema. */
const PLUGIN_INTERACTION_MAX_TITLE_LENGTH = 160;

const PLUGIN_HTTP_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
]);

const RPC_METHOD_PATTERN = /^[a-zA-Z0-9_-]+$/;
const BACKGROUND_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const CLI_COMMAND_NAME_PATTERN = /^[a-z0-9-]+$/;
const AGENT_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PLUGIN_AGENT_STATIC_INSTRUCTIONS_MAX_CHARS = 4096;
/** Status labels ride on every tool-call event and share one timeline row. */
const PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS = 80;
const PLUGIN_AGENT_SELECTION_MAX_IDS = 256;
const PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS = 4096;

function enforcePluginCliOutputLimit(
  result: Omit<PluginCliExecutionResult, "error">,
  jsonOutput: boolean,
): PluginCliExecutionResult {
  const stdoutBytes = Buffer.byteLength(result.stdout, "utf8");
  const stderrBytes = Buffer.byteLength(result.stderr, "utf8");
  const totalBytes = stdoutBytes + stderrBytes;
  if (totalBytes <= PLUGIN_CLI_OUTPUT_MAX_BYTES) return result;

  const error: PluginCliOutputLimitError = {
    code: "plugin_cli_output_too_large",
    message:
      `Plugin CLI output is ${totalBytes} bytes (${stdoutBytes} stdout + ${stderrBytes} stderr), ` +
      `exceeding the ${PLUGIN_CLI_OUTPUT_MAX_BYTES}-byte limit. Narrow the query, request a smaller page, or use a file/streaming command.`,
    maxBytes: PLUGIN_CLI_OUTPUT_MAX_BYTES,
    stdoutBytes,
    stderrBytes,
    totalBytes,
  };
  return jsonOutput
    ? {
        exitCode: 1,
        stdout: JSON.stringify({ error }),
        stderr: "",
        error,
      }
    : { exitCode: 1, stdout: "", stderr: error.message, error };
}
/**
 * Fixed stand-in bytes for the two captures. They are real files (a 2x1 PNG and
 * a PDF header) so a plugin that decodes and writes them produces something
 * openable, but they are not an encode of anything: the fake never renders, so
 * asking it for JPEG still gets these bytes back under a JPEG mime type.
 */
const FAKE_BROWSER_SCREENSHOT_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP8z8DwnwEJMCEzAB8FAwGnEwvKAAAAAElFTkSuQmCC";
const FAKE_BROWSER_PDF_BASE64 = "JVBERi0xLjQK";

/**
 * The last `limit` entries, and how many the caller is therefore not seeing —
 * the same contract the shell's ring buffer has.
 */
function sliceBrowserLog<TEntry>(
  entries: readonly TEntry[],
  limit: number | undefined,
): { entries: TEntry[]; droppedCount: number } {
  const kept = entries.slice(Math.max(0, entries.length - (limit ?? 100)));
  return { entries: [...kept], droppedCount: entries.length - kept.length };
}

const MENTION_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const OMNIBOX_PROVIDER_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const PLUGIN_MENTION_TRIGGER_VALUES = [
  "@",
  "#",
  "$",
  "!",
  "~",
] as const satisfies readonly PluginMentionTrigger[];
const DEFAULT_PLUGIN_MENTION_TRIGGERS = [
  "@",
] as const satisfies readonly PluginMentionTrigger[];
const SETTING_KEY_PATTERN = /^[a-zA-Z0-9_-]+$/;

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
        `mention provider "${providerId}" trigger ${JSON.stringify(trigger)} is invalid — use one of ${PLUGIN_MENTION_TRIGGER_VALUES.join(" ")}`,
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

/**
 * Copies of the server's hand-maintained reserved-name lists
 * (RESERVED_PATCHER_CLI_COMMANDS / RESERVED_AGENT_TOOL_NAMES in
 * apps/server/src/services/plugins/plugin-api.ts) so registrations fail here
 * the same way they fail there. Update alongside the server lists.
 */
const RESERVED_PATCHER_CLI_COMMANDS: readonly string[] = [
  "environment",
  "guide",
  "help",
  "manager",
  "plugin",
  "project",
  "provider",
  "status",
  "theme",
  "thread",
  "ui",
];
const RESERVED_AGENT_TOOL_NAMES: readonly string[] = [
  "update_environment_directory",
];

export type FakeLogLevel = "debug" | "info" | "warn" | "error";

export interface FakeLogEntry {
  level: FakeLogLevel;
  message: string;
}

export interface FakeHttpRouteRecord {
  method: string;
  path: string;
  auth: PluginHttpAuthMode;
  handler: PluginHttpHandler;
}

export interface FakeScheduleRecord {
  name: string;
  cron: string;
  fn: () => void | Promise<void>;
}

export interface FakeServiceRecord {
  name: string;
  start: (signal: AbortSignal) => void | Promise<void>;
}

export interface FakeCliRecord {
  name: string;
  summary: string;
  commands: PluginCliCommandInfo[];
  run: (
    argv: string[],
    ctx: PluginCliContext,
  ) => PluginCliResult | Promise<PluginCliResult>;
}

export interface FakeAgentToolRecord {
  name: string;
  description: string;
  experimentalStatusLabels: PluginAgentToolExperimentalStatusLabels | null;
  instructions: string | null;
  /** JSON-schema object the host would send providers. */
  inputSchema: unknown;
  parse(
    input: unknown,
  ): { ok: true; value: unknown } | { ok: false; error: string };
  execute(
    params: unknown,
    ctx: PluginAgentToolContext,
  ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
}

export interface FakeMentionProviderRecord {
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

export interface FakeOmniboxProviderRecord {
  id: string;
  label: string;
  suggest: (
    ctx: PluginOmniboxSuggestContext,
  ) => PluginOmniboxSuggestion[] | Promise<PluginOmniboxSuggestion[]>;
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

/**
 * A stand-in browser surface for plugins that call `patcher.browser.tabs`/`page`/
 * `navigation`. It models the two properties those calls actually hinge on —
 * which tab is active, and which tabs are **live** (have a real page behind
 * them) — so a plugin's error handling can be exercised without an Electron
 * window anywhere in sight.
 */
export interface FakeBrowserDrivers {
  /** Replace the tab model. The first tab is active unless one sets `active`. */
  setTabs(tabs: readonly FakeBrowserTabInput[]): void;
  /**
   * What the page reads answer for a live tab. `console` and `network` are the
   * tab's logs, which `page.console`/`page.network` slice from the end.
   */
  setPageContent(
    tabId: string,
    content: {
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
      frames?: readonly { at: number; base64: string }[];
    },
  ): void;
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

export interface FakeBrowserTabInput {
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
export interface FakeBrowserCall {
  type: string;
  args: Record<string, unknown>;
}

export interface FakeRealtimeSignal {
  channel: string;
  /** JSON-round-tripped, like the WS broadcast; `undefined` → `null`. */
  payload: unknown;
}

/** Everything the plugin registered, exposed raw for assertions. */
export interface FakePluginRegistrations {
  settingsDescriptors: PluginSettingDescriptors;
  httpRoutes: FakeHttpRouteRecord[];
  rpcMethods: string[];
  services: FakeServiceRecord[];
  schedules: FakeScheduleRecord[];
  cli: FakeCliRecord | null;
  agentTools: FakeAgentToolRecord[];
  /** Provider from patcher.agents.configure, or null when none registered. */
  agentConfigurationProvider:
    | ((context: PluginAgentConfigurationContext) => PluginAgentConfiguration)
    | null;
  /** Provider from contributeInstructions, or null when none registered. */
  instructionProvider:
    | ((ctx: { threadId: string; projectId: string }) => string | null)
    | null;
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
export interface FakePluginInspectionState {
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
export interface FakePluginBehaviorDrivers {
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
  runCli(
    argv: string[],
    ctx?: PluginCliContext,
  ): Promise<PluginCliExecutionResult>;
  /**
   * Dispatch a request to a registered `patcher.http` route (exact method+path
   * match, like the host's V1 router) through a real Hono context. Auth
   * modes are not enforced. A throwing handler yields the host's 500
   * `{ ok: false, error: "plugin route failed: …" }` response.
   */
  fetchHttp(
    method: string,
    path: string,
    init?: RequestInit,
  ): Promise<Response>;
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
  emitThreadEvent<E extends PluginThreadEventName>(
    event: E,
    payload: PluginThreadEventPayloads[E],
  ): Promise<{ errors: unknown[] }>;
  /**
   * Call a registered agent tool the way a provider tool-call would:
   * arguments go through the tool's parse step (zod-validated for zod
   * registrations; a parse failure throws), then execute. `ctx` fields
   * default to "thread-test"/"project-test" and a fresh signal.
   */
  callAgentTool(
    name: string,
    input: unknown,
    ctx?: Partial<PluginAgentToolContext>,
  ): Promise<PluginAgentToolResult>;
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
export interface FakePluginLifecycleControls {
  /**
   * Load a replacement against the same persisted settings, kv, and database.
   * The current host remains live when the factory throws; on success its
   * services/hooks are disposed and the returned host becomes current.
   */
  reload(
    factory: (patcher: PatcherPluginApi) => void | Promise<void>,
  ): Promise<FakePluginHost>;
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
export interface FakePluginHarness
  extends
    FakePluginInspectionState,
    FakePluginBehaviorDrivers,
    FakePluginLifecycleControls {
  readonly behavior: FakePluginBehaviorDrivers;
  readonly inspection: FakePluginInspectionState;
  readonly lifecycle: FakePluginLifecycleControls;
}

export interface CreateFakePluginHostOptions {
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

export interface FakePluginHost {
  patcher: PatcherPluginApi;
  harness: FakePluginHarness;
}

// ---------------------------------------------------------------------------
// Settings descriptor validation — ported from the server's
// plugin-settings.ts so plugins trip over the same errors here.
// ---------------------------------------------------------------------------

const settingsBaseFields = {
  label: z.string().min(1),
  description: z.string().min(1).optional(),
};

const settingDescriptorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("string"),
      ...settingsBaseFields,
      secret: z.literal(true).optional(),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("boolean"),
      ...settingsBaseFields,
      default: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("select"),
      ...settingsBaseFields,
      options: z.array(z.string().min(1)).min(1),
      default: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("project"),
      ...settingsBaseFields,
      default: z.string().optional(),
    })
    .strict(),
]);

function registerSettingDescriptors(
  target: PluginSettingDescriptors,
  added: Record<string, unknown>,
): PluginSettingDescriptors {
  const validated: PluginSettingDescriptors = {};
  for (const [key, raw] of Object.entries(added)) {
    if (!SETTING_KEY_PATTERN.test(key)) {
      throw new Error(
        `invalid setting key "${key}" — use letters, digits, "-" and "_"`,
      );
    }
    if (key in target) {
      throw new Error(`setting "${key}" is already defined`);
    }
    const parsed = settingDescriptorSchema.safeParse(raw);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") ?? "";
      throw new Error(
        `invalid descriptor for setting "${key}"${path ? ` (${path})` : ""}: ${issue?.message ?? "unknown error"}`,
      );
    }
    const descriptor = parsed.data;
    if (
      descriptor.type === "select" &&
      descriptor.default !== undefined &&
      !descriptor.options.includes(descriptor.default)
    ) {
      throw new Error(
        `default for setting "${key}" must be one of its options`,
      );
    }
    validated[key] = descriptor;
  }
  Object.assign(target, validated);
  return validated;
}

/** Effective typed values: stored value when valid, else the default, else undefined. */
function readSettingsValues(
  descriptors: PluginSettingDescriptors,
  stored: Map<string, PluginSettingValue>,
): Record<string, PluginSettingValue | undefined> {
  const values: Record<string, PluginSettingValue | undefined> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    let value = stored.get(key);
    const expected = descriptor.type === "boolean" ? "boolean" : "string";
    if (typeof value !== expected) value = undefined;
    if (
      descriptor.type === "select" &&
      typeof value === "string" &&
      !descriptor.options.includes(value)
    ) {
      value = undefined;
    }
    values[key] = value ?? descriptor.default;
  }
  return values;
}

function validateSettingsUpdate(
  descriptors: PluginSettingDescriptors,
  values: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(values)) {
    const descriptor: PluginSettingDescriptor | undefined = descriptors[key];
    if (!descriptor) {
      errors.push(`unknown setting "${key}"`);
      continue;
    }
    if (value === null) continue; // unset
    if (descriptor.type === "boolean") {
      if (typeof value !== "boolean") {
        errors.push(`setting "${key}" expects a boolean`);
      }
      continue;
    }
    if (typeof value !== "string") {
      errors.push(`setting "${key}" expects a string`);
      continue;
    }
    if (descriptor.type === "select" && !descriptor.options.includes(value)) {
      errors.push(
        `setting "${key}" must be one of: ${descriptor.options.join(", ")}`,
      );
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------

function isNeedsConfigurationError(error: unknown): error is Error {
  return error instanceof Error && error.name === "NeedsConfigurationError";
}

/** Duck-typed zod detection, same as the host (plugins may carry their own zod). */
function isZodSchemaLike(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Is this a `Response`? Asked structurally; see the call site for why. */
function isResponseLike(value: unknown): value is Response {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Response>;
  return (
    typeof candidate.status === "number" &&
    typeof candidate.arrayBuffer === "function" &&
    typeof candidate.headers === "object" &&
    candidate.headers !== null
  );
}

function jsonRoundTrip(value: unknown, what: string): unknown {
  if (value === undefined) return undefined;
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch {
    json = undefined;
  }
  if (json === undefined) {
    throw new Error(`${what} is not JSON-serializable`);
  }
  return JSON.parse(json);
}

interface FakeRpcRecord {
  inputSchema: StandardSchemaV1;
  outputSchema: StandardSchemaV1;
  handler: (input: never) => unknown;
}

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

function normalizeRpcIssues(
  issues: readonly StandardSchemaV1Issue[],
): PluginRpcValidationIssue[] {
  return issues.map((issue) => {
    const rawPath = issue.path;
    const segments =
      rawPath === undefined ? [] : Array.isArray(rawPath) ? rawPath : [rawPath];
    const path = segments.map((segment) => {
      const key =
        typeof segment === "object" && segment !== null
          ? Reflect.get(segment, "key")
          : segment;
      return typeof key === "number" ? key : String(key);
    });
    return {
      message: issue.message,
      ...(path.length > 0 ? { path } : {}),
    };
  });
}

function throwRpcError(error: PluginRpcError): never {
  const thrown = new Error(error.message);
  Reflect.set(thrown, "code", error.code);
  if (error.issues !== undefined) Reflect.set(thrown, "issues", error.issues);
  throw thrown;
}

async function validateRpcValue(
  schema: StandardSchemaV1,
  value: unknown,
  phase: "input" | "output",
): Promise<unknown> {
  let result: StandardSchemaV1Result<unknown>;
  try {
    result = await schema["~standard"].validate(value);
  } catch (error) {
    const message = errorMessage(error);
    return throwRpcError({
      code: phase === "input" ? "invalid_input" : "invalid_output",
      message: `rpc ${phase} validator failed: ${message}`,
      issues: [{ message }],
    });
  }
  if (result.issues !== undefined) {
    return throwRpcError({
      code: phase === "input" ? "invalid_input" : "invalid_output",
      message: `rpc ${phase} validation failed`,
      issues: normalizeRpcIssues(result.issues),
    });
  }
  return result.value;
}

function normalizeRpcJsonResult(value: unknown): JsonValue {
  const ancestors = new Set<object>();
  function visit(current: unknown, path: string): JsonValue {
    if (
      current === null ||
      typeof current === "string" ||
      typeof current === "boolean"
    ) {
      return current;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        return throwRpcError({
          code: "non_json_result",
          message: `rpc result at ${path} contains a non-finite number`,
        });
      }
      return current;
    }
    if (typeof current !== "object") {
      return throwRpcError({
        code: "non_json_result",
        message: `rpc result at ${path} is not a JSON value (${typeof current})`,
      });
    }
    if (ancestors.has(current)) {
      return throwRpcError({
        code: "non_json_result",
        message: `rpc result at ${path} is cyclic`,
      });
    }
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        return current.map((item, index) => visit(item, `${path}[${index}]`));
      }
      const prototype = Object.getPrototypeOf(current) as object | null;
      if (prototype !== Object.prototype && prototype !== null) {
        return throwRpcError({
          code: "non_json_result",
          message: `rpc result at ${path} must be a plain JSON object`,
        });
      }
      if (Reflect.ownKeys(current).some((key) => typeof key === "symbol")) {
        return throwRpcError({
          code: "non_json_result",
          message: `rpc result at ${path} contains a symbol key`,
        });
      }
      const normalized: Record<string, JsonValue> = {};
      for (const [key, child] of Object.entries(current)) {
        normalized[key] = visit(child, `${path}.${key}`);
      }
      return normalized;
    } finally {
      ancestors.delete(current);
    }
  }
  return visit(value, "$result");
}

const AGENT_TOOL_PARAMETERS_MAX_BYTES = 128 * 1024;

function normalizeAgentToolSelections(args: {
  knownIds: ReadonlySet<string>;
  pluginId: string;
  value: unknown;
}): {
  toolIds: string[];
  parameterOverrides: Map<string, Record<string, unknown>>;
} {
  if (!Array.isArray(args.value)) {
    throw new Error("configure() output.tools must be an array");
  }
  if (args.value.length > PLUGIN_AGENT_SELECTION_MAX_IDS) {
    throw new Error(
      `configure() output.tools exceeds the ${PLUGIN_AGENT_SELECTION_MAX_IDS}-id limit`,
    );
  }
  const toolIds: string[] = [];
  const parameterOverrides = new Map<string, Record<string, unknown>>();
  const seen = new Set<string>();
  for (let index = 0; index < args.value.length; index += 1) {
    const entry = args.value[index];
    let name: unknown;
    let parameters: Record<string, unknown> | null = null;
    if (typeof entry === "string") {
      name = entry;
    } else if (
      typeof entry === "object" &&
      entry !== null &&
      !Array.isArray(entry)
    ) {
      const typed = entry as Record<string, unknown>;
      const unknownKeys = Object.keys(typed)
        .filter((key) => !["name", "parameters"].includes(key))
        .sort();
      if (unknownKeys.length > 0) {
        throw new Error(
          `configure() output.tools[${index}] contains unknown field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`,
        );
      }
      name = typed.name;
      parameters = normalizeAgentToolParameters({
        index,
        value: typed.parameters,
      });
    } else {
      throw new Error(
        `configure() output.tools[${index}] must be a tool name or { name, parameters }`,
      );
    }
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(
        `configure() output.tools[${index}] must ${typeof entry === "string" ? "be" : "name"} a non-empty string`,
      );
    }
    if (seen.has(name)) {
      throw new Error(
        `configure() output.tools contains duplicate id ${JSON.stringify(name)}`,
      );
    }
    if (!args.knownIds.has(name)) {
      throw new Error(
        `configure() selected unknown tool id ${JSON.stringify(name)} owned by plugin ${JSON.stringify(args.pluginId)}`,
      );
    }
    seen.add(name);
    toolIds.push(name);
    if (parameters !== null) parameterOverrides.set(name, parameters);
  }
  return { toolIds, parameterOverrides };
}

function normalizeAgentToolParameters(args: {
  index: number;
  value: unknown;
}): Record<string, unknown> {
  const { index, value } = args;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      `configure() output.tools[${index}].parameters must be a JSON-schema object`,
    );
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error(
      `configure() output.tools[${index}].parameters is not JSON-serializable`,
    );
  }
  if (serialized === undefined) {
    throw new Error(
      `configure() output.tools[${index}].parameters is not JSON-serializable`,
    );
  }
  if (Buffer.byteLength(serialized, "utf8") > AGENT_TOOL_PARAMETERS_MAX_BYTES) {
    throw new Error(
      `configure() output.tools[${index}].parameters exceeds the ${AGENT_TOOL_PARAMETERS_MAX_BYTES}-byte limit`,
    );
  }
  const parameters = JSON.parse(serialized) as Record<string, unknown>;
  if (parameters.type !== "object") {
    throw new Error(
      `configure() output.tools[${index}].parameters must have root type "object"`,
    );
  }
  return parameters;
}

function normalizeAgentConfigurationIds(args: {
  field: "skills";
  knownIds: ReadonlySet<string>;
  pluginId: string;
  value: unknown;
}): string[] {
  if (!Array.isArray(args.value)) {
    throw new Error(`configure() output.${args.field} must be an array`);
  }
  if (args.value.length > PLUGIN_AGENT_SELECTION_MAX_IDS) {
    throw new Error(
      `configure() output.${args.field} exceeds the ${PLUGIN_AGENT_SELECTION_MAX_IDS}-id limit`,
    );
  }
  const selected: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < args.value.length; index += 1) {
    const id = args.value[index];
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(
        `configure() output.${args.field}[${index}] must be a non-empty string`,
      );
    }
    if (seen.has(id)) {
      throw new Error(
        `configure() output.${args.field} contains duplicate id ${JSON.stringify(id)}`,
      );
    }
    if (!args.knownIds.has(id)) {
      throw new Error(
        `configure() selected unknown skill id ${JSON.stringify(id)} owned by plugin ${JSON.stringify(args.pluginId)}`,
      );
    }
    seen.add(id);
    selected.push(id);
  }
  return selected;
}

function normalizeAgentConfiguration(args: {
  knownSkillIds: ReadonlySet<string>;
  knownToolIds: ReadonlySet<string>;
  pluginId: string;
  value: unknown;
}): {
  toolIds: string[];
  toolParameterOverrides: Map<string, Record<string, unknown>>;
  skillIds: string[];
  instructions: string | null;
} {
  if (
    typeof args.value !== "object" ||
    args.value === null ||
    Array.isArray(args.value)
  ) {
    throw new Error(
      "configure() must return { tools: string[], skills: string[], instructions?: string }",
    );
  }
  const output = args.value as Record<string, unknown>;
  const unknownKeys = Object.keys(output)
    .filter((key) => !["tools", "skills", "instructions"].includes(key))
    .sort();
  if (unknownKeys.length > 0) {
    throw new Error(
      `configure() output contains unknown field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}`,
    );
  }
  if (
    output.instructions !== undefined &&
    typeof output.instructions !== "string"
  ) {
    throw new Error("configure() output.instructions must be a string");
  }
  const toolSelections = normalizeAgentToolSelections({
    knownIds: args.knownToolIds,
    pluginId: args.pluginId,
    value: output.tools,
  });
  return {
    toolIds: toolSelections.toolIds,
    toolParameterOverrides: toolSelections.parameterOverrides,
    skillIds: normalizeAgentConfigurationIds({
      field: "skills",
      knownIds: args.knownSkillIds,
      pluginId: args.pluginId,
      value: output.skills,
    }),
    instructions:
      typeof output.instructions === "string" &&
      output.instructions.trim().length > 0
        ? output.instructions.slice(
            0,
            PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS,
          )
        : null,
  };
}

interface FakePluginPersistentState {
  kvRows: Map<string, string>;
  storageRoot: string;
  storedSettings: Map<string, PluginSettingValue>;
}

const fakeHostDisposers = new WeakMap<
  FakePluginHarness,
  (cleanupStorage: boolean) => Promise<void>
>();

export function createFakePluginHost(
  options: CreateFakePluginHostOptions = {},
): FakePluginHost {
  return createFakePluginHostInternal(options);
}

function createFakePluginHostInternal(
  options: CreateFakePluginHostOptions,
  sharedState?: FakePluginPersistentState,
): FakePluginHost {
  const persistentState =
    sharedState ??
    ({
      kvRows: new Map<string, string>(),
      storageRoot: mkdtempSync(join(tmpdir(), "patcher-fake-plugin-host-")),
      storedSettings: new Map<string, PluginSettingValue>(
        Object.entries(options.settings ?? {}),
      ),
    } satisfies FakePluginPersistentState);
  const pluginId = options.pluginId ?? "test-plugin";
  const permissionGate = createFakePermissionGate(
    pluginId,
    options.permissions,
  );
  const agentSkillIds = [...(options.agentSkillIds ?? [])];
  if (new Set(agentSkillIds).size !== agentSkillIds.length) {
    throw new Error("agentSkillIds must not contain duplicates");
  }
  let invalidated = false;
  let disposed = false;

  function assertLive(): void {
    if (invalidated) throw new PluginContextStaleError(pluginId);
  }

  // --- log ---
  const logEntries: FakeLogEntry[] = [];
  function emitLog(level: FakeLogLevel, message: string): void {
    logEntries.push({ level, message });
  }
  const log: PluginLogger = {
    debug: (message) => emitLog("debug", message),
    info: (message) => emitLog("info", message),
    warn: (message) => emitLog("warn", message),
    error: (message) => emitLog("error", message),
  };

  // --- storage ---
  const kvRows = persistentState.kvRows;
  const kv: PluginKvStorage = {
    async get(key) {
      assertLive();
      const raw = kvRows.get(key);
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
      kvRows.set(key, json);
    },
    async delete(key) {
      assertLive();
      kvRows.delete(key);
    },
    async list(prefix) {
      assertLive();
      return [...kvRows.keys()]
        .filter((key) => prefix === undefined || key.startsWith(prefix))
        .sort();
    },
  };

  const storageRoot = persistentState.storageRoot;

  // One shared temp-file handle: every database() call sees the same data,
  // like the host's handles over one on-disk file.
  let databaseHandle: Database.Database | undefined;
  const storage: PluginStorage = {
    kv,
    database() {
      assertLive();
      if (!databaseHandle) {
        databaseHandle = new Database(join(storageRoot, "data.db"));
        databaseHandle.pragma("busy_timeout = 5000");
      }
      return databaseHandle;
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

  // --- settings ---
  const settingsDescriptors: PluginSettingDescriptors = {};
  const settingsListeners: Array<
    (
      next: Record<string, PluginSettingValue | undefined>,
      prev: Record<string, PluginSettingValue | undefined>,
    ) => void
  > = [];
  const storedSettings = persistentState.storedSettings;

  const settings: PluginSettings = {
    define(descriptors) {
      assertLive();
      registerSettingDescriptors(
        settingsDescriptors,
        descriptors as Record<string, unknown>,
      );
      type Values = PluginSettingsValues<typeof descriptors>;
      return {
        async get() {
          assertLive();
          return readSettingsValues(
            settingsDescriptors,
            storedSettings,
          ) as Values;
        },
        onChange(listener) {
          assertLive();
          settingsListeners.push(
            listener as (typeof settingsListeners)[number],
          );
        },
      };
    },
  };

  // --- http ---
  const httpRoutes: FakeHttpRouteRecord[] = [];
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

  // --- rpc ---
  const rpcHandlers = new Map<string, FakeRpcRecord>();
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
      const pending: Array<[string, FakeRpcRecord]> = [];
      const contractEntries = Object.entries(contract);
      const contractNames = new Set(contractEntries.map(([name]) => name));
      for (const extraName of Object.keys(handlers)) {
        if (!contractNames.has(extraName)) {
          throw new Error(
            `rpc handler "${extraName}" has no matching contract method`,
          );
        }
      }
      for (const [name, contractValue] of contractEntries) {
        if (!RPC_METHOD_PATTERN.test(name)) {
          throw new Error(
            `invalid rpc method name "${name}" — use letters, digits, "-" and "_"`,
          );
        }
        const methodContract = readRpcMethodContract(name, contractValue);
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

  // --- realtime ---
  const realtimeSignals: FakeRealtimeSignal[] = [];
  const realtime: PluginRealtime = {
    publish(channel, payload) {
      assertLive();
      if (typeof channel !== "string" || channel.length === 0) {
        throw new Error("realtime channel must be a non-empty string");
      }
      const normalized =
        payload === undefined
          ? null
          : (jsonRoundTrip(
              payload,
              `realtime payload for channel "${channel}"`,
            ) ?? null);
      realtimeSignals.push({ channel, payload: normalized });
    },
  };

  // --- background ---
  const services: FakeServiceRecord[] = [];
  const schedules: FakeScheduleRecord[] = [];
  const background: PluginBackground = {
    service(name, service) {
      assertLive();
      if (typeof name !== "string" || !BACKGROUND_NAME_PATTERN.test(name)) {
        throw new Error(
          `invalid service name ${JSON.stringify(name)} — use letters, digits, "-" and "_"`,
        );
      }
      if (services.some((record) => record.name === name)) {
        throw new Error(`background service "${name}" is already registered`);
      }
      if (typeof service?.start !== "function") {
        throw new Error(
          `background service "${name}" must provide a start(signal) function`,
        );
      }
      services.push({ name, start: service.start.bind(service) });
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
        CronExpressionParser.parse(String(cron));
      } catch (error) {
        throw new Error(
          `invalid cron ${JSON.stringify(cron)} for schedule "${name}": ${errorMessage(error)}`,
        );
      }
      if (typeof fn !== "function") {
        throw new Error(`schedule "${name}" must provide a function`);
      }
      schedules.push({ name, cron: String(cron), fn });
    },
  };

  // --- cli ---
  const cliRecord: { registration: FakeCliRecord | null } = {
    registration: null,
  };
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

  // --- agents ---
  const agentTools: FakeAgentToolRecord[] = [];
  let agentConfigurationProvider:
    | ((context: PluginAgentConfigurationContext) => PluginAgentConfiguration)
    | null = null;
  let instructionProvider:
    | ((ctx: { threadId: string; projectId: string }) => string | null)
    | null = null;
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
      if (
        experimentalStatusLabels !== undefined &&
        (typeof experimentalStatusLabels !== "object" ||
          experimentalStatusLabels === null ||
          typeof experimentalStatusLabels.pending !== "string" ||
          typeof experimentalStatusLabels.completed !== "string" ||
          experimentalStatusLabels.pending.trim().length === 0 ||
          experimentalStatusLabels.completed.trim().length === 0)
      ) {
        throw new Error(
          `tool "${name}" experimental_statusLabels must provide non-empty pending and completed strings`,
        );
      }
      if (
        experimentalStatusLabels !== undefined &&
        (experimentalStatusLabels.pending.length >
          PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS ||
          experimentalStatusLabels.completed.length >
            PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS)
      ) {
        throw new Error(
          `tool "${name}" experimental_statusLabels exceed the ${PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS}-character limit`,
        );
      }
      if (typeof tool.execute !== "function") {
        throw new Error(
          `tool "${name}" must provide an execute(params, ctx) function`,
        );
      }
      const parameters: unknown = tool.parameters;
      let inputSchema: unknown;
      let parse: FakeAgentToolRecord["parse"];
      if (isZodSchemaLike(parameters)) {
        try {
          inputSchema = z.toJSONSchema(parameters as z.ZodType, {
            io: "input",
          });
        } catch (error) {
          throw new Error(
            `tool "${name}" parameters look like a zod schema but could not be converted to JSON Schema (${errorMessage(error)}) — use zod 4, or pass a plain JSON-schema object`,
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
      const record: FakeAgentToolRecord = {
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
      if (agentTools.some((existing) => existing.name === name)) {
        throw new Error(`tool "${name}" is already registered`);
      }
      agentTools.push(record);
    },
  };

  // --- ui ---
  const mentionProviders: FakeMentionProviderRecord[] = [];
  const keybindings: PluginKeybinding[] = [];
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
      if (
        typeof keybinding?.command !== "string" ||
        keybinding.command.length === 0
      ) {
        throw new Error("registerKeybinding needs an app command id");
      }
      // The real host also rejects an id that is not a known command; the fake
      // has no command table, so it records what it was given.
      keybindings.push(keybinding);
    },
    registerCommand(command) {
      assertLive();
      if (typeof command?.id !== "string" || command.id.length === 0) {
        throw new Error("registerCommand needs an id");
      }
      if (typeof command.title !== "string" || command.title.trim() === "") {
        throw new Error(`command "${command.id}" must provide a title`);
      }
      if (typeof command.run !== "function") {
        throw new Error(
          `command "${command.id}" must provide a run() function`,
        );
      }
      // The host's own refusal: a command with no chord could not be run, since
      // there is no palette to find it in.
      if (
        typeof command.shortcut?.key !== "string" ||
        command.shortcut.key.length === 0
      ) {
        throw new Error(`command "${command.id}" needs a shortcut with a key`);
      }
      if (commands.some((record) => record.id === command.id)) {
        throw new Error(`command "${command.id}" is already registered`);
      }
      // The host's other refusal: one plugin binding one chord twice is a mistake
      // it can fix, so a plugin's test sees it here rather than at load time.
      if (
        commands.some(
          (record) =>
            record.shortcut.key.toLowerCase() ===
              command.shortcut.key.toLowerCase() &&
            (record.shortcut.alt ?? false) ===
              (command.shortcut.alt ?? false) &&
            (record.shortcut.control ?? false) ===
              (command.shortcut.control ?? false) &&
            (record.shortcut.meta ?? false) ===
              (command.shortcut.meta ?? false) &&
            (record.shortcut.mod ?? false) ===
              (command.shortcut.mod ?? false) &&
            (record.shortcut.shift ?? false) ===
              (command.shortcut.shift ?? false),
        )
      ) {
        throw new Error(
          `command "${command.id}" wants a shortcut this plugin already bound to another command`,
        );
      }
      commands.push(command);
    },
  };

  // --- browser ---
  const browserCalls: FakeBrowserCall[] = [];
  interface FakeBrowserPageContent {
    text: string;
    selection: string;
    snapshot: string;
    console: readonly PluginBrowserConsoleEntry[];
    network: readonly PluginBrowserNetworkEntry[];
    cookies: readonly PluginBrowserCookie[];
    localStorage: readonly PluginBrowserStorageItem[];
    sessionStorage: readonly PluginBrowserStorageItem[];
    evaluated: string;
    routes: readonly PluginBrowserRouteState[];
    offline: boolean;
    frames: readonly { at: number; base64: string }[];
  }
  const EMPTY_BROWSER_PAGE_CONTENT: FakeBrowserPageContent = {
    text: "",
    selection: "",
    snapshot: "",
    console: [],
    network: [],
    cookies: [],
    localStorage: [],
    sessionStorage: [],
    evaluated: "undefined",
    routes: [],
    offline: false,
    frames: [],
  };
  const browserPageContent = new Map<string, FakeBrowserPageContent>();
  let browserSnapshotGeneration = 0;
  /** Where the running trace started in `browserCalls`; null when none is. */
  let browserTraceFrom: number | null = null;
  /** Chapters marked so far, per tab being filmed. */
  const browserVideos = new Map<string, { at: number; title: string }[]>();
  let browserPendingDialog = false;
  let browserTabs: PluginBrowserTab[] = [];
  let browserConnected = true;
  let browserNextFailure: {
    code: PluginBrowserErrorCode;
    message: string;
  } | null = null;

  /** The host reports refusals by name, not by class — mirror that here. */
  function browserError(code: PluginBrowserErrorCode, message: string): Error {
    const error = Object.assign(new Error(message), {
      name: "BrowserCommandError",
      code,
    });
    return error;
  }

  /**
   * `permission` is spelled out at each call site rather than looked up from a
   * table keyed by these labels. The labels are the SDK's vocabulary and the
   * host charges the *command* the SDK builds, so a table here would be a
   * second set of decisions free to disagree with the first. At the call site
   * the decision sits beside the method it belongs to, and a new fake method
   * cannot be added without making one. `fake-browser-permissions.test.ts`
   * pins these against `permissionForBrowserCommand`.
   */
  function beginBrowserCall(
    type: string,
    permission: PluginPermission,
    args: Record<string, unknown> = {},
  ): void {
    assertLive();
    permissionGate.assert(permission, `patcher.browser ${type}`);
    browserCalls.push({ type, args });
    if (!browserConnected) {
      throw Object.assign(new Error("No browser window is connected"), {
        name: "BrowserHostUnavailableError",
      });
    }
    if (browserNextFailure !== null) {
      const failure = browserNextFailure;
      browserNextFailure = null;
      throw browserError(failure.code, failure.message);
    }
  }

  function resolveBrowserTab(tabId: string | undefined): PluginBrowserTab {
    if (tabId === undefined) {
      const active = browserTabs.find((tab) => tab.active);
      if (active === undefined) {
        throw browserError("no_active_tab", "No browser tab is active");
      }
      return active;
    }
    const tab = browserTabs.find((candidate) => candidate.tabId === tabId);
    if (tab === undefined) {
      throw browserError("unknown_tab", `No browser tab ${tabId}`);
    }
    return tab;
  }

  function requireLiveBrowserTab(tabId: string | undefined): PluginBrowserTab {
    const tab = resolveBrowserTab(tabId);
    if (!tab.live) {
      throw browserError(
        "tab_not_live",
        `Browser tab ${tab.tabId} has no live page`,
      );
    }
    return tab;
  }

  function readBrowserPageContent(tabId: string): FakeBrowserPageContent {
    return browserPageContent.get(tabId) ?? EMPTY_BROWSER_PAGE_CONTENT;
  }

  /**
   * Writes land back in the same store the reads come from, so a plugin test
   * can save state, clear it and load it again the way a real one would.
   */
  function writeBrowserPageContent(
    tabId: string,
    patch: Partial<FakeBrowserPageContent>,
  ): void {
    browserPageContent.set(tabId, {
      ...readBrowserPageContent(tabId),
      ...patch,
    });
  }

  function readBrowserStorageArea(
    tabId: string,
    area: PluginBrowserStorageArea,
  ): readonly PluginBrowserStorageItem[] {
    const content = readBrowserPageContent(tabId);
    return area === "local" ? content.localStorage : content.sessionStorage;
  }

  function writeBrowserStorageArea(
    tabId: string,
    area: PluginBrowserStorageArea,
    items: readonly PluginBrowserStorageItem[],
  ): void {
    writeBrowserPageContent(
      tabId,
      area === "local" ? { localStorage: items } : { sessionStorage: items },
    );
  }

  function browserPageStateOf(tabId: string | undefined): {
    tabId: string;
    url: string;
    title: string | null;
  } {
    const tab = requireLiveBrowserTab(tabId);
    return { tabId: tab.tabId, url: tab.url, title: tab.title };
  }

  function browserRoutesOf(tab: PluginBrowserTab): {
    tabId: string;
    url: string;
    title: string | null;
    routes: PluginBrowserRouteState[];
    offline: boolean;
  } {
    const content = readBrowserPageContent(tab.tabId);
    return {
      tabId: tab.tabId,
      url: tab.url,
      title: tab.title,
      routes: content.routes.map((route) => ({ ...route })),
      offline: content.offline,
    };
  }

  function activateBrowserTab(tabId: string): PluginBrowserTab {
    browserTabs = browserTabs.map((tab) => ({
      ...tab,
      active: tab.tabId === tabId,
    }));
    return resolveBrowserTab(tabId);
  }

  const omniboxProviders: FakeOmniboxProviderRecord[] = [];
  const downloadHandlers: PluginBrowserDownloadHandler[] = [];
  const contextMenuItems: PluginBrowserContextMenuItemRegistration[] = [];
  const findActions: PluginBrowserFindActionRegistration[] = [];
  const tabActions: PluginBrowserTabActionRegistration[] = [];
  const siteInfoProviders: PluginBrowserSiteInfoProviderRegistration[] = [];
  const toolbarItems: PluginBrowserToolbarItemRegistration[] = [];
  const newTabWidgets: PluginBrowserNewTabWidgetRegistration[] = [];
  const commands: PluginCommandRegistration[] = [];
  const searchEngines: PluginBrowserSearchEngineRegistration[] = [];
  const pageStyles: PluginBrowserPageStyleRegistration[] = [];
  const pageScripts: PluginBrowserPageScriptRegistration[] = [];
  const declaredSites = [...(options.sites ?? [])];
  const authProviders: PluginBrowserAuthProvider[] = [];
  const pdfTextProviders: PluginBrowserPdfTextProvider[] = [];
  const externalLinkHandlers: PluginBrowserExternalLinkHandler[] = [];
  const historyFilters: PluginBrowserHistoryFilter[] = [];
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
      if (typeof item?.id !== "string" || item.id.length === 0) {
        throw new Error("registerContextMenuItem needs an id");
      }
      if (typeof item.run !== "function") {
        throw new Error(
          `context menu item "${item.id}" must provide a run(context) function`,
        );
      }
      contextMenuItems.push(item);
    },
    registerFindAction(action) {
      assertLive();
      permissionGate.assert(
        "find.register",
        "patcher.browser.registerFindAction",
      );
      if (typeof action?.id !== "string" || action.id.length === 0) {
        throw new Error("registerFindAction needs an id");
      }
      if (typeof action.run !== "function") {
        throw new Error(
          `find action "${action.id}" must provide a run(context) function`,
        );
      }
      findActions.push(action);
    },
    registerTabAction(action) {
      assertLive();
      permissionGate.assert(
        "tabMenu.register",
        "patcher.browser.registerTabAction",
      );
      if (typeof action?.id !== "string" || action.id.length === 0) {
        throw new Error("registerTabAction needs an id");
      }
      if (typeof action.run !== "function") {
        throw new Error(
          `tab action "${action.id}" must provide a run(context) function`,
        );
      }
      tabActions.push(action);
    },
    registerSiteInfoProvider(provider) {
      assertLive();
      permissionGate.assert(
        "siteInfo.register",
        "patcher.browser.registerSiteInfoProvider",
      );
      if (typeof provider?.id !== "string" || provider.id.length === 0) {
        throw new Error("registerSiteInfoProvider needs an id");
      }
      if (typeof provider.describe !== "function") {
        throw new Error(
          `site info provider "${provider.id}" must provide a describe(context) function`,
        );
      }
      siteInfoProviders.push(provider);
    },
    registerToolbarItem(item) {
      assertLive();
      permissionGate.assert(
        "toolbar.register",
        "patcher.browser.registerToolbarItem",
      );
      if (typeof item?.id !== "string" || item.id.length === 0) {
        throw new Error("registerToolbarItem needs an id");
      }
      if (typeof item.title !== "string" || item.title.trim().length === 0) {
        throw new Error(`toolbar item "${item.id}" must provide a title`);
      }
      if (typeof item.run !== "function") {
        throw new Error(
          `toolbar item "${item.id}" must provide a run(context) function`,
        );
      }
      // The host's own refusal, so a plugin that wants two controls finds out
      // here rather than from a row that never appeared.
      if (toolbarItems.length > 0) {
        throw new Error(
          `toolbar item "${toolbarItems[0]?.id}" is already registered — a plugin may contribute one toolbar control`,
        );
      }
      toolbarItems.push(item);
    },
    registerNewTabWidget(widget) {
      assertLive();
      permissionGate.assert(
        "newTab.register",
        "patcher.browser.registerNewTabWidget",
      );
      if (typeof widget?.id !== "string" || widget.id.length === 0) {
        throw new Error("registerNewTabWidget needs an id");
      }
      if (
        typeof widget.label !== "string" ||
        widget.label.trim().length === 0
      ) {
        throw new Error(`new tab widget "${widget.id}" must provide a label`);
      }
      if (typeof widget.rows !== "function") {
        throw new Error(
          `new tab widget "${widget.id}" must provide a rows(context) function`,
        );
      }
      if (newTabWidgets.some((record) => record.id === widget.id)) {
        throw new Error(`new tab widget "${widget.id}" is already registered`);
      }
      newTabWidgets.push(widget);
    },
    registerSearchEngine(engine) {
      assertLive();
      permissionGate.assert(
        "searchEngine.register",
        "patcher.browser.registerSearchEngine",
      );
      if (typeof engine?.id !== "string" || engine.id.length === 0) {
        throw new Error("registerSearchEngine needs an id");
      }
      // The same refusal the host makes, so a plugin's test sees it too.
      if (normalizeBrowserSearchEngineTemplate(engine.urlTemplate) === null) {
        throw new Error(
          `search engine "${engine.id}" needs an https (or loopback) urlTemplate containing ${BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER}`,
        );
      }
      searchEngines.push(engine);
    },
    registerPageStyle(style) {
      assertLive();
      permissionGate.assert(
        "pageStyle.register",
        "patcher.browser.registerPageStyle",
      );
      if (typeof style?.id !== "string" || style.id.length === 0) {
        throw new Error("registerPageStyle needs an id");
      }
      if (pageStyles.some((record) => record.id === style.id)) {
        throw new Error(`page style "${style.id}" is already registered`);
      }
      if (
        typeof style.css !== "string" ||
        style.css.trim().length === 0 ||
        style.css.length > BROWSER_PAGE_STYLE_MAX_CSS_LENGTH
      ) {
        throw new Error(
          `page style "${style.id}" must provide css of up to ${BROWSER_PAGE_STYLE_MAX_CSS_LENGTH} characters`,
        );
      }
      if (!Array.isArray(style.matches) || style.matches.length === 0) {
        throw new Error(
          `page style "${style.id}" must match at least one of the plugin's declared sites`,
        );
      }
      // The same refusal the host makes, so a plugin's test sees it too: code
      // picks from `patcher.sites` and cannot widen it.
      for (const pattern of style.matches) {
        if (!declaredSites.includes(pattern)) {
          throw new Error(
            `page style "${style.id}" matches ${JSON.stringify(pattern)}, which plugin "${pluginId}" does not declare in "patcher.sites". ` +
              (declaredSites.length === 0
                ? "That list is empty — add the site there, or pass `sites` to createFakePluginHost."
                : `It declares: ${declaredSites.join(", ")}.`),
          );
        }
      }
      pageStyles.push(style);
    },
    registerPageScript(script) {
      assertLive();
      permissionGate.assert(
        "pageScript.register",
        "patcher.browser.registerPageScript",
      );
      if (typeof script?.id !== "string" || script.id.length === 0) {
        throw new Error("registerPageScript needs an id");
      }
      if (pageScripts.some((record) => record.id === script.id)) {
        throw new Error(`page script "${script.id}" is already registered`);
      }
      if (
        typeof script.code !== "string" ||
        script.code.trim().length === 0 ||
        script.code.length > BROWSER_PAGE_SCRIPT_MAX_CODE_LENGTH
      ) {
        throw new Error(
          `page script "${script.id}" must provide code of up to ${BROWSER_PAGE_SCRIPT_MAX_CODE_LENGTH} characters`,
        );
      }
      if (!Array.isArray(script.matches) || script.matches.length === 0) {
        throw new Error(
          `page script "${script.id}" must match at least one of the plugin's declared sites`,
        );
      }
      // Same refusal as the host's, for the same reason a page style's is here:
      // a plugin's own test is where widening `matches` should fail.
      for (const pattern of script.matches) {
        if (!declaredSites.includes(pattern)) {
          throw new Error(
            `page script "${script.id}" matches ${JSON.stringify(pattern)}, which plugin "${pluginId}" does not declare in "patcher.sites". ` +
              (declaredSites.length === 0
                ? "That list is empty — add the site there, or pass `sites` to createFakePluginHost."
                : `It declares: ${declaredSites.join(", ")}.`),
          );
        }
      }
      pageScripts.push(script);
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
      list() {
        beginBrowserCall("tabs.list", "tabs.read");
        return Promise.resolve(browserTabs.map((tab) => ({ ...tab })));
      },
      open(args) {
        beginBrowserCall("tabs.open", "tabs.modify", { ...args });
        const tabId = `fake-tab-${browserTabs.length + 1}`;
        const activate = args?.activate ?? true;
        const tab: PluginBrowserTab = {
          tabId,
          url: args?.url ?? "",
          title: null,
          active: activate,
          // A freshly opened tab has no page behind it until it is shown.
          live: false,
          loading: false,
          canGoBack: false,
          canGoForward: false,
        };
        browserTabs = activate
          ? [...browserTabs.map((each) => ({ ...each, active: false })), tab]
          : [...browserTabs, tab];
        return Promise.resolve({ ...tab });
      },
      close(args) {
        beginBrowserCall("tabs.close", "tabs.modify", { ...args });
        const tab = resolveBrowserTab(args.tabId);
        browserTabs = browserTabs.filter((each) => each.tabId !== tab.tabId);
        if (tab.active && browserTabs.length > 0) {
          browserTabs = browserTabs.map((each, index) => ({
            ...each,
            active: index === browserTabs.length - 1,
          }));
        }
        return Promise.resolve({
          closedTabId: tab.tabId,
          tabs: browserTabs.map((each) => ({ ...each })),
        });
      },
      activate(args) {
        beginBrowserCall("tabs.activate", "tabs.modify", { ...args });
        resolveBrowserTab(args.tabId);
        return Promise.resolve({ ...activateBrowserTab(args.tabId) });
      },
      // Pinning and muting are strip state the real browser holds and a
      // `PluginBrowserTab` does not carry, so the fake records the call — which
      // is what a plugin test can assert — and answers with the tab unchanged.
      pin(args) {
        beginBrowserCall("tabs.pin", "tabs.modify", { ...args });
        return Promise.resolve({ ...resolveBrowserTab(args.tabId) });
      },
      mute(args) {
        beginBrowserCall("tabs.mute", "tabs.modify", { ...args });
        return Promise.resolve({ ...resolveBrowserTab(args.tabId) });
      },
      move(args) {
        beginBrowserCall("tabs.move", "tabs.modify", { ...args });
        const moved = resolveBrowserTab(args.tabId);
        const rest = browserTabs.filter((each) => each.tabId !== moved.tabId);
        const toIndex = Math.min(Math.max(args.toIndex, 0), rest.length);
        browserTabs = [
          ...rest.slice(0, toIndex),
          moved,
          ...rest.slice(toIndex),
        ];
        return Promise.resolve({ ...moved });
      },
      duplicate(args) {
        beginBrowserCall("tabs.duplicate", "tabs.modify", { ...args });
        const source = resolveBrowserTab(args.tabId);
        const duplicate: PluginBrowserTab = {
          ...source,
          tabId: `fake-tab-${browserTabs.length + 1}`,
          active: true,
        };
        // Beside its source, where the real one puts it.
        const index = browserTabs.findIndex(
          (each) => each.tabId === source.tabId,
        );
        const rest = browserTabs.map((each) => ({ ...each, active: false }));
        browserTabs = [
          ...rest.slice(0, index + 1),
          duplicate,
          ...rest.slice(index + 1),
        ];
        return Promise.resolve({ ...duplicate });
      },
    },
    page: {
      snapshot(args) {
        beginBrowserCall("page.snapshot", "page.read", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        // A fake has no DOM to query, so a selector is recorded and not
        // resolved — what a plugin test can check is that the selector it meant
        // to send is the one that was sent.
        browserSnapshotGeneration += 1;
        const text = browserPageContent.get(tab.tabId)?.snapshot ?? "";
        return Promise.resolve({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          snapshot: text,
          generation: browserSnapshotGeneration,
          refCount: (text.match(/\[ref=e\d+\]/gu) ?? []).length,
          truncated: false,
        });
      },
      act(args) {
        beginBrowserCall("page.act", "page.interact", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        if (
          args?.generation !== undefined &&
          args.generation !== browserSnapshotGeneration
        ) {
          throw browserError(
            "stale_refs",
            "The page has changed since that snapshot",
          );
        }
        // Only when a snapshot was configured: a test that never set one is
        // exercising something else, and refusing every ref would only get in
        // its way.
        const snapshot = browserPageContent.get(tab.tabId)?.snapshot ?? "";
        const ref =
          args !== undefined && "ref" in args.action
            ? args.action.ref
            : undefined;
        if (
          typeof ref === "string" &&
          snapshot.length > 0 &&
          !snapshot.includes(`[ref=${ref}]`)
        ) {
          throw browserError("unknown_ref", `No element ${ref} on that page`);
        }
        return Promise.resolve({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
        });
      },
      screenshot(args) {
        beginBrowserCall("page.screenshot", "page.read", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const fullPage = args?.fullPage === true;
        return Promise.resolve({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          mimeType: args?.format === "png" ? "image/png" : "image/jpeg",
          base64: FAKE_BROWSER_SCREENSHOT_BASE64,
          width: 2,
          // A full-page capture answers with the document, so the fake makes it
          // taller than the viewport one — a test that cannot tell the two
          // apart is not testing that the flag arrived anywhere.
          height: fullPage ? 4 : 1,
          fullPage,
          truncated: false,
        });
      },
      pdf(args) {
        beginBrowserCall("page.pdf", "page.read", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        return Promise.resolve({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          base64: FAKE_BROWSER_PDF_BASE64,
          byteLength: 9,
        });
      },
      console(args) {
        beginBrowserCall("page.console", "page.read", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const all = browserPageContent.get(tab.tabId)?.console ?? [];
        return Promise.resolve({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          ...sliceBrowserLog(all, args?.limit),
        });
      },
      network(args) {
        beginBrowserCall("page.network", "network.observe", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const all = browserPageContent.get(tab.tabId)?.network ?? [];
        return Promise.resolve({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          ...sliceBrowserLog(all, args?.limit),
        });
      },
      handleDialog(args) {
        beginBrowserCall("page.handle_dialog", "page.interact", { ...args });
        resolveBrowserTab(args?.tabId);
        const answered = browserPendingDialog;
        browserPendingDialog = false;
        return Promise.resolve(answered);
      },
      zoom(args) {
        beginBrowserCall("page.zoom", "page.interact", { ...args });
        resolveBrowserTab(args.tabId);
        // Refused rather than clamped, because that is what the host does: the
        // command schema rejects a factor outside Chrome's range before anything
        // applies it. A double that clamped would let a plugin ship a call that
        // passes its own tests and fails in the app.
        if (args.factor < 0.25 || args.factor > 5) {
          throw new Error(
            `page.zoom factor ${args.factor} is outside the accepted 0.25-5`,
          );
        }
        return Promise.resolve(args.factor);
      },
      getUrl(args) {
        beginBrowserCall("page.get_url", "tabs.read", { ...args });
        return Promise.resolve(resolveBrowserTab(args?.tabId).url);
      },
      getTitle(args) {
        beginBrowserCall("page.get_title", "tabs.read", { ...args });
        return Promise.resolve(resolveBrowserTab(args?.tabId).title);
      },
      getText(args) {
        beginBrowserCall("page.get_text", "page.read", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const text = browserPageContent.get(tab.tabId)?.text ?? "";
        const maxLength = args?.maxLength;
        if (maxLength !== undefined && text.length > maxLength) {
          return Promise.resolve({
            text: text.slice(0, maxLength),
            truncated: true,
          });
        }
        return Promise.resolve({ text, truncated: false });
      },
      getSelection(args) {
        beginBrowserCall("page.get_selection", "page.read", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        return Promise.resolve({
          text: browserPageContent.get(tab.tabId)?.selection ?? "",
        });
      },
    },
    navigation: {
      open(args) {
        beginBrowserCall("navigation.open", "tabs.modify", { ...args });
        if (args.newTab === true) {
          return browser.tabs.open({ url: args.url, activate: true });
        }
        const tab = resolveBrowserTab(args.tabId);
        browserTabs = browserTabs.map((each) =>
          each.tabId === tab.tabId
            ? { ...each, url: args.url, title: null }
            : each,
        );
        return Promise.resolve(resolveBrowserTab(tab.tabId));
      },
      back(args) {
        beginBrowserCall("navigation.back", "tabs.modify", { ...args });
        return Promise.resolve({ ...requireLiveBrowserTab(args?.tabId) });
      },
      forward(args) {
        beginBrowserCall("navigation.forward", "tabs.modify", { ...args });
        return Promise.resolve({ ...requireLiveBrowserTab(args?.tabId) });
      },
      reload(args) {
        beginBrowserCall("navigation.reload", "tabs.modify", { ...args });
        return Promise.resolve({ ...requireLiveBrowserTab(args?.tabId) });
      },
    },
    storage: {
      cookies(args) {
        beginBrowserCall("storage.cookies", "page.credentials", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        return Promise.resolve({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          cookies: [...readBrowserPageContent(tab.tabId).cookies],
        });
      },
      setCookies(args) {
        beginBrowserCall("storage.setCookies", "page.credentials", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const existing = readBrowserPageContent(tab.tabId).cookies;
        const written = args.cookies.map((cookie) => ({
          domain: "",
          path: "/",
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: "Lax" as const,
          ...cookie,
        }));
        writeBrowserPageContent(tab.tabId, {
          cookies: [
            ...existing.filter(
              (cookie) =>
                !written.some((update) => update.name === cookie.name),
            ),
            ...written,
          ],
        });
        return Promise.resolve({ applied: written.length, rejected: 0 });
      },
      clearCookies(args) {
        beginBrowserCall("storage.clearCookies", "page.credentials", {
          ...args,
        });
        const tab = requireLiveBrowserTab(args?.tabId);
        const existing = readBrowserPageContent(tab.tabId).cookies;
        const kept =
          args?.name === undefined
            ? []
            : existing.filter((cookie) => cookie.name !== args.name);
        writeBrowserPageContent(tab.tabId, { cookies: kept });
        return Promise.resolve({ removed: existing.length - kept.length });
      },
      items(args) {
        beginBrowserCall("storage.items", "page.credentials", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        return Promise.resolve({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          area: args.area,
          items: [...readBrowserStorageArea(tab.tabId, args.area)],
          truncated: false,
        });
      },
      setItems(args) {
        beginBrowserCall("storage.setItems", "page.credentials", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const existing = readBrowserStorageArea(tab.tabId, args.area);
        writeBrowserStorageArea(tab.tabId, args.area, [
          ...existing.filter(
            (item) => !args.items.some((update) => update.name === item.name),
          ),
          ...args.items,
        ]);
        return Promise.resolve({ applied: args.items.length, rejected: 0 });
      },
      clearItems(args) {
        beginBrowserCall("storage.clearItems", "page.credentials", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const existing = readBrowserStorageArea(tab.tabId, args.area);
        const kept =
          args.name === undefined
            ? []
            : existing.filter((item) => item.name !== args.name);
        writeBrowserStorageArea(tab.tabId, args.area, kept);
        return Promise.resolve({ removed: existing.length - kept.length });
      },
    },
    control: {
      evaluate(args) {
        beginBrowserCall("control.evaluate", "page.inject", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        return Promise.resolve({
          tabId: tab.tabId,
          url: tab.url,
          title: tab.title,
          value: readBrowserPageContent(tab.tabId).evaluated,
          truncated: false,
        });
      },
      mouseMove(args) {
        beginBrowserCall("control.mouseMove", "page.interact", { ...args });
        return Promise.resolve(browserPageStateOf(args?.tabId));
      },
      mouseButton(args) {
        beginBrowserCall("control.mouseButton", "page.interact", { ...args });
        return Promise.resolve(browserPageStateOf(args?.tabId));
      },
      mouseWheel(args) {
        beginBrowserCall("control.mouseWheel", "page.interact", { ...args });
        return Promise.resolve(browserPageStateOf(args?.tabId));
      },
      route(args) {
        beginBrowserCall("control.route", "network.intercept", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const body = args?.body ?? "";
        // Newest first and one route per pattern, as the shell keeps them, so a
        // test can tell which of two overlapping mocks would answer.
        writeBrowserPageContent(tab.tabId, {
          routes: [
            {
              pattern: args.pattern,
              status: args.status ?? 200,
              contentType:
                args.contentType ??
                (/^\s*[[{]/u.test(body) ? "application/json" : "text/plain"),
              body,
              headers: args.headers ?? [],
              matched: 0,
            },
            ...readBrowserPageContent(tab.tabId).routes.filter(
              (route) => route.pattern !== args.pattern,
            ),
          ],
        });
        return Promise.resolve(browserRoutesOf(tab));
      },
      routes(args) {
        beginBrowserCall("control.routes", "network.intercept", { ...args });
        return Promise.resolve(
          browserRoutesOf(requireLiveBrowserTab(args?.tabId)),
        );
      },
      unroute(args) {
        beginBrowserCall("control.unroute", "network.intercept", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const pattern = args?.pattern;
        writeBrowserPageContent(tab.tabId, {
          routes:
            pattern === undefined
              ? []
              : readBrowserPageContent(tab.tabId).routes.filter(
                  (route) => route.pattern !== pattern,
                ),
        });
        return Promise.resolve(browserRoutesOf(tab));
      },
      setOffline(args) {
        beginBrowserCall("control.setOffline", "network.intercept", {
          ...args,
        });
        const tab = requireLiveBrowserTab(args?.tabId);
        writeBrowserPageContent(tab.tabId, { offline: args.offline });
        return Promise.resolve(browserPageStateOf(tab.tabId));
      },
    },
    recording: {
      traceStart(args) {
        beginBrowserCall("recording.traceStart", "page.record", { ...args });
        if (browserTraceFrom !== null) {
          throw browserError("already_recording", "A trace is already running");
        }
        // Where the log begins, in the calls this harness already records: a
        // plugin's trace then contains exactly the browser work it did next.
        browserTraceFrom = browserCalls.length;
        return Promise.resolve();
      },
      traceStop() {
        beginBrowserCall("recording.traceStop", "page.record");
        const from = browserTraceFrom;
        if (from === null) {
          throw browserError("not_recording", "No trace is running");
        }
        browserTraceFrom = null;
        return Promise.resolve({
          steps: browserCalls
            .slice(from, browserCalls.length - 1)
            .filter((call) => !call.type.startsWith("recording."))
            .map((call, index) => ({
              seq: index + 1,
              at: 0,
              command: call.type,
              detail: JSON.stringify(call.args),
              ok: true,
              error: null,
              image: null,
            })),
          droppedSteps: 0,
          droppedImages: 0,
          durationMs: 0,
        });
      },
      videoStart(args) {
        beginBrowserCall("recording.videoStart", "page.record", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        if (browserVideos.has(tab.tabId)) {
          throw browserError(
            "already_recording",
            `Browser tab ${tab.tabId} is already being filmed`,
          );
        }
        browserVideos.set(tab.tabId, []);
        return Promise.resolve();
      },
      videoChapter(args) {
        beginBrowserCall("recording.videoChapter", "page.record", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const chapters = browserVideos.get(tab.tabId);
        if (chapters === undefined) {
          throw browserError(
            "not_recording",
            `Browser tab ${tab.tabId} is not being filmed`,
          );
        }
        chapters.push({ at: 0, title: args.title });
        return Promise.resolve();
      },
      videoStop(args) {
        beginBrowserCall("recording.videoStop", "page.record", { ...args });
        const tab = requireLiveBrowserTab(args?.tabId);
        const chapters = browserVideos.get(tab.tabId);
        if (chapters === undefined) {
          throw browserError(
            "not_recording",
            `Browser tab ${tab.tabId} is not being filmed`,
          );
        }
        browserVideos.delete(tab.tabId);
        return Promise.resolve({
          ...browserPageStateOf(tab.tabId),
          frames: readBrowserPageContent(tab.tabId).frames.map((frame) => ({
            ...frame,
          })),
          chapters,
          droppedFrames: 0,
          durationMs: 0,
        });
      },
    },
    getStatus() {
      return {
        connected: browserConnected,
        windowCount: browserConnected ? 1 : 0,
      };
    },
  };

  const browserDrivers: FakeBrowserDrivers = {
    setTabs(tabs) {
      browserTabs = tabs.map((tab, index) => ({
        tabId: tab.tabId,
        url: tab.url ?? "",
        title: tab.title ?? null,
        active: tab.active ?? index === 0,
        live: tab.live ?? true,
        loading: tab.loading ?? false,
        canGoBack: tab.canGoBack ?? false,
        canGoForward: tab.canGoForward ?? false,
      }));
    },
    setPageContent(tabId, content) {
      const existing =
        browserPageContent.get(tabId) ?? EMPTY_BROWSER_PAGE_CONTENT;
      browserPageContent.set(tabId, {
        text: content.text ?? existing.text,
        selection: content.selection ?? existing.selection,
        snapshot: content.snapshot ?? existing.snapshot,
        console: content.console ?? existing.console,
        network: content.network ?? existing.network,
        cookies: content.cookies ?? existing.cookies,
        localStorage: content.localStorage ?? existing.localStorage,
        sessionStorage: content.sessionStorage ?? existing.sessionStorage,
        evaluated: content.evaluated ?? existing.evaluated,
        routes: existing.routes,
        offline: existing.offline,
        frames: content.frames ?? existing.frames,
      });
    },
    setConnected(connected) {
      browserConnected = connected;
    },
    setPendingDialog(pending) {
      browserPendingDialog = pending;
    },
    failNextCall(code, message) {
      browserNextFailure = {
        code,
        message: message ?? `browser command failed: ${code}`,
      };
    },
  };

  // --- status ---
  const needsConfigurationMessages: string[] = [];
  const status: PluginStatusApi = {
    needsConfiguration(message) {
      assertLive();
      needsConfigurationMessages.push(
        typeof message === "string" && message.length > 0
          ? message
          : "needs configuration",
      );
    },
  };

  // --- server ---
  const loopbackBaseUrl = options.loopbackBaseUrl ?? "http://127.0.0.1:38986";
  const server: PluginServerApi = {
    get loopbackBaseUrl(): string {
      assertLive();
      return loopbackBaseUrl;
    },
  };

  // --- sdk ---
  const { sdk, harness: sdkHarness } = createFakeSdk({
    pluginId,
    overrides: options.sdk,
    permissions: permissionGate,
  });

  // --- thread events / dispose ---
  const threadEventHandlers: {
    [E in PluginThreadEventName]: Array<PluginThreadEventHandler<E>>;
  } = {
    "thread.created": [],
    "thread.active": [],
    "thread.idle": [],
    "thread.failed": [],
    "thread.archived": [],
    "thread.deleted": [],
  };
  const disposeHooks: Array<() => void | Promise<void>> = [];
  const serviceControllers: AbortController[] = [];
  let nextInteractionId = 1;
  const pendingInteractions = new Map<
    string,
    {
      request: PluginInteractionRequest;
      resolve: (result: PluginInteractionResult) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function requestInput(
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
      if (error instanceof Error && error.message.includes("64 KiB")) {
        throw error;
      }
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
    const normalizedRequest: PluginInteractionRequest = {
      ...request,
      title: request.title.trim(),
      payload,
      timeoutMs,
    };
    const id = `fake-interaction-${nextInteractionId++}`;
    return new Promise<PluginInteractionResult>((resolve) => {
      const settleAborted = () => {
        const pending = pendingInteractions.get(id);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingInteractions.delete(id);
        resolve({ outcome: "cancelled", reason: "request-aborted" });
      };
      requestOptions?.signal?.addEventListener("abort", settleAborted, {
        once: true,
      });
      const timer = setTimeout(() => {
        pendingInteractions.delete(id);
        resolve({ outcome: "cancelled", reason: "timeout" });
      }, timeoutMs);
      pendingInteractions.set(id, {
        request: normalizedRequest,
        resolve,
        timer,
      });
    });
  }

  const events: PluginEvents = {
    on(event, handler) {
      assertLive();
      const handlers = threadEventHandlers[event];
      if (handlers === undefined) {
        throw new Error(
          `unknown event "${String(event)}" — supported events: ${Object.keys(
            threadEventHandlers,
          ).join(", ")}`,
        );
      }
      handlers.push(handler);
    },
  };

  const patcher: PatcherPluginApi = {
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
    get sdk() {
      assertLive();
      return sdk;
    },
    onDispose(hook) {
      assertLive();
      disposeHooks.push(hook);
    },
  };

  async function disposeHost(cleanupStorage: boolean): Promise<void> {
    if (disposed) return;
    disposed = true;
    for (const [id, pending] of pendingInteractions) {
      clearTimeout(pending.timer);
      pendingInteractions.delete(id);
      pending.resolve({ outcome: "cancelled", reason: "plugin-disposed" });
    }
    // Host order (§3): services first, then hooks LIFO (isolated), then
    // vended database handles, then handle invalidation.
    for (const controller of serviceControllers) controller.abort();
    for (const hook of [...disposeHooks].reverse()) {
      try {
        await hook();
      } catch (error) {
        emitLog("warn", `dispose hook failed: ${errorMessage(error)}`);
      }
    }
    if (databaseHandle) {
      try {
        databaseHandle.close();
      } catch (error) {
        emitLog("warn", `database close failed: ${errorMessage(error)}`);
      }
    }
    if (cleanupStorage) {
      rmSync(storageRoot, { recursive: true, force: true });
    }
    invalidated = true;
  }

  const harness: FakePluginHarness = {
    get behavior() {
      return this;
    },
    get inspection() {
      return this;
    },
    get lifecycle() {
      return this;
    },
    pluginId,
    logEntries,
    realtimeSignals,
    needsConfigurationMessages,
    sdk: sdkHarness,
    registrations: {
      settingsDescriptors,
      httpRoutes,
      get rpcMethods() {
        return [...rpcHandlers.keys()];
      },
      services,
      schedules,
      get cli() {
        return cliRecord.registration;
      },
      agentTools,
      get agentConfigurationProvider() {
        return agentConfigurationProvider;
      },
      get instructionProvider() {
        return instructionProvider;
      },
      get threadEventHandlers() {
        return {
          "thread.created": threadEventHandlers["thread.created"].length,
          "thread.active": threadEventHandlers["thread.active"].length,
          "thread.idle": threadEventHandlers["thread.idle"].length,
          "thread.failed": threadEventHandlers["thread.failed"].length,
          "thread.archived": threadEventHandlers["thread.archived"].length,
          "thread.deleted": threadEventHandlers["thread.deleted"].length,
        };
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
    },
    get pendingInteractions() {
      return [...pendingInteractions].map(([id, pending]) => ({
        id,
        ...pending.request,
      }));
    },
    get browserCalls() {
      return [...browserCalls];
    },
    browser: browserDrivers,
    submitInteraction(id, value) {
      const pending = pendingInteractions.get(id);
      if (!pending) throw new Error(`no pending interaction "${id}"`);
      clearTimeout(pending.timer);
      pendingInteractions.delete(id);
      pending.resolve({ outcome: "submitted", value });
    },
    cancelInteraction(id) {
      const pending = pendingInteractions.get(id);
      if (!pending) throw new Error(`no pending interaction "${id}"`);
      clearTimeout(pending.timer);
      pendingInteractions.delete(id);
      pending.resolve({ outcome: "cancelled", reason: "user" });
    },

    async setSettings(values) {
      const errors = validateSettingsUpdate(settingsDescriptors, values);
      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }
      const prev = readSettingsValues(settingsDescriptors, storedSettings);
      for (const [key, value] of Object.entries(values)) {
        if (value === null) storedSettings.delete(key);
        else storedSettings.set(key, value);
      }
      const next = readSettingsValues(settingsDescriptors, storedSettings);
      if (JSON.stringify(next) === JSON.stringify(prev)) return;
      for (const listener of settingsListeners) {
        try {
          listener(next, prev);
        } catch (error) {
          emitLog(
            "warn",
            `settings onChange listener failed: ${errorMessage(error)}`,
          );
        }
      }
    },

    async callRpc(method, input) {
      const record = rpcHandlers.get(method);
      if (!record) {
        return throwRpcError({
          code: "unknown_method",
          message: `plugin "${pluginId}" has no rpc method "${method}"`,
        });
      }
      const parsedInput =
        input === undefined
          ? null
          : jsonRoundTrip(input, `rpc "${method}" input`);
      const validatedInput = await validateRpcValue(
        record.inputSchema,
        parsedInput,
        "input",
      );
      let result: unknown;
      try {
        result = await record.handler(validatedInput as never);
      } catch (error) {
        return throwRpcError({
          code: "handler_error",
          message: errorMessage(error),
        });
      }
      const validatedOutput = await validateRpcValue(
        record.outputSchema,
        result,
        "output",
      );
      return normalizeRpcJsonResult(validatedOutput);
    },

    async runCli(argv, ctx = {}) {
      const registration = cliRecord.registration;
      if (!registration) {
        throw new Error(`plugin "${pluginId}" registers no CLI command`);
      }
      try {
        const result = await registration.run(argv, ctx);
        if (typeof result?.exitCode !== "number") {
          throw new Error(
            "cli run() must return { exitCode: number, stdout?, stderr? }",
          );
        }
        return enforcePluginCliOutputLimit(
          {
            exitCode: result.exitCode,
            stdout: typeof result.stdout === "string" ? result.stdout : "",
            stderr: typeof result.stderr === "string" ? result.stderr : "",
          },
          argv.includes("--json"),
        );
      } catch (error) {
        return enforcePluginCliOutputLimit(
          {
            exitCode: 1,
            stdout: "",
            stderr: `patcher ${registration.name} failed: ${errorMessage(error)}`,
          },
          argv.includes("--json"),
        );
      }
    },

    async fetchHttp(method, path, init) {
      const normalizedMethod = String(method).toUpperCase();
      const pathname = new URL(path, "http://plugin.test").pathname;
      const route = httpRoutes.find(
        (candidate) =>
          candidate.method === normalizedMethod && candidate.path === pathname,
      );
      if (!route) {
        throw new Error(
          `no http route ${normalizedMethod} ${pathname} is registered — ` +
            `registered: ${
              httpRoutes.map((r) => `${r.method} ${r.path}`).join(", ") ||
              "(none)"
            }`,
        );
      }
      const app = new Hono();
      app.on(route.method, route.path, async (context) => {
        try {
          const response = await route.handler(context);
          // Structural, exactly as the real host checks it. `instanceof` is
          // wrong here: `@hono/node-server` replaces `globalThis.Response`
          // with a class of its own when a server starts listening, and after
          // that `Response.json({}) instanceof Response` is false — so a
          // plugin's own tests would fail on a route the real server accepts.
          // Duplicated rather than imported because the server's copy lives in
          // a package this one only depends on for types.
          if (!isResponseLike(response)) {
            throw new Error("http route handler must return a Response");
          }
          return response;
        } catch (error) {
          const message = errorMessage(error);
          emitLog(
            "warn",
            `http ${route.method} ${route.path} failed: ${message}`,
          );
          return context.json(
            { ok: false, error: `plugin route failed: ${message}` },
            500,
          );
        }
      });
      return app.request(path, { ...init, method: normalizedMethod });
    },

    runService(name) {
      const service = services.find((record) => record.name === name);
      if (!service) {
        throw new Error(`no background service "${name}" is registered`);
      }
      const controller = new AbortController();
      serviceControllers.push(controller);
      // start() runs synchronously (like the host's post-factory start), so
      // it observes an abort() issued right after runService returns.
      let started: Promise<void>;
      try {
        started = Promise.resolve(service.start(controller.signal)).then(
          () => undefined,
        );
      } catch (error) {
        started = Promise.reject(error);
      }
      const done = started.catch((error: unknown) => {
        if (isNeedsConfigurationError(error)) {
          needsConfigurationMessages.push(error.message);
          return undefined;
        }
        throw error;
      });
      return { controller, done };
    },

    async runSchedule(name) {
      const schedule = schedules.find((record) => record.name === name);
      if (!schedule) {
        throw new Error(`no schedule "${name}" is registered`);
      }
      await schedule.fn();
    },

    async emitThreadEvent(event, payload) {
      const errors: unknown[] = [];
      for (const handler of [...threadEventHandlers[event]]) {
        try {
          await handler(payload);
        } catch (error) {
          errors.push(error);
          emitLog("warn", `${event} handler failed: ${errorMessage(error)}`);
        }
      }
      return { errors };
    },

    async callAgentTool(name, input, ctx) {
      const record = agentTools.find((tool) => tool.name === name);
      if (!record) {
        throw new Error(`no agent tool "${name}" is registered`);
      }
      const parsed = record.parse(input);
      if (!parsed.ok) {
        throw new Error(
          `tool "${name}" arguments are invalid: ${parsed.error}`,
        );
      }
      return record.execute(parsed.value, {
        threadId: ctx?.threadId ?? "thread-test",
        projectId: ctx?.projectId ?? "project-test",
        signal: ctx?.signal ?? new AbortController().signal,
      });
    },

    async resolveAgentConfiguration(context) {
      if (agentConfigurationProvider === null) {
        return {
          tools: [...agentTools],
          skills: [...agentSkillIds],
          instructions: null,
        };
      }
      try {
        const normalized = normalizeAgentConfiguration({
          knownSkillIds: new Set(agentSkillIds),
          knownToolIds: new Set(agentTools.map((tool) => tool.name)),
          pluginId,
          value: agentConfigurationProvider(context),
        });
        const selectedTools = new Set(normalized.toolIds);
        return {
          tools: agentTools
            .filter((tool) => selectedTools.has(tool.name))
            .map((tool) => {
              const parameters = normalized.toolParameterOverrides.get(
                tool.name,
              );
              return parameters === undefined
                ? tool
                : { ...tool, inputSchema: parameters };
            }),
          skills: normalized.skillIds,
          instructions: normalized.instructions,
        };
      } catch (error) {
        emitLog("warn", `agent configure failed: ${errorMessage(error)}`);
        return { tools: [], skills: [], instructions: null };
      }
    },

    async reload(factory) {
      assertLive();
      const replacement = createFakePluginHostInternal(
        options,
        persistentState,
      );
      try {
        await factory(replacement.patcher);
      } catch (error) {
        await fakeHostDisposers.get(replacement.harness)?.(false);
        throw error;
      }
      await disposeHost(false);
      return replacement;
    },

    async dispose() {
      await disposeHost(true);
    },
  };

  fakeHostDisposers.set(harness, disposeHost);
  return { patcher, harness };
}
