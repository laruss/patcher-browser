import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { setOutsideAgentSetup } from "@patcher/db";
import type {
  HostDaemonOnlineRpcRequestMessage,
  HostGlobalSkillsStatusResult,
  HostInstallGlobalSkill,
} from "@patcher/host-daemon-contract";
import {
  systemCliSkillsStatusResponseSchema,
  systemConfigResponseSchema,
} from "@patcher/server-contract";
import { readJson } from "../helpers/json.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
  type HostRpcResponder,
} from "../helpers/host-rpc.js";
import { seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import {
  GLOBAL_CLI_SKILL_NAMES,
  resolveGlobalCliSkills,
} from "../../src/services/skills/global-skill-install.js";
import {
  planCliSkillsUpdate,
  reconcileGlobalCliSkills,
} from "../../src/services/skills/global-skill-reconcile.js";

/**
 * Keeping the Patcher skills an install put in the global skill roots current
 * (#142): which copies a connect updates, which it never touches, and what
 * the windows are told.
 */

type Entries = HostGlobalSkillsStatusResult["entries"];
/** One copy, as [tree hash on disk, tree hash the machine's install recorded]. */
type Copy = readonly [string | null, string | null];

const OLDER = "a".repeat(64);
const OTHER_OLDER = "b".repeat(64);
const EDITED = "e".repeat(64);
const CURRENT = "c".repeat(64);
const SKILL: HostInstallGlobalSkill = {
  name: "patcher-cli",
  treeHash: CURRENT,
  entryPath: "SKILL.md",
};
const ROOT_PATHS = [
  "/home/u/.agents/skills/patcher-cli",
  "/home/u/.claude/skills/patcher-cli",
] as const;

const REAL_BUILTIN_SKILLS_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/services/skills/builtin-skills",
);

function copies(agents: Copy, claude: Copy, name = "patcher-cli"): Entries {
  return [agents, claude].map(([treeHash, installedTreeHash], index) => ({
    name,
    path: ROOT_PATHS[index]?.replace("patcher-cli", name) ?? "",
    treeHash,
    installedTreeHash,
  }));
}

async function writeBuiltinCliSkill(
  harness: TestAppHarness,
  description = "Control Patcher from the CLI.",
): Promise<void> {
  const skillDirectory = join(
    harness.deps.config.builtinSkillsRootPath,
    "patcher-cli",
  );
  await mkdir(skillDirectory, { recursive: true });
  await writeFile(
    join(skillDirectory, "SKILL.md"),
    `---\nname: patcher-cli\ndescription: ${description}\n---\n`,
  );
}

function currentTreeHash(harness: TestAppHarness): string {
  const [skill] = resolveGlobalCliSkills(harness.deps);
  if (skill === undefined) throw new Error("No built-in CLI skill resolved");
  return skill.treeHash;
}

function sentInstalls(responder: HostRpcResponder): HostInstallGlobalSkill[][] {
  return responder.requests.flatMap((request) =>
    request.command.type === "host.install_global_skills"
      ? [request.command.skills]
      : [],
  );
}

function commandTypes(responder: HostRpcResponder): string[] {
  return responder.requests.map((request) => request.command.type);
}

function answerInstall(
  request: HostDaemonOnlineRpcRequestMessage,
  outcome: "written" | "adopted" | "skipped",
): HostRpcHandlerResult {
  if (request.command.type !== "host.install_global_skills") {
    throw new Error(`Unexpected command ${request.command.type}`);
  }
  return {
    ok: true,
    result: {
      installations: request.command.skills.flatMap((skill) =>
        ROOT_PATHS.map((path) => ({ name: skill.name, path, outcome })),
      ),
    },
  };
}

/** A machine that reports `entries` and answers any install with `outcome`. */
function standInMachine(
  harness: TestAppHarness,
  args: {
    hostId: string;
    sessionId: string;
    entries: Entries;
    install?: "written" | "adopted" | "skipped" | "fails";
    status?: "fails";
  },
): HostRpcResponder {
  return registerHostRpcResponder(harness, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    handle: (request) => {
      if (request.command.type === "host.global_skills_status") {
        return args.status === "fails"
          ? { ok: false, errorCode: "timeout", errorMessage: "no answer" }
          : { ok: true, result: { entries: args.entries } };
      }
      return args.install === "fails"
        ? { ok: false, errorCode: "install_failed", errorMessage: "disk full" }
        : answerInstall(request, args.install ?? "written");
    },
  });
}

