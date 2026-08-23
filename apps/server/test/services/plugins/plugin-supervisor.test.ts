import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginHostCallServer } from "../../../src/services/plugins/plugin-host-call-server.js";
import type { PluginHostCapabilities } from "../../../src/services/plugins/plugin-host-call-server.js";
import {
  createFakePluginHostProcess,
  type FakePluginHostProcess,
} from "../../helpers/fake-plugin-host.js";
import {
  createPluginSupervisor,
  ISOLATED_PLACEMENT,
  type PluginSupervisor,
  type SupervisedPlugin,
} from "../../../src/services/plugins/plugin-supervisor.js";

/**
 * The supervisor over a fake `ChildProcess`: real supervisor, real
 * multiplexer, real child runtime, real plugin — everything except the
 * operating system. That keeps a crash instantaneous and deterministic, which
 * matters for a file that is mostly about what happens when things die.
 *
 * One test at the end forks an actual process, so the fake is never the only
 * evidence the wiring works.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_ENTRY = resolve(HERE, "fixtures/sample-plugin/server.ts");

/** One instance of a plugin; the id defaults to the plugin's own. */
function plugin(pluginId: string, instanceId = pluginId): SupervisedPlugin {
  return {
    instanceId,
    pluginId,
    permissions: ["contextMenu.register"],
    sites: undefined,
    serverEntry: SAMPLE_ENTRY,
    apiKey: "test-key",
  };
}

