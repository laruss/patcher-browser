import { spawn } from "node:child_process";
import { readdirSync, watch } from "node:fs";
import net from "node:net";
import { constants } from "node:os";
import path from "node:path";
import { resolveBridgeProcessArgs } from "@patcher/agent-runtime/shared/bridge-path";

/**
 * The loopback a network-confined Linux turn would otherwise lose.
 *
 * On macOS the boundary is a seatbelt profile that denies what leaves the
 * machine and leaves loopback alone, so the proxy on 127.0.0.1 stays reachable
 * and nothing else is needed. Linux has no such rule available to an
 * unprivileged process: bubblewrap's `--unshare-net` is the only way to take
 * the network, and it takes the host's loopback with it — the namespace gets a
 * fresh one. Measured on bubblewrap 0.8.0 in a container: inside such a
 * namespace `lo` is up with `127.0.0.1/8` and `::1`, a connection off the
 * machine is refused in 0 ms both by name and by literal IP, and the host's own
 * loopback services answer nothing at all.
 *
 * Which is the whole problem: the ways *into* Patcher are loopback ports — the
 * local server the `patcher` CLI calls, the daemon's own port, an ACP agent's
 * plugin-tool bridge — and so is the proxy that is the turn's one way out. A
 * turn confined by `--unshare-net` alone is not confined, it is severed.
 *
 * So this runs as the first process inside the namespace and mirrors, onto the
 * namespace's own loopback, exactly the ports the daemon put a unix socket in
 * the shared directory for. A bind-mounted unix socket does cross into the
 * namespace — measured, and it crosses through a **read-only** bind, so the
 * directory is mounted `--ro-bind` and a confined process cannot add a channel
 * of its own to it. What the turn reaches is then that list and nothing else,
 * which is narrower than the whole of loopback macOS allows.
 *
 * Three things measured about the process shape, each now a line below:
 *
 * - **The directory is watched, not only read.** An ACP agent's plugin-tool
 *   bridge binds its port when the session starts, which is after the agent —
 *   and therefore this — is already running. Its socket appears late, and a
 *   relay that only read the directory once would leave plugin tools dead on
 *   Linux.
 * - **The command's exit status is this process's.** Measured through both
 *   hops: a command that exits 5 arrives as 5, one killed by `SIGTERM` as 143,
 *   and a command that is not there as 126 with a line saying which.
 * - **Signals are forwarded**, though bubblewrap does not forward them itself:
 *   with and without this relay in between, a `SIGTERM` to `bwrap` never
 *   reaches the command. That is unchanged either way, and forwarding is what
 *   keeps this process from being the reason a turn's own stop does not land.
 *
 * One accident worth keeping: mirroring the *same* port numbers the host uses
 * means that without a network namespace there is nothing to mirror them onto.
 * Measured by taking `--unshare-net` back out — the first listen answered
 * `EADDRINUSE 127.0.0.1:<proxy port>`, because that is the host's own proxy,
 * and this process refused the launch instead of running it with the network
 * open. A boundary that fails loudly is the one failure mode to prefer.
 */

const SOCKET_DIR_FLAG = "--socket-dir";
const RELAY_BUNDLE_FILE_NAME = "patcher-sandbox-net-relay.mjs";
/**
 * The entry, which is deliberately not this file.
 *
 * The daemon imports this module for {@link resolveSandboxNetRelayArgv}, so
 * anything here that ran on import would run in the daemon: bundled, the two
 * share one file, `import.meta.url` and `process.argv[1]` are both the
 * daemon's bundle, and a "am I the main module" guard answers yes. Measured
 * the hard way — the daemon exited 64 complaining about a missing
 * `--socket-dir` — so the process that runs is `sandbox-net-relay-entry.ts`,
 * which nothing imports.
 */
const RELAY_ENTRY_SOURCE_PATH = "./sandbox-net-relay-entry.js";

/** `<port>.sock` — the daemon's side of one mirrored port. */
function portOfSocketFileName(fileName: string): number | undefined {
  const match = /^(\d+)\.sock$/u.exec(fileName);
  if (match?.[1] === undefined) return undefined;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined;
}

/**
 * How the daemon spawns this: `node <relay> --socket-dir <dir> -- <command>`.
 *
 * Resolved the way the provider bridges are, so a bundled daemon points at its
 * bundle and a source checkout runs the TypeScript through tsx.
 */
export function resolveSandboxNetRelayArgv(args: {
  bridgeBundleDir?: string | undefined;
}): string[] {
  return [
    process.execPath,
    // This process inherits the confined environment it is about to pass on,
    // and `NODE_USE_ENV_PROXY` makes Node announce its own proxy support as
    // experimental on stderr — measured, once per launch, into the stream the
    // bridge reads an agent's diagnostics from. A CLI flag suppresses it here
    // without reaching the command, which an environment variable could not
    // do, and it silences `emitWarning` rather than this relay's own writes.
    "--no-warnings",
    ...resolveBridgeProcessArgs({
      importMetaUrl: import.meta.url,
      bridgeRelativePath: RELAY_ENTRY_SOURCE_PATH,
      ...(args.bridgeBundleDir !== undefined
        ? { bridgeBundleDir: args.bridgeBundleDir }
        : {}),
      bundleFileName: RELAY_BUNDLE_FILE_NAME,
    }),
  ];
}

