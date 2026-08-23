import { watch } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { CronExpressionParser } from "cron-parser";
import type { Context } from "hono";
import {
  canonicalPermissions,
  CUSTOM_THEME_CSS_MAX_LENGTH,
  formatPluginThemeId,
  type AppKeybindingOverride,
  type AppKeybindingOverrides,
  type JsonValue,
  type PluginPermission,
  type PluginThemeMeta,
  type ToolCallResponse,
} from "@patcher/domain";
import {
  PLUGIN_CLI_OUTPUT_MAX_BYTES,
  type PluginBrowserAuthChallenge,
  type PluginBrowserPdfDocument,
  type PluginBrowserExternalLink,
  type PluginBrowserExternalLinkDecision,
  type PluginBrowserAuthCredentials,
  type PluginBrowserContextMenuContext,
  type PluginBrowserSiteInfoContext,
  type PluginBrowserTabActionContext,
  type PluginBrowserToolbarContext,
  type PluginBrowserNewTabContext,
  type PluginBrowserDownload,
  type PluginBrowserFindContext,
  type PluginCliExecutionResult,
  type PluginCliOutputLimitError,
  type PluginRpcError,
} from "@patcher/plugin-sdk";
// The build engine's natives (esbuild, Tailwind oxide) are dynamically
// imported inside buildPluginApp — importing this loads nothing heavy.
import { buildPluginApp, createPluginDevLoop } from "@patcher/plugin-build";
import { getPluginBuildToolchain } from "./build-toolchain.js";
import {
  deleteSecretFile,
  readOrCreateSecretFile,
} from "@patcher/secret-storage";
import type { PluginCapabilitySummary } from "@patcher/server-contract";
import {
  claimPluginScheduledRun,
  deleteAllPluginSettings,
  deleteInstalledPlugin,
  deletePluginSchedules,
  getInstalledPlugin,
  listDuePluginSchedules,
  listInstalledPlugins,
  listPluginSchedules,
  markInstalledPluginRemoved,
  recordPluginScheduleResult,
  setInstalledPluginEnabled,
  type InstalledPluginRow,
} from "@patcher/db";
import {
  getLastThreadErrorMessage,
  getLastThreadOutput,
} from "../threads/thread-data.js";
import type { PluginBrandingAssetVariant } from "./app-bundle.js";
import { npmInstallPrefix, parsePluginSource } from "./install-sources.js";
import {
  derivePluginId,
  readPluginManifest,
  type PluginManifest,
} from "./manifest.js";
import { listBundledPluginRegistrations } from "./builtin-registry.js";
import {
  RESERVED_AGENT_TOOL_NAMES,
  type PatcherPluginApi,
  type PluginAgentConfigurationContext,
  type PluginAgentToolContext,
  type PluginAgentToolRecord,
  type PluginBrowserHistoryVisit,
  type PluginCliContext,
  type PluginHttpRouteRecord,
  type PluginMentionTrigger,
  type PluginRpcHandler,
} from "./plugin-api.js";
import {
  syncPluginCommandsSkill,
  type PluginCliContribution,
} from "./plugin-commands-skill.js";
import {
  applyBrowserHistoryRewrite,
  normalizeBrowserHistoryDecision,
} from "./plugin-history-filter.js";
import { readBrowserExternalLinkDecision } from "./plugin-external-link.js";
import { isResponseLike } from "./plugin-http-message.js";
import { rpcBoundaryError, runRpcCall } from "./plugin-rpc-call.js";
import { readPluginLogTail } from "./plugin-log.js";
import {
  buildPluginSettingsView,
  pluginSecretsDir,
  readPluginSettingsValues,
  validatePluginSettingsUpdate,
  writePluginSettingsUpdate,
  PluginSettingsValidationError,
  type PluginSettingsView,
} from "./plugin-settings.js";
import { createPluginActivation } from "./plugin-activation.js";
import {
  createManagedPluginArtifacts,
  type RegisterInstalledArgs,
} from "./managed-plugin-artifacts.js";
import { createPluginRegistration } from "./plugin-registration.js";
import { createPluginRuntime, forgetMutableRoot } from "./plugin-runtime.js";
import type { PluginApiIdentities } from "./plugin-api-identity.js";
import { createPluginUpdates } from "./plugin-updates.js";

import { pluginUpdateCheckEntrySchema } from "./plugin-service-internal.js";
import type {
  LoadedPlugin,
  PluginAgentToolContribution,
  PluginApplyUpdateOutcome,
  PluginInstructionContribution,
  PluginListEntry,
  PluginMentionProviderContribution,
  PluginMentionResolveResult,
  PluginMentionSearchGroup,
  PluginMentionSearchItem,
  PluginContextMenuItemContribution,
  PluginPageScriptContribution,
  PluginPageStyleContribution,
  PluginSearchEngineContribution,
  PluginSiteInfoSection,
  PluginTabActionContribution,
  PluginToolbarItemContribution,
  PluginToolbarItemState,
  PluginNewTabSection,
  PluginNewTabWidgetContribution,
  PluginCommandContribution,
  PluginFindActionContribution,
  PluginOmniboxProviderContribution,
  PluginOmniboxRunOutcome,
  PluginOmniboxSuggestGroup,
  PluginOmniboxSuggestItem,
  PluginServiceDeps,
  PluginSourceView,
  PluginThreadEventEmitter,
  PluginUpdateCheckEntry,
  PluginWireLookup,
  PluginResolvedAgentConfiguration,
} from "./plugin-service-internal.js";
export type {
  PluginAgentToolContribution,
  PluginApplyUpdateOutcome,
  PluginApplyUpdateResult,
  PluginHandlerStats,
  PluginInstructionContribution,
  PluginResolvedAgentConfiguration,
  PluginListEntry,
  PluginMentionProviderContribution,
  PluginMentionResolveResult,
  PluginMentionSearchGroup,
  PluginMentionSearchItem,
  PluginContextMenuItemContribution,
  PluginPageScriptContribution,
  PluginPageStyleContribution,
  PluginSearchEngineContribution,
  PluginSiteInfoSection,
  PluginTabActionContribution,
  PluginToolbarItemContribution,
  PluginToolbarItemState,
  PluginNewTabSection,
  PluginNewTabWidgetContribution,
  PluginCommandContribution,
  PluginFindActionContribution,
  PluginOmniboxProviderContribution,
  PluginOmniboxRunOutcome,
  PluginOmniboxSuggestGroup,
  PluginOmniboxSuggestItem,
  PluginRuntimeStatus,
  PluginScheduleEntry,
  PluginServiceDeps,
  PluginServiceEntry,
  PluginServiceState,
  PluginSourceView,
  PluginThreadEventEmitter,
  PluginUpdateCheckEntry,
  PluginWireLookup,
} from "./plugin-service-internal.js";

export interface PluginSkillRootContribution {
  pluginId: string;
  rootPath: string;
}

