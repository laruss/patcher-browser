import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readlink,
  realpath,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PATCHER_CLI_SHIM_DIR_NAME,
  PATCHER_CLI_SHIM_FILE_NAME,
  resolveCliShimDir,
  resolveCliShimPath,
} from "@patcher/config/cli-shim";
import {
  PATCHER_DEV_DATA_ROOT_DIR,
  PATCHER_PROD_DATA_DIR_NAME,
} from "@patcher/config/runtime";
import type { HostCliCommandResult } from "@patcher/host-daemon-contract";

/**
 * A bare `patcher`, for a person at their own terminal.
 *
 * The daemon already writes `<dataDir>/bin/patcher` at every start, and that
 * path is what documents and skills name. What it has never done is make the
 * *word* `patcher` work, because writing into somebody's shell rc file is not
 * this program's business. This is the line between the two: a symlink named
 * `patcher`, in a directory the person's login shell **already** has on its
 * PATH. Nothing is added to PATH; an existing entry is used or the answer is
 * "here is the line to add".
 *
 * **A symlink is safe here, and was not for the CLI itself.** `cli-shim.ts`
 * rejected one because `import.meta.url` is symlink-resolved while
 * `process.argv[1]` is not, which is a disagreement about the *JS entry*. The
 * shim is `sh` that `exec`s an absolute path and reads nothing about its own
 * location, so a link pointing at it inherits none of that. The link target is
 * written absolute for the same reason — a relative one would depend on where
 * the link sits, which is the way to reintroduce exactly that problem.
 *
 * **What it will not do.** It never replaces a `patcher` it did not put there.
 * A file, a directory, or a link into something else stays, and the state says
 * so: a link somebody tied on purpose outranks this convenience, and from the
 * outside a deliberate one cannot be told from a leftover. The single exception
 * is a link that **does not resolve** and whose target has one of this
 * product's two default data-directory shapes — that one serves nobody, and
 * this feature is what creates it (delete a checkout and the link we placed
 * dangles). Without that exception the person is left with a dead command and
 * no button. A dangling link into a data directory moved with
 * `PATCHER_DATA_DIR` is not matched and stays `occupied`: the shape is the only
 * evidence there is of whose link it was, and a custom path has none.
 *
 * **Nothing removes it.** Uninstalling Patcher leaves the link dangling, the
 * same way it leaves the data directory. Worth knowing before adding a cleanup
 * that would have to guess at who owns the name.
 *
 * Whether a *source checkout* may own the bare command is product policy, and
 * lives on the server (invariant 3). This file answers only host facts, so a
 * daemon asked the question answers it the same way wherever it runs.
 */

/**
 * Where a link may go, in the order it is preferred.
 *
 * Both are conventional user bin directories. `~/.local/bin` comes first
 * because it is the one a modern stock setup is likelier to have on PATH — on
 * macOS neither is there by default, while Debian's `.profile` adds `~/bin`
 * only `if [ -d "$HOME/bin" ]`, which is why a machine with neither can answer
 * `not_on_path` even though creating `~/bin` would work after a re-login. That
 * is deliberate: this never edits a profile, so it can only use a directory
 * PATH already names.
 */
const CANDIDATE_DIRECTORY_NAMES: readonly string[] = [
  path.join(".local", "bin"),
  "bin",
];

export interface CliCommandOptions {
  dataDir: string;
  /**
   * The login shell's PATH, or null when it could not be read. Null is
   * answered with `unknown` rather than `not_on_path`: the daemon's own
   * environment is launchd's, not a shell's, and guessing from it would report
   * a measurement nobody made.
   */
  userShellPath: string | null;
  /** Defaults to this host's home directory; injected by tests. */
  homeDir?: string;
  /** Defaults to this process's platform; injected by tests. */
  platform?: NodeJS.Platform;
}

/** A PATH entry as a comparable absolute directory. Never `realpath`: the directory may not exist yet. */
function normalizeDirectory(entry: string): string {
  return path.resolve(entry);
}

