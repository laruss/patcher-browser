import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { SandboxLoopback } from "../sandbox-loopback.js";
import { resolveSandboxNetRelayArgv } from "../sandbox-net-relay.js";
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

function buildLaunchHere(
  fixture: Fixture,
  script: string,
): ReturnType<typeof buildTerminalSandboxLaunch> {
  return buildTerminalSandboxLaunch({
    command: { file: "/bin/sh", args: ["-c", script] },
    cwd: fixture.workspacePath,
    env: process.env,
    platform: process.platform,
    policy: fixture.policy,
  });
}

/**
 * Whether this machine can build one at all, asked once.
 *
 * A machine that cannot is not a machine to skip quietly on: the suite asserts
 * the refusal instead, so it says something true here either way. Ubuntu 24.04
 * restricts unprivileged user namespaces through AppArmor, which is exactly
 * such a machine until the restriction is lifted — CI lifts it.
 */
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

function runInSandbox(fixture: Fixture, script: string): string {
  const launch = buildLaunchHere(fixture, script);
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

/** A loopback listener that answers, so a probe can tell reached from refused. */
const loopbackServers: net.Server[] = [];

async function listenOnLoopback(): Promise<number> {
  const server = net.createServer((socket) => socket.end("ok\n"));
  loopbackServers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as net.AddressInfo).port;
}

/**
 * Run as the confined command: connects to the port the daemon exposed, to one
 * it did not, and to something off the machine, and says which answered.
 *
 * A file rather than `-e`, so the three attempts read as three attempts.
 */
const LOOPBACK_PROBE_SOURCE = `import net from "node:net";
const attempt = (label, port, host) =>
  new Promise((resolve) => {
    const socket = net.connect(port, host);
    const done = (outcome) => {
      socket.destroy();
      console.log(label + " " + outcome);
      resolve();
    };
    socket.setTimeout(4000, () => done("refused"));
    socket.on("connect", () => done("reached"));
    socket.on("error", () => done("refused"));
  });
await attempt("exposed-port", Number(process.argv[2]), "127.0.0.1");
await attempt("withheld-port", Number(process.argv[3]), "127.0.0.1");
await attempt("off-the-machine", 443, "example.com");
`;

let fixture: Fixture | null = null;

afterEach(() => {
  fixture?.cleanup();
  fixture = null;
  for (const server of loopbackServers.splice(0)) server.close();
  rmSync(OUTSIDE_PROBE_PATH, { force: true });
});