export interface PluginService {
  /** Whether this installed plugin has builtin provenance. */
  isBuiltin(id: string): boolean;
  /** Thread lifecycle event emitter, called from the lifecycle seams. */
  events: PluginThreadEventEmitter;
  /**
   * Bind the in-process Patcher SDK to the running server. Call once the HTTP
   * listener is up, before start(): patcher.sdk throws until this runs.
   */
  bindSdk(args: { baseUrl: string }): void;
  /** Load all enabled plugins. Call after the HTTP listener is up. */
  start(): Promise<void>;
  /** Dispose all loaded plugins (server shutdown). */
  stop(): Promise<void>;
  list(): PluginListEntry[];
  /** Palettes declared by currently loaded plugins, ordered by plugin id. */
  listThemes(): PluginThemeMeta[];
  /** Read a loaded plugin palette by its globally namespaced id. */
  readThemeCss(themeId: string): Promise<string | null>;
  /**
   * Install from a source spec: `path:<dir>` (bare paths accepted),
   * `git:<url-ish>@<ref>` (ref required; cloned into the managed dir under
   * <dataDir>/plugins/git), or `npm:<name>[@<version|tag|range>]` (installed
   * with npm --ignore-scripts under <dataDir>/plugins/npm). git/npm installs
   * hard-fail on an engines.patcher mismatch and refuse already-registered ids;
   * use update for an existing managed plugin.
   */
  install(source: string): Promise<PluginListEntry>;
  /**
   * Install a bundled official plugin by its registry name (store install).
   * Registers with catalog provenance so the opt-in survives reconciliation.
   */
  installOfficialPlugin(name: string): Promise<PluginListEntry>;
  installPath(path: string): Promise<PluginListEntry>;
  checkForUpdates(id?: string): Promise<PluginUpdateCheckEntry[]>;
  listUpdateResults(): PluginUpdateCheckEntry[];
  getSource(id: string): Promise<PluginSourceView | undefined>;
  applyUpdate(id: string): Promise<PluginApplyUpdateOutcome>;
  remove(id: string): Promise<boolean>;
  setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<PluginListEntry | undefined>;
  reload(id?: string): Promise<void>;
  /** Live API handle for a running plugin (used by later phases and tests). */
  getApi(id: string): PatcherPluginApi | undefined;
  /**
   * On-disk asset backing GET /plugins/:id/assets/app.{js,css}: file path
   * plus the current content hash (the route compares ?h against it for
   * cache policy). Undefined when the plugin has no loadable bundle, or no
   * CSS for kind "css".
   */
  getAppAsset(
    id: string,
    kind: "js" | "css",
  ): { path: string; hash: string } | undefined;
  /** Immutable byte snapshot backing one plugin branding asset route. */
  getBrandingAsset(
    id: string,
    variant: PluginBrandingAssetVariant,
  ): { bytes: Uint8Array; contentType: string; hash: string } | undefined;
  /**
   * Declared settings schema + current values for a loaded plugin
   * (secrets render as `{ set: boolean }`). Undefined when the plugin is not
   * running — the schema only exists after its factory ran.
   */
  getSettings(id: string): Promise<PluginSettingsView | undefined>;
  /**
   * Validate and persist a settings update (`null` unsets a key), firing the
   * plugin's onChange listeners when effective values changed. Throws
   * PluginSettingsValidationError on unknown keys or type mismatches.
   */
  updateSettings(
    id: string,
    values: Record<string, unknown>,
  ): Promise<PluginSettingsView | undefined>;
  /** Live http route lookup for the boot-time dispatcher (exact method+path). */
  getHttpRoute(
    id: string,
    method: string,
    path: string,
  ): PluginWireLookup<PluginHttpRouteRecord>;
  /** Live rpc handler lookup for the boot-time dispatcher. */
  getRpcHandler(id: string, method: string): PluginWireLookup<PluginRpcHandler>;
  /**
   * Run an http route handler wrapped in the plugin failure-isolation
   * discipline (caught, logged, timed into handlerStats). A throwing or
   * non-Response-returning handler maps to a 500 JSON error response.
   */
  invokeHttpRoute(
    id: string,
    route: PluginHttpRouteRecord,
    context: Context,
  ): Promise<Response>;
  /**
   * Validate RPC input, run the handler with failure isolation, validate its
   * output, then normalize it as strict JSON for the response envelope.
   */
  invokeRpcHandler(
    id: string,
    method: string,
    handler: PluginRpcHandler,
    input: unknown,
  ): Promise<
    { ok: true; result: JsonValue } | { ok: false; error: PluginRpcError }
  >;
  /**
   * Per-plugin secret for auth "token" routes, generated on first use and
   * stored under <dataDir>/plugins/<id>/secrets/. `rotate` replaces it.
   * Undefined when the plugin is not installed.
   */
  httpToken(
    id: string,
    options?: { rotate?: boolean },
  ): Promise<string | undefined>;
  /**
   * Which plugin an `/api/v1` request belongs to, for the permission gate on
   * that traffic. Separate from {@link httpToken}, which is the credential
   * *inbound* callers present to reach a plugin's own routes — one identifies
   * Patcher to the plugin's callers, this identifies the plugin to Patcher.
   */
  readonly apiIdentities: PluginApiIdentities;
  /**
   * Why this plugin may not reach an `/api/v1` path, or null when it may.
   *
   * `required` comes from {@link permissionsForApiPath}; `null` there means the
   * path is not classified, which is refused rather than allowed — an
   * unclassified route is one nobody decided about.
   */
  apiPermissionProblem(
    pluginId: string,
    required: readonly PluginPermission[] | null,
  ): string | null;
  /**
   * CLI command metadata for GET /plugins/contributions: fast, no plugin
   * code execution. Sorted by plugin id.
   */
  listCliContributions(): PluginCliContribution[];
  /**
   * Run a plugin's registered CLI command wrapped in the failure-isolation
   * discipline. Never throws for dispatch problems: an unknown / not-running
   * plugin, closed experiment gate, missing registration, throwing handler, or
   * malformed handler result all map to exitCode 1 with a helpful stderr —
   * the Patcher CLI prints stderr and exits with exitCode.
   */
  runCliCommand(
    id: string,
    argv: string[],
    ctx: PluginCliContext,
  ): Promise<PluginCliExecutionResult>;
  /**
   * Skills roots of running plugins (manifest patcher.skills or the skills/
   * convention dir), ordered by plugin id — the "plugin" precedence tier
   * passed to resolveInjectedSkillSources per turn. Missing directories are
   * tolerated downstream.
   */
  listSkillRootContributions(): PluginSkillRootContribution[];
  /**
   * Native tools of running plugins (patcher.agents.registerTool), ordered by
   * plugin id then registration order, deduped defensively (first wins —
   * registration already blocks collisions). Appended to a session's
   * dynamicTools at thread.start/turn.submit time; changes apply on the
   * NEXT session start.
   */
  listAgentTools(): PluginAgentToolContribution[];
  /**
   * Evaluate each plugin's optional `patcher.agents.configure` callback for one
   * server-owned thread/session boundary. Registrations stay static; invalid
   * or throwing callbacks fail closed for that plugin and cannot affect peers.
   */
  resolveAgentConfiguration(args: {
    context: PluginAgentConfigurationContext;
    skillIdsByPlugin: ReadonlyMap<string, readonly string[]>;
  }): Promise<PluginResolvedAgentConfiguration>;
  /**
   * Dynamic instruction providers from patcher.agents.contributeInstructions,
   * ordered by plugin id. Resolved live at thread.start/turn.submit;
   * empty when no plugin registered a provider.
   * At most one provider per plugin (duplicate registration is rejected).
   */
  listInstructionContributions(): PluginInstructionContribution[];
  /** Resolve one registered native tool by name (same view as listAgentTools). */
  findAgentTool(
    name: string,
  ): { pluginId: string; record: PluginAgentToolRecord } | undefined;
  /**
   * Run a native tool call (design §4.4). Invalid arguments (zod-backed
   * registrations) return an isError tool result without touching the
   * plugin; execute runs through invokeWrapped, so a throwing or
   * malformed-result handler maps to an isError tool result too.
   */
  invokeAgentTool(args: {
    pluginId: string;
    record: PluginAgentToolRecord;
    input: unknown;
    ctx: PluginAgentToolContext;
  }): Promise<ToolCallResponse>;
  /**
   * Mention providers of running plugins (patcher.ui.registerMentionProvider),
   * ordered by plugin id then registration order, for
   * GET /plugins/contributions. No plugin code runs.
   */
  listMentionProviderContributions(): PluginMentionProviderContribution[];
  /**
   * Run every loaded plugin's mention providers against one composer query
   * (design §4.9). Providers run concurrently, each wrapped in the
   * failure-isolation discipline (invokeWrapped) and time-boxed (2s); a
   * slow, throwing, or malformed provider contributes an empty group.
   * Groups are ordered by plugin id, then registration order; empty groups
   * are dropped. Item ids are namespaced "<providerId>:<item id>".
   */
  searchMentions(args: {
    trigger: PluginMentionTrigger;
    query: string;
    projectId: string | null;
    threadId: string | null;
  }): Promise<PluginMentionSearchGroup[]>;
  /**
   * Resolve one plugin mention at send time (design §4.9). `itemId` is the
   * wire-composed "<providerId>:<item id>" from searchMentions. Runs the
   * provider's resolve through invokeWrapped; any dispatch or handler
   * problem maps to `{ ok: false, error }` so the send path can block with
   * a clear error.
   */
  resolveMention(args: {
    pluginId: string;
    itemId: string;
  }): Promise<PluginMentionResolveResult>;
  /**
   * Omnibox providers of running plugins (patcher.browser.registerOmniboxProvider),
   * ordered by plugin id then registration order, for
   * GET /plugins/contributions. No plugin code runs.
   */
  listOmniboxProviderContributions(): PluginOmniboxProviderContribution[];
  /**
   * Keyboard shortcuts plugins contributed (`patcher.ui.registerKeybinding`), for
   * the system config to fold under the user's own overrides. Ordered by plugin
   * id and deduplicated, so a command two plugins both bind resolves to the
   * lowest plugin id rather than to whichever loaded first. No plugin code
   * runs.
   */
  listKeybindingContributions(): AppKeybindingOverrides;
  /**
   * Context-menu entries plugins contributed
   * (`browser.contextMenu.items`), for the app to hand to the shell. Ordered
   * by plugin id, then registration order. No plugin code runs.
   */
  listContextMenuItemContributions(): PluginContextMenuItemContribution[];
  /**
   * Run a picked context-menu item. Time-boxed and failure-isolated like every
   * other plugin call; nothing waits on it, since the menu closed when the user
   * clicked.
   */
  runContextMenuItem(args: {
    pluginId: string;
    itemId: string;
    context: PluginBrowserContextMenuContext;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Find-bar buttons plugins contributed (`browser.find.actions`), for the
   * browser's find bar to render after its own controls. Ordered by plugin id,
   * then registration order. No plugin code runs.
   */
  listFindActionContributions(): PluginFindActionContribution[];
  /**
   * Run a pressed find-bar button. A deliberate user action like a picked menu
   * item, so it takes the same time box and the same failure isolation; the bar
   * does not wait on it.
   */
  runFindAction(args: {
    pluginId: string;
    itemId: string;
    context: PluginBrowserFindContext;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Ask every registered site-info provider what it knows about the page whose
   * padlock was clicked (`browser.siteInfo.sections`).
   *
   * Concurrent, like omnibox suggestions and for the same reason: the sections
   * are independent and the panel is already open. Each is time-boxed and
   * failure-isolated, and a provider with nothing to say drops out of the result
   * rather than showing an empty heading.
   */
  describeSiteInfo(args: {
    context: PluginBrowserSiteInfoContext;
  }): Promise<PluginSiteInfoSection[]>;
  /**
   * Search engines plugins offered (`browser.searchEngines`), for the app to list
   * beside Patcher's own. Ordered by plugin id, then registration order. No plugin
   * code runs — the rows were declared at load.
   */
  listSearchEngineContributions(): PluginSearchEngineContribution[];
  /**
   * Page styles plugins declared (`browser.pageStyles`), for the app to push to
   * the desktop shell. Ordered by plugin id, then registration order. No plugin
   * code runs — and none runs later either: what comes back is the CSS itself,
   * so a page load never waits on this process.
   */
  listPageStyleContributions(): PluginPageStyleContribution[];
  /**
   * Page scripts plugins declared (`browser.pageScripts`), for the app to push
   * to the desktop shell. Ordered by plugin id, then registration order.
   *
   * No plugin code runs here — what comes back is the source text, which the
   * shell hands to a matching document. The plugin is reached later, if its own
   * script calls its rpc.
   */
  listPageScriptContributions(): PluginPageScriptContribution[];
  /**
   * Tab-menu entries plugins contributed (`browser.tab.actions`), for the
   * browser's tab strip to render after its own entries. Ordered by plugin id,
   * then registration order. No plugin code runs.
   */
  listTabActionContributions(): PluginTabActionContribution[];
  /**
   * Run a picked tab-menu entry, on the same terms as a picked context-menu
   * item: one deliberate click, time-boxed, failure-isolated, and nothing waits
   * on it.
   */
  runTabAction(args: {
    pluginId: string;
    itemId: string;
    context: PluginBrowserTabActionContext;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Toolbar controls plugins contributed (`browser.toolbar.items`), for the
   * address row to render between the address bar and Patcher's own buttons. Ordered
   * by plugin id. No plugin code runs — this is the declaration.
   */
  listToolbarItemContributions(): PluginToolbarItemContribution[];
  /**
   * Ask the controls that offered a `state` what they look like for this page.
   *
   * Concurrent and time-boxed like site-info sections, with one difference that
   * matters: this is asked as the user *navigates* rather than when they open
   * something, so a control without a `state` is never asked at all and nothing
   * is spent on it.
   */
  describeToolbarItemStates(args: {
    context: PluginBrowserToolbarContext;
  }): Promise<PluginToolbarItemState[]>;
  /**
   * Run a pressed toolbar control, on the same terms as a picked menu entry:
   * time-boxed, failure-isolated, nothing waits on the result. The caller asks
   * for states again once this resolves, which is how a toggle shows its new
   * look.
   */
  runToolbarItem(args: {
    pluginId: string;
    itemId: string;
    context: PluginBrowserToolbarContext;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Ask every registered new-tab widget for its rows
   * (`browser.newTab.widgets`).
   *
   * Concurrent, time-boxed and failure-isolated like site-info sections. A widget
   * with nothing to list drops out of the result rather than showing an empty
   * heading.
   */
  describeNewTabSections(args: {
    context: PluginBrowserNewTabContext;
  }): Promise<PluginNewTabSection[]>;
  /**
   * New-tab sections plugins declared (`browser.newTab.widgets`), so the app can
   * tell "nobody has one" from "nobody answered" without asking anyone. Ordered
   * by plugin id, then registration order. No plugin code runs.
   */
  listNewTabWidgetContributions(): PluginNewTabWidgetContribution[];
  /**
   * Commands plugins added, with their chords (`app.commands`), for the app to
   * match after every one of Patcher's own. Ordered by plugin id, then registration
   * order — which is also the order that resolves a chord two plugins both want.
   * No plugin code runs.
   */
  listCommandContributions(): PluginCommandContribution[];
  /**
   * Run a plugin command whose chord fired. A deliberate keypress, so it takes
   * the same box and isolation a picked menu entry does, and nothing waits on it.
   */
  runCommand(args: {
    pluginId: string;
    commandId: string;
  }): Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Ask every registered auth provider (`browser.auth.providers`) for the
   * credentials a browsed page was challenged for, in plugin id order, and stop
   * at the first that answers.
   *
   * Sequential rather than concurrent, unlike omnibox providers: the answer is
   * a credential, so asking a second keychain after the first has already said
   * yes is a lookup nobody needed. Each is time-boxed and failure-isolated, and
   * resolves null when nobody answered — which is what sends the question to
   * the user.
   */
  resolveBrowserAuth(args: {
    challenge: PluginBrowserAuthChallenge;
  }): Promise<PluginBrowserAuthCredentials | null>;
  /**
   * Ask every registered PDF text provider (`browser.pdf.textProviders`) for
   * the text of a document the browser parsed and found none in, in plugin id
   * order, stopping at the first that answers.
   *
   * Sequential and first-wins like auth, and for the same reason: a second
   * extractor after the first has already produced the document's text is work
   * nobody asked for. Each is time-boxed and failure-isolated; null means
   * nobody answered, which the agent is told as "no text layer".
   */
  resolveBrowserPdfText(args: {
    document: PluginBrowserPdfDocument;
  }): Promise<string | null>;
  /**
   * Ask every registered external-link handler
   * (`browser.externalLink.handlers`) where a link the system handed Patcher should
   * go, in plugin id order, stopping at the first that decides.
   *
   * Sequential and first-wins like auth, and for the harder reason: two handlers
   * that both rewrote the address would fight over one click. Each is time-boxed
   * and failure-isolated; null means nobody decided, and the link opens in a tab
   * the way it would with no plugins at all.
   */
  resolveBrowserExternalLink(args: {
    link: PluginBrowserExternalLink;
  }): Promise<PluginBrowserExternalLinkDecision | null>;
  /**
   * Run every loaded plugin's omnibox providers against one query
   * (`browser.omnibox.providers`). Providers run concurrently, each wrapped in
   * the failure-isolation discipline (invokeWrapped) and time-boxed (2s); a
   * slow, throwing, or malformed provider contributes nothing, so the
   * browser's own rows are never held up or lost. Groups are ordered by plugin
   * id, then registration order; empty groups are dropped. Item ids are
   * namespaced "<providerId>:<item id>".
   */
  suggestOmnibox(args: { query: string }): Promise<PluginOmniboxSuggestGroup[]>;
  /**
   * Hand a finished download to every plugin that registered a handler
   * (`browser.downloads.handlers`). Handlers run concurrently under the same
   * failure isolation and time box as omnibox providers: a slow or throwing
   * one changes nothing for the others, and nothing for the browser, which
   * finished writing the file before this was called.
   *
   * Resolves once every handler has settled, so a caller can await the
   * hand-over; it never rejects.
   */
  reportBrowserDownload(
    download: PluginBrowserDownload,
  ): Promise<{ handlerCount: number }>;
  /**
   * Show one page to every registered history filter before it is stored
   * (`browser.history.filters`).
   *
   * Sequential rather than concurrent, unlike the contributions above: each
   * filter decides from what the previous one left, so a plugin that strips
   * tracking parameters and a plugin that drops private hosts compose instead
   * of racing. Plugin id order, then registration order.
   *
   * Resolves to the visit as it should be recorded, or null when a filter
   * dropped it. Never rejects: a filter that throws or times out is skipped,
   * because a broken plugin must not cost the user their history.
   */
  applyBrowserHistoryFilters(
    visit: PluginBrowserHistoryVisit,
  ): Promise<PluginBrowserHistoryVisit | null>;
  /**
   * Perform one picked `{ type: "run" }` suggestion. `itemId` is the
   * wire-composed "<providerId>:<item id>" from suggestOmnibox. Dispatch and
   * handler problems map to `{ ok: false, error }` so the browser can report
   * the failure instead of navigating somewhere wrong.
   */
  runOmniboxAction(args: {
    itemId: string;
    pluginId: string;
    /** The query the picked suggestion was produced for. */
    query: string;
  }): Promise<PluginOmniboxRunOutcome>;
  /**
   * Last `tail` lines of the plugin's JSONL log file (patcher.log output).
   * Undefined when the plugin is not installed.
   */
  readLogTail(id: string, tail: number): Promise<string[] | undefined>;
  /**
   * Run due plugin schedules (design §4.8), called from the periodic-sweeps
   * loop. Claims each due (plugin_id, name) row with a CAS on next_run_at —
   * at-most-once per tick even across overlapping sweeps — then runs the
   * plugin's fn wrapped (errors → last_status/last_error + plugin log).
   * Rows whose plugin is not loaded are left unclaimed. No host required.
   */
  sweepDueSchedules(now: number): Promise<void>;
}

const DEFAULT_MENTION_SEARCH_TIMEOUT_MS = 2_000;
// Resolve is looser than search: it blocks a send the user already committed
// to, so it may do one real fetch — but it must not hang POST /threads/:id/send
// forever when a provider never settles.
const DEFAULT_MENTION_RESOLVE_TIMEOUT_MS = 10_000;
/** Same 2s box as mention search: the omnibox must stay responsive per keystroke. */
const DEFAULT_OMNIBOX_SUGGEST_TIMEOUT_MS = 2_000;
/**
 * The site-info popover is open while this runs, so the box is the omnibox's
 * rather than a menu action's: a provider that hangs must not leave a section
 * spinning under the user's cursor.
 */
const DEFAULT_SITE_INFO_TIMEOUT_MS = 2_000;
/**
 * A toolbar `state` gets less room than a site-info section: the control is
 * already drawn and correct-by-default, so a slow answer costs nothing but a
 * late accent, while this runs on every navigation.
 */
const DEFAULT_TOOLBAR_STATE_TIMEOUT_MS = 1_000;
/**
 * What one provider may put in the popover. It is a small panel anchored to the
 * address bar, and a provider that returns a hundred rows is not describing a
 * site — so the rows are capped here rather than trusted, like every other
 * plugin-supplied string that reaches the app.
 */
const SITE_INFO_MAX_ROWS = 8;
const SITE_INFO_MAX_ROW_LABEL_LENGTH = 60;
const SITE_INFO_MAX_ROW_VALUE_LENGTH = 200;
/** A tooltip, not a paragraph — and it has to fit a control in a fixed row. */
const TOOLBAR_ITEM_MAX_TITLE_LENGTH = 60;
/**
 * More rows than a site-info section gets: this is a list of places to go — saved
 * pages, a reading list — where eight would be a teaser rather than a section.
 */
const NEW_TAB_MAX_ROWS = 12;
const NEW_TAB_MAX_ROW_TITLE_LENGTH = 200;
const NEW_TAB_MAX_ROW_SUBTITLE_LENGTH = 200;
/** The same cap the address bar and the history store use for a URL. */
const NEW_TAB_MAX_ROW_URL_LENGTH = 4_096;
/**
 * A picked `run` action is a deliberate user action, not a keystroke, and may
 * spawn a thread — so it gets the same longer box as mention resolve.
 */
const DEFAULT_OMNIBOX_RUN_TIMEOUT_MS = 10_000;
/**
 * A download handler is doing filesystem work on a file that already exists —
 * moving it, hashing it, handing it to something else — so it gets the looser
 * box a picked action gets rather than the omnibox's per-keystroke 2s. Nothing
 * waits on it: the file is written and the user has already been told.
 */
const DEFAULT_BROWSER_DOWNLOAD_TIMEOUT_MS = 30_000;
/**
 * A history filter runs on the write path of an ordinary page load, so it gets
 * the tightest box of any contribution: the visit is not recorded until every
 * filter has answered, and a wedged one must not be able to hold that up.
 */
const DEFAULT_BROWSER_HISTORY_FILTER_TIMEOUT_MS = 1_000;
/** A picked menu item is a deliberate user action, like an omnibox `run`. */
const DEFAULT_CONTEXT_MENU_RUN_TIMEOUT_MS = 10_000;
/**
 * An auth provider is looked up while a page sits stopped and a human waits, so
 * it gets a tighter box than a picked action: long enough to unlock a keychain,
 * short enough that a wedged provider does not become a hung browser. Running
 * out of time is not an error — the user is asked instead.
 */
const DEFAULT_BROWSER_AUTH_TIMEOUT_MS = 5_000;
/**
 * A PDF text provider gets the longest box of any browser hook, because it is
 * the only one asked to do real work: an OCR pass, or a round trip to a
 * document service. Nothing is held up on screen while it runs — an agent is
 * waiting for a tool result — so the cost of the wait is one slow answer rather
 * than a browser that feels stuck. Running out of time is not an error; the
 * agent is told the document has no text layer, which is what it had before.
 */
const DEFAULT_BROWSER_PDF_TEXT_TIMEOUT_MS = 10_000;
/**
 * An external-link handler is asked while the user waits for the link they just
 * clicked in another app to open, so it gets the tightest box of the browser
 * hooks after the history filter. Running out of time is not an error: the link
 * opens in a tab, which is what it would have done with no plugin at all.
 */
const DEFAULT_BROWSER_EXTERNAL_LINK_TIMEOUT_MS = 2_000;
/**
 * The same cap the browser's own page read carries, restated rather than
 * imported: the server does not depend on the desktop boundary, and a plugin's
 * text lands in the same agent context the browser's would have.
 */
const BROWSER_PDF_TEXT_MAX_LENGTH = 65_536;
/** Plugin scores are advisory; the browser owns the top row. */
const DEFAULT_OMNIBOX_SUGGESTION_SCORE = 0.5;
const DEFAULT_STABILIZATION_WINDOW_MS = 30_000;
const DEFAULT_ARTIFACT_RETENTION_MS = 7 * 24 * 60 * 60_000;
const SCHEDULE_SWEEP_BATCH_SIZE = 100;

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

/** Next cron occurrence strictly after `now` (server-local time). */
function nextCronRunAt(cron: string, now: number): number {
  return CronExpressionParser.parse(cron, { currentDate: new Date(now) })
    .next()
    .getTime();
}

/** True when `promise` settles (either way) within `timeoutMs`. */
async function settledWithin(
  promise: Promise<unknown>,
  timeoutMs: number,
): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolvePromise) => {
        timer = setTimeout(() => resolvePromise(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Map a tool's return value (string | { content, isError? }) onto the wire
 * ToolCallResponse the daemon round-trip expects. Malformed results throw —
 * the caller runs this inside invokeWrapped so they count as handler errors.
 */
function normalizeAgentToolResult(
  name: string,
  result: unknown,
): ToolCallResponse {
  if (typeof result === "string") {
    return {
      success: true,
      contentItems: [{ type: "inputText", text: result }],
    };
  }
  if (
    result !== null &&
    typeof result === "object" &&
    Array.isArray((result as { content?: unknown }).content)
  ) {
    const { content, isError } = result as {
      content: unknown[];
      isError?: unknown;
    };
    const contentItems = content.map((part, index) => {
      const typed = part as {
        type?: unknown;
        text?: unknown;
        data?: unknown;
        mimeType?: unknown;
      };
      if (typed?.type === "text" && typeof typed.text === "string") {
        return { type: "inputText" as const, text: typed.text };
      }
      if (
        typed?.type === "image" &&
        typeof typed.data === "string" &&
        typeof typed.mimeType === "string"
      ) {
        return {
          type: "inputImage" as const,
          imageUrl: `data:${typed.mimeType};base64,${typed.data}`,
        };
      }
      throw new Error(
        `content[${index}] must be { type: "text", text } or { type: "image", data, mimeType }`,
      );
    });
    return { success: isError !== true, contentItems };
  }
  throw new Error(
    `tool "${name}" execute() must return a string or { content: [...], isError? }`,
  );
}

/**
 * Validate a mention provider's search() result and namespace item ids for
 * the wire ("<providerId>:<item id>"). Malformed results throw — the caller
 * runs this inside invokeWrapped so they count as handler errors and the
 * provider contributes an empty group.
 */
function normalizeMentionSearchItems(
  providerId: string,
  result: unknown,
): PluginMentionSearchItem[] {
  if (!Array.isArray(result)) {
    throw new Error(
      `mention provider "${providerId}" search() must return an array of items`,
    );
  }
  return result.map((item, index) => {
    const typed = item as {
      id?: unknown;
      title?: unknown;
      subtitle?: unknown;
      icon?: unknown;
    } | null;
    if (
      typeof typed?.id !== "string" ||
      typed.id.length === 0 ||
      typeof typed.title !== "string" ||
      typed.title.trim().length === 0 ||
      (typed.subtitle !== undefined && typeof typed.subtitle !== "string") ||
      (typed.icon !== undefined && typeof typed.icon !== "string")
    ) {
      throw new Error(
        `mention provider "${providerId}" items[${index}] must be { id: string, title: string, subtitle?, icon? }`,
      );
    }
    return {
      itemId: `${providerId}:${typed.id}`,
      title: typed.title,
      subtitle:
        typeof typed.subtitle === "string" && typed.subtitle.trim().length > 0
          ? typed.subtitle
          : null,
      icon:
        typeof typed.icon === "string" && typed.icon.trim().length > 0
          ? typed.icon
          : null,
    };
  });
}

/**
 * Validate an omnibox provider's suggest() result and namespace item ids for
 * the wire ("<providerId>:<item id>"). Malformed results throw — the caller
 * runs this inside invokeWrapped, so a bad provider contributes nothing and
 * the browser's own rows are unaffected.
 *
 * `hasRun` gates `run` actions: a row whose action the provider cannot perform
 * would fail only once the user picked it, so it is rejected here instead.
 */
/**
 * Turn what a provider returned into rows the popover can render, refusing what
 * is not rows at all and trimming the rest to the caps above.
 */
function normalizeSiteInfoRows(args: {
  providerId: string;
  result: unknown;
}): { label: string; value: string }[] {
  if (args.result === null || args.result === undefined) {
    return [];
  }
  if (!Array.isArray(args.result)) {
    throw new Error(
      `site info provider "${args.providerId}" describe() must return an array of rows or null`,
    );
  }
  return args.result.slice(0, SITE_INFO_MAX_ROWS).map((row, index) => {
    const typed = row as { label?: unknown; value?: unknown } | null;
    if (
      typeof typed?.label !== "string" ||
      typed.label.trim().length === 0 ||
      typeof typed.value !== "string"
    ) {
      throw new Error(
        `site info provider "${args.providerId}" rows[${index}] must be { label: string, value: string }`,
      );
    }
    return {
      label: typed.label.trim().slice(0, SITE_INFO_MAX_ROW_LABEL_LENGTH),
      value: typed.value.trim().slice(0, SITE_INFO_MAX_ROW_VALUE_LENGTH),
    };
  });
}

/**
 * Turn what a `state` returned into the two things the control can show, or null
 * for "keep what was declared". Malformed answers throw: the caller runs this
 * inside invokeWrapped, so a bad one leaves the declared look rather than a
 * control that reads as off when nobody said so.
 */
function normalizeToolbarItemState(args: {
  itemId: string;
  result: unknown;
}): { active: boolean; title: string | null } | null {
  if (args.result === null || args.result === undefined) {
    return null;
  }
  if (typeof args.result !== "object" || Array.isArray(args.result)) {
    throw new Error(
      `toolbar item "${args.itemId}" state() must return an object or null`,
    );
  }
  const typed = args.result as { active?: unknown; title?: unknown };
  if (typed.active !== undefined && typeof typed.active !== "boolean") {
    throw new Error(
      `toolbar item "${args.itemId}" state().active must be a boolean when present`,
    );
  }
  if (typed.title !== undefined && typeof typed.title !== "string") {
    throw new Error(
      `toolbar item "${args.itemId}" state().title must be a string when present`,
    );
  }
  const title = typeof typed.title === "string" ? typed.title.trim() : "";
  return {
    active: typed.active === true,
    title:
      title.length === 0 ? null : title.slice(0, TOOLBAR_ITEM_MAX_TITLE_LENGTH),
  };
}

/**
 * Turn what a widget returned into rows the new-tab screen can render.
 *
 * A row is a link, so the URL is checked here rather than at click time: `http`
 * and `https` only, because `javascript:` or `file:` from a plugin is not a link
 * the browser should follow, and a row that fails when clicked is worse than a row
 * that never appeared. Malformed results throw — the caller runs this inside
 * invokeWrapped, so a bad widget contributes nothing and the screen still renders
 * Patcher's own recents.
 */
function normalizeNewTabRows(args: {
  result: unknown;
  widgetId: string;
}): { title: string; subtitle: string | null; url: string }[] {
  if (args.result === null || args.result === undefined) {
    return [];
  }
  if (!Array.isArray(args.result)) {
    throw new Error(
      `new tab widget "${args.widgetId}" rows() must return an array of rows or null`,
    );
  }
  return args.result.slice(0, NEW_TAB_MAX_ROWS).map((row, index) => {
    const typed = row as {
      title?: unknown;
      subtitle?: unknown;
      url?: unknown;
    } | null;
    if (
      typeof typed?.title !== "string" ||
      typed.title.trim().length === 0 ||
      typeof typed.url !== "string"
    ) {
      throw new Error(
        `new tab widget "${args.widgetId}" rows[${index}] must be { title: string, url: string }`,
      );
    }
    if (
      typed.subtitle !== undefined &&
      typed.subtitle !== null &&
      typeof typed.subtitle !== "string"
    ) {
      throw new Error(
        `new tab widget "${args.widgetId}" rows[${index}].subtitle must be a string when present`,
      );
    }
    // Refused rather than truncated: a URL cut at the cap is a different address,
    // and a row that quietly goes somewhere else is worse than one that never
    // appeared.
    if (typed.url.length > NEW_TAB_MAX_ROW_URL_LENGTH) {
      throw new Error(
        `new tab widget "${args.widgetId}" rows[${index}].url is longer than ${NEW_TAB_MAX_ROW_URL_LENGTH} characters`,
      );
    }
    let url: URL;
    try {
      url = new URL(typed.url);
    } catch {
      throw new Error(
        `new tab widget "${args.widgetId}" rows[${index}].url is not a URL: ${JSON.stringify(typed.url)}`,
      );
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        `new tab widget "${args.widgetId}" rows[${index}].url must be http or https`,
      );
    }
    const subtitle =
      typeof typed.subtitle === "string" ? typed.subtitle.trim() : "";
    return {
      title: typed.title.trim().slice(0, NEW_TAB_MAX_ROW_TITLE_LENGTH),
      subtitle:
        subtitle.length === 0
          ? null
          : subtitle.slice(0, NEW_TAB_MAX_ROW_SUBTITLE_LENGTH),
      url: typed.url,
    };
  });
}

function normalizeOmniboxSuggestItems(args: {
  hasRun: boolean;
  providerId: string;
  result: unknown;
}): PluginOmniboxSuggestItem[] {
  if (!Array.isArray(args.result)) {
    throw new Error(
      `omnibox provider "${args.providerId}" suggest() must return an array of suggestions`,
    );
  }
  return args.result.map((item, index) => {
    const typed = item as {
      id?: unknown;
      title?: unknown;
      subtitle?: unknown;
      score?: unknown;
      action?: unknown;
    } | null;
    if (
      typeof typed?.id !== "string" ||
      typed.id.length === 0 ||
      typeof typed.title !== "string" ||
      typed.title.trim().length === 0 ||
      (typed.subtitle !== undefined && typeof typed.subtitle !== "string") ||
      (typed.score !== undefined && typeof typed.score !== "number")
    ) {
      throw new Error(
        `omnibox provider "${args.providerId}" items[${index}] must be { id: string, title: string, subtitle?, score?, action }`,
      );
    }
    const action = typed.action as
      | { type?: unknown; url?: unknown }
      | null
      | undefined;
    let normalizedAction: PluginOmniboxSuggestItem["action"];
    if (action?.type === "navigate") {
      if (typeof action.url !== "string" || action.url.trim().length === 0) {
        throw new Error(
          `omnibox provider "${args.providerId}" items[${index}] navigate action must carry a url`,
        );
      }
      normalizedAction = { type: "navigate", url: action.url };
    } else if (action?.type === "run") {
      if (!args.hasRun) {
        throw new Error(
          `omnibox provider "${args.providerId}" items[${index}] uses a run action but the provider registered no run(itemId)`,
        );
      }
      normalizedAction = { type: "run" };
    } else {
      throw new Error(
        `omnibox provider "${args.providerId}" items[${index}] action must be { type: "navigate", url } or { type: "run" }`,
      );
    }
    const score =
      typeof typed.score === "number" && Number.isFinite(typed.score)
        ? Math.min(Math.max(typed.score, 0), 1)
        : DEFAULT_OMNIBOX_SUGGESTION_SCORE;
    return {
      itemId: `${args.providerId}:${typed.id}`,
      title: typed.title,
      subtitle:
        typeof typed.subtitle === "string" && typed.subtitle.trim().length > 0
          ? typed.subtitle
          : null,
      score,
      action: normalizedAction,
    };
  });
}

/**
 * Race a plugin call against a time box. The abandoned promise keeps a catch
 * attached so a late rejection cannot surface as an unhandled rejection.
 */
async function withPluginTimeout<T>(args: {
  run: () => Promise<T>;
  timeoutMs: number;
}): Promise<T> {
  const call = args.run();
  call.catch(() => {});
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out after ${args.timeoutMs}ms`)),
          args.timeoutMs,
        );
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

const PLUGIN_AGENT_SELECTION_MAX_IDS = 256;
const PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS = 4096;
const PLUGIN_AGENT_TOOL_PARAMETERS_MAX_BYTES = 128 * 1024;

interface NormalizedPluginAgentConfiguration {
  toolIds: string[];
  /**
   * Keyed by tool name. A null-prototype object rather than a Map, because
   * this value crosses to the plugin host in Phase 7 and `JSON.stringify` of
   * a Map is `{}` — silent loss rather than a failure. Null-prototype rather
   * than a literal because tool names match `[a-zA-Z0-9_-]+`, which admits
   * `__proto__`: on a normal object that key sets the prototype instead of an
   * entry, and reading it back would answer `Object.prototype`.
   */
  toolParameterOverrides: Record<string, Record<string, unknown>>;
  skillIds: string[];
  instructions: string | null;
}

function normalizePluginAgentToolParameters(args: {
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
  if (
    Buffer.byteLength(serialized, "utf8") >
    PLUGIN_AGENT_TOOL_PARAMETERS_MAX_BYTES
  ) {
    throw new Error(
      `configure() output.tools[${index}].parameters exceeds the ${PLUGIN_AGENT_TOOL_PARAMETERS_MAX_BYTES}-byte limit`,
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

function normalizePluginAgentToolSelections(args: {
  knownIds: ReadonlySet<string>;
  pluginId: string;
  value: unknown;
}): {
  toolIds: string[];
  parameterOverrides: Record<string, Record<string, unknown>>;
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
  const parameterOverrides = Object.create(null) as Record<
    string,
    Record<string, unknown>
  >;
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
      parameters = normalizePluginAgentToolParameters({
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
    if (parameters !== null) parameterOverrides[name] = parameters;
  }
  return { toolIds, parameterOverrides };
}

function normalizePluginAgentSelectionIds(args: {
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

function normalizePluginAgentConfiguration(args: {
  knownSkillIds: ReadonlySet<string>;
  knownToolIds: ReadonlySet<string>;
  pluginId: string;
  value: unknown;
}): NormalizedPluginAgentConfiguration {
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
  const instructions =
    typeof output.instructions === "string" &&
    output.instructions.trim().length > 0
      ? output.instructions.slice(
          0,
          PLUGIN_AGENT_DYNAMIC_INSTRUCTIONS_MAX_CHARS,
        )
      : null;
  const toolSelections = normalizePluginAgentToolSelections({
    knownIds: args.knownToolIds,
    pluginId: args.pluginId,
    value: output.tools,
  });
  return {
    toolIds: toolSelections.toolIds,
    toolParameterOverrides: toolSelections.parameterOverrides,
    skillIds: normalizePluginAgentSelectionIds({
      field: "skills",
      knownIds: args.knownSkillIds,
      pluginId: args.pluginId,
      value: output.skills,
    }),
    instructions,
  };
}

export function createPluginService(deps: PluginServiceDeps): PluginService {
  const logger = deps.logger;
  const bundledPlugins =
    deps.bundledPlugins ?? listBundledPluginRegistrations();
  const mentionSearchTimeoutMs =
    deps.mentionSearchTimeoutMs ?? DEFAULT_MENTION_SEARCH_TIMEOUT_MS;
  const mentionResolveTimeoutMs =
    deps.mentionResolveTimeoutMs ?? DEFAULT_MENTION_RESOLVE_TIMEOUT_MS;
  const omniboxSuggestTimeoutMs =
    deps.omniboxSuggestTimeoutMs ?? DEFAULT_OMNIBOX_SUGGEST_TIMEOUT_MS;
  const omniboxRunTimeoutMs =
    deps.omniboxRunTimeoutMs ?? DEFAULT_OMNIBOX_RUN_TIMEOUT_MS;
  const browserDownloadTimeoutMs =
    deps.browserDownloadTimeoutMs ?? DEFAULT_BROWSER_DOWNLOAD_TIMEOUT_MS;
  const browserHistoryFilterTimeoutMs =
    deps.browserHistoryFilterTimeoutMs ??
    DEFAULT_BROWSER_HISTORY_FILTER_TIMEOUT_MS;
  const siteInfoTimeoutMs =
    deps.siteInfoTimeoutMs ?? DEFAULT_SITE_INFO_TIMEOUT_MS;
  const toolbarStateTimeoutMs =
    deps.toolbarStateTimeoutMs ?? DEFAULT_TOOLBAR_STATE_TIMEOUT_MS;
  const newTabRowsTimeoutMs =
    deps.newTabRowsTimeoutMs ?? DEFAULT_SITE_INFO_TIMEOUT_MS;
  const contextMenuRunTimeoutMs =
    deps.contextMenuRunTimeoutMs ?? DEFAULT_CONTEXT_MENU_RUN_TIMEOUT_MS;
  const browserAuthTimeoutMs = DEFAULT_BROWSER_AUTH_TIMEOUT_MS;
  const browserPdfTextTimeoutMs = DEFAULT_BROWSER_PDF_TEXT_TIMEOUT_MS;
  const browserExternalLinkTimeoutMs = DEFAULT_BROWSER_EXTERNAL_LINK_TIMEOUT_MS;
  const stabilizationWindowMs =
    deps.stabilizationWindowMs ?? DEFAULT_STABILIZATION_WINDOW_MS;
  const artifactRetentionMs =
    deps.artifactRetentionMs ?? DEFAULT_ARTIFACT_RETENTION_MS;
  const now = deps.now ?? Date.now;
  const scheduleStabilizationWindow =
    deps.scheduleStabilizationWindow ??
    ((durationMs: number, onElapsed: () => void) => {
      const timer = setTimeout(onElapsed, durationMs);
      return () => clearTimeout(timer);
    });

  // The token file sits in the settings-secrets dir so `remove` cleans it
  // up; the dot prefix cannot collide with setting keys (they must match
  // /^[a-zA-Z0-9_-]+$/).
  const HTTP_TOKEN_FILE = ".http-token";

  const {
    REGISTRATION_MUTATION_KEY,
    agentToolProblems,
    apiIdentities,
    appBundles,
    forgetPluginApiClient,
    bindSdk: bindRuntimeSdk,
    buildThreadDto,
    builtinSourceWatchers,
    checkEngineRange,
    checkPluginSdkRange,
    clearPlacementQuarantine,
    disposeAll,
    disposeOne,
    emitThreadEvent,
    handlerStats,
    hungServices,
    identities,
    invokeCallback,
    isBuiltinPluginId,
    isPackagedBuiltinAppEntry,
    loadAll,
    loaded,
    loadOne,
    brandingAssets,
    setDevBuildProblem,
    setStatus,
    sourceKind,
    stabilizingPluginIds,
    statuses,
    statusListeners,
    wireLookup,
    withArtifactLock,
    withLifecycleLock,
    withPluginOperationLock,
  } = createPluginRuntime({ deps, nextCronRunAt, settledWithin });

  let managedValidateInstallDir!: (
    args: RegisterInstalledArgs,
  ) => Promise<PluginManifest>;
  const {
    assertInstallRegistrationAvailable,
    backfillNormalizedPluginRegistrations,
    emptyPluginUpdateState,
    installBuiltinSource,
    installPathSource,
    installedUpdateVersion,
    npmIntentForRow,
    provenanceForRow,
    reconcileBundled,
    registerInstalled,
    registrationMatchesForActivation,
    refuseBuiltinShadow,
    restoreRegistration,
    sourceFingerprint,
  } = createPluginRegistration({
    deps,
    bundledPlugins,
    withLifecycleLock,
    disposeOne,
    loadOne,
    validateInstallDir: (args) => managedValidateInstallDir(args),
    syncCliSkill,
    notifyPluginsChanged,
    list,
  });

  const {
    activateManagedUpdate,
    recoverIncompletePluginRollbacks,
    runArtifactGc,
  } = createPluginActivation({
    deps,
    now,
    artifactRetentionMs,
    stabilizationWindowMs,
    scheduleStabilizationWindow,
    stabilizingPluginIds,
    statuses,
    statusListeners,
    withArtifactLock,
    withLifecycleLock,
    disposeOne,
    loadOne,
    restoreRegistration,
    provenanceForRow,
    registrationMatchesForActivation,
    emptyPluginUpdateState,
    sourceFingerprint,
    syncCliSkill,
    notifyPluginsChanged,
  });

  const managedPluginArtifacts = createManagedPluginArtifacts({
    deps,
    withArtifactLock,
    sourceKind,
    checkEngineRange,
    checkPluginSdkRange,
    isPackagedBuiltinAppEntry,
    registerInstalled,
    assertInstallRegistrationAvailable,
    refuseBuiltinShadow,
    activateManagedUpdate,
  });
  managedValidateInstallDir = managedPluginArtifacts.validateInstallDir;
  const { installGitSource, installNpmSource } = managedPluginArtifacts;

  const pluginUpdates = createPluginUpdates({
    deps,
    registrationMutationKey: REGISTRATION_MUTATION_KEY,
    withLifecycleLock,
    withPluginOperationLock,
    notifyPluginsChanged,
    installedUpdateVersion,
    npmIntentForRow,
    managedArtifacts: managedPluginArtifacts,
    runArtifactGc,
  });

  /**
   * The live native-tool view: loaded plugins in id order, registration
   * order within a plugin, deduped first-wins (defensive — registration
   * already blocks cross-plugin collisions and reserved names).
   */
  function collectAgentTools(): Array<{
    pluginId: string;
    record: PluginAgentToolRecord;
  }> {
    const seen = new Set<string>(RESERVED_AGENT_TOOL_NAMES);
    const out: Array<{ pluginId: string; record: PluginAgentToolRecord }> = [];
    for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      for (const record of plugin.handle.agentTools) {
        if (seen.has(record.name)) continue;
        seen.add(record.name);
        out.push({ pluginId: id, record });
      }
    }
    return out;
  }

  function cliContributions(): PluginCliContribution[] {
    const contributions: PluginCliContribution[] = [];
    for (const [id, plugin] of [...loaded.entries()]) {
      const registration = plugin.handle.cli.registration;
      if (!registration) continue;
      contributions.push({
        pluginId: id,
        name: registration.name,
        summary: registration.summary,
        commands: registration.commands.map((command) => ({ ...command })),
      });
    }
    return contributions.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }

  /**
   * Rewrite (or remove) the generated plugin-commands skill after any
   * load/dispose transition, so agent threads always see current commands.
   * Best effort — a filesystem problem must not fail the transition.
   */
  async function syncCliSkill(): Promise<void> {
    try {
      await syncPluginCommandsSkill(deps.dataDir, cliContributions());
    } catch (error) {
      logger.warn(
        `failed to sync the plugin-commands skill: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Broadcast that the set of running plugins (and therefore host-rendered
   * contributions) changed, so open app pages re-fetch instead of waiting
   * out their query stale time. Fired on install/remove/enable/disable/
   * reload completion.
   */
  function notifyPluginsChanged(): void {
    deps.hub.notifySystem(["plugins-changed"]);
  }

  function compactPath(path: string): string {
    const home = homedir();
    return path === home
      ? "~"
      : path.startsWith(`${home}/`)
        ? `~/${path.slice(home.length + 1)}`
        : path;
  }

  function updateTrackingForRow(row: InstalledPluginRow): string {
    return (row.sourceKind === "npm" && row.sourceNpmSpecKind !== "exact") ||
      (row.sourceKind === "git" && row.sourceGitRefKind === "branch")
      ? "tracks compatible"
      : "pinned";
  }

  function sourceDisplayForRow(row: InstalledPluginRow): string {
    if (row.sourceKind === "path") {
      return `path · ${compactPath(row.sourcePath ?? row.rootDir)}`;
    }
    if (row.sourceKind === "builtin") return `builtin · ${row.id}`;
    if (row.sourceKind === "npm") {
      return `npm · ${row.sourceNpmPackage ?? row.id} · ${updateTrackingForRow(row)}`;
    }
    return `git · ${row.sourceGitUrl ?? row.source} · ${updateTrackingForRow(row)}`;
  }

  function updateStateForRow(
    row: InstalledPluginRow,
  ): PluginListEntry["updateState"] {
    let persisted: PluginUpdateCheckEntry | undefined;
    if (row.updateStatusDetail !== null) {
      try {
        const parsed = pluginUpdateCheckEntrySchema.safeParse(
          JSON.parse(row.updateStatusDetail),
        );
        if (parsed.success && parsed.data.id === row.id)
          persisted = parsed.data;
      } catch {
        // The list remains usable if one persisted status is corrupt; the
        // dedicated updates route retains its strict corruption diagnostic.
      }
    }
    const failure =
      row.lastFailureVersion !== null &&
      row.lastFailureAt !== null &&
      row.lastFailureDetail !== null
        ? {
            version: row.lastFailureVersion,
            at: row.lastFailureAt,
            detail: row.lastFailureDetail,
          }
        : undefined;
    return {
      ...(persisted === undefined ? {} : { outcome: persisted.outcome }),
      ...(row.availableCompatibleVersion === null
        ? {}
        : { availableVersion: row.availableCompatibleVersion }),
      ...(row.newestIncompatibleVersion === null
        ? {}
        : { blockedVersion: row.newestIncompatibleVersion }),
      ...(persisted?.blocked === undefined
        ? {}
        : { blockedReasons: persisted.blocked.reasons }),
      ...(row.lastUpdateCheckAt === null
        ? {}
        : { lastCheckAt: row.lastUpdateCheckAt }),
      ...(failure === undefined ? {} : { lastFailure: failure }),
    };
  }

  /**
   * The user-recognizable capabilities a plugin contributes, for the plugin
   * detail "Includes" section. Manifest-declared skills and themes stay
   * accurate while a plugin is disabled; agent tools and thread integrations
   * only exist on a loaded plugin, so a disabled plugin reports none and the
   * UI explains that they become visible once it is enabled.
   */
  function capabilitySummary(
    manifest: PluginManifest | undefined,
    loadedPlugin: LoadedPlugin | undefined,
  ): PluginCapabilitySummary {
    const capabilities: PluginCapabilitySummary = [];
    if (manifest !== undefined) {
      for (const skillName of manifest.skillNames) {
        capabilities.push({
          kind: "skill",
          id: skillName,
          label: skillName,
          detail: "Skill this plugin adds to your agents",
        });
      }
      for (const theme of manifest.themes) {
        capabilities.push({
          kind: "theme",
          id: theme.id,
          label: theme.name,
          detail: theme.description,
        });
      }
    }
    for (const tool of loadedPlugin?.handle.agentTools ?? []) {
      capabilities.push({
        kind: "agent-tool",
        id: tool.name,
        label: tool.name,
        detail: tool.description,
      });
    }
    for (const provider of loadedPlugin?.handle.mentionProviders ?? []) {
      capabilities.push({
        kind: "thread-integration",
        id: `mention:${provider.id}`,
        label: provider.label,
        detail: `Mentions with ${provider.triggers.join(", ")}`,
      });
    }
    return capabilities;
  }

  function list(): PluginListEntry[] {
    const scheduleRows = listPluginSchedules(deps.db);
    return listInstalledPlugins(deps.db)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => {
        const runtime = statuses.get(row.id);
        const stats = handlerStats.get(row.id);
        const loadedPlugin = loaded.get(row.id);
        const cliRegistration = loadedPlugin?.handle.cli.registration;
        // An unloaded (disabled/incompatible/errored) plugin keeps its
        // identity via the static-manifest cache, so it still shows its real
        // name, icon, and logo instead of falling back to the raw id + glyph.
        const identity =
          loadedPlugin === undefined ? identities.get(row.id) : undefined;
        return {
          id: row.id,
          source: row.source,
          rootDir: row.rootDir,
          version: row.version,
          provenance: row.provenance,
          ...(row.catalogEntryId === null
            ? {}
            : { catalogEntryId: row.catalogEntryId }),
          isOrphanedBuiltin:
            row.sourceKind === "builtin" &&
            !bundledPlugins.some(
              (bundled) => bundled.name === row.sourceBuiltinName,
            ),
          sourceDisplay: sourceDisplayForRow(row),
          updateState: updateStateForRow(row),
          enabled: row.enabled,
          description:
            loadedPlugin?.manifest.description ??
            identity?.manifest.description ??
            null,
          name: loadedPlugin?.manifest.name ?? identity?.manifest.name ?? null,
          icon:
            loadedPlugin?.manifest.branding.icon ??
            identity?.manifest.branding.icon ??
            null,
          iconUrl:
            (loadedPlugin !== undefined
              ? brandingAssets.get(row.id)?.compactIcon?.url
              : identity?.brandingAssets.compactIcon?.url) ?? null,
          status: runtime?.status ?? (row.enabled ? "error" : "disabled"),
          // A running plugin's detail is legitimately null — only fall back
          // to "not loaded" when there is no runtime status at all.
          statusDetail: runtime
            ? runtime.detail
            : row.enabled
              ? "not loaded"
              : null,
          placement:
            loadedPlugin === undefined
              ? null
              : loadedPlugin.remoteInstanceId === null
                ? "server"
                : "process",
          handlerStats: stats
            ? { ...stats }
            : { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
          services: (loadedPlugin?.services ?? []).map((service) => ({
            name: service.record.name,
            state: service.state,
          })),
          schedules: scheduleRows
            .filter((schedule) => schedule.pluginId === row.id)
            .map((schedule) => ({
              name: schedule.name,
              cron: schedule.cron,
              nextRunAt: schedule.nextRunAt,
              lastRunAt: schedule.lastRunAt,
              lastStatus: schedule.lastStatus,
              lastError: schedule.lastError,
            })),
          cliCommand: cliRegistration
            ? { name: cliRegistration.name, summary: cliRegistration.summary }
            : null,
          capabilities: capabilitySummary(
            loadedPlugin?.manifest ?? identity?.manifest,
            loadedPlugin,
          ),
          permissions: [
            ...canonicalPermissions(
              (loadedPlugin?.manifest ?? identity?.manifest)?.permissions,
            ),
          ],
          sites: [
            ...((loadedPlugin?.manifest ?? identity?.manifest)?.sites ?? []),
          ],
          hasSettings:
            loadedPlugin !== undefined &&
            Object.keys(loadedPlugin.handle.settings.descriptors).length > 0,
          app: appBundles.get(row.id)?.state ?? { hasApp: false, bundle: null },
          // Rich logos come from the live runtime for an exposed plugin, else
          // from the static-identity cache.
          logoUrl:
            (loadedPlugin !== undefined
              ? brandingAssets.get(row.id)?.logo?.url
              : identity?.brandingAssets.logo?.url) ?? null,
          logoDarkUrl:
            (loadedPlugin !== undefined
              ? brandingAssets.get(row.id)?.logoDark?.url
              : identity?.brandingAssets.logoDark?.url) ?? null,
        };
      });
  }

  return {
    isBuiltin: isBuiltinPluginId,

    listThemes() {
      return [...loaded.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([pluginId, plugin]) =>
          plugin.manifest.themes.map((theme) => ({
            id: formatPluginThemeId(pluginId, theme.id),
            pluginId,
            name: theme.name,
            description: theme.description,
          })),
        );
    },

    async readThemeCss(themeId) {
      for (const [pluginId, plugin] of loaded) {
        const theme = plugin.manifest.themes.find(
          (entry) => formatPluginThemeId(pluginId, entry.id) === themeId,
        );
        if (!theme) continue;
        try {
          const css = await readFile(theme.cssPath, "utf8");
          return css.length <= CUSTOM_THEME_CSS_MAX_LENGTH ? css : null;
        } catch {
          return null;
        }
      }
      return null;
    },

    events: {
      emitThreadCreated(thread) {
        emitThreadEvent("thread.created", () => ({
          thread: buildThreadDto(thread),
        }));
      },
      emitThreadActive(thread) {
        emitThreadEvent("thread.active", () => ({
          thread: buildThreadDto(thread),
        }));
      },
      emitThreadIdle(thread) {
        emitThreadEvent("thread.idle", () => ({
          thread: buildThreadDto(thread),
          lastAssistantText: getLastThreadOutput(deps.db, thread.id),
        }));
      },
      emitThreadFailed(thread) {
        emitThreadEvent("thread.failed", () => ({
          thread: buildThreadDto(thread),
          error: getLastThreadErrorMessage(deps.db, thread.id),
        }));
      },
      emitThreadArchived(thread) {
        emitThreadEvent("thread.archived", () => ({
          thread: buildThreadDto(thread),
        }));
      },
      emitThreadDeleted(thread) {
        emitThreadEvent("thread.deleted", () => ({
          thread: buildThreadDto(thread),
        }));
      },
    },

    bindSdk: bindRuntimeSdk,

    async start() {
      await backfillNormalizedPluginRegistrations();
      await withPluginOperationLock(
        REGISTRATION_MUTATION_KEY,
        recoverIncompletePluginRollbacks,
      );
      await reconcileBundled();
      await loadAll();
      await withPluginOperationLock(REGISTRATION_MUTATION_KEY, runArtifactGc);
      if (deps.watchBuiltinPluginSources) {
        for (const bundled of bundledPlugins) {
          const row = listInstalledPlugins(deps.db).find(
            (candidate) =>
              candidate.sourceKind === "builtin" &&
              candidate.sourceBuiltinName === bundled.name,
          );
          if (row === undefined) continue;
          const manifest = await readPluginManifest(bundled.rootDir);
          const loop = createPluginDevLoop({
            pluginId: row.id,
            hasApp: manifest.appEntry !== undefined,
            buildApp: async () => {
              try {
                await buildPluginApp(
                  bundled.rootDir,
                  deps.appVersion,
                  await getPluginBuildToolchain(deps),
                );
                setDevBuildProblem(row.id, null);
                notifyPluginsChanged();
              } catch (error) {
                setDevBuildProblem(
                  row.id,
                  error instanceof Error ? error.message : String(error),
                );
                notifyPluginsChanged();
                throw error;
              }
            },
            reloadPlugin: async () => {
              await withLifecycleLock(row.id, async () => {
                const current = getInstalledPlugin(deps.db, row.id);
                if (current === undefined) return;
                await disposeOne(row.id);
                await loadOne(current);
              });
              await syncCliSkill();
              notifyPluginsChanged();
            },
            log: (message) => logger.info(`plugin ${row.id}: ${message}`),
          });
          const watcher = watch(
            bundled.rootDir,
            { recursive: true },
            (_event, filename) => {
              if (typeof filename === "string" && filename.length > 0) {
                loop.handleChange(filename);
              }
            },
          );
          watcher.on("close", () => loop.dispose());
          builtinSourceWatchers.push(watcher);
        }
      }
      await syncCliSkill();
      notifyPluginsChanged();
    },

    async stop() {
      for (const watcher of builtinSourceWatchers.splice(0)) watcher.close();
      await disposeAll();
      await syncCliSkill();
      notifyPluginsChanged();
    },

    list,

    async install(source) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const parsed = parsePluginSource(source);
        if (parsed.kind === "builtin") return installBuiltinSource(parsed);
        if (parsed.kind === "git") return installGitSource(parsed, source);
        if (parsed.kind === "npm") {
          refuseBuiltinShadow(derivePluginId(parsed.name));
          return installNpmSource(parsed, source);
        }
        return installPathSource(parsed.path);
      });
    },

    async installOfficialPlugin(name) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const bundled = bundledPlugins.find(
          (plugin) => plugin.name === name && !plugin.autoInstall,
        );
        if (bundled === undefined) {
          throw new Error(`unknown official plugin "${name}"`);
        }
        return installBuiltinSource({ kind: "builtin", name });
      });
    },

    installPath: (path) =>
      withPluginOperationLock(REGISTRATION_MUTATION_KEY, () =>
        installPathSource(path),
      ),

    ...pluginUpdates,

    async remove(id) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        const row = getInstalledPlugin(deps.db, id);
        await withLifecycleLock(id, () => disposeOne(id));
        statuses.delete(id);
        handlerStats.delete(id);
        agentToolProblems.delete(id);
        appBundles.delete(id);
        brandingAssets.delete(id);
        identities.delete(id);
        forgetPluginApiClient(id);
        const removed = row
          ? row.sourceKind === "builtin"
            ? markInstalledPluginRemoved(deps.db, id)
            : deleteInstalledPlugin(deps.db, id)
          : false;
        if (removed && row) {
          // The uninstalled tree is no longer reloadable, so stop the module
          // resolve hook from scanning it on every later import.
          forgetMutableRoot(row.rootDir);
          // Configuration goes with the registration (a future same-id plugin
          // must not inherit secrets); kv rows and data.db are plugin data and
          // survive a remove/reinstall cycle. Schedule rows belong to the
          // registration too.
          deletePluginSchedules(deps.db, id);
          deleteAllPluginSettings(deps.db, id);
          await rm(pluginSecretsDir(deps.dataDir, id), {
            recursive: true,
            force: true,
          });
          // Legacy managed installs still own their mutable pre-cache layout.
          // Immutable artifact directories are retained for future GC policy;
          // path: sources are the user's directory and are never deleted.
          const managedDir =
            row.activeArtifactId === null && row.sourceKind === "git"
              ? row.rootDir
              : row.activeArtifactId === null &&
                  row.sourceKind === "npm" &&
                  row.sourceNpmPackage !== null &&
                  row.sourceNpmRequestedSpec !== null
                ? npmInstallPrefix(
                    deps.dataDir,
                    row.sourceNpmPackage,
                    row.sourceNpmRequestedSpec || "latest",
                  )
                : undefined;
          if (managedDir !== undefined) {
            await rm(managedDir, { recursive: true, force: true });
          }
        }
        await syncCliSkill();
        notifyPluginsChanged();
        return removed;
      });
    },

    async setEnabled(id, enabled) {
      return withPluginOperationLock(REGISTRATION_MUTATION_KEY, async () => {
        if (!setInstalledPluginEnabled(deps.db, id, enabled)) return undefined;
        if (enabled) {
          const row = getInstalledPlugin(deps.db, id);
          if (row) {
            await withLifecycleLock(id, () => loadOne(row));
          }
        } else {
          await withLifecycleLock(id, async () => {
            await disposeOne(id);
            // A hung service outranks "disabled": the degraded status (set by
            // stopServices) is the only trace of the still-running start().
            if ((hungServices.get(id)?.size ?? 0) === 0) {
              setStatus(id, "disabled");
            }
          });
        }
        await syncCliSkill();
        notifyPluginsChanged();
        return list().find((p) => p.id === id);
      });
    },

    async reload(id) {
      const rows = listInstalledPlugins(deps.db).filter(
        (row) => id === undefined || row.id === id,
      );
      for (const row of rows.sort((a, b) => a.id.localeCompare(b.id))) {
        // An explicit reload is a fresh chance for a plugin whose process kept
        // crashing: whatever the operator changed, this is them asking for it
        // to be tried again.
        clearPlacementQuarantine(row.id);
        await withLifecycleLock(row.id, () => loadOne(row));
      }
      await syncCliSkill();
      notifyPluginsChanged();
    },

    getApi(id) {
      return loaded.get(id)?.handle.api;
    },

    getAppAsset(id, kind) {
      // Honest gate: assets are only downloadable while the plugin runtime
      // is live. A disabled/errored/removed plugin's recorded snapshot may
      // still ride the inventory for display, but its bytes are not served.
      if (!loaded.has(id)) return undefined;
      const assets = appBundles.get(id)?.assets;
      if (!assets) return undefined;
      const path = kind === "js" ? assets.jsPath : assets.cssPath;
      if (path === null) return undefined;
      return { path, hash: assets.hash };
    },

    getBrandingAsset(id, variant) {
      // Branding is identity, not runtime: serve it for a disabled or
      // incompatible plugin too, matching the inventory.
      const set = loaded.has(id)
        ? brandingAssets.get(id)
        : identities.get(id)?.brandingAssets;
      const asset =
        variant === "icon"
          ? set?.compactIcon
          : variant === "logo-dark"
            ? set?.logoDark
            : set?.logo;
      if (!asset) return undefined;
      return {
        bytes: asset.bytes,
        contentType: asset.contentType,
        hash: asset.hash,
      };
    },

    async getSettings(id) {
      const plugin = loaded.get(id);
      if (!plugin) return undefined;
      return buildPluginSettingsView({
        db: deps.db,
        dataDir: deps.dataDir,
        pluginId: id,
        descriptors: plugin.handle.settings.descriptors,
      });
    },

    async updateSettings(id, values) {
      const plugin = loaded.get(id);
      if (!plugin) return undefined;
      const storeArgs = {
        db: deps.db,
        dataDir: deps.dataDir,
        pluginId: id,
        descriptors: plugin.handle.settings.descriptors,
      };
      const errors = validatePluginSettingsUpdate(
        storeArgs.descriptors,
        values,
      );
      if (errors.length > 0) {
        throw new PluginSettingsValidationError(errors.join("; "));
      }
      const prev = await readPluginSettingsValues(storeArgs);
      await writePluginSettingsUpdate({ ...storeArgs, values });
      const next = await readPluginSettingsValues(storeArgs);
      if (JSON.stringify(next) !== JSON.stringify(prev)) {
        for (const listener of plugin.handle.settings.listeners) {
          try {
            listener(next, prev);
          } catch (error) {
            logger.warn(
              `plugin ${id} settings onChange listener failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        // Effective values changed: broadcast so every open page's settings
        // queries (plugin-sdk useSettings included) refetch instead of
        // serving the pre-save snapshot until stale time.
        notifyPluginsChanged();
        // A plugin stuck on needs-configuration is waiting for exactly this
        // save — reload it so the new values take effect without a manual
        // `patcher plugin reload` (the NeedsConfigurationError contract documents
        // this). Healthy plugins are NOT reloaded: they read settings lazily
        // via settings.get(), and restarting live services on every toggle
        // would be disruptive.
        if (statuses.get(id)?.status === "needs-configuration") {
          const row = getInstalledPlugin(deps.db, id);
          if (row) {
            await withLifecycleLock(id, async () => {
              await disposeOne(id);
              await loadOne(row);
            });
            notifyPluginsChanged();
          }
        }
      }
      return buildPluginSettingsView(storeArgs);
    },

    getHttpRoute(id, method, path) {
      const normalizedMethod = method.toUpperCase();
      return wireLookup(id, (plugin) =>
        plugin.handle.httpRoutes.find(
          (route) => route.method === normalizedMethod && route.path === path,
        ),
      );
    },

    getRpcHandler(id, method) {
      return wireLookup(id, (plugin) => plugin.handle.rpcHandlers.get(method));
    },

    async invokeHttpRoute(id, route, context) {
      const outcome = await invokeCallback(
        id,
        {
          kind: "http",
          target: `${route.method} ${route.path}`,
          payload: context,
        },
        async (payload) => {
          const response = await route.handler(payload);
          // Structural, not `instanceof`: `@hono/node-server` swaps
          // `globalThis.Response` for its own class when the server starts
          // listening, which made a route returning `Response.json(...)` fail
          // this check in a running server. See `isResponseLike`.
          if (!isResponseLike(response)) {
            throw new Error("http route handler must return a Response");
          }
          return response;
        },
      );
      if (outcome.ok) return outcome.value;
      return context.json(
        { ok: false, error: `plugin route failed: ${outcome.error}` },
        500,
      );
    },

    async invokeRpcHandler(id, method, handler, input) {
      const outcome = await invokeCallback(
        id,
        { kind: "rpc", target: method, payload: input },
        // The same call, wherever the handler is: in-process it validates
        // here, and a plugin process runs this exact function on its side.
        (payload) => runRpcCall(handler, payload),
      );
      if (outcome.ok) return { ok: true, result: outcome.value };
      const boundary = rpcBoundaryError(outcome.cause);
      if (boundary !== null) return { ok: false, error: boundary };
      return {
        ok: false,
        error: { code: "handler_error", message: outcome.error },
      };
    },

    apiIdentities,
    apiPermissionProblem(pluginId, required) {
      if (required === null) {
        return `plugin "${pluginId}" may not reach this path: it carries no permission classification`;
      }
      const granted = new Set(
        loaded.get(pluginId)?.manifest.permissions ??
          identities.get(pluginId)?.manifest.permissions ??
          [],
      );
      const missing = required.filter((permission) => !granted.has(permission));
      if (missing.length === 0) return null;
      return (
        `${missing.map((permission) => `"${permission}"`).join(" and ")} ` +
        `${missing.length === 1 ? "is" : "are"} required, which plugin ` +
        `"${pluginId}" does not declare in "patcher.permissions"`
      );
    },
    async httpToken(id, options) {
      if (!getInstalledPlugin(deps.db, id)) return undefined;
      const dir = pluginSecretsDir(deps.dataDir, id);
      if (options?.rotate) {
        await deleteSecretFile(join(dir, HTTP_TOKEN_FILE));
      }
      return readOrCreateSecretFile({
        bytes: 32,
        dataDir: dir,
        encoding: "hex",
        fileName: HTTP_TOKEN_FILE,
      });
    },

    listCliContributions() {
      return cliContributions();
    },

    async runCliCommand(id, argv, ctx) {
      const fail = (stderr: string) =>
        enforcePluginCliOutputLimit(
          { exitCode: 1, stdout: "", stderr },
          argv.includes("--json"),
        );
      const plugin = loaded.get(id);
      if (!plugin) {
        const row = getInstalledPlugin(deps.db, id);
        if (!row) return fail(`unknown plugin "${id}"`);
        const runtime = statuses.get(id);
        const status = runtime?.status ?? (row.enabled ? "error" : "disabled");
        const detail = runtime?.detail ?? (row.enabled ? "not loaded" : null);
        return fail(
          `plugin "${id}" is not running (status: ${status}${detail ? ` — ${detail}` : ""})`,
        );
      }
      const registration = plugin.handle.cli.registration;
      if (!registration) {
        return fail(`plugin "${id}" registers no CLI command`);
      }
      const outcome = await invokeCallback(
        id,
        {
          kind: "cli",
          target: registration.name,
          // Same split as agentTool: everything but the signal is data.
          payload: {
            argv,
            ctx: {
              cwd: ctx.cwd,
              threadId: ctx.threadId,
              projectId: ctx.projectId,
            },
          },
        },
        async (payload, signal) => {
          const result = await registration.run(payload.argv, {
            ...payload.ctx,
            ...(signal === undefined ? {} : { signal }),
          });
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
        },
        { source: ctx.signal },
      );
      if (outcome.ok) return outcome.value;
      return fail(`patcher ${registration.name} failed: ${outcome.error}`);
    },

    listSkillRootContributions() {
      return [...loaded.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([pluginId, plugin]) =>
          plugin.manifest.skillsRootPaths.map((rootPath) => ({
            pluginId,
            rootPath,
          })),
        );
    },

    listAgentTools() {
      return collectAgentTools().map(({ pluginId, record }) => ({
        pluginId,
        tool: {
          name: record.name,
          description: record.description,
          inputSchema: record.inputSchema,
        },
        instructions: record.instructions,
      }));
    },

    async resolveAgentConfiguration({ context, skillIdsByPlugin }) {
      const allTools = collectAgentTools();
      const tools: PluginAgentToolContribution[] = [];
      const selectedSkillIdsByPlugin = new Map<string, ReadonlySet<string>>();
      const dynamicInstructions: Array<{ pluginId: string; text: string }> = [];

      for (const [pluginId, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const pluginTools = allTools.filter(
          (entry) => entry.pluginId === pluginId,
        );
        const provider = plugin.handle.agentConfigurationProvider;
        if (provider === null) {
          tools.push(
            ...pluginTools.map(({ record }) => ({
              pluginId,
              tool: {
                name: record.name,
                description: record.description,
                inputSchema: record.inputSchema,
              },
              instructions: record.instructions,
            })),
          );
          continue;
        }

        const knownSkillIds = new Set(skillIdsByPlugin.get(pluginId) ?? []);
        const knownToolIds = new Set(
          pluginTools.map(({ record }) => record.name),
        );
        const outcome = await invokeCallback(
          pluginId,
          { kind: "agentConfigure", payload: context },
          (payload) =>
            normalizePluginAgentConfiguration({
              knownSkillIds,
              knownToolIds,
              pluginId,
              value: provider(payload),
            }),
        );
        if (!outcome.ok) {
          selectedSkillIdsByPlugin.set(pluginId, new Set());
          continue;
        }

        const selectedTools = new Set(outcome.value.toolIds);
        const parameterOverrides = outcome.value.toolParameterOverrides;
        tools.push(
          ...pluginTools
            .filter(({ record }) => selectedTools.has(record.name))
            .map(({ record }) => ({
              pluginId,
              tool: {
                name: record.name,
                description: record.description,
                inputSchema:
                  parameterOverrides[record.name] ?? record.inputSchema,
              },
              instructions: record.instructions,
            })),
        );
        selectedSkillIdsByPlugin.set(pluginId, new Set(outcome.value.skillIds));
        if (outcome.value.instructions !== null) {
          dynamicInstructions.push({
            pluginId,
            text: outcome.value.instructions,
          });
        }
      }

      return { tools, selectedSkillIdsByPlugin, dynamicInstructions };
    },

    listInstructionContributions() {
      const out: PluginInstructionContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        const provider = plugin.handle.instructionProvider;
        if (provider === null) continue;
        out.push({ pluginId: id, provider });
      }
      return out;
    },

    findAgentTool(name) {
      return collectAgentTools().find((entry) => entry.record.name === name);
    },

    async invokeAgentTool({ pluginId, record, input, ctx }) {
      // Bad arguments are the model's problem, not the plugin's: respond
      // with an isError result without running (or blaming) plugin code.
      const parsed = record.parse(input);
      if (!parsed.ok) {
        return {
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: `Invalid arguments for tool "${record.name}": ${parsed.error}`,
            },
          ],
        };
      }
      const outcome = await invokeCallback(
        pluginId,
        {
          kind: "agentTool",
          target: record.name,
          // The signal is left out on purpose: it is a channel, not a value.
          // A transport carries cancellation as its own message and builds a
          // signal on the far side; here that far side is this closure.
          payload: {
            input: parsed.value,
            ctx: { threadId: ctx.threadId, projectId: ctx.projectId },
          },
        },
        async (payload, signal) => {
          const result = await record.execute(payload.input, {
            ...payload.ctx,
            // Rebuilt from the cancel message, not forwarded; the far side is
            // this process today and the plugin host tomorrow.
            signal: signal ?? ctx.signal,
          });
          return normalizeAgentToolResult(record.name, result);
        },
        { source: ctx.signal },
      );
      if (outcome.ok) return outcome.value;
      return {
        success: false,
        contentItems: [
          {
            type: "inputText",
            text: `Tool "${record.name}" failed: ${outcome.error}`,
          },
        ],
      };
    },

    listMentionProviderContributions() {
      const contributions: PluginMentionProviderContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.mentionProviders) {
          contributions.push({
            pluginId: id,
            id: record.id,
            label: record.label,
            triggers: record.triggers,
          });
        }
      }
      return contributions;
    },

    async searchMentions(args) {
      const entries = [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      if (entries.length === 0) return [];
      const tasks: Array<Promise<PluginMentionSearchGroup | null>> = [];
      for (const [id, plugin] of entries) {
        for (const record of [...plugin.handle.mentionProviders]) {
          if (!record.triggers.includes(args.trigger)) continue;
          tasks.push(
            (async () => {
              const outcome = await invokeCallback(
                id,
                {
                  kind: "mentionSearch",
                  target: record.id,
                  payload: {
                    trigger: args.trigger,
                    query: args.query,
                    projectId: args.projectId,
                    threadId: args.threadId,
                  },
                },
                async () => {
                  const searchPromise = (async () =>
                    record.search({
                      trigger: args.trigger,
                      query: args.query,
                      projectId: args.projectId,
                      threadId: args.threadId,
                    }))();
                  // The race abandons a timed-out search; keep its eventual
                  // rejection observed so it cannot surface as an unhandled
                  // rejection later.
                  searchPromise.catch(() => {});
                  let timer: NodeJS.Timeout | undefined;
                  try {
                    const result = await Promise.race([
                      searchPromise,
                      new Promise<never>((_, reject) => {
                        timer = setTimeout(
                          () =>
                            reject(
                              new Error(
                                `timed out after ${mentionSearchTimeoutMs}ms`,
                              ),
                            ),
                          mentionSearchTimeoutMs,
                        );
                        timer.unref?.();
                      }),
                    ]);
                    return normalizeMentionSearchItems(record.id, result);
                  } finally {
                    if (timer !== undefined) clearTimeout(timer);
                  }
                },
              );
              if (!outcome.ok || outcome.value.length === 0) return null;
              return {
                pluginId: id,
                providerId: record.id,
                label: record.label,
                items: outcome.value,
              };
            })(),
          );
        }
      }
      return (await Promise.all(tasks)).filter(
        (group): group is PluginMentionSearchGroup => group !== null,
      );
    },

    async resolveMention({ pluginId, itemId }) {
      const separatorIndex = itemId.indexOf(":");
      const providerId =
        separatorIndex > 0 ? itemId.slice(0, separatorIndex) : "";
      const providerItemId =
        separatorIndex > 0 ? itemId.slice(separatorIndex + 1) : "";
      if (providerId.length === 0 || providerItemId.length === 0) {
        return {
          ok: false,
          error: `malformed plugin mention item id ${JSON.stringify(itemId)}`,
        };
      }
      const lookup = wireLookup(pluginId, (plugin) =>
        plugin.handle.mentionProviders.find(
          (record) => record.id === providerId,
        ),
      );
      if (lookup.outcome === "unknown-plugin") {
        return { ok: false, error: `unknown plugin "${pluginId}"` };
      }
      if (lookup.outcome === "not-running") {
        const detail = lookup.detail ? ` — ${lookup.detail}` : "";
        return {
          ok: false,
          error: `plugin "${pluginId}" is not running (status: ${lookup.status}${detail})`,
        };
      }
      if (lookup.outcome === "not-found") {
        return {
          ok: false,
          error: `plugin "${pluginId}" has no mention provider "${providerId}"`,
        };
      }
      const provider = lookup.value;
      const outcome = await invokeCallback(
        pluginId,
        {
          kind: "mentionResolve",
          target: providerId,
          payload: { itemId: providerItemId },
        },
        async (payload) => {
          const resolvePromise = (async () =>
            provider.resolve(payload.itemId))();
          // The race abandons a timed-out resolve; keep its eventual
          // rejection observed so it cannot surface as an unhandled
          // rejection later.
          resolvePromise.catch(() => {});
          let timer: NodeJS.Timeout | undefined;
          let result: unknown;
          try {
            result = await Promise.race([
              resolvePromise,
              new Promise<never>((_, reject) => {
                timer = setTimeout(
                  () =>
                    reject(
                      new Error(`timed out after ${mentionResolveTimeoutMs}ms`),
                    ),
                  mentionResolveTimeoutMs,
                );
                timer.unref?.();
              }),
            ]);
          } finally {
            if (timer !== undefined) clearTimeout(timer);
          }
          const context = (result as { context?: unknown } | null)?.context;
          if (typeof context !== "string" || context.trim().length === 0) {
            throw new Error(
              `mention provider "${providerId}" resolve() must return { context: string }`,
            );
          }
          return context;
        },
      );
      if (outcome.ok) return { ok: true, context: outcome.value };
      return { ok: false, error: outcome.error };
    },

    listContextMenuItemContributions() {
      const contributions: PluginContextMenuItemContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.contextMenuItems) {
          contributions.push({
            pluginId: id,
            itemId: record.id,
            title: record.title,
            when: record.when,
          });
        }
      }
      return contributions;
    },

    async runContextMenuItem({ context, itemId, pluginId }) {
      const plugin = loaded.get(pluginId);
      const record = plugin?.handle.contextMenuItems.find(
        (candidate) => candidate.id === itemId,
      );
      if (!plugin || record === undefined) {
        return {
          ok: false,
          error: `plugin "${pluginId}" has no context menu item "${itemId}"`,
        };
      }
      const outcome = await invokeCallback(
        pluginId,
        { kind: "browserContextMenu", target: itemId, payload: context },
        async (payload) =>
          withPluginTimeout({
            run: async () => record.run(payload),
            timeoutMs: contextMenuRunTimeoutMs,
          }),
      );
      return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
    },

    listFindActionContributions() {
      const contributions: PluginFindActionContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.findActions) {
          contributions.push({
            pluginId: id,
            itemId: record.id,
            title: record.title,
          });
        }
      }
      return contributions;
    },

    async runFindAction({ context, itemId, pluginId }) {
      const plugin = loaded.get(pluginId);
      const record = plugin?.handle.findActions.find(
        (candidate) => candidate.id === itemId,
      );
      if (!plugin || record === undefined) {
        return {
          ok: false,
          error: `plugin "${pluginId}" has no find action "${itemId}"`,
        };
      }
      const outcome = await invokeCallback(
        pluginId,
        { kind: "browserFindAction", target: itemId, payload: context },
        async (payload) =>
          withPluginTimeout({
            run: async () => record.run(payload),
            // The same box a picked menu item gets: both are one deliberate
            // click on a browser surface.
            timeoutMs: contextMenuRunTimeoutMs,
          }),
      );
      return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
    },

    listSearchEngineContributions() {
      const contributions: PluginSearchEngineContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const engine of plugin.handle.searchEngines) {
          contributions.push({
            pluginId: id,
            id: engine.id,
            name: engine.name,
            urlTemplate: engine.urlTemplate,
          });
        }
      }
      return contributions;
    },

    listPageStyleContributions() {
      const contributions: PluginPageStyleContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const style of plugin.handle.pageStyles) {
          contributions.push({
            pluginId: id,
            styleId: style.id,
            matches: [...style.matches],
            css: style.css,
          });
        }
      }
      return contributions;
    },

    listPageScriptContributions() {
      const contributions: PluginPageScriptContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const script of plugin.handle.pageScripts) {
          contributions.push({
            pluginId: id,
            scriptId: script.id,
            matches: [...script.matches],
            code: script.code,
          });
        }
      }
      return contributions;
    },

    listTabActionContributions() {
      const contributions: PluginTabActionContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.tabActions) {
          contributions.push({
            pluginId: id,
            itemId: record.id,
            title: record.title,
          });
        }
      }
      return contributions;
    },

    async runTabAction({ context, itemId, pluginId }) {
      const plugin = loaded.get(pluginId);
      const record = plugin?.handle.tabActions.find(
        (candidate) => candidate.id === itemId,
      );
      if (!plugin || record === undefined) {
        return {
          ok: false,
          error: `plugin "${pluginId}" has no tab action "${itemId}"`,
        };
      }
      const outcome = await invokeCallback(
        pluginId,
        { kind: "browserTabAction", target: itemId, payload: context },
        async (payload) =>
          withPluginTimeout({
            run: async () => record.run(payload),
            // The same box a picked menu item gets, because that is what it is.
            timeoutMs: contextMenuRunTimeoutMs,
          }),
      );
      return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
    },

    listToolbarItemContributions() {
      const contributions: PluginToolbarItemContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.toolbarItems) {
          contributions.push({
            pluginId: id,
            itemId: record.id,
            title: record.title,
            icon: record.icon,
            hasState: record.state !== null,
          });
        }
      }
      return contributions;
    },

    async describeToolbarItemStates({ context }) {
      const tasks: Array<Promise<PluginToolbarItemState | null>> = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of [...plugin.handle.toolbarItems]) {
          const state = record.state;
          if (state === null) continue;
          tasks.push(
            (async () => {
              const outcome = await invokeCallback(
                id,
                {
                  kind: "browserToolbarState",
                  target: record.id,
                  payload: context,
                },
                async (payload) =>
                  normalizeToolbarItemState({
                    itemId: record.id,
                    result: await withPluginTimeout({
                      run: async () => state(payload),
                      timeoutMs: toolbarStateTimeoutMs,
                    }),
                  }),
              );
              if (!outcome.ok || outcome.value === null) return null;
              return {
                pluginId: id,
                itemId: record.id,
                active: outcome.value.active,
                title: outcome.value.title,
              };
            })(),
          );
        }
      }
      return (await Promise.all(tasks)).filter(
        (state): state is PluginToolbarItemState => state !== null,
      );
    },

    async runToolbarItem({ context, itemId, pluginId }) {
      const plugin = loaded.get(pluginId);
      const record = plugin?.handle.toolbarItems.find(
        (candidate) => candidate.id === itemId,
      );
      if (!plugin || record === undefined) {
        return {
          ok: false,
          error: `plugin "${pluginId}" has no toolbar item "${itemId}"`,
        };
      }
      const outcome = await invokeCallback(
        pluginId,
        { kind: "browserToolbarRun", target: itemId, payload: context },
        async (payload) =>
          withPluginTimeout({
            run: async () => record.run(payload),
            // The same box a picked menu item gets: one deliberate click.
            timeoutMs: contextMenuRunTimeoutMs,
          }),
      );
      return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
    },

    listNewTabWidgetContributions() {
      const contributions: PluginNewTabWidgetContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.newTabWidgets) {
          contributions.push({ pluginId: id, widgetId: record.id });
        }
      }
      return contributions;
    },

    async describeNewTabSections({ context }) {
      const tasks: Array<Promise<PluginNewTabSection | null>> = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of [...plugin.handle.newTabWidgets]) {
          tasks.push(
            (async () => {
              const outcome = await invokeCallback(
                id,
                {
                  kind: "browserNewTabRows",
                  target: record.id,
                  payload: context,
                },
                async (payload) =>
                  normalizeNewTabRows({
                    result: await withPluginTimeout({
                      run: async () => record.rows(payload),
                      timeoutMs: newTabRowsTimeoutMs,
                    }),
                    widgetId: record.id,
                  }),
              );
              if (!outcome.ok || outcome.value.length === 0) return null;
              return {
                pluginId: id,
                widgetId: record.id,
                label: record.label,
                rows: outcome.value,
              };
            })(),
          );
        }
      }
      return (await Promise.all(tasks)).filter(
        (section): section is PluginNewTabSection => section !== null,
      );
    },

    listCommandContributions() {
      const contributions: PluginCommandContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.commands) {
          contributions.push({
            pluginId: id,
            commandId: record.id,
            title: record.title,
            shortcut: { ...record.shortcut },
          });
        }
      }
      return contributions;
    },

    async runCommand({ commandId, pluginId }) {
      const plugin = loaded.get(pluginId);
      const record = plugin?.handle.commands.find(
        (candidate) => candidate.id === commandId,
      );
      if (!plugin || record === undefined) {
        return {
          ok: false,
          error: `plugin "${pluginId}" has no command "${commandId}"`,
        };
      }
      const outcome = await invokeCallback(
        pluginId,
        { kind: "uiCommand", target: commandId, payload: {} },
        async () =>
          withPluginTimeout({
            run: async () => record.run(),
            // A keypress is a deliberate action, like a picked menu entry.
            timeoutMs: contextMenuRunTimeoutMs,
          }),
      );
      return outcome.ok ? { ok: true } : { ok: false, error: outcome.error };
    },

    async describeSiteInfo({ context }) {
      const entries = [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      const tasks: Array<Promise<PluginSiteInfoSection | null>> = [];
      for (const [id, plugin] of entries) {
        for (const record of [...plugin.handle.siteInfoProviders]) {
          tasks.push(
            (async () => {
              const outcome = await invokeCallback(
                id,
                {
                  kind: "browserSiteInfo",
                  target: record.id,
                  payload: context,
                },
                async (payload) =>
                  normalizeSiteInfoRows({
                    providerId: record.id,
                    result: await withPluginTimeout({
                      run: async () => record.describe(payload),
                      timeoutMs: siteInfoTimeoutMs,
                    }),
                  }),
              );
              if (!outcome.ok || outcome.value.length === 0) return null;
              return {
                pluginId: id,
                providerId: record.id,
                label: record.label,
                rows: outcome.value,
              };
            })(),
          );
        }
      }
      return (await Promise.all(tasks)).filter(
        (section): section is PluginSiteInfoSection => section !== null,
      );
    },

    async resolveBrowserAuth({ challenge }) {
      for (const [pluginId, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const provider of plugin.handle.authProviders) {
          const outcome = await invokeCallback(
            pluginId,
            { kind: "browserAuth", payload: challenge },
            async (payload) =>
              withPluginTimeout({
                run: async () => provider(payload),
                timeoutMs: browserAuthTimeoutMs,
              }),
          );
          if (!outcome.ok || outcome.value === null) {
            continue;
          }
          const credentials =
            outcome.value as Partial<PluginBrowserAuthCredentials>;
          // A provider that answered with something other than credentials has
          // not answered: the browser asks the user rather than sending a
          // half-formed login.
          if (
            typeof credentials?.username !== "string" ||
            typeof credentials.password !== "string"
          ) {
            continue;
          }
          return {
            username: credentials.username,
            password: credentials.password,
          };
        }
      }
      return null;
    },

    async resolveBrowserExternalLink({ link }) {
      for (const [pluginId, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const handler of plugin.handle.externalLinkHandlers) {
          const outcome = await invokeCallback(
            pluginId,
            { kind: "browserExternalLink", payload: link },
            async (payload) =>
              withPluginTimeout({
                run: async () => handler(payload),
                timeoutMs: browserExternalLinkTimeoutMs,
              }),
          );
          if (!outcome.ok) {
            continue;
          }
          // Checked here rather than at the route, because this is where the
          // untrusted value arrives — and what it asks for is a navigation.
          const decision = readBrowserExternalLinkDecision(outcome.value);
          if (decision === null) {
            continue;
          }
          return decision;
        }
      }
      return null;
    },

    async resolveBrowserPdfText({ document }) {
      for (const [pluginId, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const provider of plugin.handle.pdfTextProviders) {
          const outcome = await invokeCallback(
            pluginId,
            { kind: "browserPdfText", payload: document },
            async (payload) =>
              withPluginTimeout({
                run: async () => provider(payload),
                timeoutMs: browserPdfTextTimeoutMs,
              }),
          );
          if (!outcome.ok || typeof outcome.value !== "string") {
            continue;
          }
          const text = outcome.value;
          // An empty answer is a decline, not an answer: it leaves the next
          // provider its turn, and leaves the agent the same honest "no text
          // layer" it would have got with no plugins at all.
          if (text.length === 0) {
            continue;
          }
          // Capped here rather than at the route, because this is where the
          // untrusted length arrives. The cap is the browser's own page-read
          // cap: a plugin's text lands in the same agent context as the
          // browser's would have.
          return text.slice(0, BROWSER_PDF_TEXT_MAX_LENGTH);
        }
      }
      return null;
    },

    listKeybindingContributions() {
      const contributions: AppKeybindingOverride[] = [];
      const claimed = new Set<string>();
      for (const [, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const keybinding of plugin.handle.keybindings) {
          if (claimed.has(keybinding.command)) {
            continue;
          }
          claimed.add(keybinding.command);
          contributions.push(keybinding);
        }
      }
      return contributions;
    },

    listOmniboxProviderContributions() {
      const contributions: PluginOmniboxProviderContribution[] = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const record of plugin.handle.omniboxProviders) {
          contributions.push({
            pluginId: id,
            id: record.id,
            label: record.label,
          });
        }
      }
      return contributions;
    },

    async suggestOmnibox({ query }) {
      const entries = [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      if (entries.length === 0) return [];
      const tasks: Array<Promise<PluginOmniboxSuggestGroup | null>> = [];
      for (const [id, plugin] of entries) {
        for (const record of [...plugin.handle.omniboxProviders]) {
          tasks.push(
            (async () => {
              const outcome = await invokeCallback(
                id,
                {
                  kind: "browserOmniboxSuggest",
                  target: record.id,
                  payload: { query },
                },
                async (payload) =>
                  normalizeOmniboxSuggestItems({
                    hasRun: record.run !== null,
                    providerId: record.id,
                    result: await withPluginTimeout({
                      run: async () => record.suggest(payload),
                      timeoutMs: omniboxSuggestTimeoutMs,
                    }),
                  }),
              );
              if (!outcome.ok || outcome.value.length === 0) return null;
              return {
                pluginId: id,
                providerId: record.id,
                label: record.label,
                items: outcome.value,
              };
            })(),
          );
        }
      }
      return (await Promise.all(tasks)).filter(
        (group): group is PluginOmniboxSuggestGroup => group !== null,
      );
    },

    async reportBrowserDownload(download) {
      const tasks: Array<Promise<unknown>> = [];
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const handler of [...plugin.handle.downloadHandlers]) {
          tasks.push(
            invokeCallback(
              id,
              { kind: "browserDownload", payload: download },
              async (payload) =>
                withPluginTimeout({
                  run: async () => handler(payload),
                  timeoutMs: browserDownloadTimeoutMs,
                }),
            ),
          );
        }
      }
      await Promise.all(tasks);
      return { handlerCount: tasks.length };
    },

    async applyBrowserHistoryFilters(visit) {
      let current = visit;
      for (const [id, plugin] of [...loaded.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      )) {
        for (const [index, filter] of plugin.handle.historyFilters.entries()) {
          const outcome = await invokeCallback(
            id,
            {
              kind: "browserHistoryFilter",
              target: String(index),
              payload: current,
            },
            async (payload) =>
              withPluginTimeout({
                run: async () =>
                  normalizeBrowserHistoryDecision(await filter(payload)),
                timeoutMs: browserHistoryFilterTimeoutMs,
              }),
          );
          if (!outcome.ok) continue;
          const decision = outcome.value;
          if ("drop" in decision) return null;
          current = applyBrowserHistoryRewrite(current, decision.rewrite);
        }
      }
      return current;
    },

    async runOmniboxAction({ itemId, pluginId, query }) {
      const separatorIndex = itemId.indexOf(":");
      const providerId =
        separatorIndex > 0 ? itemId.slice(0, separatorIndex) : "";
      const providerItemId =
        separatorIndex > 0 ? itemId.slice(separatorIndex + 1) : "";
      if (providerId.length === 0 || providerItemId.length === 0) {
        return {
          ok: false,
          error: `malformed plugin omnibox item id ${JSON.stringify(itemId)}`,
        };
      }
      const plugin = loaded.get(pluginId);
      const record = plugin?.handle.omniboxProviders.find(
        (candidate) => candidate.id === providerId,
      );
      if (!plugin || !record) {
        return {
          ok: false,
          error: `plugin "${pluginId}" has no omnibox provider "${providerId}"`,
        };
      }
      const run = record.run;
      if (run === null) {
        return {
          ok: false,
          error: `omnibox provider "${providerId}" has no run(itemId)`,
        };
      }
      const outcome = await invokeCallback(
        pluginId,
        {
          kind: "browserOmniboxRun",
          target: providerId,
          payload: { itemId: providerItemId, query },
        },
        async (payload) => {
          const result = await withPluginTimeout({
            run: async () => run(payload.itemId, { query: payload.query }),
            timeoutMs: omniboxRunTimeoutMs,
          });
          if (result === undefined || result === null) return null;
          const navigate = (result as { navigate?: unknown }).navigate;
          if (navigate === undefined) return null;
          if (typeof navigate !== "string" || navigate.trim().length === 0) {
            throw new Error(
              `omnibox provider "${providerId}" run() navigate must be a non-empty url`,
            );
          }
          return navigate;
        },
      );
      if (outcome.ok) return { ok: true, navigate: outcome.value };
      return { ok: false, error: outcome.error };
    },

    async readLogTail(id, tail) {
      if (!getInstalledPlugin(deps.db, id)) return undefined;
      return readPluginLogTail(deps.dataDir, id, tail);
    },

    async sweepDueSchedules(now) {
      if (loaded.size === 0) return;
      const due = listDuePluginSchedules(deps.db, {
        now,
        limit: SCHEDULE_SWEEP_BATCH_SIZE,
      });
      for (const row of due) {
        // Rows are claimed only while their plugin is running; an unloaded
        // plugin's row waits untouched for the next load.
        const schedule = loaded
          .get(row.pluginId)
          ?.handle.schedules.find((record) => record.name === row.name);
        if (!schedule) continue;
        let newNextRunAt: number;
        try {
          // The live registration's cron, not the row's — the row may lag a
          // just-reloaded plugin by one sweep.
          newNextRunAt = nextCronRunAt(schedule.cron, now);
        } catch (error) {
          logger.warn(
            `[plugin:${row.pluginId}] schedule ${row.name} has an invalid cron: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          continue;
        }
        const claimed = claimPluginScheduledRun(deps.db, {
          pluginId: row.pluginId,
          name: row.name,
          expectedNextRunAt: row.nextRunAt,
          newNextRunAt,
          now,
        });
        if (!claimed) continue;
        const outcome = await invokeCallback(
          row.pluginId,
          { kind: "schedule", target: row.name, payload: null },
          () => schedule.fn(),
        );
        recordPluginScheduleResult(deps.db, {
          pluginId: row.pluginId,
          name: row.name,
          status: outcome.ok ? "ok" : "error",
          error: outcome.ok ? null : outcome.error,
          now: Date.now(),
        });
      }
    },
  };
}
