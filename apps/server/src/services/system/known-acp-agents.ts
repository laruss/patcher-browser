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
 * `egressHosts` is measured the same way and read the same way, with one thing
 * learned the hard way: **the measurement over-collects, so it cannot be
 * transcribed.** A real turn inside the confined profile asks for the person's
 * own MCP servers, the registry an agent installs their plugins from, the
 * agent's telemetry, and whatever providers it probes at startup — a list of
 * nine for Grok, where four are its own. Declaring all nine would hand every
 * confined turn of that agent whatever this machine happened to have
 * configured.
 *
 * So the rule is what the agent needs to *be that agent* — its own service,
 * its model catalog, its login — and each entry below was then checked by
 * taking everything else away: allow only the declared hosts, refuse the rest,
 * and see the session still start and the prompt still get answered. What the
 * *work* needs stays the person's list in Settings, and anything missing from
 * either is now a question on the thread rather than a dead connection.
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
    // Measured the same way, then checked by taking everything else away: with
    // only these two allowed, opencode still created its session and answered
    // a prompt. `opencode.ai` is where its own gateway serves the model;
    // `models.dev` is the catalog it reads at startup.
    //
    // What it also asked for and does not get: `registry.npmjs.org`, which it
    // uses to install the plugins the *person's* config declares — the same
    // reason the caches for those installs are not granted back either — and
    // that person's own MCP servers. Both are their configuration rather than
    // opencode's, so both are theirs to allow, and a refusal now asks instead
    // of failing.
    egressHosts: ["opencode.ai", "models.dev"],
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
    // Measured across two turns and then checked by taking everything else
    // away: with only these four allowed, Grok created its session and
    // answered a prompt. `api.x.ai` is the model, `grok.com` and
    // `cli-chat-proxy.grok.com` its own service, and `auth.x.ai` appeared only
    // in the run that had to log in — declared anyway, because a token
    // refreshing mid-turn should not be the first anyone hears of that host.
    //
    // Not declared, though a real turn asked for both: `api.mixpanel.com`,
    // which is telemetry rather than something the agent needs to work, and
    // the person's own MCP servers.
    egressHosts: [
      "api.x.ai",
      "auth.x.ai",
      "grok.com",
      "cli-chat-proxy.grok.com",
    ],
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
    // Measured, and the check changed what it looked like it needed. A
    // collecting run asked for `chatgpt.com`, `api.anthropic.com`,
    // `api.githubcopilot.com` and `api.github.com` as well — but with only
    // these two allowed the session was still created and the prompt still
    // answered, so those are Hermes probing what a machine has rather than
    // where its model lives: the model goes through its own service. Declaring
    // them would have handed every confined Hermes turn the GitHub API and
    // three model vendors on the strength of a startup probe.
    egressHosts: ["hermes-agent.nousresearch.com", "models.dev"],
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
