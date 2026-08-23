// Backend tests for the omnibox-agent example, written against the official
// harness (`@patcher/plugin-sdk/testing`) — no Patcher server, no browser.
import { describe, expect, it } from "vitest";
import {
  createFakePluginHost,
  pluginPermissionsFromManifest,
  type FakePluginHost,
} from "@patcher/plugin-sdk/testing";
import omniboxAgent from "./server";

const PROJECT_ID = "proj-1";

async function load(
  settings: Record<string, string> = {},
): Promise<FakePluginHost> {
  const host = createFakePluginHost({
    permissions: pluginPermissionsFromManifest(import.meta.url),
    pluginId: "omnibox-agent",
    loopbackBaseUrl: "http://127.0.0.1:38986",
    settings,
    sdk: { threads: { spawn: async () => ({ id: "th_1" }) } },
  });
  await omniboxAgent(host.patcher);
  return host;
}

function provider(host: FakePluginHost) {
  const record = host.harness.registrations.omniboxProviders[0];
  if (record === undefined) {
    throw new Error("no omnibox provider registered");
  }
  return record;
}

describe("omnibox-agent", () => {
  it("registers one labelled omnibox provider", async () => {
    const host = await load({ project: PROJECT_ID });

    expect(host.harness.registrations.omniboxProviders).toHaveLength(1);
    expect(provider(host)).toMatchObject({ id: "agent", label: "Agent" });
  });

  // The navigate row needs no configuration, so the plugin is useful before
  // anyone opens its settings.
  it("offers only the site search until a project is configured", async () => {
    const host = await load();

    const items = await provider(host).suggest({ query: "flaky tests" });

    expect(items.map((item) => item.id)).toEqual(["github"]);
    expect(items[0]?.action).toEqual({
      type: "navigate",
      url: "https://github.com/search?q=flaky%20tests&type=repositories",
    });
    expect(host.harness.needsConfigurationMessages).toHaveLength(1);
  });

  it("offers the agent row once configured, ranked above the site search", async () => {
    const host = await load({ project: PROJECT_ID });

    const items = await provider(host).suggest({ query: "flaky tests" });

    expect(items.map((item) => item.id)).toEqual(["ask", "github"]);
    expect(items[0]?.action).toEqual({ type: "run" });
    // Below 1: the browser's own default action keeps the top row.
    expect(items[0]?.score).toBeLessThan(1);
    expect(items[0]?.score ?? 0).toBeGreaterThan(items[1]?.score ?? 0);
  });

  it("spawns a thread for the query and opens it in the tab", async () => {
    const host = await load({ project: PROJECT_ID });

    const result = await provider(host).run?.("ask", { query: "flaky tests" });

    expect(host.harness.sdk.callsTo("threads.spawn")).toEqual([
      [
        expect.objectContaining({
          environment: { type: "project-default" },
          // Filled in by the host, so the thread is attributed to this plugin.
          origin: "plugin",
          originPluginId: "omnibox-agent",
          projectId: PROJECT_ID,
          prompt: "flaky tests",
        }),
      ],
    ]);
    expect(result).toEqual({ navigate: "http://127.0.0.1:38986/threads/th_1" });
  });

  it("refuses to run without a project", async () => {
    const host = await load();

    await expect(
      provider(host).run?.("ask", { query: "flaky tests" }),
    ).rejects.toThrow(/not configured/u);
  });

  // The same idea as the "Ask an agent" row, one step further: Enter itself goes
  // to the agent, because a search engine is a template the browser formats.
  it("offers itself as a search engine, and an ordinary one too", async () => {
    const host = await load({ project: PROJECT_ID });

    expect(host.harness.registrations.searchEngines).toEqual([
      {
        id: "ask-agent",
        name: "Ask an agent",
        urlTemplate:
          "http://127.0.0.1:38986/api/v1/plugins/omnibox-agent/http/ask?q=%s",
      },
      {
        id: "kagi",
        name: "Kagi",
        urlTemplate: "https://kagi.com/search?q=%s",
      },
    ]);
  });

  it("turns a query the engine sent into a thread, and redirects to it", async () => {
    const host = await load({ project: PROJECT_ID });

    const response = await host.harness.fetchHttp(
      "GET",
      "/ask?q=why%20is%20the%20build%20slow",
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "http://127.0.0.1:38986/threads/th_1",
    );
    expect(host.harness.sdk.callsTo("threads.spawn")).toEqual([
      [
        expect.objectContaining({
          projectId: PROJECT_ID,
          prompt: "why is the build slow",
        }),
      ],
    ]);
  });

  it("says so rather than spawning when the engine sends nothing useful", async () => {
    const configured = await load({ project: PROJECT_ID });
    expect(
      (await configured.harness.fetchHttp("GET", "/ask?q=%20")).status,
    ).toBe(400);
    expect(configured.harness.sdk.callsTo("threads.spawn")).toEqual([]);

    const unconfigured = await load();
    expect(
      (await unconfigured.harness.fetchHttp("GET", "/ask?q=anything")).status,
    ).toBe(503);
  });

  it("rejects an unknown item id", async () => {
    const host = await load({ project: PROJECT_ID });

    await expect(
      provider(host).run?.("nope", { query: "flaky tests" }),
    ).rejects.toThrow(/unknown omnibox item/u);
  });
});
