import { DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG } from "@patcher/domain";
import { createAcpProviderAdapter } from "../acp/adapter.js";
import { getAcpAgentProfile } from "../acp/profiles.js";
import { createClaudeCodeProviderAdapter } from "../claude-code/adapter.js";
import { createCodexProviderAdapter } from "../codex/adapter.js";
import { CODEX_WORKSPACE_PERMISSION_PROFILE_ID } from "../codex/permission-profile.js";
import type { ProviderExecutionContext } from "../provider-adapter.js";
import { promptTextInput } from "./prompt-input.js";

/**
 * What each provider-side enforcer is told about a workspace turn's boundary.
 *
 * One policy, more than one enforcer. The paths a sandboxed turn may not write
 * are resolved once, in the daemon, and then translated three different ways:
 * Claude Code gets them as its SDK sandbox's deny list, Codex as `read` entries
 * in a permission profile, and an ACP turn's bridge as a list it checks
 * `fs/write_text_file` against from outside the sandbox its agent runs in. Pi
 * has no fourth translation — its boundary *is* the sandbox Patcher builds in
 * front of its bridge — and neither does a terminal, so those are asserted
 * against that sandbox's own argv instead.
 *
 * This lives here, in the package that owns the three translations, so that a
 * provider gaining or losing a sandbox of its own is a change in one place and
 * the test that walks them does not have to be told. It is exported through
 * `@patcher/agent-runtime/test` because the list it has to be checked against
 * comes from `@patcher/host-workspace`, which is the daemon's, and the
 * dependency only points one way.
 *
 * See `apps/host-daemon/src/provider-boundary-matrix.test.ts` for the check,
 * and `docs/security.md` for what each provider's sandbox then does with them —
 * which is not the same everywhere, and is measured rather than assumed.
 */

export interface WorkspaceTurnBoundary {
  /** The turn's working directory. */
  workspacePath: string;
  /** Roots outside the workspace a workspace-write turn may still write. */
  additionalWorkspaceWriteRoots: readonly string[];
  /** Repository entries git executes from: readable, never writable. */
  protectedRepositoryPaths: readonly string[];
  /** Patcher's own credential files: no read, no write. */
  protectedCredentialPaths: readonly string[];
}

export interface ProviderBoundaryTranslation {
  /** The provider whose own sandbox this is, as the registry names it. */
  providerId: string;
  /** Where the translation lives, so a failure names the file to open. */
  where: string;
  /**
   * The protected-repository paths this translation carries, as exact entries.
   *
   * Exact, not a substring search over the serialised params, because these
   * paths are prefixes of one another: `<git>/config` sits inside
   * `<git>/config.worktree`, so a translation that dropped the first while
   * keeping the second satisfied a `toContain` check on the whole blob.
   * Measured on 2026-09-04 — the sabotage passed — which is why the shapes are
   * read apart here instead.
   */
  carriedPaths: readonly string[];
  /**
   * Paths the translation marks unreadable, where its language has that level.
   * Only Codex's profile does; `deny` there takes the read with the write, and
   * a `.git/config` git cannot read stops git from running at all.
   */
  deniedPaths?: readonly string[];
}

const workspaceScopedContext = {
  claudeCodeMockCliTraffic: DEFAULT_CLAUDE_CODE_MOCK_CLI_TRAFFIC_CONFIG,
  permissionMode: "accept-edits",
  permissionScope: "workspace",
  approvalReviewer: "user",
  permissionEscalation: "deny",
  workflowsEnabled: false,
} satisfies ProviderExecutionContext;

/** Read Codex's `filesystem` map out of the config overrides it plans to send. */
function codexFilesystemEntries(
  params: unknown,
): Record<string, string> | undefined {
  const config = (params as { config?: Record<string, unknown> } | undefined)
    ?.config;
  const permissions = (config as { permissions?: Record<string, unknown> })
    ?.permissions;
  const profile = (permissions as Record<string, unknown> | undefined)?.[
    CODEX_WORKSPACE_PERMISSION_PROFILE_ID
  ];
  const filesystem = (profile as { filesystem?: unknown } | undefined)
    ?.filesystem;
  return typeof filesystem === "object" && filesystem !== null
    ? (filesystem as Record<string, string>)
    : undefined;
}

/** Codex names paths at one of three levels; collect the ones at `access`. */
function codexPathsAt(
  entries: Record<string, string> | undefined,
  access: string,
): string[] {
  return Object.entries(entries ?? {})
    .filter(([entryPath, level]) => level === access && entryPath !== ":root")
    .map(([entryPath]) => entryPath);
}

/** The list as Claude Code and an ACP bridge are handed it: a plain array. */
function protectedRepositoryPathsParam(params: unknown): string[] {
  const carried = (params as { protectedRepositoryPaths?: unknown } | undefined)
    ?.protectedRepositoryPaths;
  return Array.isArray(carried)
    ? carried.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Every provider-side translation of one workspace turn's boundary.
 *
 * A `thread/start` for each, because that is where the boundary is declared;
 * the adapters' own suites cover the other commands carrying it too.
 */
export function buildProviderBoundaryTranslations(
  boundary: WorkspaceTurnBoundary,
): ProviderBoundaryTranslation[] {
  const factoryOptions = {
    additionalWorkspaceWriteRoots: boundary.additionalWorkspaceWriteRoots,
    protectedRepositoryPaths: boundary.protectedRepositoryPaths,
    protectedCredentialPaths: boundary.protectedCredentialPaths,
  };
  const start = {
    type: "thread/start" as const,
    threadId: "patcher-thread-1",
    cwd: boundary.workspacePath,
    input: [promptTextInput({ text: "hello" })],
    instructionMode: "append" as const,
    options: workspaceScopedContext,
  };

  const claude =
    createClaudeCodeProviderAdapter(factoryOptions).buildCommandPlan(start);
  const codex =
    createCodexProviderAdapter(factoryOptions).buildCommandPlan(start);
  const acp = createAcpProviderAdapter({
    ...factoryOptions,
    profile: getAcpAgentProfile("acp-cursor"),
  }).buildCommandPlan(start);

  const codexEntries = codexFilesystemEntries(codex?.params);

  return [
    {
      providerId: "claude-code",
      where: "packages/agent-runtime/src/claude-code/adapter.ts",
      carriedPaths: protectedRepositoryPathsParam(claude?.params),
    },
    {
      providerId: "codex",
      where: "packages/agent-runtime/src/codex/permission-profile.ts",
      carriedPaths: codexPathsAt(codexEntries, "read"),
      deniedPaths: codexPathsAt(codexEntries, "deny"),
    },
    {
      providerId: "acp-cursor",
      where: "packages/agent-runtime/src/acp/bridge/bridge.ts",
      carriedPaths: protectedRepositoryPathsParam(acp?.params),
    },
  ];
}
