import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getAnsweredCliSkills,
  setAnsweredCliSkills,
  updateHost,
} from "@patcher/db";
import type {
  HostDaemonOnlineRpcRequestMessage,
  HostGlobalSkillsStatusResult,
} from "@patcher/host-daemon-contract";
import {
  systemCliSkillsOfferResponseSchema,
  systemConfigResponseSchema,
} from "@patcher/server-contract";
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
  args: {
    hostId: string;
    sessionId: string;
    entries: Entries;
    install?: "fails";
  },
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
      if (args.install === "fails") {
        return {
          ok: false,
          errorCode: "install_failed",
          errorMessage: "disk is full",
        };
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

/** The skills each install carried, with the condition put on each. */
function installedSkills(
  responder: HostRpcResponder,
): { name: string; conditional: boolean }[] {
  return responder.requests.flatMap((request) =>
    request.command.type === "host.install_global_skills"
      ? request.command.skills.map((skill) => ({
          name: skill.name,
          conditional: skill.replaceOnlyIfTreeHash !== undefined,
        }))
      : [],
  );
}

function installedSkillNames(responder: HostRpcResponder): string[] {
  return responder.requests.flatMap((request) =>
    request.command.type === "host.install_global_skills"
      ? request.command.skills.map((skill) => skill.name)
      : [],
  );
}

function recordSystemChanges(harness: TestAppHarness): string[] {
  const changes: string[] = [];
  const notifySystem = harness.hub.notifySystem.bind(harness.hub);
  harness.hub.notifySystem = (kinds) => {
    changes.push(...kinds);
    notifySystem(kinds);
  };
  return changes;
}

async function readOffer(harness: TestAppHarness) {
  const response = await harness.app.request("/api/v1/system/config");
  return systemConfigResponseSchema.parse(await readJson(response))
    .cliSkillsOffer;
}

function answer(
  answer: "accept" | "decline",
  skills: string[] = ["patcher-browser"],
): Request {
  return new Request("http://test/api/v1/system/cli-skills/offer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ answer, skills }),
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
        machines: [
          {
            hostId: host.id,
            hostName: host.name,
            skills: ["patcher-browser"],
          },
        ],
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

describe("machines that are missing different skills", () => {
  /** Laptop has `patcher-cli` and not the browser skill; Studio the reverse. */
  function seedTwoMachines(harness: TestAppHarness) {
    const hashes = treeHashes(harness);
    const cli = hashes["patcher-cli"] ?? OWNED;
    const browser = hashes["patcher-browser"] ?? OWNED;
    return [
      {
        id: "host-laptop",
        entries: [
          ...copies("patcher-cli", [cli, cli]),
          ...copies("patcher-browser", [null, null]),
        ],
      },
      {
        id: "host-studio",
        entries: [
          ...copies("patcher-cli", [null, null]),
          ...copies("patcher-browser", [browser, browser]),
        ],
      },
    ].map(({ id, entries }) => {
      const { host, session } = seedHostSession(harness.deps, { id });
      return {
        host,
        session,
        responder: standInMachine(harness, {
          hostId: host.id,
          sessionId: session.id,
          entries,
        }),
      };
    });
  }

  // The whole point of the feature is not to touch a copy somebody else put
  // there: sending every offered name to every offered machine would replace
  // the one each of them already has.
  it("sends each machine only what that machine is missing", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const machines = seedTwoMachines(harness);
      for (const machine of machines) {
        await reconcileGlobalCliSkills(harness.deps, {
          hostId: machine.host.id,
          sessionId: machine.session.id,
        });
      }

      const offer = await readOffer(harness);
      expect(offer?.skills).toEqual(["patcher-browser", "patcher-cli"]);
      expect(offer?.machines).toEqual([
        {
          hostId: "host-laptop",
          hostName: machines[0]?.host.name,
          skills: ["patcher-browser"],
        },
        {
          hostId: "host-studio",
          hostName: machines[1]?.host.name,
          skills: ["patcher-cli"],
        },
      ]);

      await harness.app.request(
        answer("accept", ["patcher-browser", "patcher-cli"]),
      );

      expect(installedSkillNames(machines[0]!.responder)).toEqual([
        "patcher-browser",
      ]);
      expect(installedSkillNames(machines[1]!.responder)).toEqual([
        "patcher-cli",
      ]);
    });
  });

  it("leaves a removed machine's skills out of the question", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const machines = seedTwoMachines(harness);
      for (const machine of machines) {
        await reconcileGlobalCliSkills(harness.deps, {
          hostId: machine.host.id,
          sessionId: machine.session.id,
        });
      }

      const changes = recordSystemChanges(harness);
      // Disconnected first, as a machine being removed has been.
      machines[0]?.responder.unregister();
      const removed = await harness.app.request(
        new Request("http://test/api/v1/hosts/host-laptop", {
          method: "DELETE",
        }),
      );
      expect(removed.status).toBe(200);
      // The window holding this machine hears about it at once, rather than
      // keeping a question naming a machine that is gone.
      expect(changes).toContain("config-changed");

      const offer = await readOffer(harness);
      expect(offer?.skills).toEqual(["patcher-cli"]);
      expect(offer?.machines.map((machine) => machine.hostId)).toEqual([
        "host-studio",
      ]);
    });
  });

  it("answers only the skills the window showed", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const machines = seedTwoMachines(harness);
      for (const machine of machines) {
        await reconcileGlobalCliSkills(harness.deps, {
          hostId: machine.host.id,
          sessionId: machine.session.id,
        });
      }

      // A window drawn before the studio connected knows only this one.
      await harness.app.request(answer("decline", ["patcher-browser"]));

      expect(getAnsweredCliSkills(harness.deps.db)).toEqual({
        "patcher-browser": "declined",
      });
      expect((await readOffer(harness))?.skills).toEqual(["patcher-cli"]);
    });
  });
});