describe("the plugin supervisor", () => {
  const dirs: string[] = [];
  const supervisors: PluginSupervisor[] = [];

  async function dataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "patcher-supervisor-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const supervisor of supervisors.splice(0)) await supervisor.stopAll();
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  async function makeSupervisor(
    overrides: Partial<Parameters<typeof createPluginSupervisor>[0]> = {},
  ) {
    const spawned: FakePluginHostProcess[] = [];
    const warnings: string[] = [];
    const kv = new Map<string, string>();
    const sharedDataDir = await dataDir();
    const supervisor = createPluginSupervisor({
      shared: () => ({
        dataDir: sharedDataDir,
        loopbackBaseUrl: "http://127.0.0.1:1",
      }),
      handlers: {
        onRequest: () => (request) => {
          const body = request.payload as Record<string, string>;
          if (request.method === "storage.kv.set") {
            kv.set(body.key ?? "", body.json ?? "");
            return null;
          }
          if (request.method === "storage.kv.get")
            return kv.get(body.key ?? "") ?? null;
          throw new Error(`the test host does not serve "${request.method}"`);
        },
        onNotify: () => () => {},
      },
      spawn: () =>
        createFakePluginHostProcess((fake) => spawned.push(fake)).child,
      logger: { warn: (m) => warnings.push(m), info: () => {} },
      restart: {
        baseDelayMs: 1,
        schedule: (_ms, run) => {
          const timer = setTimeout(run, 0);
          return () => clearTimeout(timer);
        },
      },
      ...overrides,
    });
    supervisors.push(supervisor);
    return { supervisor, spawned, warnings };
  }

  it("puts plugins in one process by default", async () => {
    const { supervisor, spawned } = await makeSupervisor();

    await supervisor.start(plugin("alpha"));
    await supervisor.start(plugin("beta"));

    expect(spawned).toHaveLength(1);
    expect(supervisor.processes()).toEqual([
      expect.objectContaining({ key: "shared", pluginIds: ["alpha", "beta"] }),
    ]);
    expect(spawned[0]?.hosted()).toEqual(["alpha", "beta"]);
  });

  it("isolates them when the placement says so", async () => {
    const { supervisor, spawned } = await makeSupervisor({
      placement: ISOLATED_PLACEMENT,
    });

    await supervisor.start(plugin("alpha"));
    await supervisor.start(plugin("beta"));

    expect(spawned).toHaveLength(2);
    expect(
      supervisor
        .processes()
        .map((p) => p.key)
        .sort(),
    ).toEqual(["alpha", "beta"]);
  });

  it("returns what the plugin registered", async () => {
    const { supervisor } = await makeSupervisor();

    const state = await supervisor.start(plugin("alpha"));

    expect(state.snapshot.contextMenuItems.map((item) => item.id)).toEqual([
      "shout",
    ]);
  });

  it("calls into a plugin through its own channel", async () => {
    const { supervisor } = await makeSupervisor();
    await supervisor.start(plugin("alpha"));
    const beta = await supervisor.start(plugin("beta"));

    await expect(
      beta.channel.request({
        method: "browserContextMenu",
        target: "shout",
        payload: { selectionText: "рядом" },
      }),
    ).resolves.toBe("РЯДОМ");
  });

  // A shared process means a shared fate, and the whole design rests on that
  // fate being *reported* rather than silent.
  it("rejects in-flight work in every plugin when the process dies", async () => {
    const { supervisor, spawned } = await makeSupervisor();
    const alpha = await supervisor.start(plugin("alpha"));
    const beta = await supervisor.start(plugin("beta"));

    const stuckA = alpha.channel.request({
      method: "browserContextMenu",
      target: "nope",
      payload: {},
    });
    const stuckB = beta.channel.request({
      method: "browserContextMenu",
      target: "nope",
      payload: {},
    });
    spawned[0]?.crash(1);

    await expect(stuckA).rejects.toThrow();
    await expect(stuckB).rejects.toThrow();
  });

  it("brings every plugin in a dead process back", async () => {
    const { supervisor, spawned, warnings } = await makeSupervisor();
    await supervisor.start(plugin("alpha"));
    await supervisor.start(plugin("beta"));

    spawned[0]?.crash(1);
    await new Promise((r) => setTimeout(r, 30));

    expect(spawned).toHaveLength(2);
    expect(spawned[1]?.hosted().sort()).toEqual(["alpha", "beta"]);
    expect(supervisor.get("alpha")).toBeDefined();
    expect(warnings.some((w) => w.includes("restarting"))).toBe(true);
  });

  it("gives up after enough crashes instead of respawning forever", async () => {
    // Told to whoever is holding these plugins, not just logged: they stay
    // registered with the loader, and from here they are unreachable.
    const abandoned: { ids: string[]; problem: string }[] = [];
    const { supervisor, spawned, warnings } = await makeSupervisor({
      onGaveUp: (plugins, problem) =>
        abandoned.push({ ids: plugins.map((one) => one.pluginId), problem }),
      restart: {
        maxAttempts: 2,
        baseDelayMs: 1,
        schedule: (_ms, run) => {
          const timer = setTimeout(run, 0);
          return () => clearTimeout(timer);
        },
      },
    });
    await supervisor.start(plugin("alpha"));
    await supervisor.start(plugin("beta"));

    for (let i = 0; i < 6; i += 1) {
      spawned.at(-1)?.crash(1);
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(warnings.some((w) => w.includes("giving up"))).toBe(true);
    // 1 original + 2 permitted restarts.
    expect(spawned.length).toBeLessThanOrEqual(3);
    expect(supervisor.get("alpha")).toBeUndefined();
    // Once, for everyone who was in the process — a shared process is a shared
    // fate, and each of them needs the same decision made about it.
    expect(abandoned).toHaveLength(1);
    expect(abandoned[0]?.ids.sort()).toEqual(["alpha", "beta"]);
    expect(abandoned[0]?.problem).toMatch(/crashed 3 times/);
  });

  // The other half of the fix: uptime resets the budget, so a process that
  // ran for an hour and then died is not one crash away from being abandoned.
  it("gives a long-lived process a fresh crash budget", async () => {
    let clock = 0;
    const { supervisor, spawned, warnings } = await makeSupervisor({
      now: () => clock,
      restart: {
        maxAttempts: 2,
        baseDelayMs: 1,
        stabilityWindowMs: 1000,
        schedule: (_ms, run) => {
          const timer = setTimeout(run, 0);
          return () => clearTimeout(timer);
        },
      },
    });
    await supervisor.start(plugin("alpha"));

    for (let i = 0; i < 5; i += 1) {
      clock += 5000; // each process lived well past the window
      spawned.at(-1)?.crash(1);
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(warnings.some((w) => w.includes("giving up"))).toBe(false);
    expect(supervisor.get("alpha")).toBeDefined();
  });

  it("disposes a plugin and keeps the process for the others", async () => {
    const { supervisor, spawned } = await makeSupervisor();
    await supervisor.start(plugin("alpha"));
    await supervisor.start(plugin("beta"));

    await supervisor.stop("alpha");

    expect(supervisor.get("alpha")).toBeUndefined();
    expect(supervisor.processes()).toEqual([
      expect.objectContaining({ pluginIds: ["beta"] }),
    ]);
    expect(spawned).toHaveLength(1);
  });

  it("stops the process once its last plugin leaves", async () => {
    const { supervisor } = await makeSupervisor();
    await supervisor.start(plugin("alpha"));

    await supervisor.stop("alpha");

    expect(supervisor.processes()).toEqual([]);
  });

  // Stopping the last plugin kills the process; that must not read as a crash.
  it("does not restart a process it stopped on purpose", async () => {
    const { supervisor, spawned } = await makeSupervisor();
    await supervisor.start(plugin("alpha"));

    await supervisor.stop("alpha");
    await new Promise((r) => setTimeout(r, 30));

    expect(spawned).toHaveLength(1);
    expect(supervisor.processes()).toEqual([]);
  });

  // The shape a reload actually takes. The loader starts the successor while
  // the predecessor is still serving — that ordering is what lets a failed
  // reload keep the old plugin — so one plugin briefly has two instances.
  // Keyed by plugin id, the second start is refused and reload is impossible.
  it("runs two instances of one plugin through a reload swap", async () => {
    const { supervisor, spawned } = await makeSupervisor();
    const shout = (selectionText: string) =>
      ({
        method: "browserContextMenu",
        target: "shout",
        payload: { selectionText },
      }) as const;
    const previous = await supervisor.start(plugin("alpha", "alpha#1"));

    const next = await supervisor.start(plugin("alpha", "alpha#2"));

    // Both alive, in the one process, each answering on its own channel.
    expect(spawned).toHaveLength(1);
    expect(supervisor.processes()[0]?.pluginIds).toEqual(["alpha", "alpha"]);
    await expect(previous.channel.request(shout("старый"))).resolves.toBe(
      "СТАРЫЙ",
    );
    await expect(next.channel.request(shout("новый"))).resolves.toBe("НОВЫЙ");

    // Dropping the predecessor leaves the successor serving, in the same
    // process: the last-member kill must not read this as an empty one.
    await supervisor.stop("alpha#1");

    expect(supervisor.get("alpha#1")).toBeUndefined();
    expect(supervisor.get("alpha#2")).toBeDefined();
    expect(supervisor.processes()).toEqual([
      expect.objectContaining({ pluginIds: ["alpha"] }),
    ]);
    await expect(next.channel.request(shout("ещё"))).resolves.toBe("ЕЩЁ");
  });

  // A factory that throws must not leave the channel and the multiplexer slot
  // behind, or the next attempt is refused for a name that is already open.
  it("leaves nothing behind when a plugin fails to load", async () => {
    const { supervisor } = await makeSupervisor();

    await expect(
      supervisor.start({
        instanceId: "alpha",
        pluginId: "alpha",
        permissions: [],
        sites: undefined,
        serverEntry: SAMPLE_ENTRY,
        apiKey: "test-key",
      }),
    ).rejects.toThrow(/"contextMenu\.register" permission/);

    // The same id starts cleanly once its manifest is fixed.
    await expect(supervisor.start(plugin("alpha"))).resolves.toBeDefined();
  });

  // The loader gives up on a slow start and loads the plugin in the server
  // instead. That has to reach the plugin process: a factory that is merely
  // slow would otherwise finish into a live instance nobody holds, while the
  // same plugin runs here.
  it("abandons a start that has not finished", async () => {
    // Alive and deaf: it takes messages and never answers, which is what a
    // plugin whose factory never returns looks like from this side.
    const { supervisor } = await makeSupervisor({
      spawn: () => {
        const child = new EventEmitter() as unknown as ChildProcess;
        Object.assign(child, {
          pid: 1,
          connected: true,
          exitCode: null,
          stderr: null,
          send: () => true,
          disconnect: () => {},
          kill: () => true,
        });
        return child;
      },
    });

    const abandon = new AbortController();
    const attempt = supervisor.start(plugin("alpha"), {
      signal: abandon.signal,
    });
    abandon.abort();

    await expect(attempt).rejects.toThrow(/abandoned/);
    expect(supervisor.get("alpha")).toBeUndefined();
    // A signal that is already aborted has no listener to fire, so it is
    // checked rather than subscribed to. Rejecting with the abandon reason —
    // rather than "multiplexed channel is already open" — is also what says
    // the first attempt gave its slot back.
    const second = supervisor.start(plugin("alpha"), {
      signal: AbortSignal.abort(),
    });
    await expect(second).rejects.toThrow(/plugin channel .* closed/);
  });

  it("refuses to start the same instance twice", async () => {
    const { supervisor } = await makeSupervisor();
    await supervisor.start(plugin("alpha"));

    await expect(supervisor.start(plugin("alpha"))).rejects.toThrow(
      /already started/,
    );
  });

  // The fake child is fast and deterministic, and it is still a fake. This one
  // forks the real entry so the spawn path, the IPC pipe and the multiplexer
  // are all the production ones.
  it("runs two plugins in one real forked process", async () => {
    const kv = new Map<string, string>();
    const sharedDataDir = await dataDir();
    const supervisor = createPluginSupervisor({
      shared: () => ({
        dataDir: sharedDataDir,
        loopbackBaseUrl: "http://127.0.0.1:1",
      }),
      handlers: {
        onRequest: () => (request) => {
          const body = request.payload as Record<string, string>;
          if (request.method === "storage.kv.set") {
            kv.set(body.key ?? "", body.json ?? "");
            return null;
          }
          throw new Error(`unexpected ${request.method}`);
        },
        onNotify: () => () => {},
      },
      spawn: () =>
        fork(
          resolve(HERE, "../../../src/services/plugins/plugin-host-entry.ts"),
          [],
          {
            execArgv: [
              "--conditions=source",
              "--import",
              import.meta.resolve("tsx"),
            ],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
          },
        ),
    });
    supervisors.push(supervisor);

    const alpha = await supervisor.start(plugin("alpha"));
    const beta = await supervisor.start(plugin("beta"));

    expect(supervisor.processes()).toHaveLength(1);
    expect(alpha.snapshot.contextMenuItems.map((item) => item.id)).toEqual([
      "shout",
    ]);

    // Both answer on their own channels, over the same pipe.
    await expect(
      alpha.channel.request({
        method: "browserContextMenu",
        target: "shout",
        payload: { selectionText: "первый" },
      }),
    ).resolves.toBe("ПЕРВЫЙ");
    await expect(
      beta.channel.request({
        method: "browserContextMenu",
        target: "shout",
        payload: { selectionText: "второй" },
      }),
    ).resolves.toBe("ВТОРОЙ");
  }, 30_000);

  // The two halves of the boundary, meeting: a real forked process running a
  // real plugin, whose host calls are served by the real host-call server over
  // the same capability object `createPluginApi` would have been given.
  it("serves a real plugin's host calls through the real host-call server", async () => {
    const kv = new Map<string, string>();
    const logs: string[] = [];
    const signals: { channel: string; payload: unknown }[] = [];
    const capabilities = {
      pluginId: "alpha",
      permissions: ["contextMenu.register"],
      dataDir: await dataDir(),
      logger: {
        debug: (m: string) => logs.push(m),
        info: (m: string) => logs.push(m),
        warn: (m: string) => logs.push(m),
        error: (m: string) => logs.push(m),
      },
      kvStore: {
        get: async (key: string) => kv.get(key),
        set: async (key: string, json: string) => {
          kv.set(key, json);
        },
        delete: async (key: string) => {
          kv.delete(key);
        },
        list: async () => [...kv.keys()],
      },
      readSettingsValues: async () => ({}),
      getSdk: () => undefined,
      getLoopbackBaseUrl: () => "http://127.0.0.1:1",
      publishSignal: (channel: string, payload: unknown) =>
        signals.push({ channel, payload }),
      reportNeedsConfiguration: () => {},
      isAgentToolNameTaken: () => undefined,
      reportAgentToolProblem: () => {},
      requestInteraction: async () => ({ ok: true }),
      requestBrowserCommand: async () => null,
      getBrowserHostStatus: () => ({ connected: false, hostCount: 0 }),
    } as unknown as PluginHostCapabilities;
    const hostCalls = createPluginHostCallServer(capabilities);
    const sharedDataDir = await dataDir();

    const supervisor = createPluginSupervisor({
      shared: () => ({
        dataDir: sharedDataDir,
        loopbackBaseUrl: "http://127.0.0.1:1",
      }),
      handlers: {
        onRequest: () => hostCalls.onRequest,
        onNotify: () => hostCalls.onNotify,
      },
      spawn: () =>
        fork(
          resolve(HERE, "../../../src/services/plugins/plugin-host-entry.ts"),
          [],
          {
            execArgv: [
              "--conditions=source",
              "--import",
              import.meta.resolve("tsx"),
            ],
            stdio: ["ignore", "ignore", "pipe", "ipc"],
          },
        ),
    });
    supervisors.push(supervisor);

    await supervisor.start(plugin("alpha"));

    // The factory's patcher.log.info reached the server's logger, and its
    // patcher.storage.kv.set reached the server's kv — through a pipe, with no
    // test double anywhere in the path.
    expect(logs).toContain("[plugin:alpha] sample plugin loading");
    expect(kv.get("loaded")).toBe(JSON.stringify({ at: "factory" }));
  }, 30_000);
});
