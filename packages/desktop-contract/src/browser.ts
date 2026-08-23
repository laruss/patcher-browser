import { z } from "zod";

/**
 * Hard caps on attacker-influenced strings crossing the browser IPC boundary so
 * a hostile page cannot force oversized values into IPC payloads or persisted
 * (localStorage) tab state. The main process truncates to these before sending;
 * the schemas reject anything longer.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH = 4096;
export const PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH = 1024;

/**
 * Pixel rect of the panel region the native browser view must overlay,
 * measured by the renderer against its own layout viewport. The preload
 * converts these CSS pixels to native window points at the current page zoom
 * before it sends the rect to the desktop main process. This rect is the
 * single placement authority: the renderer re-measures and pushes it whenever
 * its layout moves the panel, and the desktop main process only intersects it
 * with the live window content bounds — it never extrapolates placement from
 * native window resizes, whose size the renderer's (possibly lagging) chrome
 * paint does not yet reflect.
 */
export const patcherDesktopBrowserViewBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  })
  .strict();
export type PatcherDesktopBrowserViewBounds = z.infer<
  typeof patcherDesktopBrowserViewBoundsSchema
>;

export interface PatcherDesktopBrowserViewportBounds {
  width: number;
  height: number;
}

interface ClampIntegerToRangeArgs {
  max: number;
  min: number;
  value: number;
}

export interface ClampPatcherDesktopBrowserViewBoundsArgs {
  bounds: PatcherDesktopBrowserViewBounds;
  viewport: PatcherDesktopBrowserViewportBounds;
}

function clampIntegerToRange(args: ClampIntegerToRangeArgs): number {
  return Math.min(Math.max(args.value, args.min), args.max);
}

export function clampPatcherDesktopBrowserViewBounds(
  args: ClampPatcherDesktopBrowserViewBoundsArgs,
): PatcherDesktopBrowserViewBounds {
  const viewportRight = Math.max(0, Math.round(args.viewport.width));
  const viewportBottom = Math.max(0, Math.round(args.viewport.height));
  const x = clampIntegerToRange({
    value: args.bounds.x,
    min: 0,
    max: viewportRight,
  });
  const y = clampIntegerToRange({
    value: args.bounds.y,
    min: 0,
    max: viewportBottom,
  });
  const right = clampIntegerToRange({
    value: args.bounds.x + args.bounds.width,
    min: x,
    max: viewportRight,
  });
  const bottom = clampIntegerToRange({
    value: args.bounds.y + args.bounds.height,
    min: y,
    max: viewportBottom,
  });

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

/**
 * Create-or-update the view for a browser tab. `url` may be empty to mean "no
 * page yet" (the renderer shows its new-tab screen and keeps the view hidden).
 *
 * Version-skew warning: the desktop shell attaches to any already-running Patcher
 * server that passes its health probe (no version handshake — see
 * apps/desktop/src/server-probe.ts) and loads the SPA that server serves, so
 * the renderer and the shell's main process routinely come from different
 * builds. This and the other `.strict()` browser request shapes are therefore
 * wire-frozen: adding a required field breaks old SPAs against a new shell,
 * and adding any field breaks new SPAs against an old shell's strict parser.
 * Change them only alongside an explicit capability/version negotiation in
 * the preload bridge.
 */
export const patcherDesktopBrowserAttachRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    bounds: patcherDesktopBrowserViewBoundsSchema,
    visible: z.boolean(),
  })
  .strict();
export type PatcherDesktopBrowserAttachRequest = z.infer<
  typeof patcherDesktopBrowserAttachRequestSchema
>;

export const patcherDesktopBrowserNavigateRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().min(1).max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type PatcherDesktopBrowserNavigateRequest = z.infer<
  typeof patcherDesktopBrowserNavigateRequestSchema
>;

export const patcherDesktopBrowserSetBoundsRequestSchema = z
  .object({
    tabId: z.string().min(1),
    bounds: patcherDesktopBrowserViewBoundsSchema,
  })
  .strict();
export type PatcherDesktopBrowserSetBoundsRequest = z.infer<
  typeof patcherDesktopBrowserSetBoundsRequestSchema
>;

export const patcherDesktopBrowserSetVisibleRequestSchema = z
  .object({
    tabId: z.string().min(1),
    visible: z.boolean(),
  })
  .strict();
export type PatcherDesktopBrowserSetVisibleRequest = z.infer<
  typeof patcherDesktopBrowserSetVisibleRequestSchema
>;

/**
 * Page zoom as a factor, where 1 is 100%.
 *
 * A factor rather than Chromium's zoom *level* (a log scale where each step is
 * a factor of 1.2) because everything that reads this is showing a percentage
 * to a user or being handed one by a plugin. The shell converts.
 *
 * The range is Chrome's own, and it is enforced on both sides: the renderer
 * clamps so its steps cannot walk out, and the shell clamps because a plugin
 * can ask for anything.
 */
export const PATCHER_DESKTOP_BROWSER_MIN_ZOOM_FACTOR = 0.25;
export const PATCHER_DESKTOP_BROWSER_MAX_ZOOM_FACTOR = 5;

const patcherDesktopBrowserZoomFactorSchema = z
  .number()
  .min(PATCHER_DESKTOP_BROWSER_MIN_ZOOM_FACTOR)
  .max(PATCHER_DESKTOP_BROWSER_MAX_ZOOM_FACTOR);

export const patcherDesktopBrowserSetZoomRequestSchema = z
  .object({
    tabId: z.string().min(1),
    factor: patcherDesktopBrowserZoomFactorSchema,
  })
  .strict();
export type PatcherDesktopBrowserSetZoomRequest = z.infer<
  typeof patcherDesktopBrowserSetZoomRequestSchema
>;

/** What a tab's zoom became, whoever changed it. */
export const patcherDesktopBrowserZoomSchema = z
  .object({
    tabId: z.string().min(1),
    factor: patcherDesktopBrowserZoomFactorSchema,
  })
  .strict();
export type PatcherDesktopBrowserZoom = z.infer<
  typeof patcherDesktopBrowserZoomSchema
>;

export type PatcherDesktopBrowserZoomHandler = (
  zoom: PatcherDesktopBrowserZoom,
) => void;

/**
 * Silence a tab's page, or let it speak again.
 *
 * Mute belongs to the `webContents`, so it lasts exactly as long as the view
 * does — see `browser-tab-mute.ts` in the app for what the renderer promises on
 * top of that.
 */
export const patcherDesktopBrowserSetMutedRequestSchema = z
  .object({
    tabId: z.string().min(1),
    muted: z.boolean(),
  })
  .strict();
export type PatcherDesktopBrowserSetMutedRequest = z.infer<
  typeof patcherDesktopBrowserSetMutedRequestSchema
>;

/**
 * What the shell knows about a page's connection that its URL does not say.
 *
 * Exactly one thing, deliberately: whether the page is being served under a
 * certificate a human chose to trust after Chromium refused it. Encryption
 * itself is readable from the scheme, and the renderer derives it there rather
 * than being told twice.
 *
 * What this does **not** carry is Chromium's own security state — mixed content,
 * an obsolete cipher, a revoked certificate. That lives behind the DevTools
 * protocol, and a tab may have only one protocol client: making the padlock
 * depend on it would break it whenever the developer panel is open.
 */
export const patcherDesktopBrowserPageSecuritySchema = z
  .object({
    tabId: z.string().min(1),
    certificateTrustedByUser: z.boolean(),
  })
  .strict();
export type PatcherDesktopBrowserPageSecurity = z.infer<
  typeof patcherDesktopBrowserPageSecuritySchema
>;

export type PatcherDesktopBrowserPageSecurityHandler = (
  security: PatcherDesktopBrowserPageSecurity,
) => void;

/** Ref for tab-scoped commands with no other payload (detach/back/forward/reload/stop). */
export const patcherDesktopBrowserTabRefSchema = z
  .object({
    tabId: z.string().min(1),
  })
  .strict();
export type PatcherDesktopBrowserTabRef = z.infer<
  typeof patcherDesktopBrowserTabRefSchema
>;

/**
 * Current navigation state of a browser view, pushed main → renderer on every
 * relevant `webContents` event. A snapshot of live state — never a queue ladder.
 */
export const patcherDesktopBrowserStateSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    isLoading: z.boolean(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    errorText: z
      .string()
      .max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH)
      .nullable(),
  })
  .strict();
export type PatcherDesktopBrowserState = z.infer<
  typeof patcherDesktopBrowserStateSchema
>;

/**
 * Request from main → renderer to open a popup (`window.open`/`target=_blank`)
 * as a new in-panel browser tab. The native OS popup window is always denied.
 */
