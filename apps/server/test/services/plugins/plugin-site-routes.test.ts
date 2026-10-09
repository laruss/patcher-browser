import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { permissionsForApiPath } from "@patcher/domain";
import { registerPluginSiteRoutes } from "../../../src/routes/plugin-site-access.js";
import { setPluginApiId } from "../../../src/plugin-api-identity-context.js";
import { setAgentAccessCaller } from "../../../src/agent-access-context.js";
import type { PluginService } from "../../../src/services/plugins/plugin-service.js";

function fixture(identity?: "plugin" | "agent") {
  const app = new Hono(),
    confirm = vi.fn(async () => "https://example.com"),
    revoke = vi.fn(async () => {}),
    pageRpc = vi.fn(async () => ({ ok: true, result: "backend" }));
  app.use("*", async (context, next) => {
    if (identity === "plugin") setPluginApiId(context, "caller");
    if (identity === "agent")
      setAgentAccessCaller(context, {
        grantId: "grant",
        label: "Agent",
        level: "full",
      });
    await next();
  });
  registerPluginSiteRoutes(
    app,
    {
      siteAccess: {
        confirm,
        revoke,
        pageRpc,
        list: () => [],
        cleanup: async () => [],
        contributions: () => ({ scripts: [], styles: [] }),
      },
    } as unknown as PluginService,
    () => null,
  );
  const post = (
    method: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(`/plugins/site-access/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  return { app, confirm, revoke, pageRpc, post };
}
describe("site grant routes", () => {
  it("classifies the whole capability route as never a plugin API", () => {
    for (const path of [
      "/plugins/site-access",
      "/plugins/site-access/confirm",
      "/plugins/site-access/revoke",
      "/plugins/site-access/page-rpc",
      "/plugins/site-access/auth",
    ])
      expect(permissionsForApiPath(path)).toBeNull();
  });
  it.each(["plugin", "agent"] as const)(
    "refuses %s identities before confirmation or page RPC",
    async (identity) => {
      const f = fixture(identity);
      expect(
        (await f.post("confirm", { pluginId: "plugin", tabId: "tab" })).status,
      ).toBe(403);
      expect(
        (
          await f.post("page-rpc", {
            pluginId: "plugin",
            token: "forged",
            method: "m",
            input: "",
          })
        ).status,
      ).toBe(403);
      expect(f.confirm).not.toHaveBeenCalled();
      expect(f.pageRpc).not.toHaveBeenCalled();
    },
  );
  it("rejects a thread request and a POST claiming allow:true", async () => {
    const f = fixture();
    expect(
      (
        await f.post(
          "confirm",
          { pluginId: "plugin", tabId: "tab" },
          { "x-patcher-thread-id": "thread" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.post("confirm", {
          pluginId: "plugin",
          tabId: "tab",
          allow: true,
        })
      ).status,
    ).toBe(400);
    expect(f.confirm).not.toHaveBeenCalled();
  });
  it("lets an app request reach the native confirmation but cannot approve it itself", async () => {
    const f = fixture();
    f.confirm.mockRejectedValueOnce(new Error("Native cancelled"));
    expect(
      (await f.post("confirm", { pluginId: "plugin", tabId: "tab" })).status,
    ).toBe(403);
    expect(f.confirm).toHaveBeenCalledWith("plugin", "tab");
  });
});
