import { buildAcpProviderInfo } from "@patcher/agent-providers";
import type { ProviderInfo } from "@patcher/domain";
import type { HostDaemonAcpLaunchSpec } from "@patcher/host-daemon-contract";

export interface KnownAcpAgent extends HostDaemonAcpLaunchSpec {
  id: string;
  executableName: string;
}

export interface KnownAcpAgentExecutableQuery {
  id: string;
  executableName: string;
}

/**
 * The agents Patcher detects by looking for their binary, and what each one
 * needs of `$HOME` to run inside a sandboxed turn.
 *
 * `stateDirs` is measured, not read off a docs page: each agent below was
 * started under the sandbox the daemon builds — `initialize` then `session/new`
 * over its own stdio — with nothing granted, then with one directory at a time,
 * until it created a session and stopped complaining. What that produced is
 * recorded per agent. An agent nobody has measured declares nothing and runs
 * unconfined with the turn saying so, which is why `omp` below has no entry:
 * confining it on a guess would stop it from starting at all
 * (`packages/agent-runtime/src/acp/profiles.ts`).
 *
 * One thing the sandbox does not grant back, deliberately: the caches an
 * agent's *own* globally configured MCP servers write when they install
 * themselves through `npx` or `uvx` (`~/.npm`, `~/.cache/uv`). Measured on Grok
 * and opencode, both still create the session and both log an EPERM from the
 * child. Those servers are the person's own configuration rather than the
 * agent's state, and Patcher passes the MCP servers a turn is meant to have.
 */
export const KNOWN_ACP_AGENTS: readonly KnownAcpAgent[] = [
  {
    id: "acp-opencode",
    displayName: "opencode",
    command: "opencode",
    args: ["acp"],
    env: {},
    executableName: "opencode",
    // Measured on opencode 1.3.2. All three, and each for its own reason:
    // without the data directory the process exits 1 before answering
    // `initialize` ("Failed to run the query 'PRAGMA wal_checkpoint(PASSIVE)'"
    // — its SQLite database lives there); with only that, `session/new`
    // succeeds while opencode logs an unhandled `EPERM …
    // ~/.cache/opencode/models.json`; and the config directory is where it
    // installs the plugins its own config declares — a config naming one
    // plugin, started with `XDG_CONFIG_HOME` pointed at an empty directory,
    // came back with `package.json`, `bun.lock` and `node_modules/` written
    // there.
    stateDirs: [".config/opencode", ".local/share/opencode", ".cache/opencode"],
  },
  {
    // omp (oh-my-pi) speaks the Agent Client Protocol via `omp acp`
    // (https://omp.sh); registering it here auto-detects an installed omp CLI
    // and exposes it as provider `acp-omp`, mirroring acp-opencode.
    //
    // No `stateDirs`: nobody has run this CLI to find out. A sandboxed turn on
    // omp therefore runs unconfined and says so, rather than being confined
    // into failing to start.
    id: "acp-omp",
    displayName: "omp",
    command: "omp",
    args: ["acp"],
    env: {},
    executableName: "omp",
  },
  {
    // Grok Build speaks ACP over stdio via `grok agent stdio`
    // (https://docs.x.ai/build/cli/headless-scripting). Authentication is
    // handled by the ACP bridge using Grok's advertised auth methods.
    id: "acp-grok",
    displayName: "Grok Build",
    command: "grok",
    args: ["agent", "stdio"],
    env: {},
    executableName: "grok",
    // Measured on Grok Build 1.0.5: confined with nothing, `session/new`
    // answers `FS_PERMISSION_DENIED` / "Operation not permitted (os error 1)";
    // with `.grok` writable it creates the session. Everything it wrote in an
    // unconfined start was under that one directory — its session store, logs,
    // `active_sessions.json` and the docs it unpacks.
    stateDirs: [".grok"],
    modelCli: {
      listArgs: ["models"],
      selectFlag: "--model",
      primaryModels: ["grok-4.5", "grok-composer-2.5-fast"],
    },
    permissionCli: {
      full: ["--always-approve"],
      insertAfterArgs: 1,
    },
    reasoningCli: {
      flag: "--reasoning-effort",
      supportedLevels: ["low", "medium", "high"],
      levelValues: {
        none: "low",
        xhigh: "high",
        ultracode: "high",
        max: "high",
      },
      defaultLevel: "high",
    },
  },
  {
    // Hermes Agent speaks ACP over stdio via `hermes acp`. The official ACP
    // registry also supports a uvx launcher, but the installed CLI exposes the
    // `hermes` command as the stable host-local signal.
    // https://hermes-agent.nousresearch.com/docs/user-guide/features/acp
    id: "acp-hermes-agent",
    displayName: "Hermes Agent",
    command: "hermes",
    args: ["acp"],
    env: {},
    executableName: "hermes",
    // Measured on hermes-agent 0.20.5, which names the path itself: confined
    // with nothing, `session/new` fails with "[Errno 1] Operation not
    // permitted: ~/.hermes/logs/agent.log"; with `.hermes` writable it creates
    // the session. It keeps its own Python venv there too.
    stateDirs: [".hermes"],
    nativeReasoning: {
      configId: "reasoning_effort",
      supportedLevels: ["none", "low", "medium", "high", "xhigh", "max"],
      defaultLevel: "medium",
    },
  },
];

export function listKnownAcpAgentExecutableQueries(): KnownAcpAgentExecutableQuery[] {
  return KNOWN_ACP_AGENTS.map((agent) => ({
    id: agent.id,
    executableName: agent.executableName,
  }));
}

export function buildKnownAcpProviderInfo(agent: KnownAcpAgent): ProviderInfo {
  return buildAcpProviderInfo({
    id: agent.id,
    displayName: agent.displayName,
    logoUrl: null,
  });
}

export function findKnownAcpAgentForProviderId(
  providerId: string,
): KnownAcpAgent | undefined {
  return KNOWN_ACP_AGENTS.find((agent) => agent.id === providerId);
}