export const patcherDesktopBrowserOpenTabRequestSchema = z
  .object({
    url: z.string().min(1).max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type PatcherDesktopBrowserOpenTabRequest = z.infer<
  typeof patcherDesktopBrowserOpenTabRequestSchema
>;

/**
 * Source-attributed variant of {@link patcherDesktopBrowserOpenTabRequestSchema}.
 * Emitted on a new channel so the legacy wire-frozen popup event can remain
 * unchanged for desktop/SPA version skew.
 */
export const patcherDesktopBrowserScopedOpenTabRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().min(1).max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type PatcherDesktopBrowserScopedOpenTabRequest = z.infer<
  typeof patcherDesktopBrowserScopedOpenTabRequestSchema
>;

/**
 * The links macOS handed the shell because Patcher is the user's default browser,
 * answered to the surface that asked for them and emptied in the asking.
 *
 * An answer rather than a push: `open-url` fires before there is a renderer at
 * all when the click is what launched Patcher, so the shell queues and the surface
 * pulls when it mounts. Same URL bound as a popup request, for the same reason
 * — the address comes from outside this app either way.
 */
export const patcherDesktopBrowserExternalUrlsSchema = z
  .object({
    urls: z.array(
      z.string().min(1).max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    ),
  })
  .strict();
export type PatcherDesktopBrowserExternalUrls = z.infer<
  typeof patcherDesktopBrowserExternalUrlsSchema
>;

/**
 * Upper bound for a snapshot data URL. A JPEG of a full-window view on a 5K
 * display lands well under this; the cap exists so a misbehaving push can
 * never balloon renderer memory.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH = 8_388_608;

/**
 * A transient bitmap of a browser view, pushed main → renderer at the start
 * of a native window resize burst while the native view is hidden (the
 * independently composited overlay cannot stay visually glued to the chrome
 * mid-resize). The renderer paints it inside the panel so it scales with the
 * chrome. `dataUrl: null` clears the placeholder once the resize settles and
 * the live view is shown again.
 */
export const patcherDesktopBrowserSnapshotSchema = z
  .object({
    tabId: z.string().min(1),
    dataUrl: z
      .string()
      .max(PATCHER_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH)
      .nullable(),
  })
  .strict();
export type PatcherDesktopBrowserSnapshot = z.infer<
  typeof patcherDesktopBrowserSnapshotSchema
>;

/**
 * Cap on a favicon data URL. Favicons cross the wire as the page's own image
 * bytes, so this is the wire-side twin of the shell's byte cap
 * (`PATCHER_DESKTOP_BROWSER_MAX_FAVICON_BYTES`): base64 expands by 4/3, and the value
 * leaves room for the `data:<mime>;base64,` prefix on top of that.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_FAVICON_DATA_URL_LENGTH = 196_608;

/**
 * The icon a browser tab shows, pushed main → renderer when a page declares one
 * and `null` when a navigation leaves the previous page's icon stale.
 *
 * `dataUrl` is built by the shell from bytes **it** fetched inside the browsing
 * session, and its media type comes from the shell's allowlist rather than from
 * the response. The page-controlled favicon URL never reaches the trusted Patcher app,
 * which is what keeps a tab icon from becoming a beacon on the app's own origin,
 * a loopback/LAN probe carrying app credentials, or a `javascript:`/`data:`
 * payload of the page's choosing. See `resolveBrowserFaviconDataUrl` in
 * apps/desktop.
 */
export const patcherDesktopBrowserFaviconSchema = z
  .object({
    tabId: z.string().min(1),
    dataUrl: z
      .string()
      .max(PATCHER_DESKTOP_BROWSER_MAX_FAVICON_DATA_URL_LENGTH)
      .nullable(),
  })
  .strict();
export type PatcherDesktopBrowserFavicon = z.infer<
  typeof patcherDesktopBrowserFaviconSchema
>;

/**
 * Cap on the strings a download event carries. A filename comes from the page's
 * `Content-Disposition` (or its URL) and a path is built from it, so both are
 * attacker-influenced and bounded here as well as sanitized in the shell.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_DOWNLOAD_PATH_LENGTH = 4096;

/** A media type is short; anything longer is not one, so it is cut. */
export const PATCHER_DESKTOP_BROWSER_MAX_MIME_TYPE_LENGTH = 255;

/**
 * What a download did, pushed main → renderer. `started` fires when the shell
 * has chosen the save path and let the transfer begin; exactly one terminal
 * event follows it for the same `id`.
 *
 * `refused` is the shell's own decision rather than a transfer outcome: the
 * page asked for more downloads than the rate limit allows, and nothing was
 * written. It is a distinct state because a caller must be able to tell "the
 * network failed" from "we said no", and only one of those is worth retrying.
 */
export const patcherDesktopBrowserDownloadStateSchema = z.enum([
  "started",
  "completed",
  "cancelled",
  "interrupted",
  "refused",
]);
export type PatcherDesktopBrowserDownloadState = z.infer<
  typeof patcherDesktopBrowserDownloadStateSchema
>;

/**
 * A download belonging to a browser tab.
 *
 * `savePath` is where the shell decided to write, already sanitized and made
 * unique — it is not the name the page asked for, and the two can differ. It is
 * null on `refused`, where nothing was ever written.
 *
 * The renderer is told about downloads so it can say one happened; it is given
 * no control over them. There is no cancel, no pause and no path selection on
 * this wire, because a browser download is the shell's business once the user's
 * page has started it.
 */
export const patcherDesktopBrowserDownloadSchema = z
  .object({
    /** Stable across this download's `started` and terminal events. */
    id: z.string().min(1),
    tabId: z.string().min(1),
    filename: z
      .string()
      .min(1)
      .max(PATCHER_DESKTOP_BROWSER_MAX_DOWNLOAD_PATH_LENGTH),
    savePath: z
      .string()
      .min(1)
      .max(PATCHER_DESKTOP_BROWSER_MAX_DOWNLOAD_PATH_LENGTH)
      .nullable(),
    /**
     * Where the file came from and what the server said it was. Neither is used
     * to decide anything here — they are carried because a plugin deciding what
     * to do with a download needs more than a filename, and the shell is the
     * only place that knows them.
     */
    url: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    mimeType: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_MIME_TYPE_LENGTH),
    state: patcherDesktopBrowserDownloadStateSchema,
  })
  .strict();
export type PatcherDesktopBrowserDownload = z.infer<
  typeof patcherDesktopBrowserDownloadSchema
>;

/**
 * Tell the shell the app is drawing its own chrome over the page area — a
 * dropdown, a menu, anything that has to float above the page.
 *
 * This exists because a `WebContentsView` composites above the DOM: React
 * cannot draw over a live page, at all. So the shell freezes the page to a
 * bitmap, pushes it on the snapshot channel and hides the view, leaving the
 * whole window as DOM that can be drawn on **and clicked on** — which is what
 * makes click-outside-to-close work. `active: false` reveals the live view
 * again.
 *
 * The same machinery a JavaScript dialog uses, and the cost is the same: the
 * page is a still image while the overlay is open. Fine for something the user
 * opens and closes in seconds; not something to leave on.
 */
export const patcherDesktopBrowserSetOverlayRequestSchema = z
  .object({
    tabId: z.string().min(1),
    active: z.boolean(),
  })
  .strict();
export type PatcherDesktopBrowserSetOverlayRequest = z.infer<
  typeof patcherDesktopBrowserSetOverlayRequestSchema
>;

/**
 * Give the page the whole window, or give the chrome back.
 *
 * The same expansion Chromium's own HTML fullscreen produces, asked for by the
 * user instead of by the page — which is why it is a separate flag in the
 * shell: a video leaving fullscreen must not take the user's own choice with
 * it.
 *
 * Whether it is offered at all is the renderer's decision, not the shell's: it
 * is the side that knows the window is already fullscreen, which is the only
 * state where covering the app chrome is something a user asked for rather than
 * something that traps them.
 */
export const patcherDesktopBrowserSetFullscreenRequestSchema = z
  .object({
    tabId: z.string().min(1),
    fullscreen: z.boolean(),
  })
  .strict();
export type PatcherDesktopBrowserSetFullscreenRequest = z.infer<
  typeof patcherDesktopBrowserSetFullscreenRequestSchema
>;

/**
 * Open a finished download, or show it in the OS file manager.
 *
 * `savePath` is echoed back from a download event rather than composed by the
 * caller, and the shell **only acts on a path it wrote itself** this session.
 * That check is the point of the design: without it this channel is "open any
 * file on this machine", reachable from the renderer, with a path a page had a
 * hand in naming.
 */
export const patcherDesktopBrowserDownloadActionRequestSchema = z
  .object({
    action: z.enum(["open", "reveal"]),
    savePath: z
      .string()
      .min(1)
      .max(PATCHER_DESKTOP_BROWSER_MAX_DOWNLOAD_PATH_LENGTH),
  })
  .strict();
export type PatcherDesktopBrowserDownloadActionRequest = z.infer<
  typeof patcherDesktopBrowserDownloadActionRequestSchema
>;

/**
 * `unknown-path` is the refusal above; `failed` is the OS declining, which in
 * practice means the user moved or deleted the file after downloading it. They
 * are separate because only the second is worth showing to a user — the first
 * is a bug on our side.
 */
export const patcherDesktopBrowserDownloadActionResultSchema =
  z.discriminatedUnion("ok", [
    z.object({ ok: z.literal(true) }).strict(),
    z
      .object({
        ok: z.literal(false),
        reason: z.enum(["unknown-path", "failed"]),
        message: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
      })
      .strict(),
  ]);
export type PatcherDesktopBrowserDownloadActionResult = z.infer<
  typeof patcherDesktopBrowserDownloadActionResultSchema
>;

/**
 * Caps on the page content a read returns. Unlike the other caps here these
 * bound what reaches an *agent's* context rather than what reaches the tab
 * strip, so they are sized for a page's readable text and for a deliberate
 * selection rather than for a title. Three layers must agree: the in-page
 * extraction slices to these lengths so a huge document never crosses the
 * process boundary, the main process re-truncates before answering, and the
 * schema below rejects anything longer. A caller wanting less is expected to
 * trim further for its own budget.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH = 65_536;
export const PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH = 16_384;

/**
 * What a page read answers with.
 *
 * Failures are a typed variant rather than a rejection: this crosses `invoke`,
 * where a thrown error arrives as a mangled `Error invoking remote method …`
 * string carrying no structure a caller could branch on.
 *
 * Deliberately **not** `.strict()`, unlike the push payloads above. Those are
 * parsed by the shell's own preload; this one is parsed by the SPA, which
 * routinely runs against a *newer* shell (invariant 2 in
 * docs/architecture/bb-migration.md). Zod's default strip lets a later shell add
 * a field without needing yet another channel, and `.catch` on `reason` keeps an
 * unknown future reason from failing the whole parse.
 *
 * On success, `text` and `selection` are page-controlled content — the document
 * chooses both. The caps and the two truncation flags are the whole defence;
 * nothing sanitizes this and no consumer may treat it as trusted. The flags are
 * separate because a caller that asked for a selection should not have to guess
 * which of the two was cut.
 *
 * `contentKind` is the field that non-strict parse was written for. A PDF tab's
 * text does not come from its DOM (see desktop-browser-pdf-text.ts), and a
 * caller that gets an empty read wants to know whether it is looking at a blank
 * page or at a scan with no text layer. An older shell sends nothing and the
 * default answers "html", which is what every read was before.
 */
export const patcherDesktopBrowserPageReadResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    tabId: z.string().min(1),
    url: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    isLoading: z.boolean(),
    text: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH),
    textTruncated: z.boolean(),
    selection: z
      .string()
      .max(PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH),
    selectionTruncated: z.boolean(),
    /** Where `text` came from. A PDF has no selection, so it always reads "". */
    contentKind: z.enum(["html", "pdf"]).catch("html").default("html"),
  }),
  z.object({
    ok: z.literal(false),
    /**
     * `no-view` — the tab has no live `WebContentsView` (never attached this
     * session, or destroyed). `no-page` — attached but nothing loaded yet.
     * `timeout` — the page never answered. `unreadable` — anything else.
     *
     * The last two are PDF-only and exist because both are worth a different
     * next step than "could not be read": `too-large` says the document is past
     * the shell's byte cap and will not become readable by asking again, and
     * `password-protected` says a human has something the agent does not.
     */
    reason: z
      .enum([
        "no-view",
        "no-page",
        "timeout",
        "unreadable",
        "too-large",
        "password-protected",
      ])
      .catch("unreadable"),
  }),
]);
export type PatcherDesktopBrowserPageReadResult = z.infer<
  typeof patcherDesktopBrowserPageReadResultSchema
>;

/**
 * Cap on a rendered accessibility snapshot. Larger than the page-text cap
 * because a snapshot is what an agent acts from — losing the element it needs
 * costs it a round trip — but still bounded: this is attacker-shaped content
 * (roles and labels a page chooses) on its way into a model's context.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_SNAPSHOT_LENGTH = 65_536;

/**
 * Ask for a snapshot. `maxDepth` trades completeness for size on deep pages;
 * both bounds stay the shell's own constants otherwise, so nothing a caller
 * supplies reaches the page.
 */
export const patcherDesktopBrowserSnapshotRequestSchema = z
  .object({
    tabId: z.string().min(1),
    maxDepth: z.number().int().positive().max(100).optional(),
  })
  .strict();
export type PatcherDesktopBrowserSnapshotRequest = z.infer<
  typeof patcherDesktopBrowserSnapshotRequestSchema
>;

export const PATCHER_DESKTOP_BROWSER_MAX_SELECTOR_LENGTH = 1024;

/**
 * The same snapshot, narrowed to what a CSS selector matches.
 *
 * A separate request on a separate channel rather than a `selector` field on the
 * one above, because that one is `.strict()` and wire-frozen: an older shell
 * would refuse the whole payload, and the caller would be told its tab has no
 * view when the tab is fine. Feature-detecting
 * {@link PatcherDesktopBrowserApi.snapshotIn} is the negotiation, as it is for every
 * other capability added since the shell froze.
 */
export const patcherDesktopBrowserSnapshotInRequestSchema = z
  .object({
    tabId: z.string().min(1),
    selector: z
      .string()
      .min(1)
      .max(PATCHER_DESKTOP_BROWSER_MAX_SELECTOR_LENGTH),
    maxDepth: z.number().int().positive().max(100).optional(),
  })
  .strict();
export type PatcherDesktopBrowserSnapshotInRequest = z.infer<
  typeof patcherDesktopBrowserSnapshotInRequestSchema
>;

/**
 * The accessibility snapshot of one tab, and the refs it handed out.
 *
 * `generation` is the load-bearing field. Refs name nodes in the document that
 * produced them, so a navigation invalidates all of them; a caller that acts on
 * a ref must pass back the generation it was given, and the shell refuses the
 * command if it has moved on. Resolving a stale ref against whatever holds that
 * node id now would click the wrong thing silently, which is worse than failing.
 */
export const patcherDesktopBrowserSnapshotResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    tabId: z.string().min(1),
    url: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    snapshot: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_SNAPSHOT_LENGTH),
    generation: z.number().int().nonnegative(),
    refCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    /**
     * `no-view` / `no-page` as for page reads. `debugger-unavailable` — the
     * browser debugger could not be attached, DevTools holding the tab being
     * the realistic cause. `invalid-selector` and `no-match` can only come from
     * a scoped snapshot, and are separate because they call for different
     * fixes: one is the selector's syntax, the other is the page. `failed` —
     * anything else.
     */
    reason: z
      .enum([
        "no-view",
        "no-page",
        "debugger-unavailable",
        "invalid-selector",
        "no-match",
        "failed",
      ])
      .catch("failed"),
    message: z.string().max(1024).optional(),
  }),
]);
export type PatcherDesktopBrowserSnapshotResult = z.infer<
  typeof patcherDesktopBrowserSnapshotResultSchema
>;

/** A page's `alert()` message is page-controlled text; bound it like a title. */
export const PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH = 4096;

/**
 * A JavaScript dialog the page has opened and is now blocked on.
 *
 * Once the shell takes dialogs over (it does, per tab, from the moment the
 * browser debugger attaches) Chromium stops drawing its own native modal, so
 * this is what the app must render instead. `dialog: null` means the tab has
 * none open — the same channel reports both, so a listener cannot miss the
 * close.
 *
 * `message` and `defaultPrompt` are written by the page. They are shown to a
 * human and handed to agents; nothing about them is trustworthy.
 */
export const patcherDesktopBrowserDialogSchema = z
  .object({
    tabId: z.string().min(1),
    dialog: z
      .object({
        type: z.enum(["alert", "confirm", "prompt", "beforeunload"]),
        message: z
          .string()
          .max(PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH),
        defaultPrompt: z
          .string()
          .max(PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH),
      })
      .nullable(),
  })
  .strict();
export type PatcherDesktopBrowserDialog = z.infer<
  typeof patcherDesktopBrowserDialogSchema
