// Backend tests for the private-history example, written against the official
// harness (`@patcher/plugin-sdk/testing`) — no Patcher server, no browser.
import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  pluginPermissionsFromManifest,
  type FakePluginHost,
} from "@patcher/plugin-sdk/testing";
import privateHistory from "./server";

const STORED = [
  { id: "bhist_1", url: "https://example.test/a" },
  { id: "bhist_2", url: "https://example.test/b" },
];

async function load(
  settings: Record<string, string> = {},
): Promise<FakePluginHost> {
  const host = createFakePluginHost({
    permissions: pluginPermissionsFromManifest(import.meta.url),
    pluginId: "private-history",
    loopbackBaseUrl: "http://127.0.0.1:38986",
    settings,
    sdk: {
      browserHistory: {
        list: async () => STORED,
        remove: async () => undefined,
      },
    },
  });
  await privateHistory(host.patcher);
  return host;
}

function filterOf(host: FakePluginHost) {
  const filter = host.harness.registrations.historyFilters[0];
  if (filter === undefined) {
    throw new Error("no history filter registered");
  }
  return filter;
}

function visit(url: string) {
  return { scopeId: "browser-surface", url, title: null, visitedAt: 1_000 };
}

describe("private-history", () => {
  it("drops a visit to a private host, and to anything under it", async () => {
    const host = await load({ hosts: "internal.example, bank.test" });
    const filter = filterOf(host);

    expect(await filter(visit("https://internal.example/wiki"))).toBeNull();
    expect(await filter(visit("https://vpn.internal.example/"))).toBeNull();
  });

  // A suffix match would treat "notbank.test" as "bank.test", which is how a
  // host rule quietly stops meaning what the user wrote.
  it("does not treat a host ending in the same letters as a match", async () => {
    const host = await load({ hosts: "bank.test" });

    expect(await filterOf(host)(visit("https://notbank.test/"))).not.toBeNull();
  });

  it("strips tracking parameters and leaves the rest of the URL alone", async () => {
    const host = await load();

    expect(
      await filterOf(host)(
        visit("https://example.test/post?utm_source=x&fbclid=y&page=3"),
      ),
    ).toEqual({ url: "https://example.test/post?page=3" });
  });

  // Returning nothing and returning null are opposite answers; a visit with
  // nothing to change must take the first one.
  it("decides nothing for a visit it has no opinion about", async () => {
    const host = await load({ hosts: "internal.example" });

    expect(await filterOf(host)(visit("https://example.test/post"))).toBe(
      undefined,
    );
    expect(await filterOf(host)(visit("about:blank"))).toBe(undefined);
  });

  it("says it needs configuring only while no host is named", async () => {
    expect((await load()).harness.needsConfigurationMessages).toEqual([
      expect.stringContaining("patcher plugin config private-history"),
    ]);
    expect(
      (await load({ hosts: "internal.example" })).harness
        .needsConfigurationMessages,
    ).toEqual([]);
  });

  it("deletes every stored entry its query matched", async () => {
    const host = await load();

    const result = await host.harness.runCli(["forget", "example.test"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Forgot 2 entries.");
    expect(host.harness.sdk.callsTo("browserHistory.remove")).toHaveLength(2);
  });

  // The same store, read where the user is already asking about the site.
  it("counts what it kept for the site in the padlock panel", async () => {
    const host = await load();
    const provider = host.harness.registrations.siteInfoProviders[0];
    if (provider === undefined) {
      throw new Error("no site info provider registered");
    }

    const rows = await provider.describe({
      tabId: "browser:a",
      url: "https://example.test/a",
      host: "example.test",
    });

    expect(rows).toEqual([{ label: "Pages kept", value: "2" }]);
    expect(host.harness.sdk.callsTo("browserHistory.list")).toEqual([
      [{ limit: 100, query: "example.test" }],
    ]);
  });

  // A host the user made private keeps nothing, and the panel says why rather
  // than reading as a plugin that failed to find anything.
  it("says recording is off for a private host", async () => {
    const host = await load({ hosts: "internal.example" });
    const provider = host.harness.registrations.siteInfoProviders[0];

    expect(
      await provider?.describe({
        tabId: "browser:a",
        url: "https://internal.example/wiki",
        host: "internal.example",
      }),
    ).toEqual([
      { label: "Pages kept", value: "2" },
      { label: "Recording", value: "off for this host" },
    ]);
  });

  it("refuses to forget everything by accident", async () => {
    const host = await load();

    const result = await host.harness.runCli(["forget"]);

    expect(result.exitCode).toBe(1);
    expect(host.harness.sdk.callsTo("browserHistory.remove")).toHaveLength(0);
  });
});
