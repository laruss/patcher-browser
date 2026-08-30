import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildTerminalSandboxLaunch,
  type TerminalSandboxPolicy,
} from "./terminal-sandbox.js";

/**
 * The terminal a turn's agent opens, confined the way the turn is.
 *
 * These run the sandbox rather than inspecting the arguments it would pass:
 * an argv assertion proves the code builds what it meant to build and nothing
 * about whether the kernel agrees. macOS composes the profile from Seatbelt,
 * Linux from bubblewrap, and CI installs bubblewrap for exactly this reason.
 */

const OUTSIDE_PROBE_PATH = path.join(
  homedir(),
  ".patcher-terminal-sandbox-test-probe",
);

interface Fixture {
  cleanup: () => void;
  policy: TerminalSandboxPolicy;
  workspacePath: string;
}

function createFixture(): Fixture {
  const rootPath = mkdtempSync(path.join(tmpdir(), "patcher-terminal-sbx-"));
  const workspacePath = path.join(rootPath, "workspace");
  const gitDir = path.join(workspacePath, ".git");
  const secretsDir = path.join(rootPath, "secrets");
  mkdirSync(path.join(gitDir, "hooks"), { recursive: true });
  mkdirSync(secretsDir, { recursive: true });
  writeFileSync(path.join(gitDir, "config"), "[core]\n");
  writeFileSync(path.join(gitDir, "index"), "");
  writeFileSync(path.join(secretsDir, "app-key.json"), "APP-KEY\n");
  return {
    cleanup: () => rmSync(rootPath, { recursive: true, force: true }),
    policy: {
      workspacePath,
      writableRoots: [],
      readOnlyPaths: [path.join(gitDir, "config"), path.join(gitDir, "hooks")],
      deniedReadPaths: [path.join(secretsDir, "app-key.json")],
    },
    workspacePath,
  };
}

function runInSandbox(fixture: Fixture, script: string): string {
  const launch = buildTerminalSandboxLaunch({
    command: { file: "/bin/sh", args: ["-c", script] },
    cwd: fixture.workspacePath,
    env: process.env,
    platform: process.platform,
    policy: fixture.policy,
  });
  if (!launch.sandboxed) {
    throw new Error(`No sandbox on this machine: ${launch.reason}`);
  }
  const result = spawnSync(launch.command.file, [...launch.command.args], {
    cwd: fixture.workspacePath,
    encoding: "utf8",
    env: process.env,
  });
  // A sandbox that could not start at all is not a denial, and reading its
  // output as one would turn "bubblewrap is broken here" into a green test.
  expect(result.error).toBeUndefined();
  return `${result.stdout}${result.stderr}`;
}

let fixture: Fixture | null = null;

afterEach(() => {
  fixture?.cleanup();
  fixture = null;
  rmSync(OUTSIDE_PROBE_PATH, { force: true });
});

describe.skipIf(process.platform === "win32")(
  "a terminal inside the turn's boundary",
  () => {
    it("writes inside the workspace and nowhere else", () => {
      fixture = createFixture();

      const output = runInSandbox(
        fixture,
        `echo inside > ./written.txt && cat ./written.txt; ` +
          `echo outside > ${OUTSIDE_PROBE_PATH} && echo ESCAPED || echo refused`,
      );

      expect(output).toContain("inside");
      expect(output).toContain("refused");
      expect(output).not.toContain("ESCAPED");
    });

    it("leaves git working while the files that decide what git runs stay put", () => {
      fixture = createFixture();

      const output = runInSandbox(
        fixture,
        `cat .git/config; ` +
          `echo x >> .git/config && echo CONFIG-WRITTEN || echo config-refused; ` +
          `echo x > .git/hooks/pre-commit && echo HOOK-WRITTEN || echo hook-refused; ` +
          // The index is what `git add` writes, and denying `.git` wholesale is
          // what takes committing away — so this one has to succeed.
          `echo x > .git/index && echo index-writable || echo INDEX-REFUSED`,
      );

      expect(output).toContain("[core]");
      expect(output).toContain("config-refused");
      expect(output).toContain("hook-refused");
      expect(output).toContain("index-writable");
    });

    it("refuses to read a credential file", () => {
      fixture = createFixture();
      const credentialPath = fixture.policy.deniedReadPaths[0] ?? "";

      const output = runInSandbox(
        fixture,
        `cat ${credentialPath} && echo READ-OK || echo read-refused`,
      );

      expect(output).not.toContain("APP-KEY");
      expect(output).toContain("read-refused");
    });
  },
);

describe("a machine that cannot build one", () => {
  it("says what is missing rather than starting an unconfined shell", () => {
    const launch = buildTerminalSandboxLaunch({
      command: { file: "/bin/sh", args: [] },
      cwd: "/tmp",
      env: { PATH: "" },
      platform: "linux",
      policy: {
        workspacePath: "/tmp",
        writableRoots: [],
        readOnlyPaths: [],
        deniedReadPaths: [],
      },
      // Empty rather than absent: the real distribution paths exist on the
      // Linux machine CI runs on, where the fallback would find bubblewrap.
      wellKnownHelperPaths: ["/nonexistent-patcher-probe/bwrap"],
    });

    expect(launch.sandboxed).toBe(false);
    if (launch.sandboxed) return;
    expect(launch.reason).toContain("bubblewrap");
    expect(launch.remedy).toContain("install bubblewrap");
  });

  it("has nothing to offer a platform with no backend", () => {
    const launch = buildTerminalSandboxLaunch({
      command: { file: "cmd.exe", args: [] },
      cwd: "C:/repo",
      env: {},
      platform: "win32",
      policy: {
        workspacePath: "C:/repo",
        writableRoots: [],
        readOnlyPaths: [],
        deniedReadPaths: [],
      },
    });

    expect(launch.sandboxed).toBe(false);
  });
});

describe("the macOS profile", () => {
  it.skipIf(process.platform !== "darwin")(
    "survives a path with a quote in it",
    () => {
      // Seatbelt takes the profile as one quoted string, so an unescaped path
      // would not be a denied path — it would be a broken profile, and the
      // sandbox would refuse to start at all.
      const rootPath = mkdtempSync(path.join(tmpdir(), "patcher-quote-"));
      const quotedDir = path.join(rootPath, 'a"b');
      mkdirSync(quotedDir, { recursive: true });
      try {
        const launch = buildTerminalSandboxLaunch({
          command: { file: "/bin/sh", args: ["-c", "echo started"] },
          cwd: quotedDir,
          env: process.env,
          platform: "darwin",
          policy: {
            workspacePath: quotedDir,
            writableRoots: [],
            readOnlyPaths: [],
            deniedReadPaths: [],
          },
        });
        expect(launch.sandboxed).toBe(true);
        if (!launch.sandboxed) return;
        const output = execFileSync(
          launch.command.file,
          [...launch.command.args],
          { cwd: quotedDir, encoding: "utf8" },
        );
        expect(output).toContain("started");
      } finally {
        rmSync(rootPath, { recursive: true, force: true });
      }
    },
  );
});