>;

/**
 * Answer the dialog a tab is blocked on. `promptText` is only meaningful for a
 * `prompt`, and only when accepting.
 */
export const patcherDesktopBrowserDialogRespondRequestSchema = z
  .object({
    tabId: z.string().min(1),
    accept: z.boolean(),
    promptText: z
      .string()
      .max(PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH)
      .optional(),
  })
  .strict();
export type PatcherDesktopBrowserDialogRespondRequest = z.infer<
  typeof patcherDesktopBrowserDialogRespondRequestSchema
>;

export type PatcherDesktopBrowserDialogHandler = (
  dialog: PatcherDesktopBrowserDialog,
) => void;

/**
 * Caps on a page prompt. Every string here is chosen by a server the page
 * reached — a host, a certificate's own fields — so each is bounded rather than
 * trusted, and a credential is bounded because it crosses a process boundary.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH = 1024;
export const PATCHER_DESKTOP_BROWSER_MAX_CREDENTIAL_LENGTH = 1024;
/** A certificate store with more than this is not a list a human picks from. */
export const PATCHER_DESKTOP_BROWSER_MAX_CLIENT_CERTIFICATES = 20;

/**
 * A question the network asked that only a human can answer.
 *
 * Three Chromium events land here — an HTTP authentication challenge, an
 * untrusted certificate, and a server asking for a client certificate. They
 * share a channel because they share a shape: the page's load is stopped until
 * something answers, and answering hands the decision back to Chromium.
 *
 * `id` is what makes a late answer harmless: a prompt the tab has moved past
 * (it navigated, the tab closed, a second challenge replaced it) can still be
 * answered by a renderer that had not heard, and the shell drops it.
 *
 * **The authentication realm is deliberately absent.** It is server-controlled
 * text next to a username field, which is what made realm strings a spoofing
 * surface; Chrome stopped showing it for that reason and so does this. The
 * shell keeps it only as the key that decides which requests one answer covers.
 */
export const patcherDesktopBrowserPagePromptDetailsSchema =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("auth"),
        id: z.string().min(1),
        /** `host` or `host:port` — who is asking, which is the whole question. */
        host: z
          .string()
          .min(1)
          .max(PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH),
        /** The credentials would travel in the clear; worth saying out loud. */
        insecure: z.boolean(),
      })
      .strict(),
    z
      .object({
        kind: z.literal("certificate"),
        id: z.string().min(1),
        host: z
          .string()
          .min(1)
          .max(PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH),
        /** Chromium's own error code, e.g. `net::ERR_CERT_DATE_INVALID`. */
        errorCode: z
          .string()
          .max(PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH),
        subjectName: z
          .string()
          .max(PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH),
        issuerName: z
          .string()
          .max(PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH),
        /** Unix seconds, as Chromium reports them; formatting is the app's. */
        validFrom: z.number().int(),
        validTo: z.number().int(),
        fingerprint: z
          .string()
          .max(PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH),
      })
      .strict(),
    z
      .object({
        kind: z.literal("client-certificate"),
        id: z.string().min(1),
        host: z
          .string()
          .min(1)
          .max(PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH),
        certificates: z
          .array(
            z
              .object({
                /** Position in the shell's own list; the answer names one. */
                index: z.number().int().min(0),
                subjectName: z
                  .string()
                  .max(PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH),
                issuerName: z
                  .string()
                  .max(PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH),
                validTo: z.number().int(),
              })
              .strict(),
          )
          .max(PATCHER_DESKTOP_BROWSER_MAX_CLIENT_CERTIFICATES),
      })
      .strict(),
  ]);
export type PatcherDesktopBrowserPagePromptDetails = z.infer<
  typeof patcherDesktopBrowserPagePromptDetailsSchema
>;

/**
 * The prompt a tab is waiting on, or `null` when it stopped waiting. One
 * channel reports both, as the dialog channel does, so a listener cannot miss
 * the close.
 */
export const patcherDesktopBrowserPagePromptSchema = z
  .object({
    tabId: z.string().min(1),
    prompt: patcherDesktopBrowserPagePromptDetailsSchema.nullable(),
  })
  .strict();
export type PatcherDesktopBrowserPagePrompt = z.infer<
  typeof patcherDesktopBrowserPagePromptSchema
>;
export type PatcherDesktopBrowserPagePromptHandler = (
  prompt: PatcherDesktopBrowserPagePrompt,
) => void;

/**
 * What a human decided. `cancel` answers every kind; the other three each
 * belong to one, and an answer that does not match the open prompt is treated
 * as a cancel rather than guessed at.
 */
export const patcherDesktopBrowserPagePromptAnswerSchema = z
  .object({
    tabId: z.string().min(1),
    /** The prompt being answered; an answer to a closed one is dropped. */
    id: z.string().min(1),
    answer: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("cancel") }).strict(),
      z
        .object({
          kind: z.literal("credentials"),
          username: z
            .string()
            .max(PATCHER_DESKTOP_BROWSER_MAX_CREDENTIAL_LENGTH),
          password: z
            .string()
            .max(PATCHER_DESKTOP_BROWSER_MAX_CREDENTIAL_LENGTH),
        })
        .strict(),
      /** Proceed to a site whose certificate does not verify. */
      z.object({ kind: z.literal("proceed") }).strict(),
      z
        .object({
          kind: z.literal("client-certificate"),
          index: z.number().int().min(0),
        })
        .strict(),
    ]),
  })
  .strict();
export type PatcherDesktopBrowserPagePromptAnswer = z.infer<
  typeof patcherDesktopBrowserPagePromptAnswerSchema
>;

/**
 * Caps on what an interaction may carry into a page.
 *
 * `fill` replaces a field's value in one shot, so it can afford a large bound.
 * `type` sends one key event per character, so its bound is what keeps a single
 * command from spending minutes in the main process. Uploads and select values
 * are counted rather than sized: the interesting limit there is how many, not
 * how long.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_FILL_TEXT_LENGTH = 8_192;
export const PATCHER_DESKTOP_BROWSER_MAX_TYPE_TEXT_LENGTH = 1_024;
export const PATCHER_DESKTOP_BROWSER_MAX_UPLOAD_FILES = 10;
export const PATCHER_DESKTOP_BROWSER_MAX_SELECT_VALUES = 20;
/** Widest viewport an emulated resize may ask for; beyond this is not a page. */
export const PATCHER_DESKTOP_BROWSER_MAX_VIEWPORT_SIZE = 10_000;

/**
 * A `[ref=eN]` handed out by a snapshot. Shaped, not free-form, so a ref that
 * was never a ref is refused here rather than looked up.
 */
const patcherDesktopBrowserRefSchema = z.string().regex(/^e[1-9][0-9]{0,5}$/u);

const patcherDesktopBrowserKeyModifierSchema = z.enum([
  "Alt",
  "Control",
  "Meta",
  "Shift",
]);

/**
 * What to do to a page.
 *
 * One union rather than a channel per verb: every one of these needs the same
 * preamble (resolve the ref, check the snapshot generation, wait for the element
 * to be actionable), and splitting them would duplicate that preamble nine
 * times across a wire-frozen boundary.
 *
 * `check` and `select` are semantic rather than positional because they cannot
 * be positional: a native `<select>` opens an OS popup no synthetic mouse event
 * reaches, and "click the checkbox" is a toggle, which is the wrong primitive
 * for an agent that wants a known end state.
 */
export const patcherDesktopBrowserInteractionSchema = z.discriminatedUnion(
  "action",
  [
    z.object({
      action: z.literal("click"),
      ref: patcherDesktopBrowserRefSchema,
      button: z.enum(["left", "middle", "right"]),
      /** 2 is a double click; Chromium wants the count on the event itself. */
      clickCount: z.union([z.literal(1), z.literal(2)]),
      modifiers: z.array(patcherDesktopBrowserKeyModifierSchema).max(4),
    }),
    z.object({
      action: z.literal("hover"),
      ref: patcherDesktopBrowserRefSchema,
    }),
    z.object({
      action: z.literal("drag"),
      ref: patcherDesktopBrowserRefSchema,
      targetRef: patcherDesktopBrowserRefSchema,
    }),
    z.object({
      action: z.literal("fill"),
      ref: patcherDesktopBrowserRefSchema,
      text: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_FILL_TEXT_LENGTH),
    }),
    z.object({
      action: z.literal("type"),
      ref: patcherDesktopBrowserRefSchema,
      text: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_TYPE_TEXT_LENGTH),
    }),
    z.object({
      action: z.literal("press"),
      /** Null presses the key at whatever the page has focused. */
      ref: patcherDesktopBrowserRefSchema.nullable(),
      key: z.string().min(1).max(64),
    }),
    z.object({
      action: z.literal("select"),
      ref: patcherDesktopBrowserRefSchema,
      values: z
        .array(z.string().max(PATCHER_DESKTOP_BROWSER_MAX_TYPE_TEXT_LENGTH))
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_SELECT_VALUES),
    }),
    z.object({
      action: z.literal("check"),
      ref: patcherDesktopBrowserRefSchema,
      /** The end state, not a toggle, so repeating the command is harmless. */
      checked: z.boolean(),
    }),
    z.object({
      action: z.literal("upload"),
      ref: patcherDesktopBrowserRefSchema,
      /**
       * Absolute paths on the machine running the shell. This hands a web page
       * the contents of local files; see docs/architecture/browser-automation.md
       * for what that does and does not add to Patcher's threat model.
       */
      paths: z
        .array(z.string().min(1).max(1024))
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_UPLOAD_FILES),
    }),
    z.object({
      action: z.literal("resize"),
      /** Both zero restores the tab to the panel's own size. */
      width: z
        .number()
        .int()
        .nonnegative()
        .max(PATCHER_DESKTOP_BROWSER_MAX_VIEWPORT_SIZE),
      height: z
        .number()
        .int()
        .nonnegative()
        .max(PATCHER_DESKTOP_BROWSER_MAX_VIEWPORT_SIZE),
    }),
  ],
);
export type PatcherDesktopBrowserInteraction = z.infer<
  typeof patcherDesktopBrowserInteractionSchema
>;

/**
 * Perform one interaction on a tab.
 *
 * `generation` is the snapshot the refs came from. It is **optional**, and the
 * tradeoff is worth stating: navigation already drops every ref, so the
 * dangerous case — acting on an element that no longer exists — is closed
 * either way. What the generation adds is protection against a *newer* snapshot
 * having reassigned `e5` to a different element between the caller reading it
 * and acting on it. A caller that passes it gets that check; one that omits it
 * accepts the race in exchange for not having to thread the value through.
 */
export const patcherDesktopBrowserInteractRequestSchema = z
  .object({
    tabId: z.string().min(1),
    generation: z.number().int().nonnegative().optional(),
    interaction: patcherDesktopBrowserInteractionSchema,
  })
  .strict();
export type PatcherDesktopBrowserInteractRequest = z.infer<
  typeof patcherDesktopBrowserInteractRequestSchema
>;

/**
 * What an interaction answers with. Success carries where the tab ended up,
 * because the most common interaction — clicking a link or submitting a form —
 * changes it, and a caller that had to ask separately would race the next
 * navigation.
 */
export const patcherDesktopBrowserInteractResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    tabId: z.string().min(1),
    url: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
  }),
  z.object({
    ok: z.literal(false),
    /**
     * `no-view` / `no-page` / `debugger-unavailable` as elsewhere.
     * `stale-refs` — the snapshot those refs came from is no longer current.
     * `unknown-ref` — no such ref in the current snapshot; snapshot again.
     * `not-actionable` — the element never became clickable; `message` says why
     * (covered, disabled, still animating).
     * `unsupported-key` — the key name is not one the shell can emit.
     */
    reason: z
      .enum([
        "no-view",
        "no-page",
        "debugger-unavailable",
        "stale-refs",
        "unknown-ref",
        "not-actionable",
        "unsupported-key",
        "failed",
      ])
      .catch("failed"),
    message: z.string().max(1024).optional(),
  }),
]);
export type PatcherDesktopBrowserInteractResult = z.infer<
  typeof patcherDesktopBrowserInteractResultSchema
>;