describe("an offer that no longer holds", () => {
  it("goes away when the skill turns up on the machine", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const { host, session } = seedHostSession(harness.deps);
      const hashes = treeHashes(harness);
      let entries = machineMissingTheNewSkill(harness);
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          if (request.command.type === "host.global_skills_status") {
            return { ok: true, result: { entries } };
          }
          throw new Error(`Unexpected command ${request.command.type}`);
        },
      });
      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });
      expect((await readOffer(harness))?.skills).toEqual(["patcher-browser"]);

      // Installed by hand, or by another Patcher over the same home.
      const browser = hashes["patcher-browser"] ?? OWNED;
      entries = [
        ...copies("patcher-cli", [hashes["patcher-cli"] ?? OWNED, OWNED]),
        ...copies("patcher-browser", [browser, null]),
      ];
      await harness.app.request("/api/v1/system/cli-skills");

      expect(await readOffer(harness)).toBeNull();
    });
  });

  it("records the answer when the skill is gone from this server", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const { host } = seedHostSession(harness.deps);
      // A downgrade: the offer outlived the skill that raised it.
      harness.deps.cliSkillsOffers.set(host.id, ["patcher-ghost"]);

      const response = await harness.app.request(
        answer("accept", ["patcher-ghost"]),
      );

      expect(await readJson(response)).toEqual({
        answered: ["patcher-ghost"],
        install: { results: [] },
      });
      expect(getAnsweredCliSkills(harness.deps.db)).toEqual({
        "patcher-ghost": "accepted",
      });
    });
  });
});

describe("an accepted skill that only half arrived", () => {
  /** One root holds this install's current copy; the other has none. */
  function halfWritten(harness: TestAppHarness, present: string): Entries {
    const cli = treeHashes(harness)["patcher-cli"] ?? OWNED;
    return [
      ...copies("patcher-cli", [cli, cli]),
      {
        name: "patcher-browser",
        path: "/home/u/.agents/skills/patcher-browser",
        treeHash: present,
        installedTreeHash: treeHashes(harness)["patcher-browser"] ?? OWNED,
      },
      {
        name: "patcher-browser",
        path: "/home/u/.claude/skills/patcher-browser",
        treeHash: null,
        installedTreeHash: null,
      },
    ];
  }

  // Neither rule reaches this on its own: "new" wants every copy absent, and
  // the update plan never creates a copy that is not there.
  it("is finished on the next connect", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      setAnsweredCliSkills(harness.deps.db, { "patcher-browser": "accepted" });
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: halfWritten(
          harness,
          treeHashes(harness)["patcher-browser"] ?? OWNED,
        ),
      });

      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });

      expect(installedSkills(machine)).toEqual([
        { name: "patcher-browser", conditional: false },
      ]);
    });
  });

  it("is left alone when the copy that is there was changed", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      setAnsweredCliSkills(harness.deps.db, { "patcher-browser": "accepted" });
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: halfWritten(harness, "f".repeat(64)),
      });

      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });

      expect(installedSkillNames(machine)).toEqual([]);
    });
  });
});

describe("what an accepted skill does not do", () => {
  function machineWith(harness: TestAppHarness, browser: Entries): Entries {
    const cli = treeHashes(harness)["patcher-cli"] ?? OWNED;
    return [...copies("patcher-cli", [cli, cli]), ...browser];
  }

  // The record keeps a deleted copy's entry, which is what tells "removed"
  // from "never had". Without that, an accept would put it back on every
  // connect, for good.
  it("does not put back a copy the person deleted", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      setAnsweredCliSkills(harness.deps.db, { "patcher-browser": "accepted" });
      const browser = treeHashes(harness)["patcher-browser"] ?? OWNED;
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: machineWith(
          harness,
          copies("patcher-browser", [null, browser]),
        ),
      });

      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });

      expect(installedSkillNames(machine)).toEqual([]);
    });
  });

  it("does not put back one root of two the person deleted", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      setAnsweredCliSkills(harness.deps.db, { "patcher-browser": "accepted" });
      const browser = treeHashes(harness)["patcher-browser"] ?? OWNED;
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: machineWith(harness, [
          {
            name: "patcher-browser",
            path: "/home/u/.agents/skills/patcher-browser",
            treeHash: browser,
            installedTreeHash: browser,
          },
          {
            name: "patcher-browser",
            path: "/home/u/.claude/skills/patcher-browser",
            treeHash: null,
            installedTreeHash: browser,
          },
        ]),
      });

      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });

      expect(installedSkillNames(machine)).toEqual([]);
    });
  });

  // The answer is about Patcher's skills on the machines that have them. A
  // machine holding none of them was in no question.
  it("does not reach a machine that has none of Patcher's skills", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      setAnsweredCliSkills(harness.deps.db, { "patcher-browser": "accepted" });
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
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

      expect(installedSkillNames(machine)).toEqual([]);
    });
  });
});

