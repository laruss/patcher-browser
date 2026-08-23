import { describe, expect, it } from "vitest";
import {
  permissionForBrowserCommand,
  type BrowserCommand,
  type PluginPermission,
} from "@patcher/domain";
import { createFakePluginHost } from "../fake-plugin-host.js";

/**
 * The fake host charges each `patcher.browser` method a permission, spelled out at
 * the call site. The host charges the *command* that method builds. Those are
 * two sets of decisions about the same thing, and this file is what stops them
 * disagreeing: each row states the method, what the fake charges it, and the
 * command the real API sends for it.
 *
 * A row failing means one of the two moved. Neither is automatically right —
 * the point is that nobody moves one silently.
 */
const SURFACE: ReadonlyArray<{
  /** How a plugin calls it, as an expression on `patcher.browser`. */
  readonly call: (browser: never) => unknown;
  readonly label: string;
  readonly charged: PluginPermission;
  /** What `plugin-api.ts` sends for that call. */
  readonly command: BrowserCommand;
}> = [
  {
    label: "tabs.list",
    charged: "tabs.read",
    command: { type: "tabs.list" },
    call: (b: never) => (b as PluginBrowserish).tabs.list(),
  },
  {
    label: "tabs.open",
    charged: "tabs.modify",
    command: { type: "tabs.open", url: "https://a.test/", activate: true },
    call: (b: never) =>
      (b as PluginBrowserish).tabs.open({ url: "https://a.test/" }),
  },
  {
    label: "page.getText",
    charged: "page.read",
    command: { type: "page.get_text", tabId: null, maxLength: 100 },
    call: (b: never) => (b as PluginBrowserish).page.getText(),
  },
  {
    label: "page.act",
    charged: "page.interact",
    command: {
      type: "page.interact",
      tabId: null,
      generation: null,
      interaction: { action: "hover", ref: "e1" },
    },
    call: (b: never) =>
      (b as PluginBrowserish).page.act({ action: "hover", ref: "e1" }),
  },
  {
    label: "control.evaluate",
    charged: "page.inject",
    command: {
      type: "page.control",
      tabId: null,
      generation: null,
      operation: { kind: "evaluate", expression: "1", ref: null },
    },
    call: (b: never) =>
      (b as PluginBrowserish).control.evaluate({ expression: "1" }),
  },
  {
    label: "control.setOffline",
    charged: "network.intercept",
    command: {
      type: "page.control",
      tabId: null,
      generation: null,
      operation: { kind: "offline", offline: true },
    },
    call: (b: never) =>
      (b as PluginBrowserish).control.setOffline({ offline: true }),
  },
  {
    label: "page.network",
    charged: "network.observe",
    command: {
      type: "page.observe",
      tabId: null,
      observation: { kind: "network", limit: 10 },
    },
    call: (b: never) => (b as PluginBrowserish).page.network(),
  },
  {
    label: "storage.cookies",
    charged: "page.credentials",
    command: {
      type: "page.storage",
      tabId: null,
      operation: { kind: "cookies-get" },
    },
    call: (b: never) => (b as PluginBrowserish).storage.cookies(),
  },
  {
    label: "recording.traceStop",
    charged: "page.record",
    command: {
      type: "page.record",
      tabId: null,
      operation: { kind: "trace-stop" },
    },
    call: (b: never) => (b as PluginBrowserish).recording.traceStop(),
  },
];

/** The fake's browser surface is exercised dynamically; this names the parts used. */
type PluginBrowserish = {
  tabs: { list(): unknown; open(args: { url: string }): unknown };
  page: { getText(): unknown; act(args: unknown): unknown; network(): unknown };
  control: {
    evaluate(args: { expression: string }): unknown;
    setOffline(args: { offline: boolean }): unknown;
  };
  storage: { cookies(): unknown };
  recording: { traceStop(): unknown };
};

describe("the fake host charges what the host charges", () => {
  it.each(SURFACE)("$label", ({ charged, command }) => {
    expect(permissionForBrowserCommand(command)).toBe(charged);
  });

  // These methods refuse synchronously (the gate runs before any await) but
  // return promises when they get that far, so both shapes have to be caught.
  async function errorFrom(run: () => unknown): Promise<unknown> {
    try {
      await run();
      return undefined;
    } catch (error) {
      return error;
    }
  }

  it.each(SURFACE)("$label refuses without it", async ({ call, charged }) => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });

    expect(await errorFrom(() => call(patcher.browser as never))).toMatchObject(
      {
        name: "PluginPermissionError",
        permission: charged,
      },
    );
  });

  it.each(SURFACE)("$label is allowed with it", async ({ call, charged }) => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [charged],
    });

    // Most of these then fail on the fake's own state ("no trace is running").
    // What matters here is only that the permission is no longer the reason.
    expect(
      await errorFrom(() => call(patcher.browser as never)),
    ).not.toMatchObject({
      name: "PluginPermissionError",
    });
  });
});

