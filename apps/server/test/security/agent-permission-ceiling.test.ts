import { describe, expect, it } from "vitest";
import { buildExecutionOptions } from "../../src/services/threads/thread-commands.js";
import {
  clampPermissionModeToHost,
  getHostPermissionCeiling,
  resolveEnvironmentHostId,
} from "../../src/services/hosts/permission-ceiling.js";
import { resolveExistingThreadPermissionMode } from "../../src/services/threads/thread-execution-plan.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

/**
 * A turn cannot arrange for more privilege than it has.
 *
 * The machine's ceiling was the only bound on a requested mode, so on a machine
 * whose owner raised the ceiling to Full Access, a sandboxed turn could ask for
 * an unsandboxed one — for a thread it spawns, or for its own next turn — and
 * get it. That is the sandbox asking itself for permission.
 */

function seedCallerAndTarget(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps, {
    id: "host-agent-ceiling",
  });
  // The premise of every case below: this machine allows everything, so the
  // only thing that can bound a request is the turn that made it. Asserted
  // rather than assumed — the seed's default is not this test's to promise.
  expect(getHostPermissionCeiling(harness.deps, host.id)).toBe("full");
  const { project } = seedProjectWithSource(harness.deps, { hostId: host.id });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  const seed = () =>
    seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
    });
  return { caller: seed(), host, target: seed() };
}

describe("clampPermissionModeToHost", () => {
  it("takes the lower of the machine's ceiling and the asking turn's mode", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedCallerAndTarget(harness);

      expect(
        clampPermissionModeToHost(harness.deps, {
          hostId: host.id,
          permissionMode: "full",
          requesterCeiling: "accept-edits",
        }),
      ).toBe("accept-edits");

      // And the machine still wins when it is the lower of the two.
      expect(
        clampPermissionModeToHost(harness.deps, {
          hostId: host.id,
          permissionMode: "full",
          requesterCeiling: null,
        }),
      ).toBe("full");
    });
  });
});

describe("a turn asking for the next turn's mode", () => {
  it("cannot ask for more than it has", async () => {
    await withTestHarness(async (harness) => {
      const { caller, target } = seedCallerAndTarget(harness);
      const callerMode = resolveExistingThreadPermissionMode(
        harness.deps,
        caller.id,
      );
      // The premise of the test: the caller is not already at Full Access, so
      // clamping to it is a real restriction rather than a no-op.
      expect(callerMode).not.toBe("full");

      const execution = await buildExecutionOptions(
        harness.deps,
        { model: "gpt-5", permissionMode: "full" },
        { requestedByThreadId: caller.id, threadId: target.id },
        "client/turn/requested",
      );

      expect(execution.permissionMode).toBe(callerMode);
    });
  });

  it("still lets a person ask for everything the machine allows", async () => {
    await withTestHarness(async (harness) => {
      const { target } = seedCallerAndTarget(harness);

      const execution = await buildExecutionOptions(
        harness.deps,
        { model: "gpt-5", permissionMode: "full" },
        { requestedByThreadId: null, threadId: target.id },
        "client/turn/requested",
      );

      expect(execution.permissionMode).toBe("full");
    });
  });

  it("cannot raise its own next turn either", async () => {
    await withTestHarness(async (harness) => {
      const { caller } = seedCallerAndTarget(harness);
      const callerMode = resolveExistingThreadPermissionMode(
        harness.deps,
        caller.id,
      );

      const execution = await buildExecutionOptions(
        harness.deps,
        { model: "gpt-5", permissionMode: "full" },
        { requestedByThreadId: caller.id, threadId: caller.id },
        "client/turn/requested",
      );

      expect(execution.permissionMode).toBe(callerMode);
    });
  });

  it("leaves the machine's own ceiling doing its work", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedCallerAndTarget(harness);
      expect(resolveEnvironmentHostId(harness.deps, null)).toBeNull();
      expect(
        clampPermissionModeToHost(harness.deps, {
          hostId: host.id,
          permissionMode: "auto",
          requesterCeiling: "full",
        }),
      ).toBe("auto");
    });
  });
});