/**
 * Caps on what an observation carries back.
 *
 * The two base64 bounds are sized for what they hold rather than symmetrically:
 * a viewport screenshot is a single frame, while a PDF is the whole document and
 * routinely several times larger. Exceeding either is a typed refusal
 * (`too-large`) and never a truncation — half a PNG is not a smaller PNG.
 *
 * The buffers are bounded by count as well as by string length because their
 * contents are page-authored: a page in a `console.log` loop must cost a fixed
 * amount of shell memory, not a growing one.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH = 8_388_608;
export const PATCHER_DESKTOP_BROWSER_MAX_PDF_BASE64_LENGTH = 16_777_216;
export const PATCHER_DESKTOP_BROWSER_MAX_OBSERVATION_ENTRIES = 500;
export const PATCHER_DESKTOP_BROWSER_MAX_CONSOLE_TEXT_LENGTH = 4096;

/**
 * What to observe about a tab.
 *
 * One union on one channel, for the reason the interaction union gives: these
 * share the preamble (resolve the tab, decide whether it needs a loaded page)
 * and a channel apiece would freeze four copies of it.
 *
 * Unlike an interaction, **none of these attaches the browser debugger.**
 * Screenshots and PDFs are Electron's own `capturePage`/`printToPDF`, and the
 * console and network logs are recorded from ordinary `webContents` and
 * `webRequest` events, from the moment the tab is created. That is what lets an
 * agent look at a tab the user is merely browsing without moving its dialogs off
 * Chromium's native path.
 */
export const patcherDesktopBrowserObservationSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("screenshot"),
      /** JPEG for looking at a page, PNG when exact pixels matter. */
      format: z.enum(["png", "jpeg"]),
      /** JPEG quality; ignored for PNG, which is lossless. */
      quality: z.number().int().min(1).max(100),
    }),
    z.object({ kind: z.literal("pdf") }),
    z.object({
      kind: z.literal("console"),
      /** Newest entries first cut from the tail, so a limit keeps what is recent. */
      limit: z
        .number()
        .int()
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_OBSERVATION_ENTRIES),
    }),
    z.object({
      kind: z.literal("network"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_OBSERVATION_ENTRIES),
    }),
  ],
);
export type PatcherDesktopBrowserObservation = z.infer<
  typeof patcherDesktopBrowserObservationSchema
>;

export const patcherDesktopBrowserObserveRequestSchema = z
  .object({
    tabId: z.string().min(1),
    observation: patcherDesktopBrowserObservationSchema,
  })
  .strict();
export type PatcherDesktopBrowserObserveRequest = z.infer<
  typeof patcherDesktopBrowserObserveRequestSchema
>;

/**
 * One console message the page produced. `text` is whatever the page passed to
 * `console.*`, already flattened to a string by Chromium, and `source` is the
 * script URL it came from — both page-authored and neither trustworthy.
 */
const patcherDesktopBrowserConsoleEntrySchema = z.object({
  level: z.enum(["debug", "info", "warning", "error"]).catch("info"),
  text: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_CONSOLE_TEXT_LENGTH),
  source: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
  line: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
});
export type PatcherDesktopBrowserConsoleEntry = z.infer<
  typeof patcherDesktopBrowserConsoleEntrySchema
>;

/**
 * One request the tab finished. `status` is null when it never got a response —
 * `error` says why, and a request the session firewall refused shows up here
 * rather than vanishing.
 *
 * `resourceType` stays a free string rather than an enum: Chromium adds to that
 * list, and a new value must not fail the whole parse.
 */
const patcherDesktopBrowserNetworkEntrySchema = z.object({
  method: z.string().max(16),
  url: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
  resourceType: z.string().max(32),
  status: z.number().int().nullable(),
  fromCache: z.boolean(),
  error: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
  timestamp: z.number().int().nonnegative(),
});
export type PatcherDesktopBrowserNetworkEntry = z.infer<
  typeof patcherDesktopBrowserNetworkEntrySchema
>;

const patcherDesktopBrowserObservedPageSchema = {
  tabId: z.string().min(1),
  url: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
  title: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
};

/**
 * What an observation answers with.
 *
 * `droppedCount` is the load-bearing field on the two logs: the buffers are
 * fixed-size rings, so a busy page silently loses its oldest entries. A caller
 * reading a log needs to know it is looking at a window rather than at
 * everything, and that number is the only way to tell.
 *
 * Not `.strict()`, for the same reason the page-read result is not: this is
 * parsed by the SPA, which routinely runs against a newer shell.
 */
export const patcherDesktopBrowserObserveResultSchema = z.union([
  z.discriminatedUnion("kind", [
    z.object({
      ok: z.literal(true),
      kind: z.literal("screenshot"),
      ...patcherDesktopBrowserObservedPageSchema,
      mimeType: z.enum(["image/png", "image/jpeg"]),
      base64: z
        .string()
        .max(PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH),
      width: z.number().int().nonnegative(),
      height: z.number().int().nonnegative(),
    }),
    z.object({
      ok: z.literal(true),
      kind: z.literal("pdf"),
      ...patcherDesktopBrowserObservedPageSchema,
      base64: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_PDF_BASE64_LENGTH),
      byteLength: z.number().int().nonnegative(),
    }),
    z.object({
      ok: z.literal(true),
      kind: z.literal("console"),
      ...patcherDesktopBrowserObservedPageSchema,
      entries: z
        .array(patcherDesktopBrowserConsoleEntrySchema)
        .max(PATCHER_DESKTOP_BROWSER_MAX_OBSERVATION_ENTRIES),
      droppedCount: z.number().int().nonnegative(),
    }),
    z.object({
      ok: z.literal(true),
      kind: z.literal("network"),
      ...patcherDesktopBrowserObservedPageSchema,
      entries: z
        .array(patcherDesktopBrowserNetworkEntrySchema)
        .max(PATCHER_DESKTOP_BROWSER_MAX_OBSERVATION_ENTRIES),
      droppedCount: z.number().int().nonnegative(),
    }),
  ]),
  z.object({
    ok: z.literal(false),
    /**
     * `no-view` / `no-page` as elsewhere. `too-large` — the image or document
     * exceeded the cap above and was not sent; nothing partial is ever returned.
     * `failed` — anything else, including a page that could not be captured.
     */
    reason: z
      .enum(["no-view", "no-page", "too-large", "failed"])
      .catch("failed"),
    message: z.string().max(1024).optional(),
  }),
]);
export type PatcherDesktopBrowserObserveResult = z.infer<
  typeof patcherDesktopBrowserObserveResultSchema
>;

/**
 * The tallest and widest capture that is worth asking Chromium for.
 *
 * A composited capture is a GPU texture, and past the driver's maximum texture
 * size the answer is a blank image or an error rather than a bigger picture.
 * 16384 CSS pixels is the conservative floor across the GPUs Chromium runs on;
 * a document longer than that is captured down to this height and says so.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION = 16_384;

/**
 * Capture the whole document rather than the visible viewport.
 *
 * Its own channel rather than a fifth observation, for two reasons that point
 * the same way. The wire one is the usual: {@link patcherDesktopBrowserObservationSchema}
 * is frozen, and a `fullPage` flag added to its screenshot member would be
 * *silently dropped* by every older shell — a caller would get a viewport
 * picture reported as a success and have no way to tell. The other is that this
 * is not an observation in the sense the rest of that union is: it attaches the
 * browser debugger, and the whole point of that channel is that nothing on it
 * does.
 */
export const patcherDesktopBrowserCaptureFullPageRequestSchema = z
  .object({
    tabId: z.string().min(1),
    format: z.enum(["png", "jpeg"]),
    quality: z.number().int().min(1).max(100),
  })
  .strict();
export type PatcherDesktopBrowserCaptureFullPageRequest = z.infer<
  typeof patcherDesktopBrowserCaptureFullPageRequestSchema
>;

/**
 * A picture of the whole document.
 *
 * `width`/`height` are **CSS pixels**, unlike the viewport capture's, which are
 * the composited device pixels a retina display renders. That difference is the
 * capture path, not a choice: this one names the region it wants and Chromium
 * renders it at 1:1, and a caller comparing the two sizes needs to know they are
 * measured in different units.
 *
 * `truncated` means the document was longer than
 * {@link PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION} and this is its top. A
 * clipped picture is still a useful picture — which is why this truncates where
 * an over-large PDF refuses — but only if it admits it.
 */
export const patcherDesktopBrowserCaptureFullPageResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    tabId: z.string().min(1),
    url: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    base64: z
      .string()
      .max(PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  z.object({
    ok: z.literal(false),
    /**
     * `debugger-unavailable` is the one this has and the viewport capture does
     * not: DevTools open on the tab holds Chromium's only protocol client, and
     * the honest answer is to say so rather than to quietly hand back a
     * viewport picture instead.
     */
    reason: z
      .enum([
        "no-view",
        "no-page",
        "debugger-unavailable",
        "too-large",
        "failed",
      ])
      .catch("failed"),
    message: z.string().max(1024).optional(),
  }),
]);
export type PatcherDesktopBrowserCaptureFullPageResult = z.infer<
  typeof patcherDesktopBrowserCaptureFullPageResultSchema
>;

/**
 * Caps on stored state.
 *
 * Cookie values are bounded by the cookie spec itself (~4KB); web storage is
 * not, so it gets a per-value cap, a count cap **and** a total budget. A single
 * origin may legitimately hold megabytes of serialized application state, and
 * all three of those must not become the size of one IPC message.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_COOKIES = 200;
export const PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH = 256;
export const PATCHER_DESKTOP_BROWSER_MAX_COOKIE_VALUE_LENGTH = 4096;
export const PATCHER_DESKTOP_BROWSER_MAX_STORAGE_ITEMS = 500;
export const PATCHER_DESKTOP_BROWSER_MAX_STORAGE_VALUE_LENGTH = 65_536;
export const PATCHER_DESKTOP_BROWSER_MAX_STORAGE_TOTAL_LENGTH = 1_048_576;

/**
 * One cookie, in **Playwright's `storageState` shape** rather than Electron's.
 *
 * That is the interop decision of this group: a state file written here loads
 * into Playwright and one written by Playwright loads here, which is the only
 * reason a saved session is worth more than an opaque blob. The shell maps
 * Electron's vocabulary onto this one (`no_restriction` → `None`, a missing
 * `expirationDate` → `expires: -1`) so nothing downstream has to know both.
 *
 * `value` is the session itself for a logged-in site. It is carried in the
 * clear, because a redacted cookie is not a cookie — see the note on
 * {@link patcherDesktopBrowserStorageOperationSchema}.
 */
const patcherDesktopBrowserCookieSchema = z.object({
  name: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH),
  value: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_COOKIE_VALUE_LENGTH),
  /** A leading dot means a domain cookie; without one it is host-only. */
  domain: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH),
  path: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH),
  /** Seconds since the epoch, or -1 for a cookie that dies with the session. */
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(["Strict", "Lax", "None"]),
});
export type PatcherDesktopBrowserCookie = z.infer<
  typeof patcherDesktopBrowserCookieSchema
>;

const patcherDesktopBrowserStorageItemSchema = z.object({
  name: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH),
  value: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_STORAGE_VALUE_LENGTH),
});
export type PatcherDesktopBrowserStorageItem = z.infer<
  typeof patcherDesktopBrowserStorageItemSchema
>;

/** `sessionStorage` is per-tab; `localStorage` is per-origin and outlives it. */
export const patcherDesktopBrowserStorageAreaSchema = z.enum([
  "local",
  "session",
]);
export type PatcherDesktopBrowserStorageArea = z.infer<
  typeof patcherDesktopBrowserStorageAreaSchema
>;

/**
 * What to do to a tab's stored state.
 *
 * One union on one channel, as with interactions and observations. **This one
 * is credential access**, and the shape says so rather than hiding it: cookies
 * come back with their values, because a session cookie without its value is
 * not a session and `state-save` would produce a file that restores nothing.
 * In a browser holding the user's live logins that is what this group is for
 * and what it costs.
 *
 * Everything is scoped to one tab: cookies to the URL that tab is on, web
 * storage to that tab's main frame. The tab is the unit of this browser, and a
 * whole-jar read would hand over every site the user is signed in to at once.
 *
 * Like observations, and unlike interactions, **none of this attaches the
 * browser debugger.** Cookies are Electron's `session.cookies`; web storage is
 * a fixed script in the same privileged isolated world the page read uses.
 */
export const patcherDesktopBrowserStorageOperationSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("cookies-get") }),
    z.object({
      kind: z.literal("cookies-set"),
      cookies: z
        .array(patcherDesktopBrowserCookieSchema)
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_COOKIES),
    }),
    /** A null name clears every cookie the tab's URL carries. */
    z.object({
      kind: z.literal("cookies-clear"),
      name: z
        .string()
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH)
        .nullable(),
    }),
    z.object({
      kind: z.literal("items-get"),
      area: patcherDesktopBrowserStorageAreaSchema,
    }),
    z.object({
      kind: z.literal("items-set"),
      area: patcherDesktopBrowserStorageAreaSchema,
      items: z
        .array(patcherDesktopBrowserStorageItemSchema)
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_STORAGE_ITEMS),
    }),
    z.object({
      kind: z.literal("items-clear"),
      area: patcherDesktopBrowserStorageAreaSchema,
      name: z
        .string()
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH)
        .nullable(),
    }),
  ],
);
export type PatcherDesktopBrowserStorageOperation = z.infer<
  typeof patcherDesktopBrowserStorageOperationSchema
