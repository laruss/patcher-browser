import { z } from "zod";

/**
 * The vocabulary an agent uses to drive the browser surface.
 *
 * It lives in `@patcher/domain` because both ends need it and neither owns it: the
 * server sends commands (`@patcher/server-contract` wraps these in a WS signal), the
 * app executes them against its tab store and the Electron bridge, and the app
 * sends outcomes back (`clientMessageSchema` in ./change-kinds.ts wraps those).
 *
 * Commands originate from a language model, so they are untrusted input and get
 * parsed like any other wire payload rather than trusted because they came from
 * "our own" server.
 *
 * Unlike the desktop IPC contract (invariant 2 in
 * docs/architecture/bb-migration.md) this wire carries no version skew: the
 * server serves the SPA, so both ends always ship together.
 */

/** Mirrors PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH; the two must not drift. */
export const BROWSER_COMMAND_MAX_URL_LENGTH = 4096;
export const BROWSER_COMMAND_MAX_TITLE_LENGTH = 1024;
/**
 * Upper bound on text one `page.get_text` may return. The shell caps what it
 * reads out of a page; this caps what an agent may ask to keep, and a caller
 * wanting less passes a smaller `maxLength`.
 */
export const BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH = 65_536;
/** Mirrors PATCHER_DESKTOP_BROWSER_MAX_SELECTOR_LENGTH. */
export const BROWSER_COMMAND_MAX_SELECTOR_LENGTH = 1024;

/**
 * What the browser knows about one surface tab.
 *
 * `live` is the load-bearing one: a tab only has a native view once it has been
 * the active tab while the browser surface was mounted. Tab bookkeeping works
 * for every tab; reading a page or replaying its history only works for a live
 * one. When `live` is false the navigation flags are false because they are
 * unknown, not because the answer is no.
 */
export const browserTabSnapshotSchema = z.object({
  tabId: z.string().min(1),
  url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
  title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
  active: z.boolean(),
  live: z.boolean(),
  loading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
});
export type BrowserTabSnapshot = z.infer<typeof browserTabSnapshotSchema>;

/**
 * A null `tabId` means "the active tab" everywhere it appears, so an agent that
 * has not tracked tab ids can still work the browser it is looking at.
 */
const optionalTabIdSchema = z.string().min(1).nullable();

/**
 * Caps on what an interaction carries. These mirror the desktop contract's
 * (`PATCHER_DESKTOP_BROWSER_MAX_FILL_TEXT_LENGTH` and its neighbours) and must not
 * drift: this schema is the agent-facing wire and that one is the shell wire,
 * and the app translates between them without re-checking sizes.
 */
export const BROWSER_COMMAND_MAX_FILL_TEXT_LENGTH = 8_192;
export const BROWSER_COMMAND_MAX_TYPE_TEXT_LENGTH = 1_024;
export const BROWSER_COMMAND_MAX_UPLOAD_FILES = 10;
export const BROWSER_COMMAND_MAX_SELECT_VALUES = 20;
export const BROWSER_COMMAND_MAX_VIEWPORT_SIZE = 10_000;

const browserRefSchema = z.string().regex(/^e[1-9][0-9]{0,5}$/u);
const browserKeyModifierSchema = z.enum(["Alt", "Control", "Meta", "Shift"]);

/**
 * What to do to a page, addressed through the `[ref=eN]` markers a snapshot
 * handed out.
 *
 * Structurally identical to the desktop contract's interaction union so the app
 * forwards it rather than rebuilding it field by field — the two are separate
 * because only one of them is version-skewed (the shell can be older than the
 * SPA), not because they say different things.
 */
