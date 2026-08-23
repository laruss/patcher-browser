import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PLUGIN_PERMISSIONS } from "@patcher/domain";
import {
  createPluginApi,
  type PluginApiHandle,
} from "../../../src/services/plugins/plugin-api.js";
import { createPluginChannel } from "../../../src/services/plugins/plugin-channel.js";
import {
  BOOTSTRAP_METHOD,
  createPluginChildRuntime,
  type PluginRegistrationSnapshot,
} from "../../../src/services/plugins/plugin-child-runtime.js";
import { createLinkedPorts } from "../../../src/services/plugins/plugin-ports.js";
import { createRemotePluginApiHandle } from "../../../src/services/plugins/plugin-remote-handle.js";
import {
  rpcBoundaryError,
  runRpcCall,
} from "../../../src/services/plugins/plugin-rpc-call.js";
import { runAgentToolCall } from "../../../src/services/plugins/plugin-agent-tool-call.js";
import type { JsonValue } from "@patcher/domain";

/**
 * The claim the remote handle makes is that the server cannot tell there is a
 * boundary. The only honest way to check that is to build the *same plugin*
 * both ways and compare — so this loads one fixture in-process through
 * `createPluginApi` and out-of-process through the child runtime, and asks
 * both handles the same questions.
 *
 * A registry that exists on one and not the other, or a call that answers
 * differently, fails here rather than in whatever dispatcher happens to read
 * it first.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const FULL_ENTRY = resolve(HERE, "fixtures/full-plugin/server.ts");

function noopCapabilities(dataDir: string) {
  return {
    pluginId: "full",
    permissions: PLUGIN_PERMISSIONS,
    sites: ["https://example.test/**"],
    dataDir,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    kvStore: {
      get: async () => undefined,
      set: async () => {},
      delete: async () => {},
      list: async () => [],
    },
    readSettingsValues: async () => ({}),
    getSdk: () => undefined,
    getLoopbackBaseUrl: () => "http://127.0.0.1:1",
    publishSignal: () => {},
    reportNeedsConfiguration: () => {},
    isAgentToolNameTaken: () => undefined,
    reportAgentToolProblem: () => {},
    requestInteraction: async () => ({ ok: true }),
    requestBrowserCommand: async () => null,
    getBrowserHostStatus: () => ({ connected: false, hostCount: 0 }),
  } as unknown as Parameters<typeof createPluginApi>[0];
}

describe("a remote handle against the in-process one", () => {
  const dirs: string[] = [];

  async function dataDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "patcher-parity-"));
    dirs.push(dir);
    return dir;
  }

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  /** The same fixture, loaded the way the server does today. */
  async function inProcess(): Promise<PluginApiHandle> {
    const handle = createPluginApi(noopCapabilities(await dataDir()));
    const module = (await import(FULL_ENTRY)) as {
      default: (patcher: unknown) => void;
    };
    module.default(handle.api);
    handle.activate();
    return handle;
  }

  /** The same fixture, loaded in a plugin process, seen through the channel. */
  async function outOfProcess(): Promise<{
    handle: PluginApiHandle;
    snapshot: PluginRegistrationSnapshot;
  }> {
    const [hostPort, pluginPort] = createLinkedPorts();
    const channel = createPluginChannel({
      port: hostPort,
      name: "server",
      onRequest: () => null,
      onNotify: () => {},
    });
    createPluginChildRuntime({ port: pluginPort });
    const snapshot = (await channel.request({
      method: BOOTSTRAP_METHOD,
      payload: {
        pluginId: "full",
        permissions: PLUGIN_PERMISSIONS,
        sites: ["https://example.test/**"],
        dataDir: await dataDir(),
        loopbackBaseUrl: "http://127.0.0.1:1",
        apiKey: "k",
        serverEntry: FULL_ENTRY,
      } as unknown as JsonValue,
    })) as unknown as PluginRegistrationSnapshot;
    return {
      snapshot,
      handle: createRemotePluginApiHandle({
        channel: channel as never,
        pluginId: "full",
        snapshot,
      }),
    };
  }

  it("exposes the same registrations, member for member", async () => {
    const local = await inProcess();
    const { handle: remote } = await outOfProcess();

    const shape = (handle: PluginApiHandle) => ({
      httpRoutes: handle.httpRoutes.map(
        (r) => `${r.method} ${r.path} ${r.auth}`,
      ),
      backgroundServices: handle.backgroundServices.map((s) => s.name),
      schedules: handle.schedules.map((s) => `${s.name} ${s.cron}`),
      cli: handle.cli.registration && {
        name: handle.cli.registration.name,
        summary: handle.cli.registration.summary,
        commands: handle.cli.registration.commands,
      },
      rpcMethods: [...handle.rpcHandlers.keys()],
      agentTools: handle.agentTools.map(
        (tool) =>
          `${tool.name} ${tool.description} ${tool.instructions} ` +
          JSON.stringify(tool.inputSchema),
      ),
      hasAgentConfiguration: handle.agentConfigurationProvider !== null,
      hasInstructionProvider: handle.instructionProvider !== null,
      mentionProviders: handle.mentionProviders.map(
        (p) => `${p.id} ${p.label} ${p.triggers.join("/")}`,
      ),
      omniboxProviders: handle.omniboxProviders.map(
        (p) => `${p.id} ${p.label} ${p.run === null ? "no-run" : "run"}`,
      ),
      contextMenuItems: handle.contextMenuItems.map(
        (i) => `${i.id} ${i.title} ${JSON.stringify(i.when)}`,
      ),
      findActions: handle.findActions.map((a) => `${a.id} ${a.title}`),
      tabActions: handle.tabActions.map((a) => `${a.id} ${a.title}`),
      siteInfoProviders: handle.siteInfoProviders.map(
        (p) => `${p.id} ${p.label}`,
      ),
      searchEngines: handle.searchEngines.map(
        (e) => `${e.id} ${e.name} ${e.urlTemplate}`,
      ),
      pageStyles: handle.pageStyles.map(
        (style) => `${style.id} ${style.matches.join("|")} ${style.css}`,
      ),
      pageScripts: handle.pageScripts.map(
        (script) => `${script.id} ${script.matches.join("|")} ${script.code}`,
      ),
      downloadHandlers: handle.downloadHandlers.length,
      authProviders: handle.authProviders.length,
      pdfTextProviders: handle.pdfTextProviders.length,
      keybindings: handle.keybindings,
      threadEvents: Object.entries(handle.threadEventHandlers)
        .filter(([, hs]) => (hs as unknown[]).length > 0)
        .map(([event]) => event),
      settingsDescriptors: handle.settings.descriptors,
      hasSettingsListeners: handle.settings.listeners.length > 0,
    });

    expect(shape(remote)).toEqual(shape(local));
  });

  it("answers the same as the local handle when called", async () => {
    const local = await inProcess();
    const { handle: remote } = await outOfProcess();

    const ask = async (handle: PluginApiHandle) => ({
      contextMenu: await handle.contextMenuItems[0]?.run({
        selectionText: "тихо",
      } as never),
      findAction: await handle.findActions[0]?.run({ query: "иглу" } as never),
      tabAction: await handle.tabActions[0]?.run({
        url: "https://example.test/",
      } as never),
      siteInfo: await handle.siteInfoProviders[0]?.describe({
        host: "example.test",
      } as never),
      mentionSearch: await handle.mentionProviders[0]?.search({
        query: "ann",
      } as never),
      mentionResolve: await handle.mentionProviders[0]?.resolve("p-ann"),
      omniboxSuggest: await handle.omniboxProviders[0]?.suggest({
        query: "cats",
      } as never),
      omniboxRun: await handle.omniboxProviders[0]?.run?.("s1", {} as never),
      instructions: await handle.instructionProvider?.({
        threadId: "t1",
        projectId: "p1",
      }),
      configuration: await handle.agentConfigurationProvider?.({} as never),
      cli: await handle.cli.registration?.run(["go"], {} as never),
    });

    expect(await ask(remote)).toEqual(await ask(local));
  });

  // Anonymous providers are addressed by index, and the index has to line up
  // with registration order on both sides or "the first one that answers" picks
  // a different provider out of process than it does in.
  it("keeps anonymous providers in the same order", async () => {
    const local = await inProcess();
    const { handle: remote } = await outOfProcess();

    const challenge = { host: "example.com" } as never;
    expect([
      await remote.authProviders[0]?.(challenge),
      await remote.authProviders[1]?.(challenge),
    ]).toEqual([
      await local.authProviders[0]?.(challenge),
      await local.authProviders[1]?.(challenge),
    ]);

    const document = { pageUrl: "x" } as never;
    expect([
      await remote.pdfTextProviders[0]?.(document),
      await remote.pdfTextProviders[1]?.(document),
    ]).toEqual([
      await local.pdfTextProviders[0]?.(document),
      await local.pdfTextProviders[1]?.(document),
    ]);
  });

  // `patcher` itself has no server-side counterpart, and saying so beats handing
  // back something that looks usable and silently does nothing.
  it("refuses to pretend it has the plugin's Patcher object", async () => {
    const { handle: remote } = await outOfProcess();

    expect(() => remote.api).toThrow(/runs in its own process/);
  });

  // The validators never left the plugin, so the only way to know the remote
  // handle enforces the same contract is to make both handles enforce it.
  it("validates rpc the same way, wherever the handler is", async () => {
    const local = await inProcess();
    const { handle: remote } = await outOfProcess();

    const ask = async (handle: PluginApiHandle, input: unknown) => {
      const method = handle.rpcHandlers.get("greet");
      if (method === undefined) return "no such method";
      try {
        return { ok: await runRpcCall(method, input) };
      } catch (error) {
        const boundary = rpcBoundaryError(error);
        return boundary === null
          ? { threw: (error as Error).message }
          : { failed: boundary };
      }
    };

    // A good call, a rejected input, and an input the schema rejects for a
    // reason worth reading — the issues have to survive the trip too.
    expect(await ask(remote, { who: "мир" })).toEqual(
      await ask(local, { who: "мир" }),
    );
    expect(await ask(remote, { who: 7 })).toEqual(await ask(local, { who: 7 }));
    expect(await ask(remote, { who: "x" })).toEqual(
      await ask(local, { who: "x" }),
    );
    // And the failure is the rpc one, not some generic error that happens to
    // match on both sides.
    const rejected = (await ask(remote, { who: 7 })) as {
      failed: { code: string; issues?: unknown[] };
    };
    expect(rejected.failed.code).toBe("invalid_input");
    expect(rejected.failed.issues?.length).toBeGreaterThan(0);
  });

  it("validates agent-tool arguments the same way", async () => {
    const local = await inProcess();
    const { handle: remote } = await outOfProcess();

    const run = async (handle: PluginApiHandle, input: unknown) => {
      const tool = handle.agentTools[0];
      if (tool === undefined) return "no such tool";
      return runAgentToolCall(tool, input, {
        threadId: "t1",
        projectId: "p1",
      } as never);
    };

    // `loud` defaults to true in the schema, so a bare `{ word }` only shouts
    // if the *parsed* value reached execute.
    expect(await run(remote, { word: "тихо" })).toEqual(
      await run(local, { word: "тихо" }),
    );
    expect(await run(remote, { word: "тихо" })).toBe("ТИХО");
    expect(await run(remote, { word: 7 })).toEqual(
      await run(local, { word: 7 }),
    );
    expect(await run(remote, { word: 7 })).toMatchObject({ isError: true });
  });
});
