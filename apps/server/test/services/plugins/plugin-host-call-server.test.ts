import { describe, expect, it, vi } from "vitest";
import { PLUGIN_PERMISSIONS, type PluginPermission } from "@patcher/domain";
import {
  ANSWERED_IN_THE_PLUGIN_PROCESS,
  createPluginHostCallServer,
  ONE_WAY,
  type PluginHostCapabilities,
} from "../../../src/services/plugins/plugin-host-call-server.js";
import {
  PLUGIN_HOST_CALLS,
  type PluginHostCallPath,
} from "../../../src/services/plugins/plugin-host-calls.js";

/**
 * The host end of what a plugin asks for. Its job is to be indistinguishable
 * from the in-process object, so most of these check that a call lands on the
 * same capability `createPluginApi` would have called.
 */

function capabilities(
  declared: readonly PluginPermission[] = PLUGIN_PERMISSIONS,
) {
  const spies = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    kvGet: vi.fn(async () => JSON.stringify({ hello: "there" })),
    kvSet: vi.fn(async () => {}),
    kvDelete: vi.fn(async () => {}),
    kvList: vi.fn(async () => ["a", "b"]),
    readSettingsValues: vi.fn(async () => ({ token: "secret" })),
    publishSignal: vi.fn(),
    reportNeedsConfiguration: vi.fn(),
    reportAgentToolProblem: vi.fn(),
    requestInteraction: vi.fn(async () => ({ ok: true })),
    requestBrowserCommand: vi.fn(async () => ({ tabs: [] })),
  };
  const caps = {
    pluginId: "probe",
    permissions: declared,
    dataDir: "/tmp",
    logger: {
      debug: spies.debug,
      info: spies.info,
      warn: spies.warn,
      error: spies.error,
    },
    kvStore: {
      get: spies.kvGet,
      set: spies.kvSet,
      delete: spies.kvDelete,
      list: spies.kvList,
    },
    readSettingsValues: spies.readSettingsValues,
    getSdk: () => undefined,
    getLoopbackBaseUrl: () => "http://127.0.0.1:1",
    publishSignal: spies.publishSignal,
    reportNeedsConfiguration: spies.reportNeedsConfiguration,
    isAgentToolNameTaken: () => undefined,
    reportAgentToolProblem: spies.reportAgentToolProblem,
    requestInteraction: spies.requestInteraction,
    requestBrowserCommand: spies.requestBrowserCommand,
    getBrowserHostStatus: () => ({ connected: false, hostCount: 0 }),
  } as unknown as PluginHostCapabilities;
  return { caps, spies, server: createPluginHostCallServer(caps) };
}

const NO_SIGNAL = new AbortController().signal;

describe("every catalogue path is accounted for", () => {
  const all = Object.keys(PLUGIN_HOST_CALLS) as PluginHostCallPath[];
  const served = all.filter(
    (path) => !ANSWERED_IN_THE_PLUGIN_PROCESS.has(path) && !ONE_WAY.has(path),
  );

  // The classification has to be total, or a path added to the catalogue can
  // reach the host and fall out of the switch as "unknown".
  it("classifies all of them", () => {
    expect(
      served.length + ANSWERED_IN_THE_PLUGIN_PROCESS.size + ONE_WAY.size,
    ).toBe(all.length);
  });

  // Not a spelling check: each one is actually invoked, so a path that is
  // classified as served but has no case fails here.
  it("actually handles the ones it claims to serve", async () => {
    const { server } = capabilities();
    const unhandled: string[] = [];
    for (const path of served) {
      try {
        await server.onRequest({
          method: path,
          payload: {
            descriptors: {},
            ports: [],
            command: { type: "tabs.list" },
          },
          signal: NO_SIGNAL,
        });
      } catch (error) {
        if (/unknown plugin host call/.test(String(error)))
          unhandled.push(path);
      }
    }

    expect(unhandled).toEqual([]);
  });

  it("says so when it receives one the plugin process owns", async () => {
    const { server } = capabilities();

    await expect(
      server.onRequest({
        method: "storage.database",
        payload: null,
        signal: NO_SIGNAL,
      }),
    ).rejects.toThrow(/answered inside the plugin's own process/);
  });
});

describe("calls land on the capability the in-process object would use", () => {
  it("reads and writes kv", async () => {
    const { server, spies } = capabilities();

    await expect(
      server.onRequest({
        method: "storage.kv.get",
        payload: { key: "k" },
        signal: NO_SIGNAL,
      }),
    ).resolves.toBe(JSON.stringify({ hello: "there" }));
    await server.onRequest({
      method: "storage.kv.set",
      payload: { key: "k", json: "1" },
      signal: NO_SIGNAL,
    });

    expect(spies.kvGet).toHaveBeenCalledWith("k");
    expect(spies.kvSet).toHaveBeenCalledWith("k", "1");
  });

  it("answers a missing kv key with null rather than undefined", async () => {
    const { caps, server } = capabilities();
    (caps.kvStore.get as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    await expect(
      server.onRequest({
        method: "storage.kv.get",
        payload: { key: "gone" },
        signal: NO_SIGNAL,
      }),
    ).resolves.toBeNull();
  });

  it("passes the caller's signal into a browser command", async () => {
    const { server, spies } = capabilities();
    const controller = new AbortController();

    await server.onRequest({
      method: "browser.<command>",
      payload: { command: { type: "tabs.list" }, timeoutMs: 500 },
      signal: controller.signal,
    });

    expect(spies.requestBrowserCommand).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 500, signal: controller.signal }),
    );
  });

  it("routes each log level to its own method", () => {
    const { server, spies } = capabilities();

    server.onNotify({ method: "log.warn", payload: "careful" });

    expect(spies.warn).toHaveBeenCalledWith("careful");
    expect(spies.info).not.toHaveBeenCalled();
  });

  it("answers a one-way call sent as a request", async () => {
    const { server, spies } = capabilities();

    await expect(
      server.onRequest({
        method: "log.info",
        payload: "hello",
        signal: NO_SIGNAL,
      }),
    ).resolves.toBeNull();
    expect(spies.info).toHaveBeenCalledWith("hello");
  });
});