/**
 * The PATH entries in order, dropping the empty ones POSIX reads as the working
 * directory. Only ever a POSIX PATH: Windows is answered before this is called.
 */
function pathEntries(userShellPath: string): string[] {
  return userShellPath
    .split(":")
    .filter((entry) => entry.length > 0)
    .map(normalizeDirectory);
}

/**
 * Whether a link target looks like some Patcher install's shim —
 * `<home>/.patcher/bin/patcher` or `<home>/.patcher-dev/<instance>/bin/patcher`.
 *
 * A shape test rather than a record, and only ever applied to a target that
 * **does not resolve**. A dangling link proves it serves nobody, which is the
 * whole licence to replace it; a live link is left alone whatever its shape.
 */
function isPatcherShimShape(target: string, homeDir: string): boolean {
  const resolved = path.resolve(target);
  if (path.basename(resolved) !== PATCHER_CLI_SHIM_FILE_NAME) return false;
  const binDirectory = path.dirname(resolved);
  if (path.basename(binDirectory) !== PATCHER_CLI_SHIM_DIR_NAME) return false;
  const dataDirectory = path.dirname(binDirectory);
  if (dataDirectory === path.join(homeDir, PATCHER_PROD_DATA_DIR_NAME)) {
    return true;
  }
  return (
    path.dirname(dataDirectory) ===
    path.join(homeDir, PATCHER_DEV_DATA_ROOT_DIR)
  );
}

/** What is at a path right now, without following a link. */
async function readEntry(
  entryPath: string,
): Promise<{ isSymbolicLink: boolean; target: string | null } | null> {
  const info = await lstat(entryPath).catch(() => null);
  if (info === null) return null;
  if (!info.isSymbolicLink()) return { isSymbolicLink: false, target: null };
  const target = await readlink(entryPath).catch(() => null);
  return { isSymbolicLink: true, target };
}

/** Whether a path resolves to something that exists, following links. */
async function resolves(entryPath: string): Promise<boolean> {
  return (await stat(entryPath).catch(() => null)) !== null;
}

/**
 * Whether a shell would run this path: a regular file with an execute bit,
 * links followed. Existing is not enough — a directory of that name, or a file
 * restored from a backup without its mode, is found by a lookup and then not
 * run, which is the difference between `installed` and a command that fails.
 */
async function isRunnableFile(entryPath: string): Promise<boolean> {
  const target = await stat(entryPath).catch(() => null);
  return target !== null && target.isFile() && (target.mode & 0o111) !== 0;
}

/** Whether two paths are the same file once links are followed. */
async function samePath(left: string, right: string): Promise<boolean> {
  const [leftReal, rightReal] = await Promise.all([
    realpath(left).catch(() => null),
    realpath(right).catch(() => null),
  ]);
  return leftReal !== null && leftReal === rightReal;
}

interface Placement {
  linkPath: string;
  directory: string;
  entries: string[];
  index: number;
}

/** The directory this install would use, or null when PATH names none of them. */
function resolvePlacement(args: {
  entries: string[];
  homeDir: string;
}): Placement | null {
  for (const name of CANDIDATE_DIRECTORY_NAMES) {
    const directory = normalizeDirectory(path.join(args.homeDir, name));
    const index = args.entries.indexOf(directory);
    if (index === -1) continue;
    return {
      directory,
      entries: args.entries,
      index,
      linkPath: path.join(directory, PATCHER_CLI_SHIM_FILE_NAME),
    };
  }
  return null;
}

/**
 * A `patcher` on an **earlier** PATH entry than the one we would write to.
 *
 * Without this, placing a link and reporting "installed" would be a claim
 * rather than a measurement: an `npm i -g patcher-app` puts a `patcher` in a
 * directory that usually sits ahead of `~/.local/bin`, and the person's shell
 * would keep answering with that one. Reported, never resolved — reordering
 * somebody's PATH is not this program's business either.
 */
