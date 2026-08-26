import {
  PATCHER_APP_KEY_HEADER,
  PATCHER_APP_KEY_QUERY_PARAM,
} from "@patcher/config/app-key";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  startTestServer,
  TEST_APP_API_KEY,
  testAppKeyHeaders,
  type RunningTestServer,
} from "../helpers/test-app.js";

/**
 * The other half of the plugin permission gate: who a request is when it does
 * not present a plugin's header pair.
 *
 * It used to be "the app, the CLI, or anything else local", and a plugin
 * process holds `patcher.server.loopbackBaseUrl` — so a plugin that omitted
 * its own headers skipped the whole path→permission map. These pin the two
 * halves of the answer: anonymous is refused, and the callers that are
 * *meant* to be anonymous still are.
 */

const sockets = new Set<WebSocket>();
let server: RunningTestServer | null = null;

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  sockets.clear();
  if (server !== null) {
    await server.close();
    server = null;
  }
});

/** Resolves to the upgrade's HTTP status, or `null` if the socket opened. */
function websocketStatus(
  url: string,
  headers?: Record<string, string>,
): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, headers === undefined ? {} : { headers });
    sockets.add(socket);
    socket.once("open", () => resolve(null));
    socket.once("unexpected-response", (_request, response) => {
      const status = response.statusCode;
      response.resume();
      if (status === undefined) {
        reject(new Error("WebSocket rejection omitted an HTTP status"));
        return;
      }
      resolve(status);
    });
    socket.once("error", () => {
      // The status arrives on unexpected-response, asserted above.
    });
  });
}

function websocketUrl(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl);
  url.protocol = "ws:";
  return url.href;
}

/**
 * Over a real socket with a plain `fetch`, deliberately: that is exactly what
 * a plugin process holding `loopbackBaseUrl` has, and `harness.app` would add
 * the key for us.
 */
describe("an unidentified local request", () => {
  it("is refused rather than taken for the app", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/projects`);

    expect(response.status).toBe(401);
  });

  it("is refused when it presents the wrong key", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/projects`, {
      headers: { [PATCHER_APP_KEY_HEADER]: "not-the-key" },
    });

    expect(response.status).toBe(401);
  });

  it("is refused when its key is the right length and still wrong", async () => {
    // The comparison is `timingSafeEqual`, which throws on a length mismatch;
    // equal-length-but-wrong is the case that actually reaches it.
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/projects`, {
      headers: {
        [PATCHER_APP_KEY_HEADER]: "x".repeat(TEST_APP_API_KEY.length),
      },
    });

    expect(response.status).toBe(401);
  });
});

describe("a client that holds the key", () => {
  it("is served when it sends the header", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/api/v1/projects`, {
      headers: testAppKeyHeaders(),
    });

    expect(response.status).toBe(200);
  });

  it("is served when it can only put the key in the query", async () => {
    // `<img src>`, a download link and a websocket upgrade set no headers,
    // and the app uses all three.
    server = await startTestServer();

    const response = await fetch(
      `${server.baseUrl}/api/v1/projects?${PATCHER_APP_KEY_QUERY_PARAM}=${TEST_APP_API_KEY}`,
    );

    expect(response.status).toBe(200);
  });
});

describe("callers that are meant to reach the API without the key", () => {
  it("leaves a plugin's own HTTP routes open to third parties", async () => {
    // `auth: "none"` exists so a webhook can call a plugin. Requiring the app
    // key here would mean no plugin could ever be called from outside;
    // routes/plugins.ts is what gates these instead.
    server = await startTestServer();

    const response = await fetch(
      `${server.baseUrl}/api/v1/plugins/nobody/http/hook`,
      { method: "POST" },
    );

    expect(response.status).not.toBe(401);
  });

  it("leaves /health alone, which a launcher polls before anything exists", async () => {
    server = await startTestServer();

    const response = await fetch(`${server.baseUrl}/health`);

    expect(response.status).toBe(200);
  });
});

describe("the sockets, which the request gate never sees", () => {
  it("refuses an unidentified realtime socket", async () => {
    server = await startTestServer();

    await expect(
      websocketStatus(websocketUrl(server.baseUrl, "/ws")),
    ).resolves.toBe(401);
  });

  it("accepts a realtime socket that presents the key", async () => {
    server = await startTestServer();

    await expect(
      websocketStatus(websocketUrl(server.baseUrl, "/ws"), testAppKeyHeaders()),
    ).resolves.toBeNull();
  });

  it("accepts a realtime socket that can only present it in the query", async () => {
    server = await startTestServer();
    const url = new URL(websocketUrl(server.baseUrl, "/ws"));
    url.searchParams.set(PATCHER_APP_KEY_QUERY_PARAM, TEST_APP_API_KEY);

    await expect(websocketStatus(url.href)).resolves.toBeNull();
  });

  it("refuses an unidentified terminal socket", async () => {
    // Terminal I/O is what `/api/v1/terminals` charges `shell` for, and this
    // socket reaches the same streams without passing that map.
    server = await startTestServer();

    await expect(
      websocketStatus(websocketUrl(server.baseUrl, "/ws/terminals/whatever")),
    ).resolves.toBe(401);
  });
});
