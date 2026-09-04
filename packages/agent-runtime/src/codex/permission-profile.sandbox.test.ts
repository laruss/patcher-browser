import { execFile, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  CODEX_WORKSPACE_PERMISSION_PROFILE_ID,
  buildCodexWorkspacePermissionProfileConfig,
} from "./permission-profile.js";

/**
 * What Codex's own sandbox does with the profile Patcher sends it — measured,
 * not asserted from the shape of the map.
 *
 * The unit tests beside this one check that the profile *says* the right thing.
 * They cannot check that the kernel then refuses the write, and that is the half
 * that matters: Codex builds its own sandbox from this map, its language has no
 * rule for "this directory may not be renamed", and whether the four
 * git-execution files hold therefore rests on Codex rather than on Patcher.
 * `docs/security.md` recorded that as a measurement taken by hand; this is the
 * same measurement, run by CI.
 *
 * No model turn and no credentials: `codex sandbox` runs a plain command under
 * a named permission profile, which is why this can also run on Linux, where
 * the answers differ.
 *
 * **The positive controls are not decoration.** A misapplied profile refuses
 * everything, and a run of all-refusals reads exactly like a boundary that
 * holds — so the probe also writes a file in the workspace, writes inside
 * `.git`, and stages a commit, and the test fails if any of those was refused.
 */

const run = promisify(execFile);
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

/**
 * Whether this machine can run the measurement at all; asked once, by running
 * it.
 *
 * Not `codex --version`: on Linux Codex builds its sandbox with bubblewrap, and
 * a machine that will not give an unprivileged user a namespace answers
 * "No permissions to create a new namespace" for every command — measured in a
 * container here, and the same restriction CI lifts with
 * `kernel.apparmor_restrict_unprivileged_userns=0` before its bubblewrap tests.
 * So the probe is a trivial command under a trivial profile: it separates "no
 * Codex here" and "no sandbox here" from a real refusal, and neither of those
 * is a failure of Patcher's profile.
 */
const CODEX_SANDBOX_AVAILABLE_HERE = (() => {
  const probe = spawnSync(
    "codex",
    [
      "sandbox",
      "-c",
      'permissions={"probe"={"network"={"enabled"=true},"filesystem"={":root"="read"}}}',
      "-P",
      "probe",
      "--",
      // `/bin/sh -c true` rather than `/bin/true`, which is `/usr/bin/true` on
      // macOS — and a probe that fails on the path of its own command would
      // skip the whole measurement.
      "/bin/sh",
      "-c",
      "true",
    ],
    { timeout: 60_000 },
  );
  return probe.status === 0;
})();

/** TOML inline value, for `codex sandbox -c permissions=…`. */
function toInlineToml(value: unknown): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => toInlineToml(entry)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).map(
      // Every key is quoted, because most of them are absolute paths and a
      // dotted override cannot spell one.
      ([key, entry]) => `${JSON.stringify(key)}=${toInlineToml(entry)}`,
    );
    return `{${entries.join(",")}}`;
  }
  throw new Error(`Cannot write ${typeof value} as TOML`);
}

interface Checkout {
  workspacePath: string;
  protectedRepositoryPaths: string[];
}

/**
 * A plain checkout, the layout `workspace: unmanaged` gives a thread, with the
 * four entries `resolveProtectedRepositoryPaths` names in it. Spelled out here
 * rather than resolved: that resolver is the daemon's, and what is under test is
 * what Codex does with a list, not how the list is built. The matrix test in
 * `apps/host-daemon` is what ties the two together.
 */
async function createCheckout(): Promise<Checkout> {
  const root = mkdtempSync(path.join(tmpdir(), "patcher-codex-sandbox-"));
  temporaryRoots.push(root);
  const workspacePath = path.join(root, "checkout");
  mkdirSync(workspacePath, { recursive: true });
  const git = (args: string[]): Promise<unknown> =>
    run("git", args, { cwd: workspacePath });
  await git(["init", "-b", "main"]);
  await git(["config", "user.email", "sandbox@example.com"]);
  await git(["config", "user.name", "Codex Sandbox Probe"]);
  writeFileSync(path.join(workspacePath, "file.txt"), "hello\n");
  await git(["add", "-A"]);
  await git(["commit", "-m", "init"]);
  mkdirSync(path.join(workspacePath, ".git", "info"), { recursive: true });
  writeFileSync(path.join(workspacePath, ".git", "info", "attributes"), "");
  writeFileSync(path.join(workspacePath, ".git", "config.worktree"), "");
  const gitDir = path.join(workspacePath, ".git");
  return {
    workspacePath,
    protectedRepositoryPaths: [
      path.join(gitDir, "config"),
      path.join(gitDir, "config.worktree"),
      path.join(gitDir, "hooks"),
      path.join(gitDir, "info", "attributes"),
    ],
  };
}

