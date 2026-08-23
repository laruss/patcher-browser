import { fork, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PLUGIN_PERMISSIONS } from "@patcher/domain";
import type { JsonValue } from "@patcher/domain";
import {
  createPluginChannel,
  type PluginChannel,
} from "../../../src/services/plugins/plugin-channel.js";
import {
  createChildProcessPort,
  createLinkedPorts,
} from "../../../src/services/plugins/plugin-ports.js";
import { createPortMultiplexer } from "../../../src/services/plugins/plugin-port-multiplexer.js";
import {
  BOOTSTRAP_METHOD,
  createPluginChildRuntime,
  type PluginFactory,
  type PluginHostConfig,
  type PluginRegistrationSnapshot,
} from "../../../src/services/plugins/plugin-child-runtime.js";

/**
 * A plugin running in a plugin process, asked to do the things a plugin does.
 *
 * The "host" here is a test double for the *server*, not a second `patcher` — the
 * `patcher` under test is the real `createPluginApi`, which is the whole point of
 * the design: there is one implementation of it and this exercises that one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE_ENTRY = resolve(HERE, "fixtures/sample-plugin/server.ts");

interface FakeHost {
  channel: PluginChannel;
  /** Everything the plugin sent us, in order. */
  calls: { method: string; payload: unknown }[];
  kv: Map<string, string>;
}

function startPluginProcess(options: {
  dataDir: string;
  loadFactory?: (entry: string) => Promise<PluginFactory>;
}): {
  host: FakeHost;
  bootstrap: (
    overrides?: Partial<PluginHostConfig>,
  ) => Promise<PluginRegistrationSnapshot>;
  dispose: () => void;
} {
  const [hostPort, pluginPort] = createLinkedPorts();
  const calls: { method: string; payload: unknown }[] = [];
  const kv = new Map<string, string>();

  const channel = createPluginChannel({
    port: hostPort,
    name: "server",
    onNotify: ({ method, payload }) => calls.push({ method, payload }),
    onRequest: ({ method, payload }) => {
      calls.push({ method, payload });
      const body = payload as Record<string, JsonValue>;
      switch (method) {
        case "storage.kv.get":
          return kv.get(String(body.key)) ?? null;
        case "storage.kv.set":
          kv.set(String(body.key), String(body.json));
          return null;
        case "storage.kv.list":
          return [...kv.keys()];
        case "settings.<handle>.get":
          return {};
        default:
          throw new Error(`the test host does not serve "${method}"`);
      }
    },
  });

  createPluginChildRuntime({
    port: pluginPort,
    ...(options.loadFactory ? { loadFactory: options.loadFactory } : {}),
  });

  return {
    host: { channel, calls, kv },
    bootstrap: async (overrides) =>
      (await channel.request({
        method: BOOTSTRAP_METHOD,
        payload: {
          pluginId: "sample",
          permissions: ["contextMenu.register"],
          dataDir: options.dataDir,
          loopbackBaseUrl: "http://127.0.0.1:1",
          apiKey: "test-key",
          serverEntry: SAMPLE_ENTRY,
          ...overrides,
        } as unknown as JsonValue,
      })) as unknown as PluginRegistrationSnapshot,
    dispose: () => channel.close("test over"),
  };
}

