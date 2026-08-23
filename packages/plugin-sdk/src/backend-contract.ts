import type Database from "better-sqlite3";
import type { Context } from "hono";
import type * as z from "zod";
import type { PatcherSdk } from "@patcher/sdk";
import type { ThreadResponse } from "@patcher/server-contract";
import type { JsonValue } from "./json-value.js";
import type { PluginRpcContract, PluginRpcHandlers } from "./rpc-contract.js";

/**
 * The backend plugin API contract — the `patcher` object handed to a plugin's
 * `server.ts` factory (`export default function plugin(patcher: PatcherPluginApi)`).
 *
 * Types only: the implementation lives in the Patcher server
 * (apps/server/src/services/plugins/plugin-api.ts), which imports these
 * shapes so the contract and the implementation cannot drift. Plugin authors
 * import them type-only (`import type { PatcherPluginApi } from
 * "@patcher/plugin-sdk"`); the import is erased when Patcher loads the file.
 *
 * Runtime classes stay host-side. NeedsConfigurationError in particular is
 * matched by NAME, so plugin code needs no runtime import:
 * `throw Object.assign(new Error(msg), { name: "NeedsConfigurationError" })`.
 */

export interface PluginLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

// ---------------------------------------------------------------------------
// Settings (design §4.2).
// ---------------------------------------------------------------------------

/**
 * Declarative settings descriptors (`patcher.settings.define`). Deliberately plain
 * data — not zod — so the host can render settings forms and the CLI can
 * parse values without executing plugin code.
 */
export type PluginSettingDescriptor =
  | {
      type: "string";
      label: string;
      description?: string;
      /** Stored in a 0600 file under <dataDir>/plugins/<id>/secrets/, never in the db or sent to the frontend. */
      secret?: true;
      default?: string;
    }
  | { type: "boolean"; label: string; description?: string; default?: boolean }
  | {
      type: "select";
      label: string;
      description?: string;
      options: string[];
      default?: string;
    }
  | { type: "project"; label: string; description?: string; default?: string };

export type PluginSettingDescriptors = Record<string, PluginSettingDescriptor>;

export type PluginSettingValue = string | boolean;

/** `default` present → non-optional value; absent → `T | undefined`. */
export type PluginSettingsValues<
  Ds extends Record<string, PluginSettingDescriptor>,
> = {
  [K in keyof Ds]: Ds[K] extends { default: string | boolean }
    ? PluginSettingValueOf<Ds[K]>
    : PluginSettingValueOf<Ds[K]> | undefined;
};

type PluginSettingValueOf<D extends PluginSettingDescriptor> = D extends {
  type: "boolean";
}
  ? boolean
  : string;

export interface PluginSettingsHandle<
  Ds extends Record<string, PluginSettingDescriptor>,
> {
  /** Load-safe: callable inside the factory. */
  get(): Promise<PluginSettingsValues<Ds>>;
  /** Fires after values change through the settings route/CLI. */
  onChange(
    listener: (
      next: PluginSettingsValues<Ds>,
      prev: PluginSettingsValues<Ds>,
    ) => void,
  ): void;
}

export interface PluginSettings {
  define<Ds extends Record<string, PluginSettingDescriptor>>(
    descriptors: Ds,
  ): PluginSettingsHandle<Ds>;
}

// ---------------------------------------------------------------------------
// Storage (design §4.3).
// ---------------------------------------------------------------------------

export interface PluginKvStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface PluginStorage {
  /** Namespaced JSON key-value rows in patcher.db; values ≤256KB each. */
  kv: PluginKvStorage;
  /**
   * Open (or reuse the path of) the plugin's own SQLite database at
   * <dataDir>/plugins/<id>/data.db — the server's better-sqlite3, WAL mode,
   * busy_timeout 5000. Handles are host-tracked and closed on
   * dispose/reload; a closed handle throws on use.
   */
  database(): Database.Database;
  /**
   * Ordered-statement migration helper: statement index = migration id in a
   * `_patcher_migrations` table; unapplied statements run in one transaction.
   * Append-only — never reorder or edit shipped statements.
   */
  migrate(db: Database.Database, statements: string[]): void;
}

// ---------------------------------------------------------------------------
// Thread lifecycle events (design §4.5).
// ---------------------------------------------------------------------------

/**
 * Thread lifecycle events a plugin can observe (design §4.5). Observe-only:
 * handlers run fire-and-forget after the transition is applied and can never
 * block or veto it. `thread` is the same public DTO GET /threads/:id serves.
 */
export interface PluginThreadEventPayloads {
  /** Fired after a thread row is created. */
  "thread.created": { thread: ThreadResponse };
  /** Fired when a thread transitions into `active`. */
  "thread.active": { thread: ThreadResponse };
  /** Fired when a thread transitions into `idle`. `lastAssistantText` is
   * assembled the same way GET /threads/:id/output is. */
  "thread.idle": { thread: ThreadResponse; lastAssistantText: string | null };
  /** Fired when a thread transitions into `error`. `error` is the latest
   * system/error event message, when one exists. */
  "thread.failed": { thread: ThreadResponse; error: string | null };
  /** Fired after a thread is archived (including cascade archives). */
  "thread.archived": { thread: ThreadResponse };
  /** Fired after a thread is soft-deleted. */
  "thread.deleted": { thread: ThreadResponse };
}

export type PluginThreadEventName = keyof PluginThreadEventPayloads;

export type PluginThreadEventHandler<E extends PluginThreadEventName> = (
  payload: PluginThreadEventPayloads[E],
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// Wire surfaces: HTTP, rpc, realtime (design §4.6/§4.7).
// ---------------------------------------------------------------------------

export type PluginHttpAuthMode = "local" | "token" | "none";

export type PluginHttpHandler = (
  context: Context,
) => Response | Promise<Response>;

export interface PluginHttp {
  /**
   * Register an HTTP route, mounted at
   * `/api/v1/plugins/<id>/http/<path>`. Auth modes (default "local"):
   * - "local": Origin/Host must be a local Patcher app origin; non-GET requires
   *   content-type application/json (forces a CORS preflight).
   * - "token": requires the per-plugin token (`patcher plugin token <id>`) via
   *   the x-patcher-plugin-token header or ?token=.
   * - "none": no checks — only for signature-verified webhooks.
   */
  route(
    method: string,
    path: string,
    handler: PluginHttpHandler,
    opts?: { auth?: PluginHttpAuthMode },
  ): void;
}

export interface PluginRpc {
  /**
   * Register a Standard Schema-driven rpc contract and its inferred handlers,
   * served at POST
   * `/api/v1/plugins/<id>/rpc/<method>` with "local" auth semantics. The
   * host validates input before invocation and output before strict JSON
   * serialization. The response is `{ ok: true, result }` or
   * `{ ok: false, error: { code, message, issues? } }`.
   */
  register<Contract extends PluginRpcContract>(
    contract: Contract,
    handlers: PluginRpcHandlers<Contract>,
  ): void;
}

export interface PluginRealtime {
  /**
   * Broadcast an ephemeral `plugin-signal` WS message
   * `{ pluginId, channel, payload }` to every connected client (V1 has no
   * per-channel subscriptions). `payload` must be JSON-serializable;
   * `undefined` is normalized to `null`. Nothing is persisted.
   */
  publish(channel: string, payload: unknown): void;
}

// ---------------------------------------------------------------------------
// Background services and schedules (design §4.8).
// ---------------------------------------------------------------------------

export interface PluginBackground {
  /**
   * Register a long-lived background service. `start` runs after the
   * factory completes and should resolve when `signal` aborts
   * (dispose/reload/disable/shutdown). A crash restarts it with capped
   * exponential backoff; throwing NeedsConfigurationError marks the plugin
   * `needs-configuration` and stops restarting until the next load.
   */
  service(
    name: string,
    service: { start(signal: AbortSignal): void | Promise<void> },
  ): void;
  /**
   * Register a cron schedule (5-field expression, server-local time). The
   * durable row keyed (pluginId, name) is upserted at load; the periodic
   * sweep claims due rows with a CAS on next_run_at, but only while this
   * plugin is loaded. Failures land in last_status/last_error, visible in
   * `patcher plugin list`.
   */
  schedule(name: string, cron: string, fn: () => void | Promise<void>): void;
}

// ---------------------------------------------------------------------------
// Agent-facing CLI subcommands (design §4.4).
// ---------------------------------------------------------------------------

export interface PluginCliCommandInfo {
  name: string;
  summary: string;
  usage: string;
}

/** Context forwarded from the invoking CLI when known; all fields optional. */
export interface PluginCliContext {
  cwd?: string;
  threadId?: string;
  projectId?: string;
  /** Aborted when the invoking CLI HTTP request disconnects. */
  signal?: AbortSignal;
}

export type PluginInteractionCancelReason =
  | "user"
  | "request-aborted"
  | "thread-stopped"
  | "thread-deleted"
  | "plugin-disposed"
  | "server-restarted"
  | "timeout";

export type PluginInteractionResult =
  | { outcome: "submitted"; value: JsonValue }
  | { outcome: "cancelled"; reason: PluginInteractionCancelReason };

export interface PluginInteractionRequest {
  threadId: string;
  rendererId: string;
  title: string;
  payload: JsonValue;
  /** Defaults to ten minutes; capped at one hour. */
  timeoutMs?: number;
}

export interface PluginCliResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

/**
 * Maximum combined UTF-8 bytes accepted from plugin CLI stdout and stderr.
 * This is the shared source of truth for production and the testing harness.
 */
export const PLUGIN_CLI_OUTPUT_MAX_BYTES = 1024 * 1024;

export interface PluginCliOutputLimitError {
  code: "plugin_cli_output_too_large";
  message: string;
  maxBytes: number;
  stdoutBytes: number;
  stderrBytes: number;
  totalBytes: number;
}

/** Normalized host result returned by the plugin CLI HTTP/testing boundary. */
export interface PluginCliExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: PluginCliOutputLimitError;
}

