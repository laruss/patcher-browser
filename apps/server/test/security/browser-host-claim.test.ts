import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  startTestServer,
  testAppKeyHeaders,
  type RunningTestServer,
} from "../helpers/test-app.js";

/**
 * Who gets to be the browser an agent drives.
 *
 * The socket holding that role answers every browser command the server routes
 * — the agent's tools and every plugin's `patcher.browser` call — and it used
 * to be whoever registered most recently, so any client already on `/ws` could
 * take it from the window a person was watching just by asking.
 *
 * Both sockets here present the app key, which is the honest shape and also the
 * hostile one: a local process that read `app-api-key` is not a plugin as far
 * as the upgrade can tell, and docs/security.md says so outright. What it can
 * no longer do is displace the window that has the role. The plugin half of the
 * gate — a socket that identified itself as a plugin is refused the role
 * entirely — is in test/app/client-protocol.test.ts, next to the subscribe gate
 * it mirrors.
 */

const sockets = new Set<WebSocket>();
let server: RunningTestServer | null = null;

function openRealtimeSocket(baseUrl: string): Promise<WebSocket> {
  const url = new URL("/ws", baseUrl);
  url.protocol = "ws:";
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url.href, { headers: testAppKeyHeaders() });
    sockets.add(socket);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function register(socket: WebSocket, browserHostId: string): void {
  socket.send(JSON.stringify({ type: "browser-host.register", browserHostId }));
}

/** The register message is fire-and-forget, so the assertion has to wait. */
async function waitForBrowserHost(
  running: RunningTestServer,
  expected: { browserHostId: string | null; hostCount: number },
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const snapshot = running.hub.getBrowserHostSnapshot();
    if (
      snapshot.browserHostId === expected.browserHostId &&
      snapshot.hostCount === expected.hostCount
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(running.hub.getBrowserHostSnapshot()).toMatchObject(expected);
}

afterEach(async () => {
  for (const socket of sockets) {
    socket.terminate();
  }
  sockets.clear();
  if (server !== null) {
    await server.close();
    server = null;
  }
});

describe("claiming the browser host role over the wire", () => {
  it("keeps the window that claimed first when another socket asks", async () => {
    server = await startTestServer();
    const window = await openRealtimeSocket(server.baseUrl);
    register(window, "window-a");
    await waitForBrowserHost(server, {
      browserHostId: "window-a",
      hostCount: 1,
    });

    const other = await openRealtimeSocket(server.baseUrl);
    register(other, "not-the-browser");

    // Counted, because a second honest window is promoted when the first one
    // closes — but not addressed: browser commands still go to `window-a`.
    await waitForBrowserHost(server, {
      browserHostId: "window-a",
      hostCount: 2,
    });
  });

  it("gives the role back to the window that reconnects", async () => {
    server = await startTestServer();
    const dropped = await openRealtimeSocket(server.baseUrl);
    register(dropped, "window-a");
    await waitForBrowserHost(server, {
      browserHostId: "window-a",
      hostCount: 1,
    });

    // The app re-announces after a reconnect with the id it generated for this
    // page load, and the server may not have noticed the old socket go. One
    // host, not two: the claim replaced the socket it was made on.
    const reconnected = await openRealtimeSocket(server.baseUrl);
    register(reconnected, "window-a");

    await waitForBrowserHost(server, {
      browserHostId: "window-a",
      hostCount: 1,
    });
  });
});
