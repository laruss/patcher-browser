import { afterEach, describe, expect, it, vi } from "vitest";
import { upsertHost } from "@patcher/db";
import { permissionsForApiPath } from "@patcher/domain";
import { deriveThreadApiKey } from "@patcher/config/thread-api-key";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  createHostDaemonClient,
} from "@patcher/host-daemon-contract";
import {
  PATCHER_THREAD_ID_HEADER,
  PATCHER_THREAD_KEY_HEADER,
} from "@patcher/server-contract";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import {
  appFetch,
  createTestDaemonHostKey,
  startTestServer,
  TEST_APP_API_KEY,
  type RunningTestServer,
} from "../helpers/test-app.js";

/**
 * The credential a machine's own daemon API takes, and who may read it.
 *
 * The daemon's loopback API has one route that runs something — an `execFile` on
 * the host, outside the sandbox of whatever turn is running. It used to take the
 * app key, which was the wrong credential in both directions: a machine enrolled
 * from another one has no app key file, so the app was refused on the machine it
 * was running on; and the key is a file, so a turn whose provider leaves reads
 * open could read it and present it.
 *
 * So the daemon mints its own per process, sends it when it opens a session, and
 * the server hands it to the app from memory. What has to be true of it: it
 * arrives, it goes away with the session, it survives the reconnect that
 * replaces the socket, and only the app can read it.
 */

let server: RunningTestServer | null = null;

afterEach(async () => {
  if (server !== null) {
    await server.close();
    server = null;
  }
});

const HOST_ID = "host-daemon-key";
const DAEMON_LOCAL_API_KEY = "daemon-minted-local-api-key";

async function openDaemonSession(
  running: RunningTestServer,
  args: { localApiKey?: string } = {},
): Promise<string> {
  upsertHost(running.db, running.hub, {
    id: HOST_ID,
    name: "Key Host",
    type: "persistent",
  });
  const daemonClient = createHostDaemonClient(
    running.baseUrl,
    createTestDaemonHostKey({ hostId: HOST_ID }),
  );
  const response = await daemonClient.session.open.$post({
    json: {
      hostId: HOST_ID,
      instanceId: "instance-1",
      hostName: "Key Host",
      hostType: "persistent",
      platform: "darwin",
      dataDir: "/tmp/host-daemon-key-data",
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      ...(args.localApiKey === undefined
        ? {}
        : { localApiKey: args.localApiKey }),
      activeThreads: [],
    },
  });
  expect(response.status).toBe(201);
  const session = (await response.json()) as { sessionId: string };
  return session.sessionId;
}

function keyRequest(
  running: RunningTestServer,
  init?: RequestInit,
): Promise<Response> {
  return appFetch(
    `${running.baseUrl}/api/v1/host-daemon-keys/${HOST_ID}`,
    init,
  );
}

describe("the key a machine's daemon expects", () => {
  it("reaches the app once the daemon has opened its session", async () => {
    server = await startTestServer();
    await openDaemonSession(server, { localApiKey: DAEMON_LOCAL_API_KEY });

    const response = await keyRequest(server);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      key: DAEMON_LOCAL_API_KEY,
    });
  });

  it("is not there for a machine with no session open", async () => {
    server = await startTestServer();
    upsertHost(server.db, server.hub, {
      id: HOST_ID,
      name: "Key Host",
      type: "persistent",
    });

    const response = await keyRequest(server);

    // A 404 rather than an empty answer: the app should say the machine is not
    // connected, not that opening a file failed for no reason.
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("no daemon session open");
  });

  it("is forgotten when the daemon's session ends", async () => {
    server = await startTestServer();
    const sessionId = await openDaemonSession(server, {
      localApiKey: DAEMON_LOCAL_API_KEY,
    });
    server.hub.registerDaemon(sessionId, HOST_ID, {
      close: vi.fn(() => {}),
      send: vi.fn(() => {}),
    });

    server.hub.unregisterDaemon(sessionId);

    expect((await keyRequest(server)).status).toBe(404);
  });

  it("survives the reconnect that replaces the socket", async () => {
    // The order a restarting daemon does it in: the new session records its key
    // first, and only then is the old socket unregistered. Forgetting on any
    // unregister would drop the live credential and leave the app refused until
    // the next restart.
    server = await startTestServer();
    const firstSessionId = await openDaemonSession(server, {
      localApiKey: "first-daemon-key",
    });
    server.hub.registerDaemon(firstSessionId, HOST_ID, {
      close: vi.fn(() => {}),
      send: vi.fn(() => {}),
    });
    const secondSessionId = await openDaemonSession(server, {
      localApiKey: "second-daemon-key",
    });
    expect(secondSessionId).not.toBe(firstSessionId);

    server.hub.unregisterDaemon(firstSessionId);

    await expect(keyRequest(server).then((res) => res.json())).resolves.toEqual(
      {
        key: "second-daemon-key",
      },
    );
  });

  it("is not sent by a daemon that runs no local API", async () => {
    server = await startTestServer();
    await openDaemonSession(server);

    expect((await keyRequest(server)).status).toBe(404);
  });
});

describe("who may read it", () => {
  it("refuses an agent mid-turn, on a read", async () => {
    // The one read on this API a turn may not make: reads are otherwise left
    // open on purpose, and this one answers with a way out of the turn rather
    // than with information about it.
    server = await startTestServer();
    await openDaemonSession(server, { localApiKey: DAEMON_LOCAL_API_KEY });
    const { host } = seedHostSession(server.deps, { id: "host-thread-side" });
    const { project } = seedProjectWithSource(server.deps, { hostId: host.id });
    const environment = seedEnvironment(server.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(server.deps, {
      environmentId: environment.id,
      projectId: project.id,
    });

    const response = await keyRequest(server, {
      headers: {
        [PATCHER_THREAD_ID_HEADER]: thread.id,
        [PATCHER_THREAD_KEY_HEADER]: deriveThreadApiKey({
          appApiKey: TEST_APP_API_KEY,
          threadId: thread.id,
        }),
      },
    });

    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain("GET /host-daemon-keys/");
    expect(body).toContain("outside this turn's sandbox");
  });

  it("refuses a plugin by being on a path the permission map does not price", async () => {
    // Not an accident of naming: the plugin gate refuses a path it cannot
    // classify, and that is why this route is its own family rather than a
    // sub-route of `/hosts`, which costs `workspace` and would hand the
    // credential to any plugin declaring it.
    expect(permissionsForApiPath(`/host-daemon-keys/${HOST_ID}`)).toBeNull();
    expect(permissionsForApiPath("/hosts/host-1")).toEqual(["workspace"]);
  });
});
