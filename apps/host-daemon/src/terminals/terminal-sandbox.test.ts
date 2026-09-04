import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
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
const fakeHelperDirectories: string[] = [];
const serviceSocketPaths: string[] = [];

afterEach(() => {
  fixture?.cleanup();
  fixture = null;
  for (const directory of fakeHelperDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const socketPath of serviceSocketPaths.splice(0)) {
    rmSync(socketPath, { force: true });
  }
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
    "cannot reach a service outside the namespace over its unix socket",
    async (ctx) => {
      // `--unshare-net` takes the network and leaves unix sockets, which are
      // not network-namespaced — that is how the relay reaches the daemon at
      // all — and `--ro-bind / /` carries every other one in. On a desktop the
      // one on the other end is the session bus or systemd, where the command
      // is `systemd-run --user`: an arbitrary program outside the sandbox, with
      // the network the sandbox just gave up.
      fixture = createFixture();
      const socketPath = await listenOnServiceSocket();
      if (socketPath === null) {
        ctx.skip(
          "no directory under /run this test can put a socket in, so the refusal below would prove nothing",
        );
        return;
      }
      const loopback = new SandboxLoopback();
      try {
        // The control, from outside the sandbox: the same socket has to answer
        // here, or "refused" inside says nothing about the boundary.
        const control = await new Promise<string>((resolve) => {
          const socket = net.connect(socketPath);
          socket.on("connect", () => {
            socket.destroy();
            resolve("reached");
          });
          socket.on("error", () => resolve("refused"));
        });
        expect(control).toBe("reached");

        const socketDir = await loopback.open([]);
        const probePath = path.join(fixture.workspacePath, "socket-probe.mjs");
        writeFileSync(probePath, UNIX_SOCKET_PROBE_SOURCE);
        const launch = buildTerminalSandboxLaunch({
          command: {
            file: process.execPath,
            args: [probePath, socketPath],
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
          {
            cwd: fixture.workspacePath,
            encoding: "utf8",
            env: process.env,
          },
        );
        expect(result.error).toBeUndefined();

        expect(`${result.stdout}${result.stderr}`).toContain("socket refused");
      } finally {
        await loopback.close();
      }
    },
  );

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
 * What the daemon asks bubblewrap before it trusts it, and how long it
 * remembers the answer.
 *
 * Run from any machine, because neither claim is about this host: a fake
 * `bwrap` on `PATH` records the argv it was called with and answers whatever
 * the test wants. That is the only way to see the *probe* at all — the launch's
 * own argv is returned rather than executed, so a test that ran the real thing
 * would measure the launch and not the question asked before it.
 */
function createFakeSandboxHelper(): {
  env: Record<string, string>;
  failurePath: string;
  probeCalls: () => string[];
} {
  const directory = mkdtempSync(path.join(tmpdir(), "patcher-fake-bwrap-"));
  fakeHelperDirectories.push(directory);
  const recordPath = path.join(directory, "calls");
  const failurePath = path.join(directory, "fail");
  const helperPath = path.join(directory, "bwrap");
  writeFileSync(
    helperPath,
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(recordPath)}\n` +
      `if [ -e ${JSON.stringify(failurePath)} ]; then\n` +
      `  echo 'setting up uid map: Permission denied' >&2\n  exit 1\nfi\nexit 0\n`,
  );
  chmodSync(helperPath, 0o755);
  return {
    env: { PATH: directory },
    failurePath,
    probeCalls: () =>
      existsSync(recordPath)
        ? readFileSync(recordPath, "utf8").trim().split("\n").filter(Boolean)
        : [],
  };
}

/**
 * A probe run as the confined command: connects to one unix socket path and
 * says whether it answered. A file rather than `-e`, so it reads as a probe.
 */
const UNIX_SOCKET_PROBE_SOURCE = `import net from "node:net";
const socket = net.connect(process.argv[2]);
const done = (outcome) => {
  socket.destroy();
  console.log("socket " + outcome);
  process.exit(0);
};
socket.setTimeout(4000, () => done("refused"));
socket.on("connect", () => done("reached"));
socket.on("error", () => done("refused"));
`;

/** A unix socket outside the sandbox, in a directory a service would use. */
async function listenOnServiceSocket(): Promise<string | null> {
  const candidates = [
    process.env.XDG_RUNTIME_DIR,
    `/run/user/${String(process.getuid?.() ?? 0)}`,
    "/run",
  ];
  for (const directory of candidates) {
    if (directory === undefined) continue;
    const socketPath = path.join(
      directory,
      `patcher-sandbox-test-${String(process.pid)}.sock`,
    );
    const server = net.createServer((socket) => socket.end("ok\n"));
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(socketPath, resolve);
      });
    } catch {
      continue;
    }
    serviceSocketPaths.push(socketPath);
    loopbackServers.push(server);
    return socketPath;
  }
  return null;
}

describe("the Linux process table", () => {
  it.skipIf(process.platform !== "linux" || !SANDBOX_AVAILABLE_HERE)(
    "cannot signal a process outside the sandbox",
    () => {
      // The PID namespace was shared, so the process table a confined turn saw
      // was the machine's: the daemon, the other terminals, everything. Reading
      // a sibling's environment was already refused by the user namespace —
      // that was #52 — and signalling it was not.
      fixture = createFixture();
      const victim = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
      try {
        // The control: the same signal from here, where nothing is confined,
        // has to be the thing that works — otherwise "refused" below could be
        // a pid that was never there.
        expect(victim.pid).toBeGreaterThan(0);
        expect(process.kill(victim.pid ?? 0, 0)).toBe(true);

        const output = runInSandbox(
          fixture,
          `kill ${String(victim.pid)} && echo KILLED || echo kill-refused`,
        );

        expect(output).toContain("kill-refused");
        expect(process.kill(victim.pid ?? 0, 0)).toBe(true);
      } finally {
        victim.kill("SIGKILL");
      }
    },
  );
});

describe("the Linux credential boundary", () => {
  it.skipIf(process.platform !== "linux" || !SANDBOX_AVAILABLE_HERE)(
    "hides a credential file the daemon has not written yet",
    () => {
      // Seatbelt denies a path whether or not anything is there; this backend
      // can only mount over what exists, and the file that does not exist yet
      // is the interesting one — SQLite writes `-wal` beside the database at
      // the first checkpoint, and a provider process outlives that.
      //
      // The directory has to sit outside every writable root for this to be
      // the case under test, and `/tmp` is always one on Linux, so the fixture
      // borrows the home directory the way the outside-write probe does.
      fixture = createFixture();
      const dataDir = mkdtempSync(
        path.join(homedir(), ".patcher-sandbox-test-data-"),
      );
      const existingPath = path.join(dataDir, "app-key");
      const laterPath = path.join(dataDir, "patcher.db-wal");
      const siblingPath = path.join(dataDir, "host-id");
      try {
        writeFileSync(existingPath, "APP-KEY\n");
        writeFileSync(siblingPath, "HOST-ID\n");
        fixture.policy = {
          ...fixture.policy,
          deniedReadPaths: [existingPath, laterPath],
        };
        // Written after the launch has started, from outside it, which is the
        // daemon's own timing. A *process* rather than a `setTimeout`: the
        // launch below runs through `spawnSync`, which holds the event loop, so
        // a timer would not fire until the sandbox had already looked and the
        // two refusals below would have been a file that was never there —
        // which is exactly how this test first passed on a machine that skips
        // it.
        spawn(
          "/bin/sh",
          ["-c", `sleep 1; printf 'NEWEST-ROWS\\n' > ${laterPath}`],
          { stdio: "ignore" },
        );

        const output = runInSandbox(
          fixture,
          `cat ${existingPath} || echo existing-refused; ` +
            `sleep 2; cat ${laterPath} || echo later-refused; ` +
            `cat ${siblingPath} || echo SIBLING-REFUSED`,
        );

        // The control is the sibling: a directory replaced wholesale would
        // pass the two refusals and take the reads the sandbox is meant to
        // keep, and nothing here would say so.
        expect(output).toContain("HOST-ID");
        expect(output).toContain("existing-refused");
        expect(output).toContain("later-refused");
        expect(output).not.toContain("APP-KEY");
        expect(output).not.toContain("NEWEST-ROWS");
        // And the daemon's own write went through: bwrap creates a mount point
        // it has to make as a mode-0444 file, so a boundary built that way
        // would have left SQLite unable to write its own WAL.
        // The control, and the reason the writer is a process: this is the
        // file the sandbox could not see, read from the host after the launch.
        // Its own exit status is not asserted — `spawnSync` held the event
        // loop, so Node has not reaped it yet and `exitCode` is still null.
        expect(readFileSync(laterPath, "utf8")).toContain("NEWEST-ROWS");
      } finally {
        rmSync(dataDir, { recursive: true, force: true });
      }
    },
  );
});

describe("the Linux sandbox probe", () => {
  it("asks for the same namespaces the launch does", () => {
    const helper = createFakeSandboxHelper();

    const launch = buildTerminalSandboxLaunch({
      command: { file: "/bin/sh", args: ["-c", "true"] },
      cwd: tmpdir(),
      env: helper.env,
      platform: "linux",
      policy: {
        workspacePath: tmpdir(),
        writableRoots: [],
        readOnlyPaths: [],
        deniedReadPaths: [],
      },
    });

    expect(launch.sandboxed).toBe(true);
    if (!launch.sandboxed) return;
    // The probe, not the launch: one call, and it has to carry everything the
    // kernel could refuse. `--proc` was missing, so a machine that cannot
    // mount `/proc` passed here and killed the shell one step later instead.
    expect(helper.probeCalls()).toHaveLength(1);
    const probe = helper.probeCalls()[0] ?? "";
    expect(probe).toContain("--proc /proc");
    expect(probe).toContain("--unshare-pid");
    for (const flag of ["--proc", "--unshare-pid"]) {
      expect(launch.command.args.join(" "), flag).toContain(flag);
    }
  });

  it("keeps a success, and asks again a minute after a refusal", () => {
    const helper = createFakeSandboxHelper();
    const build = (): ReturnType<typeof buildTerminalSandboxLaunch> =>
      buildTerminalSandboxLaunch({
        command: { file: "/bin/sh", args: ["-c", "true"] },
        cwd: tmpdir(),
        env: helper.env,
        platform: "linux",
        policy: {
          workspacePath: tmpdir(),
          writableRoots: [],
          readOnlyPaths: [],
          deniedReadPaths: [],
        },
      });

    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      writeFileSync(helper.failurePath, "");
      expect(build().sandboxed).toBe(false);
      // Still refused a second later, which is the half worth keeping: the
      // probe costs a process and this is a per-terminal path.
      expect(build().sandboxed).toBe(false);
      expect(helper.probeCalls()).toHaveLength(1);

      // The remedy this module prints is something a person does while the
      // daemon runs — CI does it with one `sysctl` — so the refusal has to
      // expire. It used to be kept for the daemon's life.
      rmSync(helper.failurePath);
      expect(build().sandboxed).toBe(false);
      vi.setSystemTime(new Date(Date.now() + 61_000));
      expect(build().sandboxed).toBe(true);
      expect(helper.probeCalls()).toHaveLength(2);

      // And a success is kept: a machine that can build a namespace does not
      // stop being able to, so nothing asks again.
      writeFileSync(helper.failurePath, "");
      vi.setSystemTime(new Date(Date.now() + 600_000));
      expect(build().sandboxed).toBe(true);
      expect(helper.probeCalls()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
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
 *
 * Each one establishes its own positive control first, and that is the whole
 * design rather than caution. A refusal is the easiest thing in the world to
 * get for the wrong reason — a `PATH` without `/usr/bin`, a Mac with no GUI
 * session, Gatekeeper, an application that is not running — and every one of
 * those leaves the same "it was refused" the boundary leaves. So the shape here
 * is: prove the operation works outside the sandbox on this machine, then prove
 * it does not inside.
 */

/** Wait for a program `open` started, which runs after `open` has answered. */
function waitForLaunchedProgram(): void {
  execFileSync("/bin/sleep", ["3"]);
}

/**
 * A path as one word to `/bin/sh`.
 *
 * `JSON.stringify` is not this: it produces double quotes, where a `$` or a
 * backtick in the path is still expanded, and `TMPDIR` is the environment's to
 * choose. The suite has a test for a quote in a path for the same reason.
 */
function quoteForShell(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The bundle an agent would build: a program of its own, inside the workspace. */
function writeLaunchableBundle(bundlePath: string, markerPath: string): void {
  const executablePath = path.join(bundlePath, "Contents", "MacOS", "escape");
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
    `#!/bin/sh\n/usr/bin/touch ${quoteForShell(markerPath)}\n`,
  );
  chmodSync(executablePath, 0o755);
}

describe("the macOS profile's IPC boundary", () => {
  it.skipIf(process.platform !== "darwin")(
    "refuses the preference write cfprefsd would make for it, and keeps the read",
    () => {
      fixture = createFixture();
      // Unique to this process, and removed either way below — a broken
      // boundary is exactly the case where the domain gains a key.
      const domain = `patcher.terminal.sandbox.test.${process.pid}`;
      const plistPath = path.join(
        homedir(),
        "Library",
        "Preferences",
        `${domain}.plist`,
      );

      try {
        // The control, and it does two jobs: it proves `defaults` runs and
        // writes on this machine, and it gives the read below something to
        // answer with. Without it, a read that is refused and a read of a
        // domain that does not exist look the same.
        execFileSync("/usr/bin/defaults", [
          "write",
          domain,
          "seeded",
          "-bool",
          "true",
        ]);

        const output = runInSandbox(
          fixture,
          `/usr/bin/defaults read ${domain}; ` +
            `/usr/bin/defaults write ${domain} escaped -bool true && echo WROTE || echo write-refused; ` +
            `/usr/bin/defaults read ${domain}`,
        );

        // The read answers, so the deny is on writing rather than on the
        // service: a profile that took cfprefsd away by name would leave every
        // tool that reads a preference failing.
        expect(output).toContain("seeded = 1");
        expect(output).toContain("write-refused");
        // And the domain is what it was, asked from inside and from outside:
        // `defaults` reporting a failure is not the same statement as nothing
        // having been written, and the store this one lands in is the user's.
        expect(output).not.toContain("escaped");
        expect(
          spawnSync("/usr/bin/defaults", ["read", domain], {
            encoding: "utf8",
          }).stdout,
        ).not.toContain("escaped");
      } finally {
        spawnSync("/usr/bin/defaults", ["delete", domain]);
        rmSync(plistPath, { force: true });
      }
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "refuses to launch a program outside the sandbox through LaunchServices",
    (ctx) => {
      fixture = createFixture();
      // The bundle goes in the workspace the turn may write, and `open` asks
      // launchd to run it — so the process that appears is not a child of this
      // one and none of the rules above reach it. Its program only touches the
      // fixture, so a broken boundary leaves a marker to assert on and nothing
      // on the machine.
      const markerPath = path.join(fixture.workspacePath, "..", "escaped");
      const bundlePath = path.join(fixture.workspacePath, "Escape.app");
      writeLaunchableBundle(bundlePath, markerPath);

      // The control: the same bundle, opened from here. A Mac that refuses to
      // launch it at all — Gatekeeper, a policy — cannot tell the boundary's
      // refusal from its own, so it says so instead of passing. `spawnSync`
      // rather than `execFileSync`, because `open` failing is one of the ways
      // that machine presents and throwing here would read as a defect.
      spawnSync("/usr/bin/open", ["-g", bundlePath]);
      waitForLaunchedProgram();
      if (!existsSync(markerPath)) {
        ctx.skip(
          `this machine did not launch ${bundlePath} outside the sandbox either, so the refusal below would prove nothing`,
        );
        return;
      }
      rmSync(markerPath, { force: true });

      const output = runInSandbox(
        fixture,
        `open -g ${quoteForShell(bundlePath)} && echo OPENED || echo open-refused`,
      );

      // Both halves: the message says LaunchServices is what refused, and the
      // marker says nothing ran anyway.
      expect(output).toContain("open-refused");
      expect(output).toContain("_LSOpenURLsWithCompletionHandler");
      waitForLaunchedProgram();
      expect(existsSync(markerPath)).toBe(false);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "refuses an AppleEvent to an application outside the sandbox",
    (ctx) => {
      fixture = createFixture();
      const script = `tell application "Finder" to get name of home`;
      const homeName = path.basename(homedir());

      // The control again, and here it carries the assertion as well: this is
      // the answer the event returns when it goes through, so its absence
      // below is what "refused" means. A Mac with no GUI session, or one whose
      // automation permission this caller does not have, fails the same way
      // the boundary does — and says so rather than passing.
      const control = spawnSync("/usr/bin/osascript", ["-e", script], {
        encoding: "utf8",
      });
      if (control.status !== 0 || !control.stdout.includes(homeName)) {
        ctx.skip(
          `this machine does not answer '${script}' outside the sandbox (${control.status}), so the refusal below would prove nothing`,
        );
        return;
      }

      const output = runInSandbox(
        fixture,
        `osascript -e ${quoteForShell(script)} && echo SENT || echo event-refused`,
      );

      expect(output).toContain("event-refused");
      expect(output).not.toContain(homeName);
      // And refused by this profile, which is the part `(deny appleevent-send)`
      // adds: without the rule a sandboxed process is refused anyway, for
      // having no apple-events entitlement, and that refusal is a privilege
      // violation (-10004). Measured three times each way. Asserting the
      // absence of that code rather than the presence of the one seen with the
      // rule (-600, the application "isn't running") leaves room for macOS to
      // spell the profile's refusal differently without failing here.
      expect(output).not.toContain("-10004");
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
