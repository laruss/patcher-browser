import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { pluginProcessPolicy } from "../../../src/services/plugins/plugin-placement.js";

const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";
const PAGE_URL = "https://example.test/article?ref=1";

/**
 * Two plugins, because a plugin may contribute one control: `patcher-plugin-star`
 * answers what its control looks like for the page, and `patcher-plugin-plain` offers
 * no `state` at all — which is the case worth pinning, since nothing should be
 * asked of it as the user browses.
 */
function starSource(observedPath: string): string {
  return `
  import { appendFileSync } from "node:fs";
  export default function plugin(patcher: any) {
    let saved = false;
    patcher.browser.registerToolbarItem({
      id: "star",
      title: "Save this page",
      icon: "Star",
      state(context: any) {
        appendFileSync(${JSON.stringify(observedPath)}, "state " + JSON.stringify(context) + "\\n");
        return saved
          // Trimmed to the cap rather than trusted.
          ? { active: true, title: "Saved " + "x".repeat(200) }
          : null;
      },
      run(context: any) {
        appendFileSync(${JSON.stringify(observedPath)}, "run " + JSON.stringify(context) + "\\n");
        saved = true;
      },
    });
  }
`;
}

const PLAIN_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.browser.registerToolbarItem({
      id: "open-elsewhere",
      title: "Open in the other browser",
      run() {},
    });
  }
`;

const TWO_CONTROLS_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.browser.registerToolbarItem({ id: "one", title: "One", run() {} });
    patcher.browser.registerToolbarItem({ id: "two", title: "Two", run() {} });
  }
`;