async function findRunnableCommand(
  entries: readonly string[],
): Promise<{ path: string; target: string | null } | null> {
  for (const entry of entries) {
    const candidate = path.join(entry, PATCHER_CLI_SHIM_FILE_NAME);
    // What a shell would actually run, not merely what exists: a directory, a
    // dangling link or a file with no execute bit is skipped by the lookup.
    // Treating one of those as the winner would refuse the install over
    // something that answers nothing — the opposite of what this is for.
    if (!(await isRunnableFile(candidate))) continue;
    const found = await readEntry(candidate);
    return { path: candidate, target: found?.target ?? null };
  }
  return null;
}

/** The `patcher` that would answer ahead of the directory this would write to. */
async function findShadow(
  placement: Placement,
): Promise<{ path: string; target: string | null } | null> {
  return findRunnableCommand(placement.entries.slice(0, placement.index));
}

function baseResult(shimDirectory: string): HostCliCommandResult {
  return {
    state: "missing",
    linkPath: null,
    existingPath: null,
    existingTarget: null,
    shimDirectory,
    reason: null,
    message: null,
    changed: false,
  };
}

/**
 * Where a bare `patcher` stands on this host, and — when `write` is set — a
 * link placed so that it stands somewhere better.
 *
 * One function for both commands so the read cannot drift from what the write
 * would do: the status read is this with every write skipped.
 */
