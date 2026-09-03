import { accessSync, constants, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";
import type {
  InstructionMode,
  PermissionEscalation,
  ReasoningLevel,
  RuntimePermissionScope,
} from "@patcher/domain";
import type { ClaudePermissionMode } from "../interactive-contract.js";
import { buildReadonlyBashUpdatedInput } from "./readonly-bash-policy.js";
import type {
  ClaudeMutableFlagSettings,
  ClaudeSdkReasoningEffort,
  SdkSessionOptions,
} from "./sdk-session.js";

export interface BuildSessionOptionsArgs {
  additionalWorkspaceWriteRoots?: readonly string[];
  protectedCredentialPaths?: readonly string[];
  protectedRepositoryPaths?: readonly string[];
  baseInstructions?: string;
  cwd: string;
  disallowedTools?: readonly string[];
  instructionMode: InstructionMode;
  model?: string;
  /**
   * Escalation changes per turn without replacing the session. Hook closures
   * resolve the originating prompt or subagent at call time, falling back to
   * the current turn when Claude provides no correlation metadata.
   */
  getPermissionEscalation: (
    context: PermissionEscalationWorkContext,
  ) => PermissionEscalation | null;
  permissionMode: ClaudePermissionMode;
  permissionScope: RuntimePermissionScope;
  /**
   * Which sandbox backend to expect. Defaults to the host's own platform; a
   * caller passes it so a test can pin one, since whether a sandbox can be
   * built is exactly what changes between platforms.
   */
  platform?: NodeJS.Platform;
  plugins?: Options["plugins"];
  reasoningLevel?: ReasoningLevel;
  /**
   * Absolute sandbox-helper candidates, forwarded to the availability probe.
   * See `ResolveWorkspaceSandboxAvailabilityArgs`: production passes nothing,
   * and a test that means "this machine has no bubblewrap" has to say so here,
   * because the real distribution paths exist on the machines CI runs on.
   */
  wellKnownSandboxHelperPaths?: readonly string[];
  workflowsEnabled: boolean;
  memoryEnabled?: boolean;
}

export interface PermissionEscalationWorkContext {
  agentId?: string;
  promptId?: string;
  toolUseId?: string;
}

interface ResolveExecutableOnPathArgs {
  executableName: string;
  pathEnv: string | undefined;
}

interface ResolveClaudeCodeExecutableArgs {
  env: NodeJS.ProcessEnv;
}

export interface ResolveWorkspaceSandboxAvailabilityArgs {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  /**
   * Absolute candidates to check when PATH does not name the helper. Defaults to
   * the distribution locations below; a test passes its own, because the real
   * ones cannot be created and the positive case is the half worth proving. A
   * pure input rather than a behaviour switch: production passes nothing.
   */
  wellKnownHelperPaths?: readonly string[];
}

export type WorkspaceSandboxAvailability =
  | {
      available: true;
      /**
       * Where the helper was found when PATH did not name it. The session's
       * PATH has to carry it: the SDK does its own `bwrap` lookup, and it looks
       * on PATH.
       */
      helperDirectory?: string;
    }
  | { available: false; reason: string; remedy: string };

/** The helper the SDK's Linux sandbox is built on. */
const LINUX_SANDBOX_HELPER_EXECUTABLE = "bwrap";

/**
 * Where a distribution installs it, for a daemon whose PATH does not say.
 * Absolute and root-owned, so unlike the Claude CLI lookup there is nothing here
 * a non-root user could plant — this list stays in effect under any uid.
 */
const WELL_KNOWN_LINUX_SANDBOX_HELPER_PATHS: readonly string[] = [
  "/usr/bin/bwrap",
  "/bin/bwrap",
  "/usr/local/bin/bwrap",
];

const READONLY_ALLOWED_TOOLS = new Set([
  // Agent is a read/delegation tool here; child Bash calls still flow through
  // this same readonly session hook policy before execution.
  "Agent",
  "Glob",
  "Grep",
  "LS",
  "Read",
  "TodoRead",
]);
const READONLY_BASH_TOOL_NAME = "Bash";
const READONLY_ASK_REASON =
  "Patcher readonly mode requires approval before using tools that can modify state, run commands, access network, or perform non-read actions.";
const SUMMARIZED_ADAPTIVE_THINKING = {
  type: "adaptive",
  display: "summarized",
} satisfies Exclude<Options["thinking"], undefined>;
const CLAUDE_CODE_EXECUTABLE_ENV = "PATCHER_CLAUDE_CODE_EXECUTABLE";

/**
 * Patcher's "ultracode" reasoning level is not an SDK effort: it decomposes into
 * effort "xhigh" plus the session-scoped `ultracode` settings flag (standing
 * dynamic-workflow orchestration). The SDK Settings flag tier is otherwise
 * unused by Patcher, so it is owned entirely here.
 */
export function toSdkEffort(
  reasoningLevel: ReasoningLevel,
): ClaudeSdkReasoningEffort {
  if (reasoningLevel === "ultracode") return "xhigh";
  // "none" (thinking-off) is a Cursor-only level; Claude Code models never
  // expose it, so this is a defensive floor that reconciliation never reaches.
  if (reasoningLevel === "none") return "low";
  // "ultra" is a Codex-only top tier; if it ever reaches Claude, floor to max.
  if (reasoningLevel === "ultra") return "max";
  return reasoningLevel;
}

function buildFlagSettings(params: BuildSessionOptionsArgs): Settings {
  return {
    autoMemoryEnabled: params.memoryEnabled ?? true,
    enableWorkflows: params.workflowsEnabled,
    ultracode: params.reasoningLevel === "ultracode",
  };
}

export function buildMutableFlagSettings(args: {
  memoryEnabled: boolean;
  reasoningLevel: ReasoningLevel | undefined;
  workflowsEnabled: boolean;
}): ClaudeMutableFlagSettings {
  return {
    autoMemoryEnabled: args.memoryEnabled,
    enableWorkflows: args.workflowsEnabled,
    ...(args.reasoningLevel !== undefined
      ? { effortLevel: toSdkEffort(args.reasoningLevel) }
      : {}),
    ultracode: args.reasoningLevel === "ultracode",
  };
}

export function buildReadonlyDenialMessage(): string {
  return "Patcher readonly mode allows reading and analysis only. Continue with a read-only answer; do not modify files, run mutating shell commands, use network, or use mutating tools.";
}

export function buildWorkspaceWriteDenialMessage(): string {
  return "Patcher's workspace sandbox allows work inside the current workspace only. Stay inside the workspace or explain why extra access is needed.";
}

function buildReadonlyHooks(
  params: BuildSessionOptionsArgs,
): Options["hooks"] | undefined {
  if (
    params.permissionMode !== "default" &&
    params.permissionMode !== "dontAsk"
  ) {
    return undefined;
  }

  const getPermissionEscalation = params.getPermissionEscalation;

  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            if (
              input.hook_event_name !== "PreToolUse" ||
              READONLY_ALLOWED_TOOLS.has(input.tool_name)
            ) {
              return { continue: true };
            }
            if (input.tool_name === READONLY_BASH_TOOL_NAME) {
              const updatedInput = buildReadonlyBashUpdatedInput(
                input.tool_input,
              );
              if (updatedInput) {
                return {
                  continue: true,
                  hookSpecificOutput: {
                    hookEventName: "PreToolUse",
                    permissionDecision: "allow",
                    updatedInput,
                  },
                };
              }
            }

            const permissionDecision =
              getPermissionEscalation({
                ...(input.agent_id !== undefined
                  ? { agentId: input.agent_id }
                  : {}),
                ...(input.prompt_id !== undefined
                  ? { promptId: input.prompt_id }
                  : {}),
                toolUseId: input.tool_use_id,
              }) === "deny"
                ? "deny"
                : "ask";
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision,
                permissionDecisionReason:
                  permissionDecision === "deny"
                    ? buildReadonlyDenialMessage()
                    : READONLY_ASK_REASON,
              },
            };
          },
        ],
      },
    ],
  };
}

