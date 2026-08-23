import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createConnection,
  migrate,
  upsertInstalledPlugin,
  type DbConnection,
} from "@patcher/db";
import { PLUGIN_SDK_MAJOR, PLUGIN_SDK_VERSION } from "@patcher/domain";
import type { Logger } from "@patcher/logger";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import { testLogger } from "../../helpers/test-app.js";

const logger = testLogger as unknown as Logger;

function gitPersistence(url: string, requestedRef: string) {
  return {
    provenance: { kind: "direct" } as const,
    sourceIntent: {
      kind: "git" as const,
      url,
      subdirectory: null,
      requestedRef,
      refKind: "branch" as const,
    },
    exactResolution: { kind: "git" as const, commit: "test-commit" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
  };
}

/**
 * Prebuilt backend distribution (design §3 loader amendment, §6): managed
 * (git:/npm:) installs prefer a fresh, SDK-compatible dist/server.js;
 * path installs always load from source. Pre-1.0, minor SDK bumps are
 * breaking, so compatibility means the exact SDK version. The fixture's
 * source entry THROWS, so whichever half runs is unambiguous.
 */

const THROWING_SERVER_TS = `throw new Error("source must not load");\n`;

const PREBUILT_SERVER_JS = `export default async function plugin(patcher) {
  patcher.log.info("dist");
  globalThis.__prebuiltDistLoads = (globalThis.__prebuiltDistLoads ?? 0) + 1;
}
`;

// What a bundle built against a newer SDK does when it reaches an export this
// host does not have: the shim resolves it to `undefined` and the factory dies
// on a property of it. The message names neither the SDK nor the artifact.
const SDK_AHEAD_SERVER_JS = `export default async function plugin(patcher) {
  patcher.somethingAddedLater.use();
}
`;

describe("prebuilt server bundle loading", () => {
  let db: DbConnection;
  let workDir: string;
  let service: PluginService;

  beforeEach(async () => {
    db = createConnection(":memory:");
    migrate(db);
    workDir = await mkdtemp(join(tmpdir(), "patcher-plugin-prebuilt-"));
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      loadTimeoutMs: 2000,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  async function writePrebuiltPlugin(
    name: string,
    options: { sdkMajor?: number; sdkVersion?: string; distJs?: string } = {},
  ): Promise<string> {
    const rootDir = join(workDir, name);
    await mkdir(join(rootDir, "dist"), { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name,
        version: "0.1.0",
        patcher: {
          name: "Prebuilt server fixture",
          description: "Prebuilt plugin server fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(rootDir, "server.ts"), THROWING_SERVER_TS);
    await writeFile(
      join(rootDir, "dist", "server.js"),
      options.distJs ?? PREBUILT_SERVER_JS,
    );
    await writeFile(
      join(rootDir, "dist", "server.meta.json"),
      JSON.stringify({
        sdkMajor: options.sdkMajor ?? PLUGIN_SDK_MAJOR,
        sdkVersion: options.sdkVersion ?? PLUGIN_SDK_VERSION,
      }),
    );
    return rootDir;
  }

  it("prefers a fresh dist/server.js for git installs (source never evaluated)", async () => {
    const rootDir = await writePrebuiltPlugin("patcher-plugin-gitdist");
    // Managed-source registration without the clone step (materialization is
    // not under test); the row's git: source is what flips the loader path.
    upsertInstalledPlugin(db, {
      ...gitPersistence("https://github.com/acme/patcher-plugin-gitdist", "v1"),
      id: "gitdist",
      source: "git:github.com/acme/patcher-plugin-gitdist@v1",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    const before =
      ((globalThis as Record<string, unknown>).__prebuiltDistLoads as
        | number
        | undefined) ?? 0;
    await service.reload("gitdist");

    const entry = service.list().find((plugin) => plugin.id === "gitdist");
    expect(entry?.status).toBe("running");
    expect(entry?.statusDetail).toBeNull();
    expect((globalThis as Record<string, unknown>).__prebuiltDistLoads).toBe(
      before + 1,
    );
  });

  it("never prefers dist for path installs — edited source must win", async () => {
    const rootDir = await writePrebuiltPlugin("patcher-plugin-pathsrc");
    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain("source must not load");
  });

  it("loads a dist whose SDK version differs inside the running major", async () => {
    const rootDir = await writePrebuiltPlugin("patcher-plugin-minordist", {
      sdkMajor: PLUGIN_SDK_MAJOR,
      sdkVersion: `${PLUGIN_SDK_MAJOR}.999.0`,
    });
    upsertInstalledPlugin(db, {
      ...gitPersistence(
        "https://github.com/acme/patcher-plugin-minordist",
        "v1",
      ),
      id: "minordist",
      source: "git:github.com/acme/patcher-plugin-minordist@v1",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    await service.reload("minordist");

    const entry = service.list().find((plugin) => plugin.id === "minordist");
    // The throwing source did NOT run: past 1.0 a matching major is the whole
    // compatibility test, so the dist is imported even at a different minor.
    expect(entry?.status).toBe("running");
  });

  it("blames the SDK gap when an artifact built ahead of this host fails to load", async () => {
    const rootDir = await writePrebuiltPlugin("patcher-plugin-aheaddist", {
      sdkMajor: PLUGIN_SDK_MAJOR,
      sdkVersion: `${PLUGIN_SDK_MAJOR}.999.0`,
      distJs: SDK_AHEAD_SERVER_JS,
    });
    upsertInstalledPlugin(db, {
      ...gitPersistence(
        "https://github.com/acme/patcher-plugin-aheaddist",
        "v1",
      ),
      id: "aheaddist",
      source: "git:github.com/acme/patcher-plugin-aheaddist@v1",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    await service.reload("aheaddist");

    const entry = service.list().find((plugin) => plugin.id === "aheaddist");
    expect(entry?.status).toBe("error");
    // The runtime's own message does not even name the namespace that was
    // missing — it reads "Cannot read properties of undefined (reading 'use')",
    // which is the whole reason the SDK gap has to be appended.
    expect(entry?.statusDetail).toContain(
      "Cannot read properties of undefined",
    );
    expect(entry?.statusDetail).not.toContain("somethingAddedLater");
    expect(entry?.statusDetail).toContain(
      `built against plugin SDK ${PLUGIN_SDK_MAJOR}.999.0`,
    );
    expect(entry?.statusDetail).toContain(`runs ${PLUGIN_SDK_VERSION}`);
  });

  it("falls back to source when the dist meta's SDK major mismatches", async () => {
    const rootDir = await writePrebuiltPlugin("patcher-plugin-staledist", {
      sdkMajor: 999,
      sdkVersion: "999.0.0",
    });
    upsertInstalledPlugin(db, {
      ...gitPersistence(
        "https://github.com/acme/patcher-plugin-staledist",
        "v1",
      ),
      id: "staledist",
      source: "git:github.com/acme/patcher-plugin-staledist@v1",
      rootDir,
      version: "0.1.0",
      enabled: true,
    });
    await service.reload("staledist");

    const entry = service.list().find((plugin) => plugin.id === "staledist");
    // The throwing source ran — proof the stale dist was NOT imported.
    expect(entry?.status).toBe("error");
    expect(entry?.statusDetail).toContain("source must not load");
  });
});
