import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

const DOCUMENT = {
  tabId: "browser:a",
  pageUrl: "https://example.com/scan.pdf",
  title: "scan.pdf",
};

/**
 * Providers are only ever asked about a document the browser has already read
 * and found no text in, so these fixtures are the shapes that matter: one that
 * declines, one that answers, and the ways a provider fails without taking the
 * next one down with it.
 */
function decliningSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerPdfTextProvider(() => null);
    patcher.browser.registerPdfTextProvider(() => "");
    patcher.browser.registerPdfTextProvider(() => 42);
  }
`;
}

function answeringSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerPdfTextProvider((document: any) =>
      document.pageUrl.endsWith("scan.pdf")
        ? "Scanned page one, read by OCR."
        : null,
    );
  }
`;
}

function throwingSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerPdfTextProvider(() => {
      throw new Error("the OCR service is down");
    });
  }
`;
}

function longAnswerSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerPdfTextProvider(() => "x".repeat(70000));
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
        name: "PDF fixture",
        description: "PDF text provider fixture.",
        branding: { icon: "Zap" },
        permissions: ["pdf.provide"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin PDF text providers (patcher.browser.registerPdfTextProvider)", () => {
  let harness: TestAppHarness;

  async function install(name: string, serverSource: string): Promise<void> {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      { name, serverSource },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  }

  async function resolve(
    body: unknown,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/pdf-text`,
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

  it("answers with the text a provider produced", async () => {
    await install("patcher-plugin-ocr", answeringSource());

    expect(await resolve(DOCUMENT)).toEqual({
      status: 200,
      body: { ok: true, text: "Scanned page one, read by OCR." },
    });
  });

  // Nobody answering is not a failure: it is what tells the agent the document
  // has no text layer, which is what it had before any plugin existed.
  it("answers empty when no provider has anything, and with none installed", async () => {
    expect(await resolve(DOCUMENT)).toEqual({
      status: 200,
      body: { ok: true, text: "" },
    });

    await install("patcher-plugin-ocr", answeringSource());

    expect(
      await resolve({ ...DOCUMENT, pageUrl: "https://example.com/a.pdf" }),
    ).toEqual({ status: 200, body: { ok: true, text: "" } });
  });

  // Declining, answering with the wrong shape, answering with nothing, and
  // throwing all mean the same thing: ask the next one.
  it("walks past providers that decline, malform or throw", async () => {
    await install("patcher-plugin-aaa", decliningSource());
    await install("patcher-plugin-bbb", throwingSource());
    await install("patcher-plugin-ocr", answeringSource());

    expect((await resolve(DOCUMENT)).body).toEqual({
      ok: true,
      text: "Scanned page one, read by OCR.",
    });
  });

  it("caps what a provider returns at the browser's own page-read cap", async () => {
    // A plugin's text lands in the same agent context the browser's would
    // have, so it is bounded by the same number.
    await install("patcher-plugin-ocr", longAnswerSource());

    const result = await resolve(DOCUMENT);
    const text = (result.body as { text: string }).text;

    expect(text).toHaveLength(65_536);
  });

  it("refuses a payload that is not a document", async () => {
    expect((await resolve({ tabId: "browser:a" })).status).toBe(400);
  });

  // This route runs plugin code, so it takes the same guard as the rest.
  it("refuses a cross-origin caller", async () => {
    await install("patcher-plugin-ocr", answeringSource());

    const result = await resolve(DOCUMENT, EVIL_ORIGIN);

    expect(result.status).toBe(403);
    expect(result.body).not.toMatchObject({ text: expect.anything() });
  });
});
