import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono, type Context } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { isNeedsConfigurationError } from "../../../src/services/plugins/plugin-api.js";
import {
  createPluginChannel,
  type PluginChannel,
} from "../../../src/services/plugins/plugin-channel.js";
import {
  BOOTSTRAP_METHOD,
  createPluginChildRuntime,
  type PluginRegistrationSnapshot,
} from "../../../src/services/plugins/plugin-child-runtime.js";
import { createLinkedPorts } from "../../../src/services/plugins/plugin-ports.js";
import {
  remoteBackgroundService,
  remoteHttpRoute,
} from "../../../src/services/plugins/plugin-remote-handle.js";
import type { JsonValue } from "@patcher/domain";

/**
 * The two callbacks that could not cross, now crossing.
 *
 * Both are exercised the way the server will use them: an HTTP route through a
 * real Hono app so the plugin gets a real `Context`, and a service through the
 * same resolve/reject pair the in-process runner already decides on.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRE_ENTRY = resolve(HERE, "fixtures/wire-plugin/server.ts");
const BASE = "http://127.0.0.1:3334/api/v1/plugins/wire/http";

/**
 * Call a route the way the server does: a real Hono `Context`, and the
 * handler's rejection propagated rather than absorbed.
 *
 * That second part matters and is easy to get wrong — a plain `app.fetch`
 * turns a rejecting handler into a 500 and hides it. The server never sees
 * that, because `invokeHttpRoute` calls the handler itself inside
 * `invokeCallback`, which is what records the failure against the plugin.
 */
async function callRoute(
  route: { handler: (context: Context) => Response | Promise<Response> },
  request: Request,
): Promise<{ response: Response | null; error: unknown }> {
  let error: unknown = null;
  let response: Response | null = null;
  const app = new Hono();
  app.all("*", async (context) => {
    try {
      response = await route.handler(context);
    } catch (thrown) {
      error = thrown;
    }
    return new Response(null, { status: 204 });
  });
  await app.fetch(request);
  return { response, error };
}

describe("http and background services across the boundary", () => {
  const dirs: string[] = [];

  async function start(): Promise<{
    channel: PluginChannel;
    snapshot: PluginRegistrationSnapshot;
    logs: string[];
  }> {
    const dir = await mkdtemp(join(tmpdir(), "patcher-wire-"));
    dirs.push(dir);
    const [hostPort, pluginPort] = createLinkedPorts();
    const logs: string[] = [];
    const channel = createPluginChannel({
      port: hostPort,
      name: "server",
      onNotify: ({ method, payload }) => {
        if (method.startsWith("log.")) logs.push(String(payload));
      },
      onRequest: () => null,
    });
    createPluginChildRuntime({ port: pluginPort });
    const snapshot = (await channel.request({
      method: BOOTSTRAP_METHOD,
      payload: {
        pluginId: "wire",
        permissions: [],
        dataDir: dir,
        loopbackBaseUrl: "http://127.0.0.1:1",
        apiKey: "k",
        serverEntry: WIRE_ENTRY,
      } as unknown as JsonValue,
    })) as unknown as PluginRegistrationSnapshot;
    return { channel, snapshot, logs };
  }

  afterEach(async () => {
    for (const dir of dirs.splice(0)) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports both kinds of registration", async () => {
    const { snapshot } = await start();

    expect(snapshot.httpRoutes).toEqual([
      { method: "GET", path: "/echo", auth: "local" },
      { method: "POST", path: "/upper", auth: "local" },
      { method: "GET", path: "/boom", auth: "local" },
    ]);
    expect(snapshot.backgroundServices).toEqual([
      "ticker",
      "faulty",
      "unconfigured",
    ]);
  });

  // Query and headers are the two things a naive reduction loses first.
  it("carries a request's query and headers to the plugin", async () => {
    const { channel } = await start();
    const route = remoteHttpRoute({
      channel: channel as never,
      method: "GET",
      path: "/echo",
      auth: "local",
    });

    const { response, error } = await callRoute(
      route,
      new Request(`${BASE}/echo?who=%D0%BC%D0%B8%D1%80`, {
        headers: { "x-probe": "yes" },
      }),
    );

    // Asserted before the body: a rejected handler leaves `response` null, and
    // "expected undefined to equal {...}" says nothing about why.
    expect(error).toBeNull();
    expect(await response?.json()).toEqual({ who: "мир", via: "yes" });
  });

  it("carries a body both ways, with the status and headers the plugin set", async () => {
    const { channel } = await start();
    const route = remoteHttpRoute({
      channel: channel as never,
      method: "POST",
      path: "/upper",
      auth: "local",
    });

    const { response, error } = await callRoute(
      route,
      new Request(`${BASE}/upper`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "тише" }),
      }),
    );

    expect(error).toBeNull();
    expect(response?.status).toBe(201);
    expect(response?.headers.get("x-a")).toBe("1");
    expect(await response?.text()).toBe("ТИШЕ");
  });

  // A throwing route must reach the host as a throw. The plugin process runs
  // the handler inside a Hono app of its own, and Hono would happily turn the
  // throw into a 500 there — which the host would read as an ordinary answer,
  // losing both the failure it records against the plugin and its own 500 body.
  it("brings a throwing route back as a rejection, not a response", async () => {
    const { channel } = await start();
    const route = remoteHttpRoute({
      channel: channel as never,
      method: "GET",
      path: "/boom",
      auth: "local",
    });

    const { response, error } = await callRoute(
      route,
      new Request(`${BASE}/boom`),
    );

    expect(response).toBeNull();
    expect((error as Error).message).toMatch(/route exploded/);
  });

  it("runs a service until the host aborts it", async () => {
    const { channel, logs } = await start();
    const service = remoteBackgroundService({
      channel: channel as never,
      name: "ticker",
    });
    const controller = new AbortController();

    const running = service.start(controller.signal);
    await new Promise((r) => setTimeout(r, 20));
    expect(logs).toContain("[plugin:wire] ticker started");

    controller.abort();
    await running;

    expect(logs).toContain("[plugin:wire] ticker stopping");
  });

  // Resolve versus reject is the whole interface the host's runner reads: one
  // means "the service finished", the other means "restart it".
  it("rejects when the service throws", async () => {
    const { channel } = await start();
    const service = remoteBackgroundService({
      channel: channel as never,
      name: "faulty",
    });

    await expect(service.start(new AbortController().signal)).rejects.toThrow(
      /nothing to do/,
    );
  });

  // The one case the runner treats differently, and it needs no special
  // handling here because errors cross by name.
  it("keeps NeedsConfigurationError recognisable on the host", async () => {
    const { channel } = await start();
    const service = remoteBackgroundService({
      channel: channel as never,
      name: "unconfigured",
    });

    const error = await Promise.resolve(
      service.start(new AbortController().signal),
    )
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(isNeedsConfigurationError(error)).toBe(true);
    expect((error as Error).message).toBe("set an API key");
  });

  it("names a service the plugin never registered", async () => {
    const { channel } = await start();
    const service = remoteBackgroundService({
      channel: channel as never,
      name: "ghost",
    });

    await expect(service.start(new AbortController().signal)).rejects.toThrow(
      /no background service "ghost"/,
    );
  });
});
