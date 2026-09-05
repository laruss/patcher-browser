import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { getAppSettings } from "@patcher/db";
import {
  isConsentPendingInteraction,
  type ConsentPendingInteraction,
} from "@patcher/domain";
import { PATCHER_THREAD_ID_HEADER } from "@patcher/server-contract";
import { builtinPluginSource } from "../../src/services/plugins/builtin-registry.js";
import type { AppDeps } from "../../src/types.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

/**
 * The two halves of letting an agent outside Patcher drive the browser: the
 * route a person or an agent changes the level with, and the gate that level
 * turns into on a `patcher browser` command.
 *
 * The distinction every case here rests on is the same one the plugin consent
 * gate rests on — a declared thread is an agent mid-turn and gets a prompt;
 * no thread is a person at their own terminal and does not. What is different,
 * and is why this is not simply another plugin action, is that the agent asking
 * is not the agent that gains: it is asking on behalf of whatever runs in the
 * user's other terminal.
 */

const BASE = "http://127.0.0.1:3334";

function seedConsentThread(deps: AppDeps, suffix: string) {
  const { host } = seedHostSession(deps, { id: `host-browser-${suffix}` });
  const { project } = seedProjectWithSource(deps, { hostId: host.id });
  const environment = seedEnvironment(deps, {
    hostId: host.id,
    projectId: project.id,
  });
  return seedThread(deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
}

async function setLevel(
  harness: TestAppHarness,
  level: string,
  threadId?: string,
): Promise<Response> {
  return harness.app.request(`${BASE}/api/v1/browser/external-access`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(threadId ? { [PATCHER_THREAD_ID_HEADER]: threadId } : {}),
    },
    body: JSON.stringify({ level }),
  });
}

async function waitForConsentInteraction(
  harness: TestAppHarness,
  threadId: string,
): Promise<ConsentPendingInteraction> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [interaction] =
      harness.deps.pendingInteractions.listPendingThreadInteractions(threadId);
    if (interaction && isConsentPendingInteraction(interaction)) {
      return interaction;
    }
    await sleep(10);
  }
  throw new Error("No consent interaction was raised");
}

/**
 * Whether the plugin is actually serving its CLI command.
 *
 * The registered contribution rather than the persisted `enabled` bit, which is
 * what the route reports and is the only version of the question worth
 * asserting: a plugin can be enabled in storage and have failed to load, and a
 * helper that repeated the `enabled` check would agree with the route by
 * construction instead of testing it.
 */
function isServing(harness: TestAppHarness, pluginId: string): boolean {
  const entry = harness.pluginService
    .list()
    .find((plugin) => plugin.id === pluginId);
  return entry?.enabled === true && entry.cliCommand !== null;
}

describe("the level for agents outside Patcher", () => {
  it("is off until somebody sets it", async () => {
    await withTestHarness(async (harness) => {
      expect(getAppSettings(harness.deps.db).browserExternalAccess).toBe("off");
    });
  });

  it("writes without asking when no thread is declared", async () => {
    await withTestHarness(async (harness) => {
      // Seeded before the request, so a prompt would have had somewhere to
      // land: asserting on a thread created afterwards proves nothing.
      const thread = seedConsentThread(harness.deps, "unasked");

      const response = await setLevel(harness, "read");

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ level: "read" });
      expect(getAppSettings(harness.deps.db).browserExternalAccess).toBe(
        "read",
      );
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          thread.id,
        ),
      ).toEqual([]);
    });
  });

  it("turns the browser-tools plugin on with it", async () => {
    await withTestHarness(async (harness) => {
      await harness.pluginService.install(builtinPluginSource("browser-tools"));
      await harness.pluginService.setEnabled("browser-tools", false);
      expect(isServing(harness, "browser-tools")).toBe(false);

      const response = await setLevel(harness, "interact");

      expect(response.status).toBe(200);
      // A level with nothing to serve it is a setting that silently does
      // nothing, so the route says which it got as well as doing it.
      expect(await response.json()).toEqual({
        level: "interact",
        browserToolsEnabled: true,
      });
      expect(isServing(harness, "browser-tools")).toBe(true);
    });
  });

  it("leaves the plugin alone when the level goes back to off", async () => {
    await withTestHarness(async (harness) => {
      await harness.pluginService.install(builtinPluginSource("browser-tools"));
      await setLevel(harness, "read");
      expect(isServing(harness, "browser-tools")).toBe(true);

      await setLevel(harness, "off");

      // Threads inside Patcher use the same plugin, and nobody asked about
      // those: closing the outside door must not close theirs.
      expect(isServing(harness, "browser-tools")).toBe(true);
      expect(getAppSettings(harness.deps.db).browserExternalAccess).toBe("off");
    });
  });

  it("asks the thread's user, naming the level and what it allows", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedConsentThread(harness.deps, "allowed");

      const pending = setLevel(harness, "full", thread.id);
      const interaction = await waitForConsentInteraction(harness, thread.id);

      expect(interaction.payload).toMatchObject({
        kind: "consent",
        action: "browser-external-access",
        subjectId: "full",
      });
      // The permission list is the reason to ask at all, and the top level is
      // the one whose list has to say "cookies".
      expect(interaction.payload.permissions).toContain("page.credentials");
      // Nothing written while the question stands.
      expect(getAppSettings(harness.deps.db).browserExternalAccess).toBe("off");

      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: true,
      });

      const response = await pending;
      expect(response.status).toBe(200);
      expect(getAppSettings(harness.deps.db).browserExternalAccess).toBe(
        "full",
      );
    });
  });

  it("changes nothing when they decline", async () => {
    await withTestHarness(async (harness) => {
      const thread = seedConsentThread(harness.deps, "declined");

      const pending = setLevel(harness, "full", thread.id);
      const interaction = await waitForConsentInteraction(harness, thread.id);
      harness.deps.pendingInteractions.decideConsentInteraction({
        threadId: thread.id,
        interactionId: interaction.id,
        approved: false,
      });

      const response = await pending;
      expect(response.status).toBe(403);
      const body = (await response.json()) as { message?: string };
      expect(body.message).toContain("declined");
      // The refusal has to close the loop rather than invite the same call
      // again: the agent asking cannot answer this question itself.
      expect(body.message).toContain("Do not retry");
      expect(getAppSettings(harness.deps.db).browserExternalAccess).toBe("off");
    });
  });
});