export interface PluginCliRegistration {
  /** Top-level command name (`patcher <name> …`): lowercase [a-z0-9-]+, and not
   * a core Patcher command (see RESERVED_PATCHER_CLI_COMMANDS in the server). */
  name: string;
  summary: string;
  /** Subcommand metadata rendered in help and the plugin-commands skill
   * without executing plugin code. Parsing argv is plugin-owned. */
  commands?: PluginCliCommandInfo[];
  run(
    argv: string[],
    ctx: PluginCliContext,
  ): PluginCliResult | Promise<PluginCliResult>;
}

export interface PluginCli {
  /**
   * Register this plugin's `patcher` subcommand. One registration per factory
   * execution; a repeated call is rejected. Core Patcher commands always win
   * name collisions; reserved names are rejected at registration.
   */
  register(registration: PluginCliRegistration): void;
}

// ---------------------------------------------------------------------------
// Agent surfaces: per-turn context and native tools (design §4.4).
// ---------------------------------------------------------------------------

/** Per-turn context handed to patcher.agents context providers (design §4.4). */
/** MCP-style content parts a native tool may return (design §4.4). */
export type PluginAgentToolContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type PluginAgentToolResult =
  | string
  | { content: PluginAgentToolContentPart[]; isError?: boolean };

/** Per-call context handed to a native tool's execute (design §4.4). */
export interface PluginAgentToolContext {
  threadId: string;
  projectId: string;
  /** The tool-call request's abort signal (aborts if the daemon round-trip
   * is torn down mid-call). */
  signal: AbortSignal;
}

/**
 * Native timeline labels for a plugin tool, keyed by Patcher's own timeline row
 * status. This is experimental: Patcher may refine its presentation contract
 * before the field is stabilized.
 */
export interface PluginAgentToolExperimentalStatusLabels {
  /** Label shown while the tool call is pending. */
  pending: string;
  /** Label shown after the tool call completes successfully. */
  completed: string;
}

export interface PluginAgentToolRegistrationBase {
  /** Tool name shown to the model: [a-zA-Z0-9_-]+, unique across plugins,
   * and not a built-in dynamic tool (see RESERVED_AGENT_TOOL_NAMES in the
   * server). */
  name: string;
  description: string;
  /**
   * Optional usage snippet appended to the thread instructions whenever
   * this tool is in the session's tool set (mirrors the built-in
   * update_environment_directory guidance). Limited to 4096 characters.
   */
  instructions?: string;
  /**
   * Optional native timeline labels. When omitted, Patcher shows the standard
   * tool name and arguments (for example, `Ran tool search_docs …`). Labels
   * apply only while the call is pending and after successful completion;
   * approval, error, and interruption states keep Patcher's standard rendering.
   */
  experimental_statusLabels?: PluginAgentToolExperimentalStatusLabels;
}

/** Stable, plain-data context resolved by the server for one agent session. */
export interface PluginAgentConfigurationContext {
  thread: {
    id: string;
    title: string | null;
    parentThreadId: string | null;
    sourceThreadId: string | null;
  };
  project: {
    id: string;
    kind: "standard" | "personal";
    name: string;
    gitRemoteUrl: string | null;
  };
  environment: {
    id: string;
    name: string | null;
    path: string | null;
    workspaceProvisionType: "unmanaged" | "managed-worktree" | "personal";
    branchName: string | null;
  };
  host: {
    id: string;
    name: string;
  };
  provider: {
    id: string;
    model: string;
  };
  /** How the thread was spawned. A side chat is the builtin side-chat
   * plugin's fork: `{ kind: "fork", pluginId: "side-chat" }`. */
  origin: {
    kind: "fork" | null;
    pluginId: string | null;
  };
}

/** Object form of a {@link PluginAgentConfiguration} tools entry: selects a
 * registered tool and overrides the parameter schema advertised to the
 * provider for this resolution only. */
export interface PluginAgentToolSelection {
  /** Name of a tool registered by this plugin via `registerTool`. */
  name: string;
  /** JSON-schema object (root `type: "object"`, JSON-serializable, at most
   * 128 KiB serialized) sent to the provider in place of the registered
   * parameter schema. Execution-side validation still runs the registered
   * parameters, so the override must only narrow what the registered schema
   * already accepts. */
  parameters: Record<string, unknown>;
}

/** Per-resolution selection returned by {@link PluginAgents.configure}. */
export interface PluginAgentConfiguration {
  /** Tool names registered by this plugin, or {@link PluginAgentToolSelection}
   * entries to also override a tool's advertised parameter schema for this
   * resolution. Duplicate or unknown names, or an invalid override, reject
   * this plugin's complete selection for the resolution. */
  tools: Array<string | PluginAgentToolSelection>;
  /** Skill frontmatter names from this plugin's manifest skill roots.
   * Duplicate or unknown names reject this plugin's complete selection. */
  skills: string[];
  /** Optional dynamic instructions. Output is truncated to 4096 characters. */
  instructions?: string;
}

export interface PluginAgents {
  /**
   * Select this plugin's statically registered tools and manifest skills for
   * each thread/session resolution, with optional dynamic instructions. The
   * callback is synchronous and runs at `thread.start` / `turn.submit`; it
   * never rebuilds registrations. Exactly one callback may be registered per
   * factory execution. A throw, malformed result, duplicate id, unknown id,
   * or more than 256 tool/skill ids fails closed for this plugin only.
   *
   * Tools take effect when the provider session is next started or resumed;
   * an already-running session is not hot-mutated. Instructions follow the
   * same boundary: a live provider session keeps the instructions it was
   * constructed with, and a changed selection applies when the session is
   * next constructed. Skill changes follow Patcher's environment runtime policy:
   * a busy runtime keeps its current catalog until a safe relaunch. Side chats
   * are ordinary plugin-owned forks here — read `origin` to detect them — and
   * their returned tool, skill, and dynamic-instruction selections apply at the
   * same boundaries.
   */
  configure(
    provider: (
      context: PluginAgentConfigurationContext,
    ) => PluginAgentConfiguration,
  ): void;
  /**
   * Register a native dynamic tool (design §4.4). `parameters` is either a
   * zod schema (validated per call; execute receives the parsed value) or a
   * plain JSON-schema object (no validation; execute receives the raw
   * arguments as `unknown`). Tool-set changes apply on the NEXT session
   * start — a tool registered mid-session is not hot-added to running
   * provider sessions. A second registration of the same name within this
   * plugin is rejected; a name already registered by another plugin is
   * rejected and surfaced as this plugin's status detail.
   */
  registerTool<Schema extends z.ZodType>(
    tool: PluginAgentToolRegistrationBase & {
      parameters: Schema;
      execute(
        params: z.output<Schema>,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    },
  ): void;
  registerTool(
    tool: PluginAgentToolRegistrationBase & {
      /** Raw JSON-schema escape hatch; params arrive unvalidated. */
      parameters: Record<string, unknown>;
      execute(
        params: unknown,
        ctx: PluginAgentToolContext,
      ): PluginAgentToolResult | Promise<PluginAgentToolResult>;
    },
  ): void;
  /**
   * Contribute a dynamic section appended to thread instructions. The
   * provider runs when a thread's runtime command config is resolved
   * (thread.start / turn.submit); return null to contribute nothing for
   * that resolution. A live provider session keeps the instructions it was
   * constructed with — a changed contribution takes effect when the
   * provider session is next constructed (thread start or resume after a
   * daemon restart, environment switch, or provider restart), never
   * mid-session. Must be synchronous and fast — it sits on the
   * thread-start path. Output longer than 4096 characters is truncated; a
   * throwing provider is logged against the plugin and contributes nothing.
   * A repeated registration within one factory execution is rejected.
   */
  contributeInstructions(
    provider: (ctx: { threadId: string; projectId: string }) => string | null,
  ): void;
}

// ---------------------------------------------------------------------------
// Host-rendered UI contributions (design §4.9).
// ---------------------------------------------------------------------------

export type PluginMentionTrigger = "@" | "#" | "$" | "!" | "~";

/** Search context handed to a mention provider (design §4.9). `projectId`/
 * `threadId` are null when the composer has not committed one yet. */
export interface PluginMentionSearchContext {
  trigger: PluginMentionTrigger;
  query: string;
  projectId: string | null;
  threadId: string | null;
}

/** One row a mention provider returns from `search`. `id` is the provider's
 * own item id — the host namespaces it before it reaches the wire. */
export interface PluginMentionItem {
  id: string;
  title: string;
  subtitle?: string;
  icon?: string;
}

export interface PluginMentionProviderRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+ (no ":" — the host composes
   * wire item ids as "<providerId>:<itemId>"). */
  id: string;
  /** Section label shown above this provider's rows in the mention menu. */
  label: string;
  /**
   * Composer trigger characters this provider should answer. Omit to use the
   * default `@` mention trigger. Valid triggers are `@`, `#`, `$`, `!`, and `~`.
   */
  triggers?: readonly PluginMentionTrigger[];
  /**
   * Runs server-side as the user types after one of this provider's triggers
   * in the composer. Each call is time-boxed (2s) and failure-isolated: a slow
   * or throwing provider contributes an empty list — it can never break the
   * mention menu.
   */
  search(
    ctx: PluginMentionSearchContext,
  ): PluginMentionItem[] | Promise<PluginMentionItem[]>;
  /**
   * Resolves one picked item into agent context, called once per unique
   * item at message send time. The returned `context` is attached to the
   * message as an agent-visible (user-hidden) prompt input. Throwing blocks
   * the send with a visible error.
   */
  resolve(itemId: string): { context: string } | Promise<{ context: string }>;
}

