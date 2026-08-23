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
  query: "the words on the page",
};

/** One action that records what it was run with, and one that throws. */
function findActionSource(observedPath: string): string {
  return `
  import { appendFileSync } from "node:fs";
  export default function plugin(patcher: any) {
    patcher.browser.registerFindAction({
      id: "save-search",
      title: "Save this search",
      run(context: any) {
        appendFileSync(${JSON.stringify(observedPath)}, JSON.stringify(context) + "\\n");
      },
    });
    patcher.browser.registerFindAction({
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
        name: "Find action fixture",
        description: "Find action plugin fixture.",
        branding: { icon: "Zap" },
        permissions: ["find.register"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin find actions (patcher.browser.registerFindAction)", () => {
  let harness: TestAppHarness;
  let observedPath: string;

  async function invoke(
    body: unknown,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/find-action`,
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
    observedPath = join(harness.config.dataDir, "observed-find.log");
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-find",
        serverSource: findActionSource(observedPath),
      },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("lists its buttons in GET /plugins/contributions", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    const body = (await response.json()) as { browserFindActions: unknown };

    expect(body.browserFindActions).toEqual([
      { pluginId: "find", itemId: "save-search", title: "Save this search" },
      { pluginId: "find", itemId: "boom", title: "Explodes" },
    ]);
  });

  // The whole point: the button receives what the user was looking for.
  it("runs a pressed button with the query behind it", async () => {
    const result = await invoke({
      pluginId: "find",
      itemId: "save-search",
      ...INVOKE_CONTEXT,
    });

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(await observed()).toEqual([INVOKE_CONTEXT]);
  });

  it("reports a throwing action rather than pretending it worked", async () => {
    const result = await invoke({
      pluginId: "find",
      itemId: "boom",
      ...INVOKE_CONTEXT,
    });

    expect(result.status).toBe(422);
    expect(result.body).toMatchObject({ ok: false });
  });

  it("refuses an action that does not exist", async () => {
    const result = await invoke({
      pluginId: "find",
      itemId: "nope",
      ...INVOKE_CONTEXT,
    });

    expect(result.status).toBe(422);
  });

  // An empty query is not a search, so it is not something to act on either.
  it("refuses a payload that is not an invocation", async () => {
    const result = await invoke({
      pluginId: "find",
      itemId: "save-search",
      tabId: "browser:a",
      pageUrl: "https://example.test/article",
      query: "",
    });

    expect(result.status).toBe(400);
    expect(await observed()).toEqual([]);
  });

  // This route runs plugin code, so it takes the same guard as the rest.
  it("refuses a cross-origin invocation", async () => {
    const result = await invoke(
      { pluginId: "find", itemId: "save-search", ...INVOKE_CONTEXT },
      EVIL_ORIGIN,
    );

    expect(result.status).toBe(403);
    expect(await observed()).toEqual([]);
  });
});