describe("a plugin in its own process", () => {
  const tempDirs: string[] = [];
  const children: ChildProcess[] = [];

  async function dataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "patcher-plugin-child-"));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
    for (const dir of tempDirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("loads the plugin and reports what it registered", async () => {
    const { bootstrap } = startPluginProcess({ dataDir: await dataDir() });

    const snapshot = await bootstrap();

    expect(snapshot.contextMenuItems.map((item) => item.id)).toEqual(["shout"]);
    // The whole tool minus its validator: the JSON Schema is what the model
    // is shown, and it is data.
    expect(snapshot.agentTools).toEqual([
      {
        name: "sample_echo",
        description: expect.any(String),
        instructions: null,
        inputSchema: expect.any(Object),
        experimentalStatusLabels: null,
      },
    ]);
    expect(snapshot.httpRoutes).toEqual([]);
  });

  // The factory's `patcher.log.info` and `patcher.storage.kv.set` are the two directions
  // of the plugin→host half: one that expects nothing back and one that does.
  it("runs the plugin's host calls over the channel", async () => {
    const { host, bootstrap } = startPluginProcess({
      dataDir: await dataDir(),
    });

    await bootstrap();

    // The "[plugin:sample] " prefix is not the test being lenient — it is
    // plugin-api.ts's own logger wrapper, reached unchanged from another
    // process. Nothing in this file re-implements it.
    expect(host.calls).toContainEqual({
      method: "log.info",
      payload: "[plugin:sample] sample plugin loading",
    });
    expect(host.kv.get("loaded")).toBe(JSON.stringify({ at: "factory" }));
  });

  it("serves a callback into what the plugin registered", async () => {
    const { host, bootstrap } = startPluginProcess({
      dataDir: await dataDir(),
    });
    await bootstrap();

    await expect(
      host.channel.request({
        method: "browserContextMenu",
        target: "shout",
        payload: { selectionText: "тихо" },
      }),
    ).resolves.toBe("ТИХО");
  });

  it("hands an agent tool its context and its result back", async () => {
    const { host, bootstrap } = startPluginProcess({
      dataDir: await dataDir(),
    });
    await bootstrap();

    await expect(
      host.channel.request({
        method: "agentTool",
        target: "sample_echo",
        payload: { input: { text: "ping" }, ctx: { threadId: "t1" } },
      }),
    ).resolves.toBe("t1: ping");
  });

  // The permission gate is the same object here as in the server, so a plugin
  // in another process is refused by the same code with the same message.
  it("refuses a surface the manifest did not declare", async () => {
    const { host, bootstrap } = startPluginProcess({
      dataDir: await dataDir(),
    });
    await bootstrap();

    await expect(
      host.channel.request({
        method: "browserContextMenu",
        target: "shout",
        payload: { selectionText: "x" },
      }),
    ).resolves.toBe("X");

    // ...but a plugin that declared nothing cannot even register the item, so
    // its factory fails — which is the in-process behaviour too.
    const other = startPluginProcess({ dataDir: await dataDir() });
    await expect(other.bootstrap({ permissions: [] })).rejects.toThrow(
      /"contextMenu\.register" permission/,
    );
  });

  it("names a callback for something the plugin never registered", async () => {
    const { host, bootstrap } = startPluginProcess({
      dataDir: await dataDir(),
    });
    await bootstrap();

    await expect(
      host.channel.request({
        method: "browserContextMenu",
        target: "nope",
        payload: {},
      }),
    ).rejects.toThrow(/no context menu item "nope"/);
  });

  it("refuses a callback before the plugin is bootstrapped", async () => {
    const { host } = startPluginProcess({ dataDir: await dataDir() });

    await expect(
      host.channel.request({ method: "threadEvent", payload: {} }),
    ).rejects.toThrow(/before it was bootstrapped/);
  });

  it("refuses to become a second plugin", async () => {
    const { bootstrap } = startPluginProcess({ dataDir: await dataDir() });
    await bootstrap();

    await expect(bootstrap()).rejects.toThrow(/already been bootstrapped/);
  });

  it("runs dispose hooks and then poisons the handle", async () => {
    const { host, bootstrap } = startPluginProcess({
      dataDir: await dataDir(),
    });
    await bootstrap();

    await host.channel.request({ method: "dispose", payload: null });

    expect(host.calls).toContainEqual({
      method: "log.info",
      payload: "[plugin:sample] sample plugin disposing",
    });
    await expect(
      host.channel.request({
        method: "browserContextMenu",
        target: "shout",
        payload: { selectionText: "x" },
      }),
    ).rejects.toThrow(/after the plugin was disposed/);
  });

  // Both of these were refused here until their shapes were applied; they now
  // reach the plugin's registrations like any other kind, and the failure a
  // caller sees is the ordinary "you never registered that one".
  it("carries http and backgroundService now, and says when they are unregistered", async () => {
    const { host, bootstrap } = startPluginProcess({
      dataDir: await dataDir(),
    });
    await bootstrap();

    await expect(
      host.channel.request({ method: "http", target: "GET /x", payload: {} }),
    ).rejects.toThrow(/no http route "GET \/x"/);
    await expect(
      host.channel.request({
        method: "backgroundService",
        target: "ghost",
        payload: { kind: "start", name: "ghost" },
      }),
    ).rejects.toThrow(/no background service "ghost"/);
  });

  // storage.database() is why the host process is Node: the plugin's own
  // process opens the file rather than asking for a handle no transport could
  // carry. Nothing about this call reaches the host.
  it("opens its own SQLite database in its own process", async () => {
    const dir = await dataDir();
    let rows = -1;
    const { host, bootstrap } = startPluginProcess({
      dataDir: dir,
      loadFactory: async () => (patcher) => {
        const storage = patcher.storage as unknown as { database(): unknown };
        const db = storage.database() as {
          exec(sql: string): void;
          prepare(sql: string): { get(): { n: number } };
        };
        db.exec("CREATE TABLE t (a)");
        db.exec("INSERT INTO t VALUES (1)");
        rows = db.prepare("SELECT count(*) AS n FROM t").get().n;
      },
    });

    await bootstrap({ permissions: [] });

    expect(rows).toBe(1);
    expect(
      host.calls.some((call) => call.method.startsWith("storage.database")),
    ).toBe(false);
  });

  // The whole thing, in the process it is meant to run in: the real entry
  // point, the real IPC channel, jiti loading a real plugin file.
  it("does all of that in an actual forked process", async () => {
    const dir = await dataDir();
    const child = fork(
      resolve(HERE, "../../../src/services/plugins/plugin-host-entry.ts"),
      [],
      {
        // `--conditions=source` is the repo idiom for running a workspace TS
        // entry (see agent-runtime's bridge-path.ts): without it the child
        // resolves @patcher/sdk's *published* entry, which lacks the Node-only
        // exports this file needs. A packaged server forks a built entry and
        // needs neither flag.
        execArgv: [
          "--conditions=source",
          "--import",
          import.meta.resolve("tsx"),
        ],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    children.push(child);
    // Without this, a child that dies on startup shows up only as "the far
    // side is gone" — true, useless, and the reason this took a detour.
    const childStderr: string[] = [];
    child.stderr?.on("data", (chunk) => childStderr.push(String(chunk)));
    const kv = new Map<string, string>();
    const logs: string[] = [];
    // The entry hosts several plugins over one pipe now, so even a single
    // plugin arrives on a multiplexed channel keyed by its id.
    const multiplexer = createPortMultiplexer({
      port: createChildProcessPort(child),
      onUnroutable: (problem) => childStderr.push(`unroutable: ${problem}`),
    });
    const channel = createPluginChannel({
      port: multiplexer.open("sample"),
      name: "server",
      onNotify: ({ method, payload }) => {
        if (method.startsWith("log.")) logs.push(String(payload));
      },
      onRequest: ({ method, payload }) => {
        const body = payload as Record<string, JsonValue>;
        if (method === "storage.kv.set") {
          kv.set(String(body.key), String(body.json));
          return null;
        }
        throw new Error(`the test host does not serve "${method}"`);
      },
    });

    const snapshot = (await channel
      .request({
        method: BOOTSTRAP_METHOD,
        payload: {
          pluginId: "sample",
          permissions: ["contextMenu.register"],
          dataDir: dir,
          loopbackBaseUrl: "http://127.0.0.1:1",
          apiKey: "test-key",
          serverEntry: SAMPLE_ENTRY,
        } as unknown as JsonValue,
      })
      .catch((error: Error) => {
        throw new Error(`${error.message}\n${childStderr.join("")}`);
      })) as unknown as PluginRegistrationSnapshot;

    expect(snapshot.contextMenuItems.map((item) => item.id)).toEqual(["shout"]);
    expect(kv.get("loaded")).toBe(JSON.stringify({ at: "factory" }));
    expect(logs).toContain("[plugin:sample] sample plugin loading");

    // And a callback into the plugin, across the pipe.
    await expect(
      channel.request({
        method: "browserContextMenu",
        target: "shout",
        payload: { selectionText: "далеко" },
      }),
    ).resolves.toBe("ДАЛЕКО");
  }, 30_000);

  // `@patcher/sdk` is not imported until a plugin asks for `patcher.sdk`: it builds the
  // whole public API surface at import time and costs the process ~100MB,
  // which most plugins never use. Deferring it is only safe if the deferred
  // load still produces a working SDK, and only a real process can say —
  // in a source checkout `createRequire` resolves it, and in a packaged
  // server the bundler has folded it in behind a literal `require`.
  it("loads the SDK on demand, in an actual forked process", async () => {
    const dir = await dataDir();
    const child = fork(
      resolve(HERE, "../../../src/services/plugins/plugin-host-entry.ts"),
      [],
      {
        execArgv: [
          "--conditions=source",
          "--import",
          import.meta.resolve("tsx"),
        ],
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      },
    );
    children.push(child);
    const childStderr: string[] = [];
    child.stderr?.on("data", (chunk) => childStderr.push(String(chunk)));
    const multiplexer = createPortMultiplexer({
      port: createChildProcessPort(child),
      onUnroutable: (problem) => childStderr.push(`unroutable: ${problem}`),
    });
    const channel = createPluginChannel({
      port: multiplexer.open("sdkish"),
      name: "server",
      onNotify: () => {},
      onRequest: ({ method }) => {
        throw new Error(`the test host does not serve "${method}"`);
      },
    });

    await channel
      .request({
        method: BOOTSTRAP_METHOD,
        payload: {
          pluginId: "sdkish",
          // Every permission: this is about loading the SDK, and the gate in
          // front of each area is somebody else's test.
          permissions: PLUGIN_PERMISSIONS,
          dataDir: dir,
          loopbackBaseUrl: "http://127.0.0.1:1",
          apiKey: "test-key",
          serverEntry: resolve(HERE, "fixtures/sdk-plugin/server.ts"),
        } as unknown as JsonValue,
      })
      .catch((error: Error) => {
        throw new Error(`${error.message}\n${childStderr.join("")}`);
      });

    // An area method and `guide.render`, which is synchronous — the reason the
    // deferred load has to be synchronous too.
    await expect(
      channel.request({
        method: "browserContextMenu",
        target: "sdk_probe",
        payload: {},
      }),
    ).resolves.toBe("function function");
  }, 30_000);
});
