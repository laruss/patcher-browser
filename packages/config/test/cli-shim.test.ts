import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cliShimContents,
  resolveCliShimDir,
  resolveCliShimPath,
  writeCliShim,
  type CliShimTarget,
} from "../src/cli-shim.js";

/**
 * The shim is the only thing standing between an agent outside Patcher and a
 * filesystem search for a binary, so what matters is that it is executable, that
 * it points where it was told, and that a second daemon start does not undo it.
 *
 * Several cases below **run** it rather than reading it. Inspecting the script
 * text was all this file did at first, and it is why the shim shipped handing
 * the CLI an empty environment: every by-hand check had exported the variables
 * itself, and no test could tell the difference. A shell script's behaviour is
 * cheap to observe, so it is observed.
 */

const execFileAsync = promisify(execFile);

const TARGET: CliShimTarget = {
  serverUrl: "http://127.0.0.1:19123",
  dataDir: "/tmp/patcher-instance",
  hostDaemonPort: 27123,
};

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "patcher-cli-shim-"));
});

afterEach(async () => {
  await rm(dataDir, { force: true, recursive: true });
});

/**
 * A stand-in for the CLI that reports the environment it was handed.
 *
 * The point of the shim is what the *child* sees, so the child is what answers.
 */
async function writeEnvEchoingExecutable(): Promise<string> {
  const path = join(dataDir, "fake-patcher");
  await writeFile(
    path,
    `#!/bin/sh\nfor name in PATCHER_SERVER_URL PATCHER_DATA_DIR PATCHER_HOST_DAEMON_PORT; do\n  eval "printf '%s=%s\\n' \\"\\$name\\" \\"\\$$name\\""\ndone\nprintf 'args=%s\\n' "$*"\n`,
    { mode: 0o755 },
  );
  await chmod(path, 0o755);
  return path;
}

