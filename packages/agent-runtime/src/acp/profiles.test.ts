import { describe, expect, it } from "vitest";
import { acpProfileFromLaunchSpec, getAcpAgentProfile } from "./profiles.js";

/**
 * What a detected agent's launch spec becomes on the daemon's side.
 *
 * Two declarations travel this way and both are boundaries: the directories a
 * confined turn grants back, and the hosts it may reach. The mapping spreads
 * the whole normalized spec, so a field can only be lost by someone naming it
 * — which is exactly what these pin. The built-in profiles carry the same two
 * fields directly, and Cursor is the one measured there.
 */

describe("a profile built from a launch spec", () => {
  it("carries both halves of the boundary the agent declared", () => {
    const profile = acpProfileFromLaunchSpec(
      {
        displayName: "Registered ACP",
        command: "registered-agent",
        args: ["acp"],
        env: {},
        stateDirs: [".registered"],
        egressHosts: ["api.registered.example", "*.cdn.registered.example"],
      },
      "acp-registered",
    );

    expect(profile.stateDirs).toEqual([".registered"]);
    expect(profile.egressHosts).toEqual([
      "api.registered.example",
      "*.cdn.registered.example",
    ]);
    expect(profile.agentCommand).toEqual({
      command: "registered-agent",
      args: ["acp"],
    });
  });

  it("leaves an undeclared agent undeclared on both halves", () => {
    // Not `[]`: the adapter reads absent as "nobody measured this" and leaves
    // the turn unconfined with a warning, which a normalized empty list would
    // turn into a boundary of nothing.
    const profile = acpProfileFromLaunchSpec(
      {
        displayName: "Bare ACP",
        command: "bare-agent",
        args: [],
        env: {},
      },
      "acp-bare",
    );

    expect(profile.stateDirs).toBeUndefined();
    expect(profile.egressHosts).toBeUndefined();
  });

  it("keeps the measured built-in declaration", () => {
    const cursor = getAcpAgentProfile("acp-cursor");

    // Measured from a whole Cursor turn rather than a session start, which is
    // how it came out as one host and nothing else.
    expect(cursor?.egressHosts).toEqual(["api2.cursor.sh"]);
    expect(cursor?.stateDirs).toEqual([".cursor"]);
  });
});