async function readUpdates(harness: TestAppHarness) {
  const response = await harness.app.request("/api/v1/system/config");
  return systemConfigResponseSchema.parse(await readJson(response))
    .cliSkillsUpdates;
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

describe("which copies a connect updates", () => {
  it("updates a copy this install wrote and nobody changed, while it still holds that tree", () => {
    expect(
      planCliSkillsUpdate({
        entries: copies([OLDER, OLDER], [OLDER, OLDER]),
        skills: [SKILL],
      }),
    ).toEqual([{ ...SKILL, replaceOnlyIfTreeHash: OLDER }]);
  });

  // The update is safe only because every install it sends is conditional on
  // a tree this install recorded. Beside an edited copy, the edit's bytes must
  // not become a condition, or the edit would be replaced.
  it("never makes an edited copy's bytes the condition of an update", () => {
    const plan = planCliSkillsUpdate({
      entries: copies([OLDER, OLDER], [EDITED, OLDER]),
      skills: [SKILL],
    });

    expect(plan).toEqual([{ ...SKILL, replaceOnlyIfTreeHash: OLDER }]);
    expect(JSON.stringify(plan)).not.toContain(EDITED);
  });

  it("leaves alone a copy edited, removed, installed before the record, or already current", () => {
    for (const copy of [
      [EDITED, OLDER],
      [null, OLDER],
      [OLDER, null],
      [null, null],
      [CURRENT, CURRENT],
    ] as const) {
      expect(
        planCliSkillsUpdate({ entries: copies(copy, copy), skills: [SKILL] }),
      ).toEqual([]);
    }
  });

  it("gives each older tree this install wrote its own condition", () => {
    expect(
      planCliSkillsUpdate({
        entries: copies([OLDER, OLDER], [OTHER_OLDER, OTHER_OLDER]),
        skills: [SKILL],
      }),
    ).toEqual([
      { ...SKILL, replaceOnlyIfTreeHash: OLDER },
      { ...SKILL, replaceOnlyIfTreeHash: OTHER_OLDER },
    ]);
  });

  it("adopts a copy already holding this server's tree that the record does not list as such", () => {
    expect(
      planCliSkillsUpdate({
        entries: copies([CURRENT, null], [CURRENT, OLDER]),
        skills: [SKILL],
      }),
    ).toEqual([{ ...SKILL, replaceOnlyIfTreeHash: CURRENT }]);
  });
});

describe("a machine connecting", () => {
  it("has its own outdated copies updated, and the windows told which machine", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      setOutsideAgentSetup(harness.deps.db, "accepted");
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: copies([OLDER, OLDER], [OLDER, OLDER]),
      });
      const changes = recordSystemChanges(harness);

      await reconcileGlobalCliSkills(harness.deps, { hostId: host.id });

      expect(commandTypes(machine)).toEqual([
        "host.global_skills_status",
        "host.install_global_skills",
      ]);
      expect(sentInstalls(machine)).toEqual([
        [
          {
            name: "patcher-cli",
            treeHash: currentTreeHash(harness),
            entryPath: "SKILL.md",
            replaceOnlyIfTreeHash: OLDER,
          },
        ],
      ]);
      expect(await readUpdates(harness)).toEqual([
        {
          hostId: host.id,
          hostName: host.name,
          skills: ["patcher-cli"],
          at: expect.any(Number),
        },
      ]);
      expect(changes).toEqual(["config-changed"]);
    });
  });

  it("sends no install for a copy edited, removed, or installed before the record existed", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      setOutsideAgentSetup(harness.deps.db, "accepted");
      const machines = [
        copies([EDITED, OLDER], [EDITED, OLDER]),
        copies([null, OLDER], [null, OLDER]),
        copies([OLDER, null], [OLDER, null]),
        copies([null, null], [null, null]),
      ].map((entries, index) => {
        const { host, session } = seedHostSession(harness.deps, {
          id: `host-${index}`,
        });
        return {
          hostId: host.id,
          responder: standInMachine(harness, {
            hostId: host.id,
            sessionId: session.id,
            entries,
          }),
        };
      });
      const changes = recordSystemChanges(harness);

      for (const { hostId } of machines) {
        await reconcileGlobalCliSkills(harness.deps, { hostId });
      }

      for (const { responder } of machines) {
        expect(commandTypes(responder)).toEqual(["host.global_skills_status"]);
      }
      expect(await readUpdates(harness)).toEqual([]);
      expect(changes).toEqual([]);
    });
  });

  it("keeps a machine that is not the primary current too", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      seedPrimaryHost(harness.deps, laptop.host.id);
      const studioMachine = standInMachine(harness, {
        hostId: studio.host.id,
        sessionId: studio.session.id,
        entries: copies([OLDER, OLDER], [OLDER, OLDER]),
      });

      await reconcileGlobalCliSkills(harness.deps, {
        hostId: studio.host.id,
      });

      expect(sentInstalls(studioMachine)).toHaveLength(1);
      expect((await readUpdates(harness)).map((u) => u.hostId)).toEqual([
        "host-studio",
      ]);
    });
  });

  it("reads a machine once while a reconciliation of it is already running", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const { host, session } = seedHostSession(harness.deps);
      const machine = standInMachine(harness, {
        hostId: host.id,
        sessionId: session.id,
        entries: copies([null, null], [null, null]),
      });

      await Promise.all([
        reconcileGlobalCliSkills(harness.deps, { hostId: host.id }),
        reconcileGlobalCliSkills(harness.deps, { hostId: host.id }),
      ]);

      expect(commandTypes(machine)).toEqual(["host.global_skills_status"]);
    });
  });

  it("tells nobody when the machine could not be read, or the update failed", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      setOutsideAgentSetup(harness.deps.db, "accepted");
      const unreadable = seedHostSession(harness.deps, { id: "host-silent" });
      const failing = seedHostSession(harness.deps, { id: "host-full" });
      const unreadableMachine = standInMachine(harness, {
        hostId: unreadable.host.id,
        sessionId: unreadable.session.id,
        entries: [],
        status: "fails",
      });
      const failingMachine = standInMachine(harness, {
        hostId: failing.host.id,
        sessionId: failing.session.id,
        entries: copies([OLDER, OLDER], [OLDER, OLDER]),
        install: "fails",
      });
      const changes = recordSystemChanges(harness);

      await reconcileGlobalCliSkills(harness.deps, {
        hostId: unreadable.host.id,
      });
      await reconcileGlobalCliSkills(harness.deps, {
        hostId: failing.host.id,
      });

      expect(commandTypes(unreadableMachine)).toEqual([
        "host.global_skills_status",
      ]);
      expect(sentInstalls(failingMachine)).toHaveLength(1);
      expect(await readUpdates(harness)).toEqual([]);
      expect(changes).toEqual([]);
    });
  });

  it("tells nobody when nothing was written: every copy changed first, or was only adopted", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      setOutsideAgentSetup(harness.deps.db, "accepted");
      const current = currentTreeHash(harness);
      const raced = seedHostSession(harness.deps, { id: "host-raced" });
      const adopted = seedHostSession(harness.deps, { id: "host-adopted" });
      standInMachine(harness, {
        hostId: raced.host.id,
        sessionId: raced.session.id,
        entries: copies([OLDER, OLDER], [OLDER, OLDER]),
        install: "skipped",
      });
      const adoptedMachine = standInMachine(harness, {
        hostId: adopted.host.id,
        sessionId: adopted.session.id,
        entries: copies([current, null], [current, null]),
        install: "adopted",
      });
      const changes = recordSystemChanges(harness);

      await reconcileGlobalCliSkills(harness.deps, { hostId: raced.host.id });
      await reconcileGlobalCliSkills(harness.deps, {
        hostId: adopted.host.id,
      });

      expect(
        sentInstalls(adoptedMachine).map((skills) =>
          skills.map((skill) => skill.replaceOnlyIfTreeHash),
        ),
      ).toEqual([[current]]);
      expect(await readUpdates(harness)).toEqual([]);
      expect(changes).toEqual([]);
    });
  });

  it("keeps the latest update per machine, each later than any before it", async () => {
    await withTestHarness(async (harness) => {
      await writeBuiltinCliSkill(harness);
      setOutsideAgentSetup(harness.deps.db, "accepted");
      for (const id of ["host-laptop", "host-studio", "host-laptop"]) {
        const { host, session } = seedHostSession(harness.deps, { id });
        standInMachine(harness, {
          hostId: host.id,
          sessionId: session.id,
          entries: copies([OLDER, OLDER], [OLDER, OLDER]),
        });
        await reconcileGlobalCliSkills(harness.deps, { hostId: host.id });
      }

      const updates = await readUpdates(harness);
      expect(updates.map((update) => update.hostId).sort()).toEqual([
        "host-laptop",
        "host-studio",
      ]);
      const [studio, laptop] = [
        updates.find((update) => update.hostId === "host-studio"),
        updates.find((update) => update.hostId === "host-laptop"),
      ];
      // The laptop's second update replaced its first and came after the studio's.
      expect(laptop?.at).toBeGreaterThan(studio?.at ?? Infinity);
    });
  });

  // Anti-rot against the real skills: a skill added to the list is kept current
  // along with the others, not left behind because the plan only knew one.
  it("updates every built-in skill for agents outside Patcher that is behind", async () => {
    await withTestHarness(
      { builtinSkillsRootPath: REAL_BUILTIN_SKILLS_ROOT },
      async (harness) => {
        setOutsideAgentSetup(harness.deps.db, "accepted");
        const skills = resolveGlobalCliSkills(harness.deps);
        expect(skills.map((skill) => skill.name).sort()).toEqual(
          [...GLOBAL_CLI_SKILL_NAMES].sort(),
        );
        const { host, session } = seedHostSession(harness.deps);
        const machine = standInMachine(harness, {
          hostId: host.id,
          sessionId: session.id,
          entries: skills.flatMap((skill) =>
            copies([OLDER, OLDER], [OLDER, OLDER], skill.name),
          ),
        });

        await reconcileGlobalCliSkills(harness.deps, { hostId: host.id });

        expect(sentInstalls(machine)).toEqual([
          skills.map((skill) => ({ ...skill, replaceOnlyIfTreeHash: OLDER })),
        ]);
      },
    );
  });
});

