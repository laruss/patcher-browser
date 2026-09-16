import { describe, expect, it, vi } from "vitest";
import { scheduleGlobalCliSkillsReconciliation } from "../../src/services/skills/global-skill-reconcile.js";
import { onDaemonSocketOpen } from "../../src/ws/daemon-protocol.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

vi.mock(
  "../../src/services/skills/global-skill-reconcile.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/services/skills/global-skill-reconcile.js")
    >()),
    scheduleGlobalCliSkillsReconciliation: vi.fn(),
  }),
);

/**
 * The wiring half of keeping a machine's Patcher skills current (#142) and of
 * recording copies already there as a yes (#141): what a connect does is tested
 * in `cli-skills-reconcile.test.ts` and `cli-skills-setup.test.ts`, and without
 * this a daemon connect that stopped starting it would leave all of those green.
 */
describe("a daemon connecting", () => {
  it("has its machine's skills for agents outside Patcher reconciled", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);

      onDaemonSocketOpen(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
        socket: { close: vi.fn(), send: vi.fn() },
      });

      expect(scheduleGlobalCliSkillsReconciliation).toHaveBeenCalledWith(
        harness.deps,
        { hostId: host.id, sessionId: session.id },
      );
    });
  });
});
