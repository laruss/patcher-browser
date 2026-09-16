import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  getCliCommandSetup,
  getOutsideAgentSetup,
  setCliCommandSetup,
} from "@patcher/db";
import type { CliCommandState } from "@patcher/server-contract";
import { systemCliCommandSetupResponseSchema } from "@patcher/server-contract";
import { readJson } from "../helpers/json.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../helpers/host-rpc.js";
import { seedHost, seedHostSession, seedPrimaryHost } from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";
import { reconcileGlobalCliSkills } from "../../src/services/skills/global-skill-reconcile.js";

/**
 * The answer about a bare `patcher` on PATH (#147), which an install whose
 * skills answer was read off the disk never gave: the launch-time question that
 * asks for it, and the other ways it gets answered — any install on the primary
 * machine, and a read that finds nothing for the question to do.
 */

/**
 * A release install. The harness is a source checkout by default, and a
 * checkout never owns the bare command, so nothing is asked of its daemon.
 */
function withRelease<T>(
  run: (harness: TestAppHarness) => Promise<T>,
): Promise<T> {
  return withTestHarness({ isDevelopment: false }, run);
}

function commandResult(
  state: CliCommandState,
  changed: boolean,
): HostRpcHandlerResult {
  return {
    ok: true,
    result: {
      state,
      linkPath: "/home/u/.local/bin/patcher",
      existingPath: state === "installed" ? "/home/u/.local/bin/patcher" : null,
      existingTarget:
        state === "installed" ? "/home/u/.patcher/bin/patcher" : null,
      shimDirectory: "/home/u/.patcher/bin",
      reason: null,
      message: null,
      changed,
    },
  };
}

const PLACED = commandResult("installed", true);

