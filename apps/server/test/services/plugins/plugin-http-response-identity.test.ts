import { describe, expect, it, vi } from "vitest";
import { createPluginChannel } from "../../../src/services/plugins/plugin-channel.js";
import {
  BOOTSTRAP_METHOD,
  createPluginChildRuntime,
} from "../../../src/services/plugins/plugin-child-runtime.js";
import { isResponseLike } from "../../../src/services/plugins/plugin-http-message.js";
import { createLinkedPorts } from "../../../src/services/plugins/plugin-ports.js";
import type { JsonValue } from "@patcher/domain";

/**
 * A plugin route's `Response` must be recognised by shape, never by class.
 *
 * `@hono/node-server` replaces `globalThis.Response` with a lightweight class
 * of its own when a server starts listening (`getRequestListener`, unless
 * `overrideGlobalObjects: false`), and it does so more than once — importing
 * the package installs one, `serve()` installs another. After that:
 *
 *     Response.json({}) instanceof Response   // false
 *     new Response("x")  instanceof Response  // true
 *
 * so a plugin answering with `Response.json(...)` was rejected as "not a
 * Response" by a *running* server, while passing every test that had not
 * started one. In the suite it showed up as an intermittent failure that never
 * reproduced alone, because whether a server had started in that worker
 * depended on which files ran first.
 *
 * `vi.stubGlobal` stands in for the swap here, which also gives this file its
 * own worker — the config routes files using it away from `isolate: false`,
 * and a swapped `Response` global must not leak into anyone else's.
 */

/** The class every Response in this file is really built by. */
const NativeResponse = Response;

/** What `@hono/node-server` effectively installs over the global. */
class ForeignResponse {}

describe("recognising a plugin route's Response", () => {
  it("does not depend on the global being the class that built it", () => {
    const answer = NativeResponse.json({ ok: true });
    vi.stubGlobal("Response", ForeignResponse);

    // The hazard itself, asserted so this file fails if the premise ever stops
    // being true rather than quietly testing nothing.
    expect(answer instanceof Response).toBe(false);
    expect(isResponseLike(answer)).toBe(true);

    vi.unstubAllGlobals();
  });

  it("still refuses what is not a response at all", () => {
    expect(isResponseLike({ status: 200 })).toBe(false);
    expect(isResponseLike(undefined)).toBe(false);
    expect(isResponseLike(null)).toBe(false);
    expect(isResponseLike("ok")).toBe(false);
  });

  // The whole path, not just the predicate: a plugin process running a route
  // that answers with a Response built by a class the host no longer has.
  it("carries such a response out of a plugin process", async () => {
    vi.stubGlobal("Response", ForeignResponse);
    try {
      const [hostPort, pluginPort] = createLinkedPorts();
      const channel = createPluginChannel({
        port: hostPort,
        name: "server",
        onRequest: () => null,
        onNotify: () => {},
      });
      createPluginChildRuntime({
        port: pluginPort,
        loadFactory: async () => (patcher) => {
          patcher.http.route("GET", "/echo", () =>
            NativeResponse.json({ who: "мир" }),
          );
        },
      });
      await channel.request({
        method: BOOTSTRAP_METHOD,
        payload: {
          pluginId: "identity",
          permissions: [],
          dataDir: "/nonexistent",
          loopbackBaseUrl: null,
          apiKey: "k",
          serverEntry: "unused",
        } as unknown as JsonValue,
      });

      const answer = (await channel.request({
        method: "http",
        target: "GET /echo",
        payload: {
          method: "GET",
          url: "http://127.0.0.1/api/v1/plugins/identity/http/echo",
          headers: [],
          body: null,
        } as unknown as JsonValue,
      })) as unknown as { status: number; body: string | null };

      expect(answer.status).toBe(200);
      expect(
        JSON.parse(Buffer.from(answer.body ?? "", "base64").toString("utf8")),
      ).toEqual({ who: "мир" });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
