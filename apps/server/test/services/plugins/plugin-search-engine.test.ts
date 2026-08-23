import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

/**
 * Three engines: a plain one, a loopback one (a plugin route *is* a legal
 * engine), and one whose template must be refused at load.
 */
function engineSource(templates: { evil?: string }): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerSearchEngine({
      id: "kagi",
      name: "Kagi",
      urlTemplate: "https://kagi.com/search?q=%s",
    });
    patcher.browser.registerSearchEngine({
      id: "ask-agent",
      name: "Ask an agent",
      urlTemplate: "http://127.0.0.1:38986/api/v1/plugins/engines/http/ask?q=%s",
    });
    ${
      templates.evil === undefined
        ? ""
        : `patcher.browser.registerSearchEngine({
      id: "evil",
      name: "Evil",
      urlTemplate: ${JSON.stringify(templates.evil)},
    });`
    }
  }
`;
}

async function writePlugin(dir: string, source: string): Promise<string> {
  const rootDir = join(dir, "patcher-plugin-engines");
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "patcher-plugin-engines",
      version: "0.1.0",
      patcher: {
        name: "Search engine fixture",
        description: "Search engine plugin fixture.",
        branding: { icon: "Search" },
        permissions: ["searchEngine.register"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), source);
  return rootDir;
}

describe("plugin search engines (patcher.browser.registerSearchEngine)", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("lists what it offered in GET /plugins/contributions", async () => {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      engineSource({}),
    );
    expect((await harness.pluginService.installPath(rootDir)).status).toBe(
      "running",
    );

    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    const body = (await response.json()) as { browserSearchEngines: unknown };

    expect(body.browserSearchEngines).toEqual([
      {
        pluginId: "engines",
        id: "kagi",
        name: "Kagi",
        urlTemplate: "https://kagi.com/search?q=%s",
      },
      {
        pluginId: "engines",
        id: "ask-agent",
        name: "Ask an agent",
        // A plugin's own loopback route is a legal engine — which is how "Enter
        // asks an agent" is built.
        urlTemplate:
          "http://127.0.0.1:38986/api/v1/plugins/engines/http/ask?q=%s",
      },
    ]);
  });

  // A search is every word typed into the address bar, so the refusal happens at
  // load: an engine that cannot be used must never reach the user's setting.
  it("refuses to load a plugin whose engine would leak the query", async () => {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      engineSource({ evil: "http://evil.test/?q=%s" }),
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toMatch(/urlTemplate/u);
  });

  it("refuses a template with nowhere to put the query", async () => {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      engineSource({ evil: "https://example.test/search" }),
    );

    const entry = await harness.pluginService.installPath(rootDir);

    expect(entry.status).toBe("error");
  });

  it("refuses the surface to a plugin that did not declare it", async () => {
    const rootDir = join(harness.config.dataDir, "fixtures", "undeclared");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "patcher-plugin-undeclared-engine",
        version: "0.1.0",
        patcher: {
          name: "Undeclared",
          description: "No permission.",
          branding: { icon: "Search" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(join(rootDir, "server.ts"), engineSource({}));

    const entry = await harness.pluginService.installPath(rootDir);

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toMatch(/"searchEngine\.register" permission/u);
  });
});