export const browserInteractionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("click"),
    ref: browserRefSchema,
    button: z.enum(["left", "middle", "right"]),
    clickCount: z.union([z.literal(1), z.literal(2)]),
    modifiers: z.array(browserKeyModifierSchema).max(4),
  }),
  z.object({ action: z.literal("hover"), ref: browserRefSchema }),
  z.object({
    action: z.literal("drag"),
    ref: browserRefSchema,
    targetRef: browserRefSchema,
  }),
  z.object({
    action: z.literal("fill"),
    ref: browserRefSchema,
    text: z.string().max(BROWSER_COMMAND_MAX_FILL_TEXT_LENGTH),
  }),
  z.object({
    action: z.literal("type"),
    ref: browserRefSchema,
    text: z.string().max(BROWSER_COMMAND_MAX_TYPE_TEXT_LENGTH),
  }),
  z.object({
    action: z.literal("press"),
    ref: browserRefSchema.nullable(),
    key: z.string().min(1).max(64),
  }),
  z.object({
    action: z.literal("select"),
    ref: browserRefSchema,
    values: z
      .array(z.string().max(BROWSER_COMMAND_MAX_TYPE_TEXT_LENGTH))
      .min(1)
      .max(BROWSER_COMMAND_MAX_SELECT_VALUES),
  }),
  z.object({
    action: z.literal("check"),
    ref: browserRefSchema,
    checked: z.boolean(),
  }),
  z.object({
    action: z.literal("upload"),
    ref: browserRefSchema,
    paths: z
      .array(z.string().min(1).max(1024))
      .min(1)
      .max(BROWSER_COMMAND_MAX_UPLOAD_FILES),
  }),
  z.object({
    action: z.literal("resize"),
    width: z.number().int().nonnegative().max(BROWSER_COMMAND_MAX_VIEWPORT_SIZE),
    height: z
      .number()
      .int()
      .nonnegative()
      .max(BROWSER_COMMAND_MAX_VIEWPORT_SIZE),
  }),
]);
export type BrowserInteraction = z.infer<typeof browserInteractionSchema>;

/**
 * Caps on observations. These mirror the desktop contract's
 * (`PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH` and its neighbours) and
 * must not drift, for the same reason the interaction caps must not: the app
 * forwards a value parsed here straight into the schema parsed there.
 */
export const BROWSER_COMMAND_MAX_SCREENSHOT_BASE64_LENGTH = 8_388_608;
export const BROWSER_COMMAND_MAX_PDF_BASE64_LENGTH = 16_777_216;
export const BROWSER_COMMAND_MAX_OBSERVATION_ENTRIES = 500;
export const BROWSER_COMMAND_MAX_CONSOLE_TEXT_LENGTH = 4096;

/**
 * What to look at, without touching the page.
 *
 * Structurally identical to the desktop contract's observation union — with one
 * deliberate exception, `fullPage`. That flag is why the executor rebuilds the
 * screenshot member instead of forwarding it: the shell's copy of this union is
 * frozen and does not have it, and a shell would *strip* it rather than refuse
 * it, which is the failure mode a mirrored union exists to prevent. A full-page
 * capture goes down its own channel; see `patcherDesktopBrowserCaptureFullPageRequestSchema`.
 */
export const browserObservationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("screenshot"),
    format: z.enum(["png", "jpeg"]),
    quality: z.number().int().min(1).max(100),
    /**
     * The whole document rather than the visible viewport.
     *
     * The one observation that attaches the browser debugger, because a
     * composited capture is a viewport by construction. Required rather than
     * optional so that every caller states which of the two it wants — the two
     * pictures differ in what they show *and* in what they cost.
     */
    fullPage: z.boolean(),
  }),
  z.object({ kind: z.literal("pdf") }),
  z.object({
    kind: z.literal("console"),
    limit: z.number().int().min(1).max(BROWSER_COMMAND_MAX_OBSERVATION_ENTRIES),
  }),
  z.object({
    kind: z.literal("network"),
    limit: z.number().int().min(1).max(BROWSER_COMMAND_MAX_OBSERVATION_ENTRIES),
  }),
]);
export type BrowserObservation = z.infer<typeof browserObservationSchema>;

const browserConsoleEntrySchema = z.object({
  level: z.enum(["debug", "info", "warning", "error"]),
  text: z.string().max(BROWSER_COMMAND_MAX_CONSOLE_TEXT_LENGTH),
  source: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
  line: z.number().int().nonnegative(),
  timestamp: z.number().int().nonnegative(),
});
export type BrowserConsoleEntry = z.infer<typeof browserConsoleEntrySchema>;

const browserNetworkEntrySchema = z.object({
  method: z.string().max(16),
  url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
  resourceType: z.string().max(32),
  status: z.number().int().nullable(),
  fromCache: z.boolean(),
  error: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
  timestamp: z.number().int().nonnegative(),
});
export type BrowserNetworkEntry = z.infer<typeof browserNetworkEntrySchema>;

