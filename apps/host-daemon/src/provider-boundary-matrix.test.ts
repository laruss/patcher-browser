import { execFile } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
 * dropped a whole class of path would keep them all green. That is the gap this
 * closes: the list comes from the resolver, on real repositories, and every
 * enforcer is checked against all of it.
 *
 * **Both layouts, because they do not produce the same list.** Measured: a
 * plain checkout yields the four common entries, while a linked worktree — what
 * `workspace: managed-worktree` gives a thread — yields those four *plus* the
 * worktree gitdir's own `config.worktree` and the `.git` pointer file the
 * workspace is reached through. A fixture with only the plain layout lets a
 * consumer drop either of those two classes and stay green.
 *
 * **And exactly, not by substring.** These paths are prefixes of one another:
 * `<git>/config` sits inside `<git>/config.worktree`. Measured on 2026-09-04, a
 * `toContain` over the serialised params passed while Claude's translation had
 * `.git/config` removed, so the comparison is set equality on paths read apart
 * per shape, and the sandbox argv is checked by exact token.
 *
 * What this does *not* claim is that each provider's sandbox then refuses the
 * write. It cannot: three of the four are the providers' own, and what they do
 * with the list differs by provider and platform. That is measured separately —
 * `codex/permission-profile.sandbox.test.ts` runs `codex sandbox` with the real
 * profile, `terminal-sandbox.git.test.ts` runs the real argv, and
 * `docs/security.md` records the Claude half, which needs a live session.
 */

const run = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const CREDENTIAL_PATHS = ["/data/app-api-key", "/data/patcher.db"];

interface Boundary {
  layout: string;
  workspacePath: string;
  additionalWorkspaceWriteRoots: readonly string[];
  protectedRepositoryPaths: readonly string[];
  protectedCredentialPaths: readonly string[];
  /** What the layout's own git reports, for an expectation built independently. */
  expectedProtectedPaths: readonly string[];
}

async function git(args: readonly string[], cwd: string): Promise<string> {
  const { stdout } = await run("git", [...args], { cwd, encoding: "utf8" });
  return stdout.trim();
}

async function initRepository(repositoryPath: string): Promise<void> {
  mkdirSync(repositoryPath, { recursive: true });
  await git(["init", "-b", "main"], repositoryPath);
  await git(["config", "user.email", "matrix@example.com"], repositoryPath);
  await git(["config", "user.name", "Boundary Matrix"], repositoryPath);
  writeFileSync(path.join(repositoryPath, "file.txt"), "hello\n");
  await git(["add", "-A"], repositoryPath);
  await git(["commit", "-m", "init"], repositoryPath);
}

function newRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "patcher-boundary-matrix-"));
  temporaryRoots.push(root);
  return root;
}

/**
 * The expectation, built from what git itself reports rather than from the
 * resolver — otherwise the guard below only says the resolver agrees with
 * itself. `realpath` because the resolver answers resolved paths, deliberately:
 * a rule naming an unresolved path is a rule about a path the kernel never sees.
 */
async function expectedProtectedPaths(
  workspacePath: string,
): Promise<string[]> {
  const commonGitDir = realpathSync(
    await git(
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      workspacePath,
    ),
  );
  const gitDir = realpathSync(
    await git(
      ["rev-parse", "--path-format=absolute", "--git-dir"],
      workspacePath,
    ),
  );
  const workspaceGitEntry = path.join(realpathSync(workspacePath), ".git");
  return [
    path.join(commonGitDir, "config"),
    path.join(commonGitDir, "config.worktree"),
    path.join(commonGitDir, "hooks"),
    path.join(commonGitDir, "info", "attributes"),
    ...(gitDir === commonGitDir ? [] : [path.join(gitDir, "config.worktree")]),
    // A linked worktree reaches its metadata through this one file; a plain
    // checkout's `.git` *is* the gitdir, so there is no indirection to protect.
    ...(realpathSync(workspaceGitEntry) === gitDir ? [] : [workspaceGitEntry]),
  ];
}

async function resolveBoundary(
  layout: "plain checkout" | "linked worktree",
): Promise<Boundary> {
  const root = newRoot();
  let workspacePath: string;
  if (layout === "plain checkout") {
    workspacePath = path.join(root, "checkout");
    await initRepository(workspacePath);
  } else {
    const source = path.join(root, "source");
    await initRepository(source);
    workspacePath = path.join(root, "wt");
    await git(["worktree", "add", workspacePath, "-b", "work"], source);
  }
  const [additionalWorkspaceWriteRoots, protectedRepositoryPaths, expected] =
    await Promise.all([
      resolveAdditionalWorkspaceWriteRoots(workspacePath),
      resolveProtectedRepositoryPaths(workspacePath),
      expectedProtectedPaths(workspacePath),
    ]);
  return {
    layout,
    workspacePath,
    additionalWorkspaceWriteRoots,
    protectedRepositoryPaths,
    protectedCredentialPaths: CREDENTIAL_PATHS,
    expectedProtectedPaths: expected,
  };
}

const LAYOUTS = ["plain checkout", "linked worktree"] as const;

function sorted(paths: readonly string[]): string[] {
  return [...paths].sort();
}