export interface PluginUi {
  /** Block until the app submits or cancels a plugin-owned composer form. */
  requestInput(
    request: PluginInteractionRequest,
    options?: { signal?: AbortSignal },
  ): Promise<PluginInteractionResult>;
  /**
   * Register a mention provider for the shipped app's composer (design §4.9).
   * Providers default to the `@` trigger and may opt into `#`, `$`, `!`, or
   * `~` with `triggers`. Items group under `label` in the mention menu; a
   * picked item becomes a `{ kind: "plugin" }` mention resource whose context
   * is resolved once at send time. Multiple providers per plugin; ids must be
   * unique within the plugin.
   */
  registerMentionProvider(provider: PluginMentionProviderRegistration): void;
  /**
   * Rebind a keyboard shortcut for the shipped app (`browser.shortcuts`).
   *
   * This changes what *this install's* defaults are, so it sits under the
   * user's own overrides: a shortcut the user has rebound in settings keeps
   * winning, and the settings UI shows a plugin's binding as the default rather
   * than as something the user changed.
   *
   * `command` must be a known app command id — `browser.newTab`,
   * `thread.search`, and so on; an unknown one is a registration error rather
   * than a silent no-op. A null `shortcut` unassigns the command, which is how
   * a plugin frees a chord it wants to leave to the page.
   *
   * Between plugins the lowest plugin id wins a contested command, so the
   * result does not depend on load order.
   */
  registerKeybinding(keybinding: PluginKeybinding): void;
  /**
   * Add a command of your own, with a keyboard shortcut for it
   * (`app.commands`) — see {@link PluginCommandRegistration}.
   *
   * Ungated, like `registerKeybinding` and for the same reason: a chord that runs
   * your own code discloses nothing. Anything the command then reads is gated
   * where it already was — the current page costs `tabs.read`.
   */
  registerCommand(command: PluginCommandRegistration): void;
}

/**
 * Modifiers default to false, so a binding names only what it uses. `mod` is
 * Command on macOS and Control elsewhere — the portable one, and the one almost
 * every binding wants.
 */
export interface PluginKeybindingShortcut {
  key: string;
  alt?: boolean;
  control?: boolean;
  meta?: boolean;
  mod?: boolean;
  shift?: boolean;
}

export interface PluginKeybinding {
  command: string;
  /** Null unassigns the command. */
  shortcut: PluginKeybindingShortcut | null;
}

/**
 * A command of the plugin's own, with the chord that runs it.
 *
 * The difference from {@link PluginUi.registerKeybinding}: that one rebinds a
 * command **Patcher** already has, while this one adds a command Patcher has never heard
 * of. Which is also why it is a separate list rather than an entry in Patcher's
 * keybinding config — Patcher's command ids are a closed set, and a plugin's are not.
 *
 * Deliberately context-free: `run` is handed nothing. A command that needs the
 * page the user is on reads it (`patcher.browser.page.getUrl()`,
 * `patcher.browser.tabs.list()`) and pays `tabs.read` for it — the permission that
 * already governs seeing where the user is. Handing the address to every chord
 * would be a disclosure nobody agreed to for a shortcut.
 */
export interface PluginCommandRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+. */
  id: string;
  /** What the shortcut is called wherever it is listed — Settings, for now. */
  title: string;
  /**
   * The chord. Required: Patcher has no command palette yet, so a command without one
   * would have no way to be run at all.
   *
   * Patcher's own bindings win a contested chord — including one the user rebound —
   * and between plugins the lowest plugin id wins, so what happens does not
   * depend on load order. A chord never fires while the user is typing or a
   * dialog is open, the same rule Patcher's own shortcuts follow.
   */
  shortcut: PluginKeybindingShortcut;
  /** Runs server-side when the chord fires. Nothing waits on it. */
  run(): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// Browser contributions: browser.omnibox.providers.
// ---------------------------------------------------------------------------

/** Search context handed to an omnibox provider. */
export interface PluginOmniboxSuggestContext {
  /** What the user has typed, trimmed. Never empty. */
  query: string;
}

/** What selecting a plugin's omnibox suggestion does. */
export type PluginOmniboxAction =
  /** Open a URL in the browser tab the omnibox belongs to. */
  | { type: "navigate"; url: string }
  /**
   * Call this provider's `run(itemId)` back on the server. Use it when the
   * suggestion is an action rather than a destination — asking an agent,
   * starting a job — and optionally return a URL to open afterwards.
   */
  | { type: "run" };

/**
 * One row an omnibox provider returns. `id` is the provider's own item id —
 * the host namespaces it before it reaches the wire.
 */
export interface PluginOmniboxSuggestion {
  id: string;
  title: string;
  subtitle?: string;
  /**
   * Rank in [0, 1], clamped by the host; defaults to 0.5 when omitted. Score 1
   * belongs to the browser's own default action — what pressing Enter does with
   * nothing selected — and plugin rows are ranked after the built-in providers
   * at equal scores, so a plugin cannot take the top row away from it.
   */
  score?: number;
  action: PluginOmniboxAction;
}

/** What a `run` action asks the browser to do once the plugin is done. */
export interface PluginOmniboxRunResult {
  /** Open this URL in the tab the suggestion was picked from. */
  navigate?: string;
}

/** Context handed to `run`, so an action can use the query it was offered for. */
export interface PluginOmniboxRunContext {
  /** The query the picked suggestion was produced for. */
  query: string;
}

export interface PluginOmniboxProviderRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+ (no ":" — the host composes
   * wire item ids as "<providerId>:<itemId>"). */
  id: string;
  /** Source label shown on this provider's rows, next to the browser's own. */
  label: string;
  /**
   * Runs server-side as the user types in the browser's omnibox. Each call is
   * time-boxed (2s) and failure-isolated: a slow or throwing provider
   * contributes nothing — it can never break the omnibox, whose built-in rows
   * keep working regardless.
   */
  suggest(
    ctx: PluginOmniboxSuggestContext,
  ): PluginOmniboxSuggestion[] | Promise<PluginOmniboxSuggestion[]>;
  /**
   * Performs a `{ type: "run" }` suggestion, called once when the user picks
   * that row. `itemId` is this provider's own item id. Required if any returned
   * suggestion uses a `run` action.
   */
  run?(
    itemId: string,
    ctx: PluginOmniboxRunContext,
  ): PluginOmniboxRunResult | void | Promise<PluginOmniboxRunResult | void>;
}

/**
 * How a download ended. There is no `started`: a handler runs once a download
 * is over, so it never sees a half-written file it might be tempted to move.
 *
 * `refused` is Patcher's own decision (the page asked for too many at once) and
 * nothing was written, which is why `savePath` is null for it alone.
 */
export type PluginBrowserDownloadState =
  | "completed"
  | "cancelled"
  | "interrupted"
  | "refused";

export interface PluginBrowserDownload {
  /** Unique per download, for correlating a handler's own bookkeeping. */
  id: string;
  /** The browser tab whose page started it. */
  tabId: string;
  /** The name Patcher wrote — sanitized, and not necessarily what the page asked for. */
  filename: string;
  /** Absolute path of the file on disk; null when nothing was written. */
  savePath: string | null;
  /** Where it came from, and what the server said it was. */
  url: string;
  mimeType: string;
  state: PluginBrowserDownloadState;
}

/**
 * Called after Patcher has finished writing a download.
 *
 * **This is where a plugin takes downloads over.** The file is on disk and
 * nothing else is holding it, so a handler is free to move it somewhere by
 * media type, rename it from the page's title, hand it to an agent, upload it,
 * or delete it outright. Multiple handlers run independently; each is
 * time-boxed and failure-isolated, so a slow or throwing one changes nothing
 * for the others or for the browser.
 *
 * What a handler cannot do is stop the write, and that is a platform limit
 * rather than a policy: Chromium demands the save path **synchronously**, while
 * a plugin lives in another process. So Patcher writes to the user's downloads
 * folder first and hands the result over; a plugin that wants files elsewhere
 * moves them, and one that wants them gone deletes them.
 */
/** What a context-menu item was clicked on. Every field is page-supplied. */
export interface PluginBrowserContextMenuContext {
  /** The browser tab the menu was opened in. */
  tabId: string;
  pageUrl: string;
  /** The link under the pointer, when there was one. */
  linkUrl: string | null;
  /** The image under the pointer, when there was one. */
  imageUrl: string | null;
  selectionText: string | null;
}

/**
 * Where an item appears. Any match is enough, so `{ link: true, image: true }`
 * shows on both; omitting `when` shows it everywhere.
 *
 * `page` means a right-click with nothing under the pointer — no link, no
 * image, no selection.
 */
export interface PluginBrowserContextMenuWhen {
  image?: boolean;
  link?: boolean;
  page?: boolean;
  selection?: boolean;
}

export interface PluginBrowserContextMenuItemRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+. */
  id: string;
  /** The menu label, shown under the browser's own entries. */
  title: string;
  when?: PluginBrowserContextMenuWhen;
  /**
   * Runs server-side when the user picks the item. Fire-and-forget from the
   * menu's point of view — the menu has already closed — so report progress
   * through your own surfaces rather than by returning something.
   */
  run(context: PluginBrowserContextMenuContext): void | Promise<void>;
}

export type PluginBrowserDownloadHandler = (
  download: PluginBrowserDownload,
) => void | Promise<void>;

/** A site asking a browsed page for a username and password. */
export interface PluginBrowserAuthChallenge {
  /** The browser tab whose page was challenged. */
  tabId: string;
  /** `example.com`, or `example.com:8443` when the port is not the default. */
  host: string;
  /** True when the credentials would travel unencrypted (plain `http`). */
  insecure: boolean;
}

export interface PluginBrowserAuthCredentials {
  username: string;
  password: string;
}

/**
 * Answers an HTTP authentication challenge before a human is asked, which is
 * what makes a password manager a plugin rather than a feature.
 *
 * Return null to decline — the browser then asks the user, which is also what
 * happens when every provider declines, throws or takes too long. A provider is
 * asked **once per host per tab**: a second challenge from the same host means
 * the first answer was wrong, and repeating it would spin.
 */
export type PluginBrowserAuthProvider = (
  challenge: PluginBrowserAuthChallenge,
) =>
  | PluginBrowserAuthCredentials
  | null
  | Promise<PluginBrowserAuthCredentials | null>;

