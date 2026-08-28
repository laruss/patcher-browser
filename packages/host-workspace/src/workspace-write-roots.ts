import { realpath } from "node:fs/promises";
import path from "node:path";
import { getAbsoluteGitDir, getGitCommonDir } from "./git.js";

function isSamePathOrNestedUnder(childPath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath === "" ||
    (relativePath.length > 0 &&
      !relativePath.startsWith("..") &&
      !path.isAbsolute(relativePath))
  );
}

function dedupeResolvedPaths(paths: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of paths) {
    const resolved = path.resolve(value);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function buildCommonGitWriteRoots(commonGitDir: string): string[] {
  return [
    path.join(commonGitDir, "objects"),
    path.join(commonGitDir, "refs"),
    path.join(commonGitDir, "logs"),
  ];
}

/**
 * Entries inside a repository's own metadata that decide what git executes.
 *
 * `.git` lives inside the workspace, so a sandboxed turn can write it, and each
 * of these names a command git then runs — in the daemon, outside the sandbox,
 * as the user. `GIT_HARDENED_CONFIG` in `git.ts` narrows which keys are
 * reachable but cannot close the class: `filter.<driver>.smudge` is looked up
 * by a name a tracked `.gitattributes` chooses, so no fixed list of keys
 * pre-empts it. Keeping the files unwritable is the side of it the sandbox owns.
 *
 * Narrow rather than all of `.git`, and that is measured, not assumed: with
 * `.git` denied wholesale, `git add` fails on `index.lock`, so a sandboxed turn
 * could no longer stage or commit its own work. A re-allow inside the deny does
 * not help either — `filesystem.allowWrite` on `.git/objects` under a deny of
 * `.git` stayed denied. So this is the list of what git reads *outside* the
 * sandbox, and nothing more.
 *
 * `hooks` stays even though Patcher's own git runs with
 * `core.hooksPath=/dev/null`, because the user's terminal git does not.
 *
 * Not here, deliberately: `modules` and `worktrees`. Config planted under
 * either runs only for a git process that recurses into it, and Patcher's
 * plumbing never does — while denying them would take `git submodule update`
 * and `git worktree add` away from every sandboxed turn.
 */
const GIT_EXECUTION_ENTRIES = [
  "config",
  "config.worktree",
  "hooks",
  "info/attributes",
] as const;

/**
 * Paths a workspace-write sandbox must refuse even though they sit inside the
 * workspace it may otherwise write. Empty for a provider whose sandbox cannot
 * protect a path — see `docs/security.md`.
 */
export async function resolveProtectedRepositoryPaths(
  workspacePath: string,
): Promise<string[]> {
  // Resolved through realpath before anything else, because a sandbox rule
  // naming an unresolved path is a rule about a path the kernel never sees —
  // and because `git rev-parse` reports a path with no symlinks in it, while a
  // workspace can perfectly well be reached through one (/tmp on macOS above
  // all). Comparing the two as given makes a project checkout's own `.git`
  // directory look like somebody else's gitdir, and denies all of it. That
  // takes `git add` with it.
  const resolvedWorkspacePath = await realpath(workspacePath).catch(() =>
    path.resolve(workspacePath),
  );
  const [gitDir, commonGitDir] = await Promise.all([
    getAbsoluteGitDir(resolvedWorkspacePath),
    getGitCommonDir(resolvedWorkspacePath),
  ]);
  const workspaceGitEntry = path.join(resolvedWorkspacePath, ".git");
  const workspaceGitEntryRealPath = await realpath(workspaceGitEntry).catch(
    () => workspaceGitEntry,
  );
  return dedupeResolvedPaths([
    ...GIT_EXECUTION_ENTRIES.map((entry) => path.join(commonGitDir, entry)),
    // A linked worktree's own gitdir is writable on purpose — its index and
    // refs live there — and `config.worktree` sits in it.
    path.join(gitDir, "config.worktree"),
    // A worktree, or a checkout made with `--separate-git-dir`, reaches its
    // metadata through this one file. Rewriting it points git at a gitdir the
    // turn owns outright, which is the same hole one indirection further out.
    ...(workspaceGitEntryRealPath === gitDir ? [] : [workspaceGitEntryRealPath]),
  ]);
}

export async function resolveAdditionalWorkspaceWriteRoots(
  workspacePath: string,
): Promise<string[]> {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const [gitDir, commonGitDir] = await Promise.all([
    getAbsoluteGitDir(resolvedWorkspacePath),
    getGitCommonDir(resolvedWorkspacePath),
  ]);
  const candidateRoots = dedupeResolvedPaths([
    gitDir,
    ...buildCommonGitWriteRoots(commonGitDir),
  ]);

  return candidateRoots.filter(
    (candidateRoot) =>
      !isSamePathOrNestedUnder(candidateRoot, resolvedWorkspacePath),
  );
}