// The Patcher workspace sandbox applies only to the accept-edits/auto session
// modes. Plan (and the legacy default/dontAsk modes) keep the Claude SDK's
// native tool gating without a sandbox, matching pre-preset behavior.
function usesWorkspaceSandbox(params: BuildSessionOptionsArgs): boolean {
  return (
    params.permissionScope === "workspace" &&
    (params.permissionMode === "acceptEdits" ||
      params.permissionMode === "auto")
  );
}

/**
 * Whether this machine can build the sandbox the workspace modes promise.
 *
 * macOS composes one from Seatbelt, which ships with the OS, so there is
 * nothing to find. Linux needs bubblewrap installed, and a machine without it
 * cannot sandbox at all — which is worth saying before a turn starts rather
 * than discovering it as an absence.
 *
 * A present `bwrap` is not proof of a working one: a container without user
 * namespaces has the binary and still cannot sandbox. That case belongs to the
 * SDK's own `failIfUnavailable` abort, which is why this check does not replace
 * it.
 */
export function resolveWorkspaceSandboxAvailability(
  args: ResolveWorkspaceSandboxAvailabilityArgs,
): WorkspaceSandboxAvailability {
  if (args.platform === "darwin") {
    return { available: true };
  }

  if (args.platform === "linux") {
    // PATH first, then the places a distribution puts it. The PATH here is the
    // daemon's, resolved from a login shell — and a daemon started by a systemd
    // unit with no inherited PATH gets little more than Patcher's own bin
    // directory, so a PATH-only probe reported "no bubblewrap" on hosts that
    // have it and refused every sandboxed turn. Same reason
    // `wellKnownClaudeExecutablePaths` exists below.
    if (
      resolveExecutableOnPath({
        executableName: LINUX_SANDBOX_HELPER_EXECUTABLE,
        pathEnv: args.env.PATH,
      })
    ) {
      return { available: true };
    }
    const wellKnownHelperPath = (
      args.wellKnownHelperPaths ?? WELL_KNOWN_LINUX_SANDBOX_HELPER_PATHS
    ).find((candidate) => isExecutableFile(candidate));
    return wellKnownHelperPath
      ? // The directory, not the path: the SDK auto-detects `bwrap` from PATH
        // (`bwrapPath` in its settings is admin-managed only), so finding the
        // helper here and stopping would start a session the SDK then aborts on
        // `failIfUnavailable`. The caller puts this on the session's PATH.
        { available: true, helperDirectory: dirname(wellKnownHelperPath) }
      : {
          available: false,
          reason: `the Linux sandbox is built with bubblewrap, and no \`${LINUX_SANDBOX_HELPER_EXECUTABLE}\` was found on PATH or in the usual install locations`,
          remedy: "install bubblewrap on this machine",
        };
  }

  return {
    available: false,
    reason: `Claude Code has no sandbox backend for ${args.platform}`,
    remedy: "run this thread on a machine that can sandbox",
  };
}