describe("contribution points", () => {
  it("refuses an omnibox provider the plugin did not declare", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });

    expect(() =>
      patcher.browser.registerOmniboxProvider({
        id: "x",
        label: "X",
        suggest: () => [],
      }),
    ).toThrow(/"omnibox\.register" permission/);
  });

  it("admits it once declared", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: ["omnibox.register"],
    });

    expect(() =>
      patcher.browser.registerOmniboxProvider({
        id: "x",
        label: "X",
        suggest: () => [],
      }),
    ).not.toThrow();
  });

  it("refuses a toolbar control the plugin did not declare", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });

    expect(() =>
      patcher.browser.registerToolbarItem({
        id: "star",
        title: "Save this page",
        run: () => {},
      }),
    ).toThrow(/"toolbar\.register" permission/);
  });

  it("refuses a new-tab section the plugin did not declare", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });

    expect(() =>
      patcher.browser.registerNewTabWidget({
        id: "saved",
        label: "Bookmarks",
        rows: () => [],
      }),
    ).toThrow(/"newTab\.register" permission/);
  });

  it("refuses a page style the plugin did not declare", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });

    expect(() =>
      patcher.browser.registerPageStyle({
        id: "declutter",
        matches: ["https://github.com/**"],
        css: ".ad { display: none }",
      }),
    ).toThrow(/"pageStyle\.register" permission/);
  });

  // The permission says the plugin restyles pages; `patcher.sites` says which ones.
  // Holding one without the other reaches nothing, and the double has to say so
  // or a plugin ships a style the install refuses.
  it("refuses a page style whose site is not declared, and names the list", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: ["pageStyle.register"],
      sites: ["https://gitlab.com/**"],
    });

    expect(() =>
      patcher.browser.registerPageStyle({
        id: "declutter",
        matches: ["https://github.com/**"],
        css: ".ad { display: none }",
      }),
    ).toThrow(/does not declare in "patcher\.sites".*https:\/\/gitlab\.com/su);
  });

  it("admits a page style matching a site the plugin declared", () => {
    const { patcher, harness } = createFakePluginHost({
      pluginId: "p",
      permissions: ["pageStyle.register"],
      sites: ["https://github.com/**"],
    });
    const style = {
      id: "declutter",
      matches: ["https://github.com/**"],
      css: ".ad { display: none }",
    };

    patcher.browser.registerPageStyle(style);

    expect(harness.registrations.pageStyles).toEqual([style]);
    expect(() => patcher.browser.registerPageStyle(style)).toThrow(
      /already registered/,
    );
  });

  it("refuses a page script the plugin did not declare", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });

    expect(() =>
      patcher.browser.registerPageScript({
        id: "toolbar",
        matches: ["https://github.com/**"],
        code: "void 0",
      }),
    ).toThrow(/"pageScript\.register" permission/);
  });

  // Two permissions over one list, and this is the line between them: a plugin
  // the user let restyle a site has not been let read it.
  it("does not let the styling permission run code", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: ["pageStyle.register"],
      sites: ["https://github.com/**"],
    });

    expect(() =>
      patcher.browser.registerPageScript({
        id: "toolbar",
        matches: ["https://github.com/**"],
        code: "void 0",
      }),
    ).toThrow(/"pageScript\.register" permission/);
  });

  it("refuses a page script whose site is not declared, and names the list", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: ["pageScript.register"],
      sites: ["https://gitlab.com/**"],
    });

    expect(() =>
      patcher.browser.registerPageScript({
        id: "toolbar",
        matches: ["https://github.com/**"],
        code: "void 0",
      }),
    ).toThrow(/does not declare in "patcher\.sites".*https:\/\/gitlab\.com/su);
  });

  it("admits a page script matching a site the plugin declared", () => {
    const { patcher, harness } = createFakePluginHost({
      pluginId: "p",
      permissions: ["pageScript.register"],
      sites: ["https://github.com/**"],
    });
    const script = {
      id: "toolbar",
      matches: ["https://github.com/**"],
      code: "patcher.ready(function(){})",
    };

    patcher.browser.registerPageScript(script);

    expect(harness.registrations.pageScripts).toEqual([script]);
    expect(() => patcher.browser.registerPageScript(script)).toThrow(
      /already registered/,
    );
  });

  // A command is ungated on purpose: a chord that runs the plugin's own code
  // discloses nothing, and what the command then reads is gated where it was.
  it("admits a command with no permissions at all", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });

    expect(() =>
      patcher.ui.registerCommand({
        id: "save-page",
        title: "Save this page",
        shortcut: { key: "d", mod: true },
        run: () => {},
      }),
    ).not.toThrow();
  });

  // Every refusal the host makes at load, the double has to make in the test —
  // otherwise a plugin's suite is green and the install fails.
  it("refuses a second command with the same id or the same chord", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });
    const command = {
      id: "save-page",
      title: "Save this page",
      shortcut: { key: "d", mod: true },
      run: () => {},
    };

    patcher.ui.registerCommand(command);

    expect(() => patcher.ui.registerCommand(command)).toThrow(
      /already registered/,
    );
    expect(() =>
      patcher.ui.registerCommand({ ...command, id: "other" }),
    ).toThrow(/already bound/);
  });

  it("refuses a new-tab section with no label, or a second with one id", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: ["newTab.register"],
    });
    const widget = { id: "saved", label: "Bookmarks", rows: () => [] };

    expect(() =>
      patcher.browser.registerNewTabWidget({ ...widget, label: "  " }),
    ).toThrow(/label/);

    patcher.browser.registerNewTabWidget(widget);

    expect(() => patcher.browser.registerNewTabWidget(widget)).toThrow(
      /already registered/,
    );
  });

  // Patcher has no palette, so a command with no chord could never be run — the double
  // refuses it exactly like the host, or a plugin ships one that does nothing.
  it("refuses a command with no chord", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });

    expect(() =>
      patcher.ui.registerCommand({
        id: "orphan",
        title: "Nowhere",
        run: () => {},
      } as never),
    ).toThrow(/shortcut/);
  });

  // One control per plugin is the host's rule, so the double has to refuse the
  // second one too — otherwise a plugin ships a button that never appears.
  it("admits one toolbar control and refuses a second", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: ["toolbar.register"],
    });

    expect(() =>
      patcher.browser.registerToolbarItem({
        id: "star",
        title: "Save this page",
        run: () => {},
      }),
    ).not.toThrow();
    expect(() =>
      patcher.browser.registerToolbarItem({
        id: "second",
        title: "Something else",
        run: () => {},
      }),
    ).toThrow(/one toolbar control/);
  });

  // getStatus reports only whether a browser window is connected, which is not
  // the user's data — the host leaves it open and so does this.
  it("leaves getStatus open to a plugin that declared nothing", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });

    expect(() => patcher.browser.getStatus()).not.toThrow();
  });
});