async function resolveCliCommand(
  options: CliCommandOptions,
  write: boolean,
): Promise<HostCliCommandResult> {
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const shimDirectory = resolveCliShimDir(options.dataDir);
  const shimPath = resolveCliShimPath(options.dataDir);
  const result = baseResult(shimDirectory);

  if (platform === "win32") {
    // The shim itself is never written on Windows, so there is nothing to
    // point a link at. Answered before anything is read.
    return { ...result, state: "unsupported", reason: "windows" };
  }
  if (options.userShellPath === null) {
    return { ...result, state: "unknown" };
  }
  if (!(await isRunnableFile(shimPath))) {
    // A data directory too locked down for `writeCliShim` has no shim — or has
    // something there a shell cannot run — and every answer below would be
    // about a link to it: `patcher` would be found and then fail. Asked before
    // anything else, because a link this install already placed is in exactly
    // that state and calling it `installed` is the lie this is here to prevent.
    return {
      ...result,
      state: "failed",
      message: `This install's ${PATCHER_CLI_SHIM_FILE_NAME} shim is not runnable at ${shimPath}.`,
    };
  }

  const entries = pathEntries(options.userShellPath);
  const placement = resolvePlacement({ entries, homeDir });
  if (placement === null) {
    // Neither candidate directory is on PATH — but before saying so, look at
    // what `patcher` already answers. Somebody who followed the documented
    // fallback and put `<dataDir>/bin` on PATH themselves already has the
    // command, and telling them again to add a line they have added is the
    // kind of claim this file exists to avoid.
    const runnable = await findRunnableCommand(entries);
    if (runnable !== null && (await samePath(runnable.path, shimPath))) {
      return {
        ...result,
        state: "installed",
        existingPath: runnable.path,
        existingTarget: runnable.target,
      };
    }
    // The answer is the line to add, which the caller composes from
    // `shimDirectory` — that works with no link at all.
    return { ...result, state: "not_on_path" };
  }

  const linkPath = placement.linkPath;
  const existing = await readEntry(linkPath);
  const isOurs =
    existing?.isSymbolicLink === true &&
    // Not only the link text: one written relative, or through a home that is
    // itself a link, runs this install just as well and is ours to leave alone.
    (existing.target === shimPath || (await samePath(linkPath, shimPath)));
  const isDanglingPatcherLink =
    existing?.isSymbolicLink === true &&
    existing.target !== null &&
    isPatcherShimShape(existing.target, homeDir) &&
    !(await resolves(linkPath));

  const shadow = await findShadow(placement);
  if (shadow !== null && (await samePath(shadow.path, shimPath))) {
    // An earlier entry already answers with this install's own shim — the
    // person put `<dataDir>/bin` on PATH themselves. The command works whatever
    // sits in the candidate directory, so this is `installed` rather than a
    // complaint about a name there would be no need to write. Asked before the
    // candidate is judged, because the shell asks in that order too.
    return {
      ...result,
      state: "installed",
      linkPath,
      existingPath: shadow.path,
      existingTarget: shadow.target,
    };
  }

  if (existing !== null && !isOurs && !isDanglingPatcherLink) {
    return {
      ...result,
      state: "occupied",
      linkPath,
      existingPath: linkPath,
      existingTarget: existing.target,
    };
  }

  if (shadow !== null) {
    return {
      ...result,
      state: "shadowed",
      linkPath,
      existingPath: shadow.path,
      existingTarget: shadow.target,
    };
  }

  if (isOurs) {
    return {
      ...result,
      state: "installed",
      linkPath,
      existingPath: linkPath,
      existingTarget: shimPath,
    };
  }

  if (!write) {
    // Nothing is in the way. A dangling link of ours counts as nothing, and is
    // reported through `existingPath` rather than through a state that would
    // claim it still works.
    return {
      ...result,
      state: "missing",
      linkPath,
      existingPath: existing === null ? null : linkPath,
      existingTarget: existing?.target ?? null,
    };
  }

  try {
    await mkdir(placement.directory, { recursive: true });
    if (existing === null) {
      // Nothing was there when it was looked at. A plain `symlink` refuses
      // with `EEXIST` if something arrived in between, which is the answer
      // this wants: a name this install did not place is never replaced, and a
      // staged `rename` would have overwritten it without noticing.
      await symlink(shimPath, linkPath);
    } else {
      // Replacing our own dangling link. Staged and renamed rather than
      // unlinked and recreated: `rename` over an existing name is atomic, so a
      // shell looking one up sees the old link or the new one and never a
      // moment with neither.
      // A nonce, not just the pid: two installs handled at once by this same
      // daemon would otherwise share the name, and the `finally` of one would
      // delete the other's staging entry and fail a caller that asked for
      // exactly what it got.
      const staging = `${linkPath}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
      try {
        await symlink(shimPath, staging);
        await rename(staging, linkPath);
      } finally {
        await rm(staging, { force: true });
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const raced = await readEntry(linkPath);
      if (raced?.target === shimPath || (await samePath(linkPath, shimPath))) {
        // Another install won the race with exactly the link this one wanted.
        // Two windows pressing Install at once both asked for this, and telling
        // the slower one its name is taken would be a warning about itself.
        return {
          ...result,
          state: "installed",
          linkPath,
          existingPath: linkPath,
          existingTarget: raced?.target ?? shimPath,
        };
      }
      return {
        ...result,
        state: "occupied",
        linkPath,
        existingPath: linkPath,
        existingTarget: raced?.target ?? null,
      };
    }
    return {
      ...result,
      state: "failed",
      linkPath,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const written = await readEntry(linkPath);
  if (written?.target !== shimPath) {
    // Something replaced it between the rename and this read. Reported rather
    // than retried: a second attempt would be racing the same someone.
    return {
      ...result,
      state: "occupied",
      linkPath,
      existingPath: linkPath,
      existingTarget: written?.target ?? null,
    };
  }
  return {
    ...result,
    state: "installed",
    linkPath,
    existingPath: linkPath,
    existingTarget: shimPath,
    changed: true,
  };
}

/** Read where a bare `patcher` stands on this host. Writes nothing. */
export async function readCliCommandStatus(
  options: CliCommandOptions,
): Promise<HostCliCommandResult> {
  return resolveCliCommand(options, false);
}

/** Place the link, when there is a directory for it and nothing in the way. */
export async function installCliCommand(
  options: CliCommandOptions,
): Promise<HostCliCommandResult> {
  return resolveCliCommand(options, true);
}
