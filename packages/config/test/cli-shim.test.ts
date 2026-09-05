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
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cliShimContents,
  resolveCliShimDir,
  resolveCliShimPath,
  writeCliShim,
} from "../src/cli-shim.js";

/**
 * The shim is the only thing standing between an agent outside Patcher and a
 * filesystem search for a binary, so what matters is that it is executable, that
 * it points where it was told, and that a second daemon start does not undo it.
 */

let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "patcher-cli-shim-"));
});

afterEach(async () => {
  await rm(dataDir, { force: true, recursive: true });
});

describe("the patcher CLI shim", () => {
  it("writes an executable script that execs the real binary", async () => {
    const result = await writeCliShim({
      dataDir,
      executablePath: "/opt/patcher/patcher",
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
    expect(contents).toContain('exec "/opt/patcher/patcher" "$@"');
    const mode = (await stat(resolveCliShimPath(dataDir))).mode & 0o777;
    expect(mode).toBe(0o755);
  });

  it("quotes a path with a space in it", async () => {
    // The default install is under `/Applications/Patcher.app`, and a checkout
    // can be anywhere. An unquoted path here would split into two arguments and
    // fail as "command not found" on the first word.
    await writeCliShim({
      dataDir,
      executablePath: "/Users/a b/Patcher.app/Contents/patcher",
      platform: "darwin",
    });
    const contents = await readFile(resolveCliShimPath(dataDir), "utf8");
    expect(contents).toContain(
      'exec "/Users/a b/Patcher.app/Contents/patcher" "$@"',
    );
  });

  it("leaves an identical shim alone on the next start", async () => {
    const args = {
      dataDir,
      executablePath: "/opt/patcher/patcher",
      platform: "darwin" as const,
    };
    expect((await writeCliShim(args)).outcome).toBe("written");
    expect((await writeCliShim(args)).outcome).toBe("unchanged");
  });

  it("rewrites one that points at an old install", async () => {
    await writeCliShim({
      dataDir,
      executablePath: "/opt/old/patcher",
      platform: "darwin",
    });
    const result = await writeCliShim({
      dataDir,
      executablePath: "/opt/new/patcher",
      platform: "darwin",
    });

    expect(result.outcome).toBe("written");
    expect(await readFile(resolveCliShimPath(dataDir), "utf8")).toContain(
      "/opt/new/patcher",
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
      cliShimContents("/opt/patcher/patcher"),
    );
    await chmod(resolveCliShimPath(dataDir), 0o644);

    const result = await writeCliShim({
      dataDir,
      executablePath: "/opt/patcher/patcher",
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
      platform: "darwin",
    });
    expect(result.outcome).toBe("failed");
  });
});