/** What a tab action was run on — one tab in the browser surface's strip. */
export interface PluginBrowserTabActionContext {
  tabId: string;
  /**
   * The page's address, empty for a tab that has no page yet — and **null** for
   * a Patcher screen (Settings, a plugin's own panel), which is a tab with no page at
   * all. Null is therefore how an action tells the two kinds apart.
   */
  url: string | null;
  title: string | null;
  pinned: boolean;
  /** Web tabs only: a Patcher screen has no page of its own to silence. */
  muted: boolean;
  /** Whether this is the tab the window is currently showing. */
  active: boolean;
}

export interface PluginBrowserTabActionRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+. */
  id: string;
  /** The menu label, shown under the browser's own tab entries. */
  title: string;
  /**
   * Runs server-side when the user picks the entry. Fire-and-forget, like a
   * context-menu item: the menu has already closed, so report progress through
   * your own surfaces rather than by returning something.
   */
  run(context: PluginBrowserTabActionContext): void | Promise<void>;
}

/** The page a toolbar control is being asked about, or was pressed on. */
export interface PluginBrowserToolbarContext {
  /** The browser tab whose toolbar this is. */
  tabId: string;
  /** The page's address. Never empty — the toolbar is not drawn over Patcher's own
   * screens, so there is always a page. */
  url: string;
  title: string | null;
}

/**
 * How a control should look for the page it was asked about. Every field is
 * optional because every field has to have a safe default: the control is drawn
 * before an answer arrives.
 */
export interface PluginBrowserToolbarState {
  /**
   * Whether the control is *on* for this page — a saved bookmark, a reader mode
   * that is running. The host renders it as an accent on the declared icon
   * rather than by swapping the icon, so the button does not change shape as
   * answers arrive.
   */
  active?: boolean;
  /** Replaces the declared title while this page is open. */
  title?: string;
}

/**
 * A control in the browser's toolbar, and what it says about the page under it.
 *
 * The only contribution point that is asked about a page **without the user
 * doing anything** — which is what makes a star that is already filled possible,
 * and what makes this cost a permission of its own.
 */
export interface PluginBrowserToolbarItemRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+. */
  id: string;
  /** The control's accessible name, and its tooltip. */
  title: string;
  /**
   * Icon hint, resolved like every other plugin icon: your `patcher.branding.icon`,
   * then the manifest's, then this name, then a generic mark. Fixed at
   * registration — see {@link PluginBrowserToolbarState.active} for why.
   */
  icon?: string;
  /**
   * What this control looks like for the page in the tab, asked on navigation
   * and after your own `run` finishes.
   *
   * Return `null` to keep what was declared. Time-boxed like a site-info
   * section: the control is already on screen, so a `state` that hangs leaves
   * the declared look rather than an empty space. Omit it entirely for a control
   * that is the same everywhere — nothing is then asked of the plugin as the
   * user browses, and nothing is spent on it.
   */
  state?(
    context: PluginBrowserToolbarContext,
  ):
    | PluginBrowserToolbarState
    | null
    | Promise<PluginBrowserToolbarState | null>;
  /**
   * Runs server-side when the user presses the control. Fire-and-forget like a
   * context-menu item — report through your own surfaces — except for one
   * thing: `state` is asked again once this resolves, so a control that toggles
   * something shows its new look without doing anything else.
   */
  run(context: PluginBrowserToolbarContext): void | Promise<void>;
}

/** Which tab's new-tab screen is asking. There is no page yet — that is the point. */
export interface PluginBrowserNewTabContext {
  tabId: string;
}

/** One row of a new-tab section: what it says, and where it goes. */
export interface PluginBrowserNewTabRow {
  title: string;
  /** Second line, muted — a host, a note, a date. */
  subtitle?: string;
  /**
   * Opened when the row is clicked, in the tab the screen is on. `http` and
   * `https` only: a new-tab row is a link, and `javascript:` or `file:` from a
   * plugin is not a link the browser will follow.
   */
  url: string;
}

/**
 * A section on the browser's new-tab screen — the empty page a fresh tab shows,
 * where Patcher lists recently visited pages.
 *
 * Rows are **links**, so clicking one runs no plugin code: the browser navigates
 * to what the plugin already said. That is what keeps a list of saved pages
 * feeling like part of the browser instead of a remote call per click.
 */
export interface PluginBrowserNewTabWidgetRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+. */
  id: string;
  /** The section heading, e.g. "Bookmarks". */
  label: string;
  /**
   * The rows to show, asked each time a new-tab screen appears.
   *
   * Return `null` — or no rows — to show nothing, which is what a section with
   * nothing saved yet should do rather than a heading over an empty list.
   * Time-boxed like a site-info section: the screen is already on display, so a
   * widget that hangs is left out rather than waited for.
   */
  rows(
    context: PluginBrowserNewTabContext,
  ): PluginBrowserNewTabRow[] | null | Promise<PluginBrowserNewTabRow[] | null>;
}

/**
 * CSS the browser applies to pages on the sites this plugin declared.
 *
 * The declaration is data — no callback, nothing asked of the plugin as the user
 * browses — so a style keeps working while the plugin is idle, and a page that
 * matches nothing costs nothing.
 *
 * What it can and cannot do, because the difference matters when writing one:
 * the rules apply to the **main frame only** (a subframe keeps its own
 * stylesheets), they are re-applied on every navigation rather than surviving
 * one, and they land once the navigation has committed — early enough that a
 * network page has usually not painted the element yet, but not a guarantee that
 * it never appears. A rule that must never be seen is not something this surface
 * can promise.
 */
export interface PluginBrowserPageStyleRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+. */
  id: string;
  /**
   * Which of the plugin's declared sites this stylesheet is for. Each entry must
   * be one of the patterns in `patcher.sites` — the manifest is where the user reads
   * what a plugin reaches, so code may pick from that list but never widen it.
   */
  matches: string[];
  /**
   * The stylesheet, as text. Ordinary CSS against the page's own DOM; the page's
   * author wrote theirs first, so a rule that has to win says `!important` like
   * any other late stylesheet.
   */
  css: string;
}

/**
 * What the page-side half of a page script is handed.
 *
 * Two members, and no more on purpose. This code runs next to a site the user is
 * signed in to; every name here is something the browser has to be willing to
 * stand behind, so the surface is the channel home and the one piece of timing
 * sugar that keeps the common case from being a footgun.
 *
 * It arrives as the global `patcher` inside the script — declare it at the top of the
 * source (`declare const patcher: PluginPageScriptApi`) to type-check a script written
 * as a template literal.
 */
export interface PluginPageScriptApi {
  /**
   * Call one of this plugin's own rpc methods, and nothing else.
   *
   * This is the whole reason a page script beats a userscript: a page cannot read
   * a token from the user's keychain, open a database or reach a host the site's
   * CSP forbids, and the plugin's backend can do all three. Input and result
   * cross as JSON, so both must be JSON-serialisable, and both are bounded.
   *
   * Rejects — never throws synchronously — if the plugin is not running, the
   * method does not exist, the page has since navigated somewhere the plugin does
   * not declare, or the script is calling faster than the browser will carry.
   */
  rpc(method: string, input?: unknown): Promise<unknown>;
  /**
   * Run `callback` once the document has been parsed, or immediately if it
   * already has.
   *
   * A page script starts before the page's first element exists, which is what
   * makes it powerful and what makes `document.body.append(...)` at the top level
   * a crash. Anything touching the DOM goes in here; anything that has to happen
   * before the page's own scripts (patching `fetch`, taking a global) stays
   * outside it.
   */
  ready(callback: () => void): void;
}

/**
 * The plugin's own code, run in pages on the sites this plugin declared.
 *
 * The declaration is data, like a page style: the browser holds the source and
 * hands it to a matching document, so nothing is asked of the plugin as the user
 * browses and a page that matches nothing costs nothing.
 *
 * What the browser promises about running it — all of it measured, none of it
 * inherited from Chrome's content scripts:
 *
 * - It runs **before the page's own first script**, when the document exists and
 *   the parser has produced nothing (`document.documentElement` is null). Use
 *   `patcher.ready` for DOM work.
 * - It runs in an **isolated world of this plugin's own**. The page cannot see
 *   `patcher` or anything the script defines, and cannot shadow what it reads. Two
 *   scripts of the same plugin share that world; another plugin's scripts do not.
 * - **Main frame only.** An iframe is out of reach, as it is for a page style.
 * - A script registered while a matching page is already open runs when that page
 *   is **next loaded**.
 * - An error at the top level lands in the page's console — where Patcher's
 *   observation log collects it for agents — and does not stop the next script.
 */
export interface PluginBrowserPageScriptRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+. */
  id: string;
  /**
   * Which of the plugin's declared sites this script is for. Each entry must be
   * one of the patterns in `patcher.sites`, exactly as for a page style: the manifest
   * is what the user read, so code may pick from that list but never widen it.
   */
  matches: string[];
  /**
   * The script, as source text. It is wrapped in a function before it runs, so
   * top-level `const` stays out of the world's globals, and `patcher` is in scope.
   */
  code: string;
}

/**
 * A search engine the user can pick for the browser's address bar.
 *
 * Data only — the browser holds the template and formats it, so nothing is asked
 * of the plugin when the user presses Enter. That is what makes this possible at
 * all: what Enter does is resolved synchronously from the typed text, and a
 * provider that had to be awaited could never own it.
 *
 * The consequence worth knowing: an engine need not search. Any `https` address
 * with `%s` in it is one, and so is a **loopback** address — including your own
 * `patcher.http.route`, which is how "Enter asks an agent" is built.
 */
export interface PluginBrowserSearchEngineRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+. Stored in the user's setting. */
  id: string;
  /** Shown in the setting's list. */
  name: string;
  /**
   * Absolute URL with `%s` where the query goes, escaped by the browser. `https`
   * only, apart from loopback: a search is every word typed into the address bar,
   * and sending that in the clear to another machine is not a plugin's call.
   */
  urlTemplate: string;
}

/** The page the site-info popover is describing. */
export interface PluginBrowserSiteInfoContext {
  /** The browser tab whose padlock was clicked. */
  tabId: string;
  /** The page's address. Never empty — a tab with no page asks nobody. */
  url: string;
  /** `example.com`, or `example.com:8443` when the port is not the default. */
  host: string;
}

