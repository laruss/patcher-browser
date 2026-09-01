import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildProviderSandboxLauncher } from "./provider-sandbox.js";

/**
 * A provider's own process, confined the way the turn is.
 *
 * These run the sandbox rather than asserting the arguments it would pass: an
 * argv assertion proves the code built what it meant to and nothing about
 * whether the kernel agrees. The provider being confined at all is the point —
 * ACP's `accept-edits` is a path check in the bridge, and the agent's own shell
 * is not held to it, which is measurable: unconfined, a real Cursor turn's shell
 * wrote into the home directory.
 *
 * The same launcher goes in front of Pi's bridge, and there it has to hold one
 * more thing: Pi's tools are `fs` calls in that process rather than commands in
 * a child of it, so a boundary that only reached children would confine nothing
 * Pi does. The last test here is that claim.
 */

const OUTSIDE_PROBE_PATH = path.join(
  homedir(),
  ".patcher-acp-sandbox-test-probe",
);

const STATE_DIR_NAME = ".patcher-acp-sandbox-test-state";
const STATE_DIR_PATH = path.join(homedir(), STATE_DIR_NAME);

interface Fixture {
  cleanup: () => void;
  workspacePath: string;
}

function createFixture(): Fixture {
  const rootPath = mkdtempSync(path.join(tmpdir(), "patcher-acp-sbx-"));
  const workspacePath = path.join(rootPath, "workspace");
  mkdirSync(workspacePath, { recursive: true });
  mkdirSync(STATE_DIR_PATH, { recursive: true });
  return {
    cleanup: () => {
      rmSync(rootPath, { force: true, recursive: true });
      rmSync(STATE_DIR_PATH, { force: true, recursive: true });
    },
    workspacePath,
  };
}

/**
 * What the bridge would spawn: the launcher, then the agent's own argv. The
 * agent here is a shell, because what is being measured is the boundary.
 */
function launch(args: {
  workspacePath: string;
  shellCommand: string;
  stateDirs?: readonly string[];
}):
  | { sandboxed: true; command: string; args: string[] }
  | { sandboxed: false; reason: string; remedy: string } {
  const built = buildProviderSandboxLauncher({
    cwd: args.workspacePath,
    stateDirs: args.stateDirs ?? [STATE_DIR_NAME],
    homeDirectory: homedir(),
    additionalWorkspaceWriteRoots: [],
    protectedRepositoryPaths: [],
    protectedCredentialPaths: [],
    env: process.env,
    platform: process.platform,
  });
  return built.sandboxed
    ? {
        sandboxed: true,
        command: built.launcher.command,
        args: [...built.launcher.args, "/bin/sh", "-c", args.shellCommand],
      }
    : built;
}

/** Whether this machine can build one at all; see the terminal sandbox tests. */
const SANDBOX_AVAILABLE_HERE = (() => {
  const rootPath = mkdtempSync(path.join(tmpdir(), "patcher-acp-sbx-probe-"));
  try {
    const built = launch({ workspacePath: rootPath, shellCommand: "true" });
    if (!built.sandboxed) return false;
    return (
      spawnSync(built.command, built.args, { cwd: rootPath, timeout: 10_000 })
        .status === 0
    );
  } finally {
    rmSync(rootPath, { force: true, recursive: true });
  }
})();

const fixtures: Fixture[] = [];

afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.cleanup();
  rmSync(OUTSIDE_PROBE_PATH, { force: true });
});

describe("a daemon with no HOME", () => {
  it("refuses rather than confining the provider away from its own state", () => {
    // Granting nothing would build a sandbox the provider cannot start in, and
    // the failure would arrive as the agent's own EPERM instead of an answer
    // from Patcher. Platform-independent: it refuses before building anything.
    const built = buildProviderSandboxLauncher({
      cwd: "/workspace",
      stateDirs: [".cursor"],
      homeDirectory: undefined,
      additionalWorkspaceWriteRoots: [],
      protectedRepositoryPaths: [],
      protectedCredentialPaths: [],
      env: {},
      platform: process.platform,
    });

    if (built.sandboxed) throw new Error("Expected a refusal here");
    expect(built.reason).toContain(".cursor");
    expect(built.remedy).toContain("HOME");
  });
});