/**
 * Caps on stored state, mirroring the desktop contract's for the same reason
 * the observation caps do.
 */
export const BROWSER_COMMAND_MAX_COOKIES = 200;
export const BROWSER_COMMAND_MAX_COOKIE_NAME_LENGTH = 256;
export const BROWSER_COMMAND_MAX_COOKIE_VALUE_LENGTH = 4096;
export const BROWSER_COMMAND_MAX_STORAGE_ITEMS = 500;
export const BROWSER_COMMAND_MAX_STORAGE_VALUE_LENGTH = 65_536;

/** Playwright's `storageState` cookie, which is the format we read and write. */
export const browserCookieSchema = z.object({
  name: z.string().max(BROWSER_COMMAND_MAX_COOKIE_NAME_LENGTH),
  value: z.string().max(BROWSER_COMMAND_MAX_COOKIE_VALUE_LENGTH),
  domain: z.string().max(BROWSER_COMMAND_MAX_COOKIE_NAME_LENGTH),
  path: z.string().max(BROWSER_COMMAND_MAX_COOKIE_NAME_LENGTH),
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(["Strict", "Lax", "None"]),
});
export type BrowserCookie = z.infer<typeof browserCookieSchema>;

export const browserStorageItemSchema = z.object({
  name: z.string().max(BROWSER_COMMAND_MAX_COOKIE_NAME_LENGTH),
  value: z.string().max(BROWSER_COMMAND_MAX_STORAGE_VALUE_LENGTH),
});
export type BrowserStorageItem = z.infer<typeof browserStorageItemSchema>;

export const browserStorageAreaSchema = z.enum(["local", "session"]);
export type BrowserStorageArea = z.infer<typeof browserStorageAreaSchema>;

/**
 * What to do to a tab's stored state. Structurally identical to the desktop
 * contract's storage union, for the reason the other two unions are.
 *
 * Reading this is reading credentials: cookie values come back in the clear
 * because a session cookie without its value restores nothing.
 */
export const browserStorageOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cookies-get") }),
  z.object({
    kind: z.literal("cookies-set"),
    cookies: z
      .array(browserCookieSchema)
      .min(1)
      .max(BROWSER_COMMAND_MAX_COOKIES),
  }),
  z.object({
    kind: z.literal("cookies-clear"),
    name: z
      .string()
      .min(1)
      .max(BROWSER_COMMAND_MAX_COOKIE_NAME_LENGTH)
      .nullable(),
  }),
  z.object({ kind: z.literal("items-get"), area: browserStorageAreaSchema }),
  z.object({
    kind: z.literal("items-set"),
    area: browserStorageAreaSchema,
    items: z
      .array(browserStorageItemSchema)
      .min(1)
      .max(BROWSER_COMMAND_MAX_STORAGE_ITEMS),
  }),
  z.object({
    kind: z.literal("items-clear"),
    area: browserStorageAreaSchema,
    name: z
      .string()
      .min(1)
      .max(BROWSER_COMMAND_MAX_COOKIE_NAME_LENGTH)
      .nullable(),
  }),
]);
export type BrowserStorageOperation = z.infer<
  typeof browserStorageOperationSchema
>;

/**
 * Caps on direct control, mirroring the desktop contract's for the reason the
 * others do.
 */
export const BROWSER_COMMAND_MAX_ROUTES = 20;
export const BROWSER_COMMAND_MAX_ROUTE_PATTERN_LENGTH = 1024;
export const BROWSER_COMMAND_MAX_ROUTE_BODY_LENGTH = 262_144;
export const BROWSER_COMMAND_MAX_ROUTE_HEADERS = 20;
export const BROWSER_COMMAND_MAX_EVAL_EXPRESSION_LENGTH = 8_192;
export const BROWSER_COMMAND_MAX_EVAL_RESULT_LENGTH = 65_536;
export const BROWSER_COMMAND_MAX_WHEEL_DELTA = 100_000;

