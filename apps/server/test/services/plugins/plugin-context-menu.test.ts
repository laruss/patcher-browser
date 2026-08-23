import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

const INVOKE_CONTEXT = {
  tabId: "browser:a",
  pageUrl: "https://example.test/article",
  linkUrl: "https://example.test/next",
  imageUrl: null,
  selectionText: "the selected words",
};

/** Two items with different conditions, and one that throws when picked. */
function menuSource(observedPath: string): string {
  return `
  import { appendFileSync } from "node:fs";
  export default function plugin(patcher: any) {
    patcher.browser.registerContextMenuItem({
      id: "save-selection",
      title: "Save selection to notes",
      when: { selection: true },
      run(context: any) {
        appendFileSync(${JSON.stringify(observedPath)}, JSON.stringify(context) + "\\n");
      },
    });
    patcher.browser.registerContextMenuItem({
      id: "everywhere",
      title: "Always here",
      run() {},
    });
    patcher.browser.registerContextMenuItem({
      id: "boom",
      title: "Explodes",
      run() {
        throw new Error("item boom");
      },
    });
  }
`;
}

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
        name: "Context menu fixture",
        description: "Context menu plugin fixture.",
        branding: { icon: "Zap" },
        permissions: ["contextMenu.register"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin context menu items (patcher.browser.registerContextMenuItem)", () => {
  let harness: TestAppHarness;
  let observedPath: string;

  async function invoke(
    body: unknown,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/context-menu`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  }

  async function observed(): Promise<unknown[]> {
    const contents = await readFile(observedPath, "utf8").catch(() => "");
    return contents
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as unknown);
  }

  beforeEach(async () => {
    harness = await createTestAppHarness();
    observedPath = join(harness.config.dataDir, "observed-menu.log");
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      { name: "patcher-plugin-menu", serverSource: menuSource(observedPath) },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  // Declared up front, so the shell can compose a menu without asking.
  it("lists its items in GET /plugins/contributions", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    const body = (await response.json()) as {
      browserContextMenuItems: unknown;
    };

    expect(body.browserContextMenuItems).toEqual([
      {
        pluginId: "menu",
        itemId: "save-selection",
        title: "Save selection to notes",
        when: { image: false, link: false, page: false, selection: true },
      },
      {
        pluginId: "menu",
        itemId: "everywhere",
        title: "Always here",
        when: { image: false, link: false, page: false, selection: false },
      },
      {
        pluginId: "menu",
        itemId: "boom",
        title: "Explodes",
        when: { image: false, link: false, page: false, selection: false },
      },
    ]);
  });

  // The whole point: the item receives what it was clicked on.
  it("runs a picked item with the context it was picked in", async () => {
    const result = await invoke({
      pluginId: "menu",
      itemId: "save-selection",
      ...INVOKE_CONTEXT,
    });

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(await observed()).toEqual([INVOKE_CONTEXT]);
  });

  it("reports a throwing item rather than pretending it worked", async () => {
    const result = await invoke({
      pluginId: "menu",
      itemId: "boom",
      ...INVOKE_CONTEXT,
    });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ ok: false });
  });

  it("refuses an item that does not exist", async () => {
    const result = await invoke({
      pluginId: "menu",
      itemId: "nope",
      ...INVOKE_CONTEXT,
    });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ ok: false });
  });

  it("refuses a payload that is not an invocation", async () => {
    const result = await invoke({ pluginId: "menu", itemId: "everywhere" });

    expect(result.status).toBe(400);
    expect(await observed()).toEqual([]);
  });

  // This route runs plugin code, so it takes the same guard as the rest.
  it("refuses a cross-origin invocation", async () => {
    const result = await invoke(
      { pluginId: "menu", itemId: "save-selection", ...INVOKE_CONTEXT },
      EVIL_ORIGIN,
    );

    expect(result.status).toBe(403);
    expect(await observed()).toEqual([]);
  });
});