describe.skipIf(!SANDBOX_AVAILABLE_HERE)(
  "an ACP provider inside the turn's boundary",
  () => {
    it("writes inside the workspace and nowhere else", () => {
      const fixture = createFixture();
      fixtures.push(fixture);

      const inside = launch({
        workspacePath: fixture.workspacePath,
        shellCommand: "printf hi > ./from-agent.txt",
      });
      const outside = launch({
        workspacePath: fixture.workspacePath,
        shellCommand: `printf hi > ${OUTSIDE_PROBE_PATH}`,
      });
      if (!inside.sandboxed || !outside.sandboxed) {
        throw new Error("Expected a sandboxed launch");
      }

      expect(
        spawnSync(inside.command, inside.args, {
          cwd: fixture.workspacePath,
          timeout: 20_000,
        }).status,
      ).toBe(0);
      expect(
        existsSync(path.join(fixture.workspacePath, "from-agent.txt")),
      ).toBe(true);

      // The class this closes: the agent's own shell, which the bridge's path
      // check never covered.
      expect(
        spawnSync(outside.command, outside.args, {
          cwd: fixture.workspacePath,
          timeout: 20_000,
        }).status,
      ).not.toBe(0);
      expect(existsSync(OUTSIDE_PROBE_PATH)).toBe(false);
    });

    it("lets the provider write the state directory its profile declares", () => {
      // Measured, not assumed: `cursor-agent acp` cannot create a session until
      // `~/.cursor` is writable — it answers `EPERM … cli-config.json.tmp`. A
      // sandbox that confined this away would refuse every ACP turn.
      const fixture = createFixture();
      fixtures.push(fixture);
      const statePath = path.join(STATE_DIR_PATH, "cli-config.json");

      const built = launch({
        workspacePath: fixture.workspacePath,
        shellCommand: `printf '{}' > ${statePath}`,
      });
      if (!built.sandboxed) throw new Error("Expected a sandboxed launch");

      expect(
        spawnSync(built.command, built.args, {
          cwd: fixture.workspacePath,
          timeout: 20_000,
        }).status,
      ).toBe(0);
      expect(existsSync(statePath)).toBe(true);
    });

    it("confines the state directory it was not given", () => {
      // The profile's list is the grant. A provider that declared nothing gets
      // nothing, rather than the home directory by default.
      const fixture = createFixture();
      fixtures.push(fixture);
      const statePath = path.join(STATE_DIR_PATH, "cli-config.json");

      const built = launch({
        workspacePath: fixture.workspacePath,
        shellCommand: `printf '{}' > ${statePath}`,
        stateDirs: [],
      });
      if (!built.sandboxed) throw new Error("Expected a sandboxed launch");

      expect(
        spawnSync(built.command, built.args, {
          cwd: fixture.workspacePath,
          timeout: 20_000,
        }).status,
      ).not.toBe(0);
      expect(existsSync(statePath)).toBe(false);
    });
  },
);

describe.skipIf(!SANDBOX_AVAILABLE_HERE)(
  "a bridge whose own process is the boundary",
  () => {
    it("refuses the process its own write, not only its children's", () => {
      // Pi's edit tools run inside Patcher's bridge: no shell, no child, just
      // `fs.writeFileSync` on the process the launcher wraps. If the profile
      // held only what a process spawns, confining that bridge would buy
      // nothing at all.
      const fixture = createFixture();
      fixtures.push(fixture);

      const built = buildProviderSandboxLauncher({
        cwd: fixture.workspacePath,
        stateDirs: [STATE_DIR_NAME],
        homeDirectory: homedir(),
        additionalWorkspaceWriteRoots: [],
        protectedRepositoryPaths: [],
        protectedCredentialPaths: [],
        env: process.env,
        platform: process.platform,
      });
      if (!built.sandboxed) throw new Error("Expected a sandboxed launch");

      const writeInProcess = (targetPath: string): number | null =>
        spawnSync(
          built.launcher.command,
          [
            ...built.launcher.args,
            process.execPath,
            "-e",
            `require("node:fs").writeFileSync(${JSON.stringify(targetPath)}, "hi")`,
          ],
          { cwd: fixture.workspacePath, timeout: 20_000 },
        ).status;

      expect(
        writeInProcess(path.join(fixture.workspacePath, "in-process.txt")),
      ).toBe(0);
      expect(writeInProcess(OUTSIDE_PROBE_PATH)).not.toBe(0);
      expect(existsSync(OUTSIDE_PROBE_PATH)).toBe(false);
    });
  },
);

describe.skipIf(SANDBOX_AVAILABLE_HERE)(
  "an ACP provider on a machine that cannot sandbox",
  () => {
    it("refuses, and says what is missing and what to do", () => {
      const fixture = createFixture();
      fixtures.push(fixture);

      const built = launch({
        workspacePath: fixture.workspacePath,
        shellCommand: "true",
      });

      if (built.sandboxed) throw new Error("Expected a refusal here");
      expect(built.reason.length).toBeGreaterThan(0);
      expect(built.remedy.length).toBeGreaterThan(0);
    });
  },
);
