import { describe, expect, it } from "vitest";
import { setCliCommandSetup } from "@patcher/db";
import {
  systemCliCommandStatusResponseSchema,
  systemInstallCliCommandResponseSchema,
} from "@patcher/server-contract";
import { readJson } from "../helpers/json.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { seedHost, seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

/**
 * A bare `patcher` on the machine the person types on (#143). The daemon owns
 * the placement; what is checked here is the policy around it — which machine
 * is asked, that a source checkout is never asked at all, and that a window in
 * another tab hears about a change.
 */

/**
 * A release install. The harness is a source checkout by default
 * (`isDevelopment: true`), and a checkout never owns the bare command, so every
 * test of the working path has to say which it is.
 */
function withRelease<T>(
  run: (harness: TestAppHarness) => Promise<T>,
): Promise<T> {
  return withTestHarness({ isDevelopment: false }, run);
}

const PLACED: HostRpcHandlerResult = {
  ok: true,
  result: {
    state: "installed",
    linkPath: "/home/u/.local/bin/patcher",
    existingPath: "/home/u/.local/bin/patcher",
    existingTarget: "/home/u/.patcher/bin/patcher",
    shimDirectory: "/home/u/.patcher/bin",
    reason: null,
    message: null,
    changed: true,
  },
};

const NOWHERE_TO_PUT_IT: HostRpcHandlerResult = {
  ok: true,
  result: {
    state: "not_on_path",
    linkPath: null,
    existingPath: null,
    existingTarget: null,
    shimDirectory: "/home/u/.patcher/bin",
    reason: null,
    message: null,
    changed: false,
  },
};

function postJson(path: string, body: unknown): Request {
  return new Request(`http://test/api/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The system change kinds broadcast while the harness runs. */
function recordSystemChanges(harness: TestAppHarness): string[] {
  const changes: string[] = [];
  const notifySystem = harness.hub.notifySystem.bind(harness.hub);
  harness.hub.notifySystem = (kinds) => {
    changes.push(...kinds);
    notifySystem(kinds);
  };
  return changes;
}

describe("the patcher command on PATH", () => {
  it("reads the primary machine's state and no other's", async () => {
    await withRelease(async (harness) => {
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      seedPrimaryHost(harness.deps, laptop.host.id);
      const [laptopResponder, studioResponder] = [laptop, studio].map(
        ({ host, session }) =>
          registerHostRpcResponder(harness, {
            hostId: host.id,
            sessionId: session.id,
            handle: () => PLACED,
          }),
      );

      const response = await harness.app.request("/api/v1/system/cli-command");

      expect(response.status).toBe(200);
      const body = systemCliCommandStatusResponseSchema.parse(
        await readJson(response),
      );
      expect(body.machines.map((machine) => machine.hostId)).toEqual([
        "host-laptop",
      ]);
      expect(body.machines[0]?.state).toBe("installed");
      expect(laptopResponder?.requests.map((r) => r.command.type)).toEqual([
        "host.cli_command_status",
      ]);
      expect(studioResponder?.requests).toHaveLength(0);
    });
  });

  it("claims nothing about a machine that is not connected", async () => {
    await withRelease(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-offline" });
      seedPrimaryHost(harness.deps, host.id);

      const response = await harness.app.request("/api/v1/system/cli-command");

      // Read raw rather than through the schema: its `.catch("unknown")` is
      // there so a window held across an upgrade survives an unknown state,
      // and parsing first would let a server that omitted the field pass.
      const body = (await readJson(response)) as {
        machines: { state: unknown }[];
      };
      expect(body.machines[0]?.state).toBe("unknown");
    });
  });

  it("places the link and tells other windows it moved", async () => {
    await withRelease(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => PLACED,
      });
      const changes = recordSystemChanges(harness);

      const response = await harness.app.request(
        postJson("/system/cli-command/install", {}),
      );

      expect(response.status).toBe(200);
      const body = systemInstallCliCommandResponseSchema.parse(
        await readJson(response),
      );
      expect(body.machines[0]?.state).toBe("installed");
      expect(responder.requests.map((r) => r.command.type)).toEqual([
        "host.install_cli_command",
      ]);
      expect(changes).toContain("config-changed");
    });
  });

  it("says nothing to other windows when the disk did not move", async () => {
    await withRelease(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      // Answered already, or this install would announce recording the answer
      // (#147), which is its own news and not what this is about.
      setCliCommandSetup(harness.deps.db, "accepted");
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => NOWHERE_TO_PUT_IT,
      });
      const changes = recordSystemChanges(harness);

      const response = await harness.app.request(
        postJson("/system/cli-command/install", {}),
      );

      const body = systemInstallCliCommandResponseSchema.parse(
        await readJson(response),
      );
      expect(body.machines[0]?.state).toBe("not_on_path");
      // The row in this window shows it; there is nothing for another window
      // to re-read, because nothing about the machine changed.
      expect(changes).not.toContain("config-changed");
    });
  });

  it("tells the window the launch-time question may promise a command", async () => {
    await withRelease(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      // Recorded before the daemon registers: that is the order session open
      // uses, and `registerDaemon` reads the platform as it goes.
      harness.hub.recordDaemonSessionPlatform(session.id, "darwin");
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => PLACED,
      });

      const config = (await readJson(
        await harness.app.request("/api/v1/system/config"),
      )) as { cliCommandSupported: boolean };

      expect(config.cliCommandSupported).toBe(true);
    });
  });

  it("tells the window to promise nothing from a source checkout", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      harness.hub.recordDaemonSessionPlatform(session.id, "darwin");
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => PLACED,
      });

      const config = (await readJson(
        await harness.app.request("/api/v1/system/config"),
      )) as { cliCommandSupported: boolean };

      // Read raw: the field is `.default(false)` so an older window survives a
      // config without it, and parsing first would hide a server that stopped
      // sending it.
      expect(config.cliCommandSupported).toBe(false);
    });
  });

  it("never asks a source checkout's daemon, in either direction", async () => {
    // The default harness: a checkout.
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => PLACED,
      });

      const status = systemCliCommandStatusResponseSchema.parse(
        await readJson(await harness.app.request("/api/v1/system/cli-command")),
      );
      const install = systemInstallCliCommandResponseSchema.parse(
        await readJson(
          await harness.app.request(
            postJson("/system/cli-command/install", {}),
          ),
        ),
      );

      // The daemon would place one perfectly well, which is exactly why it is
      // not asked: a checkout shares a home with the release beside it.
      expect(status.machines[0]?.state).toBe("unsupported");
      expect(status.machines[0]?.reason).toBe("dev-install");
      expect(install.machines[0]?.reason).toBe("dev-install");
      expect(responder.requests).toHaveLength(0);
    });
  });
});
