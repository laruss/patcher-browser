import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";
const EVIL_ORIGIN = "https://evil.example";

const CHALLENGE = {
  tabId: "browser:a",
  host: "example.com",
  insecure: false,
};

/**
 * Two plugins: the first (by id) declines everything, the second answers for
 * one host. Ordering is what the "first to answer wins" rule is about.
 */
function decliningSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerAuthProvider(() => null);
    patcher.browser.registerAuthProvider(() => ({ username: 42 }));
  }
`;
}

function answeringSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerAuthProvider((challenge: any) =>
      challenge.host === "example.com"
        ? { username: "ada", password: "hunter2" }
        : null,
    );
  }
`;
}

function throwingSource(): string {
  return `
  export default function plugin(patcher: any) {
    patcher.browser.registerAuthProvider(() => {
      throw new Error("keychain locked");
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
        name: "Auth fixture",
        description: "Auth provider fixture.",
        branding: { icon: "Zap" },
        permissions: ["auth.provide"],
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.serverSource);
  return rootDir;
}

describe("plugin auth providers (patcher.browser.registerAuthProvider)", () => {
  let harness: TestAppHarness;

  async function install(name: string, serverSource: string): Promise<void> {
    const rootDir = await writePlugin(
      join(harness.config.dataDir, "fixtures"),
      {
        name,
        serverSource,
      },
    );
    const entry = await harness.pluginService.installPath(rootDir);
    expect(entry.status).toBe("running");
  }

  async function resolve(
    body: unknown,
    origin = BASE,
  ): Promise<{ status: number; body: unknown }> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/browser/auth`,
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

  it("answers with the credentials a provider supplied", async () => {
    await install("patcher-plugin-vault", answeringSource());

    const result = await resolve(CHALLENGE);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, credentials: { username: "ada", password: "hunter2" } },
    });
  });

  // Nobody answering is not a failure: it is what sends the question to the
  // user, which is where it started.
  it("answers null when no provider has credentials", async () => {
    await install("patcher-plugin-vault", answeringSource());

    const result = await resolve({ ...CHALLENGE, host: "other.test" });

    expect(result).toEqual({
      status: 200,
      body: { ok: true, credentials: null },
    });
  });

  it("answers null with no providers at all", async () => {
    const result = await resolve(CHALLENGE);

    expect(result).toEqual({
      status: 200,
      body: { ok: true, credentials: null },
    });
  });

  // Declining, answering with the wrong shape, and throwing all mean the same
  // thing here: ask the next one.
  it("walks past providers that decline, malform or throw", async () => {
    await install("patcher-plugin-aaa", decliningSource());
    await install("patcher-plugin-bbb", throwingSource());
    await install("patcher-plugin-vault", answeringSource());

    const result = await resolve(CHALLENGE);

    expect(result.body).toEqual({
      ok: true,
      credentials: { username: "ada", password: "hunter2" },
    });
  });

  it("refuses a payload that is not a challenge", async () => {
    const result = await resolve({ tabId: "browser:a", host: "" });

    expect(result.status).toBe(400);
  });

  // This route's answer is a credential, so it takes the same guard as the rest.
  it("refuses a cross-origin caller", async () => {
    await install("patcher-plugin-vault", answeringSource());

    const result = await resolve(CHALLENGE, EVIL_ORIGIN);

    expect(result.status).toBe(403);
    expect(result.body).not.toMatchObject({ credentials: expect.anything() });
  });
});
