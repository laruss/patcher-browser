import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

// The harness config uses serverPort 3334, so this host is on the local-app
// origin allowlist the "local" auth mode enforces.
const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

const COMPLETED_DOWNLOAD = {
  id: "download-1",
  tabId: "browser:a",
  filename: "report.pdf",
  savePath: "/tmp/downloads/report.pdf",
  url: "https://example.com/report.pdf",
  mimeType: "application/pdf",
  state: "completed",
};

/**
 * Two handlers in one plugin: the first records what it was handed, the second
 * throws. Registration order puts the throwing one second on purpose — the
 * property under test is that neither can stop the other, and a recorder that
 * only ever ran first would not show that.
 */
function downloadSource(observedPath: string): string {
  return `
  import { appendFileSync } from "node:fs";
  export default function plugin(patcher: any) {
    patcher.browser.registerDownloadHandler((download: any) => {
      appendFileSync(${JSON.stringify(observedPath)}, JSON.stringify(download) + "\\n");
    });
    patcher.browser.registerDownloadHandler(() => {
      throw new Error("handler boom");
    });
  }
`;
}

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
        name: "Download handler fixture",
        description: "Download handler plugin fixture.",
        branding: { icon: "Zap" },
        permissions: ["downloads.handle"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin download handlers (patcher.browser.registerDownloadHandler)", () => {
  let harness: TestAppHarness;
  let observedPath: string;

  async function report(
    body: unknown,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/downloads`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  }

  async function observed(): Promise<unknown[]> {
    const contents = await readFile(observedPath, "utf8").catch(() => "");
    return contents
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as unknown);
  }

  beforeEach(async () => {
    harness = await createTestAppHarness();
    observedPath = join(harness.config.dataDir, "observed-downloads.log");
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name: "patcher-plugin-downloads",
        serverSource: downloadSource(observedPath),
      },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  // The point of the contribution point: a plugin sees the finished file, with
  // enough about it to decide what to do — where it came from and what it is,
  // not just its name.
  it("hands a finished download to every registered handler", async () => {
    const result = await report(COMPLETED_DOWNLOAD);

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, handlerCount: 2 });
    expect(await observed()).toEqual([COMPLETED_DOWNLOAD]);
  });

  // Same discipline as omnibox providers: one plugin's bad handler is its own
  // problem. The browser has already written the file either way.
  it("isolates a throwing handler from the others", async () => {
    const result = await report(COMPLETED_DOWNLOAD);

    expect(result.status).toBe(200);
    expect((await observed()).length).toBe(1);

    // And the next download still reaches the healthy handler.
    await report({ ...COMPLETED_DOWNLOAD, id: "download-2" });
    expect((await observed()).length).toBe(2);
  });

  // A failure is worth handing over too: a plugin syncing downloads elsewhere
  // needs to know one did not arrive.
  it("reports failures and refusals, with no path for a refusal", async () => {
    await report({
      ...COMPLETED_DOWNLOAD,
      id: "download-3",
      savePath: null,
      state: "refused",
    });

    expect(await observed()).toEqual([
      {
        ...COMPLETED_DOWNLOAD,
        id: "download-3",
        savePath: null,
        state: "refused",
      },
    ]);
  });

  it("refuses a payload that is not a download", async () => {
    const missingState = await report({
      id: "download-4",
      tabId: "browser:a",
      filename: "report.pdf",
      savePath: null,
      url: "https://example.com/",
      mimeType: "application/pdf",
    });
    expect(missingState.status).toBe(400);

    const unknownState = await report({
      ...COMPLETED_DOWNLOAD,
      state: "started",
    });
    expect(unknownState.status).toBe(400);

    expect(await observed()).toEqual([]);
  });

  // This route runs plugin code, so it takes the same guard as the rest.
  it("refuses a cross-origin report", async () => {
    const result = await report(COMPLETED_DOWNLOAD, EVIL_ORIGIN);

    expect(result.status).toBe(403);
    expect(await observed()).toEqual([]);
  });
});
