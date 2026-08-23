import type { Hono } from "hono";
import {
  BROWSER_HISTORY_DEFAULT_LIMIT,
  BROWSER_HISTORY_LIMIT_MAX,
} from "@patcher/domain";
import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@patcher/server-contract";
import { ApiError } from "../errors.js";
import {
  clearBrowserHistory,
  deleteBrowserHistoryEntry,
  listBrowserHistory,
  recordBrowserHistoryVisit,
} from "../services/browser/browser-history.js";
import { parseBoundedPositiveOptionalInteger } from "../services/lib/validation.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import type { AppDeps } from "../types.js";

export function registerBrowserHistoryRoutes(
  app: Hono,
  deps: AppDeps,
  pluginService: PluginService,
): void {
  const { get, post, del } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.browserHistory;
  const historyDeps = { ...deps, plugins: pluginService };

  get(routes.list, (context, query) => {
    const limit = parseBoundedPositiveOptionalInteger({
      defaultValue: BROWSER_HISTORY_DEFAULT_LIMIT,
      max: BROWSER_HISTORY_LIMIT_MAX,
      name: "limit",
      value: query.limit,
    });
    return context.json({
      entries: listBrowserHistory(deps, {
        limit,
        ...(query.query === undefined ? {} : { query: query.query }),
        ...(query.scopeId === undefined ? {} : { scopeId: query.scopeId }),
      }),
    });
  });

  post(routes.record, async (context, body) => {
    return context.json({
      entry: await recordBrowserHistoryVisit(historyDeps, body),
    });
  });

  del(routes.remove, (context) => {
    deleteBrowserHistoryEntry(deps, context.req.param("id"));
    return context.json({ ok: true } as const);
  });

  del(routes.clear, (context, body) => {
    return context.json({
      removed: clearBrowserHistory(deps, { scopeId: body.scopeId }),
    });
  });
}
