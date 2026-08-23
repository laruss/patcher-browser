import { execFile } from "node:child_process";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const testDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(testDir, "..", "..", "..", "..");

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, "'\\''")}'`;
}

describe("Patcher bin wrapper", () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), "patcher-cli-bin-"));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function createFakeRepo(): Promise<string> {
    const fakeRepoRoot = join(tempRoot, "repo");
    const fakeBinDir = join(fakeRepoRoot, "apps", "cli", "bin");
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(
      join(fakeRepoRoot, "package.json"),
      JSON.stringify({ name: "Patcher", private: true }),
    );
    await copyFile(
      join(repoRoot, "apps", "cli", "bin", "patcher"),
      join(fakeBinDir, "patcher"),
    );
    await chmod(join(fakeBinDir, "patcher"), 0o755);
    return fakeRepoRoot;
  }

  /**
   * A stand-in for the package manager the wrapper builds with.
   *
   * It has to be named for whichever one `bin/patcher` actually calls: a stub named
   * for the wrong one is never consulted, the real binary runs against a
   * fixture repo that has no scripts, and the failure ("Script not found") is
   * about the fixture rather than about the wrapper.
   */
  async function writeFakeBun(content: string): Promise<string> {
    const fakeBinDir = join(tempRoot, "fake-bin");
    await mkdir(fakeBinDir, { recursive: true });
    const fakeBunPath = join(fakeBinDir, "bun");
    await writeFile(fakeBunPath, content, { mode: 0o755 });
    await chmod(fakeBunPath, 0o755);
    return fakeBinDir;
  }

  it("builds the source CLI before executing when dist is missing", async () => {
    const fakeRepoRoot = await createFakeRepo();
    const bunArgsPath = join(tempRoot, "bun-args.txt");
    // The wrapper cds to the repo root before building, so the stub builds
    // into its own working directory rather than into a path it was handed.
    const fakeBunDir = await writeFakeBun(`#!/bin/sh
printf '%s\\n' "$@" > ${shellQuote(bunArgsPath)}
mkdir -p "$PWD/apps/cli/dist"
cat > "$PWD/apps/cli/dist/index.js" <<'NODE'
process.stdout.write(JSON.stringify({ argv: process.argv.slice(2) }));
NODE
`);

    const result = await execFileAsync(
      join(fakeRepoRoot, "apps", "cli", "bin", "patcher"),
      ["status", "--json"],
      {
        cwd: fakeRepoRoot,
        env: {
          ...process.env,
          PATH: `${fakeBunDir}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(JSON.parse(result.stdout)).toEqual({ argv: ["status", "--json"] });
    await expect(
      readFile(join(fakeRepoRoot, "apps", "cli", "dist", "index.js"), "utf8"),
    ).resolves.toContain("process.stdout.write");
    await expect(readFile(bunArgsPath, "utf8")).resolves.toBe(
      ["run", "--silent", "cli:prepare", ""].join("\n"),
    );
  });

  it("uses the built CLI directly when dist exists", async () => {
    const fakeRepoRoot = await createFakeRepo();
    const fakeDistDir = join(fakeRepoRoot, "apps", "cli", "dist");
    const bunCalledPath = join(tempRoot, "bun-called.txt");
    const fakeBunDir = await writeFakeBun(`#!/bin/sh
echo called > ${shellQuote(bunCalledPath)}
exit 42
`);
    await mkdir(fakeDistDir, { recursive: true });
    await writeFile(
      join(fakeDistDir, "index.js"),
      "process.stdout.write(process.argv.slice(2).join(' '));\n",
    );

    const result = await execFileAsync(
      join(fakeRepoRoot, "apps", "cli", "bin", "patcher"),
      ["--help"],
      {
        cwd: fakeRepoRoot,
        env: {
          ...process.env,
          PATH: `${fakeBunDir}${delimiter}${process.env.PATH ?? ""}`,
        },
      },
    );

    expect(result.stdout).toBe("--help");
    await expect(readFile(bunCalledPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
