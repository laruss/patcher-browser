import type {
  AvailableModel,
  ClientTurnRequestId,
  DynamicTool,
  InstructionMode,
  PendingInteractionPayload,
  PendingInteractionResolution,
  PromptInput,
  ClaudeCodeMockCliTrafficConfig,
  ProviderCapabilities,
  ReasoningLevel,
  RuntimePermissionPolicy,
  RuntimeThreadExecutionOptions,
  ServiceTier,
  ThreadEvent,
} from "@patcher/domain";
import type {
  ProviderInboundRequest,
  ProviderRuntimeEvent,
} from "./runtime-json-rpc.js";
import type { AgentRuntimeSkillRoot } from "./types.js";
import type { HostDaemonAcpLaunchSpec } from "@patcher/host-daemon-contract";

export interface ProviderTranslationContext {
  threadId?: string;
  parentToolCallId?: string;
}

export interface ProviderAcceptedCommandTranslationArgs {
  command: AdapterCommand;
  providerThreadId?: string;
}

export interface ProviderAdapterFactoryOptions {
  additionalWorkspaceWriteRoots: readonly string[];
  /** Optional: absent and empty both mean "nothing to protect here". */
  protectedCredentialPaths?: readonly string[];
  /** Optional, same convention: paths inside the workspace that stay read-only. */
  protectedRepositoryPaths?: readonly string[];
  acpLaunchSpec?: HostDaemonAcpLaunchSpec;
  bridgeBundleDir?: string;
  bridgeNodeEnv?: Record<string, string>;
  bridgeNodeExecutablePath?: string;
  turnIdPrefix?: string;
  /**
   * Confines an ACP provider's own process, where the host can build a sandbox.
   *
   * Supplied by the daemon, because the sandbox is the daemon's: seatbelt and
   * bubblewrap are platform code and the ACP bridge is a separate process, so
   * nothing here can be a function the bridge calls. What crosses is the
   * *result* — a launcher the bridge spawns the agent through — decided in the
   * daemon and sent with the session it belongs to.
   *
   * The class this closes is the one an ACP turn had open: the path check for
   * `fs/write_text_file` lives in the bridge, and the agent's own shell is not
   * held to it. Measured on Cursor: unconfined, a turn's shell writes into the
   * home directory; confined, the same command is refused while its work inside
   * the workspace still succeeds. Pi has the same class open and cannot use this
   * callback for it — its tools run inside the bridge rather than in a child of
   * it, so the launcher has to reach the bridge's own spawn
   * ({@link WrapProviderProcessLaunch}).
   */
  wrapAcpAgentLaunch?: WrapAcpAgentLaunch;
}

export interface WrapAcpAgentLaunchArgs {
  /** The turn's working directory, which is the writable root. */
  cwd: string;
  /** `$HOME`-relative directories the agent writes its own state into. */
  stateDirs: readonly string[];
}

/**
 * A launcher, not a wrapped command: the bridge appends the agent's own model
 * and permission flags to its argv, and a launcher folded into the command
 * would have collected them itself — `cursor-agent`'s `--model` is a global
 * flag that must precede the `acp` subcommand, so it lands first.
 */
export type WrapAcpAgentLaunchResult =
  | { sandboxed: true; launcher: { command: string; args: string[] } }
  | { sandboxed: false; reason: string; remedy: string };

export type WrapAcpAgentLaunch = (
  args: WrapAcpAgentLaunchArgs,
) => WrapAcpAgentLaunchResult;

/**
 * Confines a provider's *own bridge process*, for the one provider where that
 * is the boundary.
 *
 * The same shape as {@link WrapAcpAgentLaunch} and deliberately not the same
 * function, because what it wraps and when it is called are both different: an
 * ACP agent is a child of its bridge, so the ACP launcher is decided when a
 * session is built and travels to the bridge; Pi's tools run inside the bridge,
 * so the launcher has to exist before the bridge is spawned and there is no
 * session yet to carry it. A single callback named for one of the two would
 * have read as the wrong thing at the other call site.
 */
export type WrapProviderProcessLaunch = (
  args: WrapAcpAgentLaunchArgs,
) => WrapAcpAgentLaunchResult;

export type ProviderAdapterFactory = (
  providerId: string,
  options: ProviderAdapterFactoryOptions,
) => ProviderAdapter;

export interface ProviderRequestCommandPlan {
  kind: "request";
  method: string;
  params?: object;
}

export interface ProviderNoopCommandPlan {
  kind: "noop";
  method?: never;
  params?: never;
  reason: string;
}

export type ProviderCommandPlan =
  | ProviderRequestCommandPlan
  | ProviderNoopCommandPlan;

export interface ProviderPostInitializeRequest {
  plan: ProviderRequestCommandPlan;
  required: boolean;
  onResult(result: unknown): void;
}

