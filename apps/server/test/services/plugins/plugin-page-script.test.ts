import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

/**
 * `patcher.browser.registerPageScript` — the plugin's own program in a browsed page.
 *
 * The consent model is the page style's, deliberately: the same `patcher.sites`, the
 * same membership rule, the same three places a refusal can land. What is new is
 * the *second* permission over that list, because a stylesheet that cannot read
 * the page and a program that can are not the same thing to agree to — a plugin
 * holding `pageStyle.register` for github.com must not thereby be able to read
 * what the user is doing there.
 *
 * What running the code looks like is the shell's business, and is tested where
 * it happens (apps/desktop). Here: what the server hands over, and what it
 * refuses to.
 */

const SCRIPT_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.browser.registerPageScript({
      id: "toolbar",
      matches: ["https://github.com/**"],
      code: "patcher.ready(function () { document.title = 'seen'; });",
    });
  }
`;

async function writePlugin(
  dir: string,
  options: {
    name: string;
    source: string;
    permissions?: readonly string[];
    sites?: readonly string[];
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
        name: "Page script fixture",
        description: "Page script fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        permissions: options.permissions ?? ["pageScript.register"],
        ...(options.sites === undefined ? {} : { sites: options.sites }),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.source);
  return rootDir;
}

describe("plugin page scripts (patcher.browser.registerPageScript)", () => {
  let harness: TestAppHarness;

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  async function install(options: {
    source: string;
    permissions?: readonly string[];
    sites?: readonly string[];
  }): Promise<{ status: string; statusDetail: string | null }> {
    harness = await createTestAppHarness();
    const entry = await harness.pluginService.installPath(
      await writePlugin(join(harness.config.dataDir, "fixtures"), {
        name: "patcher-plugin-script",
        source: options.source,
        ...(options.permissions === undefined
          ? {}
          : { permissions: options.permissions }),
        ...(options.sites === undefined ? {} : { sites: options.sites }),
      }),
    );
    return { status: entry.status, statusDetail: entry.statusDetail };
  }

  async function contributions(): Promise<unknown> {
    const response = await harness.app.request(
      `${BASE}/api/v1/plugins/contributions`,
    );
    return ((await response.json()) as { browserPageScripts: unknown })
      .browserPageScripts;
  }

  it("carries the source itself in GET /plugins/contributions", async () => {
    expect(
      await install({
        source: SCRIPT_SOURCE,
        sites: ["https://github.com/**"],
      }),
    ).toEqual({ status: "running", statusDetail: null });

    // The text, not a handle: the shell has to hand this to a document as the
    // document is created, and nothing in that moment can wait on this process.
    expect(await contributions()).toEqual([
      {
        pluginId: "script",
        scriptId: "toolbar",
        matches: ["https://github.com/**"],
        code: "patcher.ready(function () { document.title = 'seen'; });",
      },
    ]);
  });

  it("refuses a match the plugin did not declare, and says what it did", async () => {
    const entry = await install({
      source: SCRIPT_SOURCE,
      sites: ["https://gitlab.com/**"],
    });

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain('"patcher.sites"');
    expect(entry.statusDetail).toContain("https://gitlab.com/**");
    expect(await contributions()).toEqual([]);
  });

  it("refuses a script from a plugin that declared no sites at all", async () => {
    const entry = await install({ source: SCRIPT_SOURCE });

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain("That list is empty");
  });

  // The reason this is a permission of its own rather than a second use of the
  // styling one: reading a page the user is signed in to is not restyling it.
  it("does not let the page-style permission run code", async () => {
    const entry = await install({
      source: SCRIPT_SOURCE,
      permissions: ["pageStyle.register"],
      sites: ["https://github.com/**"],
    });

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain("pageScript.register");
  });

  it("refuses a site pattern the manifest itself may not carry", async () => {
    await expect(
      install({
        source: SCRIPT_SOURCE,
        sites: ["http://intranet.example/**"],
      }),
    ).rejects.toThrow(/patcher\.sites\.0.*http:\/\/intranet\.example/su);
  });

  // A pattern that would be shown to the user at install and then claim no page
  // at all: hosts are matched exactly, and Chromium never reports an upper-case
  // one. Refused rather than corrected, because `matches` has to equal the
  // declared string verbatim.
  it("refuses a site whose host is not lower case, and says what to write", async () => {
    await expect(
      install({
        source: SCRIPT_SOURCE,
        sites: ["https://GitHub.com/**"],
      }),
    ).rejects.toThrow(/lower case.*https:\/\/github\.com/su);
  });

  it("refuses two scripts under one id", async () => {
    const entry = await install({
      source: `
        export default function plugin(patcher: any) {
          const script = { matches: ["https://github.com/**"], code: "void 0" };
          patcher.browser.registerPageScript({ id: "twice", ...script });
          patcher.browser.registerPageScript({ id: "twice", ...script });
        }
      `,
      sites: ["https://github.com/**"],
    });

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain(
      'page script "twice" is already registered',
    );
  });

  it("refuses code that is empty or longer than the cap", async () => {
    const entry = await install({
      source: `
        export default function plugin(patcher: any) {
          patcher.browser.registerPageScript({
            id: "huge",
            matches: ["https://github.com/**"],
            code: "void 0;".repeat(20_000),
          });
        }
      `,
      sites: ["https://github.com/**"],
    });

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain("64000 characters");
  });

  // Never evaluated here — this process hands text to the browser, which hands
  // it to a page. A page script's syntax error is the page console's to report,
  // in the world it would have run in.
  it("loads a script this process could never run", async () => {
    expect(
      await install({
        source: `
          export default function plugin(patcher: any) {
            patcher.browser.registerPageScript({
              id: "browser-only",
              matches: ["https://github.com/**"],
              code: "document.body.dataset.patcher = navigator.userAgent;",
            });
          }
        `,
        sites: ["https://github.com/**"],
      }),
    ).toEqual({ status: "running", statusDetail: null });
  });

  it("lets one plugin style a site and script it too", async () => {
    expect(
      await install({
        source: `
          export default function plugin(patcher: any) {
            patcher.browser.registerPageStyle({
              id: "declutter",
              matches: ["https://github.com/**"],
              css: ".ad { display: none }",
            });
            patcher.browser.registerPageScript({
              id: "toolbar",
              matches: ["https://github.com/**"],
              code: "void 0",
            });
          }
        `,
        permissions: ["pageStyle.register", "pageScript.register"],
        sites: ["https://github.com/**"],
      }),
    ).toEqual({ status: "running", statusDetail: null });

    expect(await contributions()).toHaveLength(1);
  });
});
