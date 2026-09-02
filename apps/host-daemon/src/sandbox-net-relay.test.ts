import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mirrorLoopbackSockets,
  parseSandboxNetRelayArgv,
  resolveSandboxNetRelayArgv,
  type SandboxNetRelayMirror,
} from "./sandbox-net-relay.js";

/**
 * The process that runs inside a network-confined Linux sandbox.
 *
 * The mirroring is exercised here rather than in a namespace: what it does is
 * "listen on a port, forward to a socket", and a machine with no namespace is
 * still a machine where that either works or does not. The namespace itself is
 * `terminals/terminal-sandbox.test.ts`, which builds one on Linux, and the
 * whole chain was measured end to end under bubblewrap before any of it was
 * written down.
 */

const directories: string[] = [];
const servers: net.Server[] = [];
const mirrors: SandboxNetRelayMirror[] = [];

afterEach(() => {
  for (const mirror of mirrors.splice(0)) mirror.close();
  for (const server of servers.splice(0)) server.close();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function makeSocketDir(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "patcher-relay-test-"));
  directories.push(directory);
  return directory;
}

/**
 * The daemon's side, in miniature: a socket named for a port, answering with a
 * line. The port it is named for is deliberately *not* listening here, so a
 * reply can only have come through the socket.
 */
async function placeSocket(args: {
  socketDir: string;
  port: number;
  reply: string;
}): Promise<void> {
  const server = net.createServer((socket) => socket.end(`${args.reply}\n`));
  servers.push(server);
  await new Promise<void>((resolve) =>
    server.listen(path.join(args.socketDir, `${args.port}.sock`), resolve),
  );
}

async function freePort(): Promise<number> {
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as net.AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

async function readFromPort(port: number): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1");
    let received = "";
    socket.on("data", (chunk) => {
      received += String(chunk);
    });
    socket.on("end", () => resolve(received));
    socket.on("error", reject);
  });
}

async function mirror(socketDir: string): Promise<SandboxNetRelayMirror> {
  const result = await mirrorLoopbackSockets({ socketDir });
  mirrors.push(result);
  return result;
}

describe("mirroring the daemon's sockets", () => {
  it("answers on the port each socket is named for", async () => {
    const socketDir = makeSocketDir();
    const port = await freePort();
    await placeSocket({ socketDir, port, reply: "through-the-socket" });

    await mirror(socketDir);

    expect(await readFromPort(port)).toBe("through-the-socket\n");
  });

  it("picks up a socket that appears after the command started", async () => {
    const socketDir = makeSocketDir();
    const port = await freePort();

    await mirror(socketDir);
    // An ACP agent's plugin-tool bridge binds its port when the session
    // starts, which is after the agent — and so after this — is running. A
    // relay that read the directory once would leave plugin tools dead on
    // Linux, which is why the directory is watched.
    await placeSocket({ socketDir, port, reply: "late-arrival" });

    await vi.waitFor(
      async () => {
        expect(await readFromPort(port)).toBe("late-arrival\n");
      },
      { timeout: 5_000 },
    );
  });

  it("leaves a port with no socket alone", async () => {
    const socketDir = makeSocketDir();
    const port = await freePort();

    await mirror(socketDir);

    // The directory is the whole list: nothing else on the host's loopback is
    // reachable from inside the namespace.
    await expect(readFromPort(port)).rejects.toThrow();
  });

  it("ignores a file in the directory that is not a port", async () => {
    const socketDir = makeSocketDir();
    const server = net.createServer((socket) => socket.end("nope\n"));
    servers.push(server);
    await new Promise<void>((resolve) =>
      server.listen(path.join(socketDir, "not-a-port.sock"), resolve),
    );

    const mirrored = await mirror(socketDir);

    expect(mirrored.ports).toEqual([]);
  });
});

describe("the argv the daemon builds", () => {
  it("names the entry module rather than the one the daemon imports", () => {
    const argv = resolveSandboxNetRelayArgv({ bridgeBundleDir: "/bundles" });

    // The daemon imports the module beside the entry to build this argv. If
    // the entry and the library were one file, that import would start a relay
    // inside the daemon — measured once, as the daemon exiting 64 over a
    // missing `--socket-dir`.
    expect(argv).toEqual([
      process.execPath,
      "--no-warnings",
      "/bundles/patcher-sandbox-net-relay.mjs",
    ]);
  });

  it("is read back the way it was written", () => {
    const parsed = parseSandboxNetRelayArgv([
      "--socket-dir",
      "/sockets",
      "--",
      "/bin/agent",
      "--flag",
      "value",
    ]);

    expect(parsed).toEqual({
      socketDir: "/sockets",
      command: ["/bin/agent", "--flag", "value"],
    });
  });

  it("says what is missing rather than guessing", () => {
    expect(parseSandboxNetRelayArgv(["--", "/bin/agent"])).toEqual({
      error: "missing --socket-dir",
    });
    expect(parseSandboxNetRelayArgv(["--socket-dir", "/sockets"])).toEqual({
      error: "missing the `--` before the command to run",
    });
    expect(
      parseSandboxNetRelayArgv(["--socket-dir", "/sockets", "--"]),
    ).toEqual({ error: "missing the command to run" });
  });
});