/** A response a tab should be given instead of the one the network would. */
export const browserRouteSchema = z.object({
  pattern: z.string().min(1).max(BROWSER_COMMAND_MAX_ROUTE_PATTERN_LENGTH),
  status: z.number().int().min(100).max(599),
  contentType: z.string().max(256),
  body: z.string().max(BROWSER_COMMAND_MAX_ROUTE_BODY_LENGTH),
  headers: z
    .array(
      z.object({
        name: z.string().min(1).max(256),
        value: z.string().max(4096),
      }),
    )
    .max(BROWSER_COMMAND_MAX_ROUTE_HEADERS),
});
export type BrowserRoute = z.infer<typeof browserRouteSchema>;

const browserRouteStateSchema = browserRouteSchema.extend({
  matched: z.number().int().nonnegative(),
});
export type BrowserRouteState = z.infer<typeof browserRouteStateSchema>;

/**
 * Driving a tab past the paths that make the other commands safe: the caller's
 * own JavaScript in a page that may hold live logins, input at raw coordinates
 * that skips every actionability check, and control of what the page receives
 * from the network. Structurally identical to the desktop contract's control
 * union, for the reason the other three unions are.
 */
export const browserControlOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mouse-move"),
    x: z.number().int().nonnegative().max(BROWSER_COMMAND_MAX_VIEWPORT_SIZE),
    y: z.number().int().nonnegative().max(BROWSER_COMMAND_MAX_VIEWPORT_SIZE),
  }),
  z.object({
    kind: z.literal("mouse-button"),
    button: z.enum(["left", "middle", "right"]),
    down: z.boolean(),
  }),
  z.object({
    kind: z.literal("mouse-wheel"),
    deltaX: z
      .number()
      .int()
      .min(-BROWSER_COMMAND_MAX_WHEEL_DELTA)
      .max(BROWSER_COMMAND_MAX_WHEEL_DELTA),
    deltaY: z
      .number()
      .int()
      .min(-BROWSER_COMMAND_MAX_WHEEL_DELTA)
      .max(BROWSER_COMMAND_MAX_WHEEL_DELTA),
  }),
  z.object({
    kind: z.literal("evaluate"),
    expression: z.string().min(1).max(BROWSER_COMMAND_MAX_EVAL_EXPRESSION_LENGTH),
    ref: browserRefSchema.nullable(),
  }),
  z.object({ kind: z.literal("route-set"), route: browserRouteSchema }),
  z.object({ kind: z.literal("route-list") }),
  z.object({
    kind: z.literal("route-clear"),
    pattern: z
      .string()
      .min(1)
      .max(BROWSER_COMMAND_MAX_ROUTE_PATTERN_LENGTH)
      .nullable(),
  }),
  z.object({ kind: z.literal("offline"), offline: z.boolean() }),
]);
export type BrowserControlOperation = z.infer<
  typeof browserControlOperationSchema
>;

/**
 * Caps on a recording. The video half mirrors the desktop contract's and must
 * not drift; the trace half has no counterpart there, and that asymmetry is the
 * point — see {@link browserRecordOperationSchema}.
 */
export const BROWSER_COMMAND_MAX_TRACE_STEPS = 200;
export const BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH = 512;
/** What a trace's step images may weigh together — one screenshot's worth. */
export const BROWSER_COMMAND_MAX_TRACE_IMAGE_BASE64_LENGTH = 8_388_608;
export const BROWSER_COMMAND_MAX_VIDEO_FRAMES = 300;
export const BROWSER_COMMAND_MAX_VIDEO_FRAME_BASE64_LENGTH = 262_144;
/** What all the frames together may weigh, which is the bound that matters. */
export const BROWSER_COMMAND_MAX_VIDEO_BASE64_LENGTH = 16_777_216;
export const BROWSER_COMMAND_MAX_VIDEO_CHAPTERS = 50;
export const BROWSER_COMMAND_MAX_CHAPTER_TITLE_LENGTH = 200;
export const BROWSER_COMMAND_MAX_VIDEO_FPS = 30;

/**
 * Recording what an agent did and what the page looked like while it did it.
 *
 * The two halves record different things and live in different processes, which
 * is why this union has no exact twin in the desktop contract the way the other
 * four do. **The trace is the app's own log of the commands it executed** — it
 * spans tabs, it knows an outcome the shell never sees, and the shell could not
 * produce it anyway, because a `navigate` reaching the shell looks identical
 * whether an agent or the user's omnibox sent it. **The video is the shell's**,
 * because only the shell has the frames. So the desktop contract mirrors the
 * three `video-*` members and nothing else.
 *
 * `tabId` on the command names the tab to film; the trace is not tab-scoped and
 * ignores it.
 */
