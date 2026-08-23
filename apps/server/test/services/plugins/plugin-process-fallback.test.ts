import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createConnection, migrate, type DbConnection } from "@patcher/db";
import {
  createFakePluginHostProcess,
  type FakePluginHostProcess,
} from "../../helpers/fake-plugin-host.js";
import {
  createPluginService,
  type PluginService,
} from "../../../src/services/plugins/plugin-service.js";

/**
 * What happens when the plugin process does not work out.
 *
 * Placement is best effort and the server is the floor: a plugin an operator
 * moved out for isolation still has to run, and has to say where it ended up.
 * The two ways the move fails are a process that will not start and a process
 * that never answers, and they used to end differently — the first left the
 * plugin in `error`, the second had no deadline at all and wedged the loader.
 *
 * These build the plugin service directly rather than through the app harness:
 * `spawnPluginHost` and `loadTimeoutMs` are deps-level test seams, which is
 * where this codebase keeps them.
 */

const CONTEXT_MENU_PLUGIN = `
  export default function plugin(patcher: any) {
    patcher.browser.registerContextMenuItem({
      id: "shout",
      title: "Shout",
      run: (ctx: any) => (ctx.selectionText ?? "").toUpperCase(),
    });
  }
`;

/** A child that is alive and deaf: it accepts messages and never answers. */
function silentChild(): ChildProcess {
  const child = new EventEmitter() as unknown as ChildProcess & {
    connected: boolean;
  };
  Object.assign(child, {
    pid: 4242,
    connected: true,
    exitCode: null,
    signalCode: null,
    stderr: null,
    send: () => true,
    disconnect: () => {},
    kill: () => true,
  });
  return child;
}