describe.skipIf(!SANDBOX_AVAILABLE_HERE)(
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

describe.skipIf(SANDBOX_AVAILABLE_HERE)(
  "a machine that cannot build one at all",
  () => {
    it("says so rather than starting an unconfined shell", () => {
      // The other side of the skip above: on a machine with no usable backend
      // this is what the suite proves, so neither branch is silent.
      const fixture = createFixture();
      fixture.cleanup();
      const launch = buildLaunchHere(fixture, "true");

      expect(launch.sandboxed).toBe(false);
      if (launch.sandboxed) return;
      expect(launch.reason.length).toBeGreaterThan(0);
      expect(launch.remedy).toContain("Full Access");
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

describe("the Linux network boundary", () => {
  it("refuses a confined launch with no relay to carry loopback in", () => {
    // Asserted from any machine: this check comes before bubblewrap is looked
    // for, because a launch that asks for a confined network without the relay
    // is a mistake in the caller rather than a fact about the host.
    const launch = buildTerminalSandboxLaunch({
      command: { file: "/bin/sh", args: ["-c", "true"] },
      cwd: "/tmp",
      env: { PATH: "" },
      platform: "linux",
      policy: {
        workspacePath: "/tmp",
        writableRoots: [],
        readOnlyPaths: [],
        deniedReadPaths: [],
        egressConfined: true,
      },
    });

    expect(launch.sandboxed).toBe(false);
    if (launch.sandboxed) return;
    expect(launch.reason).toContain("network namespace");
    expect(launch.remedy).toContain("Full Access");
  });

  it.skipIf(process.platform !== "linux" || !SANDBOX_AVAILABLE_HERE)(
    "keeps the loopback it was handed, and only that",
    async () => {
      // The whole Linux half, run rather than inspected: `--unshare-net` takes
      // the network *and* the host's loopback, and the relay in front of the
      // command puts back exactly the ports the daemon exposed a socket for.
      // Three claims, and the middle one is what makes this narrower than the
      // macOS profile, which allows all of localhost.
      fixture = createFixture();
      const exposed = await listenOnLoopback();
      const withheld = await listenOnLoopback();
      const loopback = new SandboxLoopback();
      try {
        const socketDir = await loopback.open([exposed]);
        const probePath = path.join(fixture.workspacePath, "probe.mjs");
        writeFileSync(probePath, LOOPBACK_PROBE_SOURCE);
        const launch = buildTerminalSandboxLaunch({
          command: {
            file: process.execPath,
            args: [probePath, String(exposed), String(withheld)],
          },
          cwd: fixture.workspacePath,
          env: process.env,
          platform: "linux",
          policy: {
            ...fixture.policy,
            egressConfined: true,
            loopbackRelay: {
              argv: resolveSandboxNetRelayArgv({}),
              socketDir,
            },
          },
        });
        expect(launch.sandboxed).toBe(true);
        if (!launch.sandboxed) return;

        const result = spawnSync(
          launch.command.file,
          [...launch.command.args],
          { cwd: fixture.workspacePath, encoding: "utf8", env: process.env },
        );
        expect(result.error).toBeUndefined();
        const output = `${result.stdout}${result.stderr}`;

        expect(output).toContain("exposed-port reached");
        expect(output).toContain("withheld-port refused");
        expect(output).toContain("off-the-machine refused");
      } finally {
        await loopback.close();
      }
    },
  );
});

/**
 * The IPC half of the macOS profile: a write or a launch a Mach service makes
 * on the shell's behalf, which the file rules say nothing about.
 *
 * These only ever run on a developer's Mac — CI runs the suites on
 * `ubuntu-latest` — so what CI protects here is the Linux backend and nothing
 * else. That is the same reach the quote test below has, and the reason each of
 * these runs the sandbox rather than reading the profile back: a profile
 * assertion would pass on Linux while proving nothing anywhere.
 */
describe("the macOS profile's IPC boundary", () => {
  it.skipIf(process.platform !== "darwin")(
    "refuses a preference write cfprefsd would make for it",
    () => {
      fixture = createFixture();
      // Unique, so a run that fails cannot be a run that read the last one's
      // leftovers — and removed either way below, because a broken boundary is
      // exactly the case where the domain does get written.
      const domain = `patcher.terminal.sandbox.test.${process.pid}`;
      const plistPath = path.join(
        homedir(),
        "Library",
        "Preferences",
        `${domain}.plist`,
      );

      try {
        const output = runInSandbox(
          fixture,
          `defaults write ${domain} escaped -bool true && echo WROTE || echo write-refused`,
        );

        expect(output).toContain("write-refused");
        expect(existsSync(plistPath)).toBe(false);
        // The deny is on writing, not on the service: a profile that took
        // cfprefsd away by name would leave every tool that reads a preference
        // failing, so the read has to keep answering.
        expect(
          runInSandbox(fixture, `defaults read ${domain} 2>&1; echo read-ran`),
        ).toContain("read-ran");
      } finally {
        rmSync(plistPath, { force: true });
      }
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "refuses to launch a program outside the sandbox through LaunchServices",
    () => {
      fixture = createFixture();
      // The escape as an agent would build it: the bundle goes in the workspace
      // the turn may write, and `open` asks launchd to run it — so the process
      // that appears is not a child of this one and none of the rules above
      // reach it. Its executable only touches the fixture, so a broken boundary
      // leaves a marker to assert on and nothing on the machine.
      const markerPath = path.join(fixture.workspacePath, "..", "escaped");
      const bundlePath = path.join(fixture.workspacePath, "Escape.app");
      const executablePath = path.join(
        bundlePath,
        "Contents",
        "MacOS",
        "escape",
      );
      mkdirSync(path.dirname(executablePath), { recursive: true });
      writeFileSync(
        path.join(bundlePath, "Contents", "Info.plist"),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>escape</string>
<key>CFBundleIdentifier</key><string>patcher.terminal.sandbox.test.escape</string>
<key>CFBundleName</key><string>Escape</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`,
      );
      writeFileSync(
        executablePath,
        `#!/bin/sh\n/usr/bin/touch ${JSON.stringify(markerPath)}\n`,
      );
      chmodSync(executablePath, 0o755);

      const output = runInSandbox(
        fixture,
        `open -g ${JSON.stringify(bundlePath)} && echo OPENED || echo open-refused`,
      );

      // Two assertions, because either alone can be green for the wrong
      // reason: the marker could be absent on a machine that refused the
      // launch for its own reasons — Gatekeeper, a policy — and the refusal
      // message alone says nothing about whether something still ran.
      expect(output).toContain("open-refused");
      expect(output).toContain("_LSOpenURLsWithCompletionHandler");
      // launchd answers `open` before the program it starts has run, so the
      // marker needs a moment to appear if the boundary is broken.
      execFileSync("/bin/sleep", ["3"]);
      expect(existsSync(markerPath)).toBe(false);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "refuses an AppleEvent to an application outside the sandbox",
    () => {
      fixture = createFixture();

      // This one states the boundary rather than pinning the rule, and that is
      // deliberate: measured under a bare `(version 1)(allow default)`, the
      // same event is already refused, because a sandboxed process has no
      // apple-events entitlement. So removing `(deny appleevent-send)` leaves
      // this green — what the rule buys is that the refusal is the profile's,
      // which showed as a changed error (-600, the application "isn't
      // running", instead of -10004, a privilege violation) rather than as a
      // failing test. Kept because the statement is worth holding either way:
      // Finder is running, and telling it anything must not work.
      const output = runInSandbox(
        fixture,
        `osascript -e 'tell application "Finder" to get name of home' && echo SENT || echo event-refused`,
      );

      expect(output).toContain("event-refused");
      expect(output).toContain("error");
    },
  );
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
