import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * A stable path to this install's `patcher`, for a caller that is not a turn.
 *
 * A turn's shell is handed the CLI twice over: the daemon prepends
 * `PATCHER_CLI_DIR` to its PATH and sets `PATCHER_CLI` to the absolute path
 * (`runtime-shell-env.ts`). Nothing does either for an agent running *outside*
 * Patcher — Claude Code, Codex, or a person at their own terminal — and the
 * binary those would need is buried: measured on 2026-09-05 on a machine with
 * Patcher installed, `which patcher` answered nothing while the executable sat
 * at `/Applications/Patcher.app/Contents/Resources/app.asar.unpacked/`
 * `node_modules/patcher-app/host-daemon/dist/patcher`. That path is not one
 * anybody can be told to remember, and it is not even the same path in a dev
 * checkout or an `npx patcher-app` install.
 *
 * So the daemon writes a shim here at startup. `<dataDir>/bin/patcher` is the
 * same path across restarts, upgrades and all three installation shapes, which
 * is what makes it something a document — or a skill an agent reads — can name.
 *
 * **A shim, not a copy or a symlink.** A copy would go stale on the next
 * upgrade. A symlink would be resolved by `import.meta.url` and not by
 * `process.argv[1]`, which is the exact disagreement that has already cost this
 * repo a release script that exited 0 having done nothing. A two-line `sh`
 * script that `exec`s the real path keeps `argv[0]` honest and re-reads nothing.
 *
 * **It carries the install it belongs to, and that is half the point.** A shim
 * that only `exec`s the binary hands the CLI whatever environment the caller's
 * shell had — which for an agent outside Patcher is nothing, so the CLI falls
 * back to the production defaults: `127.0.0.1:38986` and `~/.patcher`. On a
 * source checkout, whose server is on a port derived from the checkout path, or
 * on a daemon pointed at a non-default server, that is a *different install*.
 * The command then reports "Patcher is not running" while Patcher is running.
 * Found by review on 2026-09-05, and it had been invisible because every
 * by-hand check of this feature exported `PATCHER_SERVER_URL` and
 * `PATCHER_DATA_DIR` itself and so never met the case it was testing.
 *
 * **Not the app key, though.** The data directory is enough — the CLI reads the
 * key out of it exactly as it always has — and inlining a credential into a
 * `0755` script to save one file read would be a worse trade than the one the
 * key file already makes.
 *
 * **It is not a PATH entry.** Writing to a user's shell rc file is not this
 * program's business, so the shim is written and the line to add is *shown*.
 * An agent handed the absolute path needs no PATH at all, which is the case
 * this exists for.
 */

/** The directory the shim lives in, under the data dir. */
export const PATCHER_CLI_SHIM_DIR_NAME = "bin";

/** What the shim is called. Matches the binary it stands in for. */
export const PATCHER_CLI_SHIM_FILE_NAME = "patcher";

/** Where this install's shim is, given its data directory. */
export function resolveCliShimPath(dataDir: string): string {
  return join(dataDir, PATCHER_CLI_SHIM_DIR_NAME, PATCHER_CLI_SHIM_FILE_NAME);
}

/** The directory to put on PATH to get `patcher`. */
export function resolveCliShimDir(dataDir: string): string {
  return join(dataDir, PATCHER_CLI_SHIM_DIR_NAME);
}

/** Which install the shim points a bare `patcher` at. */
export interface CliShimTarget {
  /** This install's server, e.g. `http://127.0.0.1:38986`. */
  serverUrl: string;
  /** Its data directory — where the CLI finds the app key for itself. */
  dataDir: string;
  /** The daemon's own local API port, when it serves one. */
  hostDaemonPort?: number;
}

/**
 * One value as a single-quoted `sh` word.
 *
 * A data directory can contain a space, and in principle a quote; `'` is closed,
 * escaped and reopened, which is the only construct `sh` gives for it.
 */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * `VAR` exported only when the caller has not set it.
 *
 * `${VAR+set}` is the test rather than `${VAR:-…}`, because the two disagree on
 * the case that matters: an empty `PATCHER_SERVER_URL` is a caller saying
 * "none", and `:-` would quietly overrule them.
 */
function exportUnlessSet(name: string, value: string): string {
  return `[ -n "\${${name}+set}" ] || export ${name}=${shellQuote(value)}`;
}

/**
 * The shim's body.
 *
 * `exec` rather than a call, so signals and the exit code belong to the CLI
 * rather than to a wrapper standing between it and the shell. `"$@"` quoted, so
 * an argument with a space in it — `patcher browser fill e3 "two words"` — is
 * still one argument on the other side.
 */
export function cliShimContents(
  executablePath: string,
  target: CliShimTarget,
): string {
  const exports = [
    exportUnlessSet("PATCHER_SERVER_URL", target.serverUrl),
    exportUnlessSet("PATCHER_DATA_DIR", target.dataDir),
    ...(target.hostDaemonPort === undefined
      ? []
      : [
          exportUnlessSet(
            "PATCHER_HOST_DAEMON_PORT",
            String(target.hostDaemonPort),
          ),
        ]),
  ];
  return `#!/bin/sh
# Written by Patcher's host daemon. Points at this install's CLI and server.
# Add this directory to PATH to get \`patcher\`, or call this file directly.
# Anything already set in your environment wins, so you can target another install.
${exports.join("\n")}
exec ${shellQuote(executablePath)} "$@"
`;
}

export interface WriteCliShimArgs {
  dataDir: string;
  /** Absolute path to the real CLI entry, already checked for existence. */
  executablePath: string;
  /** The install the shim points at. */
  target: CliShimTarget;
  /** Defaults to this process's platform; the shim is POSIX `sh`. */
  platform?: NodeJS.Platform;
}

export type WriteCliShimResult =
  | { outcome: "written"; path: string }
  | { outcome: "unchanged"; path: string }
  | { outcome: "skipped"; reason: "windows" }
  | { outcome: "failed"; error: unknown };

/**
 * Put the shim in place, or leave it alone when it already says the right
 * thing.
 *
 * Rewriting an identical file on every daemon start would churn its mtime for
 * nothing, and the answer this returns is what the caller logs — so "unchanged"
 * and "written" are told apart rather than collapsed into a bare success. The
 * comparison is over the whole body, so a server that moved rewrites it.
 *
 * Failure is a result rather than a throw. The daemon that calls this has a job
 * to get on with, and a machine whose data dir is read-only should lose the
 * convenience rather than the daemon.
 */
export async function writeCliShim(
  args: WriteCliShimArgs,
): Promise<WriteCliShimResult> {
  const platform = args.platform ?? process.platform;
  if (platform === "win32") {
    // Windows is a supported product path only through WSL2, which is Linux.
    return { outcome: "skipped", reason: "windows" };
  }
  const path = resolveCliShimPath(args.dataDir);
  const contents = cliShimContents(args.executablePath, args.target);
  try {
    const existing = await readFile(path, "utf8").catch(() => null);
    if (existing === contents) {
      // The mode is re-applied even so: a file restored from a backup, or
      // copied out of a synced folder, arrives without the execute bit and
      // then fails as "command not found" rather than as "not executable".
      await chmod(path, 0o755);
      return { outcome: "unchanged", path };
    }
    await mkdir(resolveCliShimDir(args.dataDir), { recursive: true });
    await writeFile(path, contents, { mode: 0o755 });
    // `writeFile`'s `mode` applies only when it creates the file, so an
    // overwrite of an existing shim would keep whatever mode that one had.
    await chmod(path, 0o755);
    return { outcome: "written", path };
  } catch (error) {
    return { outcome: "failed", error };
  }
}