>;

export const patcherDesktopBrowserStorageRequestSchema = z
  .object({
    tabId: z.string().min(1),
    operation: patcherDesktopBrowserStorageOperationSchema,
  })
  .strict();
export type PatcherDesktopBrowserStorageRequest = z.infer<
  typeof patcherDesktopBrowserStorageRequestSchema
>;

/**
 * What a storage operation answers with.
 *
 * The two writes answer with counts because a partial write is the realistic
 * outcome and a silent one is the expensive one: Chromium refuses a cookie
 * whose domain does not match, and web storage refuses anything past its quota.
 * `state-load` reporting "12 applied, 2 rejected" is the difference between a
 * session that half works and an hour spent asking why.
 *
 * Not `.strict()`, like the results above: the SPA parses this against a shell
 * that may be newer than it is.
 */
export const patcherDesktopBrowserStorageResultSchema = z.union([
  z.discriminatedUnion("kind", [
    z.object({
      ok: z.literal(true),
      kind: z.literal("cookies"),
      ...patcherDesktopBrowserObservedPageSchema,
      cookies: z
        .array(patcherDesktopBrowserCookieSchema)
        .max(PATCHER_DESKTOP_BROWSER_MAX_COOKIES),
    }),
    z.object({
      ok: z.literal(true),
      kind: z.literal("items"),
      ...patcherDesktopBrowserObservedPageSchema,
      area: patcherDesktopBrowserStorageAreaSchema,
      items: z
        .array(patcherDesktopBrowserStorageItemSchema)
        .max(PATCHER_DESKTOP_BROWSER_MAX_STORAGE_ITEMS),
      /** The origin held more than the caps allow, so this is not all of it. */
      truncated: z.boolean(),
    }),
    z.object({
      ok: z.literal(true),
      kind: z.literal("written"),
      applied: z.number().int().nonnegative(),
      rejected: z.number().int().nonnegative(),
    }),
    z.object({
      ok: z.literal(true),
      kind: z.literal("removed"),
      removed: z.number().int().nonnegative(),
    }),
  ]),
  z.object({
    ok: z.literal(false),
    /**
     * `no-view` / `no-page` as elsewhere. `timeout` — the page never ran the
     * script, which is the same hazard the page read has. `failed` — anything
     * else, including an origin whose storage the browser refuses to open.
     */
    reason: z.enum(["no-view", "no-page", "timeout", "failed"]).catch("failed"),
    message: z.string().max(1024).optional(),
  }),
]);
export type PatcherDesktopBrowserStorageResult = z.infer<
  typeof patcherDesktopBrowserStorageResultSchema
>;

/**
 * Caps on direct control of a tab.
 *
 * A mocked body is bounded well below a screenshot's: it is held in the shell
 * for as long as the route exists, once per route, whereas a capture crosses
 * once and is gone. An evaluated result is bounded like a snapshot rather than
 * like a PDF — it is text, so a caller can still use the part that arrived, and
 * the flag says there was more.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_ROUTES = 20;
export const PATCHER_DESKTOP_BROWSER_MAX_ROUTE_PATTERN_LENGTH = 1024;
export const PATCHER_DESKTOP_BROWSER_MAX_ROUTE_BODY_LENGTH = 262_144;
export const PATCHER_DESKTOP_BROWSER_MAX_ROUTE_HEADERS = 20;
export const PATCHER_DESKTOP_BROWSER_MAX_EVAL_EXPRESSION_LENGTH = 8_192;
export const PATCHER_DESKTOP_BROWSER_MAX_EVAL_RESULT_LENGTH = 65_536;
export const PATCHER_DESKTOP_BROWSER_MAX_WHEEL_DELTA = 100_000;

/**
 * A request the tab should be answered with instead of the network's answer.
 *
 * `pattern` is a Playwright-style URL glob — `*` stops at a path separator,
 * `**` does not — matched against the whole URL. Deliberately the same dialect,
 * because a route written from Playwright's documentation should mean here what
 * it means there.
 */
export const patcherDesktopBrowserRouteSchema = z.object({
  pattern: z
    .string()
    .min(1)
    .max(PATCHER_DESKTOP_BROWSER_MAX_ROUTE_PATTERN_LENGTH),
  status: z.number().int().min(100).max(599),
  contentType: z.string().max(256),
  body: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_ROUTE_BODY_LENGTH),
  headers: z
    .array(
      z.object({
        name: z.string().min(1).max(256),
        value: z.string().max(4096),
      }),
    )
    .max(PATCHER_DESKTOP_BROWSER_MAX_ROUTE_HEADERS),
});
export type PatcherDesktopBrowserRoute = z.infer<
  typeof patcherDesktopBrowserRouteSchema
>;

/** A route as it stands, with how many requests it has answered. */
export const patcherDesktopBrowserRouteStateSchema =
  patcherDesktopBrowserRouteSchema.extend({
    matched: z.number().int().nonnegative(),
  });
export type PatcherDesktopBrowserRouteState = z.infer<
  typeof patcherDesktopBrowserRouteStateSchema
>;

/**
 * Driving a tab directly, past the paths that make the other commands safe.
 *
 * These belong together because of what they share rather than what they do:
 * each one hands a caller something the rest of this API deliberately withholds.
 * `evaluate` runs the caller's own JavaScript in a page that may hold live
 * logins. The mouse commands act at raw viewport coordinates, so they skip the
 * ref lookup and the actionability check entirely and land on whatever is at
 * that point. A route rewrites what the page receives from the network, and
 * `offline` cuts it off. See docs/architecture/browser-automation.md, Stage E.
 *
 * All of them attach the browser debugger; none of them is reachable without
 * the plugin being enabled.
 */
export const patcherDesktopBrowserControlOperationSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("mouse-move"),
      /** CSS pixels from the viewport's top-left, as a screenshot shows them. */
      x: z
        .number()
        .int()
        .nonnegative()
        .max(PATCHER_DESKTOP_BROWSER_MAX_VIEWPORT_SIZE),
      y: z
        .number()
        .int()
        .nonnegative()
        .max(PATCHER_DESKTOP_BROWSER_MAX_VIEWPORT_SIZE),
    }),
    z.object({
      kind: z.literal("mouse-button"),
      button: z.enum(["left", "middle", "right"]),
      /** Press or release, at wherever the last `mouse-move` left the pointer. */
      down: z.boolean(),
    }),
    z.object({
      kind: z.literal("mouse-wheel"),
      deltaX: z
        .number()
        .int()
        .min(-PATCHER_DESKTOP_BROWSER_MAX_WHEEL_DELTA)
        .max(PATCHER_DESKTOP_BROWSER_MAX_WHEEL_DELTA),
      deltaY: z
        .number()
        .int()
        .min(-PATCHER_DESKTOP_BROWSER_MAX_WHEEL_DELTA)
        .max(PATCHER_DESKTOP_BROWSER_MAX_WHEEL_DELTA),
    }),
    z.object({
      kind: z.literal("evaluate"),
      /**
       * A JavaScript *function*, as Playwright's `eval` takes: `() =>
       * document.title`, or `(el) => el.value` when a ref names an element.
       * It runs in the page's own world, not the isolated one the shell's own
       * scripts use — which is what makes a page's globals reachable and is
       * also why nothing here is protected from the page.
       */
      expression: z
        .string()
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_EVAL_EXPRESSION_LENGTH),
      /** The element to pass in, or null to evaluate against the page. */
      ref: patcherDesktopBrowserRefSchema.nullable(),
    }),
    z.object({
      kind: z.literal("route-set"),
      route: patcherDesktopBrowserRouteSchema,
    }),
    z.object({ kind: z.literal("route-list") }),
    z.object({
      kind: z.literal("route-clear"),
      /** Null removes every route on the tab. */
      pattern: z
        .string()
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_ROUTE_PATTERN_LENGTH)
        .nullable(),
    }),
    z.object({ kind: z.literal("offline"), offline: z.boolean() }),
  ],
);
export type PatcherDesktopBrowserControlOperation = z.infer<
  typeof patcherDesktopBrowserControlOperationSchema
>;

/**
 * `generation` carries the same optional staleness check an interaction does,
 * and matters for the same narrow case: an `evaluate` naming a ref that a newer
 * snapshot has since reassigned.
 */
export const patcherDesktopBrowserControlRequestSchema = z
  .object({
    tabId: z.string().min(1),
    generation: z.number().int().nonnegative().optional(),
    operation: patcherDesktopBrowserControlOperationSchema,
  })
  .strict();
export type PatcherDesktopBrowserControlRequest = z.infer<
  typeof patcherDesktopBrowserControlRequestSchema
>;

/**
 * What direct control answers with.
 *
 * An evaluated value crosses as JSON **text** rather than as a value: what a
 * page returns is page-shaped, and a schema that tried to describe it would
 * either reject something legitimate or accept everything. Text with a length
 * cap and a truncation flag says exactly as much as is true.
 *
 * Not `.strict()`, like the results above.
 */
export const patcherDesktopBrowserControlResultSchema = z.union([
  z.discriminatedUnion("kind", [
    z.object({
      ok: z.literal(true),
      kind: z.literal("acted"),
      ...patcherDesktopBrowserObservedPageSchema,
    }),
    z.object({
      ok: z.literal(true),
      kind: z.literal("evaluated"),
      ...patcherDesktopBrowserObservedPageSchema,
      /** `JSON.stringify` of what the expression returned, or `undefined`. */
      value: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_EVAL_RESULT_LENGTH),
      truncated: z.boolean(),
    }),
    z.object({
      ok: z.literal(true),
      kind: z.literal("routes"),
      ...patcherDesktopBrowserObservedPageSchema,
      routes: z
        .array(patcherDesktopBrowserRouteStateSchema)
        .max(PATCHER_DESKTOP_BROWSER_MAX_ROUTES),
      /**
       * Reported alongside the routes because it answers the same question a
       * caller is usually asking by then: why is this page not loading.
       */
      offline: z.boolean(),
    }),
  ]),
  z.object({
    ok: z.literal(false),
    /**
     * `no-view` / `no-page` / `debugger-unavailable` / `stale-refs` /
     * `unknown-ref` as elsewhere.
     * `evaluation-failed` — the page ran the expression and it threw, which is
     * the caller's to fix rather than the browser's.
     * `too-many-routes` — the tab already holds as many as it will.
     */
    reason: z
      .enum([
        "no-view",
        "no-page",
        "debugger-unavailable",
        "stale-refs",
        "unknown-ref",
        "evaluation-failed",
        "too-many-routes",
        "failed",
      ])
      .catch("failed"),
    message: z.string().max(1024).optional(),
  }),
]);
export type PatcherDesktopBrowserControlResult = z.infer<
  typeof patcherDesktopBrowserControlResultSchema
>;

/**
 * Caps on a recording. `MAX_VIDEO_BASE64_LENGTH` is the one doing the work: it
 * is what the shell stops filming at, and the frame count and per-frame cap are
 * only there so no single number can be missed.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAMES = 300;
export const PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAME_BASE64_LENGTH = 262_144;
export const PATCHER_DESKTOP_BROWSER_MAX_VIDEO_BASE64_LENGTH = 16_777_216;
export const PATCHER_DESKTOP_BROWSER_MAX_VIDEO_CHAPTERS = 50;
export const PATCHER_DESKTOP_BROWSER_MAX_CHAPTER_TITLE_LENGTH = 200;
export const PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FPS = 30;

/**
 * Filming a tab.
 *
 * The one automation union with no exact twin on the agent wire: that one also
 * carries `trace-start` / `trace-stop`, which the app answers itself. A trace is
 * the app's log of the commands *it* executed, and the shell could not produce
 * it if it wanted to — a `navigate` arriving here looks the same whether an
 * agent or the user's omnibox sent it.
 */
export const patcherDesktopBrowserRecordOperationSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("video-start"),
      /**
       * Frames kept per second. Chromium sends one per paint; the rest are
       * acknowledged and dropped, because an unacknowledged frame stops the
       * screencast dead.
       */
      fps: z.number().int().min(1).max(PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FPS),
    }),
    z.object({
      kind: z.literal("video-chapter"),
      title: z
        .string()
        .min(1)
        .max(PATCHER_DESKTOP_BROWSER_MAX_CHAPTER_TITLE_LENGTH),
    }),
    z.object({ kind: z.literal("video-stop") }),
  ],
);
export type PatcherDesktopBrowserRecordOperation = z.infer<
  typeof patcherDesktopBrowserRecordOperationSchema
>;

export const patcherDesktopBrowserRecordRequestSchema = z
  .object({
    tabId: z.string().min(1),
    operation: patcherDesktopBrowserRecordOperationSchema,
  })
  .strict();
export type PatcherDesktopBrowserRecordRequest = z.infer<
  typeof patcherDesktopBrowserRecordRequestSchema