export const browserRecordOperationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("trace-start"),
    /** Capture the visible tab after each step that could have changed it. */
    screenshots: z.boolean(),
  }),
  z.object({ kind: z.literal("trace-stop") }),
  z.object({
    kind: z.literal("video-start"),
    fps: z.number().int().min(1).max(BROWSER_COMMAND_MAX_VIDEO_FPS),
  }),
  z.object({
    kind: z.literal("video-chapter"),
    title: z.string().min(1).max(BROWSER_COMMAND_MAX_CHAPTER_TITLE_LENGTH),
  }),
  z.object({ kind: z.literal("video-stop") }),
]);
export type BrowserRecordOperation = z.infer<
  typeof browserRecordOperationSchema
>;

/**
 * One command an agent issued, as the trace remembers it.
 *
 * `detail` is a rendered line rather than the command's own JSON, because the
 * JSON of a `state.load` is a set of the user's cookies and a trace is a file
 * someone saves and shares. What was typed into a field is kept — a log that
 * will not say what was filled in is not a log of what happened.
 */
const browserTraceStepSchema = z.object({
  seq: z.number().int().positive(),
  /** Milliseconds since the trace started, so a saved trace stays readable. */
  at: z.number().int().nonnegative(),
  command: z.string().max(64),
  detail: z.string().max(BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH),
  ok: z.boolean(),
  /** The failure's code, or null when the step succeeded. */
  error: z.string().max(64).nullable(),
  /** JPEG of the visible tab after the step, when the trace was asked for them. */
  image: z
    .string()
    .max(BROWSER_COMMAND_MAX_VIDEO_FRAME_BASE64_LENGTH)
    .nullable(),
});
export type BrowserTraceStep = z.infer<typeof browserTraceStepSchema>;

const browserVideoFrameSchema = z.object({
  at: z.number().int().nonnegative(),
  base64: z.string().max(BROWSER_COMMAND_MAX_VIDEO_FRAME_BASE64_LENGTH),
});
export type BrowserVideoFrame = z.infer<typeof browserVideoFrameSchema>;

const browserVideoChapterSchema = z.object({
  at: z.number().int().nonnegative(),
  title: z.string().max(BROWSER_COMMAND_MAX_CHAPTER_TITLE_LENGTH),
});

/** Chrome's own range, and the range the desktop shell enforces. */
export const BROWSER_COMMAND_MIN_ZOOM_FACTOR = 0.25;
export const BROWSER_COMMAND_MAX_ZOOM_FACTOR = 5;

