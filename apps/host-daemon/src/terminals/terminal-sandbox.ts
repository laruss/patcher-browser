import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  lstatSync,
  realpathSync,
  statSync,
} from "node:fs";
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

/**
 * Both names a policy path can be known by, because a rule about one is not a
 * rule about the other.
 *
 * `resolvedPath` above exists because a rule has to name what a lookup lands
 * on. But a *symlink* has two names — its own and its target's — and only the
 * second is what a write goes through. Deny the target alone and the link
 * itself is an ordinary entry in a writable directory: measured on a checkout
 * whose `.git/config` was a symlink, a write through it was refused and
 * `rm .git/config` then `printf '[core] fsmonitor = …' > .git/config` was not,
 * leaving the daemon's git reading the turn's own file. Naming both closes it —
 * measured on the same layout, `rm` and `mv` of the link both refused, while an
 * unrelated symlink in the same directory can still be made.
 *
 * Seatbelt takes both. Bubblewrap cannot: a mount resolves its destination, so
 * a bind for the link's name lands on the target and leaves the name free —
 * `buildTerminalSandboxLauncher` refuses the launch there instead.
 */
function policyPathForms(candidatePaths: readonly string[]): string[] {
  const forms = new Set<string>();
  for (const candidatePath of candidatePaths) {
    forms.add(path.resolve(candidatePath));
    forms.add(resolvedPath(candidatePath));
  }
  return [...forms];
}

/** A path whose own last component is a symlink, if the list holds one. */
function findSymlinkedPath(candidatePaths: readonly string[]): string | null {
  for (const candidatePath of candidatePaths) {
    try {
      if (lstatSync(candidatePath).isSymbolicLink()) return candidatePath;
    } catch {
      // Not there is not a symlink, and a path that is not there is handled by
      // the `/dev/null` bind below.
    }
  }
  return null;
}

/**
 * Whether `candidatePath` sits at or under `root`, both already resolved.
 *
 * The test is on path *segments*, not on the string: `..` and anything under
 * `../` step outside, while `..projects` is an ordinary name that happens to
 * start with two dots. Reading the prefix alone called such a directory
 * outside its own parent, and this answer decides which entries get a rename
 * rule — so with a workspace at `<tmp>/..projects/wt` the workspace itself was
 * left unprotected and `mv wt wtx` put `core.fsmonitor` back in reach.
 * Measured, on the profile this module builds.
 */
