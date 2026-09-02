import { spawnSync } from "node:child_process";
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Running a terminal inside the boundary its thread's turn runs in.
 *
 * A terminal is a PTY on the host, running as the user, and until now that was
 * the whole of it — which is why `/terminals` is refused to an agent outright:
 * a sandboxed turn that could open one had a shell with none of its own
 * restrictions. This builds the sandbox Patcher owns, rather than one a
 * provider offers, so an agent can have a terminal without that being a way
 * out of its own turn.
 *
 * The policy is the turn's, path for path: the workspace and the git roots
 * beside it are writable, the files that decide what git executes are
 * read-only, and Patcher's own credential files cannot be read. Measured on
 * both backends before it was written down — a login `zsh` on a real PTY under
 * the macOS profile, and `bwrap` in a Linux container:
 *
 * - A write inside the workspace succeeds; one outside is refused.
 * - `.git/config` still reads and no longer takes a write, while `.git/index`
 *   does, so `git add` and `git commit` keep working.
 * - A read of a credential file is refused on both: "Operation not permitted"
 *   under seatbelt, "Permission denied" under the `/dev/null` bind, which is a
 *   character device where a regular file was.
 *
 * A terminal's network is not confined, and that is a decision rather than an
 * omission. A blocked connection in a terminal has nowhere to raise a prompt —
 * nobody can grant it back — so confining it would turn `npm install` and `git
 * push` into silent failures. The class this closes for a terminal is the
 * filesystem one, which is what made the route a hole; `docs/security.md` says
 * so in as many words.
 *
 * A *provider process* can ask for more, through `egressConfined` below: there
 * the way out is a proxy Patcher runs, so a host that is not on the list is a
 * question on the thread rather than a dead end. Terminals leave it unset —
 * nothing in a terminal can raise one.
 *
 * One visible edge on macOS: a login shell cannot write the user's own
 * `~/.zsh_history`, and says so once at startup. Left alone deliberately — the
 * alternative is letting an agent's terminal append to the user's shell
 * history, and the line is a true statement about where the shell is running.
 */

/** What the terminal may touch, in the same terms the turn's sandbox uses. */
export interface TerminalSandboxPolicy {
  /** The workspace root, writable. */
  workspacePath: string;
  /** Writable paths outside the workspace — a linked worktree's git dirs. */
  writableRoots: readonly string[];
  /** Paths inside a writable root that stay readable but not writable. */
  readOnlyPaths: readonly string[];
  /** Files that must not be read at all. */
  deniedReadPaths: readonly string[];
  /**
   * Refuse every outbound connection that leaves the machine, leaving loopback
   * alone. Set for a provider process whose turn confines egress, where the
   * only way out is the proxy Patcher runs (`egress-proxy.ts`); a terminal
   * leaves it unset, for the reason in this file's header.
   *
   * Loopback stays open, and that is the decision rather than an oversight: the
   * `patcher` CLI reaches the local server over it, so does an ACP agent's
   * plugin-tool MCP server, and an agent that runs its own local server —
   * opencode does — cannot start without it. Measured: with loopback denied,
   * opencode dies on "Failed to start server on port 0". What that leaves is
   * named in `docs/security.md`: a local service that has the network of its
   * own is a way around the proxy for whoever goes looking.
   */
  egressConfined?: boolean;
  /**
   * How a Linux launch keeps that loopback, since it cannot keep it the way
   * macOS does.
   *
   * Seatbelt can deny what leaves the machine and leave localhost alone.
   * Bubblewrap cannot: `--unshare-net` is the only unprivileged way to take
   * the network and it takes the host's loopback with it. So on Linux the
   * loopback Patcher needs is carried in over bind-mounted unix sockets and
   * mirrored back onto the namespace's own loopback by a relay that runs as
   * the first process inside it (`sandbox-net-relay.ts`).
   *
   * Required for `egressConfined` on Linux and unused everywhere else — a
   * launch that confines egress without one is refused rather than started
   * with the network open.
   */
  loopbackRelay?: {
    /** `node <relay module>`, the first process inside the namespace. */
    argv: readonly string[];
    /** Directory of `<port>.sock` files, bound in read-only. */
    socketDir: string;
  };
}

export interface TerminalCommand {
  file: string;
  args: readonly string[];
}

export type TerminalSandboxLaunch =
  | { sandboxed: true; command: TerminalCommand }
  | { sandboxed: false; reason: string; remedy: string };

