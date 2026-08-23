import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getPluginKvValue } from "@patcher/db";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { pluginProcessPolicy } from "../../../src/services/plugins/plugin-placement.js";

/**
 * The loader actually placing a plugin in a plugin process.
 *
 * Everything below this has its own tests; what this file is for is the seam
 * itself — that `runPluginOutOfProcess` changes where a plugin runs and
 * nothing else, that the rest of the server cannot tell, and that a plugin
 * which cannot leave the server says so and stays.
 */

async function writePlugin(
  dir: string,
  options: {
    name: string;
    permissions?: readonly string[];
    sites?: readonly string[];
    source: string;
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
        name: "Out of process fixture",
        description: "Fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        ...(options.permissions === undefined
          ? {}
          : { permissions: options.permissions }),
        ...(options.sites === undefined ? {} : { sites: options.sites }),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.source);
  return rootDir;
}

const CONTEXT_MENU_PLUGIN = `
  export default function plugin(patcher: any) {
    patcher.log.info("loaded out of process");
    patcher.browser.registerContextMenuItem({
      id: "shout",
      title: "Shout",
      run: (ctx: any) => (ctx.selectionText ?? "").toUpperCase(),
    });
    patcher.background.schedule("nightly", "0 3 * * *", () => {});
    // Runs in the plugin process; the write lands in the server's store, so
    // whether this instance was disposed is observable from outside.
    patcher.onDispose(() => patcher.storage.kv.set("disposed", true));
  }
`;

/** What the same plugin looks like after an edit, for the reload test. */
const EDITED_CONTEXT_MENU_PLUGIN = CONTEXT_MENU_PLUGIN.replace(
  `id: "shout",
      title: "Shout",`,
  `id: "whisper",
      title: "Whisper",`,
);

// An rpc contract used to make a plugin ineligible to leave the server,
// because the host validated with the plugin's own schema object. It validates
// next to the handler now, so this plugin moves like any other.
//
// The schema is hand-rolled rather than zod's: a Standard Schema is a shape,
// not a class, and a fixture in a temp directory has no node_modules to import
// a real validator from — in either placement, which is what once looked like
// a plugin-process defect and was the fixture's own.
const PAGE_STYLE_PLUGIN = `
  export default function plugin(patcher: any) {
    patcher.browser.registerPageStyle({
      id: "declutter",
      matches: ["https://github.com/**"],
      css: ".ad { display: none !important }",
    });
  }
`;

const PAGE_SCRIPT_PLUGIN = `
  export default function plugin(patcher: any) {
    patcher.browser.registerPageScript({
      id: "toolbar",
      matches: ["https://github.com/**"],
      code: "patcher.ready(function () { document.title = 'seen'; });",
    });
  }
`;

const RPC_PLUGIN = `
  const wantsAnObject = {
    "~standard": {
      version: 1,
      vendor: "fixture",
      validate: (value: unknown) =>
        typeof value === "object" && value !== null
          ? { value }
          : { issues: [{ message: "expected an object" }] },
    },
  };
  export default function plugin(patcher: any) {
    patcher.rpc.register(
      { greet: { input: wantsAnObject, output: wantsAnObject } },
      { greet: ({ who }: { who: string }) => ({ text: "hi " + who }) },
    );
  }
`;

