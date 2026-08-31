import { afterEach, describe, expect, it, vi } from "vitest";
import { PATCHER_HOST_DAEMON_KEY_HEADER } from "@patcher/host-daemon-contract";

/**
 * How the app reaches the one route on a daemon that runs something.
 *
 * It used to present the app key, which is a file: absent on a machine enrolled
 * from another one — so the app was refused on the very machine it was running
 * on — and readable by a turn whose provider leaves reads open. The daemon now
 * mints its own credential per process and hands it to the server at session
 * open, and this is the seam that fetches it back and presents it.
 *
 * Worth its own tests because nothing else covers it: the daemon's tests prove
 * the gate, the server's prove the route, and neither would notice the app
 * sending the wrong header or giving up on a restarted daemon's 401.
 */

const DAEMON_PORT = 42_100;
const HOST_ID = "host-app-side";

interface DaemonCall {
  headers: Headers;
  url: string;
}

interface StubOptions {
  daemonKeys?: readonly (string | null)[];
  /** Status codes the daemon answers `open-in-target` with, in order. */
  openStatuses?: readonly number[];
}

function stubFetch(options: StubOptions = {}) {
  const daemonKeys = [...(options.daemonKeys ?? ["minted-daemon-key"])];
  const openStatuses = [...(options.openStatuses ?? [200])];
  const keyRequests: string[] = [];
  const openCalls: DaemonCall[] = [];
  const fetchStub = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url.includes("/api/v1/host-daemon-keys/")) {
        keyRequests.push(url);
        const key = daemonKeys.shift() ?? null;
        return key === null
          ? new Response(JSON.stringify({ message: "no session" }), {
              status: 404,
            })
          : Response.json({ key });
      }
      if (url.endsWith("/status")) {
        return Response.json({
          hostId: HOST_ID,
          connected: true,
          protocolVersion: 1,
          serverUrl: "http://localhost",
          supportsNativeFolderPicker: false,
          platform: "darwin",
        });
      }
      if (url.endsWith("/open-in-target")) {
        openCalls.push({ headers: new Headers(init?.headers), url });
        const status = openStatuses.shift() ?? 200;
        return new Response(status === 200 ? "{}" : "Unauthorized", { status });
      }
      throw new Error(`Unexpected request in test: ${url}`);
    },
  );
  vi.stubGlobal("fetch", fetchStub);
  return { keyRequests, openCalls };
}

async function loadModule() {
  // The key cache lives at module scope, which is the point of it — so each test
  // gets its own module instance rather than the previous test's cache.
  vi.resetModules();
  return await import("./api-host-daemon");
}

const OPEN_REQUEST = {
  context: { kind: "local" } as const,
  columnNumber: null,
  lineNumber: null,
  path: "/tmp/workspace/file.ts",
  targetId: "vscode",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("openInTarget", () => {
  it("presents the key the server holds for this machine's daemon", async () => {
    const { keyRequests, openCalls } = stubFetch();
    const { openInTarget } = await loadModule();

    await openInTarget(DAEMON_PORT, OPEN_REQUEST);

    // Asked for this machine's key by the id the daemon itself reported: the
    // port is the same number on every machine, so the host has to come from
    // whoever answered on it.
    expect(keyRequests).toEqual([
      `http://localhost/api/v1/host-daemon-keys/${HOST_ID}`,
    ]);
    expect(openCalls).toHaveLength(1);
    expect(openCalls[0]?.headers.get(PATCHER_HOST_DAEMON_KEY_HEADER)).toBe(
      "minted-daemon-key",
    );
  });

  it("refetches once when a restarted daemon refuses the cached key", async () => {
    const { keyRequests, openCalls } = stubFetch({
      daemonKeys: ["stale-key", "fresh-key"],
      openStatuses: [401, 200],
    });
    const { openInTarget } = await loadModule();

    await openInTarget(DAEMON_PORT, OPEN_REQUEST);

    expect(keyRequests).toHaveLength(2);
    expect(
      openCalls.map((call) => call.headers.get(PATCHER_HOST_DAEMON_KEY_HEADER)),
    ).toEqual(["stale-key", "fresh-key"]);
  });

  it("gives up after one refetch rather than looping", async () => {
    const { keyRequests, openCalls } = stubFetch({
      daemonKeys: ["one", "two", "three"],
      openStatuses: [401, 401],
    });
    const { openInTarget } = await loadModule();

    // The daemon's own answer, not a second refetch: what the person sees is
    // what the daemon said.
    await expect(openInTarget(DAEMON_PORT, OPEN_REQUEST)).rejects.toThrow(
      "Unauthorized",
    );
    expect(keyRequests).toHaveLength(2);
    expect(openCalls).toHaveLength(2);
  });

  it("says the machine has no session rather than calling the daemon unsigned", async () => {
    const { openCalls } = stubFetch({ daemonKeys: [null] });
    const { openInTarget } = await loadModule();

    await expect(openInTarget(DAEMON_PORT, OPEN_REQUEST)).rejects.toThrow(
      "no session open with the server",
    );
    // Not attempted without a credential: a 401 the person cannot act on is
    // worse than a message naming what is wrong.
    expect(openCalls).toEqual([]);
  });

  it("does not ask the server twice for the same machine", async () => {
    const { keyRequests } = stubFetch({
      daemonKeys: ["minted-daemon-key"],
      openStatuses: [200, 200],
    });
    const { openInTarget } = await loadModule();

    await openInTarget(DAEMON_PORT, OPEN_REQUEST);
    await openInTarget(DAEMON_PORT, OPEN_REQUEST);

    expect(keyRequests).toHaveLength(1);
  });
});