async function writePlugin(
  dir: string,
  options: {
    name: string;
    permissions?: readonly string[];
    serverSource: string;
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
        name: "Toolbar fixture",
        description: "Toolbar plugin fixture.",
        branding: { icon: "Zap" },
        permissions: options.permissions ?? ["toolbar.register"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin toolbar items (patcher.browser.registerToolbarItem)", () => {
  let harness: TestAppHarness;
  let observedPath: string;

  async function askStates(
    query: string,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/toolbar-state${query}`,
      { headers: { origin } },
    );
    return { status: response.status, body: await response.json() };
  }

  async function press(
    body: unknown,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/toolbar-item`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  }

  async function observed(): Promise<string[]> {
    const contents = await readFile(observedPath, "utf8").catch(() => "");
    return contents.split("\n").filter((line) => line.length > 0);
  }

  async function installFixtures(): Promise<void> {
    observedPath = join(harness.config.dataDir, "observed-toolbar.log");
    const fixtures = join(harness.config.dataDir, "fixtures");
    for (const options of [
      { name: "patcher-plugin-star", serverSource: starSource(observedPath) },
      { name: "patcher-plugin-plain", serverSource: PLAIN_SOURCE },
    ]) {
      const entry = await harness.pluginService.installPath(
        await writePlugin(fixtures, options),
      );
      expect(entry.status).toBe("running");
    }
  }

  beforeEach(async () => {
    harness = await createTestAppHarness();
    await installFixtures();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  // `hasState` is the field the app reads to decide whether to ask anything at
  // all, so it belongs to the declaration rather than to the first answer.
  it("lists its controls in GET /plugins/contributions", async () => {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    const body = (await response.json()) as { browserToolbarItems: unknown };

    expect(body.browserToolbarItems).toEqual([
      {
        pluginId: "plain",
        itemId: "open-elsewhere",
        title: "Open in the other browser",
        icon: null,
        hasState: false,
      },
      {
        pluginId: "star",
        itemId: "star",
        title: "Save this page",
        icon: "Star",
        hasState: true,
      },
    ]);
  });

  // A control with nothing to say about this page keeps what it declared, which
  // is why `null` drops out of the answer instead of arriving as "off".
  it("asks only the controls that offered a state, and drops a null one", async () => {
    const result = await askStates(
      `?tabId=browser:a&url=${encodeURIComponent(PAGE_URL)}&title=An%20article`,
    );

    expect(result).toEqual({ status: 200, body: { ok: true, states: [] } });
    // Asked once, and only of the plugin that offered to answer.
    expect(await observed()).toEqual([
      `state {"tabId":"browser:a","url":"${PAGE_URL}","title":"An article"}`,
    ]);
  });

  // The press is what changes the answer: this is the sequence a star goes
  // through, and the reason the app asks again once a press resolves.
  it("presses a control, and answers differently afterwards", async () => {
    const pressed = await press({
      pluginId: "star",
      itemId: "star",
      tabId: "browser:a",
      url: PAGE_URL,
      title: "An article",
    });

    expect(pressed).toEqual({ status: 200, body: { ok: true } });
    expect(await observed()).toEqual([
      `run {"tabId":"browser:a","url":"${PAGE_URL}","title":"An article"}`,
    ]);

    const result = await askStates(
      `?tabId=browser:a&url=${encodeURIComponent(PAGE_URL)}`,
    );

    expect(result.body).toEqual({
      ok: true,
      states: [
        {
          pluginId: "star",
          itemId: "star",
          active: true,
          // Capped: a tooltip has to fit a control in a fixed row.
          title: `Saved ${"x".repeat(54)}`,
        },
      ],
    });
  });

  it("refuses a press for a control nobody registered", async () => {
    const result = await press({
      pluginId: "star",
      itemId: "nope",
      tabId: "browser:a",
      url: PAGE_URL,
      title: null,
    });

    expect(result.status).toBe(422);
  });

  // A tab with no page has nothing for a control to be about.
  it("asks nobody about a tab with no page", async () => {
    expect(await askStates("?tabId=browser:a&url=")).toEqual({
      status: 200,
      body: { ok: true, states: [] },
    });
    expect(await observed()).toEqual([]);
  });

  // Both routes run plugin code, so both take the local-origin guard.
  it("refuses cross-origin requests", async () => {
    expect(
      (
        await askStates(
          `?tabId=browser:a&url=${encodeURIComponent(PAGE_URL)}`,
          EVIL_ORIGIN,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await press(
          {
            pluginId: "star",
            itemId: "star",
            tabId: "browser:a",
            url: PAGE_URL,
            title: null,
          },
          EVIL_ORIGIN,
        )
      ).status,
    ).toBe(403);
  });

  // The row has no room to grow, and a plugin that learned at render time which
  // of its buttons survived could not do anything about it.
  it("refuses to load a plugin that wants two controls", async () => {
    const entry = await harness.pluginService.installPath(
      await writePlugin(join(harness.config.dataDir, "fixtures"), {
        name: "patcher-plugin-greedy",
        serverSource: TWO_CONTROLS_SOURCE,
      }),
    );

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toMatch(/one toolbar control/u);
  });

  it("refuses the surface to a plugin that did not declare it", async () => {
    const entry = await harness.pluginService.installPath(
      await writePlugin(join(harness.config.dataDir, "fixtures"), {
        name: "patcher-plugin-undeclared",
        permissions: [],
        serverSource: PLAIN_SOURCE,
      }),
    );

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toMatch(/toolbar\.register/u);
  });

  // Out of process both halves become messages, and the halves are not alike: a
  // press is a call, while "does this control even have a state" is a fact that
  // has to survive the snapshot — get it wrong and either every navigation asks a
  // process that registered nothing, or a control that answers is never asked.
  describe("loaded in a plugin process", () => {
    beforeEach(async () => {
      harness = await createTestAppHarness({
        runPluginOutOfProcess: pluginProcessPolicy({ enabled: true }),
      });
      await installFixtures();
    });

    it("carries the declaration, the press and the new state across", async () => {
      const contributions = (await (
        await harness.app.request(`${BASE}/api/v1/plugins/contributions`)
      ).json()) as { browserToolbarItems: { hasState: boolean }[] };
      expect(
        contributions.browserToolbarItems.map((item) => item.hasState),
      ).toEqual([false, true]);

      expect(
        await askStates(`?tabId=browser:a&url=${encodeURIComponent(PAGE_URL)}`),
      ).toEqual({ status: 200, body: { ok: true, states: [] } });

      await press({
        pluginId: "star",
        itemId: "star",
        tabId: "browser:a",
        url: PAGE_URL,
        title: null,
      });

      const result = await askStates(
        `?tabId=browser:a&url=${encodeURIComponent(PAGE_URL)}`,
      );
      expect(result.body).toMatchObject({
        states: [{ pluginId: "star", itemId: "star", active: true }],
      });
    });
  });
});
