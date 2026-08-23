import { describe, expect, it } from "vitest";
import type { Host } from "@patcher/domain";
import {
  FIRST_PATCHER_ARTIFACT_PROTOCOL_VERSION,
  HOST_DAEMON_PROTOCOL_VERSION,
} from "@patcher/host-daemon-contract";
import {
  formatHostUpdateStatus,
  hostCanRetryUpdate,
  hostMustReEnroll,
  hostNeedsUpdate,
} from "./host-update-status";

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: "host_1",
    name: "My Mac",
    type: "persistent",
    status: "disconnected",
    lastSeenAt: null,
    lastRejectedProtocolVersion: null,
    maxPermissionMode: null,
    platform: "darwin",
    ...overrides,
  } as Host;
}

describe("host update status", () => {
  it("says nothing while the machine is not waiting on a protocol update", () => {
    expect(formatHostUpdateStatus(host())).toBeNull();
    expect(
      formatHostUpdateStatus(
        host({
          status: "connected",
          lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
        }),
      ),
    ).toBeNull();
  });

  it("offers a retry to a daemon that can still fetch this server's artifact", () => {
    const waiting = host({
      lastRejectedProtocolVersion: FIRST_PATCHER_ARTIFACT_PROTOCOL_VERSION,
    });

    expect(hostNeedsUpdate(waiting)).toBe(true);
    expect(hostMustReEnroll(waiting)).toBe(false);
    expect(hostCanRetryUpdate(waiting)).toBe(true);
    expect(formatHostUpdateStatus(waiting)).toContain("Needs update");
  });

  // The case the retry could never fix: this daemon asks for
  // /install/bb-app.tgz, which the server answers with 410. Offering "Retry
  // update" here spends the user's time on something that cannot succeed.
  it("asks for re-enrolment when the daemon predates the artifact rename", () => {
    const stranded = host({
      lastRejectedProtocolVersion: FIRST_PATCHER_ARTIFACT_PROTOCOL_VERSION - 1,
    });

    expect(hostNeedsUpdate(stranded)).toBe(true);
    expect(hostMustReEnroll(stranded)).toBe(true);
    expect(hostCanRetryUpdate(stranded)).toBe(false);
    const status = formatHostUpdateStatus(stranded);
    expect(status).toContain("Needs re-enrolling");
    expect(status).toContain("too old to update itself");
  });

  it("does not offer a retry to a daemon newer than this server", () => {
    const newer = host({
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
    });

    expect(hostNeedsUpdate(newer)).toBe(true);
    expect(hostMustReEnroll(newer)).toBe(false);
    expect(hostCanRetryUpdate(newer)).toBe(false);
  });
});
