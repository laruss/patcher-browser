import { existsSync, statSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxLoopback } from "./sandbox-loopback.js";

/**
 * The daemon's side of the loopback a `--unshare-net` turn cannot keep.
 *
 * Measured over real sockets rather than asserted on a plan: the whole thing is
 * a claim about what a unix socket forwards to, and a mock of a socket would
 * only restate the claim. What is not here is the sandbox — that is
 * `terminals/terminal-sandbox.test.ts`, which runs one on Linux.
 */

const bridges: SandboxLoopback[] = [];
const servers: net.Server[] = [];

afterEach(async () => {
  for (const bridge of bridges.splice(0)) await bridge.close();
  for (const server of servers.splice(0)) server.close();
});

function open(): SandboxLoopback {
  const bridge = new SandboxLoopback();
  bridges.push(bridge);
  return bridge;
}

/** A loopback service that answers with a line naming itself. */
async function startService(name: string): Promise<number> {
  const server = net.createServer((socket) => socket.end(`${name}\n`));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

/** What the relay inside the namespace does: dial the socket, read the reply. */
async function readThroughSocket(socketPath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = net.connect(socketPath);
    let received = "";
    socket.on("data", (chunk) => {
      received += String(chunk);
    });
    socket.on("end", () => resolve(received));
    socket.on("error", reject);
  });
}

describe("a port the daemon exposes", () => {
  it("is reachable through a socket named after it", async () => {
    const port = await startService("the-local-server");
    const bridge = open();

    const socketDir = await bridge.open([port]);

    expect(await readThroughSocket(path.join(socketDir, `${port}.sock`))).toBe(
      "the-local-server\n",
    );
  });

  it("is the only port with a socket, so the rest stay unreachable", async () => {
    const exposed = await startService("exposed");
    const withheld = await startService("withheld");
    const bridge = open();

    const socketDir = await bridge.open([exposed]);

    // The list is the boundary: the relay mirrors what it finds here, so a
    // port with no socket is a port a confined turn cannot reach. This is what
    // makes Linux narrower than the macOS profile, which allows all of
    // localhost because seatbelt cannot name ports.
    expect(existsSync(path.join(socketDir, `${exposed}.sock`))).toBe(true);
    expect(existsSync(path.join(socketDir, `${withheld}.sock`))).toBe(false);
  });

  it("is added to a directory that already exists, without a second one", async () => {
    const first = await startService("first");
    const second = await startService("second");
    const bridge = open();

    const socketDir = await bridge.open([first]);
    const again = await bridge.open([second]);

    expect(again).toBe(socketDir);
    expect(await readThroughSocket(path.join(socketDir, `${second}.sock`))).toBe(
      "second\n",
    );
  });

  it("opens one directory however many environments ask at once", async () => {
    const port = await startService("shared");
    const bridge = open();

    // Environments are created concurrently, and two callers past a plain
    // guard would each make a directory — with the loser's sockets listening
    // for the daemon's life and its directory never removed.
    const [a, b, c] = await Promise.all([
      bridge.open([port]),
      bridge.open([port]),
      bridge.open([port]),
    ]);

    expect(b).toBe(a);
    expect(c).toBe(a);
  });
});

describe("the directory itself", () => {
  it("is readable by nobody else", async () => {
    const bridge = open();

    const socketDir = await bridge.open([]);

    // It sits under the temp root, which is world-writable, so the mode is
    // what keeps another account on the machine out of it.
    expect(statSync(socketDir).mode & 0o777).toBe(0o700);
  });

  it("is gone once the daemon is", async () => {
    const port = await startService("gone");
    const bridge = open();
    const socketDir = await bridge.open([port]);

    await bridge.close();

    expect(existsSync(socketDir)).toBe(false);
  });
});
