import { spawnSync } from "node:child_process";
import net from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProviderSandboxLauncher,
  egressProxyEnv,
} from "./provider-sandbox.js";

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

describe("a turn that confines egress", () => {
  it("is refused on Linux, where taking the network takes loopback too", () => {
    // Measured on bubblewrap 0.9.0: `--unshare-net` is the only unprivileged
    // way to take the network, and the namespace it makes has its own loopback
    // — so the proxy, the local server the `patcher` CLI talks to, and the
    // bridge an agent's plugin tools reach are all gone with it. Refusing beats
    // confining a turn into uselessness.
    const built = buildProviderSandboxLauncher({
      cwd: "/workspace",
      stateDirs: [],
      homeDirectory: "/home/somebody",
      additionalWorkspaceWriteRoots: [],
      protectedRepositoryPaths: [],
      protectedCredentialPaths: [],
      env: {},
      platform: "linux",
      egress: { proxyUrl: "http://patcher:tok@127.0.0.1:1" },
    });

    if (built.sandboxed) throw new Error("Expected a refusal here");
    expect(built.reason).toContain("network namespace");
    expect(built.remedy).toContain("Full Access");
  });

  it("hands the process the proxy, in every spelling a client reads", () => {
    // Both cases, because clients disagree: curl and git read the uppercase
    // names, plenty of libraries read the lowercase ones. Asserted on the
    // environment builder rather than through a launcher, so it holds on the
    // platform CI runs these on — Linux, where a turn that asks for this is
    // refused and no launcher exists to carry it.
    const env = egressProxyEnv("http://patcher:tok@127.0.0.1:9");

    expect(env.HTTPS_PROXY).toBe("http://patcher:tok@127.0.0.1:9");
    expect(env.https_proxy).toBe("http://patcher:tok@127.0.0.1:9");
    expect(env.HTTP_PROXY).toBe("http://patcher:tok@127.0.0.1:9");
    expect(env.http_proxy).toBe("http://patcher:tok@127.0.0.1:9");
    // Without this an agent routes its own internal loopback through Patcher's
    // proxy: measured on opencode, arriving here as `GET 127.0.0.1:4096`.
    expect(env.NO_PROXY).toContain("127.0.0.1");
    expect(env.no_proxy).toContain("localhost");
    // Node's own clients ignore every variable above — measured, both `fetch`
    // and `https.get` answer ENOTFOUND with them set. This is what makes a
    // Node-based agent use the proxy on Node 24 and later; earlier versions
    // ignore it.
    expect(env.NODE_USE_ENV_PROXY).toBe("1");
  });
});

describe.skipIf(!SANDBOX_AVAILABLE_HERE || process.platform !== "darwin")(
  "egress, inside the boundary the kernel enforces",
  () => {
    /** Connect from inside the sandbox, and report how it failed. */
    function connectFromInside(args: {
      workspacePath: string;
      host: string;
      port: number;
      egress: boolean;
    }): string {
      const built = buildProviderSandboxLauncher({
        cwd: args.workspacePath,
        stateDirs: [],
        homeDirectory: homedir(),
        additionalWorkspaceWriteRoots: [],
        protectedRepositoryPaths: [],
        protectedCredentialPaths: [],
        env: process.env,
        platform: process.platform,
        ...(args.egress
          ? { egress: { proxyUrl: "http://patcher:tok@127.0.0.1:9" } }
          : {}),
      });
      if (!built.sandboxed) throw new Error(`No sandbox: ${built.reason}`);
      const result = spawnSync(
        built.launcher.command,
        [
          ...built.launcher.args,
          process.execPath,
          "-e",
          `const s = require("node:net").connect(${args.port}, ${JSON.stringify(args.host)});
           s.setTimeout(3000, () => { console.log("TIMEOUT"); process.exit(0); });
           s.on("connect", () => { console.log("CONNECTED"); process.exit(0); });
           s.on("error", (e) => { console.log(e.code); process.exit(0); });`,
        ],
        { cwd: args.workspacePath, encoding: "utf8", timeout: 20_000 },
      );
      return result.stdout.trim();
    }

    it("carries the proxy on the launch, and nothing when the turn does not ask", () => {
      const fixture = createFixture();
      fixtures.push(fixture);
      const shared = {
        cwd: fixture.workspacePath,
        stateDirs: [],
        homeDirectory: homedir(),
        additionalWorkspaceWriteRoots: [],
        protectedRepositoryPaths: [],
        protectedCredentialPaths: [],
        env: process.env,
        platform: process.platform,
      };

      const confined = buildProviderSandboxLauncher({
        ...shared,
        egress: { proxyUrl: "http://patcher:tok@127.0.0.1:9" },
      });
      const untouched = buildProviderSandboxLauncher(shared);

      if (!confined.sandboxed || !untouched.sandboxed) {
        throw new Error("Expected a sandbox here");
      }
      expect(confined.env?.HTTPS_PROXY).toBe("http://patcher:tok@127.0.0.1:9");
      expect(untouched.env).toBeUndefined();
    });

    it("refuses what leaves the machine and keeps loopback", async () => {
      const fixture = createFixture();
      fixtures.push(fixture);
      const server = net.createServer((socket) => socket.end());
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const loopbackPort = (server.address() as net.AddressInfo).port;

      try {
        // 203.0.113.0/24 is TEST-NET-3: reserved and unroutable, so the deny
        // has to be what answers rather than the internet. Denied it is EPERM
        // at once; allowed it would sit there until the timeout, which is what
        // the unconfined run below shows.
        expect(
          connectFromInside({
            workspacePath: fixture.workspacePath,
            host: "203.0.113.1",
            port: 443,
            egress: true,
          }),
        ).toBe("EPERM");
        expect(
          connectFromInside({
            workspacePath: fixture.workspacePath,
            host: "127.0.0.1",
            port: loopbackPort,
            egress: true,
          }),
        ).toBe("CONNECTED");
        expect(
          connectFromInside({
            workspacePath: fixture.workspacePath,
            host: "203.0.113.1",
            port: 443,
            egress: false,
          }),
        ).not.toBe("EPERM");
      } finally {
        server.close();
      }
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
