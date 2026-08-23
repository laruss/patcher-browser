import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { pluginProcessPolicy } from "../../../src/services/plugins/plugin-placement.js";

/**
 * Where the server decides to run a plugin.
 *
 * The last assertion is the one worth keeping: every mechanism this policy
 * needs already worked and shipped for weeks while nothing turned it on,
 * because `runPluginOutOfProcess` was supplied by tests and by nobody else. A
 * unit test of the rule cannot see that; reading the startup path can.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

describe("plugin placement policy", () => {
  it("keeps builtins in the server and puts installed plugins elsewhere", () => {
    const place = pluginProcessPolicy({ enabled: true });

    expect(place({ provenance: "builtin" })).toBe(false);
    expect(place({ provenance: "direct" })).toBe(true);
    expect(place({ provenance: "catalog" })).toBe(true);
  });

  it("loads everything in the server when the flag is off", () => {
    const place = pluginProcessPolicy({ enabled: false });

    expect(place({ provenance: "direct" })).toBe(false);
    expect(place({ provenance: "catalog" })).toBe(false);
  });

  it("is what the server actually starts with", async () => {
    const startup = await readFile(
      resolve(HERE, "../../../src/start-server.ts"),
      "utf8",
    );

    expect(startup).toContain("pluginProcessPolicy({");
    expect(startup).toContain("enabled: serverConfig.PATCHER_PLUGIN_PROCESS,");
  });
});
