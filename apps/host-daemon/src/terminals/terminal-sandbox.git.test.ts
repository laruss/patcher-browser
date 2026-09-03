import { execFile } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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
 *
 * And both layouts, because for a long time only one was here. A rule names a
 * path, and a path is a name in a directory: with only direct writes attempted,
 * every deny below passed while `mv .git .gitx`, an edit, and `mv .gitx .git`
 * put a `core.fsmonitor` and a `pre-commit` hook back where the daemon's own
 * git reads them. So the walk-around is attempted too, and what is asserted is
 * the repository afterwards rather than the shell's exit code — a refusal the
 * turn routed around would otherwise read as a refusal.
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

/**
 * The other layout Patcher runs in: `workspace: unmanaged`, where the thread
 * works in the project's own checkout and `.git` is a real directory inside the
 * workspace rather than a pointer file beside it.
 *
 * This is the layout the rename walks around, and the one nothing measured.
 */
async function createPlainCheckout(
  rootPrefix = path.join(tmpdir(), "patcher-git-sandbox-"),
): Promise<string> {
  const root = mkdtempSync(rootPrefix);
  temporaryRoots.push(root);
  const workspacePath = path.join(root, "checkout");
  await run("mkdir", ["-p", workspacePath]);
  await git(["init", "-b", "main"], workspacePath);
  await git(["config", "user.email", "sandbox@example.com"], workspacePath);
  await git(["config", "user.name", "Sandbox Test"], workspacePath);
  writeFileSync(path.join(workspacePath, "file.txt"), "hello\n");
  await git(["add", "-A"], workspacePath);
  await git(["commit", "-m", "init"], workspacePath);
  return workspacePath;
}

/**
 * Every way a turn can get at a protected path by moving something else.
 *
 * One shell, so a refusal for one line cannot be read as the answer for
 * another, and each attempt puts the entry back so the next one starts from the
 * layout git expects. `cp -a` after a `mkdir` is the bubblewrap shape — there
 * the mounts travel with the renamed dentry, so a fresh directory beside it is
 * what carried the writes.
 */
function buildRenameWalkAroundScript(workspacePath: string): string {
  const workspaceName = path.basename(workspacePath);
  return [
    `cd '${workspacePath}'`,
    // The directory that holds every protected file in a plain checkout.
    `if mv .git .gitx 2>/dev/null; then`,
    `  echo renamed:git-dir`,
    `  mkdir -p .git 2>/dev/null && cp -a .gitx/. .git/ 2>/dev/null`,
    `  printf '[core]\\n\\tfsmonitor = /tmp/patcher-evil\\n' >> .git/config 2>/dev/null`,
    `  printf '#!/bin/sh\\n' > .git/hooks/pre-commit 2>/dev/null`,
    `  rm -rf .gitx 2>/dev/null`,
    `else`,
    `  echo refused:rename-git-dir`,
    `fi`,
    // One level in: `info/attributes` is protected, `info` was not.
    `if mv .git/info .git/infox 2>/dev/null; then`,
    `  echo renamed:info-dir`,
    `  mkdir -p .git/info 2>/dev/null`,
    `  printf '* filter=patcher-evil\\n' > .git/info/attributes 2>/dev/null`,
    `  rm -rf .git/infox 2>/dev/null`,
    `else`,
    `  echo refused:rename-info-dir`,
    `fi`,
    // And the workspace itself, which is what carries a linked worktree's
    // `.git` pointer file wherever the workspace sits under a writable temp
    // root.
    `cd ..`,
    `if mv '${workspaceName}' '${workspaceName}x' 2>/dev/null; then`,
    `  echo renamed:workspace`,
    `  mv '${workspaceName}x' '${workspaceName}' 2>/dev/null`,
    `else`,
    `  echo refused:rename-workspace`,
    `fi`,
  ].join("\n");
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

interface SandboxRunArgs {
  workspacePath: string;
  writableRoots: readonly string[];
  readOnlyPaths: readonly string[];
  script: string;
}

/** The launch this module builds, run, with its lines back. */
async function runSandboxed(args: SandboxRunArgs): Promise<string[]> {
  const launch = buildTerminalSandboxLaunch({
    command: { file: "/bin/sh", args: ["-c", args.script] },
    cwd: args.workspacePath,
    env: process.env,
    platform: process.platform,
    policy: {
      workspacePath: args.workspacePath,
      writableRoots: args.writableRoots,
      readOnlyPaths: args.readOnlyPaths,
      deniedReadPaths: [],
    },
  });
  expect(launch.sandboxed).toBe(true);
  if (!launch.sandboxed) return [];
  const { stdout } = await run(launch.command.file, [...launch.command.args], {
    cwd: args.workspacePath,
    encoding: "utf8",
  });
  return stdout.trim().split("\n");
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

    it("cannot move the pointer file, or the workspace holding it, out from under its rule", async () => {
      // `<ws>/.git` here is a file naming the gitdir, and rewriting it aims git
      // at a directory the turn owns outright. The rule names that file, so a
      // direct write is refused — and the file can still be moved away if the
      // directory it sits in can be. On macOS a workspace under `$TMPDIR` is
      // exactly that, because the temp roots a shell needs are writable.
      const worktree = await createLinkedWorktree();
      const [readOnlyPaths, writableRoots] = await Promise.all([
        resolveProtectedRepositoryPaths(worktree.workspacePath),
        resolveAdditionalWorkspaceWriteRoots(worktree.workspacePath),
      ]);
      const workspaceName = path.basename(worktree.workspacePath);

      const outcomes = await runSandboxed({
        workspacePath: worktree.workspacePath,
        writableRoots,
        readOnlyPaths,
        script: [
          `cd '${worktree.workspacePath}'`,
          `if mv .git .gitx 2>/dev/null; then echo renamed:pointer; mv .gitx .git; else echo refused:rename-pointer; fi`,
          `cd ..`,
          `if mv '${workspaceName}' '${workspaceName}x' 2>/dev/null; then echo renamed:workspace; mv '${workspaceName}x' '${workspaceName}'; else echo refused:rename-workspace; fi`,
        ].join("; "),
      });

      expect(outcomes).toContain("refused:rename-pointer");
      expect(outcomes).toContain("refused:rename-workspace");
      // The pointer is still the one git wrote, so the layout the other tests
      // measure is the layout this one left behind.
      expect(
        await git(["rev-parse", "--absolute-git-dir"], worktree.workspacePath),
      ).toBe(worktree.gitDir);
    });
  },
);

