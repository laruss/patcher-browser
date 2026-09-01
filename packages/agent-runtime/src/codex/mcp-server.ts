import { PATCHER_THREAD_KEY_ENV } from "@patcher/config/thread-api-key";

/**
 * The Patcher CLI, offered to a Codex turn as an MCP tool.
 *
 * A turn reaches Patcher by running `patcher` in its own shell, over loopback —
 * which is why Codex's network cannot be turned off without taking the CLI with
 * it. Codex spawns MCP servers itself, not through a sandboxed shell, so a
 * server sits outside the command sandbox. Measured against codex-cli 0.150.1
 * with `network.enabled: false` on the turn's permission profile: a tool call
 * reached the local server (`loopback=200`) in the same turn where the model's
 * own `curl` could not resolve a host. That is what this exists for.
 *
 * Two things about the wire were measured rather than assumed:
 *
 * - **The server's environment is curated, not inherited.** The process came up
 *   with ten variables — `HOME` and `PATH` among them — and nothing named
 *   `PATCHER_*`, so everything the CLI needs to identify itself has to be named
 *   here. What `env` adds is merged into that set.
 * - **A tool call raises an approval** (`mcpServer/elicitation/request`). For
 *   this server Patcher answers it itself, in `interactive-requests.ts`: asking
 *   a person to allow the CLI that Patcher put there, on every call, would be a
 *   prompt about Patcher's own plumbing.
 *
 * The credential passed is the thread key the turn's shell already carries — the
 * same key, the same scope, a different transport. The app key is not passed and
 * is not in `envVars` to begin with: `buildThreadShellEnvironment` trades it away
 * before a turn sees it.
 */

/** How the server is named in Codex's config, and in the approval it raises. */
export const PATCHER_CODEX_MCP_SERVER_NAME = "patcher";

/** The CLI subcommand that speaks MCP on stdio. */
const PATCHER_MCP_SERVE_SUBCOMMAND = "mcp-serve";

/** Absolute path to the CLI, put in the turn's environment by the daemon. */
const PATCHER_CLI_ENV = "PATCHER_CLI";

/**
 * What the CLI in that process needs to know: where the server is, which thread
 * it speaks for, and the key that proves it. `PATCHER_PROJECT_ID` and
 * `PATCHER_ENVIRONMENT_ID` are context the CLI reads for defaults — the same
 * values the turn's shell has.
 */
const FORWARDED_ENV_KEYS: readonly string[] = [
  "PATCHER_SERVER_URL",
  "PATCHER_THREAD_ID",
  PATCHER_THREAD_KEY_ENV,
  "PATCHER_PROJECT_ID",
  "PATCHER_ENVIRONMENT_ID",
];

export interface CodexPatcherMcpServerConfig {
  mcp_servers: {
    [serverName: string]: {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
  };
}

/**
 * The `mcp_servers` entry for this turn, or nothing when it would not work.
 *
 * Nothing without the CLI path — there is no server to spawn — and nothing
 * without a thread key: the tool would reach the API as an unidentified caller
 * and be refused, which is worse than the tool not being there, because the
 * model would keep trying it.
 */
export function buildCodexPatcherMcpServerConfig(
  envVars: Record<string, string> | undefined,
): CodexPatcherMcpServerConfig | undefined {
  const cliPath = envVars?.[PATCHER_CLI_ENV];
  if (cliPath === undefined || cliPath.length === 0) return undefined;
  if (!envVars?.[PATCHER_THREAD_KEY_ENV]) return undefined;

  const env: Record<string, string> = {};
  for (const key of FORWARDED_ENV_KEYS) {
    const value = envVars[key];
    if (value !== undefined && value.length > 0) {
      env[key] = value;
    }
  }

  return {
    mcp_servers: {
      [PATCHER_CODEX_MCP_SERVER_NAME]: {
        command: cliPath,
        args: [PATCHER_MCP_SERVE_SUBCOMMAND],
        env,
      },
    },
  };
}
