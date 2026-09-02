import { describe, expect, it } from "vitest";
import { acpEgressHostsSchema } from "@patcher/domain";
import { KNOWN_ACP_AGENTS } from "../../src/services/system/known-acp-agents.js";

/**
 * What each detected ACP agent may reach when a turn confines its network.
 *
 * Pinned rather than derived, because these lists are a boundary: every entry
 * was measured by running a real turn inside the confined profile and then
 * checked by taking everything else away, so a host appearing here without
 * that having happened is the thing to catch. The measurements themselves live
 * beside each agent in `known-acp-agents.ts`.
 *
 * The interesting part is what is *absent*. A collecting run asks for far more
 * than the agent needs — the person's own MCP servers, the registry an agent
 * installs their plugins from, its telemetry, whatever providers it probes at
 * startup — and transcribing that would hand every confined turn of that agent
 * whatever the measuring machine happened to have configured.
 */

const DECLARED_EGRESS_HOSTS: Record<string, readonly string[]> = {
  "acp-opencode": ["opencode.ai", "models.dev"],
  "acp-grok": ["api.x.ai", "auth.x.ai", "grok.com", "cli-chat-proxy.grok.com"],
  "acp-hermes-agent": ["hermes-agent.nousresearch.com", "models.dev"],
};

/** Measured by nobody, because the CLI is not installed anywhere it could be. */
const UNMEASURED_AGENT_IDS = ["acp-omp"];

describe("the hosts a detected ACP agent declares", () => {
  it("is the measured list, and nothing that came along with it", () => {
    const declared = Object.fromEntries(
      KNOWN_ACP_AGENTS.filter((agent) => agent.egressHosts !== undefined).map(
        (agent) => [agent.id, agent.egressHosts],
      ),
    );

    expect(declared).toEqual(DECLARED_EGRESS_HOSTS);
  });

  it("leaves an unmeasured agent undeclared rather than guessing", () => {
    // Absent and empty are different answers: `[]` would say this agent needs
    // no network, and nobody knows that. Undeclared keeps its network and the
    // thread says so, which is the same rule `stateDirs` follows.
    for (const id of UNMEASURED_AGENT_IDS) {
      const agent = KNOWN_ACP_AGENTS.find((candidate) => candidate.id === id);
      expect(agent, `${id} is no longer in the catalog`).toBeDefined();
      expect(agent?.egressHosts).toBeUndefined();
      expect(agent?.stateDirs).toBeUndefined();
    }
  });

  it("declares hostnames, which is the only thing the boundary can match", () => {
    // `CONNECT` names a host, so a URL or a `host:port` here would be a rule
    // that matches nothing — and would do it quietly.
    for (const agent of KNOWN_ACP_AGENTS) {
      const hosts = agent.egressHosts;
      if (hosts === undefined) continue;
      expect(() =>
        acpEgressHostsSchema.parse([...hosts]),
        `${agent.id} declares something that is not a hostname`,
      ).not.toThrow();
    }
  });
});
