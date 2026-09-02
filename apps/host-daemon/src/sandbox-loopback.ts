import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * The daemon's side of the loopback a `--unshare-net` turn cannot keep.
 *
 * One directory, one unix socket per port, each forwarding to `127.0.0.1` on
 * this machine. The sandbox gets the directory bind-mounted read-only and
 * `sandbox-net-relay.ts` mirrors what it finds there onto the namespace's own
 * loopback, which is why the naming is a convention rather than a protocol:
 * the file name *is* the port.
 *
 * Three decisions worth stating, because each of them bounds what a confined
 * turn can reach:
 *
 * - **Only listed ports.** A confined Linux turn reaches the local server, the
 *   daemon, an ACP agent's plugin-tool bridge and the egress proxy — and
 *   nothing else on loopback. That is narrower than the macOS profile, which
 *   allows the whole of localhost because seatbelt has no way to say "these
 *   four ports". A local service of the user's own is therefore reachable from
 *   a confined turn on macOS and not on Linux; `docs/security.md` says so.
 * - **Read-only for the sandbox.** Connecting to a unix socket through a
 *   read-only bind works — measured — so the mount is `--ro-bind` and a
 *   confined process cannot drop a socket of its own in and have the relay
 *   mirror it.
 * - **Nothing new is exposed.** Every socket here forwards to a port this
 *   user's processes can already reach directly, so the directory is opened
 *   whether or not any turn confines its network, exactly as the egress proxy
 *   listens whether or not any turn uses it. What it adds is reachability from
 *   inside a namespace, not reachability for the machine.
 */
export interface SandboxLoopbackOptions {
  /** Reported rather than thrown: a socket dying is not a reason to fail a turn. */
  onError?: (message: string) => void;
}

export class SandboxLoopback {
  private directory: string | undefined;
  private readonly servers = new Map<number, net.Server>();
  private opening: Promise<string> | undefined;

  constructor(private readonly options: SandboxLoopbackOptions = {}) {}

  /** The directory to bind into a sandbox, once `open` has made one. */
  get socketDir(): string | undefined {
    return this.directory;
  }

  /**
   * Ensures the directory exists and holds a socket for each port. Idempotent,
   * and safe to call concurrently: environments are created in parallel, and
   * two callers past a plain guard would each make a directory, with the
   * loser's sockets left listening for the daemon's life.
   */
  async open(ports: readonly number[]): Promise<string> {
    this.opening ??= this.makeDirectory();
    const directory = await this.opening;
    await Promise.all(ports.map((port) => this.expose(directory, port)));
    return directory;
  }

  async close(): Promise<void> {
    const directory = this.directory;
    this.directory = undefined;
    this.opening = undefined;
    await Promise.all(
      [...this.servers.values()].map(
        (server) => new Promise<void>((resolve) => server.close(() => resolve())),
      ),
    );
    this.servers.clear();
    if (directory !== undefined) {
      rmSync(directory, { force: true, recursive: true });
    }
  }

  private async makeDirectory(): Promise<string> {
    // Under the temp root rather than the data directory, for the length: a
    // unix socket path is capped at ~104 bytes by the kernel, and a data
    // directory under a long `$HOME` would spend most of that before the port.
    // Created rather than reused, with random bytes in the name, so the daemon
    // never inherits a directory another process made.
    const directory = path.join(
      os.tmpdir(),
      `patcher-sandbox-${process.pid}-${randomBytes(4).toString("hex")}`,
    );
    mkdirSync(directory, { mode: 0o700 });
    this.directory = directory;
    return directory;
  }

  private async expose(directory: string, port: number): Promise<void> {
    if (this.servers.has(port)) return;
    const socketPath = path.join(directory, `${port}.sock`);
    const server = net.createServer((client) => {
      const upstream = net.connect(port, "127.0.0.1");
      client.pipe(upstream);
      upstream.pipe(client);
      const drop = (): void => {
        client.destroy();
        upstream.destroy();
      };
      client.on("error", drop);
      upstream.on("error", drop);
      client.on("close", drop);
      upstream.on("close", drop);
    });
    this.servers.set(port, server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => {
        server.removeListener("error", reject);
        server.on("error", (error) => this.options.onError?.(error.message));
        resolve();
      });
    }).catch((error: unknown) => {
      this.servers.delete(port);
      throw error;
    });
    server.unref();
  }
}
