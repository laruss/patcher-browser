import { describe, expect, it } from "vitest";
import {
  browserCommandSchema,
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
  { type: "tabs.activate", tabId: "t1" },
  { type: "tabs.pin", tabId: "t1", pinned: true },
  { type: "tabs.mute", tabId: "t1", muted: true },
  { type: "tabs.duplicate", tabId: "t1" },
  { type: "tabs.move", tabId: "t1", toIndex: 0 },
  { type: "page.get_url", tabId: null },
  { type: "page.get_title", tabId: null },
  { type: "page.zoom", tabId: null, factor: 1.25 },
  { type: "page.get_text", tabId: null, maxLength: 100 },
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

  it("separates reading a page from driving it", () => {
    expect(
      permissionForBrowserCommand({
        type: "page.get_text",
        tabId: null,
        maxLength: 100,
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