/** One line in a provider's section: a name and what it says. */
export interface PluginBrowserSiteInfoRow {
  label: string;
  value: string;
}

export interface PluginBrowserSiteInfoProviderRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+. */
  id: string;
  /** The section heading, e.g. "Passwords". */
  label: string;
  /**
   * What this plugin knows about the site, asked each time the popover opens.
   *
   * Return `null` — or no rows — to show nothing, which is what a provider with
   * nothing to say about *this* site should do rather than a row reading "none".
   * Time-boxed like an omnibox suggestion: the popover is already open, so a
   * provider that hangs is dropped rather than waited for.
   */
  describe(
    context: PluginBrowserSiteInfoContext,
  ):
    | PluginBrowserSiteInfoRow[]
    | null
    | Promise<PluginBrowserSiteInfoRow[] | null>;
}

/** What a find action was run with. */
export interface PluginBrowserFindContext {
  /** The browser tab whose find bar the button was pressed in. */
  tabId: string;
  pageUrl: string;
  /** What the user had typed. Never empty — an empty bar offers no actions. */
  query: string;
}

/** A PDF the browser opened but could not read as text. */
export interface PluginBrowserPdfDocument {
  /** The browser tab the document is open in. */
  tabId: string;
  /** Where it came from — fetchable again with `patcher.browser.storage` cookies. */
  pageUrl: string;
  title: string | null;
}

/**
 * Read a PDF the browser could not, which is what makes OCR a plugin rather
 * than a feature.
 *
 * Asked **only** for a document the browser has already parsed and found no
 * text in: a scan, or pages that are images of text. A PDF with a text layer
 * never reaches a provider, so this is not a way to intercept ordinary reads —
 * it is the one case where the browser has nothing and something else might.
 *
 * Providers are asked in plugin id order and the first non-empty answer wins.
 * Return null to decline; declining, throwing and running out of time are the
 * same answer, and the agent is told the document has no text layer.
 */
export type PluginBrowserPdfTextProvider = (
  document: PluginBrowserPdfDocument,
) => string | null | Promise<string | null>;

/** A link another app asked macOS to open, handed here because Patcher is the
 * user's default browser. */
export interface PluginBrowserExternalLink {
  /** The address. Always `http(s)`: the shell drops every other scheme. */
  url: string;
}

/** What a handler decided about one such link. */
export interface PluginBrowserExternalLinkDecision {
  /** Open this address instead of the one that arrived. Must be `http(s)`. */
  url?: string;
  /**
   * True when the plugin dealt with the link itself and Patcher should open no tab —
   * a link routed to a workspace, filed for later, answered by an agent.
   */
  handled?: boolean;
}

/**
 * Decide where a link the *system* handed Patcher goes.
 *
 * This is the seam the "which browser opens what" apps exist for, and it only
 * exists while Patcher is the default browser: the link was clicked in Mail, Slack or
 * a terminal, and Patcher is what macOS launched with it.
 *
 * Handlers are asked in plugin id order and the **first decision wins** — a
 * rewritten address, or `handled` for a link the plugin took over. Return null to
 * decline; declining, throwing and running out of time are the same answer, and
 * the link opens in a tab exactly as it would with no plugins at all. The user is
 * waiting on a click, so the time box is short.
 */
export type PluginBrowserExternalLinkHandler = (
  link: PluginBrowserExternalLink,
) =>
  | PluginBrowserExternalLinkDecision
  | null
  | Promise<PluginBrowserExternalLinkDecision | null>;

export interface PluginBrowserFindActionRegistration {
  /** Unique within this plugin: [a-zA-Z0-9_-]+. */
  id: string;
  /** The button label, shown after the browser's own find controls. */
  title: string;
  /**
   * Runs server-side when the user presses the button. Fire-and-forget, like a
   * context-menu item: the find bar does not wait for it, so report progress
   * through your own surfaces rather than by returning something.
   */
  run(context: PluginBrowserFindContext): void | Promise<void>;
}

/** A page about to be written to the browser's history store. */
export interface PluginBrowserHistoryVisit {
  /**
   * The surface the visit happened on — an agent thread's id, or the browser
   * surface's own. History is stored per scope, which is why the new-tab screen
   * of one thread shows that thread's pages.
   */
  scopeId: string;
  url: string;
  title: string | null;
  visitedAt: number;
}

/** What to record instead. Omitted fields keep what the visit carried. */
export interface PluginBrowserHistoryRewrite {
  url?: string;
  title?: string | null;
}

/**
 * Decide what the browser remembers about a page — see
 * `patcher.browser.registerHistoryFilter`.
 *
 * Return nothing to accept the visit as it stands, a rewrite to change what is
 * stored (strip tracking parameters, retitle a page whose own title is
 * useless), or `null` to drop it, which is how "never record this site" is
 * built without the browser knowing what a private site is.
 *
 * Filters run before the write, in plugin id order, each seeing the previous
 * one's result; the first `null` ends it. A filter that throws or runs out of
 * time is skipped, so a broken plugin loses its say rather than the user's
 * history.
 */
export type PluginBrowserHistoryFilter = (
  visit: PluginBrowserHistoryVisit,
) =>
  | PluginBrowserHistoryRewrite
  | null
  | void
  | Promise<PluginBrowserHistoryRewrite | null | void>;

// ---------------------------------------------------------------------------
// Browser control: browser.tabs.*, browser.page.*, browser.navigation.*.
// ---------------------------------------------------------------------------

/**
 * One tab of the browser surface.
 *
 * `live` is the field to read before anything else. A tab only has a real page
 * behind it once it has been the active tab while the browser surface was open,
 * so tab bookkeeping works for every tab while reading a page or replaying its
 * history only works for a live one. When `live` is false the navigation flags
 * are false because they are unknown, not because the answer is no.
 */
