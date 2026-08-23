import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConnection, migrate, type DbConnection } from "@patcher/db";
import type { Logger } from "@patcher/logger";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";
import {
  createTestAppHarness,
  testLogger,
  type TestAppHarness,
} from "../../helpers/test-app.js";

// The harness config uses serverPort 3334, so this host is on the local-app
// origin allowlist the "local" auth mode enforces.
const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

const logger = testLogger as unknown as Logger;

// One fixture covering the whole surface: a healthy provider with both action
// kinds (its subtitle echoes the query so forwarding is observable, and its run
// echoes the run context), a provider whose suggest throws, and a provider that
// returns a run action it cannot perform.
const OMNIBOX_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.browser.registerOmniboxProvider({
      id: "agent",
      label: "Agent",
      async suggest(ctx: any) {
        if (ctx.query === "none") return [];
        return [
          { id: "ask", title: "Ask an agent", subtitle: "q:" + ctx.query, score: 0.8, action: { type: "run" } },
          { id: "docs", title: "Docs search", score: 42, action: { type: "navigate", url: "https://docs.test/?q=" + ctx.query } },
          { id: "plain", title: "No score", action: { type: "navigate", url: "https://plain.test/" } },
        ];
      },
      async run(itemId: string, ctx: any) {
        if (itemId === "boom") throw new Error("run boom");
        if (itemId === "silent") return undefined;
        return { navigate: "https://ran.test/" + itemId + "?q=" + ctx.query };
      },
    });
    patcher.browser.registerOmniboxProvider({
      id: "broken",
      label: "Broken",
      async suggest() {
        throw new Error("suggest boom");
      },
    });
    patcher.browser.registerOmniboxProvider({
      id: "unrunnable",
      label: "Unrunnable",
      async suggest() {
        return [{ id: "x", title: "Cannot run", action: { type: "run" } }];
      },
    });
  }
