import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { pluginProcessPolicy } from "../../../src/services/plugins/plugin-placement.js";

const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

/** A command that records that it ran, and one that throws. */
function commandSource(observedPath: string): string {
  return `
  import { appendFileSync } from "node:fs";
  export default function plugin(patcher: any) {
    patcher.ui.registerCommand({
      id: "save-page",
      title: "Save this page",
      shortcut: { key: "d", mod: true },
      run() {
        appendFileSync(${JSON.stringify(observedPath)}, "ran\\n");
      },
    });
    patcher.ui.registerCommand({
      id: "boom",
      title: "Explodes",
      shortcut: { key: "d", mod: true, shift: true },
      run() {
        throw new Error("command boom");
      },
    });
  }
`;
}

const NO_SHORTCUT_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.ui.registerCommand({ id: "orphan", title: "Nowhere", run() {} });
  }
`;

const SAME_CHORD_TWICE_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.ui.registerCommand({ id: "one", title: "One", shortcut: { key: "j", mod: true }, run() {} });
    patcher.ui.registerCommand({ id: "two", title: "Two", shortcut: { key: "j", mod: true }, run() {} });
  }
`;

async function writePlugin(
  dir: string,
  options: { name: string; source: string },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      patcher: {
        name: "Command fixture",
        description: "Plugin command fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.source);
  return rootDir;
}

describe("plugin commands (patcher.ui.registerCommand)", () => {
  let harness: TestAppHarness;
  let observedPath: string;

  async function run(
    body: unknown,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/commands/run`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  }

  async function observed(): Promise<string[]> {
    const contents = await readFile(observedPath, "utf8").catch(() => "");
    return contents.split("\n").filter((line) => line.length > 0);
  }

  async function installFixture(): Promise<void> {
    observedPath = join(harness.config.dataDir, "observed-command.log");
    const entry = await harness.pluginService.installPath(
      await writePlugin(join(harness.config.dataDir, "fixtures"), {
        name: "patcher-plugin-cmd",
        source: commandSource(observedPath),
      }),
    );
    expect(entry.status).toBe("running");
  }

  beforeEach(async () => {
    harness = await createTestAppHarness();
    await installFixture();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  // Every modifier is spelled out on the wire: the app matches against this, and
  // a missing boolean would read as "chord without that modifier".
  it("lists its commands and their chords in GET /plugins/contributions", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    const body = (await response.json()) as { commands: unknown };

    expect(body.commands).toEqual([
      {
        pluginId: "cmd",
        commandId: "save-page",
        title: "Save this page",
        shortcut: {
          key: "d",
          alt: false,
          control: false,
          meta: false,
          mod: true,
          shift: false,
        },
      },
      {
        pluginId: "cmd",
        commandId: "boom",
        title: "Explodes",
        shortcut: {
          key: "d",
          alt: false,
          control: false,
          meta: false,
          mod: true,
          shift: true,
        },
      },
    ]);
  });

  it("runs the command whose chord fired", async () => {
    expect(await run({ pluginId: "cmd", commandId: "save-page" })).toEqual({
      status: 200,
      body: { ok: true },
    });
    expect(await observed()).toEqual(["ran"]);
  });

  it("reports a command that threw without touching the others", async () => {
    expect((await run({ pluginId: "cmd", commandId: "boom" })).status).toBe(
      422,
    );

    expect(await run({ pluginId: "cmd", commandId: "save-page" })).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it("refuses a command nobody registered", async () => {
    expect((await run({ pluginId: "cmd", commandId: "nope" })).status).toBe(
      422,
    );
  });

  it("refuses a cross-origin request", async () => {
    expect(
      (await run({ pluginId: "cmd", commandId: "save-page" }, EVIL_ORIGIN))
        .status,
    ).toBe(403);
  });

  // Patcher has no command palette, so a command with no chord could never be run —
  // saying so at load beats a registration that quietly does nothing.
  it("refuses to load a plugin whose command has no chord", async () => {
    const entry = await harness.pluginService.installPath(
      await writePlugin(join(harness.config.dataDir, "fixtures"), {
        name: "patcher-plugin-orphan",
        source: NO_SHORTCUT_SOURCE,
      }),
    );

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toMatch(/shortcut/u);
  });

  // Two of one plugin's commands on one chord is a mistake that plugin can fix.
  // (Two *plugins* wanting one chord cannot coordinate, so that is resolved by
  // plugin id order in the app instead of refused here.)
  it("refuses to load a plugin that binds one chord twice", async () => {
    const entry = await harness.pluginService.installPath(
      await writePlugin(join(harness.config.dataDir, "fixtures"), {
        name: "patcher-plugin-twice",
        source: SAME_CHORD_TWICE_SOURCE,
      }),
    );

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toMatch(/already bound/u);
  });

  // Out of process the chord is a snapshot field and the press is a message, and
  // a command is the one callback with nothing in its payload — so "it arrived"
  // is the whole contract.
  describe("loaded in a plugin process", () => {
    beforeEach(async () => {
      harness = await createTestAppHarness({
        runPluginOutOfProcess: pluginProcessPolicy({ enabled: true }),
      });
      await installFixture();
    });

    it("carries the chord across and runs the command", async () => {
      const contributions = (await (
        await harness.app.request(`${BASE}/api/v1/plugins/contributions`)
      ).json()) as { commands: { shortcut: { key: string; mod: boolean } }[] };
      expect(contributions.commands[0]?.shortcut).toMatchObject({
        key: "d",
        mod: true,
      });

      expect(await run({ pluginId: "cmd", commandId: "save-page" })).toEqual({
        status: 200,
        body: { ok: true },
      });
      expect(await observed()).toEqual(["ran"]);
    });
  });
});
