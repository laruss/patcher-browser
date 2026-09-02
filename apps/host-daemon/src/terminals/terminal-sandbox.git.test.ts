import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  resolveAdditionalWorkspaceWriteRoots,
  resolveProtectedRepositoryPaths,
} from "@patcher/host-workspace";
import { afterEach, describe, expect, it } from "vitest";
import { buildTerminalSandboxLaunch } from "./terminal-sandbox.js";

/**
 * A turn's own git metadata, in the shape Patcher actually runs: a linked
 * worktree.
 *
 * `.git` is inside the workspace a turn may write, and several git config keys
 * name a command git then executes — in the daemon, outside the sandbox, as the
 * user. `resolveProtectedRepositoryPaths` is the list that closes that, and its
 * *contents* are unit-tested next to it. What was never tested is whether the
 * kernel refuses those writes here, on the layout a managed worktree produces:
 * the gitdir sits outside the workspace and has to stay writable, so the
 * refusals and the permissions are interleaved in a way a plain checkout never
 * shows.
 *
 * Both halves are asserted together on purpose. Denying all of `.git` was
 * measured and rejected — `git add` fails on `index.lock` — so a test that only
 * checked the denials would pass on a boundary that had taken committing away.
 */

const run = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await run("git", [...args], { cwd, encoding: "utf8" });
  return stdout.trim();
}

interface Worktree {
  commonGitDir: string;
  gitDir: string;
  workspacePath: string;
}

async function createLinkedWorktree(): Promise<Worktree> {
  const root = mkdtempSync(path.join(tmpdir(), "patcher-git-sandbox-"));
  temporaryRoots.push(root);
  const repositoryPath = path.join(root, "repo");
  const workspacePath = path.join(root, "wt");
  writeFileSync(path.join(root, "placeholder"), "");
  await run("mkdir", ["-p", repositoryPath]);
  await git(["init", "-b", "main"], repositoryPath);
  await git(["config", "user.email", "sandbox@example.com"], repositoryPath);
  await git(["config", "user.name", "Sandbox Test"], repositoryPath);
  writeFileSync(path.join(repositoryPath, "file.txt"), "hello\n");
  await git(["add", "-A"], repositoryPath);
  await git(["commit", "-m", "init"], repositoryPath);
  await git(["worktree", "add", "-b", "feature", workspacePath], repositoryPath);
  return {
    commonGitDir: await git(
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      workspacePath,
    ),
    gitDir: await git(["rev-parse", "--absolute-git-dir"], workspacePath),
    workspacePath,
  };
}

/** Whether this machine can build the sandbox at all; asked once. */
const SANDBOX_AVAILABLE_HERE =
  process.platform !== "win32" &&
  buildTerminalSandboxLaunch({
    command: { file: "/bin/sh", args: ["-c", "true"] },
    cwd: process.cwd(),
    env: process.env,
    platform: process.platform,
    policy: {
      workspacePath: process.cwd(),
      writableRoots: [],
      readOnlyPaths: [],
      deniedReadPaths: [],
    },
  }).sandboxed;

describe.skipIf(!SANDBOX_AVAILABLE_HERE)(
  "a sandboxed turn inside a linked worktree",
  () => {
    it("is refused what git executes and keeps what git needs", async () => {
      const worktree = await createLinkedWorktree();
      const [readOnlyPaths, writableRoots] = await Promise.all([
        resolveProtectedRepositoryPaths(worktree.workspacePath),
        resolveAdditionalWorkspaceWriteRoots(worktree.workspacePath),
      ]);

      // Each of these is attempted in one shell, so the answer for one cannot
      // be read as the answer for another: the refusals sit inside a directory
      // the very next line writes.
      const attempts: readonly [string, string][] = [
        ["pointer", path.join(worktree.workspacePath, ".git")],
        ["common-config", path.join(worktree.commonGitDir, "config")],
        [
          "common-hook",
          path.join(worktree.commonGitDir, "hooks", "pre-commit"),
        ],
        [
          "common-attributes",
          path.join(worktree.commonGitDir, "info", "attributes"),
        ],
        [
          "worktree-config",
          path.join(worktree.gitDir, "config.worktree"),
        ],
        ["gitdir-file", path.join(worktree.gitDir, "patcher-probe")],
        ["workspace-file", path.join(worktree.workspacePath, "probe.txt")],
      ];
      const script = attempts
        .map(
          ([label, target]) =>
            `if printf x > '${target}' 2>/dev/null; then echo "wrote:${label}"; else echo "refused:${label}"; fi`,
        )
        .join("; ");

      const launch = buildTerminalSandboxLaunch({
        command: { file: "/bin/sh", args: ["-c", script] },
        cwd: worktree.workspacePath,
        env: process.env,
        platform: process.platform,
        policy: {
          workspacePath: worktree.workspacePath,
          writableRoots,
          readOnlyPaths,
          deniedReadPaths: [],
        },
      });
      expect(launch.sandboxed).toBe(true);
      if (!launch.sandboxed) return;

      const { stdout } = await run(
        launch.command.file,
        [...launch.command.args],
        { cwd: worktree.workspacePath, encoding: "utf8" },
      );
      const outcomes = stdout.trim().split("\n");

      // The four files git reads outside the sandbox, and the pointer that
      // would aim it at a gitdir the turn owns outright.
      expect(outcomes).toContain("refused:pointer");
      expect(outcomes).toContain("refused:common-config");
      expect(outcomes).toContain("refused:common-hook");
      expect(outcomes).toContain("refused:common-attributes");
      expect(outcomes).toContain("refused:worktree-config");
      // And the other half: the worktree's own gitdir stays writable, because
      // its index and refs live there.
      expect(outcomes).toContain("wrote:gitdir-file");
      expect(outcomes).toContain("wrote:workspace-file");
    });

    it("can still stage and commit its own work", async () => {
      // The measurement that shaped the list: `.git` denied wholesale fails
      // `git add` on `index.lock`, so a turn could no longer commit. Asserted
      // through the sandbox rather than reasoned about, because that is the
      // half a denial-only test would have hidden.
      const worktree = await createLinkedWorktree();
      const [readOnlyPaths, writableRoots] = await Promise.all([
        resolveProtectedRepositoryPaths(worktree.workspacePath),
        resolveAdditionalWorkspaceWriteRoots(worktree.workspacePath),
      ]);

      const launch = buildTerminalSandboxLaunch({
        command: {
          file: "/bin/sh",
          args: [
            "-c",
            "printf 'work\\n' > work.txt && git add -A && " +
              "git -c user.email=t@e.com -c user.name=T commit -q -m 'from the turn' && " +
              "git rev-parse --short HEAD",
          ],
        },
        cwd: worktree.workspacePath,
        env: process.env,
        platform: process.platform,
        policy: {
          workspacePath: worktree.workspacePath,
          writableRoots,
          readOnlyPaths,
          deniedReadPaths: [],
        },
      });
      expect(launch.sandboxed).toBe(true);
      if (!launch.sandboxed) return;

      const { stdout } = await run(
        launch.command.file,
        [...launch.command.args],
        { cwd: worktree.workspacePath, encoding: "utf8" },
      );

      expect(stdout.trim()).toMatch(/^[0-9a-f]{7,}$/u);
      expect(await git(["log", "-1", "--format=%s"], worktree.workspacePath)).toBe(
        "from the turn",
      );
    });
  },
);
