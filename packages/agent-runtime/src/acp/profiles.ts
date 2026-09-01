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
   * Absent says nobody has looked — every launch-spec agent (the known ones and
   * anything a person adds) is in that state — and a sandbox built on a guess
   * would stop those agents from starting at all. So an undeclared agent runs
   * unconfined and the turn says so, rather than being confined into failing or
   * presenting as sandboxed when it is not.
   */
  stateDirs?: readonly string[];
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
