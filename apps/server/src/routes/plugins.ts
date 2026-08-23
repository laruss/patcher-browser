import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { brotliCompress, constants as zlibConstants, gzip } from "node:zlib";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { ServerRuntimeConfig } from "../types.js";
import {
  browserRequestProblem,
  type BrowserRequestProblem,
} from "../browser-request-guard.js";
import type {
  PluginService,
  PluginWireLookup,
} from "../services/plugins/plugin-service.js";
import type { PluginMentionTrigger } from "../services/plugins/plugin-api.js";
import { PluginSettingsValidationError } from "../services/plugins/plugin-settings.js";
import {
  createAppAssetCompressionCache,
  type AppAssetCompressionCache,
} from "../services/plugins/app-asset-compression-cache.js";
import { rankAcceptedAssetEncodings } from "../asset-content-encoding.js";

/**
 * A finished download, as the app reports it.
 *
 * Every string here originated with a page — a filename from
 * `Content-Disposition`, a URL, a media type — so each is capped rather than
 * trusted. The caps are stated locally rather than imported from the desktop
 * contract: the server does not depend on the desktop boundary, and this route
 * has to defend itself against any caller, not only against our own shell.
 */
/**
 * A picked context-menu entry. Everything but the ids came from the page, so
 * each field is capped rather than trusted.
 */
const pluginContextMenuInvokeSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    itemId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
    pageUrl: z.string().max(4096),
    linkUrl: z.string().max(4096).nullable(),
    imageUrl: z.string().max(4096).nullable(),
    selectionText: z.string().max(4096).nullable(),
  })
  .strict();

/**
 * The host of a page whose site info was asked for. Derived here rather than
 * taken from the client: the app already has it, but a route that trusts a
 * caller's idea of which host a URL belongs to hands plugins a mismatched pair.
 */
function pluginSiteInfoHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/**
 * A picked tab-menu entry. The URL and title came from a page, so both are
 * capped; a null url is a Patcher screen rather than a web page, which is what tells
 * an action the two kinds apart.
 */
const pluginTabActionInvokeSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    itemId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
    url: z.string().max(4096).nullable(),
    title: z.string().max(1024).nullable(),
    pinned: z.boolean(),
    muted: z.boolean(),
    active: z.boolean(),
  })
  .strict();

/**
 * A pressed toolbar control. Unlike a tab action, the url is not nullable: the
 * toolbar is not drawn over Patcher's own screens, so a press without a page is a
 * client that has invented one.
 */
const pluginToolbarInvokeSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    itemId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
    url: z.string().min(1).max(4096),
    title: z.string().max(1024).nullable(),
  })
  .strict();

/**
 * A plugin command whose chord fired. Nothing but the two ids: the command is
 * handed no context, so there is nothing else for a caller to get wrong.
 */
const pluginCommandInvokeSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    commandId: z.string().min(1).max(128),
  })
  .strict();

/**
 * A pressed find-bar button. The query is what the user typed and the page URL
 * is the page's own, so both are capped rather than trusted; the cap on the
 * query matches the find bar's own.
 */
const pluginFindActionInvokeSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    itemId: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
    pageUrl: z.string().max(4096),
    query: z.string().min(1).max(256),
  })
  .strict();

/**
 * An authentication challenge a browsed page hit. The host is the shell's own
 * formatting of what the server asked as, and is capped like the rest.
 */
const pluginBrowserAuthChallengeSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    host: z.string().min(1).max(1024),
    insecure: z.boolean(),
  })
  .strict();

/**
 * A PDF the browser could not read as text. The URL and title are the page's
 * own, so both are capped rather than trusted.
 */
const pluginBrowserPdfDocumentSchema = z
  .object({
    tabId: z.string().min(1).max(256),
    pageUrl: z.string().max(4096),
    title: z.string().max(1024).nullable(),
  })
  .strict();

/**
 * A link the system handed Patcher because it is the user's default browser. Capped
 * like the rest, and validated as its own schema rather than borrowed from the
 * desktop contract: the server does not depend on that boundary, and the route
 * has to defend itself against any caller.
 */
const pluginBrowserExternalLinkSchema = z
  .object({
    // `http(s)` only, the way the shell's own queue is. Handlers are promised a
    // page (`PluginBrowserExternalLink`), and this route is where that promise
    // has to be kept: the shell is not the only thing that can reach it.
    url: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => {
        try {
          const { protocol } = new URL(value);
          return protocol === "http:" || protocol === "https:";
        } catch {
          return false;
        }
      }),
  })
  .strict();

