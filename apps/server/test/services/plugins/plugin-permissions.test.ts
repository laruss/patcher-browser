import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

/**
 * `patcher.permissions` on the real load path: a plugin installed the way a user
 * installs one, reaching for surfaces it did and did not declare.
 *
 * The unit-level behaviour of the gate is in plugin-permission-gate.test.ts.
 * What this file adds is that the manifest actually reaches the gate — the
 * declaration has to survive `readPluginManifest`, the loader, and
 * `createPluginApi` to mean anything.
 */

async function writePlugin(
  dir: string,
  options: {
    name: string;
    permissions?: readonly string[];
    serverSource: string;
  },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      patcher: {
        name: "Permission fixture",
        description: "Permission fixture plugin.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...(options.permissions === undefined
          ? {}
          : { permissions: options.permissions }),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin permissions on the real load path", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  // A contribution point is refused at registration, which happens inside the
  // factory — so an under-declared plugin fails to load rather than loading
  // and quietly contributing nothing.
  it("refuses a contribution the manifest did not declare", async () => {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-undeclared",
        serverSource: `
        export default function plugin(patcher: any) {
          patcher.browser.registerContextMenuItem({
            id: "x", title: "X", run() {},
          });
        }
      `,
      },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toMatch(/"contextMenu\.register" permission/);
  });

  it("admits the same contribution once declared", async () => {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-declared",
        permissions: ["contextMenu.register"],
        serverSource: `
        export default function plugin(patcher: any) {
          patcher.browser.registerContextMenuItem({
            id: "x", title: "X", run() {},
          });
        }
      `,
      },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect(entry.status).toBe("running");
    expect(entry.permissions).toEqual(["contextMenu.register"]);
  });

  // Declaring one permission must not carry another in with it — the whole
  // point of a list rather than a trust bit.
  it("keeps a declared plugin out of what it did not declare", async () => {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-partial",
        permissions: ["contextMenu.register"],
        serverSource: `
        export default function plugin(patcher: any) {
          patcher.browser.registerContextMenuItem({
            id: "x", title: "X", run() {},
          });
          patcher.http.route("GET", "/read", async () => {
            await patcher.sdk.files.read({ hostId: "h", path: "/etc/passwd" });
            return new Response("unreachable");
          });
        }
      `,
      },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");

    // The refusal happens when the handler runs, not at load: a plugin may
    // legitimately register surfaces it only sometimes uses.
    const response = await harness.app.request(
      "http://127.0.0.1:3334/api/v1/plugins/partial/http/read",
    );

    expect(response.status).toBe(500);
  });

  // The manifest is the record, so a disabled plugin still reports what it
  // asked for — that is exactly when a user wants to look.
  it("reports declared permissions in the plugin list", async () => {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-listed",
        permissions: ["threads", "tabs.read"],
        serverSource: `export default function plugin() {}`,
      },
    );
    await harness.pluginService.installPath(rootDir);

    const listed = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "listed");

    // Reported in the canonical order, not the manifest's.
    expect(listed?.permissions).toEqual(["tabs.read", "threads"]);
  });
});
