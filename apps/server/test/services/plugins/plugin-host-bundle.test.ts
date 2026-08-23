import { execFileSync, fork } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLUGIN_PERMISSIONS } from "@patcher/domain";
// The repo's own build helper, so this bundles exactly the way `npm run build`
// does rather than with a second set of esbuild settings to drift from it.
// @ts-expect-error -- a plain .mjs build script with no declarations.
import { buildNodeEsmEntry } from "../../../../../scripts/build-utils.mjs";
import { createPluginChannel } from "../../../src/services/plugins/plugin-channel.js";
import { BOOTSTRAP_METHOD } from "../../../src/services/plugins/plugin-child-runtime.js";
import { createPortMultiplexer } from "../../../src/services/plugins/plugin-port-multiplexer.js";
import { createChildProcessPort } from "../../../src/services/plugins/plugin-ports.js";
import type { JsonValue } from "@patcher/domain";

/**
 * The plugin host as it actually ships: bundled, not run from source.
 *
 * Two things only exist in this form. `@patcher/sdk` is deferred behind a literal
 * `require`, which under tsx resolves from the workspace and in a bundle is a
 * module the bundler folded in and initialises on first call — different
 * machinery, same contract, and only this test exercises the second. And the
 * bundle has to *run at all*: it goes into the server's `dist` next to
 * `index.js`, where `defaultSpawn` looks for it, and until recently it was
 * never built, so nothing would have noticed it could not start.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST_ENTRY = resolve(
  HERE,
  "../../../src/services/plugins/plugin-host-entry.ts",
);
const PACKAGE_ROOT = resolve(HERE, "../../..");

describe("the plugin host, bundled", () => {
  const children: ChildProcess[] = [];
  let bundlePath: string;
  let outDir: string;

  beforeAll(async () => {
    // Into the package's own dist: natives stay external, so the process has
    // to sit somewhere `better-sqlite3` resolves — exactly as it ships.
    //
    // Created, not assumed: this suite builds its own bundle and so has no
    // reason to need a prior `bun run build`, but `mkdtemp` fails with ENOENT
    // when the parent is absent — which is every clean checkout, and every CI
    // runner whose test shard does not build the server first.
    const distDir = join(PACKAGE_ROOT, "dist");
    await mkdir(distDir, { recursive: true });
    outDir = await mkdtemp(join(distDir, "host-bundle-"));
    bundlePath = join(outDir, "plugin-host-entry.js");
    await buildNodeEsmEntry({
      entryPoint: HOST_ENTRY,
      outfile: bundlePath,
      packageRoot: PACKAGE_ROOT,
      sourcemap: false,
    });
  }, 120_000);

  afterAll(async () => {
    for (const child of children.splice(0)) child.kill();
    await rm(outDir, { force: true, recursive: true });
  });

  function startHost(): {
    channel: ReturnType<typeof createPluginChannel>;
    stderr: string[];
    pid: number;
  } {
    const child = fork(bundlePath, [], {
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    children.push(child);
    const stderr: string[] = [];
    child.stderr?.on("data", (chunk) => stderr.push(String(chunk)));
    const multiplexer = createPortMultiplexer({
      port: createChildProcessPort(child),
      onUnroutable: (problem) => stderr.push(`unroutable: ${problem}`),
    });
    return {
      channel: createPluginChannel({
        port: multiplexer.open("bundled"),
        name: "server",
        onNotify: () => {},
        onRequest: ({ method }) => {
          throw new Error(`the test host does not serve "${method}"`);
        },
      }),
      stderr,
      pid: child.pid ?? 0,
    };
  }

  it("loads a plugin, and gives it an SDK when it asks", async () => {
    const dataDir = await mkdtemp(join(outDir, "data-"));
    const { channel, stderr } = startHost();

    await channel
      .request({
        method: BOOTSTRAP_METHOD,
        payload: {
          pluginId: "bundled",
          permissions: PLUGIN_PERMISSIONS,
          dataDir,
          loopbackBaseUrl: "http://127.0.0.1:1",
          apiKey: "test-key",
          serverEntry: resolve(HERE, "fixtures/sdk-plugin/server.ts"),
        } as unknown as JsonValue,
      })
      .catch((error: Error) => {
        throw new Error(`${error.message}\n${stderr.join("")}`);
      });

    // The deferred `require` path, resolved by the bundler rather than by Node.
    await expect(
      channel.request({
        method: "browserContextMenu",
        target: "sdk_probe",
        payload: {},
      }),
    ).resolves.toBe("function function");

    // And the other deferral, which the bundler must *not* resolve: a native
    // module stays external, and esbuild's `__require` shim throws for one.
    await expect(
      channel.request({
        method: "browserContextMenu",
        target: "database_probe",
        payload: {},
      }),
    ).resolves.toBe("1");
  }, 60_000);

  // The number the placement policy is argued from, asserted loosely: what
  // matters is that a host process is tens of megabytes rather than hundreds.
  // Measured at ~67MB, so the bound catches a regression that puts any of the
  // deferred packages — `@patcher/sdk`, zod, cron-parser, the browser-control
  // schemas — back into the startup path, without failing on noise.
  //
  // See apps/server/scripts/measure-plugin-host.mjs for the breakdown.
  it("costs well under 90MB before it loads anything", async () => {
    const { pid } = startHost();
    await new Promise((resolve_) => setTimeout(resolve_, 2_000));

    const rss =
      Number(
        execFileSync("ps", ["-o", "rss=", "-p", String(pid)], {
          encoding: "utf8",
        }).trim(),
      ) / 1024;

    expect(rss).toBeGreaterThan(20);
    expect(rss).toBeLessThan(90);
  }, 60_000);
});
