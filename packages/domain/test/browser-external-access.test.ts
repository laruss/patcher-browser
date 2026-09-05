import { describe, expect, it } from "vitest";
import {
  BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS,
  BROWSER_EXTERNAL_ACCESS_LEVELS,
  browserExternalAccessAllows,
  lowestBrowserExternalAccessLevelFor,
  permissionsForBrowserExternalAccess,
  type BrowserExternalAccessLevel,
} from "../src/browser-external-access.js";
import {
  BROWSER_COMMAND_PERMISSIONS,
  permissionForBrowserCommand,
} from "../src/plugin-permissions.js";
import type { BrowserCommand } from "../src/browser-control.js";

/**
 * The levels are a ramp, and almost everything worth checking here is a
 * property of that ramp rather than a value in the table: a level admitting
 * something a higher one refuses would be the defect nobody notices, because
 * every individual entry still looks right.
 */
describe("browser access levels for agents outside Patcher", () => {
  it("is a ramp: each level admits everything the one below it does", () => {
    const sets = BROWSER_EXTERNAL_ACCESS_LEVELS.map((level) => ({
      level,
      permissions: new Set(permissionsForBrowserExternalAccess(level)),
    }));
    for (const [index, current] of sets.entries()) {
      const previous = sets[index - 1];
      if (previous === undefined) continue;
      for (const permission of previous.permissions) {
        expect(
          current.permissions.has(permission),
          `${current.level} must still admit ${permission}, which ${previous.level} admits`,
        ).toBe(true);
      }
      expect(
        current.permissions.size,
        `${current.level} must admit more than ${previous.level}`,
      ).toBeGreaterThan(previous.permissions.size);
    }
  });

  it("admits nothing at all when it is off", () => {
    expect(permissionsForBrowserExternalAccess("off")).toEqual([]);
    for (const permission of BROWSER_COMMAND_PERMISSIONS) {
      expect(browserExternalAccessAllows("off", permission)).toBe(false);
    }
  });

  it("admits every browser command permission at the top", () => {
    // Exact set, not a count: a permission dropped from the top level and a
    // permission added to it are the same size of mistake and only one of them
    // a count would catch.
    expect([...permissionsForBrowserExternalAccess("full")].sort()).toEqual(
      [...BROWSER_COMMAND_PERMISSIONS].sort(),
    );
  });

  it("keeps the user's logins above acting on their behalf", () => {
    // The one split this whole feature exists for. Reading a page the user is
    // looking at, and clicking in it, are things they can watch happen; a
    // cookie jar copied out of the browser is a login that leaves the machine.
    for (const permission of [
      "page.credentials",
      "page.inject",
      "network.intercept",
    ] as const) {
      expect(browserExternalAccessAllows("interact", permission)).toBe(false);
      expect(browserExternalAccessAllows("full", permission)).toBe(true);
    }
    expect(browserExternalAccessAllows("read", "tabs.modify")).toBe(false);
    expect(browserExternalAccessAllows("interact", "tabs.modify")).toBe(true);
  });

  it("names the lowest level that would admit a permission", () => {
    for (const permission of BROWSER_COMMAND_PERMISSIONS) {
      const lowest = lowestBrowserExternalAccessLevelFor(permission);
      expect(browserExternalAccessAllows(lowest, permission)).toBe(true);
      const below = BROWSER_EXTERNAL_ACCESS_LEVELS[
        BROWSER_EXTERNAL_ACCESS_LEVELS.indexOf(lowest) - 1
      ] as BrowserExternalAccessLevel | undefined;
      if (below !== undefined) {
        expect(browserExternalAccessAllows(below, permission)).toBe(false);
      }
    }
  });

  it("files every browser command under a level", () => {
    // The map is exhaustive by type, which a test cannot re-prove — what it can
    // prove is that the commands actually reachable resolve to a permission the
    // map knows, so a command whose permission is new fails here rather than
    // resolving to `undefined` and being silently allowed.
    const commands: BrowserCommand[] = [
      { type: "tabs.list" },
      { type: "page.get_text", tabId: null, maxLength: 100, selector: null },
      { type: "navigation.reload", tabId: null },
      {
        type: "page.observe",
        tabId: null,
        observation: { kind: "network", limit: 10 },
      },
      { type: "page.storage", tabId: null, operation: { kind: "cookies-get" } },
    ];
    for (const command of commands) {
      const permission = permissionForBrowserCommand(command);
      expect(BROWSER_COMMAND_PERMISSIONS).toContain(permission);
      expect(lowestBrowserExternalAccessLevelFor(permission)).not.toBe("off");
    }
  });

  it("describes every level for the person choosing one", () => {
    for (const level of BROWSER_EXTERNAL_ACCESS_LEVELS) {
      const described = BROWSER_EXTERNAL_ACCESS_DESCRIPTIONS[level];
      expect(described.label.length).toBeGreaterThan(0);
      // The detail is what a settings row and a consent prompt both render, so
      // an empty one is a prompt asking for something it does not describe.
      expect(described.detail.length).toBeGreaterThan(20);
    }
  });
});
