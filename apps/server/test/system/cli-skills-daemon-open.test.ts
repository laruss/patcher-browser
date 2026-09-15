import { describe, expect, it, vi } from "vitest";
import { scheduleExistingCliSkillsAcceptance } from "../../src/services/skills/global-skill-install.js";
import { onDaemonSocketOpen } from "../../src/ws/daemon-protocol.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

vi.mock(
  "../../src/services/skills/global-skill-install.js",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/services/skills/global-skill-install.js")
    >()),
    scheduleExistingCliSkillsAcceptance: vi.fn(),
  }),
);

/**
 * The wiring half of recording existing copies as a yes (#141): the check
 * itself is tested in `cli-skills-setup.test.ts`, and without this a daemon
 * connect that stopped calling it would leave every one of those green.
 */
describe("a daemon connecting", () => {
  it("has its machine checked for skills installed before the question existed", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);

      onDaemonSocketOpen(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
        socket: { close: vi.fn(), send: vi.fn() },
      });

      expect(scheduleExistingCliSkillsAcceptance).toHaveBeenCalledWith(
        harness.deps,
        { hostId: host.id },
      );
    });
  });
});