>;

const patcherDesktopBrowserVideoFrameSchema = z.object({
  /** Milliseconds since the recording started. */
  at: z.number().int().nonnegative(),
  base64: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAME_BASE64_LENGTH),
});
export type PatcherDesktopBrowserVideoFrame = z.infer<
  typeof patcherDesktopBrowserVideoFrameSchema
>;

/**
 * What filming answers with. The frames are JPEG, in order, each stamped with
 * where it belongs in time — everything an encoder needs and nothing that
 * pretends to be a video file. Not `.strict()`, like the results above.
 */
export const patcherDesktopBrowserRecordResultSchema = z.union([
  z.discriminatedUnion("kind", [
    z.object({
      ok: z.literal(true),
      kind: z.literal("recording"),
      ...patcherDesktopBrowserObservedPageSchema,
      active: z.boolean(),
    }),
    z.object({
      ok: z.literal(true),
      kind: z.literal("video"),
      ...patcherDesktopBrowserObservedPageSchema,
      frames: z
        .array(patcherDesktopBrowserVideoFrameSchema)
        .max(PATCHER_DESKTOP_BROWSER_MAX_VIDEO_FRAMES),
      chapters: z
        .array(
          z.object({
            at: z.number().int().nonnegative(),
            title: z
              .string()
              .max(PATCHER_DESKTOP_BROWSER_MAX_CHAPTER_TITLE_LENGTH),
          }),
        )
        .max(PATCHER_DESKTOP_BROWSER_MAX_VIDEO_CHAPTERS),
      /**
       * Frames Chromium sent that this did not keep — the pacing threw most of
       * them away, and the caps may have ended the recording early. Without the
       * number a short film reads as a still page.
       */
      droppedFrames: z.number().int().nonnegative(),
      durationMs: z.number().int().nonnegative(),
    }),
  ]),
  z.object({
    ok: z.literal(false),
    /**
     * `no-view` / `no-page` / `debugger-unavailable` as elsewhere.
     * `already-recording` — one film per tab; stop it before starting another.
     * `not-recording` — nothing to stop, or to mark a chapter in.
     */
    reason: z
      .enum([
        "no-view",
        "no-page",
        "debugger-unavailable",
        "already-recording",
        "not-recording",
        "failed",
      ])
      .catch("failed"),
    message: z.string().max(1024).optional(),
  }),
]);
export type PatcherDesktopBrowserRecordResult = z.infer<
  typeof patcherDesktopBrowserRecordResultSchema
>;

export type PatcherDesktopBrowserStateHandler = (
  state: PatcherDesktopBrowserState,
) => void;
export type PatcherDesktopBrowserFaviconHandler = (
  favicon: PatcherDesktopBrowserFavicon,
) => void;
/**
 * A search the page's context menu asked for. The query is the raw selection,
 * capped: the renderer turns it into a URL with the same search engine the
 * omnibox uses, which is the only place that knows what it is.
 */
export const patcherDesktopBrowserSearchSelectionSchema = z
  .object({
    tabId: z.string().min(1),
    query: z.string().min(1).max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
  })
  .strict();
export type PatcherDesktopBrowserSearchSelection = z.infer<
  typeof patcherDesktopBrowserSearchSelectionSchema
>;
export type PatcherDesktopBrowserSearchSelectionHandler = (
  request: PatcherDesktopBrowserSearchSelection,
) => void;

/**
 * Page styles plugins have contributed, pushed renderer → main and held by the
 * shell.
 *
 * A whole-list replacement rather than an add/remove pair: the renderer already
 * knows the complete set, and reconciling two incremental streams against what
 * a document currently carries is a bug waiting for a reload to expose it.
 *
 * Held here rather than applied per navigation from the renderer because this is
 * where the navigation is. Inserted CSS lives exactly one document (measured on
 * Electron 41.7.0), so every committed navigation re-applies whatever matches —
 * which the shell can do the moment the page commits, while a renderer round trip
 * could not.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_PAGE_STYLES = 64;

/** Longest stylesheet one style may carry; mirrors the plugin API's cap. */
export const PATCHER_DESKTOP_BROWSER_MAX_PAGE_STYLE_CSS_LENGTH = 64_000;

export const patcherDesktopBrowserPageStyleSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    styleId: z.string().min(1).max(128),
    /** URL globs; the same dialect route patterns are written in. */
    matches: z.array(z.string().min(1).max(2_048)).min(1).max(16),
    css: z
      .string()
      .min(1)
      .max(PATCHER_DESKTOP_BROWSER_MAX_PAGE_STYLE_CSS_LENGTH),
  })
  .strict();
export type PatcherDesktopBrowserPageStyle = z.infer<
  typeof patcherDesktopBrowserPageStyleSchema
>;

export const patcherDesktopBrowserPageStylesSchema = z
  .object({
    styles: z
      .array(patcherDesktopBrowserPageStyleSchema)
      .max(PATCHER_DESKTOP_BROWSER_MAX_PAGE_STYLES),
  })
  .strict();
export type PatcherDesktopBrowserPageStyles = z.infer<
  typeof patcherDesktopBrowserPageStylesSchema
>;

/**
 * Page scripts plugins have contributed, pushed renderer → main and held by the
 * shell.
 *
 * A whole-list replacement for the same reason a page style's list is, and held
 * by the shell for a sharper one: a script has to be handed to a document as it
 * is created, before the page's own first script runs, and the only process that
 * is present at that moment is this one. A renderer round trip there is not late,
 * it is impossible.
 *
 * The scripts are handed to a *browsed* renderer, which is untrusted, so what
 * crosses is source text and a plugin id — never a token, never a handle. What
 * the script can ask for comes back through
 * {@link patcherDesktopBrowserPageScriptCallSchema}, one method at a time.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPTS = 64;

/** Longest script one registration may carry; mirrors the plugin API's cap. */
export const PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPT_CODE_LENGTH = 64_000;

export const patcherDesktopBrowserPageScriptSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    scriptId: z.string().min(1).max(128),
    /** URL globs; the same dialect route patterns are written in. */
    matches: z.array(z.string().min(1).max(2_048)).min(1).max(16),
    code: z
      .string()
      .min(1)
      .max(PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPT_CODE_LENGTH),
  })
  .strict();
export type PatcherDesktopBrowserPageScript = z.infer<
  typeof patcherDesktopBrowserPageScriptSchema
>;

export const patcherDesktopBrowserPageScriptsSchema = z
  .object({
    scripts: z
      .array(patcherDesktopBrowserPageScriptSchema)
      .max(PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPTS),
  })
  .strict();
export type PatcherDesktopBrowserPageScripts = z.infer<
  typeof patcherDesktopBrowserPageScriptsSchema
>;

/**
 * Longest rpc input or result a page script may pass. Both directions cross two
 * process boundaries as text, so this is a size the wire can carry rather than a
 * size a database row can hold: a page script asks its plugin questions, and a
 * plugin with a large answer has `patcher.http.route` for it.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPT_JSON_LENGTH = 128_000;

/**
 * A page script asking its own plugin something, forwarded main → renderer.
 *
 * The shell cannot answer this itself: reaching a plugin means an authenticated
 * call to the Patcher server, and the shell deliberately holds no credentials for it.
 * So the trusted renderer performs the call, which also puts a second check in
 * the path — it re-derives from its own contribution list that this plugin really
 * does claim this page.
 *
 * `url` is the frame's address as **the shell** resolved it, never as the page
 * claimed it. That is what makes the check meaningful: a browsed renderer that
 * lied about where it was would be answering for a page it is not on.
 */
export const patcherDesktopBrowserPageScriptCallSchema = z
  .object({
    callId: z.string().min(1).max(64),
    tabId: z.string().min(1),
    pluginId: z.string().min(1).max(128),
    method: z.string().min(1).max(128),
    /** The rpc input, already JSON text — the shell never inspects it. */
    input: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPT_JSON_LENGTH),
    url: z.string().min(1).max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type PatcherDesktopBrowserPageScriptCall = z.infer<
  typeof patcherDesktopBrowserPageScriptCallSchema
>;
export type PatcherDesktopBrowserPageScriptCallHandler = (
  call: PatcherDesktopBrowserPageScriptCall,
) => void;

/**
 * The answer to one {@link patcherDesktopBrowserPageScriptCallSchema}, renderer →
 * main, on its way to the page that asked.
 *
 * `message` is shown to nobody: it becomes the rejection reason of the promise
 * the page script is awaiting, which is the only place it can be acted on. It
 * therefore says what the *script author* did wrong, and nothing about Patcher.
 */
export const patcherDesktopBrowserPageScriptResultSchema = z.discriminatedUnion(
  "ok",
  [
    z
      .object({
        callId: z.string().min(1).max(64),
        ok: z.literal(true),
        result: z
          .string()
          .max(PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPT_JSON_LENGTH),
      })
      .strict(),
    z
      .object({
        callId: z.string().min(1).max(64),
        ok: z.literal(false),
        message: z.string().max(1024),
      })
      .strict(),
  ],
);
export type PatcherDesktopBrowserPageScriptResult = z.infer<
  typeof patcherDesktopBrowserPageScriptResultSchema
>;

/**
 * What a browsed page's preload is told at document start: one world per plugin
 * that claims this address, each with the scripts to run in it.
 *
 * Types only, no schema: this direction is the shell answering, and the shell is
 * the one process in the path that is trusted. The reverse direction —
 * {@link patcherDesktopPageScriptRpcRequestSchema} — is parsed, because it comes from
 * a renderer that is sharing an address space with a website.
 *
 * `worldId` is assigned by the shell and is stable per plugin, so two scripts of
 * one plugin share globals and two plugins never do.
 */
export interface PatcherDesktopPageScriptWorld {
  pluginId: string;
  worldId: number;
  scripts: { scriptId: string; code: string }[];
}

export interface PatcherDesktopPageScriptBootstrap {
  worlds: PatcherDesktopPageScriptWorld[];
}

/** One `patcher.rpc(...)` from a page script, page → main. */
export const patcherDesktopPageScriptRpcRequestSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    method: z.string().min(1).max(128),
    /** The input, already JSON text; the preload serialised it. */
    input: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_PAGE_SCRIPT_JSON_LENGTH),
  })
  .strict();
export type PatcherDesktopPageScriptRpcRequest = z.infer<
  typeof patcherDesktopPageScriptRpcRequestSchema
>;

/**
 * The answer to one. Always resolves — a refusal is `ok: false` with a message
 * for the script's author, never a rejected invoke, because an invoke rejection
 * reaches a page as an opaque Electron string.
 */
export type PatcherDesktopPageScriptRpcAnswer =
  | { ok: true; result: string }
  | { ok: false; message: string };

/**
 * Context-menu entries plugins have contributed, pushed renderer → main and
 * held by the shell.
 *
 * Declared ahead of time rather than asked for on right-click, and that is the
 * whole design: a menu that waited on the server before opening would lag every
 * right-click by a round trip. The shell composes what it already has, and the
 * *click* is what travels back.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_CONTEXT_MENU_ITEMS = 20;

export const patcherDesktopBrowserContextMenuItemSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    itemId: z.string().min(1).max(128),
    title: z.string().min(1).max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
    /** Any match shows the item; empty means every context. */
    when: z
      .object({
        image: z.boolean(),
        link: z.boolean(),
        page: z.boolean(),
        selection: z.boolean(),
      })
      .strict(),
  })
  .strict();
export type PatcherDesktopBrowserContextMenuItem = z.infer<
  typeof patcherDesktopBrowserContextMenuItemSchema
>;

export const patcherDesktopBrowserContextMenuItemsSchema = z
  .object({
    items: z
      .array(patcherDesktopBrowserContextMenuItemSchema)
      .max(PATCHER_DESKTOP_BROWSER_MAX_CONTEXT_MENU_ITEMS),
  })
  .strict();
export type PatcherDesktopBrowserContextMenuItems = z.infer<
  typeof patcherDesktopBrowserContextMenuItemsSchema
>;

/** A plugin entry the user picked, with what it was picked on. */
export const patcherDesktopBrowserContextMenuInvokeSchema = z
  .object({
    pluginId: z.string().min(1).max(128),
    itemId: z.string().min(1).max(128),
    tabId: z.string().min(1),
    pageUrl: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    linkUrl: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH).nullable(),
    imageUrl: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH).nullable(),
    selectionText: z
      .string()
      .max(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH)
      .nullable(),
  })
  .strict();
export type PatcherDesktopBrowserContextMenuInvoke = z.infer<
  typeof patcherDesktopBrowserContextMenuInvokeSchema
>;
export type PatcherDesktopBrowserContextMenuInvokeHandler = (
  invoke: PatcherDesktopBrowserContextMenuInvoke,
) => void;

