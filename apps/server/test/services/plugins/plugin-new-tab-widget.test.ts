import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

/**
 * Four widgets across one plugin: one that lists rows, one with nothing to list,
 * one that throws, and one whose row points somewhere the browser must not follow.
 * Only the first should reach the screen.
 */
const WIDGET_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.browser.registerNewTabWidget({
      id: "saved",
      label: "Bookmarks",
      rows(context: any) {
        return [
          { title: "Docs", subtitle: "read later", url: "https://example.test/docs" },
          // Trimmed rather than trusted, and a missing subtitle is a null.
          { title: "x".repeat(400), url: "https://example.test/" + context.tabId },
        ];
      },
    });
    patcher.browser.registerNewTabWidget({
      id: "empty",
      label: "Nothing",
      rows() {
        return null;
      },
    });
    patcher.browser.registerNewTabWidget({
      id: "boom",
      label: "Explodes",
      rows() {
        throw new Error("rows boom");
      },
    });
    patcher.browser.registerNewTabWidget({
      id: "sneaky",
      label: "Sneaky",
      rows() {
        return [{ title: "Run me", url: "javascript:alert(1)" }];
      },
    });
    patcher.browser.registerNewTabWidget({
      id: "toolong",
      label: "Too long",
      rows() {
        return [
          {
            title: "Enormous",
            url: "https://example.test/" + "x".repeat(4200),
          },
        ];
      },
    });
  }
`;

async function writePlugin(
  dir: string,
  options: { name: string; permissions?: readonly string[]; source: string },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      patcher: {
        name: "New tab fixture",
        description: "New tab widget fixture.",
        branding: { icon: "Zap" },
        permissions: options.permissions ?? ["newTab.register"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.source);
  return rootDir;
}

describe("plugin new tab widgets (patcher.browser.registerNewTabWidget)", () => {
  let harness: TestAppHarness;

  async function ask(
    query: string,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/new-tab${query}`,
      { headers: { origin } },
    );
    return { status: response.status, body: await response.json() };
  }

  beforeEach(async () => {
    harness = await createTestAppHarness();
    const entry = await harness.pluginService.installPath(
      await writePlugin(join(harness.config.dataDir, "fixtures"), {
        name: "patcher-plugin-newtab",
        source: WIDGET_SOURCE,
      }),
    );
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  // The declaration is ids only — the heading and the rows travel together — so
  // what the contributions list buys is "is anyone there at all".
  it("declares its widgets in GET /plugins/contributions", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    const body = (await response.json()) as { browserNewTabWidgets: unknown };

    expect(body.browserNewTabWidgets).toEqual([
      { pluginId: "newtab", widgetId: "saved" },
      { pluginId: "newtab", widgetId: "empty" },
      { pluginId: "newtab", widgetId: "boom" },
      { pluginId: "newtab", widgetId: "sneaky" },
      { pluginId: "newtab", widgetId: "toolong" },
    ]);
  });

  // A row is a link the browser will follow, so a URL it must not follow is
  // refused where it was made up rather than when it is clicked — and one bad
  // widget costs only itself.
  it("answers with the sections that had rows, and drops what it cannot show", async () => {
    const result = await ask("?tabId=browser:a");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      sections: [
        {
          pluginId: "newtab",
          widgetId: "saved",
          label: "Bookmarks",
          rows: [
            {
              title: "Docs",
              subtitle: "read later",
              url: "https://example.test/docs",
            },
            {
              title: "x".repeat(200),
              subtitle: null,
              url: "https://example.test/browser:a",
            },
          ],
        },
      ],
    });
  });

  // Refused rather than truncated: a URL cut at the cap is a different address, so
  // the row would navigate somewhere the check never saw. Costs only its own
  // widget — the section above still renders.
  it("refuses a row whose url is longer than the cap", async () => {
    const result = (await ask("?tabId=browser:a")).body as {
      sections: { widgetId: string }[];
    };

    expect(result.sections.map((section) => section.widgetId)).toEqual([
      "saved",
    ]);
  });

  it("asks nobody without a tab to ask about", async () => {
    expect(await ask("")).toEqual({
      status: 200,
      body: { ok: true, sections: [] },
    });
  });

  it("refuses a cross-origin request", async () => {
    expect((await ask("?tabId=browser:a", EVIL_ORIGIN)).status).toBe(403);
  });

  it("refuses the surface to a plugin that did not declare it", async () => {
    const entry = await harness.pluginService.installPath(
      await writePlugin(join(harness.config.dataDir, "fixtures"), {
        name: "patcher-plugin-undeclared-newtab",
        permissions: [],
        source: WIDGET_SOURCE,
      }),
    );

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toMatch(/newTab\.register/u);
  });
});