describe("the list every enforcer has to carry", () => {
  it.each(LAYOUTS)("is what git's own layout implies (%s)", async (layout) => {
    // The guard that keeps every loop below from passing on an empty or
    // truncated list: a resolver that answered nothing would make each of them
    // vacuous, and a run of vacuous checks reads exactly like a boundary that
    // holds.
    const boundary = await resolveBoundary(layout);
    expect(sorted(boundary.protectedRepositoryPaths)).toEqual(
      sorted(boundary.expectedProtectedPaths),
    );
    expect(boundary.protectedRepositoryPaths.length).toBe(
      layout === "plain checkout" ? 4 : 6,
    );
  });
});

describe("every provider that translates the boundary itself", () => {
  it.each(LAYOUTS)(
    "carries all of it and nothing less (%s)",
    async (layout) => {
      const boundary = await resolveBoundary(layout);
      const translations = buildProviderBoundaryTranslations(boundary);

      // A provider that stopped translating the boundary would otherwise leave
      // this loop with nothing to iterate.
      expect(translations.map((translation) => translation.providerId)).toEqual(
        ["claude-code", "codex", "acp-cursor"],
      );

      for (const translation of translations) {
        expect(
          sorted(translation.carriedPaths),
          `${translation.providerId} does not carry the boundary exactly — see ${translation.where}`,
        ).toEqual(sorted(boundary.protectedRepositoryPaths));
      }
    },
  );

  it.each(LAYOUTS)(
    "keeps them readable rather than denied, where its language can say so (%s)",
    async (layout) => {
      // Only Codex's profile can express the difference, and it matters: `deny`
      // there takes the read with the write, and a `.git/config` git cannot
      // read stops git from running at all.
      const boundary = await resolveBoundary(layout);
      const codex = buildProviderBoundaryTranslations(boundary).find(
        (translation) => translation.providerId === "codex",
      );
      expect(codex?.deniedPaths).toBeDefined();
      expect(sorted(codex?.deniedPaths ?? [])).toEqual(
        sorted(CREDENTIAL_PATHS),
      );
    },
  );
});

/**
 * Every path the sandbox argv names, as exact tokens.
 *
 * Seatbelt carries its rules inside one profile argument, where each path is a
 * quoted literal; bubblewrap gives each path its own argv entry. Both are
 * covered by taking the arguments plus every quoted run inside them — and an
 * exact token is what makes this able to fail, where a search over the joined
 * argv could not distinguish `<git>/config` from `<git>/config.worktree`, nor
 * see a missing `.git` entry rule at all.
 */
function sandboxPathTokens(args: readonly string[]): Set<string> {
  const tokens = new Set<string>();
  for (const arg of args) {
    tokens.add(arg);
    for (const quoted of arg.matchAll(/"([^"]+)"/g)) {
      tokens.add(quoted[1] as string);
    }
  }
  return tokens;
}

/**
 * Whether the argv refuses a *rename* of one directory, as each backend spells
 * that.
 *
 * Read out of the code that emits it and confirmed against a built profile:
 * Seatbelt takes `(deny file-write* (literal "<dir>"))`, which names the
 * directory and nothing under it, so the entry cannot be renamed or unlinked
 * while writes inside it still succeed. Bubblewrap has no such rule and makes
 * the directory a mount point instead — `--bind <dir> <dir>`, or `--tmpfs
 * <dir>` where the turn has already deleted it — so `rename()` answers EBUSY.
 */
function hasEntryRuleFor(args: readonly string[], entryPath: string): boolean {
  if (process.platform === "darwin") {
    return args.some((arg) =>
      arg.includes(`(deny file-write* (literal "${entryPath}"))`),
    );
  }
  return args.some(
    (arg, index) =>
      (arg === "--bind" &&
        args[index + 1] === entryPath &&
        args[index + 2] === entryPath) ||
      (arg === "--tmpfs" && args[index + 1] === entryPath),
  );
}

describe("the sandbox Patcher builds itself", () => {
  it.each(LAYOUTS)(
    "names all of it in the argv it launches with (%s)",
    async (layout) => {
      const boundary = await resolveBoundary(layout);
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
      const tokens = sandboxPathTokens(launcher.launcher.args);
      for (const protectedPath of boundary.protectedRepositoryPaths) {
        expect(
          [...tokens],
          `the sandbox argv does not name ${protectedPath}`,
        ).toContain(protectedPath);
      }

      if (layout === "plain checkout") {
        // And the entry each one is reached *through*, or `mv .git .gitx` walks
        // around every rule above (#57).
        //
        // By the *form* of the rule, not by the path turning up somewhere: two
        // rules name `<ws>/.git` here — the write grant that keeps `index.lock`
        // working, and the entry deny — so a token check passes with the entry
        // rule gone. Measured: with `resolveProtectedEntryPaths` returning
        // nothing, an exact-token assertion still passed.
        //
        // This layout only, and that is the point: in a linked worktree the
        // pointer file is protected in its own right, so a rule naming it
        // would prove nothing about entries.
        const gitEntry = path.join(
          realpathSync(boundary.workspacePath),
          ".git",
        );
        expect(
          hasEntryRuleFor(launcher.launcher.args, gitEntry),
          `no rename rule for ${gitEntry} in the ${process.platform} argv`,
        ).toBe(true);
      }
    },
  );
});
