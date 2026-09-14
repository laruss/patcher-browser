import { describe, expect, it } from "vitest";
import {
  browserCommandSchema,
  browserCommandValueSchema,
  type BrowserCommand,
} from "../src/browser-control.js";
import {
  PLUGIN_PERMISSIONS,
  permissionForBrowserCommand,
  permissionForRealtimeEvent,
  permissionForRealtimeTarget,
} from "../src/plugin-permissions.js";
import { pluginPermissionSchema } from "../src/plugin-permission-schema.js";
import { pluginPackageJsonSchema } from "../src/plugin-manifest.js";

/** One valid command per type, so the map can be exercised on all of them. */
const SAMPLE_COMMANDS: readonly BrowserCommand[] = [
  { type: "tabs.list" },
  { type: "tabs.open", url: "https://example.test/", activate: true },
  { type: "tabs.close", tabId: "t1" },
  { type: "tabs.release", tabId: "t1" },
  { type: "tabs.activate", tabId: "t1" },
  { type: "tabs.pin", tabId: "t1", pinned: true },
  { type: "tabs.mute", tabId: "t1", muted: true },
  { type: "tabs.duplicate", tabId: "t1" },
  { type: "tabs.move", tabId: "t1", toIndex: 0 },
  { type: "page.get_url", tabId: null },
  { type: "page.get_title", tabId: null },
  { type: "page.zoom", tabId: null, factor: 1.25 },
  { type: "page.get_text", tabId: null, maxLength: 100, selector: null },
  { type: "page.get_selection", tabId: null },
  { type: "page.handle_dialog", tabId: null, accept: true, promptText: null },
  { type: "page.snapshot", tabId: null, maxDepth: null, selector: null },
  {
    type: "page.interact",
    tabId: null,
    generation: null,
    interaction: {
      action: "hover",
      ref: "e1",
    },
  },
  { type: "page.scroll", tabId: null, target: { kind: "page" } },
  {
    type: "page.observe",
    tabId: null,
    observation: { kind: "console", limit: 10 },
  },
  { type: "page.storage", tabId: null, operation: { kind: "cookies-get" } },
  {
    type: "page.control",
    tabId: null,
    generation: null,
    operation: { kind: "route-list" },
  },
  { type: "page.record", tabId: null, operation: { kind: "trace-stop" } },
  {
    type: "navigation.open",
    tabId: null,
    url: "https://a.test/",
    newTab: false,
  },
  { type: "navigation.back", tabId: null },
  { type: "navigation.forward", tabId: null },
  { type: "navigation.reload", tabId: null },
];

/**
 * The map from a browser command to what it costs. Its value is that it is
 * total and that the split points are the ones that matter — a command group
 * whose members hand over different amounts must not share one permission.
 */
describe("permissionForBrowserCommand", () => {
  // The compiler already rejects a missing case (TS2366, the return type
  // excludes undefined). This covers the other half: that the samples here
  // keep up with the wire, so the cases below are exercised against real
  // commands rather than against a list that quietly went stale.
  it("has a sample for every command the wire accepts", () => {
    const onTheWire = browserCommandSchema.options
      .map((option) => option.shape.type.value)
      .sort();

    expect([...new Set(SAMPLE_COMMANDS.map((c) => c.type))].sort()).toEqual(
      onTheWire,
    );
  });

  it("answers a valid permission for each of them", () => {
    for (const command of SAMPLE_COMMANDS) {
      expect(PLUGIN_PERMISSIONS).toContain(
        permissionForBrowserCommand(command),
      );
    }
  });

  it("charges handing a tab back the least there is", () => {
    // Not `tabs.modify` with the rest of the tab-state changes: a caller lent a
    // tab at the `read` level would then have no way to give it back, and the
    // lending would be a one-way door (#117). It is the one command that only
    // narrows the caller's own access.
    expect(
      permissionForBrowserCommand({ type: "tabs.release", tabId: "t1" }),
    ).toBe("tabs.read");
    expect(
      permissionForBrowserCommand({ type: "tabs.close", tabId: "t1" }),
    ).toBe("tabs.modify");
  });

  it("separates reading a page from driving it", () => {
    expect(
      permissionForBrowserCommand({
        type: "page.get_text",
        tabId: null,
        maxLength: 100,
        selector: null,
      }),
    ).toBe("page.read");
    expect(
      permissionForBrowserCommand({
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: {
          action: "hover",
          ref: "e1",
        },
      }),
    ).toBe("page.interact");
  });

  // page.control is one command type covering three different asks, and this
  // is the split that would be easiest to get wrong by mapping the type alone.
  it("charges arbitrary JavaScript more than coordinate input", () => {
    expect(
      permissionForBrowserCommand({
        type: "page.control",
        tabId: null,
        generation: null,
        operation: { kind: "mouse-move", x: 1, y: 2 },
      }),
    ).toBe("page.interact");
    expect(
      permissionForBrowserCommand({
        type: "page.control",
        tabId: null,
        generation: null,
        operation: { kind: "evaluate", expression: "1", ref: null },
      }),
    ).toBe("page.inject");
    expect(
      permissionForBrowserCommand({
        type: "page.control",
        tabId: null,
        generation: null,
        operation: { kind: "offline", offline: true },
      }),
    ).toBe("network.intercept");
  });

  it("separates the network log from what the page rendered", () => {
    expect(
      permissionForBrowserCommand({
        type: "page.observe",
        tabId: null,
        observation: { kind: "network", limit: 10 },
      }),
    ).toBe("network.observe");
    expect(
      permissionForBrowserCommand({
        type: "page.observe",
        tabId: null,
        observation: { kind: "console", limit: 10 },
      }),
    ).toBe("page.read");
  });

  it("treats every storage operation as credential access", () => {
    expect(
      permissionForBrowserCommand({
        type: "page.storage",
        tabId: null,
        operation: { kind: "cookies-get" },
      }),
    ).toBe("page.credentials");
  });
});