function isInside(candidatePath: string, root: string): boolean {
  const relative = path.relative(root, candidatePath);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function pathExists(candidatePath: string): boolean {
  try {
    statSync(candidatePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * The directory entries on the way to a protected path, which have to be
 * nailed down as well as the path itself.
 *
 * Every rule in this file names a path, and a path is a name in a directory: a
 * deny on `<ws>/.git/config` is a deny on that *name*, not on that file. `.git`
 * sits in the workspace a turn may write, so `mv .git .gitx`, an edit, and
 * `mv .gitx .git` puts the config back where it was with the rule stepped over.
 * Measured on both backends, with the argv this module builds: a direct write
 * to `.git/config` is refused and the same write through the rename is rc 0,
 * ending with `core.fsmonitor` in the real file and a hook in `.git/hooks` —
 * which the daemon's own git then runs, outside the sandbox, as the user.
 *
 * So each directory between a writable root and a protected path is protected
 * as an entry rather than as a subtree: the name may not be renamed or
 * unlinked, while writes *inside* it stay allowed. That distinction is the
 * whole reason this is separate from `readOnlyPaths` — `.git` denied as a
 * subtree takes `index.lock` with it, and a turn that cannot write that cannot
 * `git add` its own work.
 *
 * An entry is reachable for a rename exactly when its parent is writable, which
 * is what the walk asks. That answers both layouts the issue named without
 * either being special-cased: `.git` and `.git/info` in a plain checkout, and
 * the workspace directory itself wherever it sits under `/tmp` or `$TMPDIR`,
 * where renaming the workspace moves a linked worktree's `.git` pointer file
 * out from under its rule the same way.
 */
function resolveProtectedEntryPaths(
  protectedPaths: readonly string[],
  writablePaths: readonly string[],
): string[] {
  const entries = new Set<string>();
  for (const protectedPath of protectedPaths) {
    let candidate = path.dirname(protectedPath);
    while (candidate !== path.dirname(candidate)) {
      const parent = path.dirname(candidate);
      if (writablePaths.some((root) => isInside(parent, root))) {
        entries.add(candidate);
      }
      candidate = parent;
    }
  }
  // Sorted so a parent is always named before its own children: on bubblewrap
  // these become mounts, and a mount applied later would hide the ones already
  // made underneath it.
  return [...entries].sort();
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
    //
    // The entry denies come first because they are the coarser statement: a
    // `literal` names the directory and nothing under it, so `.git` cannot be
    // renamed or unlinked while `.git/index.lock` is still written. Measured:
    // with these in the profile `mv .git .gitx` and `mv <ws> <ws>x` are both
    // "Operation not permitted", and `git add`, `commit`, `status` and
    // `checkout -b` all still succeed.
    ...resolveProtectedEntryPaths(
      policyPathForms(args.policy.readOnlyPaths),
      policyPathForms([
        args.policy.workspacePath,
        ...args.policy.writableRoots,
        ...MACOS_WRITABLE_TEMP_SUBPATHS,
        ...(args.env.TMPDIR ? [args.env.TMPDIR] : []),
      ]),
    ).map(
      (entryPath) =>
        `(deny file-write* (literal ${quoteForSeatbelt(entryPath)}))`,
    ),
    // Both names, for the reason in `policyPathForms`: the target is what a
    // write goes through, the link is what a `rm` and a `mv` act on. A form
    // the kernel never sees is a rule that never matches, which costs a line.
    ...policyPathForms(args.policy.readOnlyPaths).map(
      (readOnlyPath) =>
        `(deny file-write* (subpath ${quoteForSeatbelt(readOnlyPath)}))`,
    ),
    ...resolvedPaths(args.policy.deniedReadPaths).map(
      (deniedPath) =>
        `(deny file-read* (subpath ${quoteForSeatbelt(deniedPath)}))`,
    ),
  ].join("\n");
}

/** The roots a Linux launch makes writable, before they are resolved. */
function linuxWritablePaths(args: BuildTerminalSandboxLauncherArgs): string[] {
  return [
    args.policy.workspacePath,
    ...args.policy.writableRoots,
    "/tmp",
    ...(args.env.TMPDIR ? [args.env.TMPDIR] : []),
  ];
}

/**
 * A protected path bubblewrap cannot hold by name, if this policy has one.
 *
 * Every rule this backend makes is a mount, and a mount resolves its
 * destination — so a bind for a symlink's own name lands on the target and
 * leaves the name an ordinary entry in a writable directory. Measured: with
 * `.git/config` a symlink, binding both the target and the link still left
 * `rm .git/config` working, and `ls` inside the sandbox showed the link
 * untouched. Seatbelt takes a rule about the name and this cannot, so the
 * honest answer here is to refuse the launch rather than build a boundary that
 * is a name short — the same answer this module already gives a machine with no
 * bubblewrap.
 *
 * Narrow on purpose: only the protected paths themselves and the directory
 * entries on the way to them, and only when the entry *is* a link. A workspace
 * reached through a symlinked ancestor is not this — there the rule and the
 * kernel agree on one name — and a linked worktree's `.git` is a regular file,
 * so the layout Patcher runs by default never meets this.
 */
function findUnbindableProtectedPath(
  args: BuildTerminalSandboxLauncherArgs,
): string | null {
  const writableForms = policyPathForms(linuxWritablePaths(args));
  const protectedForms = policyPathForms(args.policy.readOnlyPaths);
  return findSymlinkedPath([
    // Only where the link could actually be replaced, which is where its
    // parent is writable. A linked worktree's common `.git` sits in the source
    // repository, outside every writable root — measured there, `rm` and `mv`
    // on a symlinked `config` both answer "Read-only file system", so refusing
    // that launch would cost the turn its terminal and buy nothing.
    ...protectedForms.filter((protectedPath) =>
      writableForms.some((root) => isInside(path.dirname(protectedPath), root)),
    ),
    // The entries are already only the ones with a writable parent — that is
    // the question the walk asks to collect them at all.
    ...resolveProtectedEntryPaths(protectedForms, writableForms),
  ]);
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
  const writablePaths = resolvedPaths(linuxWritablePaths(args));
  const boundWritablePaths = new Set<string>();
  for (const writablePath of writablePaths) {
    if (!pathExists(writablePath)) continue;
    bindArgs.push("--bind-try", writablePath, writablePath);
    boundWritablePaths.add(writablePath);
  }
  // Before the read-only binds, and that order is the point: each of these
  // mounts a directory onto itself so `rename()` on it answers EBUSY, and a
  // mount made here after the rules underneath it would hide them instead.
  // Measured in a Debian container under unprivileged `bwrap`: without them
  // `mv .git .gitx && mkdir .git && cp -a .gitx/. .git/` writes both the
  // config and a hook, visible on the host; with them the rename is refused
  // and `git add`, `commit`, `status` and `checkout -b` still succeed.
  for (const entryPath of resolveProtectedEntryPaths(
    resolvedPaths(args.policy.readOnlyPaths),
    writablePaths,
  )) {
    // A writable root that was bound above is already a mount point and
    // already answers EBUSY — this is what keeps the workspace directory from
    // being bound twice. Asking the set of binds actually emitted rather than
    // the list they were drawn from, because that loop skips a root that is
    // not there: the `/dev/null` bind below would then create the directory
    // with no mount on it, which is the one case this `continue` must not
    // cover.
    if (boundWritablePaths.has(entryPath)) continue;
    if (pathExists(entryPath)) {
      bindArgs.push("--bind", entryPath, entryPath);
      continue;
    }
    // A directory a turn deleted before this launch — `.git/info` is writable,
    // so that is a state a turn can arrange. `--bind` has no source to take,
    // and skipping it would hand the next turn the same rename back, because
    // the loop below is about to create the path underneath it anyway. An
    // empty tmpfs is what git already reads a missing `.git/info` as, and it
    // is a mount point, so the rename is refused. Measured with `.git/info`
    // deleted first: the rename refused, `git add` and `commit` still fine,
    // and nothing written inside it left on the host — the cost is the same
    // empty entry the bind below already leaves, a directory instead of a
    // file.
    bindArgs.push("--tmpfs", entryPath);
  }
  for (const readOnlyPath of resolvedPaths(args.policy.readOnlyPaths)) {
    if (pathExists(readOnlyPath)) {
      bindArgs.push("--ro-bind-try", readOnlyPath, readOnlyPath);
      continue;
    }
    // A protected path that does not exist yet is a path the turn can still
    // create, and this backend has no rule about a name — only about a mount.
    // Seatbelt denies a path whether or not anything is there, so skipping it
    // here made the same list mean two different things: measured on a linked
    // worktree, `info/attributes` and `config.worktree` were refused on macOS
    // and written on Linux, because a fresh repository has neither.
    //
    // Only when the parent is writable, and that is not tidiness: with a
    // read-only parent bwrap cannot create the mount point and fails the whole
    // launch — while a turn could not have created the file either, so there
    // is nothing to deny. The cost where it does apply is an empty file left
    // in the repository: git reads all four of these as absent when empty, and
    // a file where `hooks` would be is the same "no hooks" a missing directory
    // already means.
    if (writablePaths.some((root) => isInside(readOnlyPath, root))) {
      bindArgs.push("--ro-bind", "/dev/null", readOnlyPath);
    }
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
    const unbindablePath = findUnbindableProtectedPath(args);
    if (unbindablePath !== null) {
      return {
        sandboxed: false,
        reason:
          `${unbindablePath} is a symbolic link, and this backend confines a path ` +
          "by mounting over it — a mount follows the link, so the link's own name would stay writable",
        remedy: `replace ${unbindablePath} with a regular file or directory, or run the thread at Full Access`,
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