/**
 * Cap on a find query. A find bar is a phrase, not a document: Chromium itself
 * stops being useful long before this, and the string crosses a process
 * boundary on every keystroke.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_FIND_QUERY_LENGTH = 256;

/**
 * What to do with a tab's find session.
 *
 * `start` begins or restarts the search — the find bar sends one per keystroke,
 * which is what makes it search as you type. `next` and `previous` step through
 * the matches of the session already running. `stop` ends it and drops the
 * highlights.
 */
export const patcherDesktopBrowserFindActionSchema = z.enum([
  "start",
  "next",
  "previous",
  "stop",
]);
export type PatcherDesktopBrowserFindAction = z.infer<
  typeof patcherDesktopBrowserFindActionSchema
>;

/**
 * One find command for one tab.
 *
 * The query rides every action rather than being remembered by the shell,
 * because Chromium's own find takes the text on each call — a `next` that
 * carried no text would have nothing to search for. An empty query ends the
 * session whatever the action says: searching for nothing is not a search.
 */
export const patcherDesktopBrowserFindRequestSchema = z
  .object({
    tabId: z.string().min(1),
    action: patcherDesktopBrowserFindActionSchema,
    query: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_FIND_QUERY_LENGTH),
  })
  .strict();
export type PatcherDesktopBrowserFindRequest = z.infer<
  typeof patcherDesktopBrowserFindRequestSchema
>;

/**
 * How a tab's find session is going, pushed main → renderer.
 *
 * Chromium counts matches while it scans, so several of these arrive for one
 * query and the count climbs; `finalUpdate` marks the last. The renderer shows
 * every one of them — a counter that only appeared at the end would look frozen
 * on a long page — and the shell drops results belonging to a superseded
 * request, so a stale count never lands on a newer query.
 */
export const patcherDesktopBrowserFindResultSchema = z
  .object({
    tabId: z.string().min(1),
    /** 1-based position of the highlighted match; 0 when there are none. */
    activeMatchOrdinal: z.number().int().min(0),
    matches: z.number().int().min(0),
    finalUpdate: z.boolean(),
  })
  .strict();
export type PatcherDesktopBrowserFindResult = z.infer<
  typeof patcherDesktopBrowserFindResultSchema
>;
export type PatcherDesktopBrowserFindResultHandler = (
  result: PatcherDesktopBrowserFindResult,
) => void;

/**
 * How many tabs may claim real popups at once. A surface declares its whole tab
 * list, so this is the same cap the tab list itself lives under.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_POPUP_TABS = 200;

/**
 * The tabs whose pages get **real** popups — windows Chromium creates, with a
 * live `window.opener` and a handle `window.open()` can return.
 *
 * Declared by the renderer because only it knows which of its surfaces is a
 * browser. A thread panel's browser tab opens links by the user's own
 * in-app-link preference, which may send them to the system browser, and an
 * opener means nothing there; the browser surface owns its tabs and can host
 * one. A tab not on this list keeps the older behaviour — the popup is denied
 * and its URL pushed over as a plain new tab.
 *
 * Replaces the previous set, so the caller owns the whole list.
 */
export const patcherDesktopBrowserPopupTabsSchema = z
  .object({
    tabIds: z
      .array(z.string().min(1))
      .max(PATCHER_DESKTOP_BROWSER_MAX_POPUP_TABS),
  })
  .strict();
export type PatcherDesktopBrowserPopupTabs = z.infer<
  typeof patcherDesktopBrowserPopupTabsSchema
>;

/**
 * A popup the shell created and is holding, or one that closed itself.
 *
 * `opened` carries a tab id the **shell** chose, which is the reversal that
 * makes real popups possible: every other tab exists because the renderer asked
 * for one, while a popup exists the moment `window.open()` returns — the page
 * has the handle before the app has heard of it. The renderer's job is to adopt
 * the id, not to invent one.
 *
 * `closed` is the other half. A page closing its own popup (`window.close()`,
 * which is how every OAuth flow ends) has to remove the tab, and only the shell
 * sees it happen.
 */
export const patcherDesktopBrowserPopupSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("opened"),
      /** The tab whose page called `window.open()`. */
      openerTabId: z.string().min(1),
      /** The shell's id for the new tab; the renderer must use this one. */
      tabId: z.string().min(1),
      /** Where it is going, for the tab the renderer creates. */
      url: z.string().max(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    })
    .strict(),
  z
    .object({
      kind: z.literal("closed"),
      tabId: z.string().min(1),
    })
    .strict(),
]);
export type PatcherDesktopBrowserPopup = z.infer<
  typeof patcherDesktopBrowserPopupSchema
>;
export type PatcherDesktopBrowserPopupHandler = (
  popup: PatcherDesktopBrowserPopup,
) => void;

/**
 * Open or close Chromium's own DevTools for a tab, and say where to draw them.
 *
 * The panel is **real DevTools** — Elements, Console, Network, Sources — hosted
 * in a second native view the shell owns, rather than a re-implementation of
 * them. So the renderer's whole job is to reserve the space and report the rect,
 * exactly as it does for the page itself; `bounds` is in the same coordinate
 * space as {@link patcherDesktopBrowserSetBoundsRequestSchema}, and re-sending with
 * `open: true` is how a resize is reported.
 *
 * The cost is stated where it is paid: DevTools holds Chromium's only protocol
 * client, so while this is open the automation commands on that tab answer
 * `debugger-unavailable`.
 */
export const patcherDesktopBrowserDevToolsRequestSchema = z
  .object({
    tabId: z.string().min(1),
    open: z.boolean(),
    bounds: patcherDesktopBrowserViewBoundsSchema,
  })
  .strict();
export type PatcherDesktopBrowserDevToolsRequest = z.infer<
  typeof patcherDesktopBrowserDevToolsRequestSchema
>;

/**
 * Whether the app's DevTools panel is on screen for a tab, renderer → main.
 *
 * A separate statement from {@link patcherDesktopBrowserDevToolsRequestSchema}, which
 * says whether the tools are *open*. Open and on screen part company whenever
 * the app draws something where the page was: it hides the page view to draw a
 * load-error screen in the page's rect, and the shell — seeing only that the
 * page went away — used to take the panel with it, leaving a tab whose network
 * failure could not be inspected.
 *
 * A shell that predates this channel never hears it and keeps tying the panel to
 * the page, which is the behaviour it already had; an app that never sends it
 * gets the same. That is the whole of the negotiation — see
 * {@link PatcherDesktopBrowserApi.setDevToolsVisible}.
 */
export const patcherDesktopBrowserDevToolsVisibleRequestSchema = z
  .object({
    tabId: z.string().min(1),
    visible: z.boolean(),
  })
  .strict();
export type PatcherDesktopBrowserDevToolsVisibleRequest = z.infer<
  typeof patcherDesktopBrowserDevToolsVisibleRequestSchema
>;

/**
 * Whether a tab's DevTools are open, pushed main → renderer.
 *
 * Not merely an echo: DevTools can open without the app asking — "Inspect" from
 * the page's context menu — and can close from its own toolbar. Either way the
 * renderer has to find out, because it owns the space the panel occupies.
 */
export const patcherDesktopBrowserDevToolsStateSchema = z
  .object({
    tabId: z.string().min(1),
    open: z.boolean(),
  })
  .strict();
export type PatcherDesktopBrowserDevToolsState = z.infer<
  typeof patcherDesktopBrowserDevToolsStateSchema
>;
export type PatcherDesktopBrowserDevToolsStateHandler = (
  state: PatcherDesktopBrowserDevToolsState,
) => void;

export type PatcherDesktopBrowserDownloadHandler = (
  download: PatcherDesktopBrowserDownload,
) => void;
export type PatcherDesktopBrowserOpenTabHandler = (
  request: PatcherDesktopBrowserOpenTabRequest,
) => void;
export type PatcherDesktopBrowserScopedOpenTabHandler = (
  request: PatcherDesktopBrowserScopedOpenTabRequest,
) => void;
export type PatcherDesktopBrowserExternalUrlsPendingHandler = () => void;
export type PatcherDesktopBrowserSnapshotHandler = (
  snapshot: PatcherDesktopBrowserSnapshot,
) => void;
export type PatcherDesktopBrowserUnsubscribe = () => void;