describe("patcher.permissions in the manifest", () => {
  const manifest = (permissions: unknown) => ({
    name: "patcher-plugin-fixture",
    version: "0.1.0",
    patcher: {
      name: "Fixture",
      description: "Fixture plugin.",
      branding: { icon: "Zap" },
      server: "./server.ts",
      permissions,
    },
  });

  it("accepts declared permissions", () => {
    const parsed = pluginPackageJsonSchema.safeParse(
      manifest(["tabs.read", "threads"]),
    );

    expect(parsed.success).toBe(true);
  });

  // A typo silently granting nothing is the failure mode worth preventing:
  // the plugin would install, then fail at its first call with a message
  // naming a permission its manifest appears to contain.
  it("rejects a permission that does not exist", () => {
    const parsed = pluginPackageJsonSchema.safeParse(
      manifest(["tabs.readonly"]),
    );

    expect(parsed.success).toBe(false);
  });

  it("allows a plugin to declare nothing", () => {
    const parsed = pluginPackageJsonSchema.safeParse(manifest(undefined));

    expect(parsed.success).toBe(true);
  });
});

/**
 * What `network.observe` actually discloses, which is what the three sentences
 * describing it are written from: the comment on the permission itself, the
 * `page.observe` split in docs/architecture/plugin-permissions.md, and the
 * manifest table in the patcher-plugin-authoring skill. All three promised
 * request and response headers from the day the permission list was written
 * until #121, and no header was ever on the wire — a person pricing the
 * permission was reading about `Authorization` and `Cookie` values it cannot
 * reach.
 *
 * So this asserts the wire rather than the field list: a desktop build that
 * started sending headers would have them dropped here, and adding them on
 * purpose fails this test — which is where the reader is told that those three
 * sentences now describe something cheaper than the permission is.
 */
describe("what the network log discloses", () => {
  it("carries no headers, whatever arrives with an entry", () => {
    const result = browserCommandValueSchema.parse({
      type: "network",
      tabId: "t1",
      url: "https://example.test/",
      title: null,
      entries: [
        {
          method: "GET",
          url: "https://example.test/api?token=secret",
          resourceType: "xhr",
          status: 200,
          fromCache: false,
          error: null,
          timestamp: 1,
          requestHeaders: { authorization: "Bearer let-me-in" },
          responseHeaders: { "set-cookie": "session=1" },
        },
      ],
      droppedCount: 0,
    });

    expect(result.type).toBe("network");
    if (result.type !== "network") {
      return;
    }
    // Sorted, because the wire is the field set and not the order the schema
    // happens to declare it in.
    expect(Object.keys(result.entries[0] ?? {}).sort()).toEqual([
      "error",
      "fromCache",
      "method",
      "resourceType",
      "status",
      "timestamp",
      "url",
    ]);
  });
});

describe("the permission list itself", () => {
  it("has no duplicates", () => {
    expect(new Set(PLUGIN_PERMISSIONS).size).toBe(PLUGIN_PERMISSIONS.length);
  });

  it("is what the schema accepts", () => {
    for (const permission of PLUGIN_PERMISSIONS) {
      expect(pluginPermissionSchema.safeParse(permission).success).toBe(true);
    }
  });
});

/**
 * Realtime is named twice — feeds are `thread:changed`, subscription targets
 * are `thread-detail` — and a plugin can reach the data either way: through
 * `patcher.sdk.subscribe`, or by opening the websocket itself, which is not under
 * `/api/v1` and so never meets the request gate. Two spellings of one decision
 * must not answer differently.
 */
describe("realtime costs the same whichever way it is named", () => {
  it.each([
    ["thread", "thread:changed", "thread-detail", "threads"],
    ["thread list", "thread:changed", "thread-list", "threads"],
    ["project", "project:changed", "project-detail", "workspace"],
    ["environment", "environment:changed", "environment-list", "workspace"],
    ["host", "host:changed", "host-detail", "workspace"],
    ["system", "system:changed", "system", "workspace"],
  ])("%s", (_label, event, target, expected) => {
    expect(permissionForRealtimeEvent(event)).toBe(expected);
    expect(permissionForRealtimeTarget(target)).toBe(expected);
  });

  // The safe default for something nobody classified is the dearer one.
  it("charges an unrecognised feed to threads", () => {
    expect(permissionForRealtimeEvent("invented:changed")).toBe("threads");
    expect(permissionForRealtimeTarget("invented-detail")).toBe("threads");
  });
});