describe("a release and a source checkout sharing one home", () => {
  // Each has its own server, daemon and data directory, and its own built-in
  // tree. One home stands in for the disk they share; each machine keeps its
  // own record. What is asserted is what the servers send, not what the
  // stand-in does with it: after each one's own Install, a connect of either
  // sends no install at all.
  it("never take turns rewriting each other's copies", async () => {
    await withTestHarness(async (release) => {
      await withTestHarness(async (checkout) => {
        await writeBuiltinCliSkill(release, "Release build.");
        await writeBuiltinCliSkill(checkout, "Source checkout.");
        setOutsideAgentSetup(release.deps.db, "accepted");
        setOutsideAgentSetup(checkout.deps.db, "accepted");
        const home = new Map<string, string>();
        const [releaseMachine, checkoutMachine] = [
          { harness: release, id: "host-release" },
          { harness: checkout, id: "host-checkout" },
        ].map(({ harness, id }) => {
          const record = new Map<string, string>();
          const { host, session } = seedHostSession(harness.deps, { id });
          const responder = registerHostRpcResponder(harness, {
            hostId: host.id,
            sessionId: session.id,
            handle: (request) => {
              const { command } = request;
              if (command.type === "host.global_skills_status") {
                return {
                  ok: true,
                  result: {
                    entries: ROOT_PATHS.map((path) => ({
                      name: "patcher-cli",
                      path,
                      treeHash: home.get(path) ?? null,
                      installedTreeHash: record.get(path) ?? null,
                    })),
                  },
                };
              }
              if (command.type !== "host.install_global_skills") {
                throw new Error(`Unexpected command ${command.type}`);
              }
              const installations = command.skills.flatMap((skill) =>
                ROOT_PATHS.map((path) => {
                  const expected = skill.replaceOnlyIfTreeHash;
                  if (expected !== undefined && home.get(path) !== expected) {
                    return {
                      name: skill.name,
                      path,
                      outcome: "skipped" as const,
                    };
                  }
                  const outcome =
                    expected === skill.treeHash
                      ? ("adopted" as const)
                      : ("written" as const);
                  home.set(path, skill.treeHash);
                  record.set(path, skill.treeHash);
                  return { name: skill.name, path, outcome };
                }),
              );
              return { ok: true, result: { installations } };
            },
          });
          return { harness, hostId: host.id, responder };
        });
        if (releaseMachine === undefined || checkoutMachine === undefined) {
          throw new Error("Both machines are seeded");
        }
        const pressInstall = (machine: typeof releaseMachine) =>
          machine.harness.app.request(
            new Request("http://test/api/v1/system/cli-skills/install", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ hostIds: [machine.hostId] }),
            }),
          );
        const connect = (machine: typeof releaseMachine) =>
          reconcileGlobalCliSkills(machine.harness.deps, {
            hostId: machine.hostId,
          });
        const installsSent = () =>
          [releaseMachine, checkoutMachine].map(
            (machine) => sentInstalls(machine.responder).length,
          );

        await pressInstall(releaseMachine);
        for (let round = 0; round < 3; round += 1) {
          await connect(checkoutMachine);
          await connect(releaseMachine);
        }
        expect(installsSent()).toEqual([1, 0]);

        await pressInstall(checkoutMachine);
        for (let round = 0; round < 3; round += 1) {
          await connect(releaseMachine);
          await connect(checkoutMachine);
        }
        expect(installsSent()).toEqual([1, 1]);
        expect(await readUpdates(release)).toEqual([]);
        expect(await readUpdates(checkout)).toEqual([]);

        // And the release says why it no longer updates them.
        const status = await release.app.request("/api/v1/system/cli-skills");
        expect(
          systemCliSkillsStatusResponseSchema
            .parse(await readJson(status))
            .machines.map((machine) => machine.status),
        ).toEqual(["modified"]);
      });
    });
  });
});
