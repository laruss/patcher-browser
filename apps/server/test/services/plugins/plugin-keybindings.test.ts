import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AppKeybinding } from "@patcher/domain";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

/**
 * One plugin rebinding a command, unassigning another, and claiming a third
 * that a second plugin also wants.
 */
const KEYBINDING_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.ui.registerKeybinding({
      command: "browser.newTab",
      shortcut: { key: "y", mod: true, shift: true },
    });
    patcher.ui.registerKeybinding({ command: "browser.reload", shortcut: null });
    patcher.ui.registerKeybinding({
      command: "thread.search",
      shortcut: { key: "j", mod: true },
    });
  }
`;

/** Alphabetically after the first plugin, so it loses the contested command. */
const RIVAL_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.ui.registerKeybinding({
      command: "thread.search",
      shortcut: { key: "q", mod: true },
    });
  }
`;

async function writePlugin(
  dir: string,
  options: { name: string; serverSource: string },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      patcher: {
        name: "Keybinding fixture",
        description: "Keybinding plugin fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin keybindings (patcher.ui.registerKeybinding)", () => {
  let harness: TestAppHarness;

  async function systemConfig(): Promise<{
    keybindings: AppKeybinding[];
    defaultKeybindings: AppKeybinding[];
  }> {
    const response = await harness.app.request(`${BASE}/api/v1/system/config`);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      keybindings: AppKeybinding[];
      defaultKeybindings: AppKeybinding[];
    };
  }

  function shortcutFor(
    bindings: AppKeybinding[],
    command: string,
  ): AppKeybinding["shortcut"] | undefined {
    return bindings.find((binding) => binding.command === command)?.shortcut;
  }

  beforeEach(async () => {
    harness = await createTestAppHarness();
    const fixtures = join(harness.config.dataDir, "fixtures");
    for (const [name, serverSource] of [
      ["patcher-plugin-akeys", KEYBINDING_SOURCE],
      ["patcher-plugin-zkeys", RIVAL_SOURCE],
    ] as const) {
      const rootDir = await writePlugin(fixtures, { name, serverSource });
      const entry = await harness.pluginService.installPath(rootDir);
      expect(entry.status).toBe("running");
    }
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("rebinds a command for the whole app", async () => {
    const config = await systemConfig();

    expect(shortcutFor(config.keybindings, "browser.newTab")).toMatchObject({
      key: "y",
      mod: true,
      shift: true,
    });
  });

  // A plugin's binding is what this install calls default, so the settings UI
  // reads it as a default rather than as something the user changed.
  it("contributes to the defaults, not to the user's overrides", async () => {
    const config = await systemConfig();

    expect(
      shortcutFor(config.defaultKeybindings, "browser.newTab"),
    ).toMatchObject({ key: "y" });

    const response = await harness.app.request(`${BASE}/api/v1/system/config`);
    const body = (await response.json()) as { keybindingOverrides: unknown };
    expect(body.keybindingOverrides).toEqual([]);
  });

  // Unassigning is how a plugin frees a chord it wants to leave to the page.
  it("can unassign a command", async () => {
    const config = await systemConfig();

    expect(
      config.keybindings.some(
        (binding) => binding.command === "browser.reload",
      ),
    ).toBe(false);
    expect(shortcutFor(config.defaultKeybindings, "browser.reload")).toBeNull();
  });

  // Deterministic by plugin id, so the result does not depend on load order.
  it("gives a contested command to the lowest plugin id", async () => {
    const config = await systemConfig();

    expect(shortcutFor(config.keybindings, "thread.search")).toMatchObject({
      key: "j",
    });
  });

  // The user is still the final authority over both.
  it("loses to the user's own override", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/settings/keyboard`,
      {
        method: "PUT",
        headers: { "content-type": "application/json", origin: BASE },
        body: JSON.stringify([
          {
            command: "browser.newTab",
            shortcut: {
              key: "k",
              mod: true,
              meta: false,
              control: false,
              alt: false,
              shift: false,
            },
          },
        ]),
      },
    );
    expect(response.status).toBe(200);

    const config = await systemConfig();

    expect(shortcutFor(config.keybindings, "browser.newTab")).toMatchObject({
      key: "k",
    });
  });

  // A typo in a command id is a plugin bug, and a silent no-op is the worst way
  // to find out about one. The binding *before* the bad one is what proves the
  // registration is rejected whole rather than half-applied.
  it("takes nothing from a plugin that binds a command that does not exist", async () => {
    const before = await systemConfig();
    const inherited = shortcutFor(before.defaultKeybindings, "thread.rename");
    expect(inherited).not.toBeUndefined();

    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-badkeys",
        serverSource: `
          export default function plugin(patcher: any) {
            patcher.ui.registerKeybinding({
              command: "thread.rename",
              shortcut: { key: "0", mod: true },
            });
            patcher.ui.registerKeybinding({
              command: "browser.nope",
              shortcut: { key: "y", mod: true },
            });
          }
        `,
      },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).not.toBe("running");

    const after = await systemConfig();
    expect(shortcutFor(after.defaultKeybindings, "thread.rename")).toEqual(
      inherited,
    );
  });
});
