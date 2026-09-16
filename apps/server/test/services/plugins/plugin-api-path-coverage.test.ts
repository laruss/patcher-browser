import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isApiPathClassifiedForPlugins,
  permissionsForApiPath,
} from "@patcher/domain";
import {
  createTestAppHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

/**
 * Every `/api/v1` path a plugin can reach must carry a permission
 * classification.
 *
 * Unclassified is refused at runtime, so a new route is never quietly opened —
 * but a route that is *supposed* to be reachable and was never classified
 * turns into a 403 nobody predicted. That is not hypothetical: the first
 * version of this test read the typed contract plus a hand-written list of the
 * routes mounted outside it, and the hand-written list missed
 * `/plugin-catalog` entirely, so `sdk.plugins.catalog` would have 403'd for
 * every plugin that correctly declared `plugins`.
 *
 * So it reads the router itself. Hono records what was actually mounted, which
 * is the only list that cannot fall behind the server.
 *
 * "Classified" includes classified as never a plugin's to call, which is a
 * decision and not an omission — see the `null` entry in the map. Both refuse
 * at runtime; only one of them was chosen.
 */

describe("every mounted API path is classified", () => {
  let harness: TestAppHarness;
  let paths: string[];

  beforeEach(async () => {
    harness = await createTestAppHarness();
    paths = [
      ...new Set(
        harness.app.routes
          .map((route) => route.path)
          .filter((path) => path.startsWith("/api/v1/"))
          // Middleware is mounted as a wildcard over everything; it is not a
          // route a plugin can call.
          .filter((path) => !path.endsWith("/*") || path.includes("/http/")),
      ),
    ].sort();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  it("reads a non-trivial route table off the router", () => {
    expect(paths.length).toBeGreaterThan(50);
  });

  it("classifies all of them", () => {
    const unclassified = paths.filter(
      (path) => !isApiPathClassifiedForPlugins(path),
    );

    expect(unclassified).toEqual([]);
  });

  it("refuses the one route whose answer is a credential, at any price", () => {
    // The daemon key for a machine: `/hosts` would have priced it at
    // `workspace`, so it has its own prefix and costs nothing a plugin can pay.
    // Classified, so the check above passes; null, so the gate refuses.
    expect(isApiPathClassifiedForPlugins("/host-daemon-keys/host-1")).toBe(
      true,
    );
    expect(permissionsForApiPath("/host-daemon-keys/host-1")).toBeNull();
  });

  it("refuses writing Patcher's skills into the user's home, and still prices reading their state", () => {
    // Under `/system`, which would have priced both at `workspace`.
    for (const path of [
      "/system/cli-skills/install",
      "/system/cli-skills/setup",
    ]) {
      expect(isApiPathClassifiedForPlugins(path)).toBe(true);
      expect(permissionsForApiPath(path)).toBeNull();
    }
    expect(permissionsForApiPath("/system/cli-skills")).toEqual(["workspace"]);
  });

  it("refuses putting `patcher` on the user's PATH, and still prices reading where it stands", () => {
    for (const path of [
      "/system/cli-command/install",
      "/system/cli-command/setup",
    ]) {
      expect(isApiPathClassifiedForPlugins(path)).toBe(true);
      expect(permissionsForApiPath(path)).toBeNull();
    }
    expect(permissionsForApiPath("/system/cli-command")).toEqual(["workspace"]);
  });

  it("refuses every route mounted under /system/cli-skills/ to plugins, including the next one", () => {
    // A turn is refused that whole prefix. Plugins are priced by named routes,
    // so a write added under it would otherwise cost `workspace` via `/system`
    // and pass the classification check above.
    const underPrefix = paths.filter((path) =>
      path.startsWith("/api/v1/system/cli-skills/"),
    );

    expect(underPrefix.length).toBeGreaterThanOrEqual(2);
    expect(
      underPrefix.filter((path) => permissionsForApiPath(path) !== null),
    ).toEqual([]);
  });

  // The two that cross areas — a path saying "workspace" while the effect is
  // on threads is exactly what a per-prefix map gets wrong by default.
  it("charges the cross-area routes both prices", () => {
    expect(permissionsForApiPath("/environments/e1/archive-threads")).toEqual([
      "workspace",
      "threads",
    ]);
    expect(permissionsForApiPath("/sidebar-bootstrap")).toEqual([
      "workspace",
      "threads",
    ]);
  });

  // A plugin calling another plugin's route is ordinary HTTP with its own auth
  // mode, not administration, so it costs nothing here.
  it("leaves plugin-to-plugin routes free", () => {
    expect(permissionsForApiPath("/plugins/notes/rpc/list")).toEqual([]);
    expect(permissionsForApiPath("/plugins/notes/http/events")).toEqual([]);
  });

  it("still charges plugin administration and the catalog", () => {
    expect(permissionsForApiPath("/plugins/notes/settings")).toEqual([
      "plugins",
    ]);
    expect(permissionsForApiPath("/plugin-catalog/search")).toEqual([
      "plugins",
    ]);
  });
});