/**
 * The gate itself, driven the way a real caller drives it: through the plugin
 * CLI route, which is where `patcher browser` arrives.
 *
 * The fixture asks for one tab list. With no browser window connected that call
 * fails either way — the point is *which* failure, because the two say different
 * things about whether the command was ever sent.
 */
const BROWSER_CALLER_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.cli.register({
      name: "probe",
      summary: "Ask the browser for its tabs",
      async run() {
        try {
          await patcher.browser.tabs.list();
          return { exitCode: 0, stdout: "listed" };
        } catch (error: any) {
          return {
            exitCode: 1,
            stdout: JSON.stringify({ name: error?.name, code: error?.code }),
          };
        }
      },
    });
  }
`;

async function installBrowserProbe(harness: TestAppHarness): Promise<void> {
  const rootDir = join(
    harness.config.dataDir,
    "fixtures",
    "patcher-plugin-probe",
  );
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "patcher-plugin-probe",
      version: "0.1.0",
      patcher: {
        name: "Browser probe",
        description: "Asks the browser for its tabs.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        permissions: ["tabs.read"],
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), BROWSER_CALLER_SOURCE);
  const entry = await harness.pluginService.installPath(rootDir);
  expect(entry.status).toBe("running");
}

async function runProbe(
  harness: TestAppHarness,
  threadId?: string,
): Promise<{ name?: string; code?: string }> {
  const response = await harness.app.request(
    `${BASE}/api/v1/plugins/probe/cli`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(threadId ? { [PATCHER_THREAD_ID_HEADER]: threadId } : {}),
      },
      body: JSON.stringify({ argv: [] }),
    },
  );
  expect(response.status).toBe(200);
  const result = (await response.json()) as { stdout: string };
  return JSON.parse(result.stdout) as { name?: string; code?: string };
}

describe("a `patcher <plugin>` command from outside a turn", () => {
  it("is refused before the command reaches the browser while access is off", async () => {
    await withTestHarness(async (harness) => {
      await installBrowserProbe(harness);

      expect(await runProbe(harness)).toEqual({
        name: "BrowserCommandError",
        code: "external_access_denied",
      });
    });
  });

  it("reaches the browser once the level allows it", async () => {
    await withTestHarness(async (harness) => {
      await installBrowserProbe(harness);
      await setLevel(harness, "read");

      // No window is connected in a test harness, so this is as far as it can
      // get — and that is the assertion: a *different* failure, from the hub
      // rather than from the gate, means the command was actually dispatched.
      expect(await runProbe(harness)).toMatchObject({
        name: "BrowserHostUnavailableError",
      });
    });
  });

  it("is not exempted by a thread header nobody verified", async () => {
    await withTestHarness(async (harness) => {
      await installBrowserProbe(harness);

      // A turn is exempt because its request carries a thread *credential*, and
      // the middleware resolves that into an id the gate reads. The header
      // beside it is something any holder of the app key can write, so a gate
      // keyed on the header would make the exemption the thing to forge. Here
      // the header is present and no credential is: still gated.
      expect(await runProbe(harness, "thr_not_really_mine")).toEqual({
        name: "BrowserCommandError",
        code: "external_access_denied",
      });
    });
  });

  it("does not reach a plugin running in its own process", async () => {
    // Measured rather than asserted, because the architecture document makes
    // this exact claim and a claim about async context is the kind that is
    // wrong in a way nothing notices. The scope is established on the request
    // and the host charges an out-of-process plugin's browser call on a
    // *channel message*, which is a fresh async context — so the level does not
    // reach it and it is charged what it declared, as before.
    //
    // The tell is the failure it gets instead: `BrowserHostUnavailableError`
    // from the hub means the command was dispatched, which is exactly what the
    // in-process probe above is refused before doing.
    await withTestHarness(
      { runPluginOutOfProcess: () => true },
      async (harness) => {
        await installBrowserProbe(harness);
        expect(getAppSettings(harness.deps.db).browserExternalAccess).toBe(
          "off",
        );

        expect(await runProbe(harness)).toMatchObject({
          name: "BrowserHostUnavailableError",
        });
      },
    );
  });

  it("is charged per command, not per invocation", async () => {
    await withTestHarness(async (harness) => {
      await installBrowserProbe(harness);
      // `tabs.list` costs `tabs.read`, which reading admits. Were the gate
      // coarser — refusing a plugin that merely *declares* more than the level
      // allows — this would be refused too.
      await setLevel(harness, "read");
      expect((await runProbe(harness)).code).toBeUndefined();
    });
  });
});
