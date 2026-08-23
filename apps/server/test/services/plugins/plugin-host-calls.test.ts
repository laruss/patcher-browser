import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLUGIN_PERMISSIONS } from "@patcher/domain";
import { PLUGIN_CALLBACKS } from "../../../src/services/plugins/plugin-callbacks.js";
import {
  callbacksProducedByRegistrations,
  PLUGIN_HOST_CALLS,
  synchronousHostStatePaths,
  unresolvedHostCallPaths,
  type PluginHostCallPath,
} from "../../../src/services/plugins/plugin-host-calls.js";
import { createPluginApi } from "../../../src/services/plugins/plugin-api.js";
import {
  createTestAppHarness,
  testLogger,
  type TestAppHarness,
} from "../../helpers/test-app.js";

/**
 * The catalogue is only worth what it is checked against. A hand-written list
 * of what `patcher` exposes is a second description of the object, free to agree
 * with itself while both drift — so this walks the real `patcher` a plugin is
 * handed and requires every member to be in the list, and every listed path to
 * still exist.
 *
 * The failure this exists to produce: someone adds a surface to plugin-api.ts,
 * the transport is built from PLUGIN_HOST_CALLS, and the new surface is the one
 * thing the plugin's process cannot reach.
 */

/** The six namespaces that are one `BrowserCommand` union, not 40 members. */
const BROWSER_COMMAND_NAMESPACES = new Set([
  "tabs",
  "page",
  "navigation",
  "storage",
  "control",
  "recording",
]);

function catalogueKeyFor(path: string): string {
  const browser = /^browser\.([^.]+)\./.exec(path);
  if (browser && BROWSER_COMMAND_NAMESPACES.has(browser[1] ?? "")) {
    return "browser.<command>";
  }
  return path;
}

/** Every path reachable on the object, and the catalogue key each maps to. */
function walk(root: object, prefix: string): Map<string, string> {
  const found = new Map<string, string>();
  const visit = (node: object, path: string): void => {
    for (const key of Object.keys(node)) {
      const childPath = path === "" ? key : `${path}.${key}`;
      // `patcher.sdk` is a loopback HTTP client, not part of this transport. It is
      // skipped before the property is *read*, not after: it is a bind-gated
      // getter that throws when the server is not listening, which is exactly
      // the state a factory runs in.
      if (childPath === "sdk") {
        found.set(childPath, childPath);
        continue;
      }
      const value: unknown = Reflect.get(node, key);
      if (typeof value === "object" && value !== null) {
        visit(value, childPath);
        continue;
      }
      found.set(childPath, catalogueKeyFor(childPath));
    }
  };
  visit(root, prefix);
  return found;
}

describe("PLUGIN_HOST_CALLS covers the Patcher object", () => {
  let harness: TestAppHarness;

  beforeEach(async () => {
    harness = await createTestAppHarness();
  });

  afterEach(async () => {
    await harness.pluginService.stop();
    await harness.cleanup();
  });

  function buildApi() {
    return createPluginApi({
      pluginId: "probe",
      // Everything declared, so reading an area does not hit the gate — the
      // gate has its own tests and is not what this file is checking.
      permissions: PLUGIN_PERMISSIONS,
      sites: undefined,
      logger: testLogger,
      kvStore: {
        get: async () => undefined,
        set: async () => {},
        delete: async () => {},
        list: async () => [],
      },
      readSettingsValues: async () => ({}),
      dataDir: harness.config.dataDir,
      getSdk: () => undefined,
      getLoopbackBaseUrl: () => "http://127.0.0.1:1",
      publishSignal: () => {},
      reportNeedsConfiguration: () => {},
      isAgentToolNameTaken: () => undefined,
      reportAgentToolProblem: () => {},
      requestInteraction: () => {
        throw new Error("not called");
      },
      requestBrowserCommand: () => {
        throw new Error("not called");
      },
      getBrowserHostStatus: () => ({ connected: false, hostCount: 0 }),
    });
  }

  it("names every member a plugin can reach on Patcher", () => {
    const handle = buildApi();
    const reachable = walk(handle.api, "");
    // The settings handle has no path on `patcher` — it only exists once a plugin
    // calls define — so it is walked from the object define returns.
    for (const [path, key] of walk(
      handle.api.settings.define({}),
      "settings.<handle>",
    )) {
      reachable.set(path, key);
    }

    const missing = [...new Set(reachable.values())].filter(
      (key) => !(key in PLUGIN_HOST_CALLS),
    );

    expect(missing).toEqual([]);
  });

  it("has no entry for a member that no longer exists", () => {
    const handle = buildApi();
    const reached = new Set(walk(handle.api, "").values());
    for (const key of walk(
      handle.api.settings.define({}),
      "settings.<handle>",
    ).values()) {
      reached.add(key);
    }

    const stale = (
      Object.keys(PLUGIN_HOST_CALLS) as PluginHostCallPath[]
    ).filter((path) => !reached.has(path));

    expect(stale).toEqual([]);
  });
});

describe("PLUGIN_HOST_CALLS against the callback catalogue", () => {
  // The two files describe one boundary from opposite sides. A callback with
  // no registration that produces it would be a call the host can make and no
  // plugin can ever receive.
  it("accounts for every server→plugin callback", () => {
    const produced = callbacksProducedByRegistrations();
    const orphaned = Object.keys(PLUGIN_CALLBACKS).filter(
      (kind) => !produced.has(kind as keyof typeof PLUGIN_CALLBACKS),
    );

    expect(orphaned).toEqual([]);
  });
});

describe("what does not cross yet", () => {
  // Pinned rather than asserted-empty: these are the boundary's real work, and
  // the list shrinking or growing should both be a deliberate edit.
  // Was five. `rpc.register` and `agents.registerTool` came off the list when
  // their validators stopped needing to cross: a schema is a function, so the
  // side holding the handler runs the check (plugin-rpc-call.ts,
  // plugin-agent-tool-call.ts) and only the result of it — a JSON Schema, a
  // method name — is ever sent.
  it("is the three known obstacles", () => {
    expect(unresolvedHostCallPaths()).toEqual([
      "settings.define",
      "storage.database",
      "storage.migrate",
    ]);
  });

  // A different axis, and one that only turned up once a plugin actually ran
  // in another process: these serialise fine and still cannot be requests,
  // because the member the plugin calls is synchronous.
  it("is the two members that read host state synchronously", () => {
    expect(synchronousHostStatePaths()).toEqual([
      "agents.registerTool",
      "browser.getStatus",
    ]);
  });
});