export type ProviderInteractiveResponse =
  | boolean
  | number
  | string
  | null
  | ProviderInteractiveResponse[]
  | { [key: string]: ProviderInteractiveResponse | undefined };

export interface DecodedToolCallRequest {
  requestId: string | number;
  providerThreadId: string;
  /**
   * Non-empty Patcher turn id when known. Use null as the canonical unresolved
   * value so the runtime can resolve from the active turn; empty strings are
   * malformed adapter output.
   */
  turnId: string | null;
  callId: string;
  tool: string;
  arguments?: unknown;
  threadId?: string;
}

export interface DecodedInteractiveRequest {
  requestId: string | number;
  method: string;
  providerThreadId: string;
  /**
   * Non-empty Patcher turn id when known. Use null as the canonical unresolved
   * value so the runtime can resolve from the active turn; empty strings are
   * malformed adapter output.
   */
  turnId: string | null;
  payload: PendingInteractionPayload;
  threadId?: string;
}

// ---------------------------------------------------------------------------
// AdapterCommand — what the runtime asks the adapter to build
// ---------------------------------------------------------------------------

export type ProviderExecutionContext = {
  model?: string;
  serviceTier?: ServiceTier;
  reasoningLevel?: ReasoningLevel;
  claudeCodePermissionMode?: "plan";
  claudeCodeMockCliTraffic: ClaudeCodeMockCliTrafficConfig;
  /**
   * Server-owned workflows policy. Filled explicitly at the server boundary
   * and passed through required end-to-end; providers without the concept
   * receive (and ignore) an explicit false.
   */
  workflowsEnabled: boolean;
  memoryEnabled?: boolean;
  providerSubagentsEnabled?: boolean;
  /**
   * Take the network away from this turn's own commands, where the provider's
   * sandbox has such a field. Codex's does; the others ignore it.
   *
   * Absent means "leave it alone", which is what every provider did before this
   * existed and what the app setting behind it defaults to.
   */
  providerNetworkRestricted?: boolean;
  instructions?: string;
  envVars?: Record<string, string>;
  skillRoots?: readonly AgentRuntimeSkillRoot[];
} & RuntimePermissionPolicy;

export type AdapterCommand =
  | { type: "initialize" }
  | {
      type: "skills/configure";
      skillRoots: readonly AgentRuntimeSkillRoot[];
    }
  | { type: "model/list"; cwd?: string }
  | {
      type: "thread/start";
      threadId: string;
      cwd: string;
      input?: PromptInput[];
      options: ProviderExecutionContext;
      dynamicTools?: DynamicTool[];
      disallowedTools?: readonly string[];
      instructionMode: InstructionMode;
    }
  | {
      type: "thread/resume";
      threadId: string;
      cwd: string;
      providerThreadId: string;
      options: ProviderExecutionContext;
      dynamicTools?: DynamicTool[];
      disallowedTools?: readonly string[];
      instructionMode: InstructionMode;
    }
  | {
      type: "thread/fork";
      threadId: string;
      cwd: string;
      sourceProviderThreadId: string;
      sourceProviderCheckpointId?: string;
      options: ProviderExecutionContext;
      dynamicTools?: DynamicTool[];
      disallowedTools?: readonly string[];
      instructionMode: InstructionMode;
    }
  | {
      type: "turn/start";
      threadId: string;
      providerThreadId: string;
      input: PromptInput[];
      inputGroups?: PromptInput[][];
      clientRequestId: ClientTurnRequestId;
      options: ProviderExecutionContext;
    }
  | {
      type: "turn/steer";
      threadId: string;
      providerThreadId: string;
      expectedTurnId: string;
      input: PromptInput[];
      inputGroups?: PromptInput[][];
      clientRequestId: ClientTurnRequestId;
      options: ProviderExecutionContext;
    }
  | {
      type: "thread/stop";
      threadId: string;
      providerThreadId: string;
      /**
       * Non-null means the stop interrupted an active provider turn. Adapters
       * may treat that provider session as poisoned for future resume. Null
       * means idle/no-active-turn stop and should not invalidate the session.
       */
      activeTurnId: string | null;
    }
  | {
      type: "thread/discard";
      threadId: string;
      providerThreadId: string;
    }
  | {
      type: "thread/goal/clear";
      threadId: string;
      providerThreadId: string;
    }
  | {
      type: "thread/name/set";
      threadId: string;
      providerThreadId: string;
      title: string;
    }
  | {
      type: "thread/archive";
      threadId: string;
      providerThreadId: string;
    }
  | {
      type: "thread/unarchive";
      threadId: string;
      providerThreadId: string;
    };

export type TurnStartAdapterCommand = Extract<
  AdapterCommand,
  { type: "turn/start" }
>;

