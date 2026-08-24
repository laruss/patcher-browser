import { pluginCatalogInstallRequestSchema } from "@patcher/server-contract";
import type { Hono } from "hono";
import type { PluginCatalogService } from "../services/plugin-catalog/plugin-catalog-service.js";
import {
  requirePluginConsent,
  type PluginConsentDeps,
} from "./plugin-consent.js";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function registerPluginCatalogRoutes(
  app: Hono,
  catalog: PluginCatalogService,
  deps: PluginConsentDeps,
): void {
  app.get("/plugin-catalog", (context) =>
    context.json({ catalog: catalog.status() }),
  );

  app.get("/plugin-catalog/search", async (context) =>
    context.json({
      results: await catalog.search(context.req.query("q") ?? ""),
    }),
  );

  app.post("/plugin-catalog/install", async (context) => {
    const json: unknown = await context.req.json().catch(() => null);
    const body = pluginCatalogInstallRequestSchema.safeParse(json);
    if (!body.success) {
      return context.json({ error: 'expected { "entryId": string }' }, 422);
    }
    // The store is a second door to the same room: installing from it runs
    // full-trust code in the server, exactly as `plugins/install` does.
    const consent = await requirePluginConsent({
      action: "install",
      context,
      deps,
      subjectId: body.data.entryId,
      detail:
        "A plugin's backend is full-trust code inside the server. What it declares is not known until it is installed.",
    });
    if (!consent.allowed) {
      return context.json({ error: consent.error }, consent.status);
    }
    try {
      return context.json({
        ok: true as const,
        plugin: await catalog.install(body.data.entryId),
      });
    } catch (error) {
      return context.json({ error: message(error) }, 422);
    }
  });
}