/**
 * The same sandbox as a launcher, for a caller that has no argv to give yet.
 *
 * `launcher.file [...launcher.args, file, ...args]` is exactly what
 * `buildTerminalSandboxLaunch` builds: the policy depends on where a process
 * runs, never on what it is. The ACP bridge is why this shape exists — it
 * appends the agent's own model and permission flags after Patcher has decided
 * whether the turn is confined, and a launcher folded into the command would
 * have taken those flags for itself.
 */
export type TerminalSandboxLauncher =
  | { sandboxed: true; launcher: TerminalCommand }
  | { sandboxed: false; reason: string; remedy: string };

export interface BuildTerminalSandboxLauncherArgs {
  cwd: string;
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  policy: TerminalSandboxPolicy;
  /**
   * Absolute `bwrap` candidates for when PATH does not name it. A test passes
   * its own; production passes nothing, because the real ones exist on the
   * machines CI runs on and a positive result there would prove nothing.
   */
  wellKnownHelperPaths?: readonly string[];
}

export interface BuildTerminalSandboxLaunchArgs extends BuildTerminalSandboxLauncherArgs {
  command: TerminalCommand;
}

const MACOS_SANDBOX_EXECUTABLE = "/usr/bin/sandbox-exec";
const LINUX_SANDBOX_HELPER_EXECUTABLE = "bwrap";
const LINUX_SANDBOX_PROBE_TIMEOUT_MS = 5_000;
const WELL_KNOWN_LINUX_SANDBOX_HELPER_PATHS: readonly string[] = [
  "/usr/bin/bwrap",
  "/bin/bwrap",
  "/usr/local/bin/bwrap",
];

/** Temp roots a shell needs to be usable at all. */
const MACOS_WRITABLE_TEMP_SUBPATHS: readonly string[] = [
  "/private/var/folders",
  "/private/tmp",
];