export const browserCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tabs.list") }),
  z.object({
    type: z.literal("tabs.open"),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH).nullable(),
    activate: z.boolean(),
  }),
  z.object({ type: z.literal("tabs.close"), tabId: z.string().min(1) }),
  z.object({ type: z.literal("tabs.activate"), tabId: z.string().min(1) }),
  /**
   * Pin or unpin a tab, which moves it into or out of the strip's pinned block.
   *
   * Explicit rather than a toggle, so asking twice lands where asking once did —
   * a caller that cannot see the strip has no way to check first.
   */
  z.object({
    type: z.literal("tabs.pin"),
    tabId: z.string().min(1),
    pinned: z.boolean(),
  }),
  /** Silence a tab's page, or let it speak again. Explicit, like pinning. */
  z.object({
    type: z.literal("tabs.mute"),
    tabId: z.string().min(1),
    muted: z.boolean(),
  }),
  /** Copy a tab beside itself and answer with the copy. */
  z.object({ type: z.literal("tabs.duplicate"), tabId: z.string().min(1) }),
  /**
   * Move a tab to a position in the strip, counting from 0.
   *
   * The index is clamped into the tab's own block — pinned tabs lead the strip —
   * so a position past either end means "as far as it goes" rather than an error.
   */
  z.object({
    type: z.literal("tabs.move"),
    tabId: z.string().min(1),
    toIndex: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal("page.get_url"), tabId: optionalTabIdSchema }),
  z.object({ type: z.literal("page.get_title"), tabId: optionalTabIdSchema }),
  /**
   * Scale the page, and answer with what it became.
   *
   * Set-and-report rather than a separate read: Chromium clamps, and it also
   * remembers zoom per site, so what a tab ends up at is its answer to give
   * rather than the caller's to assume.
   */
  z.object({
    type: z.literal("page.zoom"),
    tabId: optionalTabIdSchema,
    factor: z
      .number()
      .min(BROWSER_COMMAND_MIN_ZOOM_FACTOR)
      .max(BROWSER_COMMAND_MAX_ZOOM_FACTOR),
  }),
  z.object({
    type: z.literal("page.get_text"),
    tabId: optionalTabIdSchema,
    maxLength: z
      .number()
      .int()
      .positive()
      .max(BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH),
  }),
  z.object({
    type: z.literal("page.get_selection"),
    tabId: optionalTabIdSchema,
  }),
  z.object({
    type: z.literal("page.handle_dialog"),
    tabId: optionalTabIdSchema,
    accept: z.boolean(),
    promptText: z.string().max(4096).nullable(),
  }),
  z.object({
    type: z.literal("page.snapshot"),
    tabId: optionalTabIdSchema,
    maxDepth: z.number().int().positive().max(100).nullable(),
    /**
     * Snapshot only what this CSS selector matches, instead of the page.
     *
     * A field here and a whole separate channel on the shell wire, which is the
     * asymmetry version skew buys: this wire ships with the server that serves
     * it, so it can grow a field; that one cannot.
     */
    selector: z
      .string()
      .min(1)
      .max(BROWSER_COMMAND_MAX_SELECTOR_LENGTH)
      .nullable(),
  }),
  z.object({
    type: z.literal("page.interact"),
    tabId: optionalTabIdSchema,
    /**
     * Which snapshot the refs came from, or null to skip the check. Navigation
     * drops every ref regardless, so this only guards the narrower case where a
     * newer snapshot has reassigned the same ref to a different element.
     */
    generation: z.number().int().nonnegative().nullable(),
    interaction: browserInteractionSchema,
  }),
  z.object({
    /**
     * Reading a tab without acting on it. Unlike every other page command this
     * one works on a tab a human is simply browsing: it attaches no debugger,
     * so that tab's dialogs stay where they were. The single exception is a
     * full-page screenshot, which cannot be taken any other way — and which
     * still stops short of taking the tab's dialogs over.
     */
    type: z.literal("page.observe"),
    tabId: optionalTabIdSchema,
    observation: browserObservationSchema,
  }),
  z.object({
    /**
     * Reading and writing what a tab has stored. Attaches no debugger either,
     * and is the one command whose results are the user's logins rather than
     * what a page rendered.
     */
    type: z.literal("page.storage"),
    tabId: optionalTabIdSchema,
    operation: browserStorageOperationSchema,
  }),
  z.object({
    /**
     * Direct control of a tab. The one command group whose members are grouped
     * by how much they hand over rather than by what they do — arbitrary
     * JavaScript in the page, coordinate input, a mocked network.
     */
    type: z.literal("page.control"),
    tabId: optionalTabIdSchema,
    /** Only `evaluate` with a ref uses it; null skips the staleness check. */
    generation: z.number().int().nonnegative().nullable(),
    operation: browserControlOperationSchema,
  }),
  z.object({
    /**
     * Recording the session — the app's log of what it was asked to do, and the
     * shell's film of what the page did about it.
     */
    type: z.literal("page.record"),
    /** The tab to film. The trace spans tabs and ignores this. */
    tabId: optionalTabIdSchema,
    operation: browserRecordOperationSchema,
  }),
  z.object({
    type: z.literal("navigation.open"),
    tabId: optionalTabIdSchema,
    url: z.string().min(1).max(BROWSER_COMMAND_MAX_URL_LENGTH),
    newTab: z.boolean(),
  }),
  z.object({ type: z.literal("navigation.back"), tabId: optionalTabIdSchema }),
  z.object({
    type: z.literal("navigation.forward"),
    tabId: optionalTabIdSchema,
  }),
  z.object({
    type: z.literal("navigation.reload"),
    tabId: optionalTabIdSchema,
  }),
]);
export type BrowserCommand = z.infer<typeof browserCommandSchema>;
export type BrowserCommandType = BrowserCommand["type"];

