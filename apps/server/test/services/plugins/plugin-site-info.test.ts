import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";
const PAGE_URL = "https://example.test/article?ref=1";

/**
 * Three providers: one that describes the site, one that has nothing to say
 * about it, and one that throws. Only the first should reach the popover.
 */
const SITE_INFO_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.browser.registerSiteInfoProvider({
      id: "logins",
      label: "Passwords",
      describe(context: any) {
        return [
          { label: "Saved logins", value: context.host },
          { label: "Tab", value: context.tabId },
          // Trimmed to the cap rather than trusted.
          { label: "Long", value: "x".repeat(500) },
        ];
      },
    });
    patcher.browser.registerSiteInfoProvider({
      id: "quiet",
      label: "Nothing",
      describe() {
        return null;
      },
    });
    patcher.browser.registerSiteInfoProvider({
      id: "boom",
      label: "Explodes",
      describe() {
        throw new Error("describe boom");
      },
    });
  }
`;

async function writePlugin(dir: string): Promise<string> {
  const rootDir = join(dir, "patcher-plugin-site");
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: "patcher-plugin-site",
      version: "0.1.0",
      patcher: {
        name: "Site info fixture",
        description: "Site info plugin fixture.",
        branding: { icon: "Zap" },
        permissions: ["siteInfo.register"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), SITE_INFO_SOURCE);
  return rootDir;
}

describe("plugin site info (patcher.browser.registerSiteInfoProvider)", () => {
  let harness: TestAppHarness;

  async function ask(
    query: string,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/site-info${query}`,
      { headers: { origin } },
    );
    return { status: response.status, body: await response.json() };
  }

  beforeEach(async () => {
    harness = await createTestAppHarness();
    const rootDir = await writePlugin(join(harness.config.dataDir, "fixtures"));
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("answers with the sections that had something to say", async () => {
    const result = await ask(
      `?tabId=browser:a&url=${encodeURIComponent(PAGE_URL)}`,
    );

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      ok: true,
      sections: [
        {
          pluginId: "site",
          providerId: "logins",
          label: "Passwords",
          rows: [
            // The host is the server's own reading of the URL, not the caller's.
            { label: "Saved logins", value: "example.test" },
            { label: "Tab", value: "browser:a" },
            { label: "Long", value: "x".repeat(200) },
          ],
        },
      ],
    });
  });

  // A tab with no page has no site, so nobody is asked about one.
  it("asks nobody about a tab with no page", async () => {
    expect(await ask("?tabId=browser:a&url=")).toEqual({
      status: 200,
      body: { ok: true, sections: [] },
    });
    expect(await ask("")).toEqual({
      status: 200,
      body: { ok: true, sections: [] },
    });
  });

  // Reading what plugins know still runs plugin code, so it takes the same guard.
  it("refuses a cross-origin request", async () => {
    const result = await ask(
      `?tabId=browser:a&url=${encodeURIComponent(PAGE_URL)}`,
      EVIL_ORIGIN,
    );

    expect(result.status).toBe(403);
  });
});