function isExecutableFile(candidatePath: string): boolean {
  try {
    accessSync(candidatePath, constants.X_OK);
    return statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

/**
 * Whether this machine's bubblewrap can actually build a namespace.
 *
 * Present is not the same as usable, and the difference is a whole class of
 * machine rather than a curiosity: Ubuntu 24.04 restricts unprivileged user
 * namespaces through AppArmor, so `bwrap` installs fine and then answers
 * "setting up uid map: Permission denied" for every command. Without this
 * probe Patcher would report a sandbox, open the terminal, and hand back a
 * shell that dies on its first line with a message about uid maps.
 *
 * Run once per daemon and remembered: it costs a process, and the answer
 * cannot change without a reboot.
 */
const linuxSandboxProbeResults = new Map<string, string | null>();

/**
 * `unshareNet` is probed separately rather than assumed from the rest: taking
 * the network needs a network namespace, and a machine or container that
 * forbids one would otherwise pass this probe and then fail at launch, which
 * is the failure this probe exists to move earlier.
 */
function probeLinuxSandbox(
  helperPath: string,
  options: { unshareNet: boolean },
): string | null {
  const cacheKey = `${helperPath}\u0000${String(options.unshareNet)}`;
  const cached = linuxSandboxProbeResults.get(cacheKey);
  if (cached !== undefined) return cached;
  const result = spawnSync(
    helperPath,
    [
      "--ro-bind",
      "/",
      "/",
      "--dev-bind",
      "/dev",
      "/dev",
      ...(options.unshareNet ? ["--unshare-net"] : []),
      "/bin/true",
    ],
    { encoding: "utf8", timeout: LINUX_SANDBOX_PROBE_TIMEOUT_MS },
  );
  const failure =
    result.status === 0
      ? null
      : (result.stderr?.trim().split("\n").at(-1) ??
        result.error?.message ??
        `exited with ${String(result.status)}`);
  linuxSandboxProbeResults.set(cacheKey, failure);
  return failure;
}

function resolveLinuxSandboxHelper(
  args: BuildTerminalSandboxLauncherArgs,
): string | null {
  for (const directory of (args.env.PATH ?? "").split(path.delimiter)) {
    if (directory.length === 0) continue;
    const candidate = path.join(directory, LINUX_SANDBOX_HELPER_EXECUTABLE);
    if (isExecutableFile(candidate)) return candidate;
  }
  return (
    (args.wellKnownHelperPaths ?? WELL_KNOWN_LINUX_SANDBOX_HELPER_PATHS).find(
      (candidate) => isExecutableFile(candidate),
    ) ?? null
  );
}

/**
 * The path the kernel will see, which is not always the one we were handed.
 *
 * A sandbox rule names a path, and both backends match what a lookup resolves
 * to — so a rule about `/var/folders/...` is a rule about nothing on a machine
 * where that is a symlink to `/private/var/folders/...`. Measured the hard way:
 * with the paths passed through as given, every deny in this file silently did
 * nothing while the profile still loaded and the shell still started.
 */
function resolvedPath(candidatePath: string): string {
  try {
    return realpathSync.native(candidatePath);
  } catch {
    // A path that is not there yet is named as given: it cannot be resolved,
    // and dropping it would quietly widen the policy.
    return candidatePath;
  }
}

function resolvedPaths(candidatePaths: readonly string[]): string[] {
  return candidatePaths.map(resolvedPath);
}

function pathExists(candidatePath: string): boolean {
  try {
    statSync(candidatePath);
    return true;
  } catch {
    return false;
  }
}

/** Seatbelt takes a quoted string, so a path with a quote in it must survive. */
function quoteForSeatbelt(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function buildSeatbeltProfile(args: BuildTerminalSandboxLauncherArgs): string {
  const writable = resolvedPaths([
    args.policy.workspacePath,
    ...args.policy.writableRoots,
    ...MACOS_WRITABLE_TEMP_SUBPATHS,
    ...(args.env.TMPDIR ? [args.env.TMPDIR] : []),
  ]);
  return [
    "(version 1)",
    // Reads and everything else stay as they are: this confines writes and the
    // named files, and nothing else. A deny-by-default profile would be a
    // different feature, and one no shell survives without a much longer list.
    "(allow default)",
    '(deny file-write* (subpath "/"))',
    ...writable.map(
      (writablePath) =>
        `(allow file-write* (subpath ${quoteForSeatbelt(writablePath)}))`,
    ),
    // The shell's own terminal, and the sinks every command writes to.
    '(allow file-write* (regex #"^/dev/ttys[0-9]+$"))',
    '(allow file-write-data (literal "/dev/null") (literal "/dev/zero") (literal "/dev/tty") (literal "/dev/stdout") (literal "/dev/stderr"))',
    // Egress, when the policy asks for it: everything off the machine is
    // refused, loopback in every direction is not. Measured under this profile —
    // a direct `https://example.com` cannot even resolve a name, while the same
    // request through a loopback proxy answers 200, and `CONNECT` carries the
    // hostname so nothing has to terminate TLS to read it.
    ...(args.policy.egressConfined === true
      ? [
          "(deny network*)",
          '(allow network-outbound (remote ip "localhost:*"))',
          '(allow network-bind (local ip "localhost:*"))',
          '(allow network-inbound (local ip "localhost:*"))',
        ]
      : []),
    // After the allows: a rule later in the profile wins, and these sit inside
    // the workspace the line above just made writable.
    ...resolvedPaths(args.policy.readOnlyPaths).map(
      (readOnlyPath) =>
        `(deny file-write* (subpath ${quoteForSeatbelt(readOnlyPath)}))`,
    ),
    ...resolvedPaths(args.policy.deniedReadPaths).map(
      (deniedPath) =>
        `(deny file-read* (subpath ${quoteForSeatbelt(deniedPath)}))`,
    ),
  ].join("\n");
}

function buildBubblewrapArgs(args: BuildTerminalSandboxLauncherArgs): string[] {
  const bindArgs: string[] = [
    // Everything readable, nothing writable, and then the exceptions: bwrap
    // applies binds in order, so each one below overrides the root above it.
    "--ro-bind",
    "/",
    "/",
    "--dev-bind",
    "/dev",
    "/dev",
    "--proc",
    "/proc",
  ];
  for (const writablePath of resolvedPaths([
    args.policy.workspacePath,
    ...args.policy.writableRoots,
    "/tmp",
    ...(args.env.TMPDIR ? [args.env.TMPDIR] : []),
  ])) {
    if (!pathExists(writablePath)) continue;
    bindArgs.push("--bind-try", writablePath, writablePath);
  }
  for (const readOnlyPath of resolvedPaths(args.policy.readOnlyPaths)) {
    if (!pathExists(readOnlyPath)) continue;
    bindArgs.push("--ro-bind-try", readOnlyPath, readOnlyPath);
  }
  for (const deniedPath of resolvedPaths(args.policy.deniedReadPaths)) {
    // Only what is there: binding over a path that does not exist asks bwrap
    // to create it on a read-only root, which fails the whole launch.
    if (!pathExists(deniedPath)) continue;
    bindArgs.push("--bind", "/dev/null", deniedPath);
  }
  const relay = args.policy.loopbackRelay;
  if (args.policy.egressConfined === true && relay !== undefined) {
    // Read-only: connecting to a unix socket through a read-only bind works
    // — measured — so the sandbox can reach the sockets the daemon put there
    // and cannot add one of its own for the relay to mirror.
    bindArgs.push(
      "--ro-bind",
      relay.socketDir,
      relay.socketDir,
      "--unshare-net",
    );
  }
  const bwrapArgs = [...bindArgs, "--chdir", resolvedPath(args.cwd)];
  if (args.policy.egressConfined !== true || relay === undefined) {
    return bwrapArgs;
  }
  // The relay is the first process inside the namespace and the command is
  // appended after its `--`, so it ends up running the launch it wrapped.
  return [...bwrapArgs, ...relay.argv, "--socket-dir", relay.socketDir, "--"];
}

/**
 * The command that runs the terminal inside the policy, or why it cannot.
 *
 * Refusing beats starting: a terminal that presents as sandboxed and is not is
 * the silence this whole boundary exists to remove, so the caller is told what
 * is missing and what to do instead.
 */
export function buildTerminalSandboxLaunch(
  args: BuildTerminalSandboxLaunchArgs,
): TerminalSandboxLaunch {
  const built = buildTerminalSandboxLauncher(args);
  if (!built.sandboxed) return built;
  return {
    sandboxed: true,
    command: {
      file: built.launcher.file,
      args: [...built.launcher.args, args.command.file, ...args.command.args],
    },
  };
}

/** The launcher half of the above; see `TerminalSandboxLauncher`. */
export function buildTerminalSandboxLauncher(
  args: BuildTerminalSandboxLauncherArgs,
): TerminalSandboxLauncher {
  if (args.platform === "darwin") {
    if (!isExecutableFile(MACOS_SANDBOX_EXECUTABLE)) {
      return {
        sandboxed: false,
        reason: `this machine has no ${MACOS_SANDBOX_EXECUTABLE}`,
        remedy: "open the terminal yourself, or run the thread at Full Access",
      };
    }
    return {
      sandboxed: true,
      launcher: {
        file: MACOS_SANDBOX_EXECUTABLE,
        args: ["-p", buildSeatbeltProfile(args)],
      },
    };
  }

  if (args.platform === "linux") {
    const confinesEgress = args.policy.egressConfined === true;
    if (confinesEgress && args.policy.loopbackRelay === undefined) {
      // Bubblewrap can only take the network by taking the whole network
      // namespace, and that takes the host's loopback with it — the proxy that
      // is the turn's one way out included. A launch that wants egress
      // confined on Linux has to carry the relay that gives that loopback
      // back; a terminal never does, for the reason in this file's header.
      return {
        sandboxed: false,
        reason:
          "confining the network on Linux takes the whole network namespace, " +
          "and this launch carries no relay for the loopback that goes with it",
        remedy:
          'turn off Settings → General → "Confine the network of sandboxed turns", or run the thread at Full Access',
      };
    }
    const helperPath = resolveLinuxSandboxHelper(args);
    if (helperPath === null) {
      return {
        sandboxed: false,
        reason: "this machine has no bubblewrap",
        remedy:
          "install bubblewrap, open the terminal yourself, or run the thread at Full Access",
      };
    }
    const probeFailure = probeLinuxSandbox(helperPath, {
      unshareNet: confinesEgress,
    });
    if (probeFailure !== null) {
      return {
        sandboxed: false,
        reason: `this machine has bubblewrap at ${helperPath} but cannot build a sandbox with it (${probeFailure})`,
        remedy:
          "allow unprivileged user namespaces on this machine, open the terminal yourself, or run the thread at Full Access",
      };
    }
    return {
      sandboxed: true,
      launcher: { file: helperPath, args: buildBubblewrapArgs(args) },
    };
  }

  return {
    sandboxed: false,
    reason: `${args.platform} has no sandbox Patcher can build`,
    remedy: "open the terminal yourself, or run the thread at Full Access",
  };
}