describe("a plugin whose process does not work out", () => {
  const dirs: string[] = [];
  let db: DbConnection | undefined;
  let service: PluginService | undefined;

  afterEach(async () => {
    await service?.stop();
    service = undefined;
    db = undefined;
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function startService(overrides: {
    spawnPluginHost: () => ChildProcess;
    loadTimeoutMs?: number;
    pluginProcessRestart?: Parameters<
      typeof createPluginService
    >[0]["pluginProcessRestart"];
  }): Promise<{ service: PluginService; rootDir: string }> {
    const workDir = await mkdtemp(join(tmpdir(), "patcher-plugin-fallback-"));
    dirs.push(workDir);
    db = createConnection(":memory:");
    migrate(db);
    service = createPluginService({
      db,
      hub: {
        getDaemonSessionIdForHost: () => null,
        notifyPluginSignal: () => 0,
        notifySystem: () => {},
      },
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      dataDir: join(workDir, "data"),
      appVersion: "0.9.0",
      runPluginOutOfProcess: () => true,
      ...overrides,
    });

    const rootDir = join(workDir, "patcher-plugin-remote");
    await mkdir(rootDir, { recursive: true });
    await writeFile(
      join(rootDir, "package.json"),
      JSON.stringify({
        name: "patcher-plugin-remote",
        version: "0.1.0",
        patcher: {
          name: "Fallback fixture",
          description: "Fixture.",
          branding: { icon: "Zap" },
          server: "./server.ts",
          permissions: ["contextMenu.register"],
        },
      }),
    );
    await writeFile(join(rootDir, "server.ts"), CONTEXT_MENU_PLUGIN);
    return { service, rootDir };
  }

  it("runs in the server when the process will not start", async () => {
    const { service: plugins, rootDir } = await startService({
      spawnPluginHost: () => {
        throw new Error("no plugin host on this platform");
      },
    });

    const entry = await plugins.installPath(rootDir);

    expect(entry.status).toBe("running");
    expect(entry.statusDetail).toMatch(
      /plugin process failed: .*no plugin host on this platform/,
    );
    // In the server, so it has a local `patcher` — and it is serving.
    expect(plugins.getApi("remote")).toBeDefined();
    expect(
      plugins.listContextMenuItemContributions().map((item) => item.itemId),
    ).toEqual(["shout"]);
  }, 30_000);

  // Nothing else on this path has a deadline: in-process the factory call was
  // the only place plugin code could hang, and it is time-boxed. A plugin
  // process adds a second one — bootstrap — and without the same box a plugin
  // that never finishes loading holds the loader open forever.
  it("runs in the server when the process never answers", async () => {
    const { service: plugins, rootDir } = await startService({
      spawnPluginHost: silentChild,
      loadTimeoutMs: 300,
    });

    const entry = await plugins.installPath(rootDir);

    expect(entry.status).toBe("running");
    expect(entry.statusDetail).toMatch(
      /plugin process failed: load timed out after 300ms/,
    );
    expect(plugins.getApi("remote")).toBeDefined();
    expect(
      plugins.listContextMenuItemContributions().map((item) => item.itemId),
    ).toEqual(["shout"]);
  }, 30_000);

  it("still answers after its process crashed and came back", async () => {
    const spawned: FakePluginHostProcess[] = [];
    const { service: plugins, rootDir } = await startService({
      spawnPluginHost: () =>
        createFakePluginHostProcess((host) => spawned.push(host)).child,
      pluginProcessRestart: {
        maxAttempts: 5,
        baseDelayMs: 1,
        schedule: (_ms, run) => {
          const timer = setTimeout(run, 0);
          return () => clearTimeout(timer);
        },
      },
    });
    await plugins.installPath(rootDir);

    spawned[0]?.crash(1);
    await settle(() => spawned.length === 2);

    // The supervisor brought it back. The question is whether the *server*
    // can reach what came back.
    await expect(
      plugins.runContextMenuItem({
        pluginId: "remote",
        itemId: "shout",
        context: { selectionText: "тихо" } as never,
      }),
    ).resolves.toEqual({ ok: true });
  }, 30_000);

  // The end of a crashloop. The supervisor stops trying, and until it said so
  // out loud the plugin stayed registered with a shut channel: every call
  // rejected, and nothing about its status suggested anything was wrong.
  it("comes back into the server when the process is beyond saving", async () => {
    const spawned: FakePluginHostProcess[] = [];
    const { service: plugins, rootDir } = await startService({
      spawnPluginHost: () =>
        createFakePluginHostProcess((host) => spawned.push(host)).child,
      pluginProcessRestart: {
        maxAttempts: 1,
        baseDelayMs: 1,
        schedule: (_ms, run) => {
          const timer = setTimeout(run, 0);
          return () => clearTimeout(timer);
        },
      },
    });
    await plugins.installPath(rootDir);
    expect(() => plugins.getApi("remote")).toThrow(/runs in its own process/);

    const answers = async (): Promise<boolean> =>
      (
        await plugins.runContextMenuItem({
          pluginId: "remote",
          itemId: "shout",
          context: { selectionText: "тихо" } as never,
        })
      ).ok;

    // One crash inside the budget: brought back, and reachable again.
    spawned[0]?.crash(1);
    await settle(answers);
    // The next one exhausts it.
    spawned[1]?.crash(1);
    await settle(() => backInTheServer(plugins));

    // In the server now — with a local `patcher`, serving, and saying why.
    const entry = plugins.list().find((plugin) => plugin.id === "remote");
    expect(entry?.status).toBe("running");
    expect(entry?.statusDetail).toMatch(
      /plugin process died \(exit code 1\) and has crashed 2 times/,
    );
    expect(await answers()).toBe(true);
  }, 30_000);

  // The quarantine is what stops the recovery from being a loop of its own,
  // and `POST /plugins/reload` — the only caller, always a person — is how it
  // is lifted. Without that the way back out is a server restart.
  it("tries the plugin process again on an explicit reload", async () => {
    const spawned: FakePluginHostProcess[] = [];
    const { service: plugins, rootDir } = await startService({
      spawnPluginHost: () =>
        createFakePluginHostProcess((host) => spawned.push(host)).child,
      pluginProcessRestart: {
        maxAttempts: 0,
        baseDelayMs: 1,
        schedule: (_ms, run) => {
          const timer = setTimeout(run, 0);
          return () => clearTimeout(timer);
        },
      },
    });
    await plugins.installPath(rootDir);

    spawned[0]?.crash(1);
    await settle(() => backInTheServer(plugins));

    await plugins.reload("remote");

    expect(() => plugins.getApi("remote")).toThrow(/runs in its own process/);
    expect(
      plugins.list().find((plugin) => plugin.id === "remote")?.statusDetail,
    ).toBeNull();
  }, 30_000);
});

/** `getApi` throws for a plugin in its own process; here that is an answer. */
function backInTheServer(plugins: PluginService): boolean {
  try {
    return plugins.getApi("remote") !== undefined;
  } catch {
    return false;
  }
}

/** Wait for a condition the runtime reaches on its own, or give up loudly. */
async function settle(
  done: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await done())) {
    if (Date.now() > deadline) throw new Error("condition never settled");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
