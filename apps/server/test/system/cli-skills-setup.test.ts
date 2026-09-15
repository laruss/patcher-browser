import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getOutsideAgentSetup, setOutsideAgentSetup } from "@patcher/db";
import { defaultAppSettings } from "@patcher/domain";
import {
  systemCliSkillsSetupResponseSchema,
  systemConfigResponseSchema,
} from "@patcher/server-contract";
import { readJson } from "../helpers/json.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { seedHost, seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { acceptWhenPrimaryHostHasCliSkills } from "../../src/services/skills/global-skill-install.js";

/** A machine that answers the status read with one copy of `patcher-cli`. */
function respondWithSkillStatus(
  harness: TestAppHarness,
  hostId: string,
  sessionId: string,
  treeHash: string | null,
) {
  return registerHostRpcResponder(harness, {
    hostId,
    sessionId,
    handle: (request) => {
      expect(request.command.type).toBe("host.global_skills_status");
      return {
        ok: true,
        result: {
          entries: [
            {
              name: "patcher-cli",
              path: `/home/${hostId}/.agents/skills/patcher-cli`,
              treeHash,
            },
          ],
        },
      };
    },
  });
}

/**
 * The launch-time question about installing Patcher's skills for agents
 * outside Patcher (#141), and the one other way it gets answered: a successful
 * install on the primary machine.
 */

async function writeBuiltinCliSkill(harness: TestAppHarness): Promise<void> {
  const skillDirectory = join(
    harness.deps.config.builtinSkillsRootPath,
    "patcher-cli",
  );
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    "---\nname: patcher-cli\ndescription: Control Patcher from the CLI.\n---\n",
  );
}

