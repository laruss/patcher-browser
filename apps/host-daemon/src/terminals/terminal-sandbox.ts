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
 * The network is not confined, and that is a decision rather than an omission.
 * A blocked connection in a terminal has nowhere to raise a prompt — nobody can
 * grant it back — so confining it would turn `npm install` and `git push` into
 * silent failures. The class this closes is the filesystem one, which is what
 * made the route a hole; `docs/security.md` says so in as many words.
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
}

export interface TerminalCommand {
  file: string;
  args: readonly string[];
}

export type TerminalSandboxLaunch =
  | { sandboxed: true; command: TerminalCommand }
  | { sandboxed: false; reason: string; remedy: string };

export interface BuildTerminalSandboxLaunchArgs {
  command: TerminalCommand;
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

function probeLinuxSandbox(helperPath: string): string | null {
  const cached = linuxSandboxProbeResults.get(helperPath);
  if (cached !== undefined) return cached;
  const result = spawnSync(
    helperPath,
    ["--ro-bind", "/", "/", "--dev-bind", "/dev", "/dev", "/bin/true"],
    { encoding: "utf8", timeout: LINUX_SANDBOX_PROBE_TIMEOUT_MS },
  );
  const failure =
    result.status === 0
      ? null
      : (result.stderr?.trim().split("\n").at(-1) ??
        result.error?.message ??
        `exited with ${String(result.status)}`);
  linuxSandboxProbeResults.set(helperPath, failure);
  return failure;
}

function resolveLinuxSandboxHelper(
  args: BuildTerminalSandboxLaunchArgs,
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

function buildSeatbeltProfile(args: BuildTerminalSandboxLaunchArgs): string {
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

function buildBubblewrapArgs(args: BuildTerminalSandboxLaunchArgs): string[] {
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
  return [
    ...bindArgs,
    "--chdir",
    resolvedPath(args.cwd),
    args.command.file,
    ...args.command.args,
  ];
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
      command: {
        file: MACOS_SANDBOX_EXECUTABLE,
        args: [
          "-p",
          buildSeatbeltProfile(args),
          args.command.file,
          ...args.command.args,
        ],
      },
    };
  }

  if (args.platform === "linux") {
    const helperPath = resolveLinuxSandboxHelper(args);
    if (helperPath === null) {
      return {
        sandboxed: false,
        reason: "this machine has no bubblewrap",
        remedy:
          "install bubblewrap, open the terminal yourself, or run the thread at Full Access",
      };
    }
    const probeFailure = probeLinuxSandbox(helperPath);
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
      command: { file: helperPath, args: buildBubblewrapArgs(args) },
    };
  }

  return {
    sandboxed: false,
    reason: `${args.platform} has no sandbox Patcher can build`,
    remedy: "open the terminal yourself, or run the thread at Full Access",
  };
}
