import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { deriveAgentAccessKey } from "@patcher/config/agent-access-key";
import { deriveThreadTurnApiKey } from "@patcher/config/thread-api-key";
import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import {
  createBrowserAccessGrant,
  getAppSettings,
  setAppSettings,
} from "@patcher/db";
import {
  PATCHER_AGENT_KEY_HEADER,
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
  type BrowserCommandRequestSignal,
} from "@patcher/server-contract";
import { builtinPluginSource } from "../../src/services/plugins/builtin-registry.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";
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
 * What the window is told about who is driving it.
 *
 * Read off the socket rather than off the bridge, because the field only does
 * its job if it survives the whole path: the route decides it, an ambient scope
 * carries it past the plugin surface, the bridge attaches it, and the hub
 * serializes it. Each of those is a place it could be dropped without a
 * typecheck noticing — the wire schema makes it optional, so *omitting* it is
 * always valid.
 *
 * A stand-in browser host is registered on the hub for each case, so these are
 * commands that really were dispatched. Everywhere else in this suite a
 * `patcher browser` command dies on "No browser window is connected", which is
 * exactly the point at which the issuer would never be looked at.
 */

let server: RunningTestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** The signal the window received, and the answer it gave back. */
async function driveBrowser(
  running: RunningTestServer,
  headers: Record<string, string>,
): Promise<BrowserCommandRequestSignal> {
  const socket = createMockHubSocket();
  running.hub.registerClient(socket);
  running.hub.registerBrowserHost(socket, {
    browserHostId: "window-under-test",
  });

  const pending = fetch(`${running.baseUrl}/api/v1/plugins/browser-tools/cli`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ argv: ["tabs"] }),
  });

  const signal = await waitForBrowserRequest(socket.messages);
  running.hub.recordBrowserCommandResponse({
    socket,
    message: {
      type: "browser-command.response",
      requestId: signal.requestId,
      outcome: { ok: true, value: { type: "tabs", tabs: [] } },
    },
  });
  const body = (await (await pending).json()) as { exitCode?: number };
  // The command has to have got through, or "no issuer" would be the trivially
  // passing answer to every case below.
  expect(body.exitCode).toBe(0);
  return signal;
}

async function waitForBrowserRequest(
  messages: readonly string[],
): Promise<BrowserCommandRequestSignal> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    for (const raw of messages) {
      const parsed = JSON.parse(raw) as { type?: string };
      if (parsed.type === "browser-command-request") {
        return parsed as BrowserCommandRequestSignal;
      }
    }
    await sleep(25);
  }
  throw new Error("the window was never asked to run a browser command");
}

async function serveBrowser(): Promise<RunningTestServer> {
  const running = await startTestServer();
  await running.pluginService.install(builtinPluginSource("browser-tools"));
  return running;
}

describe("the command a browser window is asked to run", () => {
  it("names the grant that issued it, and what that grant may do", async () => {
    server = await serveBrowser();
    const grant = createBrowserAccessGrant(server.deps.db, {
      label: "Claude Code",
      level: "read",
    });

    const signal = await driveBrowser(server, {
      [PATCHER_AGENT_KEY_HEADER]: deriveAgentAccessKey({
        appApiKey: TEST_APP_API_KEY,
        grantId: grant.id,
      }),
    });

    // The label is the whole point: it is the only name a person ever gave any
    // of this, and the indicator has nothing else to draw.
    expect(signal.issuer).toEqual({
      kind: "grant",
      grantId: grant.id,
      label: "Claude Code",
      level: "read",
    });
  }, 60_000);

  it("says only that a caller outside Patcher issued it", async () => {
    // A terminal holding the app key is exactly as identified as the app key
    // is. Naming it would be an invention, so the wire says the true thing and
    // stops.
    server = await serveBrowser();
    setAppSettings(server.deps.db, {
      ...getAppSettings(server.deps.db),
      browserExternalAccess: "read",
    });

    const signal = await driveBrowser(server, {
      [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY,
    });

    expect(signal.issuer).toEqual({ kind: "outside" });
  }, 60_000);

  it("names the thread when a turn inside Patcher issued it", async () => {
    server = await serveBrowser();
    const { host } = seedHostSession(server.deps, { id: "host-issuer" });
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

    const signal = await driveBrowser(server, {
      [PATCHER_THREAD_ID_HEADER]: thread.id,
      [PATCHER_THREAD_KEY_HEADER]: deriveThreadTurnApiKey({
        appApiKey: TEST_APP_API_KEY,
        threadId: thread.id,
      }),
    });

    expect(signal.issuer).toEqual({ kind: "thread", threadId: thread.id });
  }, 60_000);

  it("takes the thread from the credential, not from the body", async () => {
    // The body's `threadId` is what a plugin CLI context reports, and any
    // holder of the app key can write it. If the indicator read that, the name
    // in the chrome would be whatever the caller typed — the same argument the
    // access gate makes one field over.
    server = await serveBrowser();
    setAppSettings(server.deps.db, {
      ...getAppSettings(server.deps.db),
      browserExternalAccess: "read",
    });
    const socket = createMockHubSocket();
    server.hub.registerClient(socket);
    server.hub.registerBrowserHost(socket, { browserHostId: "window-claim" });

    const pending = fetch(
      `${server.baseUrl}/api/v1/plugins/browser-tools/cli`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [PATCHER_APP_KEY_HEADER]: TEST_APP_API_KEY,
        },
        body: JSON.stringify({
          argv: ["tabs"],
          threadId: "thread-i-am-not",
        }),
      },
    );
    const signal = await waitForBrowserRequest(socket.messages);
    server.hub.recordBrowserCommandResponse({
      socket,
      message: {
        type: "browser-command.response",
        requestId: signal.requestId,
        outcome: { ok: true, value: { type: "tabs", tabs: [] } },
      },
    });
    await pending;

    expect(signal.issuer).toEqual({ kind: "outside" });
  }, 60_000);
});
