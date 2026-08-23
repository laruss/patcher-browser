import {
  Menu,
  WebContentsView,
  clipboard,
  session,
  type BrowserWindowConstructorOptions,
  type Certificate,
  type NavigationEntry,
  type Session,
  type WebContents,
} from "electron";
import {
  PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_MIME_TYPE_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH,
  clampPatcherDesktopBrowserViewBounds,
  type PatcherDesktopBrowserAttachRequest,
  type PatcherDesktopBrowserNavigateRequest,
  type PatcherDesktopBrowserOpenTabRequest,
  type PatcherDesktopBrowserScopedOpenTabRequest,
  type PatcherDesktopBrowserSetBoundsRequest,
  type PatcherDesktopBrowserSetVisibleRequest,
  type PatcherDesktopBrowserDownload,
  type PatcherDesktopBrowserDownloadActionRequest,
  type PatcherDesktopBrowserDownloadActionResult,
  type PatcherDesktopBrowserContextMenuInvoke,
  type PatcherDesktopBrowserContextMenuItem,
  type PatcherDesktopBrowserPageStyle,
  type PatcherDesktopBrowserPageStyles,
  type PatcherDesktopBrowserPageScript,
  type PatcherDesktopBrowserPageScripts,
  type PatcherDesktopBrowserPageScriptCall,
  type PatcherDesktopBrowserPageScriptResult,
  type PatcherDesktopPageScriptBootstrap,
  type PatcherDesktopPageScriptRpcAnswer,
  type PatcherDesktopPageScriptRpcRequest,
  type PatcherDesktopPageScriptWorld,
  type PatcherDesktopBrowserContextMenuItems,
  type PatcherDesktopBrowserSearchSelection,
  type PatcherDesktopBrowserSetOverlayRequest,
  type PatcherDesktopBrowserSetFullscreenRequest,
  type PatcherDesktopBrowserFavicon,
  type PatcherDesktopBrowserPageSecurity,
  type PatcherDesktopBrowserSetMutedRequest,
  type PatcherDesktopBrowserSetZoomRequest,
  type PatcherDesktopBrowserZoom,
  type PatcherDesktopBrowserFindRequest,
  type PatcherDesktopBrowserFindResult,
  PATCHER_DESKTOP_BROWSER_MAX_SNAPSHOT_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
  type PatcherDesktopBrowserDialog,
  type PatcherDesktopBrowserDialogRespondRequest,
  PATCHER_DESKTOP_BROWSER_MAX_CLIENT_CERTIFICATES,
  PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH,
  type PatcherDesktopBrowserPagePrompt,
  type PatcherDesktopBrowserPagePromptAnswer,
  type PatcherDesktopBrowserPagePromptDetails,
  type PatcherDesktopBrowserPopup,
  type PatcherDesktopBrowserPopupTabs,
  type PatcherDesktopBrowserDevToolsRequest,
  type PatcherDesktopBrowserDevToolsVisibleRequest,
  type PatcherDesktopBrowserDevToolsState,
  PATCHER_DESKTOP_BROWSER_MAX_COOKIES,
  PATCHER_DESKTOP_BROWSER_MAX_EVAL_RESULT_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_PDF_BASE64_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_ROUTES,
  PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH,
  type PatcherDesktopBrowserCaptureFullPageRequest,
  type PatcherDesktopBrowserCaptureFullPageResult,
  type PatcherDesktopBrowserConsoleEntry,
  type PatcherDesktopBrowserControlRequest,
  type PatcherDesktopBrowserControlResult,
  type PatcherDesktopBrowserRecordRequest,
  type PatcherDesktopBrowserSnapshotInRequest,
  type PatcherDesktopBrowserRecordResult,
  type PatcherDesktopBrowserRouteState,
  type PatcherDesktopBrowserInteraction,
  type PatcherDesktopBrowserInteractRequest,
  type PatcherDesktopBrowserInteractResult,
  type PatcherDesktopBrowserNetworkEntry,
  type PatcherDesktopBrowserObservation,
  type PatcherDesktopBrowserObserveRequest,
  type PatcherDesktopBrowserObserveResult,
  type PatcherDesktopBrowserPageReadResult,
  type PatcherDesktopBrowserSnapshot,
  type PatcherDesktopBrowserSnapshotRequest,
  type PatcherDesktopBrowserSnapshotResult,
  type PatcherDesktopBrowserStorageOperation,
  type PatcherDesktopBrowserStorageRequest,
  type PatcherDesktopBrowserStorageResult,
  type PatcherDesktopBrowserState,
  type PatcherDesktopBrowserViewportBounds,
  type PatcherDesktopBrowserViewBounds,
} from "@patcher/desktop-contract";
import type { AppCommandId, AppShortcutInput } from "@patcher/domain";
import { matchesBrowserUrlPattern } from "@patcher/domain/browser-url-pattern";
import {
  PATCHER_DESKTOP_BROWSER_DIALOG_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DOWNLOAD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FAVICON_CHANNEL,
  PATCHER_DESKTOP_BROWSER_ZOOM_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_SECURITY_CHANNEL,
  PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  PATCHER_DESKTOP_BROWSER_CONTEXT_MENU_INVOKE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SEARCH_SELECTION_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STATE_CHANNEL,
} from "./desktop-browser-ipc.js";
import {
  resolveBrowserFaviconDataUrl,
  resolveBrowserFaviconPageKey,
  selectBrowserFaviconUrl,
} from "./desktop-browser-favicon.js";
import { buildBrowserContextMenuTemplate } from "./desktop-browser-context-menu.js";
import {
  DOWNLOAD_RATE_MAX_IN_WINDOW,
  DOWNLOAD_RATE_WINDOW_MS,
  resolveUniqueDownloadPath,
  sanitizeDownloadFilename,
} from "./desktop-browser-download.js";
import { createCdpSession, type CdpSession } from "./desktop-browser-cdp.js";
import {
  buildBrowserSnapshot,
  findBrowserSnapshotRoot,
  type AxNode,
} from "./desktop-browser-snapshot.js";
import {
  PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
  PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS,
  PATCHER_BROWSER_ACTION_TIMEOUT_MS,
  PATCHER_BROWSER_AUTOMATION_WORLD_NAME,
  PATCHER_BROWSER_PREPARE_FILL_SCRIPT,
  PATCHER_BROWSER_READ_CHECKED_SCRIPT,
  PATCHER_BROWSER_SELECT_OPTION_SCRIPT,
  parseBrowserActionProbe,
  parseBrowserScriptOutcome,
  type BrowserActionBlockedReason,
} from "./desktop-browser-actions.js";
import {
  CDP_MODIFIER_ALT,
  CDP_MODIFIER_CONTROL,
  CDP_MODIFIER_META,
  CDP_MODIFIER_SHIFT,
  characterKeyEvent,
  parseBrowserKeyChord,
  type BrowserKeyEvent,
} from "./desktop-browser-keyboard.js";
import {
  PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT,
  parseBrowserCaptureRegion,
} from "./desktop-browser-capture.js";
import {
  PATCHER_BROWSER_OBSERVATION_BUFFER_SIZE,
  BrowserObservationLog,
  toBrowserConsoleEntry,
  toBrowserNetworkEntry,
  type BrowserConsoleMessageDetails,
  type BrowserNetworkRequestDetails,
} from "./desktop-browser-observe.js";
import {
  PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT,
  PATCHER_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS,
  PATCHER_DESKTOP_BROWSER_PAGE_READ_WORLD_ID,
  parseBrowserPageReadContent,
} from "./desktop-browser-page-read.js";
import {
  PATCHER_DESKTOP_BROWSER_PDF_READ_TIMEOUT_MS,
  isBrowserPdfContentType,
  readBrowserPdfBytes,
  type DesktopBrowserPdfTextOutcome,
} from "./desktop-browser-pdf-text.js";
import {
  formatBrowserEvalValue,
  matchBrowserRoute,
  toBrowserFulfillHeaders,
} from "./desktop-browser-control.js";
import {
  PATCHER_BROWSER_SCREENCAST_MAX_HEIGHT,
  PATCHER_BROWSER_SCREENCAST_MAX_WIDTH,
  PATCHER_BROWSER_SCREENCAST_QUALITY,
  BrowserVideoRecording,
} from "./desktop-browser-video.js";
import {
  buildBrowserStorageScript,
  parseBrowserStorageCounts,
  parseBrowserStorageItems,
  readBrowserStorageScriptError,
  toBrowserCookie,
  toBrowserSessionCookieDetails,
} from "./desktop-browser-storage.js";
import {
  browserUrlHost,
  evaluatePopupRate,
  formatBrowserAuthHost,
  isAllowedBrowserPopupTarget,
  isAllowedBrowserUrl,
  localRequestOriginKey,
  resolveRequestingFrameLocalOriginKey,
  resolveWindowOpenAction,
  shouldBlockBrowserRequest,
  shouldPromptForBrowserAuth,
} from "./desktop-browser-policy.js";

// At most this many popup → in-panel tabs may be spawned per view in a sliding
// window, so a hostile page cannot flood the panel with tabs.
const POPUP_RATE_WINDOW_MS = 10_000;
const POPUP_RATE_MAX_IN_WINDOW = 3;

/**
 * Where the isolated worlds page scripts run in start.
 *
 * High on purpose. Chromium hands out the world ids behind
 * `Page.createIsolatedWorld` — the mechanism behind Patcher's own automation world —
 * from a low counter, so starting here keeps the two apart. Measured on Electron
 * 41.7.0: with world 9001 in use, a CDP-created world came back as 5, and neither
 * could see the other's globals.
 */
const PAGE_SCRIPT_WORLD_BASE = 9001;

/** Identifies the browsing session's page-script preload, for unregistering. */
const PAGE_SCRIPT_PRELOAD_ID = "patcher-page-scripts";

/**
 * How long a page script's `patcher.rpc` waits.
 *
 * A backstop rather than a policy: the answer travels through this window's
 * renderer to the Patcher server and back, and nothing in that path has a deadline of
 * its own, so without this a plugin that never answers leaves a page script
 * awaiting a promise for the life of the tab.
 */
const PAGE_SCRIPT_CALL_TIMEOUT_MS = 30_000;

/**
 * The sliding window on `patcher.rpc`, same shape as the popup limiter above.
 *
 * Generous enough for a script answering clicks and typing, and bounded because
 * a page script in a loop would otherwise be a page driving the Patcher server.
 */
const PAGE_SCRIPT_RATE_WINDOW_MS = 10_000;
const PAGE_SCRIPT_RATE_MAX_IN_WINDOW = 60;

/**
 * How many download paths stay openable. Comfortably more than the ten the
 * renderer lists, so the list can never contain a path this has forgotten,
 * and bounded so a page downloading in a loop cannot grow it without limit.
 */
const MAX_REMEMBERED_DOWNLOAD_PATHS = 100;

/**
 * How many closed tabs can be reopened where they left off. Chromium's own
 * reopen stack is about this deep, and each entry holds a page's serialized
 * state, so this is not a list to let grow.
 */
const MAX_CLOSED_TAB_SESSIONS = 10;

/** See the `before-input-event` handler: these need the app to have focus. */
const HOST_FOCUSING_APP_COMMANDS: ReadonlySet<AppCommandId> = new Set([
  "browser.focusLocation",
  "browser.find",
  "browser.recentTab.next",
  "browser.recentTab.previous",
]);

interface ClosedTabSession {
  entries: NavigationEntry[];
  index: number;
}

/**
 * How many "I trust this certificate anyway" decisions are remembered, and for
 * how long: this session only, and never on disk. A decision to ignore a
 * certificate error is the one setting here that a user would want back if they
 * made it by mistake, so it dies with the app the way Chrome's does.
 */
const MAX_ACCEPTED_CERTIFICATES = 20;

/**
 * What the error screen says while a page is hung, and the marker that lets
 * `responsive` clear it again without clearing a real load error underneath.
 */
const PAGE_UNRESPONSIVE_ERROR_TEXT = "This page is not responding.";

/** A network question a tab is stopped on, and how to answer it. */
interface PendingPagePrompt {
  details: PatcherDesktopBrowserPagePromptDetails;
  /** Hands the decision back to Chromium. Called exactly once. */
  settle: (answer: PatcherDesktopBrowserPagePromptAnswer["answer"]) => void;
}

/** Electron's `login` answer: called with credentials, or with nothing to cancel. */
type BrowserAuthCallback = (username?: string, password?: string) => void;

/**
 * Say "not this time" to a client-certificate request.
 *
 * Declining is the one path Electron does not document: its callback wants a
 * certificate, and calling it with none is the only way to refuse. Wrapped
 * because a runtime that refuses that must not take the main process down — the
 * load then fails, which is what declining meant anyway.
 */
function declineClientCertificate(
  callback: (certificate: Certificate) => void,
): void {
  try {
    (callback as (certificate?: Certificate) => void)();
  } catch {
    // Nothing to recover: the request stays unanswered and fails.
  }
}

/**
 * A prompt as its caller writes it — the id is the shell's to assign. Written
 * out per member rather than as `Omit<Details, "id">`, because `Omit` over a
 * union keeps only the keys they share and would erase every field that makes
 * one kind different from the next.
 */
type OpenPagePromptDetails =
  PatcherDesktopBrowserPagePromptDetails extends infer TDetails
    ? TDetails extends { kind: string }
      ? Omit<TDetails, "id">
      : never
    : never;

/**
 * At the start of a resize burst the view stays visible until its snapshot
 * capture resolves (capturing a hidden view is unreliable). This cap bounds
 * how long a stalled capture may leave the stale view on screen.
 */
const RESIZE_SNAPSHOT_HIDE_CAP_MS = 80;
/** Placeholder quality: transient, stretched during the drag — favor size. */
const RESIZE_SNAPSHOT_JPEG_QUALITY = 70;

// A page can rewrite its `<link rel=icon>` from script as often as it likes, and
// each distinct URL is a fetch. The same sliding-window shape the popup limiter
// uses caps that; a page that trips it keeps whichever icon it had.
const FAVICON_FETCH_WINDOW_MS = 10_000;
const FAVICON_FETCH_MAX_IN_WINDOW = 5;

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Isolated, persistent partition for the in-app browser. Cookies/storage never
 * touch the Patcher app session (`defaultSession`) or the user's real browser.
 *
 * The name is the on-disk directory under the app's `userData`, so changing it
 * abandons whatever the old name holds. That cost was already paid: the rename
 * moved `productName` from "bb" to "Patcher", which relocates `userData`
 * itself, so no install can reach its old cookies by either name.
 * `wire-values.test.ts` pins this string — nothing else notices it changing.
 */
export const PATCHER_BROWSER_PARTITION = "persist:patcher-browser";

/**
 * `did-fail-load` reports aborted main-frame loads (a user navigating away, a
 * redirect) with this code; it is not a real error and must not surface one.
 */
const ERR_ABORTED = -3;

interface BrowserViewEntry {
  view: WebContentsView;
  /**
   * The tab and window this view belongs to, kept on the entry because
   * **session**-level events do not carry them. A `webContents` event closes
   * over both at wiring time; `will-download` arrives on the shared browsing
   * session with only a `webContents`, so the reverse lookup has to end
   * somewhere that knows where to send the result.
   */
  tabId: string;
  hostWindow: DesktopBrowserHostWindow;
  lastErrorText: string | null;
  currentMainFrameLocalOriginKey: string | null;
  /**
   * The last renderer-measured panel rect. The renderer is the placement
   * authority — it re-measures and pushes whenever its layout actually moves
   * the panel. This cache exists only so native window resizes can re-clamp
   * the view to the live window (see
   * {@link DesktopBrowserViewManager.clampVisibleBoundsForWindow}) without
   * losing the renderer's intent.
   */
  desiredBounds: PatcherDesktopBrowserViewBounds;
  popupTimestamps: number[];
  /**
   * This view is a popup the shell created, and the renderer has not adopted it
   * yet. It exists because a page called `window.open()`, so it already has its
   * page — the first `attach` must place it, not load into it, or an OAuth
   * popup would be navigated away from the flow it was opened for.
   */
  shellCreated: boolean;
  /** URL of the icon currently pushed to the renderer, for change detection. */
  faviconUrl: string | null;
  /** Page the icon was resolved for (origin); a mismatch is what makes it stale. */
  faviconPageKey: string | null;
  /** Fetch stamps behind the same sliding-window limiter the popups use. */
  faviconFetchTimestamps: number[];
  /** Download stamps behind that same limiter — see `desktop-browser-download.ts`. */
  downloadTimestamps: number[];
  /**
   * Page styles applied to the document this view is showing: `pluginId:styleId`
   * against the key `insertCSS` returned for it.
   *
   * Per document, not per view, because that is what the browser gives us —
   * inserted CSS does not survive a navigation (measured on Electron 41.7.0) —
   * so a commit clears this map without removing anything: the stylesheets went
   * with the document that held them.
   */
  appliedPageStyles: Map<string, string>;
  /**
   * Which document the map above describes, bumped on every commit.
   *
   * `insertCSS` is a promise, so a fast second navigation can land between
   * asking and being answered. Without this the answer would be filed against
   * the new document, and the style it names would be neither applied nor
   * re-appliable.
   */
  pageStyleDocument: number;
  /**
   * `patcher.rpc` stamps from page scripts running in this view, behind the same
   * sliding-window limiter the popups use.
   *
   * Per view rather than per plugin: what this bounds is how much one page can
   * ask of the Patcher server, and a page with two plugins' scripts on it is still
   * one page.
   */
  pageScriptCallTimestamps: number[];
  /**
   * The app is drawing its own chrome over the page area, so the view is
   * hidden behind a bitmap of itself. Separate from `visible`, which is the
   * renderer's layout intent: an overlay must not be forgotten when layout
   * changes underneath it, and must not survive one either.
   */
  overlayActive: boolean;
  visible: boolean;
  /**
   * Chromium's id for the find request this tab is currently showing, or null
   * when nothing is being searched for.
   *
   * Kept because one query answers many times as Chromium scans, and a query
   * the user has already typed past keeps answering after it: a result whose id
   * is not this one belongs to a search the find bar has moved on from, and
   * pushing it would make the counter jump backwards.
   */
  findRequestId: number | null;
  /**
   * CDP session, attached lazily on the first automation command. Null until
   * then, deliberately: a debugger on every tab is overhead and exposure, and
   * enabling the Page domain moves this tab's dialogs off Chromium's native
   * path, which would change what ordinary browsing looks like.
   */
  cdp: CdpSession | null;
  /**
   * The dialog this tab is blocked on, once the shell owns its dialogs. The
   * view stays hidden while one is open so the app can draw over the panel —
   * a WebContentsView composites above the DOM, so there is no other way to put
   * UI in front of the page.
   */
  pendingDialog: PatcherDesktopBrowserDialog["dialog"];
  /**
   * The network question this tab is stopped on — an authentication challenge,
   * an untrusted certificate, a request for a client certificate. Hides the
   * view exactly as a dialog does, because it is answered the same way: the app
   * draws over a frozen page.
   *
   * Separate from `pendingDialog` because it comes from the network stack
   * rather than from the page's script, and because only one of the two needs
   * the debugger attached.
   */
  pagePrompt: PendingPagePrompt | null;
  /**
   * Requests parked behind an open authentication prompt, all challenging for
   * the same realm.
   *
   * A page behind basic auth challenges **once per request** — a protected
   * directory with a stylesheet and three images is four challenges — and
   * prompting four times for one password is not what a browser does. One
   * answer settles every request parked here.
   */
  pendingAuth: { key: string; callbacks: BrowserAuthCallback[] } | null;
  /**
   * The page has taken the window through the HTML fullscreen API, so the view
   * covers the whole content area and the renderer's own rect waits in
   * `desiredBounds` for it to come back.
   */
  htmlFullscreen: boolean;
  /**
   * Whether the window was put into the OS's full screen *for* this page, and
   * therefore has to be taken back out when the page leaves it.
   *
   * A page that asked for fullscreen while the window was already there gets
   * the expansion and nothing else: the user put the window in that state and
   * only the user takes it out again.
   */
  windowFullscreenForPage: boolean;
  /**
   * The *user* asked for the page to fill the window. Held apart from
   * `htmlFullscreen` on purpose: a video leaving its own fullscreen must not
   * take the user's choice with it, and neither must the reverse.
   */
  userFullscreen: boolean;
  /**
   * The view hosting Chromium's own DevTools for this tab, or null when they
   * are closed.
   *
   * A second native view rather than a panel we draw: `setDevToolsWebContents`
   * puts the real DevTools UI — Elements, Console, Network, Sources — inside it,
   * so what the user gets is Chromium's, not an imitation. Its bounds come from
   * the renderer exactly as the page's do.
   */
  devToolsView: WebContentsView | null;
  /**
   * Whether the renderer says its DevTools panel is on screen, or null when it
   * has never said — an app built before the channel existed, or a surface that
   * hosts no panel of its own (the thread browser, where "Inspect" can still
   * open DevTools).
   *
   * Null falls back to the page's own visibility, which is all the shell had to
   * go on before: the panel is a native view, so it had to be hidden whenever
   * the page was. That fallback is wrong in one case the renderer can see and
   * the shell cannot — the page is hidden because the app is drawing its
   * "page unavailable" screen where the page was, and that screen covers the
   * page's rect, not the panel's. Chromium keeps DevTools usable on a failed
   * load, and a failed load is exactly when they are worth having.
   */
  devToolsVisible: boolean | null;
  /** Guards one-time dialog wiring per CDP session. */
  dialogsWired: boolean;
  /**
   * Execution context of the isolated world the interaction scripts run in.
   * Null until one is created, and again after any navigation — a document
   * swap destroys the world, and reusing its id would address nothing.
   */
  automationWorldId: number | null;
  /**
   * What the tab has logged and requested since it was created. Filled from
   * ordinary `webContents` and `webRequest` events rather than from CDP, so a
   * tab nobody has automated still has an answer — see
   * `desktop-browser-observe.ts` for why that decides the mechanism.
   */
  consoleLog: BrowserObservationLog<PatcherDesktopBrowserConsoleEntry>;
  networkLog: BrowserObservationLog<PatcherDesktopBrowserNetworkEntry>;
  /**
   * Requests this tab answers itself instead of fetching, newest first, and
   * whether it is pretending to be offline.
   *
   * Both live only as long as the CDP session does — Chromium drops the
   * interception and the emulation when the client detaches — so both are
   * cleared with it rather than left describing a tab that is no longer routed.
   */
  routes: PatcherDesktopBrowserRouteState[];
  /** Guards one-time `Fetch.requestPaused` wiring per CDP session. */
  routesWired: boolean;
  /** Whether the `Fetch` domain is currently on for this tab. */
  routesEnabled: boolean;
  offline: boolean;
  /**
   * The film being taken of this tab, or null when nothing is filming. Dies
   * with the CDP session for the same reason the routes do — Chromium stops the
   * screencast when its client detaches, so a recording left here would grow no
   * further and say nothing about it.
   */
  video: BrowserVideoRecording | null;
  /** Guards one-time `Page.screencastFrame` wiring per CDP session. */
  videoWired: boolean;
  /**
   * Where the vision-mode pointer is. Chromium wants a point on every mouse
   * event, while `mousedown`/`mouseup`/`mousewheel` name none — so the last
   * `mouse-move` is the point they act at, as it is in a real browser.
   */
  mousePoint: MousePoint;
  /** `ref` → backend DOM node id from the most recent snapshot of this tab. */
  snapshotRefs: Map<string, number>;
  /**
   * Bumped whenever refs are invalidated. A command carrying a ref from an older
   * generation is refused rather than resolved against whatever holds that node
   * id now — a silently wrong click is worse than a clear "re-snapshot".
   */
  snapshotGeneration: number;
}

