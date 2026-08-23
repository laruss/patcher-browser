import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BrowserHistoryEntry } from "@patcher/server-contract";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334/api/v1/browser-history";

describe("browser history routes", () => {
  let harness: TestAppHarness;

  async function record(
    visit: Record<string, unknown>,
  ): Promise<{ status: number; entry: BrowserHistoryEntry | null }> {
    const response = await harness.app.request(BASE, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(visit),
    });
    const body = (await response.json()) as {
      entry: BrowserHistoryEntry | null;
    };
    return { status: response.status, entry: body.entry };
  }

  async function list(query = ""): Promise<BrowserHistoryEntry[]> {
    const response = await harness.app.request(`${BASE}${query}`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { entries: BrowserHistoryEntry[] })
      .entries;
  }

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("records a visit and reads it back", async () => {
    const recorded = await record({
      scopeId: "browser-surface",
      url: "https://example.test/docs",
      title: "Docs",
    });

    expect(recorded.status).toBe(200);
    expect(recorded.entry).toMatchObject({
      url: "https://example.test/docs",
      title: "Docs",
      visitCount: 1,
    });
    expect(await list()).toHaveLength(1);
  });

  it("narrows a read to one scope and searches every scope", async () => {
    await record({
      scopeId: "thr_a",
      url: "https://example.test/reference",
      title: "Reference",
    });
    await record({
      scopeId: "browser-surface",
      url: "https://elsewhere.test/",
      title: "Elsewhere",
    });

    expect(await list("?scopeId=thr_a")).toHaveLength(1);
    expect(await list("?query=refer")).toHaveLength(1);
    expect(await list()).toHaveLength(2);
  });

  it("refuses a limit that is not a positive integer", async () => {
    expect((await harness.app.request(`${BASE}?limit=999999`)).status).toBe(
      200,
    );
    expect((await harness.app.request(`${BASE}?limit=0`)).status).toBe(400);
  });

  it("deletes one entry and clears a scope", async () => {
    const first = await record({
      scopeId: "thr_a",
      url: "https://first.test/",
      title: null,
    });
    await record({
      scopeId: "thr_a",
      url: "https://second.test/",
      title: null,
    });
    await record({
      scopeId: "browser-surface",
      url: "https://kept.test/",
      title: null,
    });

    const deleted = await harness.app.request(`${BASE}/${first.entry?.id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    const deletedTwice = await harness.app.request(
      `${BASE}/${first.entry?.id}`,
      { method: "DELETE" },
    );
    expect(deletedTwice.status).toBe(404);

    const cleared = await harness.app.request(BASE, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopeId: "thr_a" }),
    });
    expect(cleared.status).toBe(200);
    expect(await cleared.json()).toEqual({ removed: 1 });
    expect((await list()).map((entry) => entry.url)).toEqual([
      "https://kept.test/",
    ]);
  });

  it("tells connected clients when history is removed, but not on every visit", async () => {
    const changes: string[][] = [];
    const originalNotify = harness.hub.notifySystem.bind(harness.hub);
    harness.hub.notifySystem = (kinds) => {
      changes.push([...kinds]);
      originalNotify(kinds);
    };

    const recorded = await record({
      scopeId: "thr_a",
      url: "https://example.test/",
      title: null,
    });
    expect(changes).toEqual([]);

    await harness.app.request(`${BASE}/${recorded.entry?.id}`, {
      method: "DELETE",
    });
    expect(changes).toEqual([["browser-history-changed"]]);
  });
});
