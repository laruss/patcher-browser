import type { Context, Hono } from "hono";
import { z } from "zod";

import { getAgentAccessCaller } from "../agent-access-context.js";
import { getPluginApiId } from "../plugin-api-identity-context.js";
import { declaresThread } from "./plugin-consent.js";
import type { PluginService } from "../services/plugins/plugin-service.js";

export function registerPluginSiteRoutes(
  app: Hono,
  plugins: PluginService,
  authorize: (
    context: Context,
  ) => { status: 401 | 403 | 415; error: string } | null,
) {
  function problem(context: Context) {
    const denied = authorize(context);
    if (denied) return denied;
    if (
      getPluginApiId(context) !== undefined ||
      getAgentAccessCaller(context) !== undefined ||
      declaresThread(context)
    )
      return {
        status: 403 as const,
        error: "Plugin site access requires the app's own request",
      };
    return null;
  }
  app.get("/plugins/site-access", async (context) => {
    const denied = problem(context);
    if (denied) return context.json({ error: denied.error }, denied.status);
    return context.json({
      cleanup: (await plugins.siteAccess?.cleanup()) ?? [],
      plugins: plugins.siteAccess?.list() ?? [],
      contributions: plugins.siteAccess?.contributions() ?? {
        scripts: [],
        styles: [],
      },
    });
  });
  const confirm = z
    .object({
      pluginId: z.string().min(1).max(128),
      tabId: z.string().min(1).max(128),
    })
    .strict();
  const revoke = z
    .object({
      pluginId: z.string().min(1).max(128),
      origin: z.string().min(1).max(2048),
    })
    .strict();
  for (const method of ["confirm", "revoke"] as const)
    app.post(`/plugins/site-access/${method}`, async (context) => {
      const denied = problem(context);
      if (denied)
        return context.json({ ok: false, error: denied.error }, denied.status);
      const body: unknown = await context.req.json().catch(() => null);
      const parsed =
        method === "confirm" ? confirm.safeParse(body) : revoke.safeParse(body);
      if (!parsed.success)
        return context.json(
          { ok: false, error: "Invalid site access request" },
          400,
        );
      try {
        if (!plugins.siteAccess) throw new Error("Unavailable");
        if ("tabId" in parsed.data)
          await plugins.siteAccess.confirm(
            parsed.data.pluginId,
            parsed.data.tabId,
          );
        else
          await plugins.siteAccess.revoke(
            parsed.data.pluginId,
            parsed.data.origin,
          );
        return context.json({ ok: true });
      } catch {
        return context.json(
          { ok: false, error: "Site access was refused or cancelled" },
          403,
        );
      }
    });
  app.post("/plugins/site-access/auth", async (context) => {
    const denied = problem(context);
    if (denied)
      return context.json({ ok: false, error: denied.error }, denied.status);
    const parsed = z
      .object({
        tabId: z.string().min(1).max(128),
        host: z.string().min(1).max(4096),
        insecure: z.boolean(),
        id: z.string().min(1).max(128),
      })
      .strict()
      .safeParse(await context.req.json().catch(() => null));
    if (!parsed.success)
      return context.json(
        { ok: false, error: "Invalid native auth challenge" },
        400,
      );
    const { id, ...challenge } = parsed.data;
    const credentials = await plugins.resolveBrowserAuth({
      challenge,
      runtimePromptId: id,
    });
    return context.json({ ok: true, credentials });
  });
  const pageCall = z
    .object({
      pluginId: z.string().min(1).max(128),
      token: z.uuid(),
      method: z.string().min(1).max(256),
      input: z.string().max(65536),
    })
    .strict();
  app.post("/plugins/site-access/page-rpc", async (context) => {
    const denied = problem(context);
    if (denied)
      return context.json({ ok: false, error: denied.error }, denied.status);
    const parsed = pageCall.safeParse(
      await context.req.json().catch(() => null),
    );
    if (!parsed.success)
      return context.json(
        { ok: false, error: "Invalid runtime page RPC" },
        400,
      );
    const { pluginId, token, method, input } = parsed.data;
    try {
      if (!plugins.siteAccess) throw new Error("Unavailable");
      const value: unknown = input === "" ? undefined : JSON.parse(input);
      const outcome = await plugins.siteAccess.pageRpc(
        pluginId,
        token,
        method,
        input,
        async () => {
          const lookup = plugins.getRpcHandler(pluginId, method);
          if (lookup.outcome !== "found")
            throw new Error("Unavailable handler");
          return plugins.invokeRpcHandler(
            pluginId,
            method,
            lookup.value,
            value,
          );
        },
      );
      if (!outcome.ok)
        return context.json(
          { ok: false, error: "Runtime page RPC failed" },
          400,
        );
      const result =
        outcome.result === undefined ? "" : JSON.stringify(outcome.result);
      if (result.length > 65536) throw new Error("Oversized reply");
      return context.json({ ok: true, result });
    } catch {
      return context.json(
        { ok: false, error: "Runtime page RPC refused" },
        403,
      );
    }
  });
}
