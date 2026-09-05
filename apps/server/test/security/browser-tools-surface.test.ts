import { afterEach, describe, expect, it } from "vitest";
import { deriveAgentAccessKey } from "@patcher/config/agent-access-key";
import { createBrowserAccessGrant, getAppSettings } from "@patcher/db";
import { deriveThreadTurnApiKey } from "@patcher/config/thread-api-key";
import {
  PATCHER_AGENT_KEY_HEADER,
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import { builtinPluginSource } from "../../src/services/plugins/builtin-registry.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  startTestServer,
  TEST_APP_API_KEY,
  type RunningTestServer,
} from "../helpers/test-app.js";

/**
 * Every command `patcher browser` has, run by a caller from outside Patcher
 * that is allowed the least.
 *
 * The gate charges *browser commands* — the messages that cross the wire to the
 * window — and that is the right unit for all but one thing the plugin does.
 * `install-ffmpeg` runs Homebrew on the server's machine and sends no browser
 * command, so for as long as this file did not exist it ran to completion under
 * a `read` grant with the install-wide level at `off`, one line away from a
 * `tabs` that was refused. Review found it on 2026-09-05.
 *
 * So the check is not "is `install-ffmpeg` refused" — that would pass a second
 * such command straight through. It is: **no command runs to completion.** With
 * no browser window connected and no arguments, every command must land in one
 * of three places, and "it worked" is not one of them:
 *
 * - refused by the gate, because its permission is above `read`;
 * - dispatched and defeated by the hub, because no window is connected;
 * - refused on its own arguments, before it does anything.
 *
 * The command list comes from the plugin's own registration rather than from a
 * copy here, so a command added tomorrow is in this test the day it exists.
 */

let server: RunningTestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

interface CommandVerdict {
  name: string;
  verdict: "gated" | "dispatched" | "refused-its-arguments" | "ran";
  body: string;
}

async function runEveryCommand(
  running: RunningTestServer,
  key: string,
): Promise<CommandVerdict[]> {
  // The plugin's own registration — the same list `GET /plugins/contributions`
  // answers with — rather than a copy here, so a command added tomorrow is in
  // this test the day it exists.
  const contribution = running.pluginService
    .listCliContributions()
    .find((entry) => entry.pluginId === "browser-tools");
  const commands = contribution?.commands ?? [];
  // A check whose evidence can be empty is not a check.
  expect(commands.length).toBeGreaterThan(40);
  const verdicts: CommandVerdict[] = [];
  for (const command of commands) {
    const response = await fetch(
      `${running.baseUrl}/api/v1/plugins/browser-tools/cli`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [PATCHER_AGENT_KEY_HEADER]: key,
        },
        body: JSON.stringify({ argv: [command.name] }),
      },
    );
    const body = JSON.stringify(await response.json());
    verdicts.push({
      name: command.name,
      body,
      verdict: body.includes("browser access grant")
        ? "gated"
        : body.includes("is refused to the browser access grant")
          ? "gated"
          : body.includes("No browser window is connected")
            ? "dispatched"
            : body.includes('"exitCode":0')
              ? "ran"
              : "refused-its-arguments",
    });
  }
  return verdicts;
}

describe("every `patcher browser` command, under the narrowest grant", () => {
  it("leaves nothing that simply runs", async () => {
    server = await startTestServer();
    await server.pluginService.install(builtinPluginSource("browser-tools"));
    // The closed default, so anything that runs did so on nobody's authority.
    expect(getAppSettings(server.deps.db).browserExternalAccess).toBe("off");
    const grant = createBrowserAccessGrant(server.deps.db, {
      label: "surface probe",
      level: "read",
    });

    const verdicts = await runEveryCommand(
      server,
      deriveAgentAccessKey({
        appApiKey: TEST_APP_API_KEY,
        grantId: grant.id,
      }),
    );

    expect(
      verdicts
        .filter((entry) => entry.verdict === "ran")
        .map((entry) => `${entry.name}: ${entry.body}`),
    ).toEqual([]);
    // Positive evidence that the probe reached the plugin at all, rather than
    // every command failing for some shared reason upstream.
    expect(verdicts.filter((entry) => entry.verdict === "gated").length).
      toBeGreaterThan(5);
    expect(
      verdicts.filter((entry) => entry.verdict === "dispatched").length,
    ).toBeGreaterThan(5);
  }, 120_000);

  it("names the one command that is not the browser at all", async () => {
    // The specific refusal, so the sentence a caller reads is pinned as well as
    // the fact that it is refused.
    server = await startTestServer();
    await server.pluginService.install(builtinPluginSource("browser-tools"));
    const grant = createBrowserAccessGrant(server.deps.db, {
      label: "Claude Code",
      level: "full",
    });

    const response = await fetch(
      `${server.baseUrl}/api/v1/plugins/browser-tools/cli`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [PATCHER_AGENT_KEY_HEADER]: deriveAgentAccessKey({
            appApiKey: TEST_APP_API_KEY,
            grantId: grant.id,
          }),
        },
        body: JSON.stringify({ argv: ["install-ffmpeg"] }),
      },
    );

    const body = (await response.json()) as { stderr?: string };
    // `full` is the top of the ramp and still does not admit it: this is not a
    // point on the ramp at all.
    expect(body.stderr).toContain("Claude Code");
    expect(body.stderr).toContain("installs software");
  }, 60_000);

  it("leaves a thread inside Patcher alone", async () => {
    // A turn's gate is the plugin toggle, which is a question about running
    // plugin code at all — and the person who answered it was told what the
    // plugin does. Refusing a turn here would take a working command away from
    // the caller the plugin was enabled for.
    //
    // A person at their own terminal *is* refused, and that is the cost of this
    // fix said plainly: with the browser closed to outside callers they install
    // ffmpeg the way they install anything else, which the refusal says.
    server = await startTestServer();
    await server.pluginService.install(builtinPluginSource("browser-tools"));
    const { host } = seedHostSession(server.deps, { id: "host-ffmpeg" });
    const { project } = seedProjectWithSource(server.deps, { hostId: host.id });
    const environment = seedEnvironment(server.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(server.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "active",
    });

    const response = await fetch(
      `${server.baseUrl}/api/v1/plugins/browser-tools/cli`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [PATCHER_THREAD_ID_HEADER]: thread.id,
          [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
            appApiKey: TEST_APP_API_KEY,
            threadId: thread.id,
          }),
        },
        body: JSON.stringify({ argv: ["install-ffmpeg"] }),
      },
    );

    const body = (await response.json()) as { stderr?: string };
    expect(body.stderr ?? "").not.toContain("is refused to");
  }, 60_000);
});
