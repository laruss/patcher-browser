import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { buildProviderBoundaryTranslations } from "@patcher/agent-runtime/test";
import {
  resolveAdditionalWorkspaceWriteRoots,
  resolveProtectedRepositoryPaths,
} from "@patcher/host-workspace";
import { afterEach, describe, expect, it } from "vitest";
import { buildProviderSandboxLauncher } from "./provider-sandbox.js";

/**
 * One policy, four enforcers, and the list they all have to carry.
 *
 * The paths a sandboxed turn may not write are resolved once — by
 * `resolveProtectedRepositoryPaths`, because git runs what those files
 * configure, in the daemon, outside the sandbox, as the user. They are then
 * enforced in four different places: Claude Code's own SDK sandbox, Codex's
 * permission profile, the ACP bridge's path check, and the seatbelt/bwrap
 * sandbox Patcher builds itself for an ACP turn's agent, a Pi turn's bridge and
 * every terminal.
 *
 * Each of those has a test of its own, and every one of them was written
 * against a *hand-written* list — `["/tmp/worktree/.git/config"]` in the Claude
 * adapter's suite, `["/workspace/.git/config"]` in the ACP one. So adding an
 * entry to `GIT_EXECUTION_ENTRIES` fails nothing, and an enforcer that quietly
 * dropped a whole class of path — `config.worktree`, or the `.git` pointer file
 * a linked worktree is reached through — would keep them all green. That is the
 * gap this closes: the list comes from the resolver, on a real repository, and
 * every enforcer is checked against all of it.
 *
 * What this does *not* claim is that each provider's sandbox then refuses the
 * write. It cannot: three of the four are the providers' own, and what they do
 * with the list differs by provider and by platform. That is measured
 * separately — `codex/permission-profile.sandbox.test.ts` runs `codex sandbox`
 * with the real profile, `terminal-sandbox.git.test.ts` runs the real argv, and
 * `docs/security.md` records the Claude half, which needs a live session.
 */

const run = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A plain checkout, which is what `workspace: unmanaged` gives a thread. */
async function createCheckout(): Promise<string> {
  const root = mkdtempSync(path.join(tmpdir(), "patcher-boundary-matrix-"));
  temporaryRoots.push(root);
  const workspacePath = path.join(root, "checkout");
  await run("mkdir", ["-p", workspacePath]);
  const git = (args: string[]): Promise<unknown> =>
    run("git", args, { cwd: workspacePath });
  await git(["init", "-b", "main"]);
  await git(["config", "user.email", "matrix@example.com"]);
  await git(["config", "user.name", "Boundary Matrix"]);
  writeFileSync(path.join(workspacePath, "file.txt"), "hello\n");
  await git(["add", "-A"]);
  await git(["commit", "-m", "init"]);
  return workspacePath;
}

const CREDENTIAL_PATHS = ["/data/app-api-key", "/data/patcher.db"];

interface ResolvedBoundary {
  workspacePath: string;
  additionalWorkspaceWriteRoots: readonly string[];
  protectedRepositoryPaths: readonly string[];
  protectedCredentialPaths: readonly string[];
}

async function resolveBoundary(): Promise<ResolvedBoundary> {
  const workspacePath = await createCheckout();
  const [additionalWorkspaceWriteRoots, protectedRepositoryPaths] =
    await Promise.all([
      resolveAdditionalWorkspaceWriteRoots(workspacePath),
      resolveProtectedRepositoryPaths(workspacePath),
    ]);
  return {
    workspacePath,
    additionalWorkspaceWriteRoots,
    protectedRepositoryPaths,
    protectedCredentialPaths: CREDENTIAL_PATHS,
  };
}

describe("the list every enforcer has to carry", () => {
  it("is the four git-execution entries, resolved on a real repository", async () => {
    // The guard that keeps every loop below from passing on an empty list: a
    // resolver that answered nothing would make each of them vacuous, and a run
    // of vacuous checks reads exactly like a boundary that holds.
    const boundary = await resolveBoundary();
    // By the tail rather than against the workspace path: the resolver answers
    // through `realpath`, and on macOS a workspace under `$TMPDIR` is reached
    // as `/var/...` and resolved as `/private/var/...`. That is deliberate
    // there — a rule naming an unresolved path is a rule about a path the
    // kernel never sees — so the test has to speak the same way.
    const gitDirEntry = `${path.sep}.git${path.sep}`;
    const names = boundary.protectedRepositoryPaths.map((entry) => {
      expect(entry).toContain(gitDirEntry);
      return entry.slice(entry.lastIndexOf(gitDirEntry) + gitDirEntry.length);
    });
    expect([...names].sort()).toEqual([
      "config",
      "config.worktree",
      "hooks",
      path.join("info", "attributes"),
    ]);
  });
});

describe("every provider that translates the boundary itself", () => {
  it("carries all of it, whatever shape its wire uses", async () => {
    const boundary = await resolveBoundary();
    const translations = buildProviderBoundaryTranslations(boundary);

    // A provider that stopped translating the boundary would otherwise leave
    // this loop with nothing to iterate.
    expect(translations.map((translation) => translation.providerId)).toEqual([
      "claude-code",
      "codex",
      "acp-cursor",
    ]);

    for (const translation of translations) {
      const carried = JSON.stringify(translation.params);
      for (const protectedPath of boundary.protectedRepositoryPaths) {
        expect(
          carried,
          `${translation.providerId} does not carry ${protectedPath} — see ${translation.where}`,
        ).toContain(protectedPath);
      }
    }
  });

  it("keeps them readable rather than denied, where its language can say so", async () => {
    // Only Codex's profile can express the difference, and it matters: `deny`
    // there takes the read with the write, and a `.git/config` git cannot read
    // stops git from running at all.
    const boundary = await resolveBoundary();
    const codex = buildProviderBoundaryTranslations(boundary).find(
      (translation) => translation.providerId === "codex",
    );
    expect(codex?.readOnlyPaths).toBeDefined();
    for (const protectedPath of boundary.protectedRepositoryPaths) {
      expect(codex?.readOnlyPaths).toContain(protectedPath);
    }
  });
});

describe("the sandbox Patcher builds itself", () => {
  it("names all of it in the argv it launches with", async () => {
    const boundary = await resolveBoundary();
    const launcher = buildProviderSandboxLauncher({
      cwd: boundary.workspacePath,
      stateDirs: [],
      homeDirectory: process.env.HOME,
      additionalWorkspaceWriteRoots: boundary.additionalWorkspaceWriteRoots,
      protectedRepositoryPaths: boundary.protectedRepositoryPaths,
      protectedCredentialPaths: boundary.protectedCredentialPaths,
      env: process.env,
      platform: process.platform,
    });
    if (!launcher.sandboxed) {
      // A machine that cannot build one refuses the turn instead, which is its
      // own test in provider-sandbox.test.ts. Nothing to assert about argv.
      expect(launcher.reason).toBeTruthy();
      return;
    }
    const argv = launcher.launcher.args.join(" ");
    for (const protectedPath of boundary.protectedRepositoryPaths) {
      expect(argv).toContain(protectedPath);
    }
    // And the entry each one is reached *through*, or `mv .git .gitx` walks
    // around every rule above (#57). The rename rules are the whole reason this
    // enforcer differs from the three that only get a list of files.
    expect(argv).toContain(path.join(boundary.workspacePath, ".git"));
  });
});