function postJson(path: string, body: unknown): Request {
  return new Request(`http://test/api/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const INSTALLED: HostRpcHandlerResult = {
  ok: true,
  result: {
    installations: [
      { name: "patcher-cli", path: "/home/u/.agents/skills/patcher-cli" },
    ],
  },
};

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

async function readAnswerFromConfig(harness: TestAppHarness): Promise<string> {
  const response = await harness.app.request("/api/v1/system/config");
  return systemConfigResponseSchema.parse(await readJson(response))
    .outsideAgentSetup;
}

describe("the question about agents outside Patcher", () => {
  it("is unasked on a fresh install", async () => {
    await withTestHarness(async (harness) => {
      expect(await readAnswerFromConfig(harness)).toBe("unasked");
    });
  });

  it("records a no and installs nothing", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => INSTALLED,
      });
      const changes = recordSystemChanges(harness);

      const response = await harness.app.request(
        postJson("/system/cli-skills/setup", { answer: "decline" }),
      );

      expect(response.status).toBe(200);
      expect(
        systemCliSkillsSetupResponseSchema.parse(await readJson(response)),
      ).toEqual({ outsideAgentSetup: "declined", install: null });
      expect(responder.requests).toHaveLength(0);
      expect(changes).toContain("config-changed");
      expect(await readAnswerFromConfig(harness)).toBe("declined");
    });
  });

  it("installs onto the primary machine and no other, and records a yes", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      seedPrimaryHost(harness.deps, laptop.host.id);
      const [laptopResponder, studioResponder] = [laptop, studio].map(
        ({ host, session }) =>
          registerHostRpcResponder(harness, {
            hostId: host.id,
            sessionId: session.id,
            handle: () => INSTALLED,
          }),
      );

      const response = await harness.app.request(
        postJson("/system/cli-skills/setup", { answer: "accept" }),
      );

      expect(response.status).toBe(200);
      const body = systemCliSkillsSetupResponseSchema.parse(
        await readJson(response),
      );
      expect(body.outsideAgentSetup).toBe("accepted");
      expect(
        body.install?.results.map((entry) => [entry.hostId, entry.ok]),
      ).toEqual([["host-laptop", true]]);
      expect(laptopResponder?.requests.map((r) => r.command.type)).toEqual([
        "host.install_global_skills",
      ]);
      expect(studioResponder?.requests).toHaveLength(0);
      expect(await readAnswerFromConfig(harness)).toBe("accepted");
    });
  });

  it("keeps the yes when the install fails, so the question does not return on every launch", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => ({
          ok: false,
          errorCode: "install_failed",
          errorMessage: "disk is full",
        }),
      });

      const response = await harness.app.request(
        postJson("/system/cli-skills/setup", { answer: "accept" }),
      );

      const body = systemCliSkillsSetupResponseSchema.parse(
        await readJson(response),
      );
      expect(body.install?.results).toEqual([
        expect.objectContaining({ ok: false, errorMessage: "disk is full" }),
      ]);
      expect(getOutsideAgentSetup(harness.deps.db)).toBe("accepted");
    });
  });

  it("keeps the yes when the primary machine is not connected, and says nothing was installed", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const host = seedHost(harness.deps, { id: "host-offline" });
      seedPrimaryHost(harness.deps, host.id);

      const response = await harness.app.request(
        postJson("/system/cli-skills/setup", { answer: "accept" }),
      );

      expect(response.status).toBe(200);
      const body = systemCliSkillsSetupResponseSchema.parse(
        await readJson(response),
      );
      expect(body.install?.results).toEqual([
        expect.objectContaining({ hostId: "host-offline", ok: false }),
      ]);
      expect(getOutsideAgentSetup(harness.deps.db)).toBe("accepted");
    });
  });

  it("keeps the yes when the install cannot start at all", async () => {
    await withTestHarness(async (harness) => {
      // No built-in skill on this server, so the install refuses before any
      // machine is asked — after the answer was recorded.
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => INSTALLED,
      });

      const response = await harness.app.request(
        postJson("/system/cli-skills/setup", { answer: "accept" }),
      );

      expect(response.status).toBe(500);
      expect(responder.requests).toHaveLength(0);
      expect(getOutsideAgentSetup(harness.deps.db)).toBe("accepted");
    });
  });

  it("records nothing when there is no machine to install on", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request(
        postJson("/system/cli-skills/setup", { answer: "accept" }),
      );

      expect(response.status).toBe(502);
      expect(getOutsideAgentSetup(harness.deps.db)).toBe("unasked");
    });
  });

  it("is answered yes by a successful install on the primary machine, and only that", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      seedPrimaryHost(harness.deps, laptop.host.id);
      for (const { host, session } of [laptop, studio]) {
        registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: () => INSTALLED,
        });
      }

      await harness.app.request(
        postJson("/system/cli-skills/install", { hostIds: ["host-studio"] }),
      );
      expect(getOutsideAgentSetup(harness.deps.db)).toBe("unasked");

      const changes = recordSystemChanges(harness);
      await harness.app.request(
        postJson("/system/cli-skills/install", { hostIds: ["host-laptop"] }),
      );
      expect(getOutsideAgentSetup(harness.deps.db)).toBe("accepted");
      expect(changes).toEqual(["config-changed"]);

      // Installing again changes no answer, so nothing is broadcast.
      await harness.app.request(
        postJson("/system/cli-skills/install", { hostIds: ["host-laptop"] }),
      );
      expect(changes).toEqual(["config-changed"]);
    });
  });

  it("is answered yes for an install whose primary machine already has a copy", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      respondWithSkillStatus(harness, host.id, session.id, "b".repeat(64));
      const changes = recordSystemChanges(harness);

      await acceptWhenPrimaryHostHasCliSkills(harness.deps, {
        hostId: host.id,
      });

      expect(getOutsideAgentSetup(harness.deps.db)).toBe("accepted");
      expect(changes).toEqual(["config-changed"]);
    });
  });

  it("stays open when the primary machine has no copy", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      respondWithSkillStatus(harness, host.id, session.id, null);
      const changes = recordSystemChanges(harness);

      await acceptWhenPrimaryHostHasCliSkills(harness.deps, {
        hostId: host.id,
      });

      expect(getOutsideAgentSetup(harness.deps.db)).toBe("unasked");
      expect(changes).toEqual([]);
    });
  });

  it("asks no machine once answered, and no machine but the primary", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      seedPrimaryHost(harness.deps, laptop.host.id);
      const laptopResponder = respondWithSkillStatus(
        harness,
        laptop.host.id,
        laptop.session.id,
        "b".repeat(64),
      );
      const studioResponder = respondWithSkillStatus(
        harness,
        studio.host.id,
        studio.session.id,
        "b".repeat(64),
      );

      setOutsideAgentSetup(harness.deps.db, "declined");
      await acceptWhenPrimaryHostHasCliSkills(harness.deps, {
        hostId: laptop.host.id,
      });
      expect(laptopResponder.requests).toHaveLength(0);
      expect(getOutsideAgentSetup(harness.deps.db)).toBe("declined");

      setOutsideAgentSetup(harness.deps.db, "unasked");
      await acceptWhenPrimaryHostHasCliSkills(harness.deps, {
        hostId: studio.host.id,
      });
      expect(studioResponder.requests).toHaveLength(0);
      expect(getOutsideAgentSetup(harness.deps.db)).toBe("unasked");
    });
  });

  it("is left alone by a general settings write, which every window sends whole", async () => {
    await withTestHarness(async (harness) => {
      setOutsideAgentSetup(harness.deps.db, "declined");

      const response = await harness.app.request("/api/v1/settings/general", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...defaultAppSettings, caffeinate: true }),
      });

      expect(response.status).toBe(200);
      expect(await readAnswerFromConfig(harness)).toBe("declined");
    });
  });
});