describe.skipIf(!SANDBOX_AVAILABLE_HERE)(
  "a sandboxed turn inside the project's own checkout",
  () => {
    it("is refused what git executes, by name and through a rename", async () => {
      const workspacePath = await createPlainCheckout();
      const [readOnlyPaths, writableRoots] = await Promise.all([
        resolveProtectedRepositoryPaths(workspacePath),
        resolveAdditionalWorkspaceWriteRoots(workspacePath),
      ]);
      const gitDir = path.join(workspacePath, ".git");

      const directAttempts: readonly [string, string][] = [
        ["config", path.join(gitDir, "config")],
        ["hook", path.join(gitDir, "hooks", "pre-commit")],
        ["attributes", path.join(gitDir, "info", "attributes")],
      ];
      const outcomes = await runSandboxed({
        workspacePath,
        writableRoots,
        readOnlyPaths,
        script: [
          ...directAttempts.map(
            ([label, target]) =>
              `if printf x > '${target}' 2>/dev/null; then echo "wrote:${label}"; else echo "refused:${label}"; fi`,
          ),
          buildRenameWalkAroundScript(workspacePath),
        ].join("\n"),
      });

      expect(outcomes).toContain("refused:config");
      expect(outcomes).toContain("refused:hook");
      expect(outcomes).toContain("refused:attributes");
      expect(outcomes).toContain("refused:rename-git-dir");
      expect(outcomes).toContain("refused:rename-info-dir");
      expect(outcomes).toContain("refused:rename-workspace");

      // What the shell said, checked against what the repository holds: a
      // refusal the turn walked around would have printed the same line.
      expect(readFileSync(path.join(gitDir, "config"), "utf8")).not.toContain(
        "fsmonitor",
      );
      expect(existsSync(path.join(gitDir, "hooks", "pre-commit"))).toBe(false);
      const attributesPath = path.join(gitDir, "info", "attributes");
      // Bubblewrap leaves an empty file where it binds `/dev/null` over a
      // protected path that was not there — empty is what git reads as absent.
      expect(
        existsSync(attributesPath) ? readFileSync(attributesPath, "utf8") : "",
      ).not.toContain("patcher-evil");
    });

    it("holds when the workspace sits under a directory whose name starts with ..", async () => {
      // `isInside` decides which entries get a rename rule, and it used to read
      // the `..` prefix of a *string* rather than a path segment — so a
      // directory named `..projects` directly under a writable temp root
      // looked like a step outside it, the workspace under it got no rule, and
      // `mv wt wtx` walked the whole deny list around. `mkdtemp` puts the name
      // straight under `$TMPDIR`, which is where the misreading bites.
      // `/tmp` rather than `tmpdir()`: on macOS the latter sits under
      // `/private/var/folders`, which is a writable root of its own, and being
      // inside *that* covered for the misreading. `/tmp` has no writable
      // ancestor in the list, so the answer for this directory is the only one
      // there is — and a workspace under `/tmp` is a shape this module makes
      // writable on purpose.
      const workspacePath = await createPlainCheckout(
        "/tmp/..patcher-git-sandbox-",
      );
      const [readOnlyPaths, writableRoots] = await Promise.all([
        resolveProtectedRepositoryPaths(workspacePath),
        resolveAdditionalWorkspaceWriteRoots(workspacePath),
      ]);

      const outcomes = await runSandboxed({
        workspacePath,
        writableRoots,
        readOnlyPaths,
        script: buildRenameWalkAroundScript(workspacePath),
      });

      expect(outcomes).toContain("refused:rename-workspace");
      expect(outcomes).toContain("refused:rename-git-dir");
      expect(
        readFileSync(path.join(workspacePath, ".git", "config"), "utf8"),
      ).not.toContain("fsmonitor");
    });

    it("does not leave a symlinked protected path standing on its own name", async () => {
      // A rule names a path, and a symlink is two paths: deny the target and
      // the link is still an ordinary entry in a writable directory, so
      // `rm .git/config` and a fresh file in its place hand the daemon's git
      // the turn's own config. Seatbelt takes a rule about the link's name.
      // Bubblewrap cannot — a mount follows the link — so there the launch is
      // refused instead, which is the same answer this module gives a machine
      // that cannot build the sandbox at all.
      const workspacePath = await createPlainCheckout();
      const gitDir = path.join(workspacePath, ".git");
      renameSync(path.join(gitDir, "config"), path.join(gitDir, "config.real"));
      symlinkSync("config.real", path.join(gitDir, "config"));
      const [readOnlyPaths, writableRoots] = await Promise.all([
        resolveProtectedRepositoryPaths(workspacePath),
        resolveAdditionalWorkspaceWriteRoots(workspacePath),
      ]);
      const policy = {
        workspacePath,
        writableRoots,
        readOnlyPaths,
        deniedReadPaths: [],
      };

      if (process.platform === "linux") {
        const launch = buildTerminalSandboxLaunch({
          command: { file: "/bin/sh", args: ["-c", "true"] },
          cwd: workspacePath,
          env: process.env,
          platform: process.platform,
          policy,
        });
        expect(launch.sandboxed).toBe(false);
        if (launch.sandboxed) return;
        expect(launch.reason).toContain("symbolic link");
        expect(launch.remedy).toContain("Full Access");
        return;
      }

      const outcomes = await runSandboxed({
        ...policy,
        script: [
          `cd '${workspacePath}'`,
          `if printf x >> .git/config 2>/dev/null; then echo wrote:through-link; else echo refused:through-link; fi`,
          `if rm .git/config 2>/dev/null; then`,
          `  echo removed:link`,
          `  printf '[core]\\n\\tfsmonitor = /tmp/patcher-evil\\n' > .git/config 2>/dev/null`,
          `else`,
          `  echo refused:remove-link`,
          `fi`,
          `if mv .git/config .git/configx 2>/dev/null; then echo renamed:link; else echo refused:rename-link; fi`,
        ].join("\n"),
      });

      expect(outcomes).toContain("refused:through-link");
      expect(outcomes).toContain("refused:remove-link");
      expect(outcomes).toContain("refused:rename-link");
      // The link is still the one git follows, and it still leads to the file
      // the repository had.
      expect(readFileSync(path.join(gitDir, "config"), "utf8")).not.toContain(
        "fsmonitor",
      );
    });

    it("can still stage and commit its own work", async () => {
      // The same half as in the worktree layout, and it has to be asserted
      // again here: this is where `.git` itself picked up a rule, and a rule
      // one notch too broad takes `index.lock` — and committing — with it.
      const workspacePath = await createPlainCheckout();
      const [readOnlyPaths, writableRoots] = await Promise.all([
        resolveProtectedRepositoryPaths(workspacePath),
        resolveAdditionalWorkspaceWriteRoots(workspacePath),
      ]);

      const outcomes = await runSandboxed({
        workspacePath,
        writableRoots,
        readOnlyPaths,
        script:
          "printf 'work\\n' > work.txt && git add -A && " +
          "git -c user.email=t@e.com -c user.name=T commit -q -m 'from the turn' && " +
          "git rev-parse --short HEAD",
      });

      expect(outcomes.at(-1)).toMatch(/^[0-9a-f]{7,}$/u);
      expect(await git(["log", "-1", "--format=%s"], workspacePath)).toBe(
        "from the turn",
      );
    });
  },
);
