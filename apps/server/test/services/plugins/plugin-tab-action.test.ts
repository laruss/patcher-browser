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
  url: "https://example.test/article",
  title: "An article",
  pinned: true,
  muted: false,
  active: true,
};

/** One entry that records the tab it was picked on, and one that throws. */
function tabActionSource(observedPath: string): string {
  return `
  import { appendFileSync } from "node:fs";
  export default function plugin(patcher: any) {
    patcher.browser.registerTabAction({
      id: "file-tab",
      title: "File this tab",
      run(context: any) {
        appendFileSync(${JSON.stringify(observedPath)}, JSON.stringify(context) + "\\n");
      },
    });
    patcher.browser.registerTabAction({
      id: "boom",
      title: "Explodes",
      run() {
        throw new Error("action boom");
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
        name: "Tab action fixture",
        description: "Tab action plugin fixture.",
        branding: { icon: "Zap" },
        permissions: ["tabMenu.register"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin tab actions (patcher.browser.registerTabAction)", () => {
  let harness: TestAppHarness;
  let observedPath: string;

  async function invoke(
    body: unknown,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/tab-action`,
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
    observedPath = join(harness.config.dataDir, "observed-tab.log");
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-tab",
        serverSource: tabActionSource(observedPath),
      },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("lists its entries in GET /plugins/contributions", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    const body = (await response.json()) as { browserTabActions: unknown };

    expect(body.browserTabActions).toEqual([
      { pluginId: "tab", itemId: "file-tab", title: "File this tab" },
      { pluginId: "tab", itemId: "boom", title: "Explodes" },
    ]);
  });

  // The whole point: the entry receives the tab it was picked on, including the
  // state the strip's own entries act on.
  it("runs a picked entry with the tab behind it", async () => {
    const result = await invoke({
      pluginId: "tab",
      itemId: "file-tab",
      ...INVOKE_CONTEXT,
    });

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(await observed()).toEqual([INVOKE_CONTEXT]);
  });

  // A Patcher screen is a tab with no page, and that is what a null url says.
  it("carries a Patcher screen through as a tab with no url", async () => {
    const result = await invoke({
      pluginId: "tab",
      itemId: "file-tab",
      ...INVOKE_CONTEXT,
      url: null,
      title: "Settings",
    });

    expect(result.status).toBe(200);
    expect(await observed()).toEqual([
      { ...INVOKE_CONTEXT, url: null, title: "Settings" },
    ]);
  });

  it("reports a throwing action rather than pretending it worked", async () => {
    const result = await invoke({
      pluginId: "tab",
      itemId: "boom",
      ...INVOKE_CONTEXT,
    });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ ok: false });
  });

  it("refuses an action that does not exist", async () => {
    const result = await invoke({
      pluginId: "tab",
      itemId: "nope",
      ...INVOKE_CONTEXT,
    });

    expect(result.status).toBe(422);
  });

  it("refuses a payload that is not an invocation", async () => {
    const result = await invoke({
      pluginId: "tab",
      itemId: "file-tab",
      tabId: "browser:a",
      url: "https://example.test/article",
      title: null,
      pinned: "yes",
      muted: false,
      active: true,
    });

    expect(result.status).toBe(400);
    expect(await observed()).toEqual([]);
  });

  // This route runs plugin code, so it takes the same guard as the rest.
  it("refuses a cross-origin invocation", async () => {
    const result = await invoke(
      { pluginId: "tab", itemId: "file-tab", ...INVOKE_CONTEXT },
      EVIL_ORIGIN,
    );

    expect(result.status).toBe(403);
    expect(await observed()).toEqual([]);
  });
});