export type DesktopBrowserHostWebContentsPayload =
  | PatcherDesktopBrowserState
  | PatcherDesktopBrowserOpenTabRequest
  | PatcherDesktopBrowserScopedOpenTabRequest
  | PatcherDesktopBrowserSnapshot
  | PatcherDesktopBrowserDialog
  | PatcherDesktopBrowserDownload
  | PatcherDesktopBrowserFavicon
  | PatcherDesktopBrowserZoom
  | PatcherDesktopBrowserPageSecurity
  | PatcherDesktopBrowserFindResult
  | PatcherDesktopBrowserPagePrompt
  | PatcherDesktopBrowserPopup
  | PatcherDesktopBrowserDevToolsState
  | PatcherDesktopBrowserSearchSelection
  | PatcherDesktopBrowserContextMenuInvoke
  | PatcherDesktopBrowserPageScriptCall;

export interface DesktopBrowserHostContentBounds {
  height: number;
  width: number;
}

export interface DesktopBrowserHostContentView {
  addChildView(view: WebContentsView): void;
  removeChildView(view: WebContentsView): void;
}

export interface DesktopBrowserHostWebContents {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: DesktopBrowserHostWebContentsPayload): void;
}

export interface DesktopBrowserHostWindow {
  contentView: DesktopBrowserHostContentView;
  getContentBounds(): DesktopBrowserHostContentBounds;
  isDestroyed(): boolean;
  /** Whether the window is in the OS's own full screen right now. */
  isFullScreen(): boolean;
  /**
   * Take the window in or out of the OS's full screen. Driven here rather than
   * by Electron's own HTML-fullscreen handling, which this view turns off — see
   * the `enter-html-full-screen` handler.
   */
  setFullScreen(fullScreen: boolean): void;
  webContents: DesktopBrowserHostWebContents;
}

export interface DispatchDesktopBrowserAppCommandArgs {
  command: AppCommandId;
  hostWebContentsId: number;
}

export interface CreateDesktopBrowserViewManagerArgs {
  dispatchAppCommand: (args: DispatchDesktopBrowserAppCommandArgs) => void;
  /**
   * Whether a path is already taken, so a download can pick the next free
   * name. Injected rather than imported: it is the only filesystem call this
   * module makes, and a manager under test must not consult a real disk.
   */
  downloadPathExists: (path: string) => boolean;
  /**
   * Turn a PDF's bytes into its text. Injected because the real one forks a
   * utility process (see desktop-browser-pdf-process.ts) and a manager under
   * test must not fork anything; the shaping and the caps around it are
   * exercised on their own in desktop-browser-pdf-text.ts.
   */
  extractPdfText: (request: {
    bytes: Uint8Array;
    timeoutMs: number;
  }) => Promise<DesktopBrowserPdfTextOutcome>;
  focusHostWebContents: (hostWebContentsId: number) => void;
  /**
   * Open a downloaded file with the OS default handler, resolving to Electron's
   * failure string (empty when it opened). Injected for the same reason the
   * filesystem check is: the manager must be drivable without opening anything
   * on the machine running its tests.
   */
  openDownloadPath: (savePath: string) => Promise<string>;
  /** Hand a link to the user's real browser. */
  openExternalUrl: (url: string) => void;
  /**
   * Whether there is a browser other than Patcher to hand a link to. Asked per
   * right-click rather than captured once: the user can change their default
   * browser while Patcher runs, and the shell hears about it on activation.
   */
  canOpenExternalUrl?: () => boolean;
  /**
   * The built `page-script-preload.cjs`, which the shell registers in the
   * browsing session while any plugin declares a page script.
   *
   * Injected rather than resolved here for the reason every other path in this
   * interface is: the manager has to be drivable in a test that has no packaged
   * app to resolve against.
   */
  pageScriptPreloadPath: string;
  partition?: string;
  /** Show a downloaded file in the OS file manager. */
  revealDownloadPath: (savePath: string) => void;
  /**
   * Where downloads are written. Read per download rather than captured once,
   * so the answer can change (a setting, a plugin) without recreating the
   * manager — this is the seam any future download policy goes through.
   */
  resolveDownloadDirectory: () => string;
  resolveAppCommand: (input: AppShortcutInput) => AppCommandId | null;
}

interface HostScopedRequestArgs<TRequest> {
  hostWindow: DesktopBrowserHostWindow;
  request: TRequest;
}

interface HostScopedTabArgs {
  hostWindow: DesktopBrowserHostWindow;
  tabId: string;
}

interface CreateEntryArgs {
  desiredBounds: PatcherDesktopBrowserViewBounds;
  hostWindow: DesktopBrowserHostWindow;
  tabId: string;
  /**
   * A view the shell already has, for a popup: Chromium made its `webContents`
   * when the page called `window.open()`, and it carries the opener link that
   * is the whole point. Omitted for every ordinary tab, which the renderer asks
   * for and this creates.
   */
  view?: WebContentsView;
}

interface HostWindowViewportBoundsArgs {
  hostWindow: DesktopBrowserHostWindow;
}

interface SetEntryDesiredBoundsArgs {
  bounds: PatcherDesktopBrowserViewBounds;
  entry: BrowserViewEntry;
  hostWindow: DesktopBrowserHostWindow;
}

export interface DesktopBrowserViewManager {
  attach(args: HostScopedRequestArgs<PatcherDesktopBrowserAttachRequest>): void;
  detach(args: HostScopedTabArgs): void;
  /**
   * Print a tab's page through the OS dialog.
   *
   * Fire and forget: the dialog's outcome — printed, saved as PDF, cancelled —
   * is the user's, and none of the three is a result this side should report as
   * success or failure. What it *is* is blocking, which is why nothing but a
   * user action may reach it (see the call site's comment).
   */
  print(args: HostScopedTabArgs): void;
  navigate(
    args: HostScopedRequestArgs<PatcherDesktopBrowserNavigateRequest>,
  ): void;
  goBack(args: HostScopedTabArgs): void;
  goForward(args: HostScopedTabArgs): void;
  reload(args: HostScopedTabArgs): void;
  stop(args: HostScopedTabArgs): void;
  /**
   * Read the tab's rendered text and selection out of the page. The one command
   * here that answers; it never rejects, reporting every failure as a typed
   * `ok: false` so the renderer can tell "no view" from "page would not talk".
   */
  readPage(
    args: HostScopedTabArgs,
  ): Promise<PatcherDesktopBrowserPageReadResult>;
  /**
   * Search the tab's page, step through what was found, or stop. The count
   * comes back on its own channel rather than from here, because one query
   * answers many times while Chromium scans.
   */
  find(args: HostScopedRequestArgs<PatcherDesktopBrowserFindRequest>): void;
  /**
   * Give the page the whole window, or give the chrome back. Whether that is
   * something to offer is the renderer's call — see
   * {@link patcherDesktopBrowserSetFullscreenRequestSchema}.
   */
  setFullscreen(
    args: HostScopedRequestArgs<PatcherDesktopBrowserSetFullscreenRequest>,
  ): void;
  /**
   * Open or close Chromium's own DevTools for a tab, and place the view they
   * draw into. Re-sending with `open: true` reports a resize.
   */
  setDevTools(
    args: HostScopedRequestArgs<PatcherDesktopBrowserDevToolsRequest>,
  ): void;
  /**
   * Report whether the app's DevTools panel is on screen for a tab — see
   * {@link BrowserViewEntry.devToolsVisible}.
   */
  setDevToolsVisible(
    args: HostScopedRequestArgs<PatcherDesktopBrowserDevToolsVisibleRequest>,
  ): void;
  /**
   * Replace the set of tabs whose pages get real popups — see
   * {@link patcherDesktopBrowserPopupTabsSchema}.
   */
  setPopupTabs(
    args: HostScopedRequestArgs<PatcherDesktopBrowserPopupTabs>,
  ): void;
  /** Replace the plugin entries offered on a browsed page's context menu. */
  setContextMenuItems(
    args: HostScopedRequestArgs<PatcherDesktopBrowserContextMenuItems>,
  ): void;
  /**
   * Replace the plugin stylesheets applied to browsed pages, and bring every
   * open page in line with the new set.
   */
  setPageStyles(
    args: HostScopedRequestArgs<PatcherDesktopBrowserPageStyles>,
  ): void;
  setPageScripts(
    args: HostScopedRequestArgs<PatcherDesktopBrowserPageScripts>,
  ): void;
  /**
   * What a browsed frame's preload should run, answered synchronously at document
   * start. `url` is the frame's address as the shell resolved it.
   */
  pageScriptBootstrap(args: {
    webContentsId: number;
    url: string;
  }): PatcherDesktopPageScriptBootstrap;
  /** One `patcher.rpc` from a page script, routed through this window's renderer. */
  pageScriptRpc(args: {
    webContentsId: number;
    url: string;
    request: PatcherDesktopPageScriptRpcRequest;
  }): Promise<PatcherDesktopPageScriptRpcAnswer>;
  /** The renderer's answer to one, on its way back to the page. */
  respondToPageScriptCall(args: {
    result: PatcherDesktopBrowserPageScriptResult;
  }): void;
  /**
   * Freeze the page to a bitmap and hide the view so the app can draw over it,
   * or reveal it again. The only way React can put anything over a page.
   */
  setOverlay(
    args: HostScopedRequestArgs<PatcherDesktopBrowserSetOverlayRequest>,
  ): void;
  /**
   * Open a finished download or show it in the file manager. Refuses any path
   * this manager did not write, which is what keeps it from being a general
   * "open this file" primitive. Never rejects.
   */
  downloadAction(
    request: PatcherDesktopBrowserDownloadActionRequest,
  ): Promise<PatcherDesktopBrowserDownloadActionResult>;
  /**
   * Accessibility snapshot with a ref on every interactive element — the
   * primitive the interaction commands address elements through. Attaches the
   * tab's CDP session on first use. Never rejects.
   */
  snapshot(
    args: HostScopedRequestArgs<PatcherDesktopBrowserSnapshotRequest>,
  ): Promise<PatcherDesktopBrowserSnapshotResult>;
  /** The same snapshot, of what a CSS selector matches. Never rejects. */
  snapshotIn(
    args: HostScopedRequestArgs<PatcherDesktopBrowserSnapshotInRequest>,
  ): Promise<PatcherDesktopBrowserSnapshotResult>;
  /**
   * Answer the JavaScript dialog a tab is blocked on. False when there is none —
   * including when a human answered it first.
   */
  respondToDialog(
    args: HostScopedRequestArgs<PatcherDesktopBrowserDialogRespondRequest>,
  ): Promise<boolean>;
  /**
   * Answer the network question a tab is stopped on. False when there was
   * nothing to answer, or when the answer names a prompt the tab has already
   * moved past.
   */
  respondToPagePrompt(
    args: HostScopedRequestArgs<PatcherDesktopBrowserPagePromptAnswer>,
  ): Promise<boolean>;
  /**
   * Act on the page through a ref from the last snapshot, waiting for the
   * element to be actionable first. Never rejects.
   */
  interact(
    args: HostScopedRequestArgs<PatcherDesktopBrowserInteractRequest>,
  ): Promise<PatcherDesktopBrowserInteractResult>;
  /**
   * Look at a tab — screenshot, PDF, console log, network log — without
   * attaching the browser debugger to it. Never rejects.
   */
  observe(
    args: HostScopedRequestArgs<PatcherDesktopBrowserObserveRequest>,
  ): Promise<PatcherDesktopBrowserObserveResult>;
  /**
   * Capture the whole document, however far it scrolls. The one capture that
   * does attach the debugger — see {@link captureFullPage}. Never rejects.
   */
  captureFullPage(
    args: HostScopedRequestArgs<PatcherDesktopBrowserCaptureFullPageRequest>,
  ): Promise<PatcherDesktopBrowserCaptureFullPageResult>;
  /**
   * Read or write a tab's cookies and web storage. Attaches no debugger either,
   * and never rejects.
   */
  storage(
    args: HostScopedRequestArgs<PatcherDesktopBrowserStorageRequest>,
  ): Promise<PatcherDesktopBrowserStorageResult>;
  /**
   * Drive a tab directly — evaluate the caller's JavaScript in it, act at raw
   * coordinates, mock its network, take it offline. Never rejects.
   */
  control(
    args: HostScopedRequestArgs<PatcherDesktopBrowserControlRequest>,
  ): Promise<PatcherDesktopBrowserControlResult>;
  /**
   * Film a tab and hand the frames back when it stops. Never rejects.
   */
  record(
    args: HostScopedRequestArgs<PatcherDesktopBrowserRecordRequest>,
  ): Promise<PatcherDesktopBrowserRecordResult>;
  setBounds(
    args: HostScopedRequestArgs<PatcherDesktopBrowserSetBoundsRequest>,
  ): void;
  setVisible(
    args: HostScopedRequestArgs<PatcherDesktopBrowserSetVisibleRequest>,
  ): void;
  /**
   * Scale a tab's page.
   *
   * Chromium persists zoom per origin inside the browsing session, so this is
   * not only a property of the tab: setting it here is also what a *later* tab
   * on the same site will come up with.
   */
  setZoom(
    args: HostScopedRequestArgs<PatcherDesktopBrowserSetZoomRequest>,
  ): void;
  /**
   * Silence a tab's page, or let it speak again.
   *
   * Mute is a property of the `webContents`, so it holds for as long as the view
   * does and no longer — a tab whose view has not been created yet has nothing
   * to silence, and this call finds no entry and does nothing. The renderer
   * re-applies it once the view exists; see `browser-tab-mute.ts` there.
   */
  setMuted(
    args: HostScopedRequestArgs<PatcherDesktopBrowserSetMutedRequest>,
  ): void;
  /**
   * Hide every visible view owned by the window for the duration of a native
   * resize burst. During an interactive window resize the host chrome
   * repaints at its own (much slower) cadence while the native views
   * composite independently — no bounds protocol keeps the two visually
   * glued, so a tracked view bleeds over neighboring UI in one direction or
   * the other. Each visible view is first captured and the bitmap pushed to
   * the renderer, which paints it inside the panel as a stand-in that scales
   * with the chrome; the view hides once its capture resolves (or after
   * {@link RESIZE_SNAPSHOT_HIDE_CAP_MS}, whichever is first). Idempotent per
   * window; renderer visibility changes made while hidden are recorded and
   * take effect on {@link endWindowResize}.
   */
  beginWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  /**
   * End a resize burst: re-apply each view's renderer-desired bounds clamped
   * to the live content bounds (bounds land before the view is shown),
   * restore renderer-declared visibility, then push a null snapshot so the
   * renderer drops its placeholder (after the reveal, so the swap never
   * flashes an empty panel). The renderer's own post-resize re-measure
   * typically lands within the caller's settle delay; if it arrives later the
   * view nudges once, which is the acceptable residue.
   */
  endWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  /**
   * Drop every view owned by a closed host window. Keyed by the host
   * `webContents.id` because the host `BrowserWindow` (and its child views) are
   * already torn down by the time `closed` fires.
   */
  releaseWindow(hostWebContentsId: number): void;
  destroyAll(): void;
}

/**
 * The key from the host's id alone.
 *
 * Needed because the teardown path cannot read the id off the window any more:
 * Electron destroys a `BrowserWindow`'s `webContents` before the child views it
 * owned finish closing, and touching any property of a destroyed one throws
 * `TypeError: Object has been destroyed`. `releaseWindow` already takes the id
 * as a number for exactly that reason.
 */
function browserViewKeyForHost(
  hostWebContentsId: number,
  tabId: string,
): string {
  return `${hostWebContentsId}:${tabId}`;
}

function browserViewKey(
  hostWindow: DesktopBrowserHostWindow,
  tabId: string,
): string {
  return browserViewKeyForHost(hostWindow.webContents.id, tabId);
}

function send(
  hostWindow: DesktopBrowserHostWindow,
  channel: string,
  payload: DesktopBrowserHostWebContentsPayload,
): void {
  if (hostWindow.isDestroyed() || hostWindow.webContents.isDestroyed()) {
    return;
  }
  hostWindow.webContents.send(channel, payload);
}

function hostWindowViewportBounds(
  args: HostWindowViewportBoundsArgs,
): PatcherDesktopBrowserViewportBounds {
  const contentBounds = args.hostWindow.getContentBounds();
  return {
    width: contentBounds.width,
    height: contentBounds.height,
  };
}

/**
 * Apply the entry's renderer-desired rect, intersected with the live window
 * content bounds. The clamp happens HERE, against the same
 * `getContentBounds()` space native resize events re-clamp in — the renderer
 * already clamped the rect to its own layout viewport, which diverges from
 * the window content area when DevTools is docked.
 */
function applyEntryDesiredBounds(
  entry: BrowserViewEntry,
  hostWindow: DesktopBrowserHostWindow,
): void {
  const viewport = hostWindowViewportBounds({ hostWindow });
  if (entry.htmlFullscreen || entry.userFullscreen) {
    // A page in HTML fullscreen gets the whole content area, app chrome
    // included — that is what fullscreen means, and the renderer's rect is
    // untouched in `desiredBounds` for when the page leaves it again. The
    // window itself is not made fullscreen: the app's window state belongs to
    // the user, not to a video player on a page.
    entry.view.setBounds({
      x: 0,
      y: 0,
      width: viewport.width,
      height: viewport.height,
    });
    return;
  }
  entry.view.setBounds(
    clampPatcherDesktopBrowserViewBounds({
      bounds: entry.desiredBounds,
      viewport,
    }),
  );
}

function setEntryDesiredBounds(args: SetEntryDesiredBoundsArgs): void {
  args.entry.desiredBounds = args.bounds;
  applyEntryDesiredBounds(args.entry, args.hostWindow);
}

function clearEntryLocalOriginState(entry: BrowserViewEntry): void {
  entry.currentMainFrameLocalOriginKey = null;
}

function commitEntryMainFrameUrl(entry: BrowserViewEntry, url: string): void {
  const committedOriginKey = localRequestOriginKey(url);
  if (committedOriginKey !== null) {
    entry.currentMainFrameLocalOriginKey = committedOriginKey;
    return;
  }
  clearEntryLocalOriginState(entry);
}

function shouldBlockEntryTopLevelRequest(
  entry: BrowserViewEntry,
  url: string,
): boolean {
  if (!isAllowedBrowserUrl(url)) {
    return true;
  }
  const webContentsId = entry.view.webContents.id;
  return shouldBlockBrowserRequest({
    url,
    method: "GET",
    resourceType: "mainFrame",
    isMainFrame: true,
    targetWebContentsId: webContentsId,
    entryWebContentsId: webContentsId,
    currentMainFrameLocalOriginKey: entry.currentMainFrameLocalOriginKey,
    requestingFrameOriginKey: null,
  });
}

/**
 * Drop the refs a previous snapshot handed out; see `snapshotGeneration`.
 *
 * The isolated world goes with them: both are addressed into a document that
 * has been replaced, and a stale world id fails far from its cause.
 */
function invalidateSnapshotRefs(entry: BrowserViewEntry): void {
  entry.automationWorldId = null;
  if (entry.snapshotRefs.size === 0) {
    return;
  }
  entry.snapshotRefs.clear();
  entry.snapshotGeneration += 1;
}

type InteractionRefusalReason = Extract<
  PatcherDesktopBrowserInteractResult,
  { ok: false }
>["reason"];

/**
 * A refusal an interaction can answer with, thrown so the many steps of an
 * action do not each have to thread a result type back out.
 */
class InteractionRefusal extends Error {
  readonly reason: InteractionRefusalReason;