const PROBE = [
  // The four files, written directly.
  "if printf x >> .git/config 2>/dev/null; then echo wrote:config; else echo refused:config; fi",
  "if printf x >> .git/config.worktree 2>/dev/null; then echo wrote:config.worktree; else echo refused:config.worktree; fi",
  "if printf x > .git/hooks/pre-commit 2>/dev/null; then echo wrote:hooks; else echo refused:hooks; fi",
  "if printf x >> .git/info/attributes 2>/dev/null; then echo wrote:attributes; else echo refused:attributes; fi",
  // The walk-around: a rule names a path, and a path is a name in a directory.
  "if mv .git .gitx 2>/dev/null; then echo renamed:git; mv .gitx .git 2>/dev/null; else echo refused:rename-git; fi",
  "if mv .git/info .git/infox 2>/dev/null; then echo renamed:info; mv .git/infox .git/info 2>/dev/null; else echo refused:rename-info; fi",
  "if rm .git/config 2>/dev/null; then echo unlinked:config; else echo refused:unlink-config; fi",
  // Positive controls: a boundary that refuses these is broken, not tight.
  "if printf x > allowed.txt 2>/dev/null; then echo wrote:workspace; else echo refused:workspace; fi",
  "if printf x > .git/probe 2>/dev/null; then echo wrote:git-inside; else echo refused:git-inside; fi",
  "if git add -A >/dev/null 2>&1; then echo staged:ok; else echo refused:staging; fi",
].join("\n");

async function measure(checkout: Checkout): Promise<string[]> {
  const codexHome = mkdtempSync(path.join(tmpdir(), "patcher-codex-home-"));
  temporaryRoots.push(codexHome);
  const config = buildCodexWorkspacePermissionProfileConfig({
    workspacePath: checkout.workspacePath,
    writableRoots: [],
    protectedRepositoryPaths: checkout.protectedRepositoryPaths,
    protectedCredentialPaths: [],
    networkRestricted: false,
  });
  const { stdout } = await run(
    "codex",
    [
      "sandbox",
      "-c",
      `permissions=${toInlineToml(config.permissions)}`,
      "-P",
      CODEX_WORKSPACE_PERMISSION_PROFILE_ID,
      "-C",
      checkout.workspacePath,
      "--",
      "/bin/sh",
      "-c",
      PROBE,
    ],
    {
      cwd: checkout.workspacePath,
      encoding: "utf8",
      // An empty CODEX_HOME, so what is measured is this profile rather than
      // whatever the developer's own config.toml says — which may well be
      // `danger-full-access`.
      env: { ...process.env, CODEX_HOME: codexHome },
      timeout: 120_000,
    },
  );
  return stdout.trim().split("\n").filter(Boolean);
}

describe.skipIf(!CODEX_SANDBOX_AVAILABLE_HERE)(
  "the workspace permission profile, under Codex's own sandbox",
  () => {
    it("refuses every git-execution file while the turn can still commit", async () => {
      const checkout = await createCheckout();
      const answers = await measure(checkout);

      // Ran at all: an empty or truncated probe would make every expectation
      // below pass by absence.
      expect(answers).toHaveLength(10);

      expect(answers).toEqual(
        expect.arrayContaining([
          "refused:config",
          "refused:config.worktree",
          "refused:hooks",
          "refused:attributes",
          "refused:unlink-config",
          // The controls.
          "wrote:workspace",
          "wrote:git-inside",
          "staged:ok",
        ]),
      );
    }, 180_000);

    it("refuses the rename that would walk around the list, as far as it can", async () => {
      // The map has no rule for an entry, only for paths, so this rests on
      // Codex. `.git` itself is refused on both platforms, which is what keeps
      // the four files reachable only by their own denied names.
      const checkout = await createCheckout();
      const answers = await measure(checkout);
      expect(answers).toContain("refused:rename-git");

      if (process.platform === "linux") {
        // Measured, recorded in docs/security.md, and left open on purpose:
        // what a renamed `.git/info` buys is an *untracked* attributes file,
        // and the config half that would have to define the filter driver it
        // names stays refused. Closing it needs `.git/info` read-only, which
        // takes `git sparse-checkout` from every Codex turn for nothing gained.
        // If a future Codex refuses it, this is what says the doc is stale.
        expect(answers).toContain("renamed:info");
      } else {
        expect(answers).toContain("refused:rename-info");
      }
    }, 180_000);
  },
);