/**
 * Command results. Most commands answer with the tab they acted on, so the
 * agent sees the outcome (the settled URL after a navigation, say) without a
 * second round trip.
 */
export const browserCommandValueSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("tabs"),
    tabs: z.array(browserTabSnapshotSchema),
  }),
  z.object({ type: z.literal("tab"), tab: browserTabSnapshotSchema }),
  z.object({
    type: z.literal("closed"),
    closedTabId: z.string(),
    tabs: z.array(browserTabSnapshotSchema),
  }),
  z.object({ type: z.literal("url"), url: z.string() }),
  z.object({ type: z.literal("answered"), answered: z.boolean() }),
  z.object({ type: z.literal("title"), title: z.string().nullable() }),
  z.object({ type: z.literal("zoom"), factor: z.number() }),
  z.object({
    type: z.literal("text"),
    text: z.string().max(BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH),
    truncated: z.boolean(),
  }),
  z.object({
    /**
     * Where the tab ended up after the action. Clicking a link or submitting a
     * form is the common case, so answering with the page saves the caller a
     * follow-up read it would otherwise race against the navigation.
     */
    type: z.literal("interacted"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
  }),
  z.object({
    type: z.literal("image"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    mimeType: z.enum(["image/png", "image/jpeg"]),
    base64: z.string().max(BROWSER_COMMAND_MAX_SCREENSHOT_BASE64_LENGTH),
    /**
     * The captured pixels — device pixels for a viewport capture, which on a
     * retina display are twice the CSS ones, and CSS pixels for a full-page
     * capture, which is rendered at 1:1. `fullPage` is what says which.
     */
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
    fullPage: z.boolean(),
    /** A full-page capture that stopped at the height one capture can hold. */
    truncated: z.boolean(),
  }),
  z.object({
    type: z.literal("pdf"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    base64: z.string().max(BROWSER_COMMAND_MAX_PDF_BASE64_LENGTH),
    byteLength: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("console"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    entries: z
      .array(browserConsoleEntrySchema)
      .max(BROWSER_COMMAND_MAX_OBSERVATION_ENTRIES),
    /**
     * Entries the caller is not seeing, because the tab's ring buffer evicted
     * them or the requested limit cut them. A log without this number reads as
     * complete when it is not.
     */
    droppedCount: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("network"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    entries: z
      .array(browserNetworkEntrySchema)
      .max(BROWSER_COMMAND_MAX_OBSERVATION_ENTRIES),
    droppedCount: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("cookies"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    cookies: z.array(browserCookieSchema).max(BROWSER_COMMAND_MAX_COOKIES),
  }),
  z.object({
    type: z.literal("storage"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    area: browserStorageAreaSchema,
    items: z
      .array(browserStorageItemSchema)
      .max(BROWSER_COMMAND_MAX_STORAGE_ITEMS),
    /** The origin held more than the caps allow, so this is not all of it. */
    truncated: z.boolean(),
  }),
  z.object({
    /**
     * What a write landed and what the browser refused. A partial write is the
     * realistic outcome — Chromium rejects a cookie whose domain and scheme
     * disagree — and a silent one costs an hour of wondering why a restored
     * session does not work.
     */
    type: z.literal("written"),
    applied: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("removed"),
    removed: z.number().int().nonnegative(),
  }),
  z.object({
    /**
     * What an expression returned, as JSON text. Text rather than a value
     * because what a page returns is page-shaped: a schema describing it would
     * either reject something legitimate or accept anything at all.
     */
    type: z.literal("evaluated"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    value: z.string().max(BROWSER_COMMAND_MAX_EVAL_RESULT_LENGTH),
    truncated: z.boolean(),
  }),
  z.object({
    type: z.literal("routes"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    routes: z.array(browserRouteStateSchema).max(BROWSER_COMMAND_MAX_ROUTES),
    offline: z.boolean(),
  }),
  z.object({
    /** A recording is now running (or, for a chapter, still running). */
    type: z.literal("recording"),
    recording: z.enum(["trace", "video"]),
    active: z.boolean(),
  }),
  z.object({
    type: z.literal("trace"),
    steps: z
      .array(browserTraceStepSchema)
      .max(BROWSER_COMMAND_MAX_TRACE_STEPS)
      .refine(
        (steps) =>
          steps.reduce((total, step) => total + (step.image?.length ?? 0), 0) <=
          BROWSER_COMMAND_MAX_TRACE_IMAGE_BASE64_LENGTH,
        "The step images together are past what the browser bridge will carry.",
      ),
    /**
     * Steps and images the recording did not keep. A trace that silently stops
     * being complete reads as a session that stopped doing anything.
     */
    droppedSteps: z.number().int().nonnegative(),
    droppedImages: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("video"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    frames: z
      .array(browserVideoFrameSchema)
      .max(BROWSER_COMMAND_MAX_VIDEO_FRAMES)
      .refine(
        (frames) =>
          frames.reduce((total, frame) => total + frame.base64.length, 0) <=
          BROWSER_COMMAND_MAX_VIDEO_BASE64_LENGTH,
        "The frames together are past what the browser bridge will carry.",
      ),
    chapters: z
      .array(browserVideoChapterSchema)
      .max(BROWSER_COMMAND_MAX_VIDEO_CHAPTERS),
    droppedFrames: z.number().int().nonnegative(),
    durationMs: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal("snapshot"),
    tabId: z.string().min(1),
    url: z.string().max(BROWSER_COMMAND_MAX_URL_LENGTH),
    title: z.string().max(BROWSER_COMMAND_MAX_TITLE_LENGTH).nullable(),
    snapshot: z.string().max(BROWSER_COMMAND_MAX_PAGE_TEXT_LENGTH),
    /**
     * Which snapshot the refs belong to. Interaction commands will carry it
     * back so a ref from a page that has since navigated is refused rather than
     * resolved against whatever holds that node id now.
     */
    generation: z.number().int().nonnegative(),
    refCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
]);
export type BrowserCommandValue = z.infer<typeof browserCommandValueSchema>;

/**
 * Why a command could not be performed. Each one exists because it implies a
 * different next move for whoever asked — an agent that gets `tab_not_live` can
 * fix it by activating the tab, one that gets `desktop_unavailable` cannot fix
 * it at all and should say so instead of retrying.
 */
export const browserCommandErrorCodeSchema = z.enum([
  /** No tab is active, so a null tabId resolves to nothing. */
  "no_active_tab",
  /** The tab id names no open tab. */
  "unknown_tab",
  /** The tab has no native view: never activated this session, or destroyed. */
  "tab_not_live",
  /** Running outside the desktop app, where there is no browser at all. */
  "desktop_unavailable",
  /** This desktop build predates the capability (an older shell's preload). */
  "unsupported_command",
  /** The URL is not something the browser will open (http/https only). */
  "blocked_url",
  /** The page did not answer in time. */
  "page_read_timeout",
  /** The page answered with something unusable. */
  "page_read_failed",
  /** The browser debugger could not be attached — DevTools holds the tab. */
  "debugger_unavailable",
  /** The refs came from a snapshot the page has since moved past. */
  "stale_refs",
  /** No such ref in the tab's current snapshot. */
  "unknown_ref",
  /** The browser could not parse that CSS selector. */
  "invalid_selector",
  /** The selector matched nothing the accessibility tree describes. */
  "no_match",
  /** The element never became clickable: covered, hidden, disabled, moving. */
  "not_actionable",
  /** The key named is not one the browser can press. */
  "unsupported_key",
  /**
   * The screenshot or PDF was past what the bridge will carry. Nothing partial
   * is ever returned, so this is a refusal rather than a truncation.
   */
  "result_too_large",
  /** The page ran the expression and it threw — the caller's to fix. */
  "evaluation_failed",
  /** The tab already holds as many route mocks as it will. */
  "too_many_routes",
  /** A recording of that kind is already running; stop it before starting one. */
  "already_recording",
  /** Nothing to stop, or to add a chapter to. */
  "not_recording",
  /** The command or its parameters did not parse. */
  "invalid_command",
]);
export type BrowserCommandErrorCode = z.infer<
  typeof browserCommandErrorCodeSchema
>;

export const browserCommandOutcomeSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), value: browserCommandValueSchema }),
  z.object({
    ok: z.literal(false),
    code: browserCommandErrorCodeSchema,
    message: z.string().max(1024),
  }),
]);
export type BrowserCommandOutcome = z.infer<typeof browserCommandOutcomeSchema>;