export interface PluginBrowserTab {
  tabId: string;
  url: string;
  title: string | null;
  active: boolean;
  live: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PluginBrowserCallOptions {
  /**
   * Abandons the wait — not the page. A navigation already under way keeps
   * going; only this call stops waiting for it. Pass a tool's `ctx.signal` so an
   * abandoned turn does not sit out the timeout.
   */
  signal?: AbortSignal;
  /** 1–60000ms, default 10000. */
  timeoutMs?: number;
}

export interface PluginBrowserTabs {
  list(options?: PluginBrowserCallOptions): Promise<PluginBrowserTab[]>;
  /** Omit `url` to open the browser's new-tab screen. */
  open(
    args?: { url?: string; activate?: boolean },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  close(
    args: { tabId: string },
    options?: PluginBrowserCallOptions,
  ): Promise<{ closedTabId: string; tabs: PluginBrowserTab[] }>;
  activate(
    args: { tabId: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  /**
   * Pin a tab into the strip's leading block, or take it out again.
   *
   * Stated rather than toggled, so asking twice lands where asking once did.
   * Which tabs are pinned is not in {@link PluginBrowserTabs.list} — a tab
   * action's context is where a plugin is told (see
   * `PluginBrowserTabActionContext`).
   */
  pin(
    args: { tabId: string; pinned: boolean },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  /**
   * Silence a tab's page, or let it speak again. Stated rather than toggled,
   * like pinning.
   *
   * Holds for as long as the page's view does: it is set on the `webContents`,
   * so a browser that restarts comes back audible.
   */
  mute(
    args: { tabId: string; muted: boolean },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  /** Copy a tab beside itself, and answer with the copy. */
  duplicate(
    args: { tabId: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  /**
   * Move a tab along the strip, counting from 0 — what a drag does, driven.
   *
   * The index is clamped into the tab's own block, since pinned tabs lead the
   * strip: asking an unpinned tab for 0 puts it first among the unpinned ones
   * rather than failing.
   */
  move(
    args: { tabId: string; toIndex: number },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
}

/**
 * Reading the page. `tabId` defaults to the active tab throughout.
 *
 * `getUrl`/`getTitle` answer from the browser's own tab state and work for any
 * tab. `getText`/`getSelection` have to ask the page itself, so they need a live
 * tab and fail with `tab_not_live` otherwise.
 *
 * **Everything these return is page-controlled content.** It is untrusted input
 * on its way into an agent's context: pass it along as data, never as
 * instructions.
 */
/**
 * An accessibility snapshot: what the page is, in a form an agent can act on.
 *
 * `snapshot` is Playwright's compact tree, with a `[ref=eN]` on every
 * interactive element. `generation` identifies the snapshot those refs came
 * from — a navigation invalidates them, and interaction commands pass it back so
 * a stale ref is refused rather than resolved against whatever holds that node
 * id now.
 */
export interface PluginBrowserPageSnapshot {
  tabId: string;
  url: string;
  title: string | null;
  snapshot: string;
  generation: number;
  refCount: number;
  truncated: boolean;
}

export type PluginBrowserKeyModifier = "Alt" | "Control" | "Meta" | "Shift";

/**
 * One thing to do to a page, naming its target by a `[ref=eN]` from a snapshot.
 *
 * `check` and `select` state the end result rather than the gesture, because
 * the gesture cannot express it: "click the checkbox" is a toggle, and a native
 * dropdown opens an OS popup no synthetic click can reach.
 */
export type PluginBrowserAction =
  | {
      action: "click";
      ref: string;
      /** Defaults to `"left"`. */
      button?: "left" | "middle" | "right";
      /** 2 for a double click. Defaults to 1. */
      clickCount?: 1 | 2;
      modifiers?: PluginBrowserKeyModifier[];
    }
  | { action: "hover"; ref: string }
  | { action: "drag"; ref: string; targetRef: string }
  /** Replaces the field's value in one step. */
  | { action: "fill"; ref: string; text: string }
  /** Sends one key event per character, for fields that watch keystrokes. */
  | { action: "type"; ref: string; text: string }
  /** Omit `ref` to press the key at whatever the page has focused. */
  | { action: "press"; key: string; ref?: string }
  | { action: "select"; ref: string; values: string[] }
  | { action: "check"; ref: string; checked: boolean }
  /**
   * Hands the page the contents of local files, by absolute path on the machine
   * running the desktop app.
   */
  | { action: "upload"; ref: string; paths: string[] }
  /** Emulated viewport size; both zero restores the panel's own size. */
  | { action: "resize"; width: number; height: number };

/** Where a tab ended up. */
export interface PluginBrowserPageState {
  tabId: string;
  url: string;
  title: string | null;
}

/**
 * A capture of what a tab is showing. `base64` rather than bytes because that is
 * what crossed the wire: a caller forwarding it on (into a tool result, say)
 * would otherwise pay for a decode and a re-encode, and one that wants the bytes
 * spends a single `Buffer.from(base64, "base64")`.
 *
 * `width`/`height` are the captured pixels. For a viewport capture those are
 * device pixels, larger than the CSS viewport on a retina display; for a
 * full-page capture they are CSS pixels, because that capture is rendered at
 * 1:1. `fullPage` says which, and `truncated` says the document was longer than
 * one capture can hold and this is its top.
 */
export interface PluginBrowserScreenshot extends PluginBrowserPageState {
  mimeType: "image/png" | "image/jpeg";
  base64: string;
  width: number;
  height: number;
  fullPage: boolean;
  truncated: boolean;
}

export interface PluginBrowserPdf extends PluginBrowserPageState {
  base64: string;
  byteLength: number;
}

/** One line the page wrote to its console. Page-authored, like page text. */
export interface PluginBrowserConsoleEntry {
  level: "debug" | "info" | "warning" | "error";
  text: string;
  /** Script URL the message came from; empty when the page gave none. */
  source: string;
  line: number;
  timestamp: number;
}

/**
 * One request the tab finished. `status` is null when there was no response —
 * `error` then carries Chromium's `net::ERR_*` name, including for a request
 * Patcher's own session firewall refused.
 */
export interface PluginBrowserNetworkEntry {
  method: string;
  url: string;
  /** Chromium's resource type (`mainFrame`, `xhr`, `script`, …). */
  resourceType: string;
  status: number | null;
  fromCache: boolean;
  error: string | null;
  timestamp: number;
}

/**
 * A slice of one of a tab's logs.
 *
 * `droppedCount` is what makes the slice honest: the buffers are fixed-size
 * rings filled from the moment the tab was created, so a busy page loses its
 * oldest entries, and the requested limit cuts more. Read it before concluding a
 * page logged nothing.
 */
export interface PluginBrowserLog<TEntry> extends PluginBrowserPageState {
  entries: TEntry[];
  droppedCount: number;
}

export interface PluginBrowserPage {
  /**
   * Snapshot the page's accessibility tree. Needs a live tab, like the text
   * reads, and additionally attaches the browser debugger to that tab — which
   * fails while DevTools is open on it (`debugger_unavailable`).
   */
  snapshot(
    args?: { tabId?: string; maxDepth?: number; selector?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserPageSnapshot>;
  /**
   * Act on the page: click, fill, press, and the rest.
   *
   * One method rather than ten, because every action shares the same preamble
   * (resolve the ref, check the generation, wait for the element to be
   * actionable) and the difference between them is data, not control flow.
   *
   * **Waits before acting.** The element must be attached, visible, settled,
   * enabled and on top at the point being clicked; that wait is what makes an
   * action a command rather than a race, and it is why no caller should sleep
   * before calling this. Failure to become actionable is `not_actionable`, with
   * the reason in the message.
   *
   * `generation` is the snapshot the refs came from. Passing it refuses a ref
   * that a newer snapshot has since reassigned; omitting it accepts that race.
   * Navigation invalidates every ref either way (`unknown_ref`).
   *
   * Resolves with where the tab ended up, since the common actions navigate.
   */
  act(
    args: {
      action: PluginBrowserAction;
      tabId?: string;
      generation?: number;
    },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserPageState>;
  /**
   * Answer the JavaScript dialog a tab is blocked on. Resolves false when there
   * was none — including when the user answered it first, which is not a
   * failure. Only tabs the shell has taken dialogs over for can have one; a tab
   * nobody has automated still shows Chromium's own modal.
   */
  /**
   * Capture what the tab is showing.
   *
   * The visible viewport by default, or the whole scrollable document with
   * `fullPage`. Defaults to JPEG at quality 80, which is the right trade for
   * looking at a page; ask for PNG when exact pixels matter.
   *
   * **`fullPage` is not free.** A composited capture is a viewport by
   * construction, so the whole document has to come from the browser debugger —
   * which fails while the user has DevTools open on that tab
   * (`debugger_unavailable`), and which the viewport capture never touches. It
   * stops short of taking the tab's dialogs over, so a page that alerts still
   * shows the user Chromium's own modal. A document past ~16k CSS pixels comes
   * back as its top, with `truncated` set.
   */
  screenshot(
    args?: {
      tabId?: string;
      format?: "png" | "jpeg";
      /** 1–100, JPEG only. */
      quality?: number;
      /** The whole document instead of the viewport. Defaults to false. */
      fullPage?: boolean;
    },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserScreenshot>;
  /**
   * Print the tab to a PDF. Unlike a screenshot this is the whole document, so
   * it is also the one call that can come back `result_too_large`. Give it a
   * longer `timeoutMs` than the default: rendering a long page is not fast.
   */
  pdf(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserPdf>;
  /**
   * What the page has written to its console, newest last.
   *
   * Recorded from the moment the tab was created rather than from the first
   * automation call, so this answers for a tab nobody has driven. `limit`
   * defaults to 100 and counts back from the most recent.
   */
  console(
    args?: { tabId?: string; limit?: number },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserLog<PluginBrowserConsoleEntry>>;
  /**
   * What the tab has requested, newest last. Recorded like the console log, and
   * tab-scoped rather than page-scoped: a navigation does not clear it, so the
   * redirect chain that led to the current page is still in there.
   */
  network(
    args?: { tabId?: string; limit?: number },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserLog<PluginBrowserNetworkEntry>>;
  handleDialog(
    args: { accept: boolean; tabId?: string; promptText?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<boolean>;
  /**
   * Scale the page, and resolve with what it became.
   *
   * `factor` is a multiplier where 1 is 100%, and one outside Chrome's own
   * 0.25–5 is **refused** rather than quietly clamped — a call that reported a
   * factor nobody asked for would be worse than an error. The answer is read
   * back rather than echoed, because Chromium is the one that decides — and it
   * remembers zoom **per site**, so this also sets what that site looks like the
   * next time any tab opens it.
   */
  zoom(
    args: { factor: number; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<number>;
  getUrl(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<string>;
  getTitle(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<string | null>;
  getText(
    args?: { tabId?: string; maxLength?: number },
    options?: PluginBrowserCallOptions,
  ): Promise<{ text: string; truncated: boolean }>;
  getSelection(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<{ text: string }>;
}

/**
 * One cookie, in Playwright's `storageState` shape.
 *
 * That is the interop decision of this group: a file assembled from these loads
 * into Playwright, and one Playwright wrote loads back here. `expires` is
 * seconds since the epoch, or -1 for a cookie that dies with the session.
 *
 * **`value` is the login.** These come from `session.cookies`, not
 * `document.cookie`, so `httpOnly` ones are included — which is the point, since
 * those are the ones that hold a session, and also why anything that logs or
 * forwards this is handling credentials.
 */
export interface PluginBrowserCookie {
  name: string;
  value: string;
  /** A leading dot means a domain cookie; without one it is host-only. */
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

/**
 * A cookie to write. Only the name and value are required; a cookie with no
 * domain of its own is written against the tab's URL, and the rest default to a
 * host-only, non-secure, `Lax` session cookie.
 */
export interface PluginBrowserCookieInput {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface PluginBrowserStorageItem {
  name: string;
  value: string;
}

/** `session` is per-tab and dies with it; `local` is per-origin and does not. */
export type PluginBrowserStorageArea = "local" | "session";

export interface PluginBrowserCookies extends PluginBrowserPageState {
  cookies: PluginBrowserCookie[];
}

export interface PluginBrowserStorageItems extends PluginBrowserPageState {
  area: PluginBrowserStorageArea;
  items: PluginBrowserStorageItem[];
  /**
   * The origin held more than the bridge will carry, so this is a part of it.
   * Worth checking before saving state: a partial state restores a session that
   * only partly works.
   */
  truncated: boolean;
}

/**
 * What a write landed and what the browser refused — a cookie whose domain and
 * scheme disagree, or an item past the origin's quota. A partial write is a
 * realistic outcome and a silent one is expensive, so both numbers come back.
 */
export interface PluginBrowserStorageWrite {
  applied: number;
  rejected: number;
}

/**
 * A tab's stored state: cookies, `localStorage`, `sessionStorage`.
 *
 * Everything is scoped to one tab — cookies to the URL that tab is on, web
 * storage to its origin — so reading state for a site means opening it in a tab
 * first. `tabId` defaults to the active tab, as everywhere else.
 *
 * **This is credential access, not page content.** In a browser holding the
 * user's real logins, what `cookies()` returns for a signed-in site *is* that
 * session, and `setCookies` puts one into the user's browser for real. Say so
 * in any tool built on it rather than describing it as "reading settings".
 */
export interface PluginBrowserStorage {
  cookies(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserCookies>;
  /**
   * Write cookies. A cookie carrying its own `domain` is written to that
   * domain rather than to the tab's, which is what makes a saved state restore
   * the session it came from.
   */
  setCookies(
    args: { cookies: PluginBrowserCookieInput[]; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserStorageWrite>;
  /** Omit `name` to clear every cookie the tab's URL carries. */
  clearCookies(
    args?: { name?: string; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<{ removed: number }>;
  /** Needs a live tab: web storage is read out of the page itself. */
  items(
    args: { area: PluginBrowserStorageArea; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserStorageItems>;
  setItems(
    args: {
      area: PluginBrowserStorageArea;
      items: PluginBrowserStorageItem[];
      tabId?: string;
    },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserStorageWrite>;
  /** Omit `name` to clear the whole area. */
  clearItems(
    args: { area: PluginBrowserStorageArea; name?: string; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<{ removed: number }>;
}

/**
 * A response the tab should be given instead of the network's.
 *
 * `pattern` is Playwright's URL glob — `**` crosses path separators, `*` stops
 * at one — so a pattern written from Playwright's documentation means here what
 * it means there.
 */
export interface PluginBrowserRoute {
  pattern: string;
  /** Defaults to 200. */
  status?: number;
  /** Defaults to `application/json` for a body that looks like JSON. */
  contentType?: string;
  /** Defaults to empty. */
  body?: string;
  headers?: { name: string; value: string }[];
}

export interface PluginBrowserRouteState {
  pattern: string;
  status: number;
  contentType: string;
  body: string;
  headers: { name: string; value: string }[];
  /** How many requests this route has answered. Zero means it never fired. */
  matched: number;
}

export interface PluginBrowserRoutes extends PluginBrowserPageState {
  routes: PluginBrowserRouteState[];
  offline: boolean;
}

/**
 * What an expression returned, as JSON text — `"42"`, `"\"hello\""`,
 * `"undefined"`. Text rather than a value because a page can return anything,
 * and a caller that wants structure knows what it asked for and can `JSON.parse`
 * it. `truncated` means the answer was longer than the bridge carries.
 */
export interface PluginBrowserEvaluated extends PluginBrowserPageState {
  value: string;
  truncated: boolean;
}

/**
 * Driving a tab past the paths that make the rest of this API safe.
 *
 * These are grouped by how much they hand over rather than by what they do.
 * `evaluate` runs your JavaScript in a page that may hold the user's live
 * logins, in the page's own world — it can read anything the page can, and
 * change anything the user could. The mouse calls act at raw viewport
 * coordinates: no ref, no actionability check, so they land on whatever is at
 * that point, which is the price of reaching a canvas the accessibility tree
 * cannot describe. `route` rewrites what the page receives from the network,
 * and `setOffline` cuts it off.
 *
 * Use them where the safer paths genuinely cannot reach, and say plainly in any
 * tool built on them what they are.
 */
export interface PluginBrowserControl {
  /**
   * Run a function in the page and return what it returned. The expression is a
   * function: `() => document.title`, or `(el) => el.value` with a `ref` from a
   * snapshot naming the element to pass in.
   */
  evaluate(
    args: {
      expression: string;
      ref?: string;
      tabId?: string;
      generation?: number;
    },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserEvaluated>;
  /** Move the pointer. Where it lands is where the next press acts. */
  mouseMove(
    args: { x: number; y: number; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserPageState>;
  /** Press or release, at the last `mouseMove` point (0,0 until you move). */
  mouseButton(
    args: {
      down: boolean;
      button?: "left" | "middle" | "right";
      tabId?: string;
    },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserPageState>;
  mouseWheel(
    args: { deltaX?: number; deltaY?: number; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserPageState>;
  /** Add or replace a route. A second route for the same pattern replaces it. */
  route(
    args: PluginBrowserRoute & { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserRoutes>;
  routes(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserRoutes>;
  /** Omit `pattern` to remove every route on the tab. */
  unroute(
    args?: { pattern?: string; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserRoutes>;
  /**
   * Per tab, not per browser: one tab can be offline while the user keeps
   * browsing in the next one. Lasts as long as the tab's debugger session.
   */
  setOffline(
    args: { offline: boolean; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserPageState>;
}

/** One command a trace remembers. `error` is the failure's code, or null. */
export interface PluginBrowserTraceStep {
  seq: number;
  /** Milliseconds since the trace started. */
  at: number;
  command: string;
  detail: string;
  ok: boolean;
  error: string | null;
  /** Base64 JPEG of the visible tab, when the trace was asked for pictures. */
  image: string | null;
}

export interface PluginBrowserTrace {
  steps: PluginBrowserTraceStep[];
  /** Steps and pictures the recording did not keep, so a gap is never silent. */
  droppedSteps: number;
  droppedImages: number;
  durationMs: number;
}

export interface PluginBrowserVideo extends PluginBrowserPageState {
  /** Base64 JPEGs in order, each stamped with where it belongs in time. */
  frames: { at: number; base64: string }[];
  chapters: { at: number; title: string }[];
  droppedFrames: number;
  durationMs: number;
}

/**
 * Recording a session, in two halves that record different things.
 *
 * The **trace** is Patcher's own log of the browser commands this app ran — what was
 * asked for, what came back, optionally a picture after each step. It is not
 * Playwright's trace format and no Playwright viewer will open it; it is a JSON
 * log meant to be read.
 *
 * The **video** is frames of one tab, taken by the browser itself. It comes back
 * as JPEGs and timings rather than a playable file: Patcher ships no video encoder,
 * so turning the frames into one is a job for `ffmpeg` and the caller.
 */
export interface PluginBrowserRecording {
  /** Begins the log. One at a time; starting a second one fails. */
  traceStart(
    args?: { screenshots?: boolean },
    options?: PluginBrowserCallOptions,
  ): Promise<void>;
  /** Ends it and hands it over — the only way to read a trace. */
  traceStop(options?: PluginBrowserCallOptions): Promise<PluginBrowserTrace>;
  /** Films a tab. Frames per second defaults to 5; the tab must be visible. */
  videoStart(
    args?: { fps?: number; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<void>;
  /** Marks a moment in the film, for whoever reads it later. */
  videoChapter(
    args: { title: string; tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<void>;
  videoStop(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserVideo>;
}

export interface PluginBrowserNavigation {
  /**
   * Open `url` (http/https only) in a tab. On a tab with no live view the URL is
   * stored and loads when that tab is next opened, so this is the one navigation
   * call that still does something useful off-screen.
   */
  open(
    args: { url: string; tabId?: string; newTab?: boolean },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  back(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  forward(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
  reload(
    args?: { tabId?: string },
    options?: PluginBrowserCallOptions,
  ): Promise<PluginBrowserTab>;
}

/**
 * Why a browser call failed, carried as `code` on a thrown error whose `name` is
 * `"BrowserCommandError"`. Match on `name` rather than `instanceof` — no runtime
 * class from the host ships to plugins.
 *
 * Other error names worth handling: `"BrowserHostUnavailableError"` (no browser
 * window is connected at all), `"BrowserCommandTimeoutError"`, and
 * `"BrowserCommandAbortedError"`.
 */
export type PluginBrowserErrorCode =
  | "no_active_tab"
  | "unknown_tab"
  | "tab_not_live"
  | "desktop_unavailable"
  | "unsupported_command"
  | "blocked_url"
  | "page_read_timeout"
  | "page_read_failed"
  | "debugger_unavailable"
  | "stale_refs"
  | "unknown_ref"
  | "invalid_selector"
  | "no_match"
  | "not_actionable"
  | "unsupported_key"
  | "result_too_large"
  | "evaluation_failed"
  | "too_many_routes"
  | "already_recording"
  | "not_recording"
  | "invalid_command";

export interface PluginBrowserStatus {
  connected: boolean;
  /** How many app windows could serve a browser call right now. */
  windowCount: number;
}

export interface PluginBrowser {
  /**
   * Register an omnibox provider for the browser surface's address bar
   * (`browser.omnibox.providers`). Rows appear in the same ranked list as the
   * browser's own address, search, open-tab and history rows, labelled with
   * `label` so their source is visible. Multiple providers per plugin; ids must
   * be unique within the plugin.
   */
  registerOmniboxProvider(provider: PluginOmniboxProviderRegistration): void;
  /**
   * Take over what happens to a file the browser downloaded
   * (`browser.downloads.handlers`). Runs after Patcher has written it to the user's
   * downloads folder — see {@link PluginBrowserDownloadHandler} for what a
   * handler may do with it and why it cannot prevent the write.
   *
   * Additive: several handlers, in this plugin or across plugins, all run.
   */
  registerDownloadHandler(handler: PluginBrowserDownloadHandler): void;
  /**
   * Add an entry to the right-click menu of a browsed page
   * (`browser.contextMenu.items`).
   *
   * Items are **declared**, not asked for at click time: the shell holds the
   * list so a right-click opens without waiting on the server. The consequence
   * worth knowing is that `title` and `when` are fixed at registration — an
   * item cannot decide its own label from what was clicked.
   *
   * Entries appear below the browser's own, in plugin id order.
   */
  registerContextMenuItem(item: PluginBrowserContextMenuItemRegistration): void;
  /**
   * Add a button to the browser's find bar (`browser.find.actions`), carrying
   * whatever the user has typed into it.
   *
   * The find bar is the one place that knows what the user is looking for on
   * this page, which is what makes it worth extending: "search this across my
   * tabs", "look it up in our docs", "ask an agent about it". The bar's own
   * counter and arrows are the browser's; contributed buttons sit after them.
   *
   * Declared like context-menu items, and with the same consequence: `title` is
   * fixed at registration, so a button cannot rename itself from the query.
   */
  registerFindAction(action: PluginBrowserFindActionRegistration): void;
  /**
   * Add an entry to a browser tab's context menu (`browser.tab.actions`) — the
   * tab **action** point.
   *
   * The tab strip is where a browser keeps what the user is holding open, so
   * this is the place for what a plugin does *to one of them*: send it to an
   * agent, file it, sync it, open it somewhere else. Patcher's own entries — pin,
   * duplicate, mute, close — come first and contributed entries follow, in
   * plugin id order.
   *
   * Declared like context-menu items, and with the same consequence: `title` is
   * fixed at registration, so an entry cannot rename itself from the tab it is
   * shown on. To *mark* a tab instead of acting on one, see
   * `contentScript.experimental_setBrowserTabStatus`.
   */
  registerTabAction(action: PluginBrowserTabActionRegistration): void;
  /**
   * Add a section to the browser's site-info popover — what opens when the user
   * clicks the padlock in the address bar (`browser.siteInfo.sections`).
   *
   * The popover is the one place in the browser that is *about the site* rather
   * than about the page, which is what makes it worth extending: saved logins for
   * this host, trackers blocked on it, whether it is on the user's own allowlist.
   *
   * Patcher's own section — what it can honestly say about the connection — comes
   * first; contributed sections follow in plugin id order. Rows are text, not
   * controls: a section reports, and anything to *do* belongs on the tab or page
   * menu where a click has somewhere to go.
   */
  registerSiteInfoProvider(
    provider: PluginBrowserSiteInfoProviderRegistration,
  ): void;
  /**
   * Put a control in the browser's toolbar (`browser.toolbar.items`) — the
   * address row, beside Patcher's own downloads and open-externally buttons.
   *
   * The row is where a browser keeps what applies to *the page you are looking
   * at right now*, which is what this point is for: a star that knows whether
   * this page is saved, a reader mode, "open this in the other browser". Patcher's own
   * controls keep their places and contributed ones sit between the address bar
   * and them, in plugin id order.
   *
   * **One per plugin**, unlike the menus: a menu grows downwards for free and
   * this row does not, and a plugin that needs a second control has a panel of
   * its own to put it in.
   *
   * Costs `toolbar.register` rather than sharing a permission with the menus,
   * because it is not like them: `state` is handed the address of every page the
   * user opens, without the user asking for anything.
   */
  registerToolbarItem(item: PluginBrowserToolbarItemRegistration): void;
  /**
   * Add a section to the browser's new-tab screen (`browser.newTab.widgets`) —
   * see {@link PluginBrowserNewTabWidgetRegistration}.
   *
   * A new tab is the one moment the browser has nothing to show, which is what
   * makes it worth extending: saved pages, a reading list, the tabs you closed
   * yesterday. Patcher's own "Recently visited" comes first and contributed sections
   * follow in plugin id order.
   *
   * Costs `newTab.register`. Nothing about the user's browsing is handed over —
   * a new tab has no page — so what the permission buys is the placement itself.
   */
  registerNewTabWidget(widget: PluginBrowserNewTabWidgetRegistration): void;
  /**
   * Offer a search engine for the browser's address bar
   * (`browser.searchEngines`) — see
   * {@link PluginBrowserSearchEngineRegistration}.
   *
   * Offering is not choosing: the engine appears in the setting's list, and it is
   * used only once the user picks it. Patcher's own engines come first, then
   * contributed ones in plugin id order.
   */
  registerSearchEngine(engine: PluginBrowserSearchEngineRegistration): void;
  /**
   * Apply CSS to pages on the sites this plugin declared (`browser.pageStyles`)
   * — see {@link PluginBrowserPageStyleRegistration}.
   *
   * The cheapest way onto a page, and the first one: hiding a banner, widening a
   * column or restyling a site the user has to look at all day is one rule, runs
   * no code in the page, and reads nothing back.
   *
   * Costs `pageStyle.register` **and** the sites in `patcher.sites`: the permission
   * says the plugin restyles pages, the manifest's sites say which ones, and
   * `matches` picks from that list. Declaring neither reaches nothing.
   */
  registerPageStyle(style: PluginBrowserPageStyleRegistration): void;
  /**
   * Run this plugin's own code in pages on the sites it declared
   * (`browser.pageScripts`) — see {@link PluginBrowserPageScriptRegistration}
   * for what the browser promises about running it, and
   * {@link PluginPageScriptApi} for what the code is handed.
   *
   * Everything a page style cannot do: read the page, add a control to it,
   * answer a click by asking this plugin's backend. The script's `patcher.rpc` reaches
   * *this plugin's* rpc methods and nothing else, which is what keeps a program
   * in an untrusted page from being a program in Patcher.
   *
   * Costs `pageScript.register` **and** the sites in `patcher.sites` — a separate
   * permission from `pageStyle.register` over the same list, because a stylesheet
   * that cannot read the page and a program that can are not the same thing to
   * agree to.
   */
  registerPageScript(script: PluginBrowserPageScriptRegistration): void;
  /**
   * Answer HTTP authentication challenges for browsed pages
   * (`browser.auth.providers`) — see {@link PluginBrowserAuthProvider}.
   *
   * Additive: providers are asked in plugin id order and the first one to
   * return credentials wins. Nothing else in the browser is delegated this way,
   * deliberately — a certificate error stays the user's decision, because
   * "trust this server anyway" is not a credential a plugin can look up.
   */
  registerAuthProvider(provider: PluginBrowserAuthProvider): void;
  /**
   * Supply the text of a PDF the browser could not read
   * (`browser.pdf.textProviders`) — see {@link PluginBrowserPdfTextProvider}
   * for when a provider is asked and why that is the only time.
   *
   * Additive: providers are asked in plugin id order until one answers.
   */
  registerPdfTextProvider(provider: PluginBrowserPdfTextProvider): void;
  /**
   * Route a link the system handed Patcher, while Patcher is the user's default browser
   * (`browser.externalLink.handlers`) — see
   * {@link PluginBrowserExternalLinkHandler}.
   *
   * Additive: handlers are asked in plugin id order until one decides. Costs
   * `externalLink.handle`, which is a standing read of every address the user
   * opens from outside Patcher.
   */
  registerExternalLinkHandler(handler: PluginBrowserExternalLinkHandler): void;
  /**
   * See every page before it enters the browser's history, and rewrite or drop
   * it (`browser.history.filters`) — see {@link PluginBrowserHistoryFilter}.
   *
   * Reading and editing the store afterwards is `patcher.sdk.browserHistory`; this
   * is the only place a plugin sees a visit as it happens.
   *
   * Additive: every registered filter runs, across plugins, in plugin id order.
   */
  registerHistoryFilter(filter: PluginBrowserHistoryFilter): void;
  /**
   * Drive the browser surface's tabs, pages and navigation.
   *
   * These need a **connected browser window** — the Patcher desktop app with its
   * browser surface — which is never guaranteed and is certainly absent while
   * factories run. Call them from handlers, tools and services, never at load
   * time, and expect `BrowserHostUnavailableError` when nothing is connected.
   */
  readonly tabs: PluginBrowserTabs;
  readonly page: PluginBrowserPage;
  readonly navigation: PluginBrowserNavigation;
  readonly storage: PluginBrowserStorage;
  readonly control: PluginBrowserControl;
  readonly recording: PluginBrowserRecording;
  /** Synchronous, so it is safe to read from `patcher.agents.configure()`. */
  getStatus(): PluginBrowserStatus;
}

export interface PluginEvents {
  /**
   * Add a thread lifecycle listener. Multiple listeners for the same event are
   * additive and run independently in registration order.
   */
  on<E extends PluginThreadEventName>(
    event: E,
    handler: PluginThreadEventHandler<E>,
  ): void;
}

// ---------------------------------------------------------------------------
// Server info.
// ---------------------------------------------------------------------------

export interface PluginServerApi {
  /**
   * This Patcher server's own loopback base URL (e.g. "http://127.0.0.1:38986"),
   * which serves the SPA + /api + /ws. For plugins that proxy or relay
   * traffic back to the server itself (e.g. a tunnel). Bind-gated like
   * `patcher.sdk`: reading it before the server is listening throws, so prefer
   * reading it from handlers, services, and timers.
   */
  readonly loopbackBaseUrl: string;
}

// ---------------------------------------------------------------------------
// Status + the API root.
// ---------------------------------------------------------------------------

export interface PluginStatusApi {
  /**
   * Mark this plugin `needs-configuration` (with a message shown in
   * `patcher plugin list` and the UI) instead of failing — e.g. a factory or
   * service that finds no API key configured. Cleared on the next load;
   * saving settings does not auto-reload in V1, so ask the user to
   * `patcher plugin reload <id>` after configuring.
   */
  needsConfiguration(message: string): void;
}

/**
 * The API object handed to a plugin's factory (design §4). Implemented by
 * the Patcher server; this contract is what plugin `server.ts` files compile
 * against.
 */
export interface PatcherPluginApi {
  /** The plugin's own id (namespaces storage, routes, commands). */
  readonly pluginId: string;
  /** Leveled, plugin-scoped logger. */
  readonly log: PluginLogger;
  /** Declarative settings (design §4.2). */
  readonly settings: PluginSettings;
  /** Namespaced KV + per-plugin database (design §4.3). */
  readonly storage: PluginStorage;
  /** HTTP routes under /api/v1/plugins/<id>/http/* (design §4.6). */
  readonly http: PluginHttp;
  /** RPC methods under /api/v1/plugins/<id>/rpc/<method> (design §4.6). */
  readonly rpc: PluginRpc;
  /** Ephemeral push to connected frontends (design §4.7). */
  readonly realtime: PluginRealtime;
  /** Long-lived services + cron schedules (design §4.8). */
  readonly background: PluginBackground;
  /** Agent-facing `patcher` CLI subcommand (design §4.4). */
  readonly cli: PluginCli;
  /** Per-turn agent context contributions (design §4.4). */
  readonly agents: PluginAgents;
  /** Host-rendered UI contributions (design §4.9). */
  readonly ui: PluginUi;
  /** Browser-surface contributions (`browser.omnibox.providers`). */
  readonly browser: PluginBrowser;
  /** Additive plugin lifecycle listeners (design §4.5). */
  readonly events: PluginEvents;
  /** Plugin-reported status (needs-configuration). */
  readonly status: PluginStatusApi;
  /** Read-only facts about the running server (loopback base URL). */
  readonly server: PluginServerApi;
  /** Server-to-daemon host control-plane declarations. */
  /**
   * The full Patcher SDK, bound to this server over loopback (design §4.1).
   * Bind-gated: reading this before the host binds the SDK throws. The real
   * server binds it before loading plugins, so it is available from the
   * moment factories run there — but isolated harnesses may not, so prefer
   * using it from handlers, services, and timers for portability.
   * `threads.spawn` defaults `origin` to "plugin" and `originPluginId` to
   * this plugin's id so spawned threads are attributed automatically.
   */
  readonly sdk: PatcherSdk;
  /**
   * Register cleanup to run on reload/disable/shutdown. Hooks run LIFO.
   * The sanctioned place to clear timers and close connections.
   */
  onDispose(hook: () => void | Promise<void>): void;
}