export interface SandboxNetRelayInvocation {
  socketDir: string;
  command: readonly string[];
}

/** The argv this process was given, or why it cannot be honored. */
export function parseSandboxNetRelayArgv(
  argv: readonly string[],
): SandboxNetRelayInvocation | { error: string } {
  const flagIndex = argv.indexOf(SOCKET_DIR_FLAG);
  const socketDir = flagIndex < 0 ? undefined : argv[flagIndex + 1];
  if (socketDir === undefined || socketDir === "") {
    return { error: `missing ${SOCKET_DIR_FLAG}` };
  }
  const separator = argv.indexOf("--", flagIndex + 2);
  if (separator < 0) {
    return { error: "missing the `--` before the command to run" };
  }
  const command = argv.slice(separator + 1);
  if (command.length === 0 || command[0] === undefined) {
    return { error: "missing the command to run" };
  }
  return { socketDir, command };
}

function pipeBothWays(client: net.Socket, upstream: net.Socket): void {
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
}

export interface SandboxNetRelayMirror {
  /** Ports listening on the namespace's loopback, newest last. */
  ports: number[];
  close: () => void;
}

/**
 * Mirrors every socket in `socketDir` onto the loopback of whatever network
 * namespace this process is in, and keeps mirroring ones that appear later.
 */
export async function mirrorLoopbackSockets(args: {
  socketDir: string;
  onLate?: (port: number) => void;
  onError?: (message: string) => void;
}): Promise<SandboxNetRelayMirror> {
  const servers = new Map<number, net.Server>();

  const mirror = (port: number): Promise<void> => {
    // Guarded before the listen rather than after: a directory watch reports
    // one created socket more than once, and two listens on one port is at
    // best a wasted server.
    if (servers.has(port)) return Promise.resolve();
    const socketPath = path.join(args.socketDir, `${port}.sock`);
    const server = net.createServer((client) => {
      pipeBothWays(client, net.connect(socketPath));
    });
    servers.set(port, server);
    return new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        server.on("error", (error) => args.onError?.(error.message));
        resolve();
      });
    });
  };

  const initial = readdirSync(args.socketDir)
    .map(portOfSocketFileName)
    .filter((port): port is number => port !== undefined);
  // Awaited before the command runs: an agent that connects the instant it
  // starts must not race the boundary's only way out.
  await Promise.all(initial.map(mirror));

  const watcher = watch(args.socketDir, (_event, fileName) => {
    const port = fileName === null ? undefined : portOfSocketFileName(fileName);
    if (port === undefined || servers.has(port)) return;
    void mirror(port).then(
      () => args.onLate?.(port),
      (error: unknown) => {
        servers.delete(port);
        args.onError?.(
          `could not mirror port ${port}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    );
  });
  watcher.on("error", (error) => args.onError?.(error.message));

  return {
    ports: [...servers.keys()],
    close: () => {
      watcher.close();
      for (const server of servers.values()) server.close();
      servers.clear();
    },
  };
}

const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGTERM",
  "SIGINT",
  "SIGHUP",
];

/** Mirrors the loopback, then becomes the command it was put in front of. */
export async function runSandboxNetRelay(
  argv: readonly string[],
): Promise<void> {
  const invocation = parseSandboxNetRelayArgv(argv);
  if ("error" in invocation) {
    process.stderr.write(`patcher sandbox net relay: ${invocation.error}\n`);
    process.exit(64);
  }

  try {
    await mirrorLoopbackSockets({
      socketDir: invocation.socketDir,
      onError: (message) => {
        process.stderr.write(`patcher sandbox net relay: ${message}\n`);
      },
    });
  } catch (error) {
    // Refusing to run beats running with a boundary that half exists: the
    // command would present as confined while reaching neither its model nor
    // Patcher, and the failure would arrive as the agent's own timeout.
    process.stderr.write(
      `patcher sandbox net relay: could not open the loopback this turn needs (${
        error instanceof Error ? error.message : String(error)
      })\n`,
    );
    process.exit(69);
  }

  const [file, ...args] = invocation.command;
  if (file === undefined) {
    process.stderr.write("patcher sandbox net relay: no command to run\n");
    process.exit(64);
  }
  const child = spawn(file, args, { stdio: "inherit" });
  for (const signal of FORWARDED_SIGNALS) {
    process.on(signal, () => {
      child.kill(signal);
    });
  }
  child.on("error", (error) => {
    process.stderr.write(
      `patcher sandbox net relay: could not run ${String(file)} (${error.message})\n`,
    );
    process.exit(126);
  });
  child.on("exit", (code, signal) => {
    // `128 + signum`, the way a shell reports it, rather than a flat 128: this
    // process stands in for the command, so what the daemon reads about how it
    // ended has to be about the command and not about the relay.
    if (signal === null) {
      process.exit(code ?? 1);
    }
    process.exit(128 + (constants.signals[signal] ?? 0));
  });
}
