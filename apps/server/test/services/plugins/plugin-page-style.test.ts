import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const BASE = "http://127.0.0.1:3334";

/**
 * `patcher.browser.registerPageStyle`, and the thing it is really about: a
 * permission whose answer is a *list of sites*.
 *
 * Every other contribution costs a capability — "may add a toolbar control" —
 * and the plugin then reaches whatever that capability reaches. A page style
 * reaches pages, so the useful question is which ones, and the answer has to
 * come from the manifest the user read before installing rather than from the
 * code that runs afterwards. Hence `patcher.sites`, and hence the checks here: what
 * the manifest refuses, and what the plugin cannot widen once it is loaded.
 */

const STYLE_SOURCE = `
  export default function plugin(patcher: any) {
    patcher.browser.registerPageStyle({
      id: "declutter",
      matches: ["https://github.com/**"],
      css: ".js-notification-shelf { display: none !important }",
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
        name: "Page style fixture",
        description: "Page style fixture.",
        branding: { icon: "Zap" },
        server: "./server.ts",
        permissions: options.permissions ?? ["pageStyle.register"],
        ...(options.sites === undefined ? {} : { sites: options.sites }),
      },
    }),
  );
  await writeFile(join(rootDir, "server.ts"), options.source);
  return rootDir;
}

describe("plugin page styles (patcher.browser.registerPageStyle)", () => {
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
        name: "patcher-plugin-style",
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
    return ((await response.json()) as { browserPageStyles: unknown })
      .browserPageStyles;
  }

  it("carries the css itself in GET /plugins/contributions", async () => {
    expect(
      await install({
        source: STYLE_SOURCE,
        sites: ["https://github.com/**"],
      }),
    ).toEqual({ status: "running", statusDetail: null });

    // The css, not a handle to ask for it: the app pushes this to the shell and
    // a page load must never wait on the plugin.
    expect(await contributions()).toEqual([
      {
        pluginId: "style",
        styleId: "declutter",
        matches: ["https://github.com/**"],
        css: ".js-notification-shelf { display: none !important }",
      },
    ]);
  });

  it("refuses a match the plugin did not declare, and says what it did", async () => {
    const entry = await install({
      source: STYLE_SOURCE,
      sites: ["https://gitlab.com/**"],
    });

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain('"patcher.sites"');
    expect(entry.statusDetail).toContain("https://gitlab.com/**");
    expect(await contributions()).toEqual([]);
  });

  it("refuses a style from a plugin that declared no sites at all", async () => {
    const entry = await install({ source: STYLE_SOURCE });

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain("That list is empty");
  });

  it("refuses the permission and the sites separately", async () => {
    const entry = await install({
      source: STYLE_SOURCE,
      permissions: [],
      sites: ["https://github.com/**"],
    });

    // Declaring where without declaring what reaches nothing: the sites list is
    // not a permission, it is the scope of one.
    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain("pageStyle.register");
  });

  // Refused a step earlier than everything above: not a loaded plugin in an
  // error state but a manifest that never installs, because the line the user
  // would have consented to is the broken one.
  it("refuses a site pattern the manifest itself may not carry", async () => {
    await expect(
      install({
        source: STYLE_SOURCE,
        // Plain http to another machine: a page style is standing access to a
        // site, and this one is any machine on the path.
        sites: ["http://intranet.example/**"],
      }),
    ).rejects.toThrow(/patcher\.sites\.0.*http:\/\/intranet\.example/su);
  });

  it("accepts loopback over plain http, which is where a plugin's own service is", async () => {
    expect(
      await install({
        source: `
          export default function plugin(patcher: any) {
            patcher.browser.registerPageStyle({
              id: "local",
              matches: ["http://localhost:5173/**"],
              css: "body { outline: 2px solid red }",
            });
          }
        `,
        sites: ["http://localhost:5173/**"],
      }),
    ).toEqual({ status: "running", statusDetail: null });
  });

  it("refuses two styles under one id", async () => {
    const entry = await install({
      source: `
        export default function plugin(patcher: any) {
          const style = { matches: ["https://github.com/**"], css: "a { color: red }" };
          patcher.browser.registerPageStyle({ id: "twice", ...style });
          patcher.browser.registerPageStyle({ id: "twice", ...style });
        }
      `,
      sites: ["https://github.com/**"],
    });

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain(
      'page style "twice" is already registered',
    );
  });

  it("lets one plugin style two of its sites differently", async () => {
    expect(
      await install({
        source: `
          export default function plugin(patcher: any) {
            patcher.browser.registerPageStyle({
              id: "gh",
              matches: ["https://github.com/**"],
              css: ".ad { display: none }",
            });
            patcher.browser.registerPageStyle({
              id: "gl",
              matches: ["https://gitlab.com/**"],
              css: ".banner { display: none }",
            });
          }
        `,
        sites: ["https://github.com/**", "https://gitlab.com/**"],
      }),
    ).toEqual({ status: "running", statusDetail: null });

    expect(
      ((await contributions()) as { styleId: string }[]).map(
        (style) => style.styleId,
      ),
    ).toEqual(["gh", "gl"]);
  });

  it("refuses css that is empty or longer than the cap", async () => {
    const entry = await install({
      source: `
        export default function plugin(patcher: any) {
          patcher.browser.registerPageStyle({
            id: "huge",
            matches: ["https://github.com/**"],
            css: "a{}".repeat(30_000),
          });
        }
      `,
      sites: ["https://github.com/**"],
    });

    expect(entry.status).toBe("error");
    expect(entry.statusDetail).toContain("64000 characters");
  });
});
