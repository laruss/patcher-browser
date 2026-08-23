import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserHistoryEntry } from "@patcher/server-contract";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { pluginProcessPolicy } from "../../../src/services/plugins/plugin-placement.js";

const BASE = "http://127.0.0.1:3334/api/v1/browser-history";

/**
 * Three filters across two plugins, because composition is the property worth
 * pinning: a plugin that rewrites and a plugin that drops must both get their
 * say, in a defined order, and a plugin that throws must lose only its own.
 *
 * `patcher-plugin-history-a` sorts before `patcher-plugin-history-b`, so the rewrite is
 * applied before the drop decides on it — which is what lets the drop match a
 * URL the rewrite produced.
 */
const REWRITING_PLUGIN = `
  export default function plugin(patcher: any) {
    patcher.browser.registerHistoryFilter((visit: any) => {
      const url = new URL(visit.url);
      url.searchParams.delete("utm_source");
      return { url: url.toString(), title: visit.title ?? "Untitled" };
    });
    patcher.browser.registerHistoryFilter(() => {
      throw new Error("filter boom");
    });
  }
`;

const DROPPING_PLUGIN = `
  export default function plugin(patcher: any) {
    patcher.browser.registerHistoryFilter((visit: any) =>
      visit.url.includes("secret.test") ? null : undefined,
    );
  }
`;

async function writePlugin(
  dir: string,
  options: {
    name: string;
    permissions?: readonly string[];
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
        name: "History filter fixture",
        description: "History filter plugin fixture.",
        branding: { icon: "Zap" },
        permissions: options.permissions ?? ["history"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.source);
  return rootDir;
}

describe("plugin history filters (patcher.browser.registerHistoryFilter)", () => {
  let harness: TestAppHarness;

  async function record(
    url: string,
  ): Promise<{ status: number; entry: BrowserHistoryEntry | null }> {
    const response = await harness.app.request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopeId: "thr_a", url, title: null }),
    });
    const body = (await response.json()) as {
      entry: BrowserHistoryEntry | null;
    };
    return { status: response.status, entry: body.entry };
  }

  async function installFixtures(): Promise<void> {
    const fixtures = join(harness.config.dataDir, "fixtures");
    for (const [name, source] of [
      ["patcher-plugin-history-a", REWRITING_PLUGIN],
      ["patcher-plugin-history-b", DROPPING_PLUGIN],
    ] as const) {
      const entry = await harness.pluginService.installPath(
        await writePlugin(fixtures, { name, source }),
      );
      expect(entry.status).toBe("running");
    }
  }

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  describe("loaded in the server", () => {
    beforeEach(async () => {
      harness = await createTestAppHarness();
      await installFixtures();
    });

    it("records what the filters left, not what the browser sent", async () => {
      const recorded = await record(
        "https://example.test/docs?utm_source=newsletter",
      );

      expect(recorded.entry).toMatchObject({
        url: "https://example.test/docs",
        title: "Untitled",
      });
    });

    it("drops a visit a filter refused", async () => {
      const recorded = await record("https://secret.test/inbox");

      expect(recorded.status).toBe(200);
      expect(recorded.entry).toBeNull();
      const listed = await harness.app.request(BASE);
      expect(await listed.json()).toEqual({ entries: [] });
    });

    it("refuses a filter from a plugin that did not declare history", async () => {
      const entry = await harness.pluginService.installPath(
        await writePlugin(join(harness.config.dataDir, "fixtures"), {
          name: "patcher-plugin-history-undeclared",
          permissions: [],
          source: DROPPING_PLUGIN,
        }),
      );

      expect(entry.status).not.toBe("running");
      expect(entry.statusDetail).toMatch(/"history" permission/);
      // And its refusal costs the plugins that did declare it nothing.
      const recorded = await record("https://secret.test/inbox");
      expect(recorded.entry).toBeNull();
    });

    it("keeps a visit whose filter threw", async () => {
      // The throwing filter runs second in the rewriting plugin, so its failure
      // must not cost the rewrite that already happened, nor the visit itself.
      const recorded = await record("https://example.test/kept");

      expect(recorded.entry).toMatchObject({
        url: "https://example.test/kept",
      });
    });
  });

  // The filter is a function the plugin registered, so out of process it is a
  // message. That the same three answers survive the boundary — rewrite, drop,
  // and the difference between "returned nothing" and "returned null" — is the
  // part a second transport can get wrong.
  describe("loaded in a plugin process", () => {
    beforeEach(async () => {
      harness = await createTestAppHarness({
        runPluginOutOfProcess: pluginProcessPolicy({ enabled: true }),
      });
      await installFixtures();
    });

    it("applies the same rewrites and drops across the boundary", async () => {
      const rewritten = await record(
        "https://example.test/docs?utm_source=newsletter",
      );
      expect(rewritten.entry).toMatchObject({
        url: "https://example.test/docs",
        title: "Untitled",
      });

      const dropped = await record("https://secret.test/inbox");
      expect(dropped.entry).toBeNull();

      const kept = await record("https://example.test/kept");
      expect(kept.entry).toMatchObject({ url: "https://example.test/kept" });
    });
  });
});