describe("patcher.sdk in the fake host", () => {
  it("refuses an area the plugin did not declare, on the property read", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: [],
    });

    expect(() => patcher.sdk.terminals).toThrow(/"shell" permission/);
  });

  it("passes through an area it did declare", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: ["shell"],
    });

    expect(() => patcher.sdk.terminals).not.toThrow();
  });

  // Two methods reach across areas. The fake missed them at first, which is
  // the exact drift the shared map exists to prevent: a plugin's own suite
  // passing on a manifest the install refuses.
  it("charges the cross-area methods their second price", () => {
    const threadsOnly = createFakePluginHost({
      pluginId: "p",
      permissions: ["threads"],
    });
    const workspaceOnly = createFakePluginHost({
      pluginId: "p",
      permissions: ["workspace"],
    });

    expect(() => threadsOnly.patcher.sdk.threadSections.list()).toThrow(
      /"workspace"/,
    );
    expect(() =>
      workspaceOnly.patcher.sdk.environments.archiveThreads({} as never),
    ).toThrow(/"threads"/);
  });

  it("charges thread events to threads, not to workspace", () => {
    const { patcher } = createFakePluginHost({
      pluginId: "p",
      permissions: ["workspace"],
    });

    expect(() =>
      patcher.sdk.subscribe({ event: "thread:changed", callback: () => {} }),
    ).toThrow(/"threads" permission/);
  });
});