function buildWorkspaceWriteSandbox(
  params: BuildSessionOptionsArgs,
  env: NodeJS.ProcessEnv,
): Options["sandbox"] | undefined {
  if (!usesWorkspaceSandbox(params)) {
    return undefined;
  }

  const availability = resolveWorkspaceSandboxAvailability({
    env,
    platform: params.platform ?? process.platform,
    ...(params.wellKnownSandboxHelperPaths === undefined
      ? {}
      : { wellKnownHelperPaths: params.wellKnownSandboxHelperPaths }),
  });
  if (!availability.available) {
    // Refusing beats starting. The session used to run anyway, with Patcher's
    // own `canUseTool` gating standing in for the sandbox — which presents as a
    // sandboxed turn and is not one. Now that a sandboxed mode is what a
    // machine gets by default, that silence would be the common case rather
    // than the exotic one. Full Access is the way to work without a sandbox,
    // and the message says so.
    throw new Error(
      `Permission mode "${params.permissionMode}" runs the agent inside a workspace sandbox, and this machine cannot build one: ${availability.reason}. Either ${availability.remedy}, or run the thread at Full Access to work without a sandbox.`,
    );
  }

  if (availability.helperDirectory !== undefined) {
    // The helper was found off PATH, and the SDK will look for it on the PATH
    // this same env carries — so put it there. Mutating `env` rather than
    // returning it: this is the object that becomes `sessionOptions.env`, and
    // the CLI the SDK spawns is what has to see the directory.
    env.PATH =
      env.PATH === undefined || env.PATH.length === 0
        ? availability.helperDirectory
        : `${availability.helperDirectory}${delimiter}${env.PATH}`;
  }

  const allowWrite = params.additionalWorkspaceWriteRoots ?? [];
  const protectedCredentialPaths = params.protectedCredentialPaths ?? [];
  const denyWrite = params.protectedRepositoryPaths ?? [];
  return {
    enabled: true,
    // The one read the sandbox has to stop. It restricts writes and the
    // network and leaves reads open, and `autoAllowBashIfSandboxed` below
    // auto-approves Bash *because* the command is sandboxed — so a `cat` of the
    // app key file would hand the turn back the credential it is deliberately
    // not given, and would do it without a prompt. The agent's own Read tool is
    // a different path and already gated: a read outside the workspace becomes
    // a permission request naming the file.
    ...(protectedCredentialPaths.length > 0
      ? {
          credentials: {
            files: protectedCredentialPaths.map((path) => ({
              path,
              mode: "deny" as const,
            })),
          },
        }
      : {}),
    // Left at the SDK's own default now that an absent backend is refused
    // above: this is what still catches a backend that is installed but
    // unusable, which no pre-flight check on this side can see.
    failIfUnavailable: true,
    autoAllowBashIfSandboxed: true,
    // Sandbox settings are session-fixed while escalation changes per turn;
    // the unsandboxed retry stays enabled and `canUseTool` auto-denies it on
    // escalation-denied turns.
    allowUnsandboxedCommands: true,
    // The Patcher CLI needs loopback to reach the local server, and
    // escalation-denied turns have no unsandboxed-retry path around a block.
    // macOS-only and coarse (all localhost ports, binding on all interfaces);
    // the Linux sandbox ignores the flag.
    network: { allowLocalBinding: true },
    // `.git` is inside the workspace, so the workspace being writable makes the
    // files that decide what git executes writable too — and git executes them
    // in the daemon, outside this sandbox. A deny is what takes them back.
    //
    // Measured, because the shape is not obvious: a deny beats the workspace's
    // own implicit allow, it holds for the agent's Write tool as well as Bash
    // (there it surfaces as a permission request rather than an error), and it
    // survives symlink, hardlink, `cp`/`tar`/`rsync` and rename indirection. A
    // more specific `allowWrite` does *not* beat a broader deny, which is why
    // the denied list is narrow instead of `.git` wholesale.
    //
    // Narrow leaves the directories themselves out of the list, and a deny
    // names a path rather than a file — so `mv .git .gitx`, an edit, and
    // `mv .gitx .git` is the shape Patcher's own backends had to grow a rule
    // for (`terminals/terminal-sandbox.ts`). This list cannot carry that rule:
    // a deny on `.git` here is a deny on `index.lock` too. Measured instead,
    // with this `denyWrite` and a real session on macOS: the rename of `.git`,
    // of `.git/info` and of the workspace are all refused while a write in the
    // workspace and one in `.git` still succeed, so the sandbox answers it on
    // its own. Linux is not measured — see `docs/security.md`.
    ...(allowWrite.length > 0 || denyWrite.length > 0
      ? {
          filesystem: {
            ...(allowWrite.length > 0 ? { allowWrite: [...allowWrite] } : {}),
            ...(denyWrite.length > 0 ? { denyWrite: [...denyWrite] } : {}),
          },
        }
      : {}),
  };
}

