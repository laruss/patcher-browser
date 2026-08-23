import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPluginKvValue } from "@patcher/db";
import { createMockHubSocket } from "../../helpers/mock-hub-socket.js";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

/**
 * What a plugin process is told about this side after it has loaded.
 *
 * In the server a plugin reads `patcher.browser.getStatus()` and gets the truth,
 * because the hub is a function call away. One process out it holds a copy that
 * arrived with its bootstrap — so a window connecting or disconnecting later was
 * invisible to it, and a plugin that waited for the browser waited forever while
 * the browser sat there connected.
 */

const STATUS_PLUGIN = `
  export default function plugin(patcher: any) {
    patcher.browser.registerContextMenuItem({
      id: "probe",
      title: "Probe",
      // Answers into the server's own store, so the test reads what the plugin
      // saw rather than what the server would have said.
      run: () => patcher.storage.kv.set("seen", patcher.browser.getStatus()),
    });
  }
`;

async function writeStatusPlugin(dir: string): Promise<string> {
  const rootDir = join(dir, "patcher-plugin-facts");
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "patcher-plugin-facts",
      version: "0.1.0",
      patcher: {
        name: "Host facts fixture",
        description: "Fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        permissions: ["contextMenu.register"],
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), STATUS_PLUGIN);
  return rootDir;
}

describe("host facts reaching a plugin process", () => {
  let harness: TestAppHarness;

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  async function whatThePluginSees(): Promise<unknown> {
    const outcome = await harness.pluginService.runContextMenuItem({
      pluginId: "facts",
      itemId: "probe",
      context: {} as never,
    });
    expect(outcome).toEqual({ ok: true });
    const stored = getPluginKvValue(harness.db, "facts", "seen");
    return stored === undefined ? undefined : JSON.parse(stored);
  }

  it("tells it when a browser window arrives and when it leaves", async () => {
    harness = await createTestAppHarness({ runPluginOutOfProcess: () => true });
    const rootDir = await writeStatusPlugin(
      join(harness.config.dataDir, "fixtures"),
    );
    await harness.pluginService.installPath(rootDir);
    // Otherwise this test passes on the in-process path, where the status is
    // read straight from the hub and the push being broken proves nothing.
    expect(() => harness.pluginService.getApi("facts")).toThrow(
      /runs in its own process/,
    );

    expect(await whatThePluginSees()).toEqual({
      connected: false,
      windowCount: 0,
    });

    const socket = createMockHubSocket();
    harness.hub.registerClient(socket);
    harness.hub.registerBrowserHost(socket, { browserHostId: "window-a" });

    expect(await whatThePluginSees()).toEqual({
      connected: true,
      windowCount: 1,
    });

    harness.hub.unregisterBrowserHost(socket);

    expect(await whatThePluginSees()).toEqual({
      connected: false,
      windowCount: 0,
    });
  }, 30_000);
});
