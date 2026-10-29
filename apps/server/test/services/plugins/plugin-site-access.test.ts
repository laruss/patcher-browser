import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createConnection,
  getInstalledPlugin,
  listPluginSiteGrants,
  migrate,
  upsertInstalledPlugin,
  type DbConnection,
} from "@patcher/db";
import { browserCommandSchema } from "@patcher/domain";
import { createPluginSiteAccess } from "../../../src/services/plugins/plugin-site-access.js";
import { runWithPluginSiteCallers } from "../../../src/services/browser/plugin-site-caller.js";
import type { PluginManifest } from "../../../src/services/plugins/manifest.js";
import type { DesktopSitePolicy } from "@patcher/domain/plugin-site-access";

const databases: DbConnection[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.$client.close();
});
function fixture() {
  const db = createConnection(":memory:");
  databases.push(db);
  migrate(db);
  const row = upsertInstalledPlugin(db, {
    id: "plugin",
    source: "/plugin",
    provenance: { kind: "direct" },
    sourceIntent: { kind: "path", canonicalPath: "/plugin" },
    exactResolution: { kind: "path" },
    updateState: {
      lastCheckAt: null,
      availableCompatibleVersion: null,
      newestIncompatibleVersion: null,
      statusDetail: null,
    },
    activeArtifactId: null,
    rootDir: "/plugin",
    version: "1.0.0",
    enabled: true,
  });
  const policies = new Map<string, DesktopSitePolicy>();
  const context = {
    tabId: "tab",
    url: "https://a.example.com/private/a",
    origin: "https://a.example.com",
    documentId: randomUUID(),
  };
  const request = vi.fn(async (method: string, payload: unknown) => {
    const data = payload as Record<string, unknown>;
    if (method === "site.policy") {
      policies.set(data.pluginId as string, payload as DesktopSitePolicy);
      return true;
    }
    if (method === "site.confirm") return context;
    if (method === "site.cleanup") return [];
    if (method === "site.prepare" || method === "site.context") {
      for (const owner of data.owners as Array<{
        pluginId: string;
        revision: string;
      }>)
        if (!policies.get(owner.pluginId)?.origins.includes(context.origin))
          throw new Error("Refused by main");
      if (data.url !== undefined && data.url !== context.url)
        throw new Error("Stale URL");
      return { token: randomUUID(), ...context, hostWebContentsId: 12 };
    }
    return true;
  });
  const manifest = {
    id: "plugin",
    name: "Plugin",
    siteAccess: "runtime",
    sites: ["https://*.example.com/private/*"],
    permissions: ["tabs.read", "page.read", "page.inject"],
    packageName: "plugin",
    version: "1.0.0",
    description: "Fixture",
    branding: {},
    patcherEngineRange: undefined,
    patcherPluginSdkRange: ">=1.1.0",
    serverEntry: "/plugin/server.js",
    appEntry: undefined,
    themes: [],
    skillsRootPaths: [],
    skillNames: [],
    rootDir: "/plugin",
  } satisfies PluginManifest;
  const sites = createPluginSiteAccess({ db, request, changed: vi.fn() });
  const callScoped = vi.fn(async () => ({
    type: "url" as const,
    url: context.url,
  }));
  sites.setBridge({
    status: () => ({ connected: true, hostCount: 1, browserHostId: "host" }),
    onStatusChange: () => () => {},
    call: vi.fn(),
    callScoped,
  });
  const command = browserCommandSchema.parse({
    type: "page.get_url",
    tabId: "tab",
  });
  return { db, row, manifest, sites, request, callScoped, command, policies };
}
describe("core runtime site grants", () => {
  it("reports native access unavailable after the broker disconnects", async () => {
    const f = fixture();
    await f.sites.register(f.row, f.manifest);
    expect(f.sites.list()[0]?.available).toBe(true);
    f.request.mockRejectedValueOnce(new Error("Disconnected"));
    expect(await f.sites.cleanup()).toEqual([]);
    expect(f.sites.list()[0]?.available).toBe(false);
  });
  it("requires native confirmation before sending a browser command", async () => {
    const f = fixture();
    await f.sites.register(f.row, f.manifest);
    await expect(
      runWithPluginSiteCallers(["plugin"], () =>
        f.sites.callBrowser({ command: f.command }),
      ),
    ).rejects.toThrow();
    expect(f.callScoped).not.toHaveBeenCalled();
    await f.sites.confirm("plugin", "tab");
    expect(listPluginSiteGrants(f.db, "plugin")).toHaveLength(1);
    await runWithPluginSiteCallers(["plugin"], () =>
      f.sites.callBrowser({ command: f.command }),
    );
    expect(f.callScoped).toHaveBeenCalledWith(
      expect.objectContaining({
        nativeWebContentsId: 12,
        token: expect.any(String),
      }),
    );
  });
  it("preserves grants through restart/reload/disable and deletes them on uninstall", async () => {
    const f = fixture();
    await f.sites.register(f.row, f.manifest);
    await f.sites.confirm("plugin", "tab");
    await f.sites.disable("plugin");
    expect(listPluginSiteGrants(f.db, "plugin")).toHaveLength(1);
    await expect(
      f.sites.callBrowser({ command: f.command }, ["plugin"]),
    ).rejects.toThrow();
    const restarted = createPluginSiteAccess({
      db: f.db,
      request: f.request,
      changed: vi.fn(),
    });
    await restarted.register(getInstalledPlugin(f.db, "plugin")!, f.manifest);
    expect(restarted.list()[0]?.origins).toEqual(["https://a.example.com"]);
    await restarted.remove("plugin");
    expect(listPluginSiteGrants(f.db, "plugin")).toEqual([]);
    expect(restarted.list()[0]?.origins).toEqual([]);
  });
  it.each(["sites", "permissions", "source"])(
    "requires new confirmation after %s changes",
    async (change) => {
      const f = fixture();
      await f.sites.register(f.row, f.manifest);
      await f.sites.confirm("plugin", "tab");
      const manifest = {
        ...f.manifest,
        ...(change === "sites" ? { sites: ["https://**/**"] } : {}),
        ...(change === "permissions"
          ? {
              permissions: [
                "tabs.read",
                "page.read",
                "page.inject",
                "page.interact",
              ] as const,
            }
          : {}),
      };
      await f.sites.register(
        change === "source" ? { ...f.row, sourcePath: "/different" } : f.row,
        manifest,
      );
      expect(f.sites.list()[0]?.origins).toEqual([]);
      await f.sites.register(f.row, f.manifest);
      expect(f.sites.list()[0]?.origins).toEqual([]);
      expect(listPluginSiteGrants(f.db, "plugin")).toEqual([]);
    },
  );
  it("refuses session operations and preserves the originating plugin through a deputy", async () => {
    const f = fixture();
    await f.sites.register(f.row, f.manifest);
    await f.sites.confirm("plugin", "tab");
    await expect(
      f.sites.callBrowser(
        { command: browserCommandSchema.parse({ type: "tabs.list" }) },
        ["plugin"],
      ),
    ).rejects.toThrow();
    await expect(
      runWithPluginSiteCallers(["ungranted-parent"], () =>
        f.sites.callBrowser({ command: f.command }, [
          "ungranted-parent",
          "plugin",
        ]),
      ),
    ).rejects.toThrow();
    expect(f.callScoped).not.toHaveBeenCalled();
  });
  it("gates page callbacks and auth against main's actual context", async () => {
    const f = fixture();
    await f.sites.register(f.row, f.manifest);
    const work = vi.fn(async () => "secret");
    await expect(
      f.sites.pageCallback(
        "plugin",
        "browserSiteInfo",
        { tabId: "tab", url: "https://a.example.com/private/a" },
        work,
      ),
    ).rejects.toThrow();
    await f.sites.confirm("plugin", "tab");
    await expect(
      f.sites.pageCallback(
        "plugin",
        "browserSiteInfo",
        { tabId: "tab", url: "https://b.example.com/private/a" },
        work,
      ),
    ).rejects.toThrow();
    await expect(
      f.sites.pageCallback(
        "plugin",
        "browserAuth",
        { tabId: "tab", host: "proxy.example.com", insecure: false },
        work,
      ),
    ).rejects.toThrow();
    await expect(
      f.sites.pageCallback(
        "plugin",
        "browserOmniboxSuggest",
        { query: "secret" },
        work,
      ),
    ).rejects.toThrow();
    expect(work).not.toHaveBeenCalled();
  });
  it("keeps a successful page RPC ticket alive until main delivers its response", async () => {
    const f = fixture();
    await f.sites.register(f.row, f.manifest);
    await f.sites.confirm("plugin", "tab");
    f.request.mockClear();
    const token = randomUUID();
    expect(
      await f.sites.pageRpc(
        "plugin",
        token,
        "method",
        "",
        async () => "answer",
      ),
    ).toBe("answer");
    expect(f.request.mock.calls.map(([method]) => method)).toEqual([
      "site.redeem",
      "site.check",
    ]);
  });
  it("settles a page RPC immediately when revoked, without exposing its late reply", async () => {
    const f = fixture();
    await f.sites.register(f.row, f.manifest);
    await f.sites.confirm("plugin", "tab");
    let finish: (value: string) => void = () => {};
    const running = f.sites.pageRpc(
      "plugin",
      randomUUID(),
      "method",
      "",
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const rejected = expect(running).rejects.toThrow();
    await Promise.resolve();
    await f.sites.revoke("plugin", "https://a.example.com");
    await rejected;
    finish("late secret");
  });
  it("headless runtime work refuses while legacy plugins do not acquire runtime grants", async () => {
    const f = fixture(),
      headless = createPluginSiteAccess({ db: f.db, changed: vi.fn() });
    await headless.register(f.row, f.manifest);
    await expect(headless.confirm("plugin", "tab")).rejects.toThrow();
    const legacy = createPluginSiteAccess({
      db: f.db,
      request: f.request,
      changed: vi.fn(),
    });
    await legacy.register(f.row, { ...f.manifest, siteAccess: undefined });
    expect(legacy.isRuntime("plugin")).toBe(false);
  });
});