  constructor(reason: InteractionRefusalReason, message: string) {
    super(message);
    this.name = "InteractionRefusal";
    this.reason = reason;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The isolated world the interaction scripts run in.
 *
 * Same reasoning as the page-read world: a page that can see our script can
 * shadow the globals it reads, and one that can shadow `getBoundingClientRect`
 * can make an actionability check pass on an element that is nowhere near where
 * we are about to click.
 */
async function ensureAutomationWorld(
  session: CdpSession,
  entry: BrowserViewEntry,
): Promise<number> {
  if (entry.automationWorldId !== null) {
    return entry.automationWorldId;
  }
  const tree = await session.send<{ frameTree?: { frame?: { id?: string } } }>(
    "Page.getFrameTree",
  );
  const frameId = tree.frameTree?.frame?.id;
  if (typeof frameId !== "string") {
    throw new InteractionRefusal("failed", "The tab has no main frame.");
  }
  const created = await session.send<{ executionContextId?: number }>(
    "Page.createIsolatedWorld",
    { frameId, worldName: PATCHER_BROWSER_AUTOMATION_WORLD_NAME },
  );
  if (typeof created.executionContextId !== "number") {
    throw new InteractionRefusal(
      "failed",
      "The tab would not create an automation context.",
    );
  }
  entry.automationWorldId = created.executionContextId;
  return created.executionContextId;
}

interface InteractionTarget {
  backendNodeId: number;
  objectId: string;
}

/**
 * Turn a `[ref=eN]` back into the node the snapshot recorded.
 *
 * The generation check happens here rather than per action, because every
 * ref-carrying command needs it and forgetting it in one branch would be a
 * silently-wrong click rather than a visible failure.
 */
function lookupSnapshotNode(
  entry: BrowserViewEntry,
  ref: string,
  generation: number | undefined,
): number {
  if (generation !== undefined && generation !== entry.snapshotGeneration) {
    throw new InteractionRefusal(
      "stale-refs",
      "The page has changed since that snapshot. Snapshot it again.",
    );
  }
  const backendNodeId = entry.snapshotRefs.get(ref);
  if (backendNodeId === undefined) {
    throw new InteractionRefusal(
      "unknown-ref",
      `No element ${ref} in the current snapshot of this tab.`,
    );
  }
  return backendNodeId;
}

/** Resolve a ref into an object the interaction scripts can be called on. */
async function resolveInteractionTarget(
  session: CdpSession,
  entry: BrowserViewEntry,
  ref: string,
  generation: number | undefined,
): Promise<InteractionTarget> {
  const backendNodeId = lookupSnapshotNode(entry, ref, generation);
  const worldId = await ensureAutomationWorld(session, entry);
  const resolved = await session
    .send<{ object?: { objectId?: string } }>("DOM.resolveNode", {
      backendNodeId,
      executionContextId: worldId,
    })
    .catch(() => null);
  const objectId = resolved?.object?.objectId;
  if (typeof objectId !== "string") {
    throw new InteractionRefusal(
      "unknown-ref",
      `Element ${ref} is no longer on the page. Snapshot it again.`,
    );
  }
  return { backendNodeId, objectId };
}

/** Run one of the constant scripts against a resolved element. */
async function callOnElement(
  session: CdpSession,
  objectId: string,
  functionDeclaration: string,
  callArguments?: { value: unknown }[],
): Promise<unknown> {
  const response = await session.send<{
    result?: { value?: unknown };
    exceptionDetails?: { text?: string };
  }>("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration,
    returnByValue: true,
    awaitPromise: true,
    ...(callArguments === undefined ? {} : { arguments: callArguments }),
  });
  if (response.exceptionDetails !== undefined) {
    throw new InteractionRefusal(
      "failed",
      `The page threw while being inspected: ${
        response.exceptionDetails.text ?? "unknown error"
      }`,
    );
  }
  return response.result?.value;
}

const BLOCKED_REASON_TEXT: Record<BrowserActionBlockedReason, string> = {
  detached: "the element left the page",
  not_visible: "the element is hidden",
  unstable: "the element is still moving",
  disabled: "the element is disabled",
  offscreen: "the element is outside the viewport and would not scroll into it",
  covered: "something else is on top of the element",
};

/**
 * Wait until the element can actually be acted on, and answer with the point to
 * act at.
 *
 * This is the wait Playwright performs before every action and the reason its
 * actions are not races. Polling rather than observing: the conditions that
 * matter (an overlay's opacity, a layout settling) have no single event to
 * subscribe to, and the probe already spends two animation frames per attempt.
 */
async function waitForActionable(
  session: CdpSession,
  target: InteractionTarget,
): Promise<{ x: number; y: number }> {
  // Best-effort: an element with no layout box throws here, and the probe below
  // reports that in terms the caller can act on.
  await session
    .send("DOM.scrollIntoViewIfNeeded", { backendNodeId: target.backendNodeId })
    .catch(() => undefined);

  const deadline = Date.now() + PATCHER_BROWSER_ACTION_TIMEOUT_MS;
  let blocked: BrowserActionBlockedReason = "detached";
  for (;;) {
    const probe = parseBrowserActionProbe(
      await callOnElement(
        session,
        target.objectId,
        PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
      ),
    );
    if (probe === null) {
      throw new InteractionRefusal(
        "failed",
        "The page answered the actionability check with something unusable.",
      );
    }
    if (probe.ready) {
      return { x: probe.x, y: probe.y };
    }
    blocked = probe.reason;
    if (Date.now() >= deadline) {
      throw new InteractionRefusal(
        "not-actionable",
        `Gave up waiting for the element: ${BLOCKED_REASON_TEXT[blocked]}.`,
      );
    }
    await delay(PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS);
  }
}

const MOUSE_BUTTON_MASK: Record<string, number> = {
  left: 1,
  right: 2,
  middle: 4,
};

function modifierMask(modifiers: readonly string[]): number {
  let mask = 0;
  for (const modifier of modifiers) {
    if (modifier === "Alt") mask |= CDP_MODIFIER_ALT;
    if (modifier === "Control") mask |= CDP_MODIFIER_CONTROL;
    if (modifier === "Meta") mask |= CDP_MODIFIER_META;
    if (modifier === "Shift") mask |= CDP_MODIFIER_SHIFT;
  }
  return mask;
}

interface MousePoint {
  x: number;
  y: number;
}

async function dispatchMouse(
  session: CdpSession,
  type: string,
  point: MousePoint,
  params: Record<string, unknown> = {},
): Promise<void> {
  await session.send("Input.dispatchMouseEvent", { type, ...point, ...params });
}

/**
 * Press and release a key.
 *
 * Modifiers ride the event's bitmask rather than being pressed as their own
 * events. Pages read `event.ctrlKey`, which the mask provides; the separate
 * keydown for the modifier itself only matters to a page watching for the
 * modifier alone, which no form does.
 */
async function dispatchKey(
  session: CdpSession,
  event: BrowserKeyEvent,
): Promise<void> {
  const base = {
    modifiers: event.modifiers,
    key: event.key,
    code: event.code,
    windowsVirtualKeyCode: event.windowsVirtualKeyCode,
    nativeVirtualKeyCode: event.windowsVirtualKeyCode,
  };
  await session.send("Input.dispatchKeyEvent", {
    // `keyDown` carries text and inserts it; `rawKeyDown` is the right event for
    // a key that inserts nothing, and Chromium treats the two differently.
    type: event.text.length > 0 ? "keyDown" : "rawKeyDown",
    ...base,
    ...(event.text.length > 0
      ? { text: event.text, unmodifiedText: event.text }
      : {}),
  });
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function readCheckedState(
  session: CdpSession,
  objectId: string,
): Promise<boolean> {
  const outcome = parseBrowserScriptOutcome(
    await callOnElement(session, objectId, PATCHER_BROWSER_READ_CHECKED_SCRIPT),
  );
  if (outcome === null || !outcome.ok || outcome.checked === null) {
    throw new InteractionRefusal(
      "failed",
      "That element is not a checkbox, a radio button, or anything with a checked state.",
    );
  }
  return outcome.checked;
}

/** How long to keep re-reading a control's state after clicking it. */
const CHECKED_SETTLE_TIMEOUT_MS = 500;

async function performInteraction(
  session: CdpSession,
  entry: BrowserViewEntry,
  request: PatcherDesktopBrowserInteractRequest,
): Promise<void> {
  const interaction: PatcherDesktopBrowserInteraction = request.interaction;

  if (interaction.action === "resize") {
    // Device metrics rather than the view's bounds: the panel's size belongs to
    // the renderer's layout, and fighting it would leave the page and the panel
    // permanently out of step.
    if (interaction.width === 0 && interaction.height === 0) {
      await session.send("Emulation.clearDeviceMetricsOverride");
      return;
    }
    await session.send("Emulation.setDeviceMetricsOverride", {
      width: interaction.width,
      height: interaction.height,
      deviceScaleFactor: 0,
      mobile: false,
    });
    return;
  }

  if (interaction.action === "press" && interaction.ref === null) {
    const event = parseBrowserKeyChord(interaction.key);
    if (event === null) {
      throw new InteractionRefusal(
        "unsupported-key",
        `${JSON.stringify(interaction.key)} is not a key the browser can press.`,
      );
    }
    await dispatchKey(session, event);
    return;
  }

  // Every remaining action names an element; only `press` allows a null ref,
  // and that case returned above.
  const ref = interaction.ref;
  if (ref === null) {
    throw new InteractionRefusal("unknown-ref", "No element was named.");
  }
  const target = await resolveInteractionTarget(
    session,
    entry,
    ref,
    request.generation,
  );

  switch (interaction.action) {
    case "upload": {
      // No actionability wait: a styled upload control almost always hides the
      // real <input type=file>, so requiring it to be visible would refuse the
      // common case. CDP rejects a node that is not a file input.
      await session
        .send("DOM.setFileInputFiles", {
          files: [...interaction.paths],
          backendNodeId: target.backendNodeId,
        })
        .catch((error: unknown) => {
          throw new InteractionRefusal(
            "failed",
            `That element would not take files: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        });
      return;
    }

    case "select": {
      await waitForActionable(session, target);
      const outcome = parseBrowserScriptOutcome(
        await callOnElement(
          session,
          target.objectId,
          PATCHER_BROWSER_SELECT_OPTION_SCRIPT,
          [{ value: [...interaction.values] }],
        ),
      );
      if (outcome === null || !outcome.ok) {
        throw new InteractionRefusal(
          "failed",
          outcome?.reason === "not_select"
            ? "That element is not a dropdown."
            : "None of those values match an option in that dropdown.",
        );
      }
      return;
    }

    case "fill": {
      await waitForActionable(session, target);
      const outcome = parseBrowserScriptOutcome(
        await callOnElement(
          session,
          target.objectId,
          PATCHER_BROWSER_PREPARE_FILL_SCRIPT,
        ),
      );
      if (outcome === null || !outcome.ok) {
        throw new InteractionRefusal(
          "failed",
          "That element is not a text field.",
        );
      }
      if (interaction.text.length === 0) {
        // insertText("") inserts nothing rather than clearing the selection, so
        // an empty fill has to be a deletion.
        await dispatchKey(session, {
          key: "Delete",
          code: "Delete",
          windowsVirtualKeyCode: 46,
          text: "",
          modifiers: 0,
        });
        return;
      }
      await session.send("Input.insertText", { text: interaction.text });
      return;
    }

    case "type": {
      await waitForActionable(session, target);
      await session.send("DOM.focus", { backendNodeId: target.backendNodeId });
      // One event per character, because that is the whole difference from
      // fill: autocompletes and input masks react to keystrokes, not to a value
      // appearing.
      for (const character of Array.from(interaction.text)) {
        await dispatchKey(session, characterKeyEvent(character));
      }
      return;
    }

    case "press": {
      const event = parseBrowserKeyChord(interaction.key);
      if (event === null) {
        throw new InteractionRefusal(
          "unsupported-key",
          `${JSON.stringify(interaction.key)} is not a key the browser can press.`,
        );
      }
      await waitForActionable(session, target);
      await session.send("DOM.focus", { backendNodeId: target.backendNodeId });
      await dispatchKey(session, event);
      return;
    }

    case "hover": {
      const point = await waitForActionable(session, target);
      await dispatchMouse(session, "mouseMoved", point, { button: "none" });
      return;
    }

    case "drag": {
      const from = await waitForActionable(session, target);
      const to = await waitForActionable(
        session,
        await resolveInteractionTarget(
          session,
          entry,
          interaction.targetRef,
          request.generation,
        ),
      );
      await dispatchMouse(session, "mouseMoved", from, { button: "none" });
      await dispatchMouse(session, "mousePressed", from, {
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      // An intermediate move, because a drag that teleports never fires the
      // `dragover`/`pointermove` a drop target listens for.
      await dispatchMouse(
        session,
        "mouseMoved",
        { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 },
        { button: "left", buttons: 1 },
      );
      await dispatchMouse(session, "mouseMoved", to, {
        button: "left",
        buttons: 1,
      });
      await dispatchMouse(session, "mouseReleased", to, {
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      return;
    }

    case "check": {
      const point = await waitForActionable(session, target);
      if (
        (await readCheckedState(session, target.objectId)) ===
        interaction.checked
      ) {
        return;
      }
      await dispatchMouse(session, "mouseMoved", point, { button: "none" });
      await dispatchMouse(session, "mousePressed", point, {
        button: "left",
        buttons: 1,
        clickCount: 1,
      });
      await dispatchMouse(session, "mouseReleased", point, {
        button: "left",
        buttons: 0,
        clickCount: 1,
      });
      // Confirm rather than assume: a controlled component can refuse the
      // change, and reporting success on a checkbox that did not move would be
      // the worst kind of lie to an agent.
      const deadline = Date.now() + CHECKED_SETTLE_TIMEOUT_MS;
      for (;;) {
        if (
          (await readCheckedState(session, target.objectId)) ===
          interaction.checked
        ) {
          return;
        }
        if (Date.now() >= deadline) {
          throw new InteractionRefusal(
            "failed",
            `The control did not become ${interaction.checked ? "checked" : "unchecked"}.`,
          );
        }
        await delay(PATCHER_BROWSER_ACTION_POLL_INTERVAL_MS);
      }
    }

    case "click": {
      const point = await waitForActionable(session, target);
      const modifiers = modifierMask(interaction.modifiers);
      const buttons = MOUSE_BUTTON_MASK[interaction.button] ?? 1;
      await dispatchMouse(session, "mouseMoved", point, {
        button: "none",
        modifiers,
      });
      // Chromium wants the running count on each event, so a double click is
      // press/release at 1 followed by press/release at 2 — not one event
      // claiming to be two clicks.
      for (let count = 1; count <= interaction.clickCount; count += 1) {
        await dispatchMouse(session, "mousePressed", point, {
          button: interaction.button,
          buttons,
          clickCount: count,
          modifiers,
        });
        await dispatchMouse(session, "mouseReleased", point, {
          button: interaction.button,
          buttons: 0,
          clickCount: count,
          modifiers,
        });
      }
      return;
    }

    default: {
      const exhaustive: never = interaction;
      throw new InteractionRefusal(
        "failed",
        `Unhandled interaction ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}

type ControlRefusalReason = Extract<
  PatcherDesktopBrowserControlResult,
  { ok: false }
>["reason"];

const CONTROL_REFUSAL_REASONS = new Set<string>([
  "no-view",
  "no-page",
  "debugger-unavailable",
  "stale-refs",
  "unknown-ref",
  "evaluation-failed",
  "too-many-routes",
  "failed",
]);

/**
 * The interaction and control refusal vocabularies overlap but are not the
 * same — control cannot report `not-actionable`, having skipped the check that
 * produces it, and interaction has nothing to say about routes. So the shared
 * steps (resolving a ref) keep throwing {@link InteractionRefusal} and this
 * maps it, while the control-only refusals get their own class.
 */
function controlRefusalReason(reason: string): ControlRefusalReason {
  return (
    CONTROL_REFUSAL_REASONS.has(reason) ? reason : "failed"
  ) as ControlRefusalReason;
}

class ControlRefusal extends Error {
  readonly reason: ControlRefusalReason;

  constructor(reason: ControlRefusalReason, message: string) {
    super(message);
    this.name = "ControlRefusal";
    this.reason = reason;
  }
}

/**
 * Take over this tab's requests.
 *
 * `Fetch` is enabled only while the tab holds a route and disabled the moment
 * it holds none, because an enabled `Fetch` domain pauses **every** request
 * until something answers it: an interception left on with nothing driving it
 * is a page that never loads. For the same reason the handler answers on every
 * path, including its own failure — a request that is neither fulfilled nor
 * continued hangs until the page gives up.
 */
async function applyRouteInterception(
  session: CdpSession,
  entry: BrowserViewEntry,
): Promise<void> {
  const wanted = entry.routes.length > 0;
  // The listener is attached at most once per session and left in place, while
  // the domain goes on and off with the route table. Re-subscribing on every
  // pass would mean two handlers answering the same paused request, and the
  // second answer failing against a request the first already finished.
  if (wanted && !entry.routesWired) {
    entry.routesWired = true;
    wireRouteInterception(session, entry);
  }
  if (wanted === entry.routesEnabled) {
    return;
  }
  await session.send(wanted ? "Fetch.enable" : "Fetch.disable");
  entry.routesEnabled = wanted;
}

function wireRouteInterception(
  session: CdpSession,
  entry: BrowserViewEntry,
): void {
  session.on("Fetch.requestPaused", (params) => {
    const paused = params as { requestId?: string; request?: { url?: string } };
    const requestId = paused.requestId;
    if (typeof requestId !== "string") {
      return;
    }
    const url = paused.request?.url ?? "";
    const route = matchBrowserRoute(entry.routes, url);
    const answer =
      route === null
        ? session.send("Fetch.continueRequest", { requestId })
        : session.send("Fetch.fulfillRequest", {
            requestId,
            responseCode: route.status,
            responseHeaders: toBrowserFulfillHeaders(route),
            body: Buffer.from(route.body, "utf8").toString("base64"),
          });
    if (route !== null) {
      route.matched += 1;
    }
    void answer.catch(() => {
      // The request may already be gone (the page navigated away from under
      // it), in which case continuing fails too and there is nothing left to
      // rescue.
      void session.send("Fetch.continueRequest", { requestId }).catch(() => {
        // Nothing to answer any more.
      });
    });
  });
}

/** The routes a tab holds, as the wire reports them. */
function entryRoutes(
  entry: BrowserViewEntry,
  tabId: string,
): Extract<PatcherDesktopBrowserControlResult, { kind: "routes" }> {
  return {
    ok: true,
    kind: "routes",
    tabId,
    ...entryPageIdentity(entry),
    routes: entry.routes.map((route) => ({ ...route })),
    offline: entry.offline,
  };
}

/**
 * Evaluate the caller's own JavaScript in the page.
 *
 * **In the page's world, not the isolated one** every other script here runs
 * in — which is the deliberate difference and the whole reason `eval` is worth
 * having: `window.__NEXT_DATA__`, a framework's state, a function the page
 * defined are all invisible from an isolated world, and reading them is what
 * people reach for `eval` to do. The isolated world protects our own fixed
 * scripts from a page that shadows globals; it cannot protect an expression
 * whose entire job is to touch the page.
 *
 * The expression is never spliced into a string. It crosses as CDP's
 * `functionDeclaration`, so the protocol parses it as one function and a page
 * cannot be reached through the way we sent it.
 */
async function evaluateInPage(
  session: CdpSession,
  entry: BrowserViewEntry,
  expression: string,
  ref: string | null,
  generation: number | undefined,
): Promise<{ value: string; truncated: boolean }> {
  let objectId: string;
  let callArguments: { objectId: string }[] = [];
  if (ref === null) {
    // `Runtime.evaluate` with no context id lands in the page's main world, so
    // its global object is the handle to call the caller's function on.
    const global = await session.send<{ result?: { objectId?: string } }>(
      "Runtime.evaluate",
      { expression: "globalThis" },
    );
    if (typeof global.result?.objectId !== "string") {
      throw new InteractionRefusal(
        "failed",
        "The tab has no page to evaluate in.",
      );
    }
    objectId = global.result.objectId;
  } else {
    const backendNodeId = lookupSnapshotNode(entry, ref, generation);
    // No `executionContextId`, so this resolves in the main world too — the
    // same element, addressed where the caller's code can see the page.
    const resolved = await session
      .send<{ object?: { objectId?: string } }>("DOM.resolveNode", {
        backendNodeId,
      })
      .catch(() => null);
    if (typeof resolved?.object?.objectId !== "string") {
      throw new InteractionRefusal(
        "unknown-ref",
        `Element ${ref} is no longer on the page. Snapshot it again.`,
      );
    }
    objectId = resolved.object.objectId;
    // Passed as the first argument, so `(el) => el.value` reads as it does in
    // Playwright; `this` is the element as well, for `function () { … }` form.
    callArguments = [{ objectId }];
  }

  const response = await session.send<{
    result?: { value?: unknown };
    exceptionDetails?: { text?: string; exception?: { description?: string } };
  }>("Runtime.callFunctionOn", {
    objectId,
    functionDeclaration: expression,
    arguments: callArguments,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails !== undefined) {
    // The page ran it and it threw. That is the caller's to fix, and its own
    // message is the only useful thing to say about it.
    throw new ControlRefusal(
      "evaluation-failed",
      response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        "The expression threw.",
    );
  }
  return formatBrowserEvalValue(
    response.result?.value,
    PATCHER_DESKTOP_BROWSER_MAX_EVAL_RESULT_LENGTH,
  );
}

/**
 * Perform one direct-control operation on a tab whose session is attached.
 *
 * The mouse commands are the interaction module's dispatch with the ref lookup
 * and the actionability wait taken out — which is exactly what makes them vision
 * mode: they land on whatever is at the coordinate, and nothing here checks that
 * anything is.
 */
async function performControl(
  session: CdpSession,
  entry: BrowserViewEntry,
  tabId: string,
  request: PatcherDesktopBrowserControlRequest,
): Promise<PatcherDesktopBrowserControlResult> {
  const operation = request.operation;
  const acted = (): PatcherDesktopBrowserControlResult => ({
    ok: true,
    kind: "acted",
    tabId,
    ...entryPageIdentity(entry),
  });

  switch (operation.kind) {
    case "mouse-move": {
      entry.mousePoint = { x: operation.x, y: operation.y };
      await dispatchMouse(session, "mouseMoved", entry.mousePoint, {
        button: "none",
      });
      return acted();
    }

    case "mouse-button": {
      await dispatchMouse(
        session,
        operation.down ? "mousePressed" : "mouseReleased",
        entry.mousePoint,
        {
          button: operation.button,
          buttons: operation.down
            ? (MOUSE_BUTTON_MASK[operation.button] ?? 1)
            : 0,
          clickCount: 1,
        },
      );
      return acted();
    }

    case "mouse-wheel": {
      await dispatchMouse(session, "mouseWheel", entry.mousePoint, {
        button: "none",
        deltaX: operation.deltaX,
        deltaY: operation.deltaY,
      });
      return acted();
    }

    case "evaluate": {
      if (operation.ref !== null) {
        await session.enableDomain("DOM");
      }
      const evaluated = await evaluateInPage(
        session,
        entry,
        operation.expression,
        operation.ref,
        request.generation,
      );
      return {
        ok: true,
        kind: "evaluated",
        tabId,
        ...entryPageIdentity(entry),
        ...evaluated,
      };
    }

    case "route-set": {
      const existing = entry.routes.filter(
        (route) => route.pattern !== operation.route.pattern,
      );
      if (existing.length >= PATCHER_DESKTOP_BROWSER_MAX_ROUTES) {
        throw new ControlRefusal(
          "too-many-routes",
          `This tab already holds ${PATCHER_DESKTOP_BROWSER_MAX_ROUTES} routes. Remove one first.`,
        );
      }
      // Newest first, so the route just added is the one that answers — the
      // rule Playwright follows and the one a person debugging a mock expects.
      entry.routes = [{ ...operation.route, matched: 0 }, ...existing];
      await applyRouteInterception(session, entry);
      return entryRoutes(entry, tabId);
    }

    case "route-clear": {
      entry.routes =
        operation.pattern === null
          ? []
          : entry.routes.filter((route) => route.pattern !== operation.pattern);
      await applyRouteInterception(session, entry);
      return entryRoutes(entry, tabId);
    }

    case "route-list":
      return entryRoutes(entry, tabId);

    default: {
      // Per tab rather than per session: `Network.emulateNetworkConditions` is
      // scoped to the target, so one tab can be offline while the user keeps
      // browsing in the next one.
      await session.enableDomain("Network");
      await session.send("Network.emulateNetworkConditions", {
        offline: operation.offline,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      entry.offline = operation.offline;
      return acted();
    }
  }
}

/** The two ways a scoped snapshot refuses, thrown out of the selector lookup. */
class SnapshotRefusal extends Error {
  readonly reason: "invalid-selector" | "no-match";

  constructor(reason: "invalid-selector" | "no-match", message: string) {
    super(message);
    this.name = "SnapshotRefusal";
    this.reason = reason;
  }
}

/**
 * The backend node id of the element a CSS selector matches.
 *
 * Backend ids rather than the DOM agent's own: those are what the accessibility
 * tree carries, and matching them is how a selector reaches a snapshot at all.
 */
async function resolveSelectorNode(
  session: CdpSession,
  selector: string,
): Promise<number> {
  await session.enableDomain("DOM");
  // The DOM agent only knows nodes it has handed out, so the document has to be
  // fetched before anything can be queried against it. Depth 0: the only node
  // needed is the one the query starts from.
  const document = await session.send<{ root?: { nodeId?: number } }>(
    "DOM.getDocument",
    { depth: 0 },
  );
  const rootNodeId = document.root?.nodeId;
  if (typeof rootNodeId !== "number") {
    throw new Error("The tab would not describe its own document.");
  }

  const found = await session
    .send<{ nodeId?: number }>("DOM.querySelector", {
      nodeId: rootNodeId,
      selector,
    })
    .catch((error: unknown) => {
      // Only the browser can judge a selector, so its complaint is the answer —
      // and it is the caller's to fix rather than anything about the page.
      throw new SnapshotRefusal(
        "invalid-selector",
        error instanceof Error ? error.message : String(error),
      );
    });
  // Zero is how the protocol spells "matched nothing"; it is not a failure.
  if (typeof found.nodeId !== "number" || found.nodeId === 0) {
    throw new SnapshotRefusal(
      "no-match",
      `Nothing on the page matches ${JSON.stringify(selector)}.`,
    );
  }

  const described = await session.send<{
    node?: { backendNodeId?: number };
  }>("DOM.describeNode", { nodeId: found.nodeId });
  if (typeof described.node?.backendNodeId !== "number") {
    throw new Error("The tab would not describe that element.");
  }
  return described.node.backendNodeId;
}

/**
 * Take the frames Chromium sends while a tab is filmed.
 *
 * Every frame is acknowledged, whether or not it is kept, and that is the whole
 * subtlety of the screencast: Chromium sends the next frame only once the last
 * one has been answered, so a frame dropped for pacing that is also left
 * unacknowledged does not cost one frame — it ends the recording. Wired at most
 * once per session, like the request interception, so no frame is answered
 * twice.
 */
function wireScreencast(session: CdpSession, entry: BrowserViewEntry): void {
  session.on("Page.screencastFrame", (params) => {
    const frame = params as { data?: string; sessionId?: number };
    if (typeof frame.sessionId === "number") {
      void session
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => {
          // The screencast is already over; there is nothing to keep alive.
        });
    }
    if (entry.video === null || typeof frame.data !== "string") {
      return;
    }
    entry.video.offerFrame(frame.data, Date.now());
  });
}

/** Start, mark or end the film of a tab whose session is attached. */
async function performRecord(
  session: CdpSession,
  entry: BrowserViewEntry,
  tabId: string,
  operation: PatcherDesktopBrowserRecordRequest["operation"],
): Promise<PatcherDesktopBrowserRecordResult> {
  const page = { tabId, ...entryPageIdentity(entry) };

  if (operation.kind === "video-start") {
    if (entry.video !== null) {
      return {
        ok: false,
        reason: "already-recording",
        message: "That tab is already being filmed. Stop it first.",
      };
    }
    if (!entry.videoWired) {
      entry.videoWired = true;
      wireScreencast(session, entry);
    }
    entry.video = new BrowserVideoRecording(Date.now(), operation.fps);
    try {
      await session.enableDomain("Page");
      await session.send("Page.startScreencast", {
        format: "jpeg",
        quality: PATCHER_BROWSER_SCREENCAST_QUALITY,
        maxWidth: PATCHER_BROWSER_SCREENCAST_MAX_WIDTH,
        maxHeight: PATCHER_BROWSER_SCREENCAST_MAX_HEIGHT,
        everyNthFrame: 1,
      });
    } catch (error) {
      // A recording nothing is filling would answer `video-stop` with an empty
      // film and no explanation.
      entry.video = null;
      throw error;
    }
    return { ok: true, kind: "recording", ...page, active: true };
  }

  if (entry.video === null) {
    return {
      ok: false,
      reason: "not-recording",
      message: "That tab is not being filmed. Start with video-start.",
    };
  }

  if (operation.kind === "video-chapter") {
    entry.video.chapter(operation.title, Date.now());
    return { ok: true, kind: "recording", ...page, active: true };
  }

  const recording = entry.video;
  entry.video = null;
  await session.send("Page.stopScreencast").catch(() => {
    // Whatever went wrong, the frames already taken are still the answer —
    // losing a recording because the stop call failed is the worse trade.
  });
  return { ok: true, kind: "video", ...page, ...recording.finish(Date.now()) };
}

/**
 * What a tab is showing, resolved exactly as `buildBrowserState` does so a read,
 * a snapshot, an interaction and the tab strip can never disagree.
 */
function entryPageIdentity(entry: BrowserViewEntry): {
  url: string;
  title: string | null;
} {
  const url = entry.view.webContents.getURL();
  const rawTitle = entry.view.webContents.getTitle();
  const title = rawTitle.length > 0 && rawTitle !== url ? rawTitle : null;
  return {
    url: truncate(url, PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title:
      title === null
        ? null
        : truncate(title, PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
  };
}

/**
 * Answer one observation about a tab that is known to exist.
 *
 * Nothing here attaches the browser debugger — `capturePage` and `printToPDF`
 * are Electron's own, and the two logs were filled by events the shell was
 * already receiving. That is what makes this the one automation command safe to
 * run against a tab the user is merely browsing.
 */
async function captureObservation(
  entry: BrowserViewEntry,
  tabId: string,
  observation: PatcherDesktopBrowserObservation,
): Promise<PatcherDesktopBrowserObserveResult> {
  const page = { tabId, ...entryPageIdentity(entry) };

  // The two logs answer without touching the page at all: whatever the tab has
  // logged and requested is already recorded.
  if (observation.kind === "console") {
    return {
      ok: true,
      kind: "console",
      ...page,
      ...entry.consoleLog.read(observation.limit),
    };
  }
  if (observation.kind === "network") {
    return {
      ok: true,
      kind: "network",
      ...page,
      ...entry.networkLog.read(observation.limit),
    };
  }

  // A tab that has loaded nothing has nothing to render, and an empty capture
  // reported as a success is a blank image a caller would have to diagnose.
  if (entry.view.webContents.getURL().length === 0) {
    return { ok: false, reason: "no-page" };
  }

  if (observation.kind === "pdf") {
    const buffer = await entry.view.webContents.printToPDF({});
    const base64 = buffer.toString("base64");
    if (base64.length > PATCHER_DESKTOP_BROWSER_MAX_PDF_BASE64_LENGTH) {
      return {
        ok: false,
        reason: "too-large",
        message: `That page's PDF is ${Math.round(buffer.byteLength / 1_048_576)}MB, past what the browser bridge will carry. Print a page range instead.`,
      };
    }
    return {
      ok: true,
      kind: "pdf",
      ...page,
      base64,
      byteLength: buffer.byteLength,
    };
  }

  const image = await entry.view.webContents.capturePage();
  if (image.isEmpty()) {
    return {
      ok: false,
      reason: "failed",
      message: "The browser captured nothing — the tab may be hidden.",
    };
  }
  const buffer =
    observation.format === "png"
      ? image.toPNG()
      : image.toJPEG(observation.quality);
  const base64 = buffer.toString("base64");
  if (base64.length > PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH) {
    return {
      ok: false,
      reason: "too-large",
      message:
        "That screenshot is past what the browser bridge will carry. Ask for JPEG, or a lower quality.",
    };
  }
  const size = image.getSize();
  return {
    ok: true,
    kind: "screenshot",
    ...page,
    mimeType: observation.format === "png" ? "image/png" : "image/jpeg",
    base64,
    width: size.width,
    height: size.height,
  };
}

/**
 * Capture the whole document of a tab that is known to exist and to have loaded.
 *
 * The one capture that pays for the debugger, and it pays for exactly as much
 * of it as it needs: a session is attached, but the `Page` domain is never
 * enabled, so this tab's `alert()` still opens Chromium's own modal afterwards.
 * That distinction is the difference between a picture and taking a tab over.
 *
 * Two round trips rather than one, because the clip has to be measured first —
 * `captureBeyondViewport` on its own renders the viewport-sized surface and
 * would answer with the same picture `capturePage` already gives.
 */
async function captureFullPageImage(
  entry: BrowserViewEntry,
  session: CdpSession,
  request: PatcherDesktopBrowserCaptureFullPageRequest,
): Promise<PatcherDesktopBrowserCaptureFullPageResult> {
  const page = { tabId: request.tabId, ...entryPageIdentity(entry) };

  const measured = await runIsolatedScript(
    entry.view.webContents,
    PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT,
  );
  if (measured.kind === "timeout") {
    return {
      ok: false,
      reason: "failed",
      message: "The page did not answer how large it is in time.",
    };
  }
  const region =
    measured.kind === "value"
      ? parseBrowserCaptureRegion(measured.value)
      : null;
  if (region === null) {
    return {
      ok: false,
      reason: "failed",
      message:
        "The page reported no size to capture — it may not have laid out yet.",
    };
  }
  // The page can go while its own script is in flight, and a capture against a
  // dead target rejects rather than answering.
  if (entry.view.webContents.isDestroyed()) {
    return { ok: false, reason: "no-view" };
  }

  const captured = await session.send<{ data?: string }>(
    "Page.captureScreenshot",
    {
      format: request.format,
      // Chromium ignores quality for PNG; sending it anyway would only make the
      // request read as though lossless compression had a knob.
      ...(request.format === "jpeg" ? { quality: request.quality } : {}),
      // `scale: 1` is what makes the result CSS pixels rather than the display's
      // device pixels — on a retina screen the difference is four times the
      // bytes for a picture nobody asked to be that sharp.
      clip: {
        x: 0,
        y: 0,
        width: region.width,
        height: region.height,
        scale: 1,
      },
      captureBeyondViewport: true,
    },
  );
  const base64 = captured.data ?? "";
  if (base64.length === 0) {
    return {
      ok: false,
      reason: "failed",
      message: "The browser captured nothing.",
    };
  }
  if (base64.length > PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH) {
    return {
      ok: false,
      reason: "too-large",
      message:
        "That page is too long to return as one picture. Ask for JPEG, or a lower quality, or print it to a PDF.",
    };
  }
  return {
    ok: true,
    ...page,
    mimeType: request.format === "png" ? "image/png" : "image/jpeg",
    base64,
    width: region.width,
    height: region.height,
    truncated: region.truncated,
  };
}

type IsolatedScriptOutcome =
  | { kind: "value"; value: unknown }
  | { kind: "timeout" }
  | { kind: "failed" };

/**
 * Run one of our own scripts in the page-read isolated world, under a deadline.
 *
 * The deadline is mandatory rather than defensive: script execution is
 * suspended while a page loads, so a wedged subresource or a busy-looping main
 * thread reaches us as "no answer yet" and would otherwise hold a tool call
 * open forever. Whichever of the two loses the race is dropped — a late script
 * result must not resolve a call already reported as timed out, the same
 * discipline `startResizeSnapshot` applies to a late capture.
 */
async function runIsolatedScript(
  webContents: WebContentsView["webContents"],
  code: string,
): Promise<IsolatedScriptOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return await Promise.race<IsolatedScriptOutcome>([
    webContents
      .executeJavaScriptInIsolatedWorld(
        PATCHER_DESKTOP_BROWSER_PAGE_READ_WORLD_ID,
        [{ code }],
      )
      .then((value: unknown) => ({ kind: "value" as const, value }))
      .catch(() => ({ kind: "failed" as const })),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(
        () => resolve({ kind: "timeout" }),
        PATCHER_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Read or write one tab's stored state.
 *
 * Scoped to the tab throughout: cookies to the URL it is on, web storage to its
 * main frame. That is both the useful scope — the cookies a site actually sees —
 * and the bounded one, since the alternative hands over every site the user is
 * signed in to in a single call.
 *
 * Writes are the exception, and deliberately so: a cookie carrying its own
 * domain is written to that domain, because a `storageState` file whose cookies
 * were silently re-homed onto the current tab would restore a session that does
 * not work. What a caller can do with that is not narrowed here; the gate is
 * the plugin toggle, as it is for the rest of these tools.
 *
 * Like an observation and unlike an interaction, nothing here attaches the
 * browser debugger.
 */
async function captureStorage(args: {
  entry: BrowserViewEntry;
  tabId: string;
  operation: PatcherDesktopBrowserStorageOperation;
  cookies: Session["cookies"];
}): Promise<PatcherDesktopBrowserStorageResult> {
  const { cookies, entry, operation, tabId } = args;
  const webContents = entry.view.webContents;
  const url = webContents.getURL();
  // A tab showing nothing has no origin, so there is nothing for any of these
  // to be scoped to.
  if (url.length === 0) {
    return { ok: false, reason: "no-page" };
  }
  const page = { tabId, ...entryPageIdentity(entry) };

  if (operation.kind === "cookies-get") {
    const found = await cookies.get({ url });
    return {
      ok: true,
      kind: "cookies",
      ...page,
      cookies: found
        .slice(0, PATCHER_DESKTOP_BROWSER_MAX_COOKIES)
        .map((cookie) => toBrowserCookie(cookie)),
    };
  }

  if (operation.kind === "cookies-set") {
    let applied = 0;
    let rejected = 0;
    for (const cookie of operation.cookies) {
      try {
        await cookies.set(toBrowserSessionCookieDetails(cookie, url));
        applied += 1;
      } catch {
        // Chromium refuses a cookie whose domain, scheme or flags disagree with
        // each other. One such cookie in a saved state must not abandon the
        // rest of it, so the count is the report rather than an exception.
        rejected += 1;
      }
    }
    return { ok: true, kind: "written", applied, rejected };
  }

  if (operation.kind === "cookies-clear") {
    const found = await cookies.get(
      operation.name === null ? { url } : { url, name: operation.name },
    );
    let removed = 0;
    for (const cookie of found) {
      try {
        await cookies.remove(url, cookie.name);
        removed += 1;
      } catch {
        // Same reasoning as a rejected write: keep going and report the count
        // rather than abandoning the cookies after this one.
      }
    }
    return { ok: true, kind: "removed", removed };
  }

  const outcome = await runIsolatedScript(
    webContents,
    buildBrowserStorageScript(operation),
  );
  if (outcome.kind === "timeout") {
    return { ok: false, reason: "timeout" };
  }
  if (outcome.kind === "failed") {
    return {
      ok: false,
      reason: "failed",
      message: "That page would not run the storage script.",
    };
  }
  // The page can be torn down while its own script is in flight.
  if (webContents.isDestroyed()) {
    return { ok: false, reason: "no-view" };
  }
  // An origin that blocks storage answers rather than throwing, and its reason
  // is worth passing on: "not accessible" and "we sent something broken" call
  // for different next moves.
  const refused = readBrowserStorageScriptError(outcome.value);
  if (refused !== null) {
    return { ok: false, reason: "failed", message: refused };
  }

  if (operation.kind === "items-get") {
    const parsed = parseBrowserStorageItems(outcome.value);
    if (parsed === null) {
      return {
        ok: false,
        reason: "failed",
        message: "That page's storage could not be read.",
      };
    }
    return {
      ok: true,
      kind: "items",
      ...page,
      area: operation.area,
      ...parsed,
    };
  }

  const counts = parseBrowserStorageCounts(outcome.value);
  if (counts === null) {
    return {
      ok: false,
      reason: "failed",
      message: "That page's storage could not be written.",
    };
  }
  return operation.kind === "items-set"
    ? {
        ok: true,
        kind: "written",
        applied: counts.applied,
        rejected: counts.rejected,
      }
    : { ok: true, kind: "removed", removed: counts.removed };
}

function buildBrowserState(
  tabId: string,
  entry: BrowserViewEntry,
): PatcherDesktopBrowserState {
  const webContents = entry.view.webContents;
  const url = webContents.getURL();
  const rawTitle = webContents.getTitle();
  const title = rawTitle.length > 0 && rawTitle !== url ? rawTitle : null;
  // Truncate attacker-influenced strings to the contract caps so the push
  // always validates and oversized values never reach the renderer/localStorage.
  return {
    tabId,
    url: truncate(url, PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title:
      title === null
        ? null
        : truncate(title, PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
    isLoading: webContents.isLoadingMainFrame(),
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    errorText:
      entry.lastErrorText === null
        ? null
        : truncate(
            entry.lastErrorText,
            PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
          ),
  };
}

/**
 * The browser-session permissions we allow. Two, and each for its own reason.
 *
 * `clipboard-sanitized-write` is write-only: an in-page copy button calling
 * `navigator.clipboard.writeText()` can put sanitized text on the system
 * clipboard, but the page can NOT read the clipboard (`clipboard-read` stays
 * denied).
 *
 * `fullscreen` is what a video player's fullscreen button asks for. Denying it
 * does not merely hide a control — `requestFullscreen()` rejects, so
 * `enter-html-full-screen` never fires and the button does nothing at all,
 * which is the shape of every dead end in browser-gaps.md. What it costs is
 * that a page can fill the window and draw something that looks like our
 * chrome; the answer is the same as every browser's, that Escape gets out and
 * the chrome comes back.
 *
 * `keyboardLock` deliberately stays denied *because* fullscreen is allowed: it
 * is the permission that would let a page keep the Escape that gets the user
 * out. Every other device/capability permission (camera, mic, geolocation,
 * notifications, MIDI, pointer lock, …) stays denied too.
 */
export function isAllowedBrowserPermission(permission: string): boolean {
  return (
    permission === "clipboard-sanitized-write" || permission === "fullscreen"
  );
}

export function createDesktopBrowserViewManager(
  args: CreateDesktopBrowserViewManagerArgs,
): DesktopBrowserViewManager {
  const partition = args.partition ?? PATCHER_BROWSER_PARTITION;
  const entries = new Map<string, BrowserViewEntry>();
  const entriesByWebContentsId = new Map<number, BrowserViewEntry>();
  // Host webContents ids with a native resize burst in flight: views of these
  // windows stay hidden regardless of renderer-declared visibility.
  const resizingHostIds = new Set<number>();
  let hardenedSession: Session | null = null;
  // Ties a download's `started` event to its terminal one. Per manager rather
  // than per tab, so two tabs downloading at once never collide.
  let downloadSequence = 0;
  /**
   * Every path this manager has written a download to, which is the allowlist
   * for opening one. Without it, `downloadAction` is an "open any file on this
   * machine" primitive that happens to be reachable from the renderer.
   *
   * Session-scoped and bounded: insertion-ordered, oldest dropped past the cap.
   * The renderer only ever lists the ten most recent, so a caller cannot ask
   * for one this has forgotten.
   */
  const writtenDownloadPaths = new Set<string>();
  /**
   * Plugin context-menu entries, as the renderer last declared them. Held here
   * so a right-click composes its menu from data already in hand — asking the
   * server first would put a round trip in front of every menu.
   */
  let contextMenuItems: readonly PatcherDesktopBrowserContextMenuItem[] = [];
  /**
   * Plugin page styles, as the renderer last declared them. Held here for a
   * sharper reason than the menu entries above: this is where navigation
   * happens, and inserted CSS lasts exactly one document, so re-applying it is
   * something only the shell can do at the moment the page commits.
   */
  let pageStyles: readonly PatcherDesktopBrowserPageStyle[] = [];

  /**
   * Bring one view's applied stylesheets in line with what should be applied to
   * the page it is showing.
   *
   * Reconciliation rather than "insert on navigate", because two different
   * things call it: a commit, where nothing is applied yet, and a change to the
   * declared set, where a document may already be carrying styles that should
   * now go. One function that compares desired against applied answers both, and
   * cannot double-insert.
   *
   * Failures are swallowed per style. A page that is being torn down rejects an
   * insertion, and the tab it happened in is not a place to report anything —
   * whereas letting it reject would abandon the styles queued behind it.
   */
  async function reconcilePageStyles(entry: BrowserViewEntry): Promise<void> {
    const webContents = entry.view.webContents;
    if (webContents.isDestroyed()) {
      return;
    }
    const url = webContents.getURL();
    const wanted = new Map<string, PatcherDesktopBrowserPageStyle>();
    // Only a real page: `about:blank` and the empty URL of a fresh view are not
    // sites, and a pattern like `https://**/**` must not be read as claiming them.
    if (url.startsWith("https://") || url.startsWith("http://")) {
      for (const style of pageStyles) {
        if (
          style.matches.some((pattern) =>
            matchesBrowserUrlPattern(pattern, url),
          )
        ) {
          wanted.set(`${style.pluginId}:${style.styleId}`, style);
        }
      }
    }
    const document = entry.pageStyleDocument;
    for (const [id, cssKey] of [...entry.appliedPageStyles]) {
      if (wanted.has(id)) continue;
      entry.appliedPageStyles.delete(id);
      try {
        await webContents.removeInsertedCSS(cssKey);
      } catch {
        // The document that carried it is gone, which is the outcome asked for.
      }
    }
    for (const [id, style] of wanted) {
      if (entry.appliedPageStyles.has(id)) continue;
      // Claim the slot before awaiting: a second reconcile for the same document
      // — a push arriving mid-commit — would otherwise insert the same
      // stylesheet twice and remember only one of the two keys.
      entry.appliedPageStyles.set(id, "");
      try {
        const cssKey = await webContents.insertCSS(style.css);
        if (entry.pageStyleDocument !== document) {
          // The page moved on while this was in flight. The key names a
          // stylesheet in a document that no longer exists, so it is not worth
          // filing — and the commit that replaced it cleared this map and
          // reconciled again, so whatever stands under `id` now is that
          // document's and must not be dropped on this pass's way out.
          continue;
        }
        if (entry.appliedPageStyles.get(id) !== "") {
          // The slot stopped being ours: a reconcile for this same document
          // released it because the style is no longer declared. Take the
          // stylesheet back rather than leaving one nothing remembers.
          try {
            await webContents.removeInsertedCSS(cssKey);
          } catch {
            // The document that carried it is gone, which is the outcome asked
            // for.
          }
          continue;
        }
        entry.appliedPageStyles.set(id, cssKey);
      } catch {
        // Same two questions as the success path, in the same order. The
        // document first: a page being torn down is what rejects an insertion,
        // and that is exactly when the next one commits — so a stale failure
        // must not clear a slot the new document's reconcile is holding, or that
        // reconcile finds its own claim gone and takes its stylesheet back.
        // Then the slot, so a release for this same document is not undone.
        if (
          entry.pageStyleDocument === document &&
          entry.appliedPageStyles.get(id) === ""
        ) {
          entry.appliedPageStyles.delete(id);
        }
      }
    }
  }
  /**
   * Plugin page scripts, as the renderer last declared them, and the worlds they
   * run in.
   *
   * Held here for the reason the styles above are, one step sharper: a script has
   * to reach a document *as it is created*, before the page's own first script
   * runs, and this is the only process present at that moment.
   */
  let pageScripts: readonly PatcherDesktopBrowserPageScript[] = [];
  /**
   * Whether the browsing session currently carries the page-script preload.
   *
   * The load-bearing property of this whole surface: while no plugin declares a
   * page script, no preload is installed, so a browsed renderer holds no Patcher code
   * at all and the shell's standing rule needs no qualification. Measured: after
   * `unregisterPreloadScript`, the next document has no preload and the isolated
   * world is empty.
   */
  let pageScriptPreloadRegistered = false;
  /**
   * `pluginId` → the isolated world its scripts run in, allocated on first sight
   * and stable after.
   *
   * One world per plugin, not one per script and not one shared: two scripts of
   * the same plugin are one program and may share globals, while two plugins are
   * two programs and — measured — cannot see each other's `patcher` or anything else.
   */
  const pageScriptWorldIds = new Map<string, number>();
  let pageScriptCallSequence = 0;
  /**
   * `patcher.rpc` calls in flight: callId → how to answer the page that asked.
   *
   * The request starts in a browsed renderer, is answered by this window's
   * renderer, and has to find its way back, so the correlation lives here. A late
   * answer resolves nothing and is dropped, exactly as a late dialog answer is.
   */
  const pendingPageScriptCalls = new Map<
    string,
    (answer: PatcherDesktopPageScriptRpcAnswer) => void
  >();

  function pageScriptWorldId(pluginId: string): number {
    const existing = pageScriptWorldIds.get(pluginId);
    if (existing !== undefined) {
      return existing;
    }
    const worldId = PAGE_SCRIPT_WORLD_BASE + pageScriptWorldIds.size;
    pageScriptWorldIds.set(pluginId, worldId);
    return worldId;
  }

  /**
   * The worlds a document at this address should get, grouped by plugin.
   *
   * The same matching a page style gets, against the same declared patterns, and
   * the same refusal to treat a blank page as a site: `https://**` must not be
   * read as claiming `about:blank`.
   */
  function pageScriptWorldsFor(url: string): PatcherDesktopPageScriptWorld[] {
    if (!url.startsWith("https://") && !url.startsWith("http://")) {
      return [];
    }
    const worlds = new Map<string, PatcherDesktopPageScriptWorld>();
    for (const script of pageScripts) {
      if (
        !script.matches.some((pattern) =>
          matchesBrowserUrlPattern(pattern, url),
        )
      ) {
        continue;
      }
      let world = worlds.get(script.pluginId);
      if (world === undefined) {
        world = {
          pluginId: script.pluginId,
          worldId: pageScriptWorldId(script.pluginId),
          scripts: [],
        };
        worlds.set(script.pluginId, world);
      }
      world.scripts.push({ scriptId: script.scriptId, code: script.code });
    }
    return [...worlds.values()];
  }

  /**
   * Install or remove the browsing session's page-script preload to match what is
   * declared.
   *
   * Preloads are read as a frame's document is created, so this takes effect on
   * the next load of a page — which is also what Chrome's content scripts do, and
   * the honest thing to tell a plugin author: a script registered while a matching
   * page is open runs when that page is reloaded.
   */
  function syncPageScriptPreload(): void {
    const wanted = pageScripts.length > 0;
    if (wanted === pageScriptPreloadRegistered) {
      return;
    }
    const browserSession = ensureHardenedSession();
    try {
      if (wanted) {
        browserSession.registerPreloadScript({
          id: PAGE_SCRIPT_PRELOAD_ID,
          type: "frame",
          filePath: args.pageScriptPreloadPath,
        });
      } else {
        browserSession.unregisterPreloadScript(PAGE_SCRIPT_PRELOAD_ID);
      }
      pageScriptPreloadRegistered = wanted;
    } catch {
      // A session that will not take the preload leaves page scripts not
      // running, which is the safe direction: nothing half-installed, and the
      // flag stays false so the next push tries again.
    }
  }

  function refusePageScriptCall(
    message: string,
  ): PatcherDesktopPageScriptRpcAnswer {
    return { ok: false, message };
  }

  /**
   * One `patcher.rpc` from a page script.
   *
   * `url` is the frame's address as Chromium reports it to this process, never
   * something the payload claimed, and the plugin is re-checked against it on
   * every call rather than once at injection. That is what bounds a browsed
   * renderer that has been taken over: it can reach the plugins that already
   * claim the page it is actually on, and nothing else — the same set a
   * well-behaved script on that page could reach.
   */
  async function callPageScriptRpc(callArgs: {
    webContentsId: number;
    url: string;
    request: PatcherDesktopPageScriptRpcRequest;
  }): Promise<PatcherDesktopPageScriptRpcAnswer> {
    const entry = entriesByWebContentsId.get(callArgs.webContentsId);
    if (entry === undefined) {
      return refusePageScriptCall("patcher.rpc is not available in this page.");
    }
    const { pluginId, method, input } = callArgs.request;
    if (
      !pageScriptWorldsFor(callArgs.url).some(
        (world) => world.pluginId === pluginId,
      )
    ) {
      return refusePageScriptCall(
        `patcher.rpc: plugin "${pluginId}" declares no page script for this address.`,
      );
    }
    const now = Date.now();
    const recent = entry.pageScriptCallTimestamps.filter(
      (stamp) => now - stamp < PAGE_SCRIPT_RATE_WINDOW_MS,
    );
    if (recent.length >= PAGE_SCRIPT_RATE_MAX_IN_WINDOW) {
      entry.pageScriptCallTimestamps = recent;
      return refusePageScriptCall(
        `patcher.rpc: too many calls — at most ${PAGE_SCRIPT_RATE_MAX_IN_WINDOW} every ${
          PAGE_SCRIPT_RATE_WINDOW_MS / 1000
        } seconds.`,
      );
    }
    entry.pageScriptCallTimestamps = [...recent, now];

    const hostWindow = entry.hostWindow;
    if (hostWindow.webContents.isDestroyed()) {
      return refusePageScriptCall(
        "patcher.rpc: this tab's Patcher window is gone.",
      );
    }
    const callId = `page-script-${(pageScriptCallSequence += 1)}`;
    return await new Promise<PatcherDesktopPageScriptRpcAnswer>((resolve) => {
      const timer = setTimeout(() => {
        if (pendingPageScriptCalls.delete(callId)) {
          resolve(
            refusePageScriptCall(
              `patcher.rpc("${method}"): no answer within ${
                PAGE_SCRIPT_CALL_TIMEOUT_MS / 1000
              } seconds.`,
            ),
          );
        }
      }, PAGE_SCRIPT_CALL_TIMEOUT_MS);
      // Unref'd so a call in flight cannot hold the process open at shutdown.
      timer.unref?.();
      pendingPageScriptCalls.set(callId, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      send(hostWindow, PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL, {
        callId,
        tabId: entry.tabId,
        pluginId,
        method,
        input,
        url: truncate(callArgs.url, PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
      });
    });
  }

  /**
   * `host|fingerprint` pairs a human chose to trust despite a certificate
   * error. Keyed on the fingerprint as well as the host so trusting one bad
   * certificate does not trust the next one served from the same name — which
   * is the difference between "I know this dev box" and "stop asking me".
   *
   * Per manager and per session: never written down, gone on restart.
   */
  const acceptedCertificates = new Set<string>();

  /**
   * Whether any certificate was accepted for this host. Keyed by
   * `host|fingerprint`, so this asks about the host and ignores which
   * certificate — a page on a hand-trusted host is a page whose identity nobody
   * verified, whichever of its certificates is being served today.
   */
  function hasAcceptedCertificateForHost(host: string): boolean {
    const prefix = `${host}|`;
    for (const key of acceptedCertificates) {
      if (key.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }
  /** Distinguishes one prompt from the next, so a late answer is droppable. */
  let pagePromptSequence = 0;
  /**
   * Tabs whose pages get real popups, as the renderer last declared them, held
   * as `${hostWebContentsId}:${tabId}` keys because a tab id is only unique
   * within its window.
   */
  const popupTabKeys = new Set<string>();
  /** Names the tabs the shell opens itself; the renderer adopts these ids. */
  let popupSequence = 0;

  /**
   * Navigation history of tabs the renderer has closed, keyed by tab id, so
   * reopening one puts the user back where they were rather than at the top of
   * the page.
   *
   * It lives here rather than in the renderer for two reasons. The entries
   * carry Chromium's `pageState` — scroll offsets and **form values** — which
   * has no business crossing a wire or sitting in a React store; and the shell
   * is the only place that can read it, at the one moment it still exists,
   * which is just before the view is destroyed.
   *
   * Insertion-ordered and bounded: reopening walks back through recent closes,
   * so old ones are worth nothing.
   */
  const closedTabSessions = new Map<string, ClosedTabSession>();

  function rememberClosedTabSession(entry: BrowserViewEntry): void {
    if (entry.view.webContents.isDestroyed()) {
      return;
    }
    const history = entry.view.webContents.navigationHistory;
    let entries: NavigationEntry[];
    try {
      entries = history.getAllEntries();
    } catch {
      return;
    }
    if (entries.length === 0) {
      return;
    }
    // Re-inserting moves an id back to the newest position, which matters when
    // a tab id is reused.
    closedTabSessions.delete(entry.tabId);
    closedTabSessions.set(entry.tabId, {
      entries,
      index: history.getActiveIndex(),
    });
    if (closedTabSessions.size <= MAX_CLOSED_TAB_SESSIONS) {
      return;
    }
    const oldest = closedTabSessions.keys().next();
    if (!oldest.done) {
      closedTabSessions.delete(oldest.value);
    }
  }

  /**
   * Reopen a tab where it left off, if this is the same tab id coming back.
   *
   * Restoring drives its own navigation, so it replaces the load rather than
   * following it — a load *and* a restore would fetch the page twice and the
   * user would watch it happen. Returns whether it took the load over.
   */
  function restoreClosedTabSession(
    entry: BrowserViewEntry,
    url: string,
  ): boolean {
    const session = closedTabSessions.get(entry.tabId);
    if (session === undefined) {
      return false;
    }
    // One shot: a session restored is a session spent, so a later reload or
    // re-attach behaves like any other tab.
    closedTabSessions.delete(entry.tabId);
    const target = session.entries[session.index];
    // The renderer reopens with the URL it remembered; if the two disagree the
    // renderer is the authority on where the tab should be, and the stale
    // history is dropped rather than overriding it.
    if (target === undefined || (url.length > 0 && target.url !== url)) {
      return false;
    }
    entry.view.webContents.navigationHistory
      .restore({ entries: session.entries, index: session.index })
      .catch(() => {
        // Restoring is best effort: fall back to a plain load so a reopened tab
        // still shows its page, just without the history behind it.
        loadIfNeeded(entry, url);
      });
    return true;
  }

  function rememberDownloadPath(savePath: string): void {
    writtenDownloadPaths.add(savePath);
    if (writtenDownloadPaths.size <= MAX_REMEMBERED_DOWNLOAD_PATHS) {
      return;
    }
    const oldest = writtenDownloadPaths.values().next();
    if (!oldest.done) {
      writtenDownloadPaths.delete(oldest.value);
    }
  }

  function sendDownload(
    entry: BrowserViewEntry,
    download: Omit<PatcherDesktopBrowserDownload, "tabId">,
  ): void {
    send(entry.hostWindow, PATCHER_DESKTOP_BROWSER_DOWNLOAD_CHANNEL, {
      ...download,
      tabId: entry.tabId,
    });
  }

  function isHostResizing(hostWindow: DesktopBrowserHostWindow): boolean {
    return resizingHostIds.has(hostWindow.webContents.id);
  }

  function applyEntryVisibility(
    entry: BrowserViewEntry,
    hostWindow: DesktopBrowserHostWindow,
  ): void {
    if (entry.view.webContents.isDestroyed()) {
      return;
    }
    // Reasons the app is drawing its own chrome across the whole page area, and
    // possibly across the DevTools panel below it: a resize burst is standing in
    // a bitmap, a dialog or a network prompt is a modal where the page was, and
    // an overlay is a dropdown that can reach down over either view.
    const appDrawsOverBothViews =
      isHostResizing(hostWindow) ||
      entry.pendingDialog !== null ||
      entry.pagePrompt !== null ||
      entry.overlayActive;
    entry.view.setVisible(entry.visible && !appDrawsOverBothViews);
    // The panel is a native view too, so it hides for all of those. What it no
    // longer follows is the page's own visibility: the renderer hides the page
    // to draw a load-error screen in its rect, and the panel has a rect of its
    // own. See {@link BrowserViewEntry.devToolsVisible} for the fallback that
    // keeps an app which never reports panel visibility working as before.
    entry.devToolsView?.setVisible(
      (entry.devToolsVisible ?? entry.visible) && !appDrawsOverBothViews,
    );
  }

  /**
   * Capture the (still visible) view, push the bitmap to the renderer as its
   * resize placeholder, and only then hide the view. The capture result is
   * dropped if the burst already ended — the live view is back by then and a
   * late placeholder would linger under it into the next burst.
   */
  function startResizeSnapshot(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    const hideCap = setTimeout(() => {
      applyEntryVisibility(entry, hostWindow);
    }, RESIZE_SNAPSHOT_HIDE_CAP_MS);
    entry.view.webContents
      .capturePage()
      .then((image) => {
        if (!isHostResizing(hostWindow) || image.isEmpty()) {
          return;
        }
        const dataUrl = `data:image/jpeg;base64,${image
          .toJPEG(RESIZE_SNAPSHOT_JPEG_QUALITY)
          .toString("base64")}`;
        send(hostWindow, PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
          tabId,
          dataUrl,
        });
      })
      .catch(() => {
        // No placeholder; the renderer's bare panel background shows instead.
      })
      .finally(() => {
        clearTimeout(hideCap);
        applyEntryVisibility(entry, hostWindow);
      });
  }

  function ensureHardenedSession(): Session {
    if (hardenedSession !== null) {
      return hardenedSession;
    }
    const browserSession = session.fromPartition(partition);
    // Deny every device/capability permission by default in v1 (camera, mic,
    // geolocation, notifications, MIDI, …); see `isAllowedBrowserPermission`
    // for the two exceptions and why each is one. A prompt UI is a later phase.
    browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(isAllowedBrowserPermission(permission));
    });
    browserSession.setPermissionCheckHandler((_wc, permission) =>
      isAllowedBrowserPermission(permission),
    );
    // A download is written straight to the user's downloads folder under a
    // name the shell chose, and the renderer is told so it can say so. It is
    // never asked where to put it: the save dialog Electron shows by default is
    // owned by the app window, so a page could block the whole workspace with
    // it, and an automation-driven download would wait on a modal nobody is
    // there to answer.
    browserSession.on("will-download", (event, item, webContents) => {
      const entry = entriesByWebContentsId.get(webContents.id) ?? null;
      if (entry === null) {
        // A view this manager no longer tracks. There is no tab to attribute
        // the file to and nobody to tell about it, so it is refused rather than
        // written somewhere unattributable.
        event.preventDefault();
        return;
      }
      const filename = sanitizeDownloadFilename(item.getFilename());
      const id = `download-${(downloadSequence += 1)}`;
      const now = Date.now();
      // Truncated rather than rejected: these two are carried for a plugin's
      // benefit, and a payload the preload's schema drops would cost the user
      // the message about their own download.
      const source = {
        url: truncate(item.getURL(), PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
        mimeType: truncate(
          item.getMimeType(),
          PATCHER_DESKTOP_BROWSER_MAX_MIME_TYPE_LENGTH,
        ),
      };
      const decision = evaluatePopupRate({
        timestamps: entry.downloadTimestamps,
        now,
        windowMs: DOWNLOAD_RATE_WINDOW_MS,
        maxInWindow: DOWNLOAD_RATE_MAX_IN_WINDOW,
      });
      entry.downloadTimestamps = decision.timestamps;
      if (!decision.allowed) {
        event.preventDefault();
        sendDownload(entry, {
          ...source,
          id,
          filename,
          savePath: null,
          state: "refused",
        });
        return;
      }
      const savePath = resolveUniqueDownloadPath({
        directory: args.resolveDownloadDirectory(),
        exists: args.downloadPathExists,
        filename,
        now,
      });
      rememberDownloadPath(savePath);
      // Setting the path is what suppresses that dialog, and it only counts
      // inside this handler — Electron reads `savePath` as the event returns.
      item.setSavePath(savePath);
      sendDownload(entry, {
        ...source,
        id,
        filename,
        savePath,
        state: "started",
      });
      item.once("done", (_doneEvent, state) => {
        sendDownload(entry, {
          ...source,
          id,
          filename,
          savePath,
          state:
            state === "completed"
              ? "completed"
              : state === "cancelled"
                ? "cancelled"
                : "interrupted",
        });
      });
    });
    // Network firewall: untrusted pages must not invisibly reach Patcher's loopback
    // services or the user's LAN. Top-level http(s) navigation remains allowed;
    // subresources, fetch/XHR, iframes, and WebSockets are guarded here.
    browserSession.webRequest.onBeforeRequest((details, callback) => {
      const targetWebContentsId = details.webContentsId ?? null;
      const entry =
        targetWebContentsId === null
          ? null
          : (entriesByWebContentsId.get(targetWebContentsId) ?? null);
      const attributedEntry =
        entry === null || entry.view.webContents.isDestroyed() ? null : entry;
      const isMainFrameRequest = details.resourceType === "mainFrame";
      callback({
        cancel: shouldBlockBrowserRequest({
          url: details.url,
          method: details.method,
          resourceType: details.resourceType,
          isMainFrame: isMainFrameRequest,
          targetWebContentsId,
          entryWebContentsId: attributedEntry?.view.webContents.id ?? null,
          currentMainFrameLocalOriginKey:
            attributedEntry?.currentMainFrameLocalOriginKey ?? null,
          requestingFrameOriginKey: resolveRequestingFrameLocalOriginKey({
            origin: details.frame?.origin,
            url: details.frame?.url,
            // Electron blanks `frame.origin` for a document's initial
            // subresources; fall back to the top frame's URL so a same-origin
            // SPA dev server (Vite, etc.) is not blocked into a blank page.
            isTopFrame: details.frame?.parent === null,
          }),
        }),
      });
    });
    // Observation rides the same session-wide events and the same
    // `webContentsId` attribution the firewall above uses. Both ends of a
    // request are recorded because they answer different questions: `onCompleted`
    // carries the status, `onErrorOccurred` carries the reason there was none —
    // including `net::ERR_BLOCKED_BY_CLIENT` for a request the firewall refused,
    // which is exactly the case a caller would otherwise spend a long time
    // failing to explain.
    browserSession.webRequest.onCompleted((details) => {
      recordNetworkRequest(details);
    });
    browserSession.webRequest.onErrorOccurred((details) => {
      recordNetworkRequest(details);
    });
    hardenedSession = browserSession;
    return browserSession;
  }

  function recordNetworkRequest(details: BrowserNetworkRequestDetails): void {
    const webContentsId = (details as { webContentsId?: unknown })
      .webContentsId;
    if (typeof webContentsId !== "number") {
      return;
    }
    const entry = entriesByWebContentsId.get(webContentsId);
    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
    }
    entry.networkLog.record(toBrowserNetworkEntry(details, Date.now()));
  }

  function pushFavicon(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    dataUrl: string | null,
  ): void {
    send(hostWindow, PATCHER_DESKTOP_BROWSER_FAVICON_CHANNEL, {
      tabId,
      dataUrl,
    });
  }

  /**
   * Report a tab's zoom, reading it back off the view rather than trusting what
   * was asked for — Chromium clamps, and a site's remembered zoom arrives here
   * without anyone asking at all.
   */
  function pushZoom(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    if (entry.view.webContents.isDestroyed()) {
      return;
    }
    send(hostWindow, PATCHER_DESKTOP_BROWSER_ZOOM_CHANNEL, {
      tabId,
      factor: entry.view.webContents.getZoomFactor(),
    });
  }

  /**
   * Tell the renderer what the shell knows about this page's connection.
   *
   * One fact: whether the page's host is being served under a certificate a human
   * accepted after Chromium refused it. The renderer cannot know — it never sees
   * the error, and the exception outlives the prompt for the whole session and
   * applies to *every* tab that reaches the same host, including ones that were
   * never asked.
   */
  function pushPageSecurity(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    if (entry.view.webContents.isDestroyed()) {
      return;
    }
    const host = browserUrlHost(entry.view.webContents.getURL());
    send(hostWindow, PATCHER_DESKTOP_BROWSER_PAGE_SECURITY_CHANNEL, {
      tabId,
      certificateTrustedByUser:
        host.length > 0 && hasAcceptedCertificateForHost(host),
    });
  }

  /**
   * Drop an icon that belongs to a page the tab has left, once loading settles.
   *
   * The icon is keyed to the page URL it was resolved for, and this runs at
   * `did-stop-loading` rather than at commit, which is what makes a **reload keep
   * its icon**: the page is the same page, so nothing has to be re-declared or
   * re-fetched. Clearing at commit instead made the icon depend on the new
   * document re-announcing it, and a reload does not always do that — the bug this
   * replaces. The cost is a page that drops its icon on reload keeping the old one,
   * which is also what a real browser's favicon cache does.
   */
  function dropStaleFavicon(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    if (entry.faviconUrl === null) {
      return;
    }
    if (
      entry.faviconPageKey ===
      resolveBrowserFaviconPageKey(entry.view.webContents.getURL())
    ) {
      return;
    }
    entry.faviconUrl = null;
    entry.faviconPageKey = null;
    pushFavicon(hostWindow, tabId, null);
  }

  /**
   * Fetch a newly declared favicon in the browsing session and push it as a data
   * URI. The page's URL never leaves this process — see
   * `desktop-browser-favicon.ts` for why that is the point rather than a detail.
   */
  async function updateFavicon(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
    urls: readonly string[],
  ): Promise<void> {
    const selected = selectBrowserFaviconUrl(urls);
    if (selected === null) {
      // Nothing usable declared. The icon the tab already wears is dropped when
      // loading settles, not here, so a page that declares its icon in stages
      // does not flicker through the generic mark.
      return;
    }
    if (selected === entry.faviconUrl) {
      // Same icon, re-announced (a reload, a re-parse). Re-key it to the page it
      // was announced for and skip the fetch: the renderer already has it.
      entry.faviconPageKey = resolveBrowserFaviconPageKey(
        entry.view.webContents.getURL(),
      );
      return;
    }
    const rate = evaluatePopupRate({
      timestamps: entry.faviconFetchTimestamps,
      now: Date.now(),
      windowMs: FAVICON_FETCH_WINDOW_MS,
      maxInWindow: FAVICON_FETCH_MAX_IN_WINDOW,
    });
    entry.faviconFetchTimestamps = rate.timestamps;
    if (!rate.allowed) {
      return;
    }

    const session = ensureHardenedSession();
    const dataUrl = await resolveBrowserFaviconDataUrl({
      fetchFavicon: (url) => session.fetch(url),
      urls: [selected],
    });
    if (dataUrl === null) {
      return;
    }
    // The view may have navigated away or been destroyed while the icon was in
    // flight; a late icon must not land on whatever the tab shows now.
    if (entry.view.webContents.isDestroyed()) {
      return;
    }
    entry.faviconUrl = selected;
    entry.faviconPageKey = resolveBrowserFaviconPageKey(
      entry.view.webContents.getURL(),
    );
    pushFavicon(hostWindow, tabId, dataUrl);
  }

  function pushState(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
  ): void {
    const entry = entries.get(browserViewKey(hostWindow, tabId));
    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
    }
    send(
      hostWindow,
      PATCHER_DESKTOP_BROWSER_STATE_CHANNEL,
      buildBrowserState(tabId, entry),
    );
  }

  function wireWebContents(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    const webContents = entry.view.webContents;
    // Captured while the window is alive: the `destroyed` handler below runs
    // during teardown, when reading it off `hostWindow` would throw.
    const hostWebContentsId = hostWindow.webContents.id;

    webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown" || input.isAutoRepeat || input.isComposing) {
        return;
      }
      const command = args.resolveAppCommand({
        altKey: input.alt,
        code: input.code,
        ctrlKey: input.control,
        key: input.key,
        metaKey: input.meta,
        shiftKey: input.shift,
      });
      if (command === null) return;
      // Prevent both the untrusted page and Electron's application menu from
      // also handling a chord that Patcher resolved as a browser command.
      event.preventDefault();
      // Commands whose *next* keystroke has to land in the app rather than in
      // the page. The address bar is the obvious one; the tab switcher is the
      // subtle one — it is driven by further Ctrl+Tab presses and closed by the
      // Ctrl release, and a key released inside a browsed page never becomes an
      // app command.
      if (HOST_FOCUSING_APP_COMMANDS.has(command)) {
        args.focusHostWebContents(hostWindow.webContents.id);
      }
      args.dispatchAppCommand({
        command,
        hostWebContentsId: hostWindow.webContents.id,
      });
    });

    webContents.on("will-frame-navigate", (event) => {
      if (!event.isMainFrame) {
        return;
      }
      if (shouldBlockEntryTopLevelRequest(entry, event.url)) {
        event.preventDefault();
      }
    });
    webContents.on("will-navigate", (event, url) => {
      if (shouldBlockEntryTopLevelRequest(entry, url)) {
        event.preventDefault();
      }
    });
    webContents.on("will-redirect", (event, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) {
        return;
      }
      if (shouldBlockEntryTopLevelRequest(entry, url)) {
        event.preventDefault();
      }
    });

    // `window.open` and `target="_blank"`, in two flavours.
    //
    // For a tab whose surface claimed popups, Chromium creates the window and
    // the shell hosts it as a tab: `window.open()` returns a real handle, the
    // popup has a live `window.opener`, and it can close itself — which is the
    // difference between an OAuth flow completing and a page deciding it was
    // popup-blocked. Everywhere else the older behaviour stands: deny, and push
    // the URL over for the renderer to open as a plain tab.
    webContents.setWindowOpenHandler((details) => {
      const hostsRealPopup =
        popupTabKeys.has(browserViewKey(hostWindow, tabId)) &&
        isAllowedBrowserPopupTarget(details.url);
      const fallbackUrl = hostsRealPopup
        ? null
        : resolveWindowOpenAction(details.url).openTabUrl;
      if (!hostsRealPopup && fallbackUrl === null) {
        return { action: "deny" };
      }
      // The same sliding window either way: a page churning popups is a page
      // churning popups whether or not they come with an opener.
      const decision = evaluatePopupRate({
        timestamps: entry.popupTimestamps,
        now: Date.now(),
        windowMs: POPUP_RATE_WINDOW_MS,
        maxInWindow: POPUP_RATE_MAX_IN_WINDOW,
      });
      entry.popupTimestamps = decision.timestamps;
      if (!decision.allowed) {
        return { action: "deny" };
      }
      if (hostsRealPopup) {
        return {
          action: "allow",
          // Chromium's own rule, and the one an OAuth flow depends on: a popup
          // dies with the page that opened it.
          outlivesOpener: false,
          createWindow: (options) =>
            createPopupEntry({
              hostWindow,
              openerEntry: entry,
              openerTabId: tabId,
              options,
              url: details.url,
            }),
        };
      }
      if (fallbackUrl !== null) {
        send(hostWindow, PATCHER_DESKTOP_BROWSER_OPEN_TAB_CHANNEL, {
          url: fallbackUrl,
        });
        send(hostWindow, PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL, {
          tabId,
          url: fallbackUrl,
        });
      }
      return { action: "deny" };
    });

    // DevTools can open and close without the app asking — "Inspect" from the
    // page menu opens them, their own toolbar closes them — and the renderer
    // owns the space they occupy, so both directions are reported.
    webContents.on("devtools-opened", () => {
      send(hostWindow, PATCHER_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL, {
        tabId,
        open: true,
      });
    });
    webContents.on("devtools-closed", () => {
      closeDevToolsView(entry, hostWindow);
      send(hostWindow, PATCHER_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL, {
        tabId,
        open: false,
      });
    });

    // A popup closing itself (`window.close()`, which is how an OAuth flow
    // ends) destroys its `webContents` without anyone asking the renderer. Only
    // the shell sees it, so only the shell can say the tab is gone.
    //
    // `destroyEntry` removes the entry from the map *before* closing, so this
    // fires for a page's own close and not for the renderer's.
    const entryWebContentsId = webContents.id;
    webContents.on("destroyed", () => {
      const key = browserViewKeyForHost(hostWebContentsId, tabId);
      if (entries.get(key) !== entry) {
        return;
      }
      entries.delete(key);
      entriesByWebContentsId.delete(entryWebContentsId);
      if (!hostWindow.isDestroyed()) {
        hostWindow.contentView.removeChildView(entry.view);
      }
      send(hostWindow, PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL, {
        kind: "closed",
        tabId,
      });
    });

    // Right-click menu for the untrusted browser view. Built from this view's
    // own webContents so the standard editing roles act on it (not the host
    // React surface), giving Copy parity even when focus is elsewhere. Only
    // plain editing roles are exposed — no dev tools, reload, or patcher-bridge
    // surface — keeping the untrusted-content posture.
    webContents.on("context-menu", (_event, params) => {
      if (webContents.isDestroyed()) {
        return;
      }
      const template = buildBrowserContextMenuTemplate({
        canOpenExternally: args.canOpenExternalUrl?.() ?? true,
        target: {
          canGoBack: webContents.navigationHistory.canGoBack(),
          canGoForward: webContents.navigationHistory.canGoForward(),
          editFlags: params.editFlags,
          isEditable: params.isEditable,
          linkURL: params.linkURL,
          mediaType: params.mediaType,
          selectionText: params.selectionText,
          srcURL: params.srcURL,
        },
        pluginItems: contextMenuItems,
        actions: {
          inspect: () => {
            ensureDevToolsView(entry, hostWindow);
            webContents.inspectElement(params.x, params.y);
          },
          invokePluginItem: (item) => {
            send(
              hostWindow,
              PATCHER_DESKTOP_BROWSER_CONTEXT_MENU_INVOKE_CHANNEL,
              {
                pluginId: item.pluginId,
                itemId: item.itemId,
                tabId,
                pageUrl: truncate(
                  webContents.getURL(),
                  PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH,
                ),
                linkUrl:
                  params.linkURL.length > 0
                    ? truncate(
                        params.linkURL,
                        PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH,
                      )
                    : null,
                imageUrl:
                  params.mediaType === "image" && params.srcURL.length > 0
                    ? truncate(
                        params.srcURL,
                        PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH,
                      )
                    : null,
                selectionText:
                  params.selectionText.length > 0
                    ? truncate(
                        params.selectionText,
                        PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
                      )
                    : null,
              },
            );
          },
          copyImage: () => {
            webContents.copyImageAt(params.x, params.y);
          },
          copyText: (text) => {
            clipboard.writeText(text);
          },
          goBack: () => {
            webContents.navigationHistory.goBack();
          },
          goForward: () => {
            webContents.navigationHistory.goForward();
          },
          openExternally: (url) => {
            args.openExternalUrl(url);
          },
          openInNewTab: (url) => {
            // The path popups already take: the renderer owns where a tab goes,
            // and the surface only opens one for a tab it owns.
            send(hostWindow, PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL, {
              tabId,
              url,
            });
          },
          reload: () => {
            webContents.reload();
          },
          saveImage: (url) => {
            // Goes through `will-download` like any other download, so it is
            // named, rate-limited and reported by the same code.
            webContents.downloadURL(url);
          },
          searchFor: (query) => {
            send(hostWindow, PATCHER_DESKTOP_BROWSER_SEARCH_SELECTION_CHANNEL, {
              tabId,
              query: truncate(query, PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH),
            });
          },
        },
      });
      Menu.buildFromTemplate(template).popup();
    });

    // Recorded from the moment the tab exists, and never cleared on navigation:
    // the log answers "what has this tab logged", which spans the redirect that
    // got it here. Clearing on `did-navigate` would also drop the main-frame
    // request's own status — the single most useful entry in a network log.
    webContents.on(
      "console-message",
      (details: BrowserConsoleMessageDetails) => {
        entry.consoleLog.record(toBrowserConsoleEntry(details, Date.now()));
      },
    );

    // The three questions the network asks that only a human can answer. Each
    // one is a documented Electron event whose *default* is to refuse silently,
    // which is what made them dead ends: the page simply failed with no way to
    // tell whether Patcher had decided something or nothing had happened at all.

    webContents.on("login", (event, details, authInfo, callback) => {
      // Electron's default cancels every challenge. Taking it over means this
      // code now owns both answers — including the refusals below, which are
      // deliberate rather than absent.
      event.preventDefault();
      const realmKey = `${authInfo.host}:${authInfo.port}|${authInfo.realm}`;
      if (entry.pendingAuth?.key === realmKey) {
        // Another request for the same realm while the prompt is open: park it
        // and let one answer settle them all.
        entry.pendingAuth.callbacks.push(callback);
        return;
      }
      // Read rather than typed: `isRequestForNavigation` is documented for
      // current Electron and missing from the typings this app is pinned to, so
      // the policy takes null for "the runtime did not say".
      const isRequestForNavigation = (
        details as { isRequestForNavigation?: boolean }
      ).isRequestForNavigation;
      if (
        !shouldPromptForBrowserAuth({
          isProxy: authInfo.isProxy,
          isRequestForNavigation:
            typeof isRequestForNavigation === "boolean"
              ? isRequestForNavigation
              : null,
          isLoadingMainFrame: webContents.isLoadingMainFrame(),
          pageUrl: webContents.getURL(),
          requestUrl: details.url,
        })
      ) {
        callback();
        return;
      }
      // Held locally and published only once the prompt is up: a challenge that
      // cannot be asked about (the tab already has a prompt open) must not take
      // another realm's parked callbacks down with it — they would never be
      // settled, and their requests would hang for the life of the tab.
      const pendingAuth = { key: realmKey, callbacks: [callback] };
      const opened = openPagePrompt({
        details: {
          kind: "auth",
          host: truncate(
            formatBrowserAuthHost(authInfo),
            PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH,
          ),
          // Basic auth over http puts the password on the wire in the clear.
          insecure: !details.url.startsWith("https:"),
        },
        entry,
        hostWindow,
        settle: (answer) => {
          if (entry.pendingAuth === pendingAuth) {
            entry.pendingAuth = null;
          }
          for (const waiting of pendingAuth.callbacks) {
            if (answer.kind === "credentials") {
              waiting(answer.username, answer.password);
            } else {
              waiting();
            }
          }
        },
        tabId,
      });
      if (!opened) {
        callback();
        return;
      }
      entry.pendingAuth = pendingAuth;
    });

    webContents.on(
      "certificate-error",
      (event, url, error, certificate, callback, isMainFrame) => {
        event.preventDefault();
        const host = browserUrlHost(url);
        const key = `${host}|${certificate.fingerprint}`;
        if (acceptedCertificates.has(key)) {
          callback(true);
          return;
        }
        // Only the page itself may be trusted by hand. A subresource riding on
        // a bad certificate is not something a user can judge — they cannot see
        // what it is — so it is refused unless the same certificate was already
        // accepted for the page.
        if (!isMainFrame) {
          callback(false);
          return;
        }
        const opened = openPagePrompt({
          details: {
            kind: "certificate",
            host: truncate(
              host,
              PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH,
            ),
            errorCode: truncate(
              error,
              PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH,
            ),
            subjectName: truncate(
              certificate.subjectName,
              PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH,
            ),
            issuerName: truncate(
              certificate.issuerName,
              PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH,
            ),
            validFrom: certificate.validStart,
            validTo: certificate.validExpiry,
            fingerprint: truncate(
              certificate.fingerprint,
              PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH,
            ),
          },
          entry,
          hostWindow,
          settle: (answer) => {
            if (answer.kind !== "proceed") {
              callback(false);
              return;
            }
            rememberAcceptedCertificate(key);
            callback(true);
          },
          tabId,
        });
        if (!opened) {
          callback(false);
        }
      },
    );

    webContents.on(
      "select-client-certificate",
      (event, url, certificateList, callback) => {
        // Without this, Electron hands over the first certificate in the store
        // — a client credential chosen for the user, by position.
        event.preventDefault();
        const offered = certificateList.slice(
          0,
          PATCHER_DESKTOP_BROWSER_MAX_CLIENT_CERTIFICATES,
        );
        if (offered.length === 0) {
          // Nothing to choose from, and the default is already prevented — so
          // decline explicitly. Returning here would leave the request waiting
          // on a callback nobody is going to call.
          declineClientCertificate(callback);
          return;
        }
        const opened = openPagePrompt({
          details: {
            kind: "client-certificate",
            host: truncate(
              browserUrlHost(url),
              PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH,
            ),
            certificates: offered.map((certificate, index) => ({
              index,
              subjectName: truncate(
                certificate.subjectName,
                PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH,
              ),
              issuerName: truncate(
                certificate.issuerName,
                PATCHER_DESKTOP_BROWSER_MAX_PROMPT_TEXT_LENGTH,
              ),
              validTo: certificate.validExpiry,
            })),
          },
          entry,
          hostWindow,
          settle: (answer) => {
            const chosen =
              answer.kind === "client-certificate"
                ? offered[answer.index]
                : undefined;
            if (chosen !== undefined) {
              callback(chosen);
              return;
            }
            declineClientCertificate(callback);
          },
          tabId,
        });
        if (!opened) {
          declineClientCertificate(callback);
        }
      },
    );

    // A page that asked for fullscreen and got it — a video player's button.
    // Two things have to happen for this to be the fullscreen Chromium gives:
    // the window goes to the OS's full screen, and the view takes the whole
    // content area of it (app chrome included), with the renderer's own rect
    // waiting in `desiredBounds` for the way back.
    //
    // The window half is driven here rather than by Electron, whose own
    // handling is turned off for this view (`disableHtmlFullscreenWindowResize`
    // — see `createEntry`): its version cannot tell a window the *user* had
    // already put in full screen from one it expanded itself, and would drop
    // the user out of theirs when a video ended.
    webContents.on("enter-html-full-screen", () => {
      entry.htmlFullscreen = true;
      if (!hostWindow.isDestroyed() && !hostWindow.isFullScreen()) {
        entry.windowFullscreenForPage = true;
        hostWindow.setFullScreen(true);
      }
      // The OS animates its way there and the content bounds grow behind it, so
      // this is the pre-animation size; the window's own resize burst re-applies
      // these bounds when it settles (`endWindowResize`).
      applyEntryDesiredBounds(entry, hostWindow);
    });
    webContents.on("leave-html-full-screen", () => {
      entry.htmlFullscreen = false;
      restoreWindowFromPageFullscreen(entry, hostWindow);
      applyEntryDesiredBounds(entry, hostWindow);
    });

    // A dead renderer leaves a blank view forever. Routing it through the same
    // error text `did-fail-load` uses is what gives it the screen that already
    // exists, with the reload button on it.
    webContents.on("render-process-gone", (_event, details) => {
      if (details.reason === "clean-exit") {
        return;
      }
      entry.lastErrorText =
        details.reason === "oom"
          ? "This page ran out of memory."
          : "This page crashed.";
      pushState(hostWindow, tabId);
    });

    // Chromium's hang monitor waits tens of seconds before this fires, so it is
    // not a slow script — the page is stuck. Reported rather than killed: the
    // user gets the reload button, and a page that comes back on its own takes
    // its own message away.
    webContents.on("unresponsive", () => {
      entry.lastErrorText = PAGE_UNRESPONSIVE_ERROR_TEXT;
      pushState(hostWindow, tabId);
    });
    webContents.on("responsive", () => {
      if (entry.lastErrorText !== PAGE_UNRESPONSIVE_ERROR_TEXT) {
        return;
      }
      entry.lastErrorText = null;
      pushState(hostWindow, tabId);
    });

    // How the find bar learns what it found. Chromium counts while it scans, so
    // several of these arrive for one query and the count climbs; the id check
    // is what keeps a superseded query's late answer from landing on a newer
    // one — see `findRequestId`.
    webContents.on("found-in-page", (_event, result) => {
      if (entry.findRequestId !== result.requestId) {
        return;
      }
      send(hostWindow, PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL, {
        tabId,
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
        finalUpdate: result.finalUpdate,
      });
    });

    const refresh = () => pushState(hostWindow, tabId);
    webContents.on("did-start-loading", refresh);
    webContents.on("did-stop-loading", () => {
      dropStaleFavicon(hostWindow, tabId, entry);
      refresh();
    });
    webContents.on("did-navigate", (_event, url) => {
      commitEntryMainFrameUrl(entry, url);
      entry.lastErrorText = null;
      // The stylesheets went with the previous document: `insertCSS` lasts one
      // document, so this forgets the keys rather than removing them, and then
      // re-applies whatever the new address matches.
      entry.pageStyleDocument += 1;
      entry.appliedPageStyles.clear();
      void reconcilePageStyles(entry);
      // Snapshot refs name nodes in the document that produced them; a new
      // document means every ref is now either dangling or, worse, pointing at
      // whatever inherited that node id. Same contract Playwright has.
      invalidateSnapshotRefs(entry);
      // A new document ends Chromium's find session with it. Forgetting the id
      // here is what stops a straggling result from the old page being pushed
      // as if it described the new one.
      entry.findRequestId = null;
      // A site the user zoomed before comes back zoomed, decided by Chromium's
      // per-origin memory rather than by anything here — so the renderer is
      // told what the tab became rather than left showing the last tab's
      // percentage.
      pushZoom(hostWindow, tabId, entry);
      // Same moment, same reason: what the tab *became* is the shell's to report,
      // and the omnibox must not describe the page the user just left.
      pushPageSecurity(hostWindow, tabId, entry);
      refresh();
    });
    webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
      if (isMainFrame) {
        commitEntryMainFrameUrl(entry, url);
        // A same-document navigation keeps the document but routinely replaces
        // the view an SPA is showing, so the refs are just as stale.
        invalidateSnapshotRefs(entry);
        // The document survives, so its stylesheets do too — but the address
        // changed, and an SPA route is exactly where one site's pattern stops
        // matching and another's starts.
        void reconcilePageStyles(entry);
      }
      refresh();
    });
    webContents.on("did-start-navigation", () => {
      entry.lastErrorText = null;
      refresh();
    });
    webContents.on("page-title-updated", refresh);
    // A page's favicon URL is still never forwarded: the renderer receives only a
    // `data:` URI the shell built from bytes it fetched in the browsing session,
    // so the trusted Patcher app neither sees nor requests anything the page chose.
    // `desktop-browser-favicon.ts` carries the reasoning and the limits.
    webContents.on("page-favicon-updated", (_event, urls) => {
      void updateFavicon(hostWindow, tabId, entry, urls);
    });
    webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === ERR_ABORTED) {
          return;
        }
        entry.lastErrorText =
          errorDescription.length > 0
            ? errorDescription
            : "Failed to load page";
        refresh();
      },
    );
  }

  /**
   * Host a popup Chromium is creating, and tell the renderer to adopt it.
   *
   * Runs inside `createWindow`, synchronously, while `window.open()` is still
   * on the page's stack — which is why the tab id is the shell's to choose:
   * the page has its handle before the renderer has heard of the tab.
   *
   * The view is built from the options Electron passed rather than from our own
   * preferences, and that is the load-bearing part. Those options carry the
   * `webContents` Chromium already made for the popup, with its opener link
   * intact; building a fresh one instead would produce a window that looks the
   * same and has no opener, which is the bug this whole path exists to fix.
   * They also carry the opener's own web preferences — sandboxed, isolated, no
   * node, no preload, our partition — because a popup inherits them, so passing
   * them through is what keeps the hardening rather than what loses it.
   */
  function createPopupEntry(args: {
    hostWindow: DesktopBrowserHostWindow;
    openerEntry: BrowserViewEntry;
    openerTabId: string;
    options: BrowserWindowConstructorOptions;
    url: string;
  }): WebContents {
    popupSequence += 1;
    const tabId = `browser-popup:${popupSequence}`;
    const adopted = (args.options as { webContents?: WebContents }).webContents;
    const view = new WebContentsView(
      adopted === undefined
        ? { webPreferences: args.options.webPreferences }
        : { webContents: adopted },
    );
    createEntry({
      // Where the opener sits, so the popup lands in the panel rather than at
      // the window's corner for the frame before the renderer measures it.
      desiredBounds: args.openerEntry.desiredBounds,
      hostWindow: args.hostWindow,
      tabId,
      view,
    });
    send(args.hostWindow, PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL, {
      kind: "opened",
      openerTabId: args.openerTabId,
      tabId,
      url: truncate(args.url, PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH),
    });
    return view.webContents;
  }

  function createEntry(args: CreateEntryArgs): BrowserViewEntry {
    ensureHardenedSession();
    const view =
      args.view ??
      new WebContentsView({
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true,
          allowRunningInsecureContent: false,
          // Chromium's built-in PDF viewer, which is what this preference gates
          // now that NPAPI and PPAPI are gone — "plugins" is a name from an era
          // that ended, and the only one left is PDFium.
          //
          // Without it a PDF link is not a page, it is a download: Chromium's
          // fallback for a document it cannot display. That is a browser failing
          // at something a user does weekly, so the viewer is on. What it admits
          // is one more parser of a complex format next to untrusted content —
          // bounded by PDFium running in its own sandboxed process, which is the
          // same bargain every Chromium-based browser makes.
          plugins: true,
          // A page entering HTML fullscreen must not drag the whole app window
          // into the OS's fullscreen, which is Electron's default. The view takes
          // the window's content area instead (`applyEntryDesiredBounds`), so the
          // page gets the fullscreen it asked for while the window state stays
          // the user's.
          disableHtmlFullscreenWindowResize: true,
          // Intentionally NO preload: browsed pages are untrusted and must never
          // receive a Patcher bridge.
        },
      });
    const entry: BrowserViewEntry = {
      view,
      tabId: args.tabId,
      hostWindow: args.hostWindow,
      lastErrorText: null,
      currentMainFrameLocalOriginKey: null,
      desiredBounds: args.desiredBounds,
      popupTimestamps: [],
      shellCreated: args.view !== undefined,
      faviconUrl: null,
      faviconPageKey: null,
      faviconFetchTimestamps: [],
      downloadTimestamps: [],
      appliedPageStyles: new Map(),
      pageStyleDocument: 0,
      pageScriptCallTimestamps: [],
      overlayActive: false,
      visible: false,
      findRequestId: null,
      cdp: null,
      pendingDialog: null,
      pagePrompt: null,
      pendingAuth: null,
      htmlFullscreen: false,
      windowFullscreenForPage: false,
      userFullscreen: false,
      devToolsView: null,
      devToolsVisible: null,
      dialogsWired: false,
      automationWorldId: null,
      consoleLog: new BrowserObservationLog(
        PATCHER_BROWSER_OBSERVATION_BUFFER_SIZE,
      ),
      networkLog: new BrowserObservationLog(
        PATCHER_BROWSER_OBSERVATION_BUFFER_SIZE,
      ),
      routes: [],
      routesWired: false,
      routesEnabled: false,
      offline: false,
      video: null,
      videoWired: false,
      mousePoint: { x: 0, y: 0 },
      snapshotRefs: new Map(),
      snapshotGeneration: 0,
    };
    wireWebContents(args.hostWindow, args.tabId, entry);
    args.hostWindow.contentView.addChildView(view);
    entries.set(browserViewKey(args.hostWindow, args.tabId), entry);
    entriesByWebContentsId.set(view.webContents.id, entry);
    return entry;
  }

  function loadIfNeeded(entry: BrowserViewEntry, url: string): void {
    if (url.length === 0) {
      return;
    }
    if (entry.view.webContents.getURL() === url) {
      return;
    }
    if (!isAllowedBrowserUrl(url)) {
      return;
    }
    entry.lastErrorText = null;
    entry.view.webContents.loadURL(url).catch(() => {
      // Usually surfaced through `did-fail-load`; swallow the rejection.
    });
  }

  function destroyEntry(
    hostWindow: DesktopBrowserHostWindow,
    key: string,
  ): void {
    const entry = entries.get(key);
    if (!entry) {
      return;
    }
    // A question nobody will answer now: cancel it, so the request it is
    // holding fails instead of hanging on a callback that is about to be
    // unreachable.
    closePagePrompt(hostWindow, entry.tabId, entry, { kind: "cancel" });
    // Closing a tab mid-video must not leave the window in the full screen that
    // tab's page asked for.
    restoreWindowFromPageFullscreen(entry, hostWindow);
    // Nor leave its DevTools drawn over the tab that takes its place.
    closeDevToolsView(entry, hostWindow);
    // Before anything is torn down: this is the last moment the page's own
    // history and scroll still exist.
    rememberClosedTabSession(entry);
    entries.delete(key);
    entriesByWebContentsId.delete(entry.view.webContents.id);
    releaseCdpSession(entry);
    clearEntryLocalOriginState(entry);
    if (!hostWindow.isDestroyed()) {
      hostWindow.contentView.removeChildView(entry.view);
    }
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.close();
    }
  }

  /**
   * The tab's CDP session, attached on first use. Automation is what pays for
   * the debugger, so nothing else in the shell ever calls this.
   */
  function ensureCdpSession(entry: BrowserViewEntry): CdpSession {
    if (entry.cdp !== null && entry.cdp.isAttached()) {
      return entry.cdp;
    }
    const session = createCdpSession({
      target: entry.view.webContents.debugger,
      onDetach: () => {
        // Refs were resolved against a session that no longer exists.
        entry.cdp = null;
        invalidateSnapshotRefs(entry);
        forgetEntryInterception(entry);
      },
    });
    entry.cdp = session;
    return session;
  }

  /**
   * Chromium drops request interception, network emulation and the screencast
   * when its protocol client goes, so the tab is routed, online and unfilmed
   * again whether we like it or not. Forgetting them here is what stops
   * `route-list` describing a tab that is no longer mocked, and `video-stop`
   * answering with a recording that stopped growing when the debugger did.
   */
  function forgetEntryInterception(entry: BrowserViewEntry): void {
    entry.routes = [];
    entry.routesWired = false;
    entry.routesEnabled = false;
    entry.offline = false;
    entry.video = null;
    entry.videoWired = false;
  }

  function releaseCdpSession(entry: BrowserViewEntry): void {
    entry.cdp?.detach();
    entry.cdp = null;
    entry.dialogsWired = false;
    entry.pendingDialog = null;
    forgetEntryInterception(entry);
  }

  /**
   * Take this tab's JavaScript dialogs.
   *
   * Enabling the `Page` domain is what moves dialogs off Chromium's native
   * modal and onto the protocol — which is the point (an agent can answer one)
   * and also the cost (a human now sees the app's dialog instead of the
   * system's). It happens per tab, on the same lazy attach automation pays for,
   * so a tab nobody has automated keeps the native behaviour.
   */
  async function ensureDialogInterception(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
    session: CdpSession,
  ): Promise<void> {
    if (entry.dialogsWired) {
      return;
    }
    entry.dialogsWired = true;

    session.on("Page.javascriptDialogOpening", (params) => {
      const opening = params as {
        type?: string;
        message?: string;
        defaultPrompt?: string;
      };
      const type = opening.type ?? "alert";
      entry.pendingDialog = {
        type:
          type === "confirm" || type === "prompt" || type === "beforeunload"
            ? type
            : "alert",
        message: truncate(
          opening.message ?? "",
          PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
        ),
        defaultPrompt: truncate(
          opening.defaultPrompt ?? "",
          PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
        ),
      };
      // Stand a bitmap of the frozen page in for the hidden view, so the dialog
      // appears over the page rather than over an empty panel. Same machinery
      // the resize burst uses; a capture that fails just leaves the panel bare.
      captureDialogPlaceholder(hostWindow, tabId, entry);
      applyEntryVisibility(entry, hostWindow);
      send(hostWindow, PATCHER_DESKTOP_BROWSER_DIALOG_CHANNEL, {
        tabId,
        dialog: entry.pendingDialog,
      });
    });

    session.on("Page.javascriptDialogClosed", () => {
      clearPendingDialog(hostWindow, tabId, entry);
    });

    await session.enableDomain("Page");
  }

  function captureDialogPlaceholder(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    entry.view.webContents
      .capturePage()
      .then((image) => {
        if (entry.pendingDialog === null || image.isEmpty()) {
          return;
        }
        send(hostWindow, PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
          tabId,
          dataUrl: `data:image/jpeg;base64,${image
            .toJPEG(RESIZE_SNAPSHOT_JPEG_QUALITY)
            .toString("base64")}`,
        });
      })
      .catch(() => {
        // No placeholder; the panel's own background shows behind the dialog.
      });
  }

  function clearPendingDialog(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    if (entry.pendingDialog === null) {
      return;
    }
    entry.pendingDialog = null;
    applyEntryVisibility(entry, hostWindow);
    // Reveal first, then drop the placeholder, so the swap never flashes an
    // empty panel — the same ordering `endWindowResize` uses.
    send(hostWindow, PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
      tabId,
      dataUrl: null,
    });
    send(hostWindow, PATCHER_DESKTOP_BROWSER_DIALOG_CHANNEL, {
      tabId,
      dialog: null,
    });
  }

  /**
   * Give the window back the state it had before a page took it fullscreen.
   * Does nothing when the window was already there — that was the user's doing,
   * and a video ending is not a reason to drop them out of it.
   */
  function restoreWindowFromPageFullscreen(
    entry: BrowserViewEntry,
    hostWindow: DesktopBrowserHostWindow,
  ): void {
    if (!entry.windowFullscreenForPage) {
      return;
    }
    entry.windowFullscreenForPage = false;
    if (!hostWindow.isDestroyed()) {
      hostWindow.setFullScreen(false);
    }
  }

  /**
   * The view Chromium's DevTools draw into, created on first use.
   *
   * `setDevToolsWebContents` is what makes this the real thing rather than a
   * panel that looks like it, and `mode: "detach"` is how Electron is told the
   * host is ours: without it Chromium would dock the tools into a window of its
   * own choosing.
   *
   * The view takes default web preferences on purpose. It is not a browsed
   * page: it is Chromium's own UI, and handing it the hardened, partitioned,
   * sandboxed preferences meant for untrusted content would break the tools
   * rather than contain them.
   */
  function ensureDevToolsView(
    entry: BrowserViewEntry,
    hostWindow: DesktopBrowserHostWindow,
  ): WebContentsView | null {
    if (entry.devToolsView !== null) {
      return entry.devToolsView;
    }
    if (entry.view.webContents.isDestroyed() || hostWindow.isDestroyed()) {
      return null;
    }
    const devToolsView = new WebContentsView();
    entry.devToolsView = devToolsView;
    hostWindow.contentView.addChildView(devToolsView);
    entry.view.webContents.setDevToolsWebContents(devToolsView.webContents);
    entry.view.webContents.openDevTools({ mode: "detach" });
    return devToolsView;
  }

  function closeDevToolsView(
    entry: BrowserViewEntry,
    hostWindow: DesktopBrowserHostWindow,
  ): void {
    const devToolsView = entry.devToolsView;
    if (devToolsView === null) {
      return;
    }
    entry.devToolsView = null;
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.webContents.closeDevTools();
    }
    if (!hostWindow.isDestroyed()) {
      hostWindow.contentView.removeChildView(devToolsView);
    }
    if (!devToolsView.webContents.isDestroyed()) {
      devToolsView.webContents.close();
    }
  }

  function rememberAcceptedCertificate(key: string): void {
    acceptedCertificates.add(key);
    if (acceptedCertificates.size <= MAX_ACCEPTED_CERTIFICATES) {
      return;
    }
    const oldest = acceptedCertificates.values().next();
    if (!oldest.done) {
      acceptedCertificates.delete(oldest.value);
    }
  }

  /**
   * Put a network question in front of the user, and stop the page for it.
   *
   * Answers false when the tab already has one open, which is the whole
   * anti-nuisance policy: a page that can trigger challenges cannot stack
   * prompts, because the second one never opens. The caller decides what
   * refusing means for its own event — for every one of them it is "cancel",
   * which is what Chromium would have done unasked.
   */
  function openPagePrompt(args: {
    details: OpenPagePromptDetails;
    entry: BrowserViewEntry;
    hostWindow: DesktopBrowserHostWindow;
    settle: PendingPagePrompt["settle"];
    tabId: string;
  }): boolean {
    if (args.entry.pagePrompt !== null) {
      return false;
    }
    pagePromptSequence += 1;
    const details = {
      ...args.details,
      id: `page-prompt-${pagePromptSequence}`,
    } as PatcherDesktopBrowserPagePromptDetails;
    args.entry.pagePrompt = { details, settle: args.settle };
    // Stand a bitmap of the stopped page in behind the question, the way the
    // dialog path does — a prompt over an empty panel says less about what is
    // being asked.
    capturePagePromptPlaceholder(args.hostWindow, args.tabId, args.entry);
    applyEntryVisibility(args.entry, args.hostWindow);
    send(args.hostWindow, PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL, {
      tabId: args.tabId,
      prompt: details,
    });
    return true;
  }

  function capturePagePromptPlaceholder(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
  ): void {
    entry.view.webContents
      .capturePage()
      .then((image) => {
        if (entry.pagePrompt === null || image.isEmpty()) {
          return;
        }
        send(hostWindow, PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
          tabId,
          dataUrl: `data:image/jpeg;base64,${image
            .toJPEG(RESIZE_SNAPSHOT_JPEG_QUALITY)
            .toString("base64")}`,
        });
      })
      .catch(() => {
        // No placeholder; the panel's own background shows behind the prompt.
      });
  }

  /**
   * Answer the open prompt and let the page continue. Reveal, then drop the
   * placeholder, then tell the renderer, then settle — the same ordering
   * `clearPendingDialog` uses, with the network answer last because it is what
   * resumes the load.
   */
  function closePagePrompt(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry,
    answer: PatcherDesktopBrowserPagePromptAnswer["answer"],
  ): void {
    const pending = entry.pagePrompt;
    if (pending === null) {
      return;
    }
    entry.pagePrompt = null;
    applyEntryVisibility(entry, hostWindow);
    send(hostWindow, PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
      tabId,
      dataUrl: null,
    });
    send(hostWindow, PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL, {
      tabId,
      prompt: null,
    });
    pending.settle(answer);
  }

