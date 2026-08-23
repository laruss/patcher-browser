import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PATCHER_PROD_HOST_DAEMON_PORT,
  PATCHER_PROD_SERVER_PORT,
  resolveDevInstanceConfig,
  resolveInheritedDevSkillsRootPaths,
  toDevProcessEnv,
} from "@patcher/config/runtime";
import { createDevTurboCommand } from "../src/commands/run-dev.js";
import { migrateLegacyDevData } from "../src/lib/legacy-dev-data-migration.js";
import {
  expectedDevDataDir,
  expectedDevInstanceId,
  expectedDevPorts,
  expectedDevServerUrl,
} from "./dev-instance-expectations.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await fs.access(pathToCheck);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("run-dev", () => {
  it("derives stable data and ports from a managed checkout", () => {
    const homeDir = "/Users/tester";
    const repoRoot =
      "/Users/tester/.patcher-dev/projects/env_q7e5i54kxt/patcher";
    const config = resolveDevInstanceConfig({ homeDir, repoRoot });

    expect(config.instanceId).toBe(
      expectedDevInstanceId({ homeDir, repoRoot }),
    );
    expect(config.dataDir).toBe(expectedDevDataDir({ homeDir, repoRoot }));
    expect(config.ports).toEqual(expectedDevPorts(repoRoot));
    expect(config.serverUrl).toBe(expectedDevServerUrl(repoRoot));
    expect(new Set(Object.values(config.ports))).toHaveLength(3);
    expect(Object.values(config.ports)).not.toContain(5173);
    expect(Object.values(config.ports)).not.toContain(3334);
    expect(Object.values(config.ports)).not.toContain(3002);
    expect(Object.values(config.ports)).not.toContain(PATCHER_PROD_SERVER_PORT);
    expect(Object.values(config.ports)).not.toContain(
      PATCHER_PROD_HOST_DAEMON_PORT,
    );
  });

  // What `reservePackagedAppPorts` used to guard: the cloud's dev port range
  // straddled the packaged pair, so a dev instance could land on it. The cloud
  // is gone and the three surviving bands sit below the pair, but that is a
  // property of the bases and the bucket count, not a law — assert it at both
  // ends of the offset range so moving a base or widening the buckets fails
  // here instead of at a user's "port already in use".
  it("keeps every dev port band clear of the packaged prod pair", () => {
    const rootsByOffset = new Map([
      [0, "/repo/port-13604"],
      [1, "/repo/port-3079"],
      [3886, "/repo/port-3186"],
      [3887, "/repo/port-6427"],
      [7998, "/repo/port-57923"],
      [7999, "/repo/port-7517"],
    ]);
    const portsByOffset = new Map(
      [...rootsByOffset].map(([offset, repoRoot]) => [
        offset,
        resolveDevInstanceConfig({ homeDir: "/Users/tester", repoRoot }).ports,
      ]),
    );

    // Distinct within an instance, and distinct across instances.
    expect(
      new Set(
        [...portsByOffset.values()].flatMap(({ appPort, serverPort }) => [
          appPort,
          serverPort,
        ]),
      ),
    ).toHaveLength(rootsByOffset.size * 2);

    for (const [offset, ports] of portsByOffset) {
      for (const [name, port] of Object.entries(ports)) {
        expect(
          port,
          `dev ${name} at offset ${offset} collides with a packaged port`,
        ).not.toBe(PATCHER_PROD_SERVER_PORT);
        expect(port).not.toBe(PATCHER_PROD_HOST_DAEMON_PORT);
      }
    }
  });

  it("uses the home-relative checkout path for non-managed checkout paths", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/src/work/patcher-feature-copy";

    const config = resolveDevInstanceConfig({ homeDir, repoRoot });

    expect(config.instanceId).toBe(
      expectedDevInstanceId({ homeDir, repoRoot }),
    );
  });

  it("overrides instance selectors while preserving unrelated environment", () => {
    const config = resolveDevInstanceConfig({
      homeDir: "/Users/tester",
      repoRoot: "/Users/tester/.patcher-dev/projects/env_q7e5i54kxt/patcher",
    });
    const baseEnv: NodeJS.ProcessEnv = {
      PATCHER_DATA_DIR: "/Users/tester/.patcher-dev",
      PATCHER_SERVER_PORT: "3334",
      NODE_ENV: "production",
      OPENAI_API_KEY: "test-key",
    };

    const env = toDevProcessEnv({ baseEnv, config });

    expect(env.OPENAI_API_KEY).toBe("test-key");
    expect(env.NODE_ENV).toBe("development");
    expect(env.PATCHER_DATA_DIR).toBe(config.dataDir);
    expect(env.PATCHER_SERVER_PORT).toBe(String(config.ports.serverPort));
    expect(env.PATCHER_SERVER_URL).toBe(config.serverUrl);
    expect(env.PATCHER_HOST_DAEMON_PORT).toBe(
      String(config.ports.hostDaemonPort),
    );
    expect(env.PATCHER_DEV_APP_PORT).toBe(String(config.ports.appPort));
  });

  it("inherits parent Patcher skills for managed worktree dev apps", () => {
    const homeDir = "/Users/tester";
    const repoRoot =
      "/Users/tester/.patcher-dev/code-patcher-abc123/worktrees/env_feature/patcher";
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot,
    });

    const inheritedSkillsRootPaths = [
      "/Users/tester/.patcher-dev/code-patcher-abc123/skills",
      "/Users/tester/.patcher/skills",
    ];
    expect(resolveInheritedDevSkillsRootPaths({ homeDir, repoRoot })).toEqual(
      inheritedSkillsRootPaths,
    );
    expect(toDevProcessEnv({ baseEnv: {}, config })).toMatchObject({
      PATCHER_INHERITED_SKILLS_ROOTS: inheritedSkillsRootPaths.join(
        path.delimiter,
      ),
    });
  });

  it("dedupes inherited Patcher skills for prod-managed worktree dev apps", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/.patcher/worktrees/env_feature/patcher";
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot,
    });

    expect(resolveInheritedDevSkillsRootPaths({ homeDir, repoRoot })).toEqual([
      "/Users/tester/.patcher/skills",
    ]);
    expect(toDevProcessEnv({ baseEnv: {}, config })).toMatchObject({
      PATCHER_INHERITED_SKILLS_ROOTS: "/Users/tester/.patcher/skills",
    });
  });

  it("inherits prod Patcher skills for ordinary checkout dev apps", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/src/patcher";
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot,
    });

    expect(resolveInheritedDevSkillsRootPaths({ homeDir, repoRoot })).toEqual([
      "/Users/tester/.patcher/skills",
    ]);
    expect(toDevProcessEnv({ baseEnv: {}, config })).toMatchObject({
      PATCHER_INHERITED_SKILLS_ROOTS: "/Users/tester/.patcher/skills",
    });
  });

  it("strips parent thread context from dev child processes", () => {
    const config = resolveDevInstanceConfig({
      homeDir: "/Users/tester",
      repoRoot: "/Users/tester/src/patcher",
    });
    const baseEnv: NodeJS.ProcessEnv = {
      PATCHER_ENVIRONMENT_ID: "env_parent",
      PATCHER_PROJECT_ID: "proj_parent",
      PATCHER_THREAD_ID: "thr_parent",
      PATCHER_THREAD_STORAGE:
        "/Users/tester/.patcher/thread-storage/thr_parent",
    };

    const env = toDevProcessEnv({ baseEnv, config });

    expect(env.PATCHER_ENVIRONMENT_ID).toBeUndefined();
    expect(env.PATCHER_THREAD_ID).toBeUndefined();
    expect(env.PATCHER_THREAD_STORAGE).toBeUndefined();
    expect(env.PATCHER_PROJECT_ID).toBe("proj_parent");
  });

  it("runs the same persistent dev tasks as bun run dev", () => {
    expect(createDevTurboCommand()).toEqual({
      args: [
        "turbo",
        "run",
        "dev",
        "--filter=@patcher/app",
        "--filter=@patcher/server",
        "--filter=@patcher/host-daemon",
        "--ui",
        "tui",
        "--concurrency",
        "20",
        "--no-update-notifier",
      ],
      command: "bunx",
    });
  });

  it("migrates legacy flat dev data into the checkout instance", async () => {
    const homeDir = await makeTempDir("patcher-dev-home-");
    const legacyDataDir = path.join(homeDir, ".patcher-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "patcher"),
    });
    await fs.mkdir(path.join(legacyDataDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(legacyDataDir, "attachments", "proj_test"), {
      recursive: true,
    });
    await fs.mkdir(
      path.join(legacyDataDir, "worktrees", "env_old", "patcher"),
      {
        recursive: true,
      },
    );
    await fs.mkdir(path.join(legacyDataDir, "dev-supervisors"), {
      recursive: true,
    });
    await fs.writeFile(path.join(legacyDataDir, "patcher.db"), "db", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "patcher.db.backup-20260515-160305"),
      "backup",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "auth-secret"),
      "secret",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "attachments", "proj_test", "screenshot.png"),
      "image",
      "utf8",
    );
    await fs.writeFile(path.join(legacyDataDir, "daemon.lock"), "lock", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "dev-supervisors", "server.pid"),
      "not-a-pid",
      "utf8",
    );
    const output = { write: vi.fn() };

    const result = await migrateLegacyDevData({ config, output });

    expect(result).toEqual({
      migratedEntries: [
        "attachments",
        "auth-secret",
        "logs",
        "patcher.db",
        "patcher.db.backup-20260515-160305",
      ],
    });
    await expect(
      fs.readFile(path.join(config.dataDir, "patcher.db"), "utf8"),
    ).resolves.toBe("db");
    await expect(
      fs.readFile(path.join(config.dataDir, "auth-secret"), "utf8"),
    ).resolves.toBe("secret");
    await expect(
      fs.readFile(
        path.join(config.dataDir, "attachments", "proj_test", "screenshot.png"),
        "utf8",
      ),
    ).resolves.toBe("image");
    await expect(
      fs.access(path.join(legacyDataDir, "worktrees", "env_old", "patcher")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(legacyDataDir, "dev-supervisors", "server.pid")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(legacyDataDir, "daemon.lock")),
    ).resolves.toBeUndefined();
    expect(output.write).toHaveBeenCalledWith(
      expect.stringContaining(
        `Migrated legacy dev data into ${config.dataDir}`,
      ),
    );
  });

  it("skips migration when the target instance already has data", async () => {
    const homeDir = await makeTempDir("patcher-dev-home-");
    const legacyDataDir = path.join(homeDir, ".patcher-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "patcher"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDataDir, "patcher.db"),
      "legacy",
      "utf8",
    );
    await fs.writeFile(
      path.join(config.dataDir, "patcher.db"),
      "target",
      "utf8",
    );

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "target-exists",
    });
    await expect(
      fs.readFile(path.join(legacyDataDir, "patcher.db"), "utf8"),
    ).resolves.toBe("legacy");
    await expect(
      fs.readFile(path.join(config.dataDir, "patcher.db"), "utf8"),
    ).resolves.toBe("target");
  });

  it("skips migration when legacy dev data is absent", async () => {
    const homeDir = await makeTempDir("patcher-dev-home-");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "patcher"),
    });

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-data-not-found",
    });
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("skips migration when legacy dev data has no migratable entries", async () => {
    const homeDir = await makeTempDir("patcher-dev-home-");
    const legacyDataDir = path.join(homeDir, ".patcher-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "patcher"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.writeFile(path.join(legacyDataDir, "daemon.lock"), "lock", "utf8");

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-data-empty",
    });
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("rolls back already moved entries when migration rename fails", async () => {
    const homeDir = await makeTempDir("patcher-dev-home-");
    const legacyDataDir = path.join(homeDir, ".patcher-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "patcher"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDataDir, "auth-secret"),
      "secret",
      "utf8",
    );
    await fs.writeFile(path.join(legacyDataDir, "patcher.db"), "db", "utf8");
    const renameCalls: string[] = [];
    const renameWithInjectedFailure = vi.fn(
      async (sourcePath: string, targetPath: string): Promise<void> => {
        renameCalls.push(path.basename(sourcePath));
        if (renameCalls.length === 1) {
          await fs.rename(sourcePath, targetPath);
          return;
        }

        throw new Error("injected rename failure");
      },
    );

    await expect(
      migrateLegacyDevData({
        config,
        dependencies: {
          rename: renameWithInjectedFailure,
        },
      }),
    ).rejects.toThrow("injected rename failure");

    expect(renameCalls).toEqual(["auth-secret", "patcher.db"]);
    await expect(
      fs.readFile(path.join(legacyDataDir, "auth-secret"), "utf8"),
    ).resolves.toBe("secret");
    await expect(
      fs.readFile(path.join(legacyDataDir, "patcher.db"), "utf8"),
    ).resolves.toBe("db");
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("does not migrate legacy data while a legacy dev supervisor is running", async () => {
    const homeDir = await makeTempDir("patcher-dev-home-");
    const legacyDataDir = path.join(homeDir, ".patcher-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "patcher"),
    });
    await fs.mkdir(path.join(legacyDataDir, "dev-supervisors"), {
      recursive: true,
    });
    await fs.writeFile(path.join(legacyDataDir, "patcher.db"), "db", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "dev-supervisors", "server.pid"),
      `${process.pid}\n`,
      "utf8",
    );

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-dev-process-running",
    });
    await expect(
      fs.readFile(path.join(legacyDataDir, "patcher.db"), "utf8"),
    ).resolves.toBe("db");
    expect(await pathExists(config.dataDir)).toBe(false);
  });
});