describe("loading a plugin into a plugin process", () => {
  let harness: TestAppHarness;

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  async function start(runPluginOutOfProcess: () => boolean): Promise<void> {
    harness = await createTestAppHarness({ runPluginOutOfProcess });
  }

  it("loads and runs it, and the rest of the server cannot tell", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect([entry.status, entry.statusDetail]).toEqual(["running", null]);
    // Read through the ordinary dispatcher, which has no idea where the
    // plugin is: it finds the registration and calls it.
    const items = harness.pluginService.listContextMenuItemContributions();
    expect(items.map((item) => item.itemId)).toContain("shout");
  }, 30_000);

  // `patcher.sites` has to survive the boundary, and nothing else makes it: the
  // bootstrap payload is built with an `as never` cast, so a field the child
  // needs and the supervisor forgets compiles clean and refuses every style the
  // plugin registers — in the placement that is the whole point of the feature,
  // since a plugin that came from an agent is exactly the one that runs out here.
  it("honours the sites it declared when it runs out of process", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-remote",
        permissions: ["pageStyle.register"],
        sites: ["https://github.com/**"],
        source: PAGE_STYLE_PLUGIN,
      },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect([entry.status, entry.statusDetail]).toEqual(["running", null]);
    expect(harness.pluginService.listPageStyleContributions()).toEqual([
      {
        pluginId: "remote",
        styleId: "declutter",
        matches: ["https://github.com/**"],
        css: ".ad { display: none !important }",
      },
    ]);
  }, 30_000);

  // The source text has to cross too, and by a different route than the style
  // above: it rides the handle *snapshot* the child sends back, so a field the
  // snapshot forgets leaves a plugin that loads fine and contributes nothing —
  // and the endpoint that lists contributions throws for every other plugin too.
  it("carries a page script out of the plugin process", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-remote",
        permissions: ["pageScript.register"],
        sites: ["https://github.com/**"],
        source: PAGE_SCRIPT_PLUGIN,
      },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect([entry.status, entry.statusDetail]).toEqual(["running", null]);
    expect(harness.pluginService.listPageScriptContributions()).toEqual([
      {
        pluginId: "remote",
        scriptId: "toolbar",
        matches: ["https://github.com/**"],
        code: "patcher.ready(function () { document.title = 'seen'; });",
      },
    ]);
  }, 30_000);

  // The one place the difference is visible, and it is visible on purpose:
  // there is no in-process `patcher` to hand back.
  it("has no local Patcher object for it", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );
    await harness.pluginService.installPath(rootDir);

    expect(() => harness.pluginService.getApi("remote")).toThrow(
      /runs in its own process/,
    );
  }, 30_000);

  it("keeps loading in the server when the switch is off", async () => {
    await start(() => false);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect(entry.status).toBe("running");
    expect(entry.placement).toBe("server");
    expect(harness.pluginService.getApi("remote")).toBeDefined();
  }, 30_000);

  // With the shipped policy rather than a test predicate: an installed plugin
  // is provenance "direct", and that is the whole of the rule that moves it.
  // The rest of this file proves the seam works; this proves it is armed.
  it("moves an installed plugin out under the shipped placement policy", async () => {
    harness = await createTestAppHarness({
      runPluginOutOfProcess: pluginProcessPolicy({ enabled: true }),
    });
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect([entry.status, entry.statusDetail]).toEqual(["running", null]);
    expect(() => harness.pluginService.getApi("remote")).toThrow(
      /runs in its own process/,
    );
    // And it says so where an operator looks, not only in the server's log.
    expect(entry.placement).toBe("process");
  }, 30_000);

  it("serves an rpc method from the plugin's process, contract and all", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      { name: "patcher-plugin-rpcish", source: RPC_PLUGIN },
    );

    const entry = await harness.pluginService.installPath(rootDir);

    // No fallback: a contract full of validators is no longer a reason to
    // stay, because the validating happens where the handler is.
    expect([entry.status, entry.statusDetail]).toEqual(["running", null]);
    expect(() => harness.pluginService.getApi("rpcish")).toThrow(
      /runs in its own process/,
    );

    const lookup = harness.pluginService.getRpcHandler("rpcish", "greet");
    if (lookup.outcome !== "found") throw new Error(lookup.outcome);
    await expect(
      harness.pluginService.invokeRpcHandler("rpcish", "greet", lookup.value, {
        who: "мир",
      }),
    ).resolves.toEqual({ ok: true, result: { text: "hi мир" } });

    // And the plugin's own validator still refuses what it always refused —
    // one process away, with the rpc failure shape intact.
    await expect(
      harness.pluginService.invokeRpcHandler(
        "rpcish",
        "greet",
        lookup.value,
        "not an object" as never,
      ),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_input",
        message: "rpc input validation failed",
        issues: [{ message: "expected an object" }],
      },
    });
  }, 30_000);

  // A reload starts the successor while the predecessor is still serving —
  // that ordering is what makes a failed reload keep the old plugin — so for
  // the moment the swap takes, one plugin has two instances. Keyed by plugin
  // id the second start was refused outright ("already started"), which is
  // what `SupervisedPlugin.instanceId` exists to fix.
  it("reloads it, and the new instance is the one serving", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );
    await harness.pluginService.installPath(rootDir);
    // Edit it first: a predecessor that never went away is then visible in
    // what the server serves, rather than only suspected.
    await writeFile(join(rootDir, "server.ts"), EDITED_CONTEXT_MENU_PLUGIN);

    await harness.pluginService.reload("remote");

    const entry = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "remote");
    expect([entry?.status, entry?.statusDetail]).toEqual(["running", null]);
    expect(
      harness.pluginService
        .listContextMenuItemContributions()
        .map((item) => item.itemId),
    ).toEqual(["whisper"]);
    // And it is a live channel, not a registration table left behind by a
    // handle whose process is gone.
    await expect(
      harness.pluginService.runContextMenuItem({
        pluginId: "remote",
        itemId: "whisper",
        context: { selectionText: "тихо" } as never,
      }),
    ).resolves.toEqual({ ok: true });
    // The predecessor was disposed rather than abandoned: its onDispose ran
    // in the plugin process and its write reached the server's store.
    expect(getPluginKvValue(harness.db, "remote", "disposed")).toBe("true");
  }, 30_000);

  // The other half of building the successor first: when it fails, the plugin
  // that is still serving must keep serving, and must not be relabelled with
  // the failure. The in-process path has always done this; going out of
  // process must not be the reason a live plugin reads as broken.
  it("keeps the running plugin when its reload fails out of process", async () => {
    await start(() => true);
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-remote",
        permissions: ["contextMenu.register"],
        source: CONTEXT_MENU_PLUGIN,
      },
    );
    await harness.pluginService.installPath(rootDir);
    await writeFile(
      join(rootDir, "server.ts"),
      `export default function plugin() { throw new Error("factory exploded"); }`,
    );

    await harness.pluginService.reload("remote");

    const entry = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "remote");
    expect(entry?.status).toBe("running");
    expect(entry?.statusDetail).toMatch(/reload failed: .*factory exploded/);
    // Still the predecessor's registrations, still answering.
    expect(
      harness.pluginService
        .listContextMenuItemContributions()
        .map((item) => item.itemId),
    ).toEqual(["shout"]);
    await expect(
      harness.pluginService.runContextMenuItem({
        pluginId: "remote",
        itemId: "shout",
        context: { selectionText: "тихо" } as never,
      }),
    ).resolves.toEqual({ ok: true });
  }, 30_000);
});
