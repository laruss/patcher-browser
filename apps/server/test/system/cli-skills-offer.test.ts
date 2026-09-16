import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getAnsweredCliSkills, setAnsweredCliSkills } from "@patcher/db";
import type {
  HostDaemonOnlineRpcRequestMessage,
  HostGlobalSkillsStatusResult,
} from "@patcher/host-daemon-contract";
import { systemConfigResponseSchema } from "@patcher/server-contract";
import { readJson } from "../helpers/json.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
  type HostRpcResponder,
} from "../helpers/host-rpc.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  findNewCliSkills,
  resolveGlobalCliSkills,
} from "../../src/services/skills/global-skill-install.js";
import { reconcileGlobalCliSkills } from "../../src/services/skills/global-skill-reconcile.js";

/**
 * Being asked once about a skill for agents outside Patcher that shipped after
 * the person first said yes (#142).
 */

type Entries = HostGlobalSkillsStatusResult["entries"];

const OWNED = "a".repeat(64);

function copies(
  name: string,
  copy: readonly [string | null, string | null],
): Entries {
  return [".agents", ".claude"].map((root) => ({
    name,
    path: `/home/u/${root}/skills/${name}`,
    treeHash: copy[0],
    installedTreeHash: copy[1],
  }));
}

async function writeBuiltinSkills(harness: TestAppHarness): Promise<void> {
  for (const name of ["patcher-cli", "patcher-browser"]) {
    const directory = join(harness.deps.config.builtinSkillsRootPath, name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Use ${name} outside Patcher.\n---\n`,
    );
  }
}

/** The tree this server would install for each built-in skill. */
function treeHashes(harness: TestAppHarness): Record<string, string> {
  return Object.fromEntries(
    resolveGlobalCliSkills(harness.deps).map((skill) => [
      skill.name,
      skill.treeHash,
    ]),
  );
}

/** A machine holding `patcher-cli` from this install and no `patcher-browser`. */
function machineMissingTheNewSkill(harness: TestAppHarness): Entries {
  const cli = treeHashes(harness)["patcher-cli"] ?? OWNED;
  return [
    ...copies("patcher-cli", [cli, cli]),
    ...copies("patcher-browser", [null, null]),
  ];
}

function standInMachine(
  harness: TestAppHarness,
  args: { hostId: string; sessionId: string; entries: Entries },
): HostRpcResponder {
  return registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    handle: (request: HostDaemonOnlineRpcRequestMessage) => {
      if (request.command.type === "host.global_skills_status") {
        return { ok: true, result: { entries: args.entries } };
      }
      if (request.command.type !== "host.install_global_skills") {
        throw new Error(`Unexpected command ${request.command.type}`);
      }
      return {
        ok: true,
        result: {
          installations: request.command.skills.map((skill) => ({
            name: skill.name,
            path: `/home/u/.agents/skills/${skill.name}`,
            outcome: "written" as const,
          })),
        },
      } satisfies HostRpcHandlerResult;
    },
  });
}

function installedSkillNames(responder: HostRpcResponder): string[] {
  return responder.requests.flatMap((request) =>
    request.command.type === "host.install_global_skills"
      ? request.command.skills.map((skill) => skill.name)
      : [],
  );
}

async function readOffer(harness: TestAppHarness) {
  const response = await harness.app.request("/api/v1/system/config");
  return systemConfigResponseSchema.parse(await readJson(response))
    .cliSkillsOffer;
}

function answer(answer: "accept" | "decline"): Request {
  return new Request("http://test/api/v1/system/cli-skills/offer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answer }),
  });
}

describe("which skills count as newly shipped", () => {
  const skills = [
    { name: "patcher-cli", treeHash: "c".repeat(64), entryPath: "SKILL.md" },
    {
      name: "patcher-browser",
      treeHash: "d".repeat(64),
      entryPath: "SKILL.md",
    },
  ];

  it("names one this install never put there, beside others it did", () => {
    expect(
      findNewCliSkills({
        entries: [
          ...copies("patcher-cli", [OWNED, OWNED]),
          ...copies("patcher-browser", [null, null]),
        ],
        skills,
      }),
    ).toEqual(["patcher-browser"]);
  });

  // The record keeps the entry of a copy somebody removed, and removing a skill
  // is not an invitation to offer it back.
  it("says nothing about a skill the person removed", () => {
    expect(
      findNewCliSkills({
        entries: [
          ...copies("patcher-cli", [OWNED, OWNED]),
          ...copies("patcher-browser", [null, OWNED]),
        ],
        skills,
      }),
    ).toEqual([]);
  });

  it("says nothing on a machine whose skills are not this install's", () => {
    expect(
      findNewCliSkills({
        entries: [
          ...copies("patcher-cli", [OWNED, null]),
          ...copies("patcher-browser", [null, null]),
        ],
        skills,
      }),
    ).toEqual([]);
    expect(
      findNewCliSkills({
        entries: [
          ...copies("patcher-cli", [null, OWNED]),
          ...copies("patcher-browser", [null, null]),
        ],
        skills,
      }),
    ).toEqual([]);
  });

  it("says nothing about a skill that is already there", () => {
    expect(
      findNewCliSkills({
        entries: [
          ...copies("patcher-cli", [OWNED, OWNED]),
          ...copies("patcher-browser", [OWNED, OWNED]),
        ],
        skills,
      }),
    ).toEqual([]);
  });
});

describe("the question about a newly shipped skill", () => {
  it("is raised by a connect, and names the machine", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const { host, session } = seedHostSession(harness.deps);
      standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: machineMissingTheNewSkill(harness),
      });

      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });

      expect(await readOffer(harness)).toEqual({
        skills: ["patcher-browser"],
        machines: [{ hostId: host.id, hostName: host.name }],
      });
    });
  });

  it("is raised by a settings read too, so a connect that timed out is made good", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const { host, session } = seedHostSession(harness.deps);
      standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: machineMissingTheNewSkill(harness),
      });

      await harness.app.request("/api/v1/system/cli-skills");

      expect((await readOffer(harness))?.skills).toEqual(["patcher-browser"]);
    });
  });

  it("goes away when the skill is installed from Settings", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const { host, session } = seedHostSession(harness.deps);
      standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: machineMissingTheNewSkill(harness),
      });
      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });

      await harness.app.request(
        new Request("http://test/api/v1/system/cli-skills/install", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ hostIds: [host.id] }),
        }),
      );

      expect(await readOffer(harness)).toBeNull();
    });
  });

  it("installs only the skill it asked about, on the machine it named", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: machineMissingTheNewSkill(harness),
      });
      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });

      const response = await harness.app.request(answer("accept"));

      expect(response.status).toBe(200);
      expect(installedSkillNames(machine)).toEqual(["patcher-browser"]);
      expect(getAnsweredCliSkills(harness.deps.db)).toEqual({
        "patcher-browser": "accepted",
      });
      expect(await readOffer(harness)).toBeNull();
    });
  });

  it("installs nothing on a no, and does not come back", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: machineMissingTheNewSkill(harness),
      });
      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });

      await harness.app.request(answer("decline"));

      expect(installedSkillNames(machine)).toEqual([]);
      expect(getAnsweredCliSkills(harness.deps.db)).toEqual({
        "patcher-browser": "declined",
      });
      expect(await readOffer(harness)).toBeNull();

      // A later connect finds it missing again and must not ask twice.
      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: "session-two",
      });
      expect(await readOffer(harness)).toBeNull();
    });
  });

  it("settles nothing new when a second window answers late", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: machineMissingTheNewSkill(harness),
      });
      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });
      await harness.app.request(answer("decline"));

      const late = await harness.app.request(answer("accept"));

      expect(await readJson(late)).toEqual({ answered: [], install: null });
      expect(installedSkillNames(machine)).toEqual([]);
      expect(getAnsweredCliSkills(harness.deps.db)).toEqual({
        "patcher-browser": "declined",
      });
    });
  });

  // The answer outlives the question: a machine that was away when it was
  // answered would otherwise read "Partly installed" for good.
  it("reaches a machine that was not there when it was accepted", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      setAnsweredCliSkills(harness.deps.db, {
        "patcher-browser": "accepted",
      });
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: machineMissingTheNewSkill(harness),
      });

      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });

      expect(installedSkillNames(machine)).toEqual(["patcher-browser"]);
      // Nothing to ask: it was answered, and now it is there.
      expect(await readOffer(harness)).toBeNull();
    });
  });

  it("asks nothing of a machine that never had Patcher's skills", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const { host, session } = seedHostSession(harness.deps);
      standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: [
          ...copies("patcher-cli", [null, null]),
          ...copies("patcher-browser", [null, null]),
        ],
      });

      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });

      expect(await readOffer(harness)).toBeNull();
    });
  });
});