`;

/** A provider that never answers, for the suggest time box. */
const HANGING_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.browser.registerOmniboxProvider({
      id: "hangs",
      label: "Hangs",
      suggest() {
        return new Promise(() => {});
      },
    });
    patcher.browser.registerOmniboxProvider({
      id: "fast",
      label: "Fast",
      suggest() {
        return [{ id: "row", title: "Fast row", action: { type: "navigate", url: "https://fast.test/" } }];
      },
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
        name: "Omnibox provider fixture",
        description: "Omnibox provider plugin fixture.",
        branding: { icon: "Zap" },
        permissions: ["omnibox.register"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

async function runAction(
  harness: TestAppHarness,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const response = await harness.app.request(
    `${BASE}/api/v1/plugins/omnibox/run`,
    {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}

describe("plugin omnibox providers (patcher.browser.registerOmniboxProvider)", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      { name: "patcher-plugin-omnibox", serverSource: OMNIBOX_SOURCE },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("lists omnibox providers in GET /plugins/contributions", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { omniboxProviders: unknown };
    expect(body.omniboxProviders).toEqual([
      { pluginId: "omnibox", id: "agent", label: "Agent" },
      { pluginId: "omnibox", id: "broken", label: "Broken" },
      { pluginId: "omnibox", id: "unrunnable", label: "Unrunnable" },
    ]);
  });

  it("aggregates suggestions, namespaces item ids, clamps scores, and drops bad providers", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/omnibox/suggest?q=flake`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; groups: unknown };
    expect(body.ok).toBe(true);
    expect(body.groups).toEqual([
      {
        pluginId: "omnibox",
        providerId: "agent",
        label: "Agent",
        items: [
          {
            itemId: "agent:ask",
            title: "Ask an agent",
            // The provider saw the forwarded query.
            subtitle: "q:flake",
            score: 0.8,
            action: { type: "run" },
          },
          {
            itemId: "agent:docs",
            title: "Docs search",
            subtitle: null,
            // 42 clamped: a plugin cannot outbid the browser's default action.
            score: 1,
            action: { type: "navigate", url: "https://docs.test/?q=flake" },
          },
          {
            itemId: "agent:plain",
            title: "No score",
            subtitle: null,
            score: 0.5,
            action: { type: "navigate", url: "https://plain.test/" },
          },
        ],
      },
    ]);
    // Both the throwing provider and the one offering an unperformable action
    // counted as handler errors rather than breaking the route.
    const entry = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "omnibox");
    expect(entry?.handlerStats.errorCount).toBe(2);
  });

  it("returns no groups for a blank query without running providers", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/omnibox/suggest?q=%20%20`,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, groups: [] });
    const entry = harness.pluginService
      .list()
      .find((plugin) => plugin.id === "omnibox");
    expect(entry?.handlerStats.errorCount).toBe(0);
  });

  it("drops providers that return nothing", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/omnibox/suggest?q=none`,
    );
    const body = (await response.json()) as { groups: unknown[] };
    expect(body.groups).toEqual([]);
  });

  it("performs a run action and returns the url to open", async () => {
    const outcome = await runAction(harness, {
      itemId: "agent:ask",
      pluginId: "omnibox",
      query: "flake",
    });

    expect(outcome.status).toBe(200);
    // The run handler received both the item id and the query it was offered for.
    expect(outcome.body).toEqual({
      ok: true,
      navigate: "https://ran.test/ask?q=flake",
    });
  });

  it("reports no url when the action asks for nothing", async () => {
    const outcome = await runAction(harness, {
      itemId: "agent:silent",
      pluginId: "omnibox",
      query: "flake",
    });

    expect(outcome.body).toEqual({ ok: true, navigate: null });
  });

  it("reports a throwing action instead of navigating", async () => {
    const outcome = await runAction(harness, {
      itemId: "agent:boom",
      pluginId: "omnibox",
      query: "flake",
    });

    expect(outcome.status).toBe(422);
    expect(outcome.body).toMatchObject({ ok: false });
  });

  it("rejects a provider with no run handler, an unknown provider, and a malformed id", async () => {
    expect(
      (
        await runAction(harness, {
          itemId: "unrunnable:x",
          pluginId: "omnibox",
          query: "flake",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await runAction(harness, {
          itemId: "nope:x",
          pluginId: "omnibox",
          query: "flake",
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await runAction(harness, {
          itemId: "malformed",
          pluginId: "omnibox",
          query: "flake",
        })
      ).status,
    ).toBe(422);
  });

  it("rejects a run request without an item, plugin, or query", async () => {
    expect(
      (await runAction(harness, { pluginId: "omnibox", query: "flake" }))
        .status,
    ).toBe(400);
    expect(
      (await runAction(harness, { itemId: "agent:ask", pluginId: "omnibox" }))
        .status,
    ).toBe(400);
  });

  // Both routes run plugin code, so they take the same local-origin guard as
  // the rpc dispatcher.
  it("refuses cross-origin callers", async () => {
    const suggest = await harness.app.request(
      `${BASE}/api/v1/plugins/omnibox/suggest?q=flake`,
      { headers: { origin: EVIL_ORIGIN } },
    );
    expect(suggest.status).toBe(403);

    const run = await harness.app.request(
      `${BASE}/api/v1/plugins/omnibox/run`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: EVIL_ORIGIN },
        body: JSON.stringify({
          itemId: "agent:ask",
          pluginId: "omnibox",
          query: "flake",
        }),
      },
    );
    expect(run.status).toBe(403);
  });
});

// The time box is what keeps one slow plugin from stalling every keystroke, so
// it is asserted directly against a service with a tiny budget.
describe("omnibox suggest time box", () => {
  let workDir: string;
  let db: DbConnection;
  let service: PluginService;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "patcher-omnibox-timeout-"));
    db = createConnection(join(workDir, "patcher.db"));
    migrate(db);
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger,
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      loadTimeoutMs: 2000,
      omniboxSuggestTimeoutMs: 25,
    });
  });

  afterEach(async () => {
    await service.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("drops a provider that never answers and keeps the rest", async () => {
    const rootDir = await writePlugin(workDir, {
      name: "patcher-plugin-omnibox-hangs",
      serverSource: HANGING_SOURCE,
    });
    const entry = await service.installPath(rootDir);
    expect(entry.status).toBe("running");

    const groups = await service.suggestOmnibox({ query: "flake" });

    expect(groups.map((group) => group.providerId)).toEqual(["fast"]);
  });
});
