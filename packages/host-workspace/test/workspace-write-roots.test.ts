import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import { resolveProtectedRepositoryPaths } from "../src/workspace-write-roots.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { force: true, recursive: true });
  }
  tempDirs.length = 0;
});

async function mkTempDir(prefix: string): Promise<string> {
  // realpath: /var/folders is a symlink on macOS, and a sandbox rule naming the
  // unresolved path is a rule about a path the kernel never sees.
  const dir = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), prefix)),
  );
  tempDirs.push(dir);
  return dir;
}

async function commitOnce(repoPath: string): Promise<void> {
  await runGit(["config", "user.name", "Patcher Tests"], { cwd: repoPath });
  await runGit(["config", "user.email", "patcher@example.com"], {
    cwd: repoPath,
  });
  await fs.writeFile(path.join(repoPath, "tracked.txt"), "one\n", "utf8");
  await runGit(["add", "-A"], { cwd: repoPath });
  await runGit(["commit", "-m", "init"], { cwd: repoPath });
}

async function initRepo(prefix: string): Promise<string> {
  const repoPath = await mkTempDir(prefix);
  await runGit(["init", "-b", "main"], { cwd: repoPath });
  await commitOnce(repoPath);
  return repoPath;
}

describe("resolveProtectedRepositoryPaths", () => {
  it("denies the files git executes in a project checkout", async () => {
    const repoPath = await initRepo("patcher-protected-checkout-");

    const paths = await resolveProtectedRepositoryPaths(repoPath);

    expect(paths).toEqual(
      expect.arrayContaining([
        path.join(repoPath, ".git", "config"),
        path.join(repoPath, ".git", "config.worktree"),
        path.join(repoPath, ".git", "hooks"),
        path.join(repoPath, ".git", "info", "attributes"),
      ]),
    );
  });

  it("never denies the gitdir itself, because the index lives there", async () => {
    // Measured, not assumed: with the whole of `.git` denied, `git add` fails on
    // `index.lock`, so a sandboxed turn could not stage or commit its own work.
    // A narrower `allowWrite` does not win the deny back — hence this invariant.
    const repoPath = await initRepo("patcher-protected-gitdir-");

    const paths = await resolveProtectedRepositoryPaths(repoPath);

    expect(paths).not.toContain(path.join(repoPath, ".git"));
    for (const writable of ["objects", "refs", "logs", "index"]) {
      expect(paths).not.toContain(path.join(repoPath, ".git", writable));
    }
  });

  it("still leaves it alone when the workspace is reached through a symlink", async () => {
    // git reports a path with no symlinks in it. Comparing that against the
    // workspace path as given decides a project checkout's own `.git` belongs
    // to somebody else and denies the whole of it — which is the case that
    // takes `git add` away, so it is the case worth a test of its own.
    const repoPath = await initRepo("patcher-protected-symlinked-");
    const linkParent = await mkTempDir("patcher-protected-symlink-parent-");
    const linkPath = path.join(linkParent, "link");
    await fs.symlink(repoPath, linkPath, "dir");

    const paths = await resolveProtectedRepositoryPaths(linkPath);

    expect(paths).not.toContain(path.join(linkPath, ".git"));
    expect(paths).not.toContain(path.join(repoPath, ".git"));
    expect(paths).toContain(path.join(repoPath, ".git", "config"));
  });

  it("leaves submodule and worktree metadata writable on purpose", async () => {
    // Config planted under either runs only for a git process that recurses
    // into it, and Patcher's plumbing never does — while denying them would
    // take `git submodule update` and `git worktree add` from every turn.
    const repoPath = await initRepo("patcher-protected-recursion-");

    const paths = await resolveProtectedRepositoryPaths(repoPath);

    expect(paths).not.toContain(path.join(repoPath, ".git", "modules"));
    expect(paths).not.toContain(path.join(repoPath, ".git", "worktrees"));
  });

  it("denies a linked worktree's pointer file and the config beside its index", async () => {
    const sourcePath = await initRepo("patcher-protected-source-");
    const worktreeParent = await mkTempDir("patcher-protected-worktree-");
    const worktreePath = path.join(worktreeParent, "wt");
    await runGit(["worktree", "add", "-b", "feature", worktreePath], {
      cwd: sourcePath,
    });

    const paths = await resolveProtectedRepositoryPaths(worktreePath);

    // The pointer file: rewriting it aims git at a gitdir the turn owns, which
    // is the same hole one indirection out. Patcher makes the worktree's own
    // gitdir writable so its index and refs work, so `config.worktree` in it
    // has to be named separately from the common one.
    const pointer = await fs.lstat(path.join(worktreePath, ".git"));
    expect(pointer.isFile()).toBe(true);
    expect(paths).toContain(path.join(worktreePath, ".git"));
    expect(paths).toContain(
      path.join(sourcePath, ".git", "worktrees", "wt", "config.worktree"),
    );
    expect(paths).toContain(path.join(sourcePath, ".git", "config"));
    expect(paths).toContain(path.join(sourcePath, ".git", "hooks"));
  });

  it("denies the pointer file of a checkout whose gitdir sits elsewhere", async () => {
    const workspacePath = await mkTempDir("patcher-protected-separate-");
    const gitDirPath = await mkTempDir("patcher-protected-separate-gitdir-");
    await runGit(
      ["init", "-b", "main", `--separate-git-dir=${gitDirPath}`, "."],
      { cwd: workspacePath },
    );
    await commitOnce(workspacePath);

    const paths = await resolveProtectedRepositoryPaths(workspacePath);

    expect(paths).toContain(path.join(workspacePath, ".git"));
    expect(paths).toContain(path.join(gitDirPath, "config"));
  });
});