export interface PatcherDesktopBrowserApi {
  /** Create (or reuse) and show the view for `tabId`, loading `url` if non-empty. */
  attach(request: PatcherDesktopBrowserAttachRequest): void;
  /** Destroy the view for `tabId` (tears down its `webContents`). */
  detach(tabId: string): void;
  navigate(request: PatcherDesktopBrowserNavigateRequest): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reload(tabId: string): void;
  stop(tabId: string): void;
  setBounds(request: PatcherDesktopBrowserSetBoundsRequest): void;
  setVisible(request: PatcherDesktopBrowserSetVisibleRequest): void;
  /** Subscribe to navigation-state pushes for every view in this window. */
  onState(
    listener: PatcherDesktopBrowserStateHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /** Subscribe to popup requests that should open as a new in-panel browser tab. */
  onOpenTab(
    listener: PatcherDesktopBrowserOpenTabHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Subscribe to popup requests with the originating browser tab id. Optional
   * for version skew with desktop shells that predate source-attributed popups.
   */
  onScopedOpenTab?(
    listener: PatcherDesktopBrowserScopedOpenTabHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Take the links macOS handed the shell because Patcher is the user's default
   * browser, emptying the queue as they are taken.
   *
   * Optional for the same version skew as
   * {@link PatcherDesktopBrowserApi.onScopedOpenTab}: an older shell has no queue and
   * feature-detection is the negotiation. Call it once when a surface mounts —
   * that is the cold-start path, where the click that launched Patcher arrived before
   * this renderer existed — and again on
   * {@link PatcherDesktopBrowserApi.onExternalUrlsPending}.
   */
  takeExternalUrls?(): Promise<string[]>;
  /**
   * Subscribe to "there are links waiting" nudges, for the case where Patcher was
   * already running when the user clicked one. Carries no payload on purpose:
   * the queue is the single source, so a nudge that raced a mount cannot open
   * the same link twice.
   */
  onExternalUrlsPending?(
    listener: PatcherDesktopBrowserExternalUrlsPendingHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Subscribe to resize-burst snapshot pushes. Optional purely for version
   * skew: the SPA routinely attaches to an older desktop shell whose preload
   * predates snapshots (see the wire-freeze note on
   * {@link patcherDesktopBrowserAttachRequestSchema}); callers feature-detect and
   * fall back to the bare panel background during resizes.
   */
  onSnapshot?(
    listener: PatcherDesktopBrowserSnapshotHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Subscribe to tab favicon pushes. Optional for the same version skew as
   * {@link PatcherDesktopBrowserApi.onSnapshot} — an older shell's preload has no
   * favicon channel — and feature-detection here is the negotiation that lets
   * the icon ride a new channel instead of a new field on the wire-frozen state.
   * Callers fall back to a generic icon.
   */
  onFavicon?(
    listener: PatcherDesktopBrowserFaviconHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Print a tab's page, which opens the OS print dialog.
   *
   * Optional for the same version skew as {@link PatcherDesktopBrowserApi.onFavicon}.
   * Nothing comes back: whether the user printed, saved to PDF or cancelled is
   * between them and the dialog, and none of the three is this browser's
   * business. For a document a *program* wants, `page.observe` with a `pdf`
   * observation renders one without a dialog at all.
   */
  print?(request: PatcherDesktopBrowserTabRef): void;
  /**
   * Scale a tab's page. Optional for the same version skew as
   * {@link PatcherDesktopBrowserApi.onFavicon}; a caller that finds it missing has
   * an older shell and leaves zoom alone rather than pretending to change it.
   */
  setZoom?(request: PatcherDesktopBrowserSetZoomRequest): void;
  /**
   * Silence a tab's page. Optional for the same version skew as
   * {@link PatcherDesktopBrowserApi.onFavicon}.
   *
   * No push back, unlike zoom: this renderer is the only one who mutes, and
   * Chromium never decides on its own that a page should be silent. What it does
   * decide on its own is whether a page is *playing*, and that is a different
   * question this channel deliberately does not answer.
   */
  setMuted?(request: PatcherDesktopBrowserSetMutedRequest): void;
  /**
   * Replace the page styles this window's plugins have declared. The shell holds
   * them and re-applies whatever matches on every committed navigation.
   *
   * Optional for the same version skew as {@link PatcherDesktopBrowserApi.onFavicon}:
   * a renderer that finds it missing has an older shell, and the honest
   * consequence is that page styles do nothing — there is no second path to
   * them, which is why this is feature-detected rather than assumed.
   */
  setPageStyles?(request: PatcherDesktopBrowserPageStyles): void;
  /**
   * Replace the page scripts this window's plugins have declared. The shell
   * hands whatever matches to each document as it is created.
   *
   * Feature-detected like {@link PatcherDesktopBrowserApi.setPageStyles}, and with a
   * consequence worth stating: while this list is empty the shell installs no
   * preload in the browsing session at all, so a user with no page-script plugin
   * runs exactly the browser they ran before the feature existed.
   */
  setPageScripts?(request: PatcherDesktopBrowserPageScripts): void;
  /**
   * Subscribe to page scripts calling their own plugin's rpc. Every call must be
   * answered with {@link PatcherDesktopBrowserApi.respondToPageScriptCall} — the page
   * script is awaiting a promise that nothing else will settle.
   */
  onPageScriptCall?(
    listener: PatcherDesktopBrowserPageScriptCallHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /** Answer one page-script call. A late answer is dropped, not delivered. */
  respondToPageScriptCall?(result: PatcherDesktopBrowserPageScriptResult): void;
  /**
   * Subscribe to what the shell knows about a tab's connection — see
   * {@link patcherDesktopBrowserPageSecuritySchema}. Pushed on every committed
   * navigation, so the omnibox never describes the previous page.
   *
   * Optional for the same version skew as {@link PatcherDesktopBrowserApi.onFavicon}:
   * a renderer that finds it missing knows only what the URL says, which is what
   * every build knew before.
   */
  onPageSecurity?(
    listener: PatcherDesktopBrowserPageSecurityHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Subscribe to what a tab's zoom became.
   *
   * Needed as well as {@link PatcherDesktopBrowserApi.setZoom} because the renderer
   * is not the only one who changes it: Chromium remembers zoom per site and
   * restores it when a tab navigates there, so a page can arrive already
   * scaled by a decision the user made on a different tab.
   */
  onZoom?(
    listener: PatcherDesktopBrowserZoomHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Subscribe to downloads a browsed page started. Optional for the same
   * version skew as {@link PatcherDesktopBrowserApi.onFavicon}: a shell that
   * predates downloads has no such channel, and — because that shell also
   * *denied* every download — a caller that finds no `onDownload` is correctly
   * told there is nothing to report rather than being left waiting for events
   * that will never come.
   */
  onDownload?(
    listener: PatcherDesktopBrowserDownloadHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Open a download, or reveal it in the OS file manager. Optional for the same
   * version skew as {@link PatcherDesktopBrowserApi.onDownload}, and paired with it:
   * a shell with no downloads has nothing to open, so a caller that finds no
   * `onDownload` will never have a path to pass here either.
   *
   * Never rejects — an unopenable file comes back as `ok: false`.
   */
  downloadAction?(
    request: PatcherDesktopBrowserDownloadActionRequest,
  ): Promise<PatcherDesktopBrowserDownloadActionResult>;
  /**
   * Freeze and hide the page so the app can draw over it — see
   * {@link patcherDesktopBrowserSetOverlayRequestSchema}. Optional for version skew:
   * against a shell that predates it the caller simply gets no overlay, so a
   * floating panel would be invisible and must fall back to taking layout
   * space.
   */
  setOverlay?(request: PatcherDesktopBrowserSetOverlayRequest): void;
  /**
   * Give the page the whole window, or give the chrome back — see
   * {@link patcherDesktopBrowserSetFullscreenRequestSchema}. Optional for version
   * skew: against a shell that predates it the page simply stays where it is.
   */
  setFullscreen?(request: PatcherDesktopBrowserSetFullscreenRequest): void;
  /**
   * Subscribe to "Search for …" from a browsed page's context menu. Optional
   * for version skew, like the rest: an older shell simply never offers the
   * menu item.
   */
  onSearchSelection?(
    listener: PatcherDesktopBrowserSearchSelectionHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Hand the shell the plugin context-menu entries it should offer. Replaces
   * the previous set, so the caller owns the whole list.
   */
  setContextMenuItems?(request: PatcherDesktopBrowserContextMenuItems): void;
  /** Subscribe to a plugin entry being picked. */
  onContextMenuInvoke?(
    listener: PatcherDesktopBrowserContextMenuInvokeHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Declare which tabs get real popups — see
   * {@link patcherDesktopBrowserPopupTabsSchema}. A caller that never calls this
   * keeps the older behaviour for every tab, which is why it is safe for a
   * surface that is not a browser to ignore it entirely.
   */
  setPopupTabs?(request: PatcherDesktopBrowserPopupTabs): void;
  /**
   * Subscribe to popups the shell created for those tabs, and to their
   * closing. Optional for version skew: a shell that predates it denies every
   * popup and pushes the URL instead, which is what the open-tab channels are.
   */
  onPopup?(
    listener: PatcherDesktopBrowserPopupHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Open or close Chromium's own DevTools for a tab, and place them — see
   * {@link patcherDesktopBrowserDevToolsRequestSchema}. Optional for version skew: a
   * shell that predates it has no DevTools to place, so a caller that finds no
   * `setDevTools` must not reserve space for a panel that will never appear.
   */
  setDevTools?(request: PatcherDesktopBrowserDevToolsRequest): void;
  /**
   * Report whether the DevTools panel is on screen for a tab — see
   * {@link patcherDesktopBrowserDevToolsVisibleRequestSchema}. Optional for version
   * skew, and the feature detection is the negotiation: an app that finds no
   * `setDevToolsVisible` says nothing, and the shell keeps tying the panel to
   * the page exactly as it did before this existed.
   */
  setDevToolsVisible?(
    request: PatcherDesktopBrowserDevToolsVisibleRequest,
  ): void;
  /**
   * Subscribe to a tab's DevTools opening or closing, including when something
   * other than this app did it.
   */
  onDevToolsState?(
    listener: PatcherDesktopBrowserDevToolsStateHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Drive a tab's find bar — see
   * {@link patcherDesktopBrowserFindRequestSchema}. Fire-and-forget, like the
   * navigation commands: the count comes back on
   * {@link PatcherDesktopBrowserApi.onFindResult} rather than as an answer, because
   * one query produces several as Chromium scans.
   *
   * Optional for the same version skew as the pushes above: a shell that
   * predates find has no such channel, and a caller that finds no `find` must
   * not offer a find bar that would do nothing.
   */
  find?(request: PatcherDesktopBrowserFindRequest): void;
  /**
   * Subscribe to find counts. Paired with {@link PatcherDesktopBrowserApi.find}: a
   * shell that has one has the other.
   */
  onFindResult?(
    listener: PatcherDesktopBrowserFindResultHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Read what a tab is currently showing — url, title, rendered text and the
   * user's selection.
   *
   * The only request/response method on this API; every other command is
   * fire-and-forget because nothing needed an answer until agents did. It never
   * rejects: transport, parse and page failures all come back as `ok: false`.
   *
   * The request is `tabId` and nothing else, deliberately. Any per-call knob
   * (a length, a selector, a format) would have to reach the script injected
   * into an untrusted page, which is a script-injection surface inside our own
   * privileged snippet. Limits are compile-time constants; a caller wanting less
   * trims what it gets back.
   *
   * Optional for the same version skew as {@link PatcherDesktopBrowserApi.onSnapshot}
   * and {@link PatcherDesktopBrowserApi.onFavicon}: an older shell's preload has no
   * read-page channel, and feature-detecting this method is the negotiation that
   * lets page reads ride a new channel instead of widening a wire-frozen request.
   * This is that pattern's first request/response instance.
   */
  readPage?(tabId: string): Promise<PatcherDesktopBrowserPageReadResult>;
  /**
   * Accessibility snapshot of the tab, with a ref on every interactive element,
   * for agents that need to act on the page rather than only read it.
   *
   * Optional for the same version skew as {@link PatcherDesktopBrowserApi.readPage}:
   * a shell that predates the browser debugger has no such channel, and callers
   * feature-detect rather than assume.
   */
  snapshot?(
    request: PatcherDesktopBrowserSnapshotRequest,
  ): Promise<PatcherDesktopBrowserSnapshotResult>;
  /**
   * The same snapshot, of the element a CSS selector matches and its subtree.
   *
   * Its own method for the reason given on
   * {@link patcherDesktopBrowserSnapshotInRequestSchema}: the unscoped request is
   * frozen and strict, so the selector could not be added to it. Answers with
   * the same result — including replacing the tab's ref table, since a snapshot
   * of part of a page hands out refs exactly as one of the whole page does.
   */
  snapshotIn?(
    request: PatcherDesktopBrowserSnapshotInRequest,
  ): Promise<PatcherDesktopBrowserSnapshotResult>;
  /**
   * Subscribe to JavaScript dialogs the shell has taken over, and to their
   * closing (`dialog: null`). Optional for version skew, like the pushes above.
   *
   * A tab whose debugger is not attached never emits these — its dialogs are
   * still Chromium's own native modals, which is what keeps ordinary browsing
   * unchanged until an agent touches the tab.
   */
  onDialog?(
    listener: PatcherDesktopBrowserDialogHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Answer the dialog a tab is blocked on. Resolves false when the tab has no
   * dialog open — including when another answer won the race.
   */
  respondToDialog?(
    request: PatcherDesktopBrowserDialogRespondRequest,
  ): Promise<boolean>;
  /**
   * Subscribe to the questions the network asks and only a human can answer —
   * an authentication challenge, an untrusted certificate, a request for a
   * client certificate. See
   * {@link patcherDesktopBrowserPagePromptDetailsSchema}.
   *
   * Optional for the same version skew as the pushes above. A shell that
   * predates it does not merely fail to ask: it cancels every one of these,
   * which is what made them silent dead ends.
   */
  onPagePrompt?(
    listener: PatcherDesktopBrowserPagePromptHandler,
  ): PatcherDesktopBrowserUnsubscribe;
  /**
   * Answer the prompt a tab is waiting on. Resolves false when there was
   * nothing to answer — including when the prompt had already been replaced.
   */
  respondToPagePrompt?(
    answer: PatcherDesktopBrowserPagePromptAnswer,
  ): Promise<boolean>;
  /**
   * Act on the page — click, fill, press, and the rest — addressing elements by
   * the refs a {@link PatcherDesktopBrowserApi.snapshot} handed out.
   *
   * Waits for the element to be actionable before acting, so a caller does not
   * have to poll or sleep; the wait is what turns an action from a race into a
   * command. Optional for the same version skew as the methods above.
   */
  interact?(
    request: PatcherDesktopBrowserInteractRequest,
  ): Promise<PatcherDesktopBrowserInteractResult>;
  /**
   * Look at a tab without touching it — screenshot, PDF, console log, network
   * log.
   *
   * The one automation method that never attaches the browser debugger, which
   * is why it works on a tab the user is simply browsing and leaves that tab's
   * dialogs on Chromium's native path. Optional for the same version skew as
   * the methods above.
   */
  observe?(
    request: PatcherDesktopBrowserObserveRequest,
  ): Promise<PatcherDesktopBrowserObserveResult>;
  /**
   * Capture the whole document, however far it scrolls.
   *
   * The exception to everything said about `observe` above: this is the one
   * capture that attaches the browser debugger, because Electron's own
   * `capturePage` gives back the composited view and a composited view is the
   * viewport. It stops there, though — it never enables the `Page` domain, so a
   * tab filmed this way keeps its dialogs on Chromium's native path.
   *
   * Its own method for the reason given on
   * {@link patcherDesktopBrowserCaptureFullPageRequestSchema}. Optional for the same
   * version skew as the methods above.
   */
  captureFullPage?(
    request: PatcherDesktopBrowserCaptureFullPageRequest,
  ): Promise<PatcherDesktopBrowserCaptureFullPageResult>;
  /**
   * Read or write what a tab has stored — its cookies, its `localStorage` and
   * its `sessionStorage`.
   *
   * Attaches no debugger either, for the same reason `observe` does not. It is
   * the one method whose *results* are credentials rather than page content;
   * see {@link patcherDesktopBrowserStorageOperationSchema}. Optional for the same
   * version skew as the methods above.
   */
  storage?(
    request: PatcherDesktopBrowserStorageRequest,
  ): Promise<PatcherDesktopBrowserStorageResult>;
  /**
   * Drive a tab directly — evaluate JavaScript in it, move and click by
   * coordinate, mock what it receives from the network, take it offline.
   *
   * The one method on this API whose members are grouped by how much they hand
   * over rather than by what they do; see
   * {@link patcherDesktopBrowserControlOperationSchema}. Optional for the same
   * version skew as the methods above.
   */
  control?(
    request: PatcherDesktopBrowserControlRequest,
  ): Promise<PatcherDesktopBrowserControlResult>;
  /**
   * Film a tab — start a screencast, mark a chapter in it, stop and collect the
   * frames.
   *
   * The frames come back at the end rather than streaming, which is what keeps
   * the caps meaningful: the shell holds a bounded buffer and hands over what it
   * held. Optional for the same version skew as the methods above.
   */
  record?(
    request: PatcherDesktopBrowserRecordRequest,
  ): Promise<PatcherDesktopBrowserRecordResult>;
}