  /**
   * Whether an answer belongs to the question that was asked. A mismatch is
   * treated as a cancel rather than guessed at: the shapes differ because the
   * decisions differ, and "proceed" meant for a certificate must never become
   * a certificate handed to a server.
   */
  function pagePromptAnswerFits(
    details: PatcherDesktopBrowserPagePromptDetails,
    answer: PatcherDesktopBrowserPagePromptAnswer["answer"],
  ): boolean {
    if (answer.kind === "cancel") return true;
    if (details.kind === "auth") return answer.kind === "credentials";
    if (details.kind === "certificate") return answer.kind === "proceed";
    return answer.kind === "client-certificate";
  }

  function withEntry(
    args: HostScopedTabArgs,
    fn: (entry: BrowserViewEntry) => void,
  ): void {
    const entry = entries.get(browserViewKey(args.hostWindow, args.tabId));
    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
    }
    fn(entry);
  }

  /**
   * Snapshot a tab, optionally narrowed to what a selector matches.
   *
   * One function behind both methods, because the scoped and unscoped forms
   * differ by which node the render starts at and by nothing else — they take
   * the same locks, hand out refs the same way, and invalidate the same table.
   */
  async function captureTabSnapshot(args: {
    hostWindow: DesktopBrowserHostWindow;
    request:
      | PatcherDesktopBrowserSnapshotRequest
      | PatcherDesktopBrowserSnapshotInRequest;
  }): Promise<PatcherDesktopBrowserSnapshotResult> {
    const { hostWindow, request } = args;
    const entry = entries.get(browserViewKey(hostWindow, request.tabId));
    if (!entry || entry.view.webContents.isDestroyed()) {
      return { ok: false, reason: "no-view" };
    }
    if (entry.view.webContents.getURL().length === 0) {
      return { ok: false, reason: "no-page" };
    }

    let session: CdpSession;
    try {
      session = ensureCdpSession(entry);
    } catch (error) {
      // DevTools holding the tab is the realistic cause, and it is worth
      // saying so rather than reporting a generic failure.
      return {
        ok: false,
        reason: "debugger-unavailable",
        message: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      // Any automation on this tab means the shell owns its dialogs from now
      // on — otherwise the first `confirm()` would block the page with nothing
      // able to answer it.
      await ensureDialogInterception(hostWindow, request.tabId, entry, session);
      const selector = "selector" in request ? request.selector : null;
      // Resolved before the tree is fetched, so a selector that matches nothing
      // costs a page-sized response nobody reads.
      const backendNodeId =
        selector === null ? null : await resolveSelectorNode(session, selector);

      await session.enableDomain("Accessibility");
      const response = await session.send<{ nodes?: AxNode[] }>(
        "Accessibility.getFullAXTree",
      );
      const nodes = response.nodes ?? [];

      // Scoping narrows what is rendered, not what Chromium sends: the tree
      // arrives whole either way, because `Accessibility.getPartialAXTree`
      // answers with one level of children and rebuilding a subtree from it
      // would be a round trip per level. What it saves is the caller's context,
      // which is the scarce thing here.
      let root: AxNode | undefined;
      if (backendNodeId !== null) {
        const found = findBrowserSnapshotRoot(nodes, backendNodeId);
        if (found === null) {
          throw new SnapshotRefusal(
            "no-match",
            `${JSON.stringify(selector)} matched an element the accessibility tree does not describe — it is probably hidden.`,
          );
        }
        root = found;
      }

      const built = buildBrowserSnapshot({
        nodes,
        ...(root === undefined ? {} : { root }),
        maxDepth: request.maxDepth,
        maxLength: PATCHER_DESKTOP_BROWSER_MAX_SNAPSHOT_LENGTH,
      });

      // Replacing the table is itself an invalidation: refs from the previous
      // snapshot must not stay resolvable behind the new ones. A scoped
      // snapshot is no exception — it hands out `e1` again, for a different
      // element than the last one called `e1`.
      invalidateSnapshotRefs(entry);
      for (const { ref, backendNodeId: refNodeId } of built.refs) {
        entry.snapshotRefs.set(ref, refNodeId);
      }

      return {
        ok: true,
        tabId: request.tabId,
        ...entryPageIdentity(entry),
        snapshot: built.text,
        generation: entry.snapshotGeneration,
        refCount: built.refs.length,
        truncated: built.truncated,
      };
    } catch (error) {
      if (error instanceof SnapshotRefusal) {
        return { ok: false, reason: error.reason, message: error.message };
      }
      return {
        ok: false,
        reason: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Read a PDF tab the only way a PDF can be read: fetch the document again
   * and parse it out of process.
   *
   * The refetch goes through the browsing session, which is what makes a PDF
   * behind a login readable at all — the cookies that fetched it for the viewer
   * fetch it again here — and what keeps this from becoming a way to read a URL
   * the tab was never on. The fetch and the parse share one deadline, so a slow
   * server cannot buy the parser more time than the whole read is allowed.
   */
  async function readPdfText(
    url: string,
  ): Promise<DesktopBrowserPdfTextOutcome> {
    const deadline = Date.now() + PATCHER_DESKTOP_BROWSER_PDF_READ_TIMEOUT_MS;
    let response: Awaited<ReturnType<Session["fetch"]>>;
    try {
      response = await ensureHardenedSession().fetch(url, {
        // The whole point of refetching through this session rather than
        // plainly: a PDF behind a login is fetched with the cookies that
        // already opened it for the viewer.
        credentials: "include",
        signal: AbortSignal.timeout(
          PATCHER_DESKTOP_BROWSER_PDF_READ_TIMEOUT_MS,
        ),
      });
    } catch {
      // A `blob:` URL, a document that only exists as the answer to a POST, a
      // server that has stopped answering: one refusal covers them, because
      // none of them becomes readable by asking again the same way.
      return { ok: false, reason: "unreadable" };
    }
    if (!response.ok) {
      return { ok: false, reason: "unreadable" };
    }
    const read = await readBrowserPdfBytes(response).catch(() => null);
    if (read === null) {
      return { ok: false, reason: "unreadable" };
    }
    if (!read.ok) {
      return read;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return { ok: false, reason: "timeout" };
    }
    return await args.extractPdfText({
      bytes: read.bytes,
      timeoutMs: remaining,
    });
  }

  return {
    attach({ hostWindow, request }) {
      const key = browserViewKey(hostWindow, request.tabId);
      const existing = entries.get(key) ?? null;
      // A freshly-created entry starts hidden, so its prior visibility is false.
      const wasVisible = existing?.visible ?? false;
      const entry =
        existing ??
        createEntry({
          desiredBounds: request.bounds,
          hostWindow,
          tabId: request.tabId,
        });
      setEntryDesiredBounds({ bounds: request.bounds, entry, hostWindow });
      entry.visible = request.visible;
      applyEntryVisibility(entry, hostWindow);
      // Focus on a real not-visible → visible transition so a freshly-mounted
      // active tab (shown via attach, not setVisible) wires the Edit-menu
      // copy/cut/paste roles and Cmd+C to this view's webContents.
      if (
        request.visible &&
        !wasVisible &&
        !entry.view.webContents.isDestroyed()
      ) {
        entry.view.webContents.focus();
      }
      if (entry.shellCreated) {
        // A popup the renderer is adopting: it arrived with its page, and
        // loading into it would navigate away from the flow it was opened for.
        // From here it is an ordinary tab.
        entry.shellCreated = false;
      } else if (!restoreClosedTabSession(entry, request.url)) {
        loadIfNeeded(entry, request.url);
      }
      pushState(hostWindow, request.tabId);
    },
    print({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        // A tab showing nothing would print a blank sheet, which is a worse
        // answer than not opening the dialog at all.
        if (entry.view.webContents.getURL().length === 0) {
          return;
        }
        // The dialog is owned by the app window, so it blocks Patcher while it is up
        // — including an agent waiting on a browser command. That is the right
        // trade for a chord the user just pressed and the wrong one for
        // anything else, which is why this is reachable only from
        // `browser.print` and never from a plugin or a page.
        // No callback: printed, saved as PDF and cancelled are the same answer
        // from here, and the one real failure mode — a printer Chromium cannot
        // drive — is one the OS dialog reports to the user itself. This module
        // has no logger and no error channel, and inventing one for that would
        // be the wrong place to put it.
        entry.view.webContents.print({});
      });
    },
    detach({ hostWindow, tabId }) {
      destroyEntry(hostWindow, browserViewKey(hostWindow, tabId));
    },
    navigate({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        loadIfNeeded(entry, request.url);
      });
    },
    goBack({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoBack()) {
          entry.view.webContents.navigationHistory.goBack();
        }
      });
    },
    goForward({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoForward()) {
          entry.view.webContents.navigationHistory.goForward();
        }
      });
    },
    reload({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        entry.view.webContents.reload();
      });
    },
    stop({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        entry.view.webContents.stop();
      });
    },
    setOverlay({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return;
      }
      if (entry.overlayActive === request.active) {
        return;
      }
      entry.overlayActive = request.active;
      if (!request.active) {
        // Reveal first, then drop the placeholder, so the swap never flashes an
        // empty panel — the ordering `clearPendingDialog` uses.
        applyEntryVisibility(entry, hostWindow);
        send(hostWindow, PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
          tabId: request.tabId,
          dataUrl: null,
        });
        return;
      }
      // Capture *before* hiding, unlike the dialog path. A dialog has already
      // blocked the page and must be hidden at once; this is a menu the user
      // opened, so it can afford the round trip and open without a flash of
      // empty panel.
      entry.view.webContents
        .capturePage()
        .then((image) => {
          if (!entry.overlayActive || entry.view.webContents.isDestroyed()) {
            return;
          }
          if (!image.isEmpty()) {
            send(hostWindow, PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
              tabId: request.tabId,
              dataUrl: `data:image/jpeg;base64,${image
                .toJPEG(RESIZE_SNAPSHOT_JPEG_QUALITY)
                .toString("base64")}`,
            });
          }
          applyEntryVisibility(entry, hostWindow);
        })
        .catch(() => {
          // No placeholder; hide anyway, because the overlay is already being
          // drawn and a live page under it would be drawn over by nothing.
          if (entry.overlayActive) {
            applyEntryVisibility(entry, hostWindow);
          }
        });
    },
    setFullscreen({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        if (entry.userFullscreen === request.fullscreen) {
          return;
        }
        entry.userFullscreen = request.fullscreen;
        applyEntryDesiredBounds(entry, hostWindow);
      });
    },
    find({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        const webContents = entry.view.webContents;
        if (request.action === "stop" || request.query.length === 0) {
          if (entry.findRequestId !== null) {
            // `clearSelection`, not `keepSelection`: closing the find bar leaves
            // the page as the user had it rather than with a selection they
            // never made.
            webContents.stopFindInPage("clearSelection");
            entry.findRequestId = null;
          }
          // The keyboard was in the find field, which is about to be gone. Hand
          // it back to the page — only the shell can focus a native view.
          if (entry.visible && !entry.overlayActive) {
            webContents.focus();
          }
          return;
        }
        entry.findRequestId = webContents.findInPage(request.query, {
          // `findNext` is Chromium's `new_session` under a misleading name: true
          // begins a search, false steps through the one already running. A step
          // with no session behind it — the first Enter after a navigation ended
          // one — is a new search rather than a no-op.
          findNext: request.action === "start" || entry.findRequestId === null,
          forward: request.action !== "previous",
        });
      });
    },
    setDevTools({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        if (!request.open) {
          closeDevToolsView(entry, hostWindow);
          return;
        }
        const devToolsView = ensureDevToolsView(entry, hostWindow);
        // Re-sent on every resize, which is what makes this both the open and
        // the placement command.
        devToolsView?.setBounds(
          clampPatcherDesktopBrowserViewBounds({
            bounds: request.bounds,
            viewport: hostWindowViewportBounds({ hostWindow }),
          }),
        );
        applyEntryVisibility(entry, hostWindow);
      });
    },
    setDevToolsVisible({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        if (entry.devToolsVisible === request.visible) {
          return;
        }
        entry.devToolsVisible = request.visible;
        applyEntryVisibility(entry, hostWindow);
      });
    },
    setPopupTabs({ hostWindow, request }) {
      const prefix = `${hostWindow.webContents.id}:`;
      for (const key of [...popupTabKeys]) {
        if (key.startsWith(prefix)) {
          popupTabKeys.delete(key);
        }
      }
      for (const tabId of request.tabIds) {
        popupTabKeys.add(browserViewKey(hostWindow, tabId));
      }
    },
    setContextMenuItems({ request }) {
      contextMenuItems = request.items;
    },
    setPageStyles({ request }) {
      pageStyles = request.styles;
      // Every open page, not only the active one: a style the user just enabled
      // should not wait for a navigation in a background tab to take effect, and
      // one whose plugin was just removed should stop applying everywhere at
      // once.
      for (const entry of entries.values()) {
        void reconcilePageStyles(entry);
      }
    },
    setPageScripts({ request }) {
      pageScripts = request.scripts;
      // No walk over open views, unlike the styles above: a document already
      // running cannot be given a world it was not created with, and reloading
      // the user's pages under them to make an install feel instant is not a
      // trade the browser gets to make. The next load runs it.
      syncPageScriptPreload();
    },
    pageScriptBootstrap({ webContentsId, url }) {
      // Scoped to views this manager knows: the browsing session's preload runs
      // in every frame it creates, and only a tab has a plugin list behind it.
      return entriesByWebContentsId.has(webContentsId)
        ? { worlds: pageScriptWorldsFor(url) }
        : { worlds: [] };
    },
    pageScriptRpc(callArgs) {
      return callPageScriptRpc(callArgs);
    },
    respondToPageScriptCall({ result }) {
      const settle = pendingPageScriptCalls.get(result.callId);
      if (settle === undefined) {
        // The call timed out, or the page navigated away from the script that
        // asked. Dropping it is the whole point of correlating by id.
        return;
      }
      pendingPageScriptCalls.delete(result.callId);
      settle(
        result.ok
          ? { ok: true, result: result.result }
          : { ok: false, message: result.message },
      );
    },
    async downloadAction({ action, savePath }) {
      if (!writtenDownloadPaths.has(savePath)) {
        return {
          ok: false,
          reason: "unknown-path",
          message: "Patcher did not download that file.",
        };
      }
      if (action === "reveal") {
        // Showing a file in the file manager answers nothing, and cannot fail
        // in a way a caller could act on: a missing file simply opens its
        // folder.
        args.revealDownloadPath(savePath);
        return { ok: true };
      }
      const failure = await args.openDownloadPath(savePath);
      // Electron's `openPath` reports failure as a non-empty string rather than
      // by rejecting; the usual content is that the file no longer exists.
      return failure.length === 0
        ? { ok: true }
        : {
            ok: false,
            reason: "failed",
            message: truncate(
              failure,
              PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
            ),
          };
    },
    async readPage({ hostWindow, tabId }) {
      const entry = entries.get(browserViewKey(hostWindow, tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      const webContents = entry.view.webContents;
      // The empty-URL new-tab convention (see `loadIfNeeded`): the view exists
      // but is showing nothing, which is a different answer from "no view".
      if (webContents.getURL().length === 0) {
        return { ok: false, reason: "no-page" };
      }

      const raw = await runIsolatedScript(
        webContents,
        PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT,
      );

      if (raw.kind === "timeout") {
        return { ok: false, reason: "timeout" };
      }
      if (raw.kind === "failed") {
        return { ok: false, reason: "unreadable" };
      }
      // The page can be torn down while its own script is in flight.
      if (webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      const content = parseBrowserPageReadContent(raw.value);
      if (content === null) {
        return { ok: false, reason: "unreadable" };
      }
      const { contentType, ...page } = content;

      if (isBrowserPdfContentType(contentType)) {
        const pdf = await readPdfText(webContents.getURL());
        if (webContents.isDestroyed()) {
          return { ok: false, reason: "no-view" };
        }
        if (!pdf.ok) {
          return { ok: false, reason: pdf.reason };
        }
        return {
          ok: true,
          tabId,
          ...entryPageIdentity(entry),
          isLoading: webContents.isLoadingMainFrame(),
          contentKind: "pdf",
          text: pdf.text,
          textTruncated: pdf.truncated,
          // Nothing selected, rather than nothing to select: what a user
          // highlights in the viewer is PDFium's, and `getSelection()` on the
          // wrapper frame cannot see it.
          selection: "",
          selectionTruncated: false,
        };
      }

      return {
        ok: true,
        tabId,
        ...entryPageIdentity(entry),
        isLoading: webContents.isLoadingMainFrame(),
        contentKind: "html",
        ...page,
      };
    },
    snapshot({ hostWindow, request }) {
      return captureTabSnapshot({ hostWindow, request });
    },
    snapshotIn({ hostWindow, request }) {
      return captureTabSnapshot({ hostWindow, request });
    },
    respondToPagePrompt({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      const pending = entry?.pagePrompt ?? null;
      if (entry === undefined || pending === null) {
        return Promise.resolve(false);
      }
      // The tab may have moved on while a human was typing: a prompt that was
      // replaced (or reopened) is not the one this answer was written for.
      if (pending.details.id !== request.id) {
        return Promise.resolve(false);
      }
      closePagePrompt(
        hostWindow,
        request.tabId,
        entry,
        pagePromptAnswerFits(pending.details, request.answer)
          ? request.answer
          : { kind: "cancel" },
      );
      return Promise.resolve(true);
    },
    async respondToDialog({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (
        !entry ||
        entry.view.webContents.isDestroyed() ||
        entry.pendingDialog === null ||
        entry.cdp === null
      ) {
        return false;
      }
      const isPrompt = entry.pendingDialog.type === "prompt";
      try {
        await entry.cdp.send("Page.handleJavaScriptDialog", {
          accept: request.accept,
          // Chromium rejects promptText on a non-prompt dialog.
          ...(isPrompt && request.accept
            ? { promptText: request.promptText ?? "" }
            : {}),
        });
      } catch {
        // The page may have gone while the answer was in flight. Fall through:
        // clearing the state below is what stops the view staying hidden.
        clearPendingDialog(hostWindow, request.tabId, entry);
        return false;
      }
      // `Page.javascriptDialogClosed` also clears this; doing it here as well
      // keeps the view from staying hidden if that event never arrives.
      clearPendingDialog(hostWindow, request.tabId, entry);
      return true;
    },
    async interact({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      if (entry.view.webContents.getURL().length === 0) {
        return { ok: false, reason: "no-page" };
      }

      let session: CdpSession;
      try {
        session = ensureCdpSession(entry);
      } catch (error) {
        return {
          ok: false,
          reason: "debugger-unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      try {
        // Same reason as in `snapshot`: from the moment we drive this tab, its
        // dialogs are ours to answer. A click that opens a `confirm()` would
        // otherwise block the page with nothing able to respond.
        await ensureDialogInterception(
          hostWindow,
          request.tabId,
          entry,
          session,
        );
        await session.enableDomain("DOM");
        await performInteraction(session, entry, request);
      } catch (error) {
        if (error instanceof InteractionRefusal) {
          return { ok: false, reason: error.reason, message: error.message };
        }
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      // A click that navigated has already changed these; reporting them saves
      // the caller a round trip it would otherwise race.
      return {
        ok: true,
        tabId: request.tabId,
        ...entryPageIdentity(entry),
      };
    },
    async observe({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      try {
        return await captureObservation(
          entry,
          request.tabId,
          request.observation,
        );
      } catch (error) {
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async captureFullPage({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      if (entry.view.webContents.getURL().length === 0) {
        return { ok: false, reason: "no-page" };
      }

      let session: CdpSession;
      try {
        session = ensureCdpSession(entry);
      } catch (error) {
        return {
          ok: false,
          reason: "debugger-unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      // No `ensureDialogInterception` here, unlike every other command that
      // attaches a session: this one does not drive the page, so it cannot
      // provoke a dialog, and taking a tab's dialogs over is a visible change
      // to how the browser behaves for the human using it. A picture should not
      // cost that.
      try {
        return await captureFullPageImage(entry, session, request);
      } catch (error) {
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async storage({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      try {
        return await captureStorage({
          entry,
          tabId: request.tabId,
          operation: request.operation,
          // The browsed partition's jar, which is the only one these views ever
          // write to — nothing here can reach the app's own session.
          cookies: ensureHardenedSession().cookies,
        });
      } catch (error) {
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async control({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      // `route-list` is the exception worth allowing on a blank tab: routes are
      // set up before a page is loaded as often as after, and answering "no
      // page" to a question about the tab's own state would be wrong.
      if (
        entry.view.webContents.getURL().length === 0 &&
        request.operation.kind !== "route-list"
      ) {
        return { ok: false, reason: "no-page" };
      }

      let session: CdpSession;
      try {
        session = ensureCdpSession(entry);
      } catch (error) {
        return {
          ok: false,
          reason: "debugger-unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      try {
        // Same reason as in `snapshot` and `interact`: once we drive this tab,
        // its dialogs are ours to answer, and an evaluated `confirm()` would
        // otherwise block the page with nothing able to respond.
        await ensureDialogInterception(
          hostWindow,
          request.tabId,
          entry,
          session,
        );
        return await performControl(session, entry, request.tabId, request);
      } catch (error) {
        if (error instanceof ControlRefusal) {
          return { ok: false, reason: error.reason, message: error.message };
        }
        if (error instanceof InteractionRefusal) {
          return {
            ok: false,
            reason: controlRefusalReason(error.reason),
            message: error.message,
          };
        }
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async record({ hostWindow, request }) {
      const entry = entries.get(browserViewKey(hostWindow, request.tabId));
      if (!entry || entry.view.webContents.isDestroyed()) {
        return { ok: false, reason: "no-view" };
      }
      // Only starting needs a page: a film of a blank tab is a blank film,
      // while stopping one has frames to hand back whatever the tab shows now.
      if (
        entry.view.webContents.getURL().length === 0 &&
        request.operation.kind === "video-start"
      ) {
        return { ok: false, reason: "no-page" };
      }

      let session: CdpSession;
      try {
        session = ensureCdpSession(entry);
      } catch (error) {
        return {
          ok: false,
          reason: "debugger-unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }

      try {
        // Filming needs the `Page` domain, and enabling it is what moves this
        // tab's dialogs onto the protocol. So the same rule as everywhere else
        // applies, and for a sharper reason: a page that opens a dialog
        // mid-recording would otherwise sit there with nobody able to answer it.
        await ensureDialogInterception(
          hostWindow,
          request.tabId,
          entry,
          session,
        );
        return await performRecord(
          session,
          entry,
          request.tabId,
          request.operation,
        );
      } catch (error) {
        return {
          ok: false,
          reason: "failed",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    setBounds({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        setEntryDesiredBounds({ bounds: request.bounds, entry, hostWindow });
      });
    },
    setZoom({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        entry.view.webContents.setZoomFactor(request.factor);
        // Echoed rather than assumed: Chromium is free to clamp, and the
        // renderer has to show what happened, not what was asked for.
        pushZoom(hostWindow, request.tabId, entry);
      });
    },
    setMuted({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        entry.view.webContents.setAudioMuted(request.muted);
      });
    },
    setVisible({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        const wasVisible = entry.visible;
        entry.visible = request.visible;
        applyEntryVisibility(entry, hostWindow);
        // Focus the view only on a real not-visible → visible transition so the
        // Edit-menu copy/cut/paste roles and Cmd+C target this view's
        // webContents (the focused one). Skip redundant re-syncs so we never
        // yank focus away from the React address bar mid-interaction.
        if (
          request.visible &&
          !wasVisible &&
          !entry.view.webContents.isDestroyed()
        ) {
          entry.view.webContents.focus();
        }
      });
    },
    beginWindowResize(hostWindow) {
      if (isHostResizing(hostWindow)) {
        return;
      }
      resizingHostIds.add(hostWindow.webContents.id);
      const prefix = `${hostWindow.webContents.id}:`;
      for (const [key, entry] of entries.entries()) {
        if (!key.startsWith(prefix) || entry.view.webContents.isDestroyed()) {
          continue;
        }
        if (entry.visible) {
          startResizeSnapshot(hostWindow, key.slice(prefix.length), entry);
        }
      }
    },
    endWindowResize(hostWindow) {
      if (!isHostResizing(hostWindow)) {
        return;
      }
      resizingHostIds.delete(hostWindow.webContents.id);
      const prefix = `${hostWindow.webContents.id}:`;
      for (const [key, entry] of entries.entries()) {
        if (!key.startsWith(prefix) || entry.view.webContents.isDestroyed()) {
          continue;
        }
        if (entry.visible) {
          applyEntryDesiredBounds(entry, hostWindow);
        }
        applyEntryVisibility(entry, hostWindow);
        send(hostWindow, PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL, {
          tabId: key.slice(prefix.length),
          dataUrl: null,
        });
      }
    },
    releaseWindow(hostWebContentsId) {
      resizingHostIds.delete(hostWebContentsId);
      const prefix = `${hostWebContentsId}:`;
      for (const [key, entry] of [...entries.entries()]) {
        if (!key.startsWith(prefix)) {
          continue;
        }
        entries.delete(key);
        entriesByWebContentsId.delete(entry.view.webContents.id);
        clearEntryLocalOriginState(entry);
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
    destroyAll() {
      resizingHostIds.clear();
      for (const [key, entry] of [...entries.entries()]) {
        entries.delete(key);
        entriesByWebContentsId.delete(entry.view.webContents.id);
        clearEntryLocalOriginState(entry);
        if (!entry.view.webContents.isDestroyed()) {
          entry.view.webContents.close();
        }
      }
    },
  };
}
