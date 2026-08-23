import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { permissionsForApiPath } from "@patcher/domain";
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
      (path) => permissionsForApiPath(path) === null,
    );

    expect(unclassified).toEqual([]);
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