const pluginBrowserDownloadSchema = z
  .object({
    id: z.string().min(1).max(128),
    tabId: z.string().min(1).max(256),
    filename: z.string().min(1).max(4096),
    savePath: z.string().min(1).max(4096).nullable(),
    url: z.string().max(4096),
    mimeType: z.string().max(255),
    state: z.enum(["completed", "cancelled", "interrupted", "refused"]),
  })
  .strict();
import {
  pluginApplyUpdateRequestSchema,
  pluginInstallRequestSchema,
  pluginSettingsUpdateRequestSchema,
  pluginTokenRequestSchema,
  pluginUpdateCheckRequestSchema,
} from "@patcher/server-contract";

/** The slice of server deps the "local" auth checks need (origin allowlist). */
export interface PluginRoutesDeps {
  config: Pick<ServerRuntimeConfig, "serverPort" | "appUrl" | "devAppPort">;
  db: import("@patcher/db").DbConnection;
}

type WireAuthProblem = BrowserRequestProblem | { status: 401; error: string };

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const MIN_COMPRESSED_APP_ASSET_BYTES = 1_024;
const MAX_CACHED_APP_ASSETS = 64;
const APP_ASSET_ENCODINGS = [
  {
    encoding: "br",
    compress: (bytes: Buffer) =>
      compressBrotli(bytes, {
        params: {
          // Compression happens in the request path, so use a moderate level
          // rather than the slower quality 10 used for build-time sidecars.
          [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
        },
      }),
  },
  {
    encoding: "gzip",
    compress: (bytes: Buffer) => compressGzip(bytes),
  },
] as const;

async function appAssetResponse(
  context: Context,
  bytes: Buffer,
  args: {
    assetKey: string;
    cache: AppAssetCompressionCache;
    cacheControl: string;
    contentHash: string;
    contentType: string;
  },
): Promise<Response> {
  const responseHeaders: Record<string, string> = {
    "cache-control": args.cacheControl,
    "content-length": String(bytes.length),
    "content-type": args.contentType,
  };
  if (bytes.length < MIN_COMPRESSED_APP_ASSET_BYTES) {
    return context.body(new Uint8Array(bytes), 200, responseHeaders);
  }

  responseHeaders.vary = "Accept-Encoding";
  const candidate = rankAcceptedAssetEncodings(
    context.req.header("accept-encoding"),
    APP_ASSET_ENCODINGS,
  )[0];
  if (candidate === undefined) {
    return context.body(new Uint8Array(bytes), 200, responseHeaders);
  }

  const compressed = await args.cache.getOrCreate({
    assetKey: args.assetKey,
    compress: () => candidate.compress(bytes),
    encoding: candidate.encoding,
    hash: args.contentHash,
  });
  responseHeaders["content-encoding"] = candidate.encoding;
  responseHeaders["content-length"] = String(compressed.length);
  return context.body(new Uint8Array(compressed), 200, responseHeaders);
}

function parsePluginMentionTrigger(
  value: string | undefined,
): PluginMentionTrigger | null {
  if (value === undefined) {
    return "@";
  }
  switch (value) {
    case "@":
    case "#":
    case "$":
    case "!":
    case "~":
      return value;
    default:
      return null;
  }
}

/**
 * "local" auth (design §4.6): the request must come from the Patcher app itself.
 * The load-bearing CSRF defense is the JSON-only rule below — a cross-origin
 * JSON POST always triggers a CORS preflight, which the server's allowlist
 * denies. The shared Origin check also tolerates Patcher being served over
 * LAN/Tailscale addresses the server cannot enumerate, but only when the
 * origin hostname is bound to the request hostname.
 */
function localAuthProblem(
  context: Context,
  deps: PluginRoutesDeps,
): WireAuthProblem | null {
  return browserRequestProblem(context, deps, {
    requireJsonForMutation: true,
  });
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/** "token" auth: x-patcher-plugin-token header or ?token= must match the plugin's secret. */
async function tokenAuthProblem(
  context: Context,
  plugins: PluginService,
  id: string,
): Promise<WireAuthProblem | null> {
  const presented =
    context.req.header("x-patcher-plugin-token") ?? context.req.query("token");
  const expected = await plugins.httpToken(id);
  if (
    expected === undefined ||
    presented === undefined ||
    !timingSafeEqualStrings(presented, expected)
  ) {
    return {
      status: 401,
      error:
        'missing or invalid plugin token — send it as the "x-patcher-plugin-token" header ' +
        "or ?token=; print it with `patcher plugin token " +
        `${id}\``,
    };
  }
  return null;
}

function notRunningError(
  id: string,
  lookup: Extract<PluginWireLookup<unknown>, { outcome: "not-running" }>,
): string {
  const detail = lookup.detail ? ` — ${lookup.detail}` : "";
  return `plugin "${id}" is not running (status: ${lookup.status}${detail})`;
}

/**
 * Plugin management routes plus the boot-time wire dispatchers
 * (/plugins/:id/http/* and /plugins/:id/rpc/:method). Mounted under /api/v1
 * before the catch-all; dispatch goes through the plugin service's live
 * routing tables so reload swaps handlers without re-registering Hono routes.
 * This surface is server-policy glue, not part of the typed product contract.
 */
export function registerPluginRoutes(
  app: Hono,
  deps: PluginRoutesDeps,
  plugins: PluginService,
): void {
  const appAssetCompressionCache = createAppAssetCompressionCache(
    MAX_CACHED_APP_ASSETS,
  );

  app.get("/plugins", (context) => context.json({ plugins: plugins.list() }));

  // Fast metadata for the Patcher CLI's help/proxy path and the app's
  // host-rendered UI contributions: no plugin code runs; empty (not an
  // error) while the experiment is off.
  app.get("/plugins/contributions", (context) =>
    context.json({
      cliCommands: plugins.listCliContributions(),
      mentionProviders: plugins.listMentionProviderContributions(),
      omniboxProviders: plugins.listOmniboxProviderContributions(),
      browserContextMenuItems: plugins.listContextMenuItemContributions(),
      browserFindActions: plugins.listFindActionContributions(),
      browserTabActions: plugins.listTabActionContributions(),
      browserToolbarItems: plugins.listToolbarItemContributions(),
      browserNewTabWidgets: plugins.listNewTabWidgetContributions(),
      commands: plugins.listCommandContributions(),
      browserSearchEngines: plugins.listSearchEngineContributions(),
      browserPageStyles: plugins.listPageStyleContributions(),
      browserPageScripts: plugins.listPageScriptContributions(),
    }),
  );

  // Composer mention search across every plugin provider for one trigger
  // (design §4.9). Executes plugin code, so it takes the same local-origin
  // guard as the rpc dispatcher. Registered before the /plugins/:id/*
  // routes so the static "mentions" segment cannot be captured as an id.
  app.get("/plugins/mentions/search", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const query = (context.req.query("q") ?? "").trim();
    if (query.length === 0) {
      return context.json({ ok: true, groups: [] });
    }
    const projectId = context.req.query("projectId") ?? null;
    const threadId = context.req.query("threadId") ?? null;
    const trigger = parsePluginMentionTrigger(context.req.query("trigger"));
    if (trigger === null) {
      return context.json(
        {
          ok: false,
          error: `invalid plugin mention trigger ${JSON.stringify(context.req.query("trigger"))}`,
        },
        400,
      );
    }
    const groups = await plugins.searchMentions({
      trigger,
      query,
      projectId: projectId !== null && projectId.length > 0 ? projectId : null,
      threadId: threadId !== null && threadId.length > 0 ? threadId : null,
    });
    return context.json({ ok: true, groups });
  });

  // Browser omnibox suggestions across every plugin provider
  // (`browser.omnibox.providers`). Executes plugin code, so it takes the same
  // local-origin guard as the rpc dispatcher, and is registered before the
  // /plugins/:id/* routes so the static "omnibox" segment cannot be captured
  // as an id.
  app.get("/plugins/omnibox/suggest", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const query = (context.req.query("q") ?? "").trim();
    if (query.length === 0) {
      return context.json({ ok: true, groups: [] });
    }
    return context.json({
      ok: true,
      groups: await plugins.suggestOmnibox({ query }),
    });
  });

  // Perform a picked `{ type: "run" }` omnibox suggestion. A POST because it
  // runs the plugin's action; the response carries an optional url for the
  // browser to open afterwards.
  app.post("/plugins/omnibox/run", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const body = (await context.req.json().catch(() => null)) as {
      itemId?: unknown;
      pluginId?: unknown;
      query?: unknown;
    } | null;
    const pluginId = body?.pluginId;
    const itemId = body?.itemId;
    const query = body?.query;
    if (
      typeof pluginId !== "string" ||
      pluginId.length === 0 ||
      typeof itemId !== "string" ||
      itemId.length === 0 ||
      typeof query !== "string"
    ) {
      return context.json(
        {
          ok: false,
          error: "expected { pluginId: string, itemId: string, query: string }",
        },
        400,
      );
    }
    const outcome = await plugins.runOmniboxAction({ itemId, pluginId, query });
    if (!outcome.ok) {
      return context.json({ ok: false, error: outcome.error }, 422);
    }
    return context.json({ ok: true, navigate: outcome.navigate });
  });

  // A plugin context-menu entry the user picked. Executes plugin code, so it
  // takes the same local-origin guard; registered before /plugins/:id/* so
  // "browser" cannot be captured as a plugin id.
  app.post("/plugins/browser/context-menu", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = pluginContextMenuInvokeSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          ok: false,
          error:
            "expected { pluginId, itemId, tabId, pageUrl, linkUrl, imageUrl, selectionText }",
        },
        400,
      );
    }
    const { itemId, pluginId, ...menuContext } = parsed.data;
    const outcome = await plugins.runContextMenuItem({
      context: menuContext,
      itemId,
      pluginId,
    });
    return outcome.ok
      ? context.json({ ok: true })
      : context.json({ ok: false, error: outcome.error }, 422);
  });

  // What plugins know about the site whose padlock the user clicked. A GET like
  // omnibox suggest — it reads rather than acts — but it does run plugin code, so
  // it takes the same local-origin guard, and the same ordering rule keeps
  // "browser" from being captured as a plugin id.
  app.get("/plugins/browser/site-info", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const tabId = (context.req.query("tabId") ?? "").trim();
    const url = (context.req.query("url") ?? "").trim();
    // A tab with no page has no site to describe, and nothing is asked about it.
    if (tabId.length === 0 || url.length === 0 || url.length > 4096) {
      return context.json({ ok: true, sections: [] });
    }
    return context.json({
      ok: true,
      sections: await plugins.describeSiteInfo({
        context: { tabId, url, host: pluginSiteInfoHost(url) },
      }),
    });
  });

  // A plugin entry the user picked on a browser tab's context menu. Same guard,
  // same ordering rule and the same fire-and-forget contract as the
  // context-menu route above.
  app.post("/plugins/browser/tab-action", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = pluginTabActionInvokeSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          ok: false,
          error:
            "expected { pluginId, itemId, tabId, url, title, pinned, muted, active }",
        },
        400,
      );
    }
    const { itemId, pluginId, ...tabContext } = parsed.data;
    const outcome = await plugins.runTabAction({
      context: tabContext,
      itemId,
      pluginId,
    });
    return outcome.ok
      ? context.json({ ok: true })
      : context.json({ ok: false, error: outcome.error }, 422);
  });

  // What plugins' toolbar controls look like for the page in a tab. A GET like
  // site-info, and the same guard — but asked as the user navigates rather than
  // when they open something, which is why the app only asks at all when a
  // control declared a `state` (`hasState` on the contribution).
  app.get("/plugins/browser/toolbar-state", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const tabId = (context.req.query("tabId") ?? "").trim();
    const url = (context.req.query("url") ?? "").trim();
    const title = context.req.query("title") ?? null;
    // A tab with no page has nothing for a control to be about.
    if (tabId.length === 0 || url.length === 0 || url.length > 4096) {
      return context.json({ ok: true, states: [] });
    }
    return context.json({
      ok: true,
      states: await plugins.describeToolbarItemStates({
        context: {
          tabId,
          url,
          title: title === null ? null : title.slice(0, 1024),
        },
      }),
    });
  });

  // A plugin's toolbar control the user pressed. Same guard and ordering rule as
  // the context-menu route; the answer is awaited (unlike a menu entry's) only
  // so the app knows when to ask for states again — a control that toggles
  // something has to stop looking like it did before the press.
  app.post("/plugins/browser/toolbar-item", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = pluginToolbarInvokeSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          ok: false,
          error: "expected { pluginId, itemId, tabId, url, title }",
        },
        400,
      );
    }
    const { itemId, pluginId, ...toolbarContext } = parsed.data;
    const outcome = await plugins.runToolbarItem({
      context: toolbarContext,
      itemId,
      pluginId,
    });
    return outcome.ok
      ? context.json({ ok: true })
      : context.json({ ok: false, error: outcome.error }, 422);
  });

  // What plugins want to show on a new tab. A GET like site-info, same guard, and
  // asked when a new-tab screen appears rather than on a schedule — a widget that
  // does real work is not asked while nobody is looking at an empty tab.
  app.get("/plugins/browser/new-tab", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const tabId = (context.req.query("tabId") ?? "").trim();
    if (tabId.length === 0) {
      return context.json({ ok: true, sections: [] });
    }
    return context.json({
      ok: true,
      sections: await plugins.describeNewTabSections({ context: { tabId } }),
    });
  });

  // A plugin command whose chord the user pressed. Same guard and ordering rule
  // as the context-menu route; fire-and-forget like one, because a keypress has
  // already happened and there is nothing to report back to.
  app.post("/plugins/commands/run", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = pluginCommandInvokeSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        { ok: false, error: "expected { pluginId, commandId }" },
        400,
      );
    }
    const outcome = await plugins.runCommand(parsed.data);
    return outcome.ok
      ? context.json({ ok: true })
      : context.json({ ok: false, error: outcome.error }, 422);
  });

  // A plugin button pressed on the browser's find bar. Same guard and same
  // ordering rule as the context-menu route above, and the same fire-and-forget
  // contract: the bar has already moved on.
  app.post("/plugins/browser/find-action", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = pluginFindActionInvokeSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          ok: false,
          error: "expected { pluginId, itemId, tabId, pageUrl, query }",
        },
        400,
      );
    }
    const { itemId, pluginId, ...findContext } = parsed.data;
    const outcome = await plugins.runFindAction({
      context: findContext,
      itemId,
      pluginId,
    });
    return outcome.ok
      ? context.json({ ok: true })
      : context.json({ ok: false, error: outcome.error }, 422);
  });

  // Credentials for a page the browser could not open, asked of every plugin
  // that registered a provider (`browser.auth.providers`) before the user is.
  //
  // This is the one plugin route whose *response* is a credential, so it takes
  // the same local-origin guard as the rest and says nothing about which plugin
  // answered: the caller needs the login, not its provenance.
  app.post("/plugins/browser/auth", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = pluginBrowserAuthChallengeSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        { ok: false, error: "expected { tabId, host, insecure }" },
        400,
      );
    }
    const credentials = await plugins.resolveBrowserAuth({
      challenge: parsed.data,
    });
    return context.json({ ok: true, credentials });
  });

  // A PDF the browser opened, parsed, and found no text in
  // (`browser.pdf.textProviders`). Executes plugin code, so it takes the same
  // local-origin guard as the rest.
  //
  // The browser asks only after its own read came back empty, so an empty
  // answer here changes nothing: the agent is told the document has no text
  // layer either way.
  app.post("/plugins/browser/pdf-text", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = pluginBrowserPdfDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        { ok: false, error: "expected { tabId, pageUrl, title }" },
        400,
      );
    }
    const text = await plugins.resolveBrowserPdfText({
      document: parsed.data,
    });
    return context.json({ ok: true, text: text ?? "" });
  });

  // A link another app asked macOS to open, offered to every plugin that
  // registered a handler (`browser.externalLink.handlers`) before it becomes a
  // tab. Executes plugin code, so it takes the same local-origin guard as the
  // rest.
  //
  // The app asks and waits, unlike the download route below: this decides where
  // the link goes, and nothing has happened yet. A failure here is a decline —
  // the link opens in a tab, which is what it does with no plugins at all.
  app.post("/plugins/browser/external-link", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = pluginBrowserExternalLinkSchema.safeParse(body);
    if (!parsed.success) {
      return context.json({ ok: false, error: "expected { url }" }, 400);
    }
    const decision = await plugins.resolveBrowserExternalLink({
      link: parsed.data,
    });
    return context.json({ ok: true, decision });
  });

  // A download the browser finished, handed to every plugin that registered a
  // handler (`browser.downloads.handlers`). Executes plugin code, so it takes
  // the same local-origin guard as the rest, and is registered before the
  // /plugins/:id/* routes so "browser" cannot be captured as a plugin id.
  //
  // The app reports; it does not ask. Patcher has already written the file and told
  // the user, so a failure here costs the hand-over and nothing else — which is
  // why the response says how many handlers ran rather than what they did.
  app.post("/plugins/browser/downloads", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const body = await context.req.json().catch(() => null);
    const parsed = pluginBrowserDownloadSchema.safeParse(body);
    if (!parsed.success) {
      return context.json(
        {
          ok: false,
          error:
            "expected { id, tabId, filename, savePath, url, mimeType, state }",
        },
        400,
      );
    }
    const { handlerCount } = await plugins.reportBrowserDownload(parsed.data);
    return context.json({ ok: true, handlerCount });
  });

  // Proxied `patcher <plugin-command>` / `patcher plugin run` invocation (design §4.4).
  // Dispatch problems come back as { exitCode: 1, stderr } rather than HTTP
  // errors so the CLI can uniformly print stderr and exit with exitCode.
  app.post("/plugins/:id/cli", async (context) => {
    // Same local-origin/CSRF guard as the rpc dispatcher: this route executes
    // plugin code with full server capabilities, so a cross-origin simple
    // POST must not reach it. The Patcher CLI sends application/json from
    // loopback, which passes.
    const authProblem = localAuthProblem(context, deps);
    if (authProblem) {
      return context.json(
        { ok: false, error: authProblem.error },
        authProblem.status,
      );
    }
    const body = (await context.req.json().catch(() => null)) as {
      argv?: unknown;
      cwd?: unknown;
      threadId?: unknown;
      projectId?: unknown;
    } | null;
    const argv = body?.argv;
    if (!isStringArray(argv)) {
      return context.json(
        { ok: false, error: "expected { argv: string[] }" },
        400,
      );
    }
    const ctx: {
      cwd?: string;
      threadId?: string;
      projectId?: string;
      signal?: AbortSignal;
    } = {};
    if (typeof body?.cwd === "string") ctx.cwd = body.cwd;
    if (typeof body?.threadId === "string") ctx.threadId = body.threadId;
    if (typeof body?.projectId === "string") ctx.projectId = body.projectId;
    ctx.signal = context.req.raw.signal;
    const result = await plugins.runCliCommand(
      context.req.param("id"),
      argv,
      ctx,
    );
    return context.json(result);
  });

  // Frontend bundle assets (design §5.1): the app dynamic-import()s app.js
  // and links app.css from here. URLs carry ?h=<content hash> — a matching
  // hash gets immutable caching (the hash changes when the content does);
  // anything else is no-store so a stale URL can never pin a stale bundle.
  const APP_ASSET_CONTENT_TYPES = {
    "app.js": { kind: "js", contentType: "text/javascript; charset=utf-8" },
    "app.css": { kind: "css", contentType: "text/css; charset=utf-8" },
  } as const;

  app.get("/plugins/:id/assets/:file", async (context) => {
    const file = context.req.param("file");
    // Explicit plugin branding assets: same hash-busting cache policy as the
    // bundle assets, but identity-backed so disabled plugins remain legible.
    if (file === "icon" || file === "logo" || file === "logo-dark") {
      const asset = plugins.getBrandingAsset(context.req.param("id"), file);
      if (!asset) {
        return context.json(
          { ok: false, error: "plugin has no requested branding asset" },
          404,
        );
      }
      const cacheControl =
        context.req.query("h") === asset.hash
          ? "public, max-age=31536000, immutable"
          : "no-store";
      return context.body(new Uint8Array(asset.bytes), 200, {
        "content-type": asset.contentType,
        "cache-control": cacheControl,
      });
    }
    const spec =
      file === "app.js" || file === "app.css"
        ? APP_ASSET_CONTENT_TYPES[file]
        : undefined;
    if (!spec) {
      return context.json({ ok: false, error: "unknown plugin asset" }, 404);
    }
    const asset = plugins.getAppAsset(context.req.param("id"), spec.kind);
    if (!asset) {
      return context.json(
        { ok: false, error: "plugin has no loadable frontend bundle" },
        404,
      );
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(asset.path);
    } catch {
      return context.json({ ok: false, error: "bundle file missing" }, 404);
    }
    const cacheControl =
      context.req.query("h") === asset.hash
        ? "public, max-age=31536000, immutable"
        : "no-store";
    return appAssetResponse(context, bytes, {
      assetKey: `${context.req.param("id")}:${spec.kind}`,
      cache: appAssetCompressionCache,
      contentType: spec.contentType,
      cacheControl,
      contentHash: asset.hash,
    });
  });

  app.get("/plugins/:id/logs", async (context) => {
    const rawTail = Number(context.req.query("tail") ?? "100");
    const tail = Number.isFinite(rawTail)
      ? Math.min(Math.max(Math.trunc(rawTail), 1), 10_000)
      : 100;
    const lines = await plugins.readLogTail(context.req.param("id"), tail);
    if (lines === undefined) {
      return context.json({ ok: false, error: "unknown plugin" }, 404);
    }
    return context.json({ ok: true, lines });
  });

  app.post("/plugins/updates/check", async (context) => {
    const json: unknown = await context.req.json().catch(() => null);
    const body = pluginUpdateCheckRequestSchema.safeParse(json);
    if (!body.success) {
      return context.json({ error: 'expected { "id"?: string }' }, 400);
    }
    try {
      const results = await plugins.checkForUpdates(body.data.id);
      return context.json({ results });
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        422,
      );
    }
  });

  app.get("/plugins/updates", (context) => {
    try {
      return context.json({ results: plugins.listUpdateResults() });
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        422,
      );
    }
  });

  app.post("/plugins/:id/update", async (context) => {
    const json: unknown = await context.req.json().catch(() => null);
    const body = pluginApplyUpdateRequestSchema.safeParse(json);
    if (!body.success) {
      return context.json({ error: "expected an empty JSON object" }, 400);
    }
    try {
      const outcome = await plugins.applyUpdate(context.req.param("id"));
      if (!outcome.ok) return context.json({ error: outcome.error }, 422);
      return context.json(outcome.result);
    } catch (error) {
      return context.json(
        { error: error instanceof Error ? error.message : String(error) },
        422,
      );
    }
  });

  app.post("/plugins/install", async (context) => {
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    const json: unknown = await context.req.json().catch(() => null);
    const parsed = pluginInstallRequestSchema.safeParse(json);
    if (!parsed.success) {
      return context.json(
        {
          ok: false,
          error: 'expected { "source": string }',
        },
        422,
      );
    }
    try {
      const plugin = await plugins.install(parsed.data.source);
      return context.json({ ok: true, plugin });
    } catch (error) {
      return context.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        },
        422,
      );
    }
  });

  app.get("/plugins/:id/source", async (context) => {
    const source = await plugins.getSource(context.req.param("id"));
    if (source === undefined) {
      return context.json({ error: "unknown plugin" }, 404);
    }
    return context.json(source);
  });

  app.post("/plugins/reload", async (context) => {
    const id = context.req.query("id") ?? undefined;
    await plugins.reload(id);
    return context.json({ ok: true, plugins: plugins.list() });
  });

  app.post("/plugins/:id/enable", async (context) => {
    const plugin = await plugins.setEnabled(context.req.param("id"), true);
    if (!plugin)
      return context.json({ ok: false, error: "unknown plugin" }, 404);
    return context.json({ ok: true, plugin });
  });

  app.post("/plugins/:id/disable", async (context) => {
    const plugin = await plugins.setEnabled(context.req.param("id"), false);
    if (!plugin)
      return context.json({ ok: false, error: "unknown plugin" }, 404);
    return context.json({ ok: true, plugin });
  });

  const NOT_RUNNING = {
    ok: false as const,
    error:
      "unknown plugin, or plugin is not running — settings exist once its factory has run",
  };

  app.get("/plugins/:id/settings", async (context) => {
    const view = await plugins.getSettings(context.req.param("id"));
    if (!view) return context.json(NOT_RUNNING, 404);
    return context.json({ ok: true, ...view });
  });

  app.put("/plugins/:id/settings", async (context) => {
    const json: unknown = await context.req.json().catch(() => null);
    const body = pluginSettingsUpdateRequestSchema.safeParse(json);
    if (!body.success) {
      return context.json(
        { ok: false, error: "expected { values: Record<string, unknown> }" },
        400,
      );
    }
    try {
      const view = await plugins.updateSettings(
        context.req.param("id"),
        body.data.values,
      );
      if (!view) return context.json(NOT_RUNNING, 404);
      return context.json({ ok: true, ...view });
    } catch (error) {
      if (error instanceof PluginSettingsValidationError) {
        return context.json({ ok: false, error: error.message }, 400);
      }
      throw error;
    }
  });

  app.delete("/plugins/:id", async (context) => {
    const id = context.req.param("id");
    if (plugins.isBuiltin(id)) {
      return context.json(
        {
          ok: false,
          error: "Built-in plugins can be disabled, but not deleted.",
        },
        409,
      );
    }
    const removed = await plugins.remove(id);
    if (!removed)
      return context.json({ ok: false, error: "unknown plugin" }, 404);
    return context.json({ ok: true });
  });

  app.post("/plugins/:id/token", async (context) => {
    const rawBody = await context.req.text();
    let json: unknown = {};
    if (rawBody.trim() !== "") {
      try {
        json = JSON.parse(rawBody);
      } catch {
        json = null;
      }
    }
    const body = pluginTokenRequestSchema.safeParse(json);
    if (!body.success) {
      return context.json(
        { ok: false, error: "expected { rotate?: boolean }" },
        400,
      );
    }
    const token = await plugins.httpToken(context.req.param("id"), {
      rotate: body.data.rotate,
    });
    if (token === undefined) {
      return context.json({ ok: false, error: "unknown plugin" }, 404);
    }
    return context.json({ ok: true, token });
  });

  // Boot-time dispatcher for patcher.http routes (design §4.6): Hono routes
  // cannot be added or removed after boot, so one wildcard route dispatches
  // through the live per-plugin route table (exact method+path match).
  app.all("/plugins/:id/http/*", async (context) => {
    const id = context.req.param("id");
    const prefix = `/api/v1/plugins/${id}/http`;
    const requestPath = context.req.path;
    const subPath = requestPath.startsWith(prefix)
      ? requestPath.slice(prefix.length) || "/"
      : "/";
    const lookup = plugins.getHttpRoute(id, context.req.method, subPath);
    if (lookup.outcome === "unknown-plugin") {
      return context.json({ ok: false, error: `unknown plugin "${id}"` }, 404);
    }
    if (lookup.outcome === "not-running") {
      return context.json(
        { ok: false, error: notRunningError(id, lookup) },
        503,
      );
    }
    if (lookup.outcome === "not-found") {
      return context.json(
        {
          ok: false,
          error: `plugin "${id}" has no ${context.req.method} route for "${subPath}"`,
        },
        404,
      );
    }
    const auth = lookup.value.auth;
    const problem =
      auth === "local"
        ? localAuthProblem(context, deps)
        : auth === "token"
          ? await tokenAuthProblem(context, plugins, id)
          : null;
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    // The token check awaited; a reload may have swapped the routing table
    // in the meantime. Re-resolve and invoke with no await in between
    // (invokeHttpRoute registers its in-flight marker synchronously) so a
    // stale handler can never run over a disposed plugin's handles. A route
    // whose auth mode changed across the reload was authenticated under the
    // old policy — refuse it rather than honoring the wrong check.
    const fresh = plugins.getHttpRoute(id, context.req.method, subPath);
    if (fresh.outcome !== "found" || fresh.value.auth !== auth) {
      return context.json(
        {
          ok: false,
          error: `plugin "${id}" reloaded during the request — retry`,
        },
        503,
      );
    }
    return plugins.invokeHttpRoute(id, fresh.value, context);
  });

  // patcher.rpc dispatcher (design §4.6): always "local" auth semantics —
  // JSON-only body plus the Origin/Host check.
  app.post("/plugins/:id/rpc/:method", async (context) => {
    const id = context.req.param("id");
    const method = context.req.param("method");
    const problem = localAuthProblem(context, deps);
    if (problem) {
      return context.json({ ok: false, error: problem.error }, problem.status);
    }
    // Body first, handler second: the handler must be resolved with no await
    // between lookup and invocation (invokeRpcHandler registers its in-flight
    // marker synchronously), or a reload during the body read could dispose
    // the plugin after lookup and run a stale handler over closed handles.
    const rawBody = await context.req.text();
    let input: unknown;
    if (rawBody.length > 0) {
      try {
        input = JSON.parse(rawBody);
      } catch {
        return context.json(
          {
            ok: false,
            error: {
              code: "invalid_json",
              message: "request body must be JSON (the rpc input)",
            },
          },
          400,
        );
      }
    }
    const lookup = plugins.getRpcHandler(id, method);
    if (lookup.outcome === "unknown-plugin") {
      return context.json({ ok: false, error: `unknown plugin "${id}"` }, 404);
    }
    if (lookup.outcome === "not-running") {
      return context.json(
        { ok: false, error: notRunningError(id, lookup) },
        503,
      );
    }
    if (lookup.outcome === "not-found") {
      return context.json(
        {
          ok: false,
          error: {
            code: "unknown_method",
            message: `plugin "${id}" has no rpc method "${method}"`,
          },
        },
        404,
      );
    }
    const outcome = await plugins.invokeRpcHandler(
      id,
      method,
      lookup.value,
      input,
    );
    if (!outcome.ok) {
      return context.json(
        { ok: false, error: outcome.error },
        outcome.error.code === "invalid_input" ? 400 : 500,
      );
    }
    return context.json({ ok: true, result: outcome.result });
  });
}
