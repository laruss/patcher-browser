import type { AcpAgentProviderId } from "@patcher/agent-providers";
import {
  normalizeHostDaemonAcpLaunchSpec,
  type HostDaemonAcpLaunchSpec,
} from "@patcher/host-daemon-contract";

/**
 * CLI model surface of the agent's launch binary: how to discover models and
 * how to pin one at launch. The bridge parses the listed ids into model
 * families with reasoning-effort variants (see `bridge/model-catalog.ts`).
 */
export type AcpAgentModelCli = NonNullable<HostDaemonAcpLaunchSpec["modelCli"]>;
export type AcpAgentReasoningCli = NonNullable<
  HostDaemonAcpLaunchSpec["reasoningCli"]
>;
export type AcpAgentNativeReasoning = NonNullable<
  HostDaemonAcpLaunchSpec["nativeReasoning"]
>;
export type AcpAgentPermissionCli = NonNullable<
  HostDaemonAcpLaunchSpec["permissionCli"]
>;

/**
 * Launch profile for a built-in ACP (Agent Client Protocol) provider. The
 * bridge process spawns `command args...` per thread and speaks ACP over the
 * agent's stdio.
 */
export interface AcpAgentProfile {
  providerId: string;
  displayName: string;
  agentCommand: { command: string; args: string[] };
  env?: Record<string, string>;
  cwd?: string;
  modelCli?: AcpAgentModelCli;
  reasoningCli?: AcpAgentReasoningCli;
  nativeReasoning?: AcpAgentNativeReasoning;
  permissionCli?: AcpAgentPermissionCli;
  /**
   * Directories the agent binary writes its own state into, relative to `$HOME`.
   *
   * An ACP provider has no OS sandbox of its own: the path check for
   * `fs/write_text_file` lives in the bridge, and the agent's own shell is not
   * held to it. Confining the process is what closes that, and this is what the
   * confinement has to grant back — measured rather than guessed, because a
   * provider that cannot write its own config does not start:
   * `cursor-agent acp` answers `session/new` with
   * `EPERM … ~/.cursor/cli-config.json.tmp` until `.cursor` is writable, and
   * creates the session once it is.
   *
   * Absent and empty are different answers, and the sandbox reads them that
   * way. `[]` says this agent needs nothing under `$HOME` and gets nothing.
   * Absent says nobody has looked — and a sandbox built on a guess would stop
   * such an agent from starting at all, as the measurements show: opencode dies
   * before `initialize` without its data directory, Grok and Hermes fail
   * `session/new`, and none of the three needs what another needs. So an
   * undeclared agent runs unconfined and the turn says so, rather than being
   * confined into failing or presenting as sandboxed when it is not.
   *
   * An agent that arrives over the wire declares these in its launch spec, so
   * the known agents carry theirs in `known-acp-agents.ts` on the server, and a
   * person who registers their own agent can answer for it in config.
   */
  stateDirs?: readonly string[];
  /**
   * Hostnames the agent needs to reach to do its work, for a turn whose egress
   * is confined to Patcher's proxy.
   *
   * Read exactly like `stateDirs`, and measured the same way — by running the
   * agent with everything else refused and watching what it asks the proxy for.
   * Cursor's is one host and comes from a *whole* turn rather than a session
   * start: a session that begins is not a session that can answer, and a list
   * short by one host would break the turn at the worst moment.
   *
   * Absent says nobody has measured this agent, and then the turn's network is
   * left alone rather than confined on a guess — the same rule, and for the
   * same reason: cut off from its own model, the agent is not sandboxed, it is
   * broken. `[]` would say the agent needs no network at all.
   *
   * What is deliberately *not* here is anything the work needs — a package
   * registry, a git host. Those are the person's to allow, because they belong
   * to the repository rather than to the agent.
   */
  egressHosts?: readonly string[];
}

interface BuiltInAcpAgentProfile extends AcpAgentProfile {
  providerId: AcpAgentProviderId;
  modelCli: AcpAgentModelCli;
}

export const ACP_AGENT_PROFILES: readonly BuiltInAcpAgentProfile[] = [
  {
    providerId: "acp-cursor",
    displayName: "Cursor",
    // Cursor installs both `cursor-agent` and the generic `agent` alias. Use
    // the namespaced executable so another provider's `agent` binary earlier
    // on PATH cannot silently replace Cursor and collapse model discovery to
    // the synthetic fallback.
    agentCommand: { command: "cursor-agent", args: ["acp"] },
    // Measured: without this the session cannot be created at all.
    stateDirs: [".cursor"],
    // Measured across a whole turn inside the confined profile — `initialize`,
    // `session/new`, a prompt answered `end_turn` — with every other host
    // refused: Cursor asked for this one and nothing else.
    egressHosts: ["api2.cursor.sh"],
    // Global flags must precede the `acp` subcommand, matching the documented
    // `cursor-agent --api-key ... acp` form.
    modelCli: {
      listArgs: ["--list-models"],
      selectFlag: "--model",
      // Family ids (the default variant's raw id), not raw variant ids: the
      // catalog folds effort and the `-fast` tail into one entry per family.
      primaryModels: [
        "auto",
        "cursor-grok-4.5-medium",
        "gpt-5.6-sol-medium",
        "claude-opus-5-thinking-medium",
        "claude-fable-5-thinking-medium",
        // Composer is one family now; its `-fast` twin is the Fast-mode tier.
        "composer-2.5",
      ],
    },
  },
];

export function getAcpAgentProfile(
  providerId: AcpAgentProviderId,
): AcpAgentProfile {
  const profile = ACP_AGENT_PROFILES.find(
    (candidate) => candidate.providerId === providerId,
  );
  if (!profile) {
    throw new Error(`Unknown ACP agent profile "${providerId}".`);
  }
  return profile;
}

export function acpProfileFromLaunchSpec(
  spec: HostDaemonAcpLaunchSpec,
  providerId: string,
): AcpAgentProfile {
  const normalized = normalizeHostDaemonAcpLaunchSpec(spec);
  const { command, args, env, ...profile } = normalized;
  return {
    providerId,
    ...profile,
    agentCommand: { command, args },
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}