// X_OK alone also passes for searchable directories, so require a regular
// file (following symlinks) before treating a candidate as the executable
// being looked for — the Claude CLI, or the sandbox helper.
function isExecutableFile(candidatePath: string): boolean {
  try {
    accessSync(candidatePath, constants.X_OK);
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

function resolveExecutableOnPath(
  args: ResolveExecutableOnPathArgs,
): string | null {
  if (!args.pathEnv) {
    return null;
  }

  for (const searchDir of args.pathEnv.split(delimiter)) {
    if (!searchDir) {
      continue;
    }
    const candidate = join(searchDir, args.executableName);
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

// The login-shell PATH probe can miss user-level install directories (slow
// shell startup, PATH exports the probe does not source), so common Claude
// install locations are checked before falling back to the SDK's bundled
// binary, which packaged Patcher builds do not ship.
function wellKnownClaudeExecutablePaths(env: NodeJS.ProcessEnv): string[] {
  // Under elevated privileges a user-writable binary must never be picked up
  // implicitly; root operators can still set PATCHER_CLAUDE_CODE_EXECUTABLE.
  if (process.getuid?.() === 0) {
    return [];
  }
  const candidatePaths: string[] = [];
  const home = env.HOME?.trim();
  if (home) {
    candidatePaths.push(
      join(home, ".local", "bin", "claude"),
      join(home, ".claude", "local", "claude"),
    );
  }
  candidatePaths.push("/opt/homebrew/bin/claude", "/usr/local/bin/claude");
  return candidatePaths;
}

export function resolveClaudeCodeExecutable(
  args: ResolveClaudeCodeExecutableArgs,
): string | null {
  const explicitPath = args.env[CLAUDE_CODE_EXECUTABLE_ENV];
  const trimmedExplicitPath = explicitPath?.trim();
  if (trimmedExplicitPath && trimmedExplicitPath.length > 0) {
    try {
      accessSync(trimmedExplicitPath, constants.X_OK);
      return trimmedExplicitPath;
    } catch {
      throw new Error(
        `${CLAUDE_CODE_EXECUTABLE_ENV} must point to an executable Claude CLI path: ${trimmedExplicitPath}`,
      );
    }
  }

  // Bundled bridge files cannot rely on the SDK's package-relative CLI
  // resolution, so pass the host's Claude CLI path explicitly when available.
  const executableOnPath = resolveExecutableOnPath({
    executableName: "claude",
    pathEnv: args.env.PATH,
  });
  if (executableOnPath) {
    return executableOnPath;
  }

  for (const candidate of wellKnownClaudeExecutablePaths(args.env)) {
    if (isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function buildSessionOptions(
  params: BuildSessionOptionsArgs,
  env: NodeJS.ProcessEnv,
): SdkSessionOptions {
  const systemPrompt: Exclude<Options["systemPrompt"], undefined> =
    params.instructionMode === "replace"
      ? (params.baseInstructions ?? "You are a helpful coding assistant.")
      : {
          type: "preset",
          preset: "claude_code",
          ...(params.baseInstructions && params.baseInstructions.length > 0
            ? { append: params.baseInstructions }
            : {}),
        };
  const model = params.model;
  const sandbox = buildWorkspaceWriteSandbox(params, env);
  const hooks = buildReadonlyHooks(params);
  const additionalDirectories = usesWorkspaceSandbox(params)
    ? (params.additionalWorkspaceWriteRoots ?? [])
    : [];
  const pathToClaudeCodeExecutable = resolveClaudeCodeExecutable({ env });
  const flagSettings = buildFlagSettings(params);

  return {
    cwd: params.cwd,
    systemPrompt,
    model,
    env,
    permissionMode: params.permissionMode,
    ...(params.reasoningLevel
      ? { effort: toSdkEffort(params.reasoningLevel) }
      : {}),
    ...(params.reasoningLevel
      ? { thinking: SUMMARIZED_ADAPTIVE_THINKING }
      : {}),
    settings: flagSettings,
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
    ...(params.plugins ? { plugins: params.plugins } : {}),
    ...(sandbox ? { sandbox } : {}),
    ...(hooks ? { hooks } : {}),
    ...(additionalDirectories.length > 0
      ? { additionalDirectories: [...additionalDirectories] }
      : {}),
    ...(params.disallowedTools && params.disallowedTools.length > 0
      ? { disallowedTools: [...params.disallowedTools] }
      : {}),
  };
}
