import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

const LINK = { url: "https://tracker.example.com/issue/7" };

/**
 * Every fixture is installed, so every one of these runs the handler **out of
 * process** — which is where a decision has to survive JSON, and where
 * "declined" and "took it over" stop being distinguishable if either side gets
 * the normalisation wrong.
 */
function rewritingSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerExternalLinkHandler((link: any) =>
      link.url.includes("tracker.example.com")
        ? { url: "https://work.example.com/issues/7" }
        : null,
    );
  }
`;
}

function takingOverSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerExternalLinkHandler(() => ({ handled: true }));
  }
`;
}

function decliningSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerExternalLinkHandler(() => null);
    patcher.browser.registerExternalLinkHandler(() => undefined);
    patcher.browser.registerExternalLinkHandler(() => 42);
    patcher.browser.registerExternalLinkHandler(() => ({}));
  }
`;
}

function throwingSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerExternalLinkHandler(() => {
      throw new Error("the router is down");
    });
  }
`;
}

function unopenableSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerExternalLinkHandler(() => ({ url: "file:///etc/passwd" }));
  }
`;
}

async function writePlugin(
  dir: string,
  options: { name: string; serverSource: string; permissions?: string[] },
): Promise<string> {
  const rootDir = join(dir, options.name);
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    join(rootDir, "package.json"),
    JSON.stringify({
      name: options.name,
      version: "0.1.0",
      patcher: {
        name: "Link fixture",
        description: "External link handler fixture.",
        branding: { icon: "Zap" },
        permissions: options.permissions ?? ["externalLink.handle"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin external link handlers (patcher.browser.registerExternalLinkHandler)", () => {
  let harness: TestAppHarness;

  async function install(
    name: string,
    serverSource: string,
    permissions?: string[],
  ): Promise<string> {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      { name, serverSource, permissions },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    return entry.status;
  }

  async function resolve(
    body: unknown,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/external-link`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  }

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("answers with the address a handler rewrote", async () => {
    expect(await install("patcher-plugin-router", rewritingSource())).toBe(
      "running",
    );

    expect(await resolve(LINK)).toEqual({
      status: 200,
      body: {
        ok: true,
        decision: { url: "https://work.example.com/issues/7" },
      },
    });
  });

  it("answers that a handler took the link over", async () => {
    expect(await install("patcher-plugin-filer", takingOverSource())).toBe(
      "running",
    );

    expect(await resolve(LINK)).toEqual({
      status: 200,
      body: { ok: true, decision: { handled: true } },
    });
  });

  // Nobody deciding is the normal case, and it has to be indistinguishable from
  // having no plugins at all: the link opens in a tab either way.
  it("answers null with no handler installed, and when none decides", async () => {
    expect(await resolve(LINK)).toEqual({
      status: 200,
      body: { ok: true, decision: null },
    });

    expect(await install("patcher-plugin-aaa", decliningSource())).toBe(
      "running",
    );

    expect(await resolve(LINK)).toEqual({
      status: 200,
      body: { ok: true, decision: null },
    });
  });

  // Declining, answering with the wrong shape, and throwing all mean the same
  // thing: ask the next one, in plugin id order.
  it("walks past handlers that decline, malform or throw", async () => {
    expect(await install("patcher-plugin-aaa", decliningSource())).toBe(
      "running",
    );
    expect(await install("patcher-plugin-bbb", throwingSource())).toBe(
      "running",
    );
    expect(await install("patcher-plugin-ccc", rewritingSource())).toBe(
      "running",
    );

    expect((await resolve(LINK)).body).toEqual({
      ok: true,
      decision: { url: "https://work.example.com/issues/7" },
    });
  });

  // A plugin may redirect a link but not change what a link is: the rewrite
  // opens in a browsed view, which refuses `file:` for the reason it always has.
  it("drops an address that is not a page and asks the next handler", async () => {
    expect(await install("patcher-plugin-aaa", unopenableSource())).toBe(
      "running",
    );
    expect(await install("patcher-plugin-bbb", rewritingSource())).toBe(
      "running",
    );

    expect((await resolve(LINK)).body).toEqual({
      ok: true,
      decision: { url: "https://work.example.com/issues/7" },
    });
  });

  // Registration is gated in the register call itself, so an undeclared plugin
  // never half-registers — it fails to load.
  it("refuses to register without the permission", async () => {
    expect(await install("patcher-plugin-ungated", rewritingSource(), [])).toBe(
      "error",
    );

    expect((await resolve(LINK)).body).toEqual({ ok: true, decision: null });
  });

  it("refuses a payload that is not a link", async () => {
    expect((await resolve({})).status).toBe(400);
  });

  // Handlers are promised a page, and this route is where that promise is kept:
  // the shell's queue is `http(s)` only, but the shell is not the only caller
  // that can reach here.
  it("refuses an address a handler must never be handed", async () => {
    expect(await install("patcher-plugin-router", rewritingSource())).toBe(
      "running",
    );

    expect((await resolve({ url: "file:///etc/passwd" })).status).toBe(400);
    expect((await resolve({ url: "javascript:alert(1)" })).status).toBe(400);
    expect((await resolve({ url: "not a url" })).status).toBe(400);
  });

  // This route runs plugin code, so it takes the same guard as the rest.
  it("refuses a cross-origin caller", async () => {
    expect(await install("patcher-plugin-router", rewritingSource())).toBe(
      "running",
    );

    const result = await resolve(LINK, EVIL_ORIGIN);

    expect(result.status).toBe(403);
    expect(result.body).not.toMatchObject({ decision: expect.anything() });
  });
});