describe("input the host did not expect", () => {
  it("logs an unknown notification instead of throwing", () => {
    const { server, spies } = capabilities();

    expect(() =>
      server.onNotify({ method: "something.new", payload: null }),
    ).not.toThrow();
    expect(spies.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown notification "something.new"'),
    );
  });

  it("refuses an unknown request", async () => {
    const { server } = capabilities();

    await expect(
      server.onRequest({
        method: "something.new",
        payload: null,
        signal: NO_SIGNAL,
      }),
    ).rejects.toThrow(/unknown plugin host call/);
  });
});

/**
 * The point of this end of the channel, and the reason it re-checks what the
 * plugin's own process already checked: a frame that arrives here did not
 * necessarily come through the `patcher` object the plugin was handed. A plugin
 * shares its process with the port and can write to the pipe itself.
 */
describe("the declared permission set is enforced on this side", () => {
  it("refuses a browser command the plugin did not declare", async () => {
    const { server, spies } = capabilities([]);

    await expect(
      server.onRequest({
        method: "browser.<command>",
        payload: {
          command: {
            type: "page.storage",
            tabId: null,
            operation: { kind: "cookies-get" },
          },
        },
        signal: NO_SIGNAL,
      }),
    ).rejects.toThrow(/needs the "page.credentials" permission/);

    expect(spies.requestBrowserCommand).not.toHaveBeenCalled();
  });

  it("says so in the log, because nothing else would show it", async () => {
    const { server, spies } = capabilities([]);

    await expect(
      server.onRequest({
        method: "browser.<command>",
        payload: { command: { type: "tabs.list" } },
        signal: NO_SIGNAL,
      }),
    ).rejects.toThrow(/tabs.read/);

    expect(spies.warn).toHaveBeenCalledWith(
      expect.stringContaining('asked the host for browser command "tabs.list"'),
    );
  });

  it("charges each command what the shared map says it costs", async () => {
    // `page.inject` and nothing else: the plugin reaches `evaluate` and is
    // refused the cookie read beside it, rather than both or neither.
    const { server, spies } = capabilities(["page.inject"]);

    await server.onRequest({
      method: "browser.<command>",
      payload: {
        command: {
          type: "page.control",
          tabId: null,
          generation: null,
          operation: { kind: "evaluate", expression: "1", ref: null },
        },
      },
      signal: NO_SIGNAL,
    });
    expect(spies.requestBrowserCommand).toHaveBeenCalledTimes(1);

    await expect(
      server.onRequest({
        method: "browser.<command>",
        payload: {
          command: {
            type: "page.storage",
            tabId: null,
            operation: { kind: "cookies-get" },
          },
        },
        signal: NO_SIGNAL,
      }),
    ).rejects.toThrow(/needs the "page.credentials" permission/);
    expect(spies.requestBrowserCommand).toHaveBeenCalledTimes(1);
  });

  it("refuses a command it cannot price rather than guessing", async () => {
    // The price of `page.control` is its operation's, so a frame that omits
    // the operation is a frame asking to be charged for nothing.
    const { server, spies } = capabilities();

    await expect(
      server.onRequest({
        method: "browser.<command>",
        payload: { command: { type: "page.control", tabId: null } },
        signal: NO_SIGNAL,
      }),
    ).rejects.toThrow(/not a valid BrowserCommand/);

    expect(spies.requestBrowserCommand).not.toHaveBeenCalled();
  });

  it("validates ui.requestInput here too", async () => {
    const { server, spies } = capabilities();

    await expect(
      server.onRequest({
        method: "ui.requestInput",
        payload: {
          threadId: "t1",
          rendererId: "r1",
          title: "Pick one",
          payload: null,
          // Off the far end of what the in-process object allows.
          timeoutMs: 60 * 60 * 1000 + 1,
        },
        signal: NO_SIGNAL,
      }),
    ).rejects.toThrow(/timeoutMs must be between 1 and 3600000/);

    expect(spies.requestInteraction).not.toHaveBeenCalled();
  });
});