/** Run the shim with a deliberately bare environment, and parse what it saw. */
async function runShim(
  args: readonly string[] = [],
  env: NodeJS.ProcessEnv = {},
): Promise<Record<string, string>> {
  const { stdout } = await execFileAsync(resolveCliShimPath(dataDir), args, {
    env: { PATH: "/usr/bin:/bin", ...env },
  });
  return Object.fromEntries(
    stdout
      .split("\n")
      .filter((line) => line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

describe("the patcher CLI shim", () => {
  it("writes an executable script that execs the real binary", async () => {
    const result = await writeCliShim({
      dataDir,
      executablePath: "/opt/patcher/patcher",
      target: TARGET,
      platform: "darwin",
    });

    expect(result).toEqual({
      outcome: "written",
      path: resolveCliShimPath(dataDir),
    });
    const contents = await readFile(resolveCliShimPath(dataDir), "utf8");
    expect(contents.startsWith("#!/bin/sh\n")).toBe(true);
    // `exec`, so the CLI owns its own exit code and signals rather than
    // reporting them through a wrapper.
    expect(contents).toContain(`exec '/opt/patcher/patcher' "$@"`);
    const mode = (await stat(resolveCliShimPath(dataDir))).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("hands the CLI this install's server, not the production default", async () => {
    // The defect this whole target exists for: without it the CLI falls back to
    // `127.0.0.1:38986` and `~/.patcher`, which on a source checkout or a
    // non-default server is a different Patcher — and the command then reports
    // that Patcher is not running while Patcher is running.
    await writeCliShim({
      dataDir,
      executablePath: await writeEnvEchoingExecutable(),
      target: TARGET,
      platform: "darwin",
    });

    expect(await runShim()).toMatchObject({
      PATCHER_SERVER_URL: TARGET.serverUrl,
      PATCHER_DATA_DIR: TARGET.dataDir,
      PATCHER_HOST_DAEMON_PORT: "27123",
    });
  });

  it("lets a caller's own environment win", async () => {
    // Someone with two installs, or a developer pointing a shell at the other
    // one. Overruling them would make the shim a trap rather than a default.
    await writeCliShim({
      dataDir,
      executablePath: await writeEnvEchoingExecutable(),
      target: TARGET,
      platform: "darwin",
    });

    const seen = await runShim([], {
      PATCHER_SERVER_URL: "http://127.0.0.1:38986",
    });
    expect(seen.PATCHER_SERVER_URL).toBe("http://127.0.0.1:38986");
    // The ones they did not set still come from the shim.
    expect(seen.PATCHER_DATA_DIR).toBe(TARGET.dataDir);
  });

  it("treats an empty value as a caller's answer, not as absence", async () => {
    // `${VAR:-…}` would overrule this one; `${VAR+set}` does not. Someone who
    // exported an empty server URL means "none", and silently substituting a
    // URL would send their command somewhere they did not ask for.
    await writeCliShim({
      dataDir,
      executablePath: await writeEnvEchoingExecutable(),
      target: TARGET,
      platform: "darwin",
    });

    expect(
      (await runShim([], { PATCHER_SERVER_URL: "" })).PATCHER_SERVER_URL,
    ).toBe("");
  });

  it("passes arguments through whole, spaces and all", async () => {
    await writeCliShim({
      dataDir,
      executablePath: await writeEnvEchoingExecutable(),
      target: TARGET,
      platform: "darwin",
    });

    expect((await runShim(["browser", "fill", "e3", "two words"])).args).toBe(
      "browser fill e3 two words",
    );
  });

  it("quotes a path with a space in it", async () => {
    // The default install is under `/Applications/Patcher.app`, and a checkout
    // can be anywhere. An unquoted path here would split into two arguments and
    // fail as "command not found" on the first word.
    await writeCliShim({
      dataDir,
      executablePath: "/Users/a b/Patcher.app/Contents/patcher",
      target: { ...TARGET, dataDir: "/Users/a b/.patcher" },
      platform: "darwin",
    });
    const contents = await readFile(resolveCliShimPath(dataDir), "utf8");
    expect(contents).toContain(
      `exec '/Users/a b/Patcher.app/Contents/patcher' "$@"`,
    );
    expect(contents).toContain(`export PATCHER_DATA_DIR='/Users/a b/.patcher'`);
  });

  it("survives a single quote in a path", async () => {
    await writeCliShim({
      dataDir,
      executablePath: await writeEnvEchoingExecutable(),
      target: { ...TARGET, dataDir: "/Users/o'brien/.patcher" },
      platform: "darwin",
    });

    // Run rather than read: this is the escaping that turns into a syntax error
    // or, worse, into a second command, and only `sh` can say whether it holds.
    expect((await runShim()).PATCHER_DATA_DIR).toBe("/Users/o'brien/.patcher");
  });

  it("omits the daemon port when there is none", async () => {
    await writeCliShim({
      dataDir,
      executablePath: "/opt/patcher/patcher",
      target: { serverUrl: TARGET.serverUrl, dataDir: TARGET.dataDir },
      platform: "darwin",
    });
    expect(await readFile(resolveCliShimPath(dataDir), "utf8")).not.toContain(
      "PATCHER_HOST_DAEMON_PORT",
    );
  });

  it("leaves an identical shim alone on the next start", async () => {
    const args = {
      dataDir,
      executablePath: "/opt/patcher/patcher",
      target: TARGET,
      platform: "darwin" as const,
    };
    expect((await writeCliShim(args)).outcome).toBe("written");
    expect((await writeCliShim(args)).outcome).toBe("unchanged");
  });

  it("rewrites one that points at an old install", async () => {
    await writeCliShim({
      dataDir,
      executablePath: "/opt/old/patcher",
      target: TARGET,
      platform: "darwin",
    });
    const result = await writeCliShim({
      dataDir,
      executablePath: "/opt/new/patcher",
      target: TARGET,
      platform: "darwin",
    });

    expect(result.outcome).toBe("written");
    expect(await readFile(resolveCliShimPath(dataDir), "utf8")).toContain(
      "/opt/new/patcher",
    );
  });

  it("rewrites one whose server moved, not only its binary", async () => {
    // A dev checkout's port is derived from its path, and a daemon can be
    // repointed. The comparison is over the whole body for exactly this.
    await writeCliShim({
      dataDir,
      executablePath: "/opt/patcher/patcher",
      target: TARGET,
      platform: "darwin",
    });
    const result = await writeCliShim({
      dataDir,
      executablePath: "/opt/patcher/patcher",
      target: { ...TARGET, serverUrl: "http://127.0.0.1:25421" },
      platform: "darwin",
    });

    expect(result.outcome).toBe("written");
    expect(await readFile(resolveCliShimPath(dataDir), "utf8")).toContain(
      "25421",
    );
  });

  it("restores the execute bit on a shim that lost it", async () => {
    // `writeFile`'s `mode` applies only when it creates the file, so an
    // overwrite would otherwise keep whatever mode was there — and a shim
    // without the bit fails as "command not found", which reads as "Patcher is
    // not installed" rather than as a broken file.
    await mkdir(resolveCliShimDir(dataDir), { recursive: true });
    await writeFile(
      resolveCliShimPath(dataDir),
      cliShimContents("/opt/patcher/patcher", TARGET),
    );
    await chmod(resolveCliShimPath(dataDir), 0o644);

    const result = await writeCliShim({
      dataDir,
      executablePath: "/opt/patcher/patcher",
      target: TARGET,
      platform: "darwin",
    });

    expect(result.outcome).toBe("unchanged");
    expect((await stat(resolveCliShimPath(dataDir))).mode & 0o777).toBe(0o755);
  });

  it("skips Windows rather than writing a script nothing runs", async () => {
    expect(
      await writeCliShim({
        dataDir,
        executablePath: "C:\\patcher\\patcher.exe",
        target: TARGET,
        platform: "win32",
      }),
    ).toEqual({ outcome: "skipped", reason: "windows" });
  });

  it("reports a failure instead of throwing", async () => {
    // A data directory that cannot be written is a machine that loses the
    // convenience, not a daemon that refuses to start.
    const result = await writeCliShim({
      dataDir: join(dataDir, "not-a-dir\0"),
      executablePath: "/opt/patcher/patcher",
      target: TARGET,
      platform: "darwin",
    });
    expect(result.outcome).toBe("failed");
  });
});