describe("answering for more than one machine", () => {
  // Machines install independently, so one refusing is a result rather than a
  // failure of the answer: the others still get the skill, and the answer
  // stands so the question does not come back on the next launch.
  it("reports each machine, and keeps the answer when one refuses", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const machines = ["host-laptop", "host-studio"].map((id, index) => {
        const { host, session } = seedHostSession(harness.deps, { id });
        return {
          host,
          session,
          responder: standInMachine(harness, {
            hostId: host.id,
            sessionId: session.id,
            entries: machineMissingTheNewSkill(harness),
            ...(index === 0 ? { install: "fails" as const } : {}),
          }),
        };
      });
      for (const machine of machines) {
        await reconcileGlobalCliSkills(harness.deps, {
          hostId: machine.host.id,
          sessionId: machine.session.id,
        });
      }

      const response = await harness.app.request(answer("accept"));

      expect(response.status).toBe(200);
      const body = systemCliSkillsOfferResponseSchema.parse(
        await readJson(response),
      );
      expect(
        body.install?.results.map((entry) => [entry.hostId, entry.ok]),
      ).toEqual([
        ["host-laptop", false],
        ["host-studio", true],
      ]);
      expect(getAnsweredCliSkills(harness.deps.db)).toEqual({
        "patcher-browser": "accepted",
      });
      expect(await readOffer(harness)).toBeNull();
    });
  });

  // The offer is fixed before the first machine is asked, so a machine removed
  // while the installs are running fails on its own rather than taking the
  // others down with it — the answer is already recorded either way.
  it("keeps the other machines when one is removed mid-answer", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const machines = ["host-laptop", "host-studio"].map((id) => {
        const { host, session } = seedHostSession(harness.deps, { id });
        return {
          host,
          session,
          responder: standInMachine(harness, {
            hostId: host.id,
            sessionId: session.id,
            entries: machineMissingTheNewSkill(harness),
          }),
        };
      });
      for (const machine of machines) {
        await reconcileGlobalCliSkills(harness.deps, {
          hostId: machine.host.id,
          sessionId: machine.session.id,
        });
      }
      // The answer broadcasts before it installs; the machine goes in that gap.
      let removed = false;
      const notifySystem = harness.hub.notifySystem.bind(harness.hub);
      harness.hub.notifySystem = (kinds) => {
        notifySystem(kinds);
        if (removed || !kinds.includes("config-changed")) return;
        removed = true;
        updateHost(harness.deps.db, harness.deps.hub, "host-laptop", {
          destroyedAt: Date.now(),
        });
      };

      const response = await harness.app.request(answer("accept"));

      expect(response.status).toBe(200);
      const body = systemCliSkillsOfferResponseSchema.parse(
        await readJson(response),
      );
      expect(
        body.install?.results.map((entry) => [entry.hostId, entry.ok]),
      ).toEqual([
        ["host-laptop", false],
        ["host-studio", true],
      ]);
      // It failed before any RPC, rather than the daemon refusing it.
      expect(installedSkillNames(machines[0]!.responder)).toEqual([]);
      expect(getAnsweredCliSkills(harness.deps.db)).toEqual({
        "patcher-browser": "accepted",
      });
    });
  });

  // The answer is by skill, not by machine: the same rule that installs an
  // accepted skill on a machine that was offline when it was answered.
  it("answers for a machine that offers a shown skill and appeared late", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinSkills(harness);
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const laptopMachine = standInMachine(harness, {
        hostId: laptop.host.id,
        sessionId: laptop.session.id,
        entries: machineMissingTheNewSkill(harness),
      });
      await reconcileGlobalCliSkills(harness.deps, {
        hostId: laptop.host.id,
        sessionId: laptop.session.id,
      });
      // Drawn while only the laptop was offering.
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      const studioMachine = standInMachine(harness, {
        hostId: studio.host.id,
        sessionId: studio.session.id,
        entries: machineMissingTheNewSkill(harness),
      });
      await reconcileGlobalCliSkills(harness.deps, {
        hostId: studio.host.id,
        sessionId: studio.session.id,
      });

      await harness.app.request(answer("accept"));

      expect(installedSkillNames(laptopMachine)).toEqual(["patcher-browser"]);
      expect(installedSkillNames(studioMachine)).toEqual(["patcher-browser"]);
    });
  });
});