export function flattenPromptInputGroups(
  input: PromptInput[],
  inputGroups: PromptInput[][] | undefined,
): PromptInput[] {
  if (inputGroups === undefined) {
    return input;
  }
  return inputGroups.flatMap((group, index) =>
    index === 0
      ? group
      : [{ type: "text" as const, text: "\n\n", mentions: [] }, ...group],
  );
}

export interface PreparedProviderCommandDispatch {
  rollback(): void;
}

export function noPreparedProviderCommandDispatch(
  _command: TurnStartAdapterCommand,
): null {
  return null;
}

export type ProviderExecutionSettingsChange = "unchanged" | "live" | "session";

export interface ClassifyProviderExecutionSettingsChangeArgs {
  current: RuntimeThreadExecutionOptions;
  next: RuntimeThreadExecutionOptions;
}

// ---------------------------------------------------------------------------
// ProviderAdapter — internal extension contract
// ---------------------------------------------------------------------------

export interface ProviderAdapter {
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  /**
   * Selects where approval escalation is enforced. `runtime` adapters emit
   * every approval request and rely on the runtime's current thread policy.
   * `provider` adapters enforce the policy before forwarding a request, so a
   * forwarded approval is already known to require user input and must not be
   * reclassified against mutable thread settings.
   */
  approvalRequestPolicy: "runtime" | "provider";
  /**
   * Normalizes provider-specific execution options before validation,
   * comparison, persistence, and command construction. Providers may use this
   * to collapse accepted no-op values onto their effective setting.
   */
  normalizeExecutionOptions?(
    options: RuntimeThreadExecutionOptions,
  ): RuntimeThreadExecutionOptions;
  /**
   * Classifies execution-setting drift for this provider. `live` settings are
   * carried by the next turn command; `session` settings require rebuilding
   * the provider session.
   */
  classifyExecutionSettingsChange(
    args: ClassifyProviderExecutionSettingsChangeArgs,
  ): ProviderExecutionSettingsChange;
  process: { command: string; args: string[]; env?: Record<string, string> };

  buildCommandPlan(command: AdapterCommand): ProviderCommandPlan;
  /**
   * Optional provider-specific reads performed after the protocol initialize
   * request and before any thread work starts. Best-effort requests let newer
   * providers hydrate adapter-local state without making older provider
   * versions unusable when they do not implement the read.
   */
  buildPostInitializeRequests?(): readonly ProviderPostInitializeRequest[];
  /**
   * Called immediately before a turn/start request is sent. Some providers
   * emit turn/started before the request promise resolves, so adapters that
   * need command-to-event correlation must prepare that state before dispatch.
   */
  prepareTurnStart(
    command: TurnStartAdapterCommand,
  ): PreparedProviderCommandDispatch | null;
  parseModelListResult(result: unknown): {
    models: AvailableModel[];
    selectedOnlyModels: AvailableModel[];
  };
  translateEvent(
    event: ProviderRuntimeEvent,
    context?: ProviderTranslationContext,
  ): ThreadEvent[];
  /**
   * Returns normalized events implied by a successful provider command.
   * Use this for provider protocol gaps where accepted commands do not produce
   * their own notifications, such as accepted user input missing a userMessage.
   */
  translateAcceptedCommand(
    args: ProviderAcceptedCommandTranslationArgs,
  ): ThreadEvent[];
  /**
   * Called when a thread detaches because its provider process exited or the
   * runtime is shutting down. Returns events reconciling adapter state that
   * cannot survive the process — e.g. open background tasks settled as
   * interrupted. Events must carry the real Patcher threadId; the runtime emits
   * them before clearing the thread's runtime state.
   */
  buildThreadDetachedEvents?(args: { threadId: string }): ThreadEvent[];
  decodeToolCallRequest(
    request: ProviderInboundRequest,
  ): DecodedToolCallRequest | null;
  /**
   * The answer to a request Patcher makes on its own behalf, or null to carry
   * on to the paths that involve the person.
   *
   * Tried before `decodeInteractiveRequest`, which is what makes it an answer
   * rather than a prompt. There is one today: a provider asking whether the MCP
   * server *Patcher itself* configured may run its tool. Asking a person to
   * allow Patcher's own plumbing, on every call, would be a prompt about
   * nothing they chose.
   *
   * Only for requests whose subject Patcher put there. Anything a person
   * configured — their own MCP server, their own tool — belongs on the prompt
   * path, and an adapter that answered those would be deciding for them.
   */
  autoAnswerInboundRequest?(
    request: ProviderInboundRequest,
  ): ProviderInteractiveResponse | null;
  decodeInteractiveRequest?(
    request: ProviderInboundRequest,
  ): DecodedInteractiveRequest | null;
  buildInteractiveResponse?(
    args: BuildInteractiveResponseArgs,
  ): ProviderInteractiveResponse;
}

export interface BuildInteractiveResponseArgs {
  request: DecodedInteractiveRequest;
  resolution: PendingInteractionResolution;
}