function postJson(path: string, body: unknown): Request {
  return new Request(`http://test/api/v1${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function readAnswerFromConfig(harness: TestAppHarness): Promise<unknown> {
  // Read raw: the field is defaulted so a desktop shell survives an older
  // server, and parsing first would hide a server that stopped sending it.
  const config = (await readJson(
    await harness.app.request("/api/v1/system/config"),
  )) as { cliCommandSetup?: unknown };
  return config.cliCommandSetup;
}

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

describe("the question about the patcher command", () => {
  it("is unasked on a fresh install, and the config says so", async () => {
    await withRelease(async (harness) => {
      expect(await readAnswerFromConfig(harness)).toBe("unasked");
    });
  });

  it("stays unasked when the skills are answered for from the disk, and nothing is linked", async () => {
    // The gap #147 closes: #141 records a yes for skills it finds installed,
    // and that yes never carried the command. Whatever answers it later, the
    // read that adopts the skills must not place a link nor answer for it.
    await withRelease(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => ({
          ok: true,
          result: {
            entries: [
              {
                name: "patcher-cli",
                path: "/home/u/.agents/skills/patcher-cli",
                treeHash: "b".repeat(64),
                installedTreeHash: null,
              },
            ],
          },
        }),
      });

      await reconcileGlobalCliSkills(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });
      await harness.app.request(
        `/api/v1/system/cli-skills?hostIds=${host.id}`,
      );

      expect(getOutsideAgentSetup(harness.deps.db)).toBe("accepted");
      expect(getCliCommandSetup(harness.deps.db)).toBe("unasked");
      expect(
        new Set(responder.requests.map((request) => request.command.type)),
      ).toEqual(new Set(["host.global_skills_status"]));
    });
  });

  it("records a no and links nothing", async () => {
    await withRelease(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => PLACED,
      });

      const response = await harness.app.request(
        postJson("/system/cli-command/setup", { answer: "decline" }),
      );

      expect(response.status).toBe(200);
      expect(
        systemCliCommandSetupResponseSchema.parse(await readJson(response)),
      ).toEqual({ cliCommandSetup: "declined", cliCommand: null });
      expect(responder.requests).toHaveLength(0);
      expect(await readAnswerFromConfig(harness)).toBe("declined");
    });
  });

  it("records a yes before linking, links on the primary machine only, and carries back what it answered", async () => {
    await withRelease(async (harness) => {
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      seedPrimaryHost(harness.deps, laptop.host.id);
      const answerWhenAsked: string[] = [];
      const [laptopResponder, studioResponder] = [laptop, studio].map(
        ({ host, session }) =>
          registerHostRpcResponder(harness, {
            hostId: host.id,
            sessionId: session.id,
            handle: () => {
              // Another window refetching its config on the broadcast must
              // already read the answer while the daemon is still working.
              answerWhenAsked.push(getCliCommandSetup(harness.deps.db));
              return commandResult("not_on_path", false);
            },
          }),
      );

      const response = await harness.app.request(
        postJson("/system/cli-command/setup", { answer: "accept" }),
      );

      const body = systemCliCommandSetupResponseSchema.parse(
        await readJson(response),
      );
      expect(body.cliCommandSetup).toBe("accepted");
      // A place that could not be linked is said, not hidden.
      expect(body.cliCommand).toMatchObject({
        hostId: "host-laptop",
        state: "not_on_path",
      });
      expect(answerWhenAsked).toEqual(["accepted"]);
      expect(laptopResponder?.requests.map((r) => r.command.type)).toEqual([
        "host.install_cli_command",
      ]);
      expect(studioResponder?.requests).toHaveLength(0);
    });
  });

  it("keeps the yes when linking fails, so the question does not return", async () => {
    await withRelease(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => ({
          ok: false,
          errorCode: "install_failed",
          errorMessage: "read-only file system",
        }),
      });

      const body = systemCliCommandSetupResponseSchema.parse(
        await readJson(
          await harness.app.request(
            postJson("/system/cli-command/setup", { answer: "accept" }),
          ),
        ),
      );

      expect(body.cliCommand?.state).toBe("failed");
      expect(getCliCommandSetup(harness.deps.db)).toBe("accepted");
    });
  });

  it("keeps the first answer when a second window answers late", async () => {
    await withRelease(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const responder = registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => PLACED,
      });
      setCliCommandSetup(harness.deps.db, "declined");

      const body = systemCliCommandSetupResponseSchema.parse(
        await readJson(
          await harness.app.request(
            postJson("/system/cli-command/setup", { answer: "accept" }),
          ),
        ),
      );

      expect(body).toEqual({ cliCommandSetup: "declined", cliCommand: null });
      expect(responder.requests).toHaveLength(0);
    });
  });

  it("is answered yes by an install on the primary machine, and not by one elsewhere", async () => {
    await withRelease(async (harness) => {
      const laptop = seedHostSession(harness.deps, { id: "host-laptop" });
      const studio = seedHostSession(harness.deps, { id: "host-studio" });
      seedPrimaryHost(harness.deps, laptop.host.id);
      for (const { host, session } of [laptop, studio]) {
        registerHostRpcResponder(harness, {
          hostId: host.id,
          sessionId: session.id,
          handle: () => PLACED,
        });
      }

      await harness.app.request(
        postJson("/system/cli-command/install", { hostIds: ["host-studio"] }),
      );
      expect(getCliCommandSetup(harness.deps.db)).toBe("unasked");

      // Settings → Skills, which names no machine.
      await harness.app.request(postJson("/system/cli-command/install", {}));
      expect(getCliCommandSetup(harness.deps.db)).toBe("accepted");
    });
  });

  it("is answered yes by #141's accept, which links the command too", async () => {
    await withRelease(async (harness) => {
      await writeBuiltinCliSkill(harness);
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) =>
          request.command.type === "host.install_cli_command"
            ? PLACED
            : {
                ok: true,
                result: {
                  installations: [
                    {
                      name: "patcher-cli",
                      path: "/home/u/.agents/skills/patcher-cli",
                      outcome: "written",
                    },
                  ],
                },
              },
      });

      await harness.app.request(
        postJson("/system/cli-skills/setup", { answer: "accept" }),
      );

      expect(getCliCommandSetup(harness.deps.db)).toBe("accepted");
    });
  });

  it("is answered yes by a read that leaves the question nothing to do, and by no other read", async () => {
    await withRelease(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      let state: CliCommandState = "missing";
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => commandResult(state, false),
      });

      await harness.app.request("/api/v1/system/cli-command");
      expect(getCliCommandSetup(harness.deps.db)).toBe("unasked");

      // Nowhere to put it: the question could only fail, and without an answer
      // this machine would be read for it on every launch.
      state = "not_on_path";
      await harness.app.request("/api/v1/system/cli-command");
      expect(getCliCommandSetup(harness.deps.db)).toBe("accepted");
    });
  });

  it("records nothing from a read that could not reach the primary machine", async () => {
    await withRelease(async (harness) => {
      const host = seedHost(harness.deps, { id: "host-offline" });
      seedPrimaryHost(harness.deps, host.id);

      await harness.app.request("/api/v1/system/cli-command");

      expect(getCliCommandSetup(harness.deps.db)).toBe("unasked");
    });
  });

  it("records nothing on a source checkout, where nothing is asked", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => PLACED,
      });

      await harness.app.request("/api/v1/system/cli-command");
      await harness.app.request(postJson("/system/cli-command/install", {}));

      expect(getCliCommandSetup(harness.deps.db)).toBe("unasked");
    });
  });
});
