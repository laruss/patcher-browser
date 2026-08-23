import type { WebContentsView } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION,
  PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  type PatcherDesktopBrowserDownload,
  type PatcherDesktopBrowserPageScriptCall,
  type PatcherDesktopBrowserViewBounds,
} from "@patcher/desktop-contract";
import { PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT } from "../src/desktop-browser-capture.js";
import {
  PATCHER_DESKTOP_BROWSER_DOWNLOAD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FAVICON_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_SECURITY_CHANNEL,
  PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
} from "../src/desktop-browser-ipc.js";
import {
  PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT,
  PATCHER_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS,
  PATCHER_DESKTOP_BROWSER_PAGE_READ_WORLD_ID,
} from "../src/desktop-browser-page-read.js";
import {
  PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
  PATCHER_BROWSER_PREPARE_FILL_SCRIPT,
  PATCHER_BROWSER_READ_CHECKED_SCRIPT,
} from "../src/desktop-browser-actions.js";
import {
  createDesktopBrowserViewManager as createProductionDesktopBrowserViewManager,
  isAllowedBrowserPermission,
  type CreateDesktopBrowserViewManagerArgs,
  type DesktopBrowserViewManager,
  type DesktopBrowserHostContentBounds,
  type DesktopBrowserHostContentView,
  type DesktopBrowserHostWebContents,
  type DesktopBrowserHostWebContentsPayload,
  type DesktopBrowserHostWindow,
} from "../src/desktop-browser-view.js";

const TEST_DOWNLOAD_DIRECTORY = "/tmp/patcher-test-downloads";
const TEST_PAGE_SCRIPT_PRELOAD_PATH = "/app/dist/page-script-preload.cjs";

function createDesktopBrowserViewManager(
  args: Partial<CreateDesktopBrowserViewManagerArgs> = {},
): DesktopBrowserViewManager {
  return createProductionDesktopBrowserViewManager({
    dispatchAppCommand: () => undefined,
    // No test touches a real disk: downloads resolve against a directory that
    // exists nowhere and a filesystem that reports every path free.
    downloadPathExists: () => false,
    // Nothing is forked either: a test that wants a PDF read overrides this.
    extractPdfText: async () => ({ ok: false, reason: "unreadable" }),
    focusHostWebContents: () => undefined,
    openDownloadPath: async () => "",
    openExternalUrl: () => undefined,
    revealDownloadPath: () => undefined,
    resolveDownloadDirectory: () => TEST_DOWNLOAD_DIRECTORY,
    resolveAppCommand: () => null,
    pageScriptPreloadPath: TEST_PAGE_SCRIPT_PRELOAD_PATH,
    ...args,
  });
}

interface FakePreventableEvent {
  defaultPrevented: boolean;
  preventDefault(): void;
}

interface FakeWebContentsEvent {}

interface FakeNavigationEvent extends FakePreventableEvent {
  initiator?: FakeWebFrameMain | null;
  isMainFrame: boolean;
  url: string;
}

type FakeVoidWebContentsListener = () => void;

type FakeWillFrameNavigateListener = (event: FakeNavigationEvent) => void;

type FakeWillNavigateListener = (
  event: FakeNavigationEvent,
  url: string,
) => void;

type FakeWillRedirectListener = (
  event: FakeNavigationEvent,
  url: string,
  isInPlace: boolean,
  isMainFrame: boolean,
) => void;

type FakeDidNavigateListener = (
  event: FakeWebContentsEvent,
  url: string,
) => void;

type FakeDidNavigateInPageListener = (
  event: FakeWebContentsEvent,
  url: string,
  isMainFrame: boolean,
) => void;

type FakePageFaviconUpdatedListener = (
  event: FakeWebContentsEvent,
  urls: string[],
) => void;

type FakeDidFailLoadListener = (
  event: FakeWebContentsEvent,
  errorCode: number,
  errorDescription: string,
  validatedURL: string,
  isMainFrame: boolean,
) => void;

interface FakeContextMenuParams {
  editFlags: {
    canCopy: boolean;
    canCut: boolean;
    canPaste: boolean;
    canRedo: boolean;
    canSelectAll: boolean;
    canUndo: boolean;
  };
}

type FakeContextMenuListener = (
  event: FakeWebContentsEvent,
  params: FakeContextMenuParams,
) => void;

interface FakeInput {
  alt: boolean;
  control: boolean;
  isAutoRepeat: boolean;
  isComposing: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
  type: string;
}

type FakeBeforeInputListener = (
  event: FakePreventableEvent,
  input: FakeInput,
) => void;

interface FakeFoundInPageResult {
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

type FakeFoundInPageListener = (
  event: FakeWebContentsEvent,
  result: FakeFoundInPageResult,
) => void;

interface FakeFindInPageOptions {
  findNext?: boolean;
  forward?: boolean;
}

interface FakeAuthInfo {
  isProxy: boolean;
  scheme: string;
  host: string;
  port: number;
  realm: string;
}

type FakeAuthCallback = (username?: string, password?: string) => void;

type FakeLoginListener = (
  event: FakePreventableEvent,
  details: { url: string; isRequestForNavigation?: boolean },
  authInfo: FakeAuthInfo,
  callback: FakeAuthCallback,
) => void;

interface FakeCertificate {
  fingerprint: string;
  issuerName: string;
  subjectName: string;
  validExpiry: number;
  validStart: number;
}

type FakeCertificateErrorListener = (
  event: FakePreventableEvent,
  url: string,
  error: string,
  certificate: FakeCertificate,
  callback: (isTrusted: boolean) => void,
  isMainFrame: boolean,
) => void;

type FakeSelectClientCertificateListener = (
  event: FakePreventableEvent,
  url: string,
  certificateList: FakeCertificate[],
  callback: (certificate?: FakeCertificate) => void,
) => void;

type FakeRenderProcessGoneListener = (
  event: FakeWebContentsEvent,
  details: { reason: string },
) => void;

interface FakeWebContentsEventMap {
  "before-input-event": FakeBeforeInputListener;
  "found-in-page": FakeFoundInPageListener;
  login: FakeLoginListener;
  "certificate-error": FakeCertificateErrorListener;
  "select-client-certificate": FakeSelectClientCertificateListener;
  "enter-html-full-screen": FakeVoidWebContentsListener;
  "leave-html-full-screen": FakeVoidWebContentsListener;
  "render-process-gone": FakeRenderProcessGoneListener;
  unresponsive: FakeVoidWebContentsListener;
  responsive: FakeVoidWebContentsListener;
  destroyed: FakeVoidWebContentsListener;
  "devtools-opened": FakeVoidWebContentsListener;
  "devtools-closed": FakeVoidWebContentsListener;
  "will-frame-navigate": FakeWillFrameNavigateListener;
  "will-navigate": FakeWillNavigateListener;
  "will-redirect": FakeWillRedirectListener;
  "did-start-loading": FakeVoidWebContentsListener;
  "did-stop-loading": FakeVoidWebContentsListener;
  "did-navigate": FakeDidNavigateListener;
  "did-navigate-in-page": FakeDidNavigateInPageListener;
  "did-start-navigation": FakeVoidWebContentsListener;
  "page-title-updated": FakeVoidWebContentsListener;
  "page-favicon-updated": FakePageFaviconUpdatedListener;
  "did-fail-load": FakeDidFailLoadListener;
  "context-menu": FakeContextMenuListener;
  "console-message": FakeConsoleMessageListener;
}

interface FakeConsoleMessageDetails {
  level: "debug" | "info" | "warning" | "error";
  message: string;
  lineNumber: number;
  sourceId: string;
}

type FakeConsoleMessageListener = (details: FakeConsoleMessageDetails) => void;

type FakeResourceType =
  | "mainFrame"
  | "subFrame"
  | "stylesheet"
  | "script"
  | "image"
  | "font"
  | "object"
  | "xhr"
  | "ping"
  | "cspReport"
  | "media"
  | "webSocket"
  | "other";

interface FakeWebFrameMain {
  origin: string;
}

interface FakeOnBeforeRequestDetails {
  url: string;
  method?: string;
  resourceType: FakeResourceType;
  webContentsId?: number;
  frame?: FakeWebFrameMain | null;
}

interface FakeWebRequestCallbackResponse {
  cancel: boolean;
}

type FakeOnBeforeRequestCallback = (
  response: FakeWebRequestCallbackResponse,
) => void;

type FakeOnBeforeRequestListener = (
  details: FakeOnBeforeRequestDetails,
  callback: FakeOnBeforeRequestCallback,
) => void;

interface FakeNetworkRequestDetails {
  url: string;
  method?: string;
  resourceType?: FakeResourceType;
  webContentsId?: number;
  statusCode?: number;
  fromCache?: boolean;
  error?: string;
  timestamp?: number;
}

type FakeNetworkRequestListener = (details: FakeNetworkRequestDetails) => void;

interface FakeCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: string;
}

interface FakeSessionEvent {
  preventDefault(): void;
}

type FakeDownloadDoneState = "completed" | "cancelled" | "interrupted";

type FakeDownloadDoneListener = (
  event: FakeSessionEvent,
  state: FakeDownloadDoneState,
) => void;

/**
 * Electron's `DownloadItem`, as far as the manager touches it: the name the
 * page asked for, the path we choose, and the one terminal event.
 */
class FakeDownloadItem {
  public savePath: string | null = null;
  private doneListener: FakeDownloadDoneListener | null = null;

  constructor(
    private readonly filename: string,
    private readonly url = "https://example.com/file",
    private readonly mimeType = "application/octet-stream",
  ) {}

  getFilename(): string {
    return this.filename;
  }

  getURL(): string {
    return this.url;
  }

  getMimeType(): string {
    return this.mimeType;
  }

  setSavePath(path: string): void {
    this.savePath = path;
  }

  once(_eventName: "done", listener: FakeDownloadDoneListener): void {
    this.doneListener = listener;
  }

  finish(state: FakeDownloadDoneState): void {
    this.doneListener?.({ preventDefault: () => undefined }, state);
  }
}

type FakeSessionListener = (
  event: FakeSessionEvent,
  item: FakeDownloadItem,
  webContents: { id: number },
) => void;

type FakePermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
) => void;

type FakePermissionCheckHandler = (
  webContents: unknown,
  permission: string,
) => boolean;

interface FakeWindowOpenDetails {
  url: string;
}

interface FakeWindowOpenDecision {
  action: "deny" | "allow";
  outlivesOpener?: boolean;
  /** Present on "allow": the shell builds the popup's view here. */
  createWindow?: (options: FakeWindowOpenOptions) => unknown;
}

interface FakeWindowOpenOptions {
  webPreferences?: Record<string, unknown>;
  /**
   * The `webContents` Chromium already made for the popup, carrying the opener
   * link. Electron passes it through so the constructed view adopts it.
   */
  webContents?: unknown;
}

type FakeWindowOpenHandler = (
  details: FakeWindowOpenDetails,
) => FakeWindowOpenDecision;

const electronMock = vi.hoisted(() => {
  interface FakeNativeImage {
    isEmpty(): boolean;
    toJPEG(quality: number): Buffer;
    toPNG(): Buffer;
    getSize(): { width: number; height: number };
  }

  interface FakeDidFailLoadArgs {
    errorCode: number;
    errorDescription: string;
    isMainFrame: boolean;
    validatedURL: string;
  }

  type FakeWebContentsListeners = {
    [TEventName in keyof FakeWebContentsEventMap]: Array<
      FakeWebContentsEventMap[TEventName]
    >;
  };

  class FakePreventableEventImpl implements FakePreventableEvent {
    public defaultPrevented = false;

    preventDefault(): void {
      this.defaultPrevented = true;
    }
  }

  class FakeNavigationEventImpl
    extends FakePreventableEventImpl
    implements FakeNavigationEvent
  {
    public readonly initiator?: FakeWebFrameMain | null;
    public readonly isMainFrame: boolean;
    public readonly url: string;

    constructor(args: {
      initiatorOrigin?: string | null;
      isMainFrame: boolean;
      url: string;
    }) {
      super();
      this.initiator =
        args.initiatorOrigin === undefined
          ? undefined
          : args.initiatorOrigin === null
            ? null
            : { origin: args.initiatorOrigin };
      this.isMainFrame = args.isMainFrame;
      this.url = args.url;
    }
  }

  const fakeWebContentsEvent: FakeWebContentsEvent = {};

  const fakeCapturedImage: FakeNativeImage = {
    isEmpty: () => false,
    toJPEG: () => Buffer.from("jpeg-bytes"),
    toPNG: () => Buffer.from("png-bytes"),
    getSize: () => ({ width: 800, height: 600 }),
  };

  class FakeWebContents {
    public activeHistoryIndex = 0;
    public canGoBackResult = false;
    public canGoForwardResult = false;
    public destroyed = false;
    public focusCalls = 0;
    public readonly goBackCalls: string[] = [];
    public readonly goForwardCalls: string[] = [];
    public historyEntries: Array<{ title: string; url: string }> = [];
    public readonly id: number;
    public readonly loadURLCalls: string[] = [];
    public readonly pendingCaptureResolvers: Array<
      (image: FakeNativeImage) => void
    > = [];
    public readonly pendingCaptureRejecters: Array<(reason: Error) => void> =
      [];
    public readonly isolatedWorldCalls: Array<{
      worldId: number;
      scripts: Array<{ code: string }>;
    }> = [];
    public mainWorldCalls = 0;
    /** `"pending"` never settles, `"reject"` throws, anything else resolves. */
    public isolatedWorldResult: unknown = "pending";
    /** Stylesheets inserted into the document this view is showing. */
    public readonly insertedCss: string[] = [];
    public readonly removedCssKeys: string[] = [];
    /** Set to make the next insertion reject, as a page being torn down does. */
    public insertCssFailure: Error | null = null;
    /** Hold insertions open, so a commit can land in the middle of one. */
    public deferInsertCss = false;
    /** Answer a held insertion: `fail: true` rejects it, as a torn-down page does. */
    public readonly deferredInsertions: ((fail?: boolean) => void)[] = [];
    private nextCssKey = 1;
    private readonly listeners: FakeWebContentsListeners = {
      "before-input-event": [],
      "found-in-page": [],
      login: [],
      "certificate-error": [],
      "select-client-certificate": [],
      "enter-html-full-screen": [],
      "leave-html-full-screen": [],
      "render-process-gone": [],
      unresponsive: [],
      responsive: [],
      destroyed: [],
      "devtools-opened": [],
      "devtools-closed": [],
      "will-frame-navigate": [],
      "will-navigate": [],
      "will-redirect": [],
      "did-start-loading": [],
      "did-stop-loading": [],
      "did-navigate": [],
      "did-navigate-in-page": [],
      "did-start-navigation": [],
      "page-title-updated": [],
      "page-favicon-updated": [],
      "did-fail-load": [],
      "context-menu": [],
      "console-message": [],
    };
    private title = "";
    private url = "";
    private windowOpenHandler: FakeWindowOpenHandler | null = null;

    constructor(id: number) {
      this.id = id;
    }

    public readonly navigationHistory = {
      canGoBack: (): boolean => this.canGoBackResult,
      canGoForward: (): boolean => this.canGoForwardResult,
      getActiveIndex: (): number => this.activeHistoryIndex,
      getEntryAtIndex: (index: number): { title: string; url: string } | null =>
        this.historyEntries[index] ?? null,
      goBack: (): void => {
        this.goBackCalls.push("goBack");
      },
      goForward: (): void => {
        this.goForwardCalls.push("goForward");
      },
      getAllEntries: (): Array<{
        title: string;
        url: string;
        pageState?: string;
      }> => this.historyEntries,
      restore: (options: {
        entries: Array<{ title: string; url: string; pageState?: string }>;
        index?: number;
      }): Promise<void> => {
        this.restoreCalls.push(options);
        return this.restoreFailure === null
          ? Promise.resolve()
          : Promise.reject(this.restoreFailure);
      },
    };

    public readonly restoreCalls: Array<{
      entries: Array<{ title: string; url: string; pageState?: string }>;
      index?: number;
    }> = [];
    public restoreFailure: Error | null = null;

    public pdfResult: Buffer | Error = Buffer.from("%PDF-1.4\n");

    /** Chromium hands back a new id per request; the manager keys results on it. */
    public nextFindRequestId = 1;
    public readonly findInPageCalls: Array<{
      text: string;
      options: FakeFindInPageOptions | undefined;
    }> = [];
    public readonly stopFindInPageCalls: string[] = [];

    findInPage(text: string, options?: FakeFindInPageOptions): number {
      this.findInPageCalls.push({ text, options });
      const requestId = this.nextFindRequestId;
      this.nextFindRequestId += 1;
      return requestId;
    }

    stopFindInPage(action: string): void {
      this.stopFindInPageCalls.push(action);
    }

    emitFoundInPage(result: FakeFoundInPageResult): void {
      for (const listener of this.listeners["found-in-page"]) {
        listener(fakeWebContentsEvent, result);
      }
    }

    /**
     * The live record of what the manager passed the auth callback. Live rather
     * than a snapshot: the answer arrives long after the event, when a human
     * has answered the prompt this raised.
     */
    emitLogin(args: {
      authInfo?: Partial<FakeAuthInfo>;
      isRequestForNavigation?: boolean;
      url?: string;
    }): { called: boolean; credentials: [string?, string?] | null } {
      const state: { credentials: [string?, string?] | null; called: boolean } =
        { credentials: null, called: false };
      const details = {
        url: args.url ?? "https://example.com/private",
        ...(args.isRequestForNavigation === undefined
          ? {}
          : { isRequestForNavigation: args.isRequestForNavigation }),
      };
      const authInfo: FakeAuthInfo = {
        isProxy: false,
        scheme: "basic",
        host: "example.com",
        port: 443,
        realm: "restricted",
        ...args.authInfo,
      };
      for (const listener of this.listeners.login) {
        listener(
          new FakePreventableEventImpl(),
          details,
          authInfo,
          (username?: string, password?: string) => {
            state.called = true;
            state.credentials =
              username === undefined ? null : [username, password];
          },
        );
      }
      return state;
    }

    /** Answers with what the manager passed `callback(isTrusted)`, or null. */
    emitCertificateError(args: {
      certificate?: Partial<FakeCertificate>;
      error?: string;
      isMainFrame?: boolean;
      url?: string;
    }): { trusted: boolean | null } {
      const state: { trusted: boolean | null } = { trusted: null };
      const certificate: FakeCertificate = {
        fingerprint: "sha256/AAAA",
        issuerName: "Test CA",
        subjectName: "example.com",
        validExpiry: 1_800_000_000,
        validStart: 1_700_000_000,
        ...args.certificate,
      };
      for (const listener of this.listeners["certificate-error"]) {
        listener(
          new FakePreventableEventImpl(),
          args.url ?? "https://example.com/",
          args.error ?? "net::ERR_CERT_AUTHORITY_INVALID",
          certificate,
          (isTrusted: boolean) => {
            state.trusted = isTrusted;
          },
          args.isMainFrame ?? true,
        );
      }
      return state;
    }

    /** Answers with the certificate the manager chose, or undefined. */
    emitSelectClientCertificate(certificateList: FakeCertificate[]): {
      chosen: FakeCertificate | undefined;
      called: boolean;
    } {
      const state: {
        chosen: FakeCertificate | undefined;
        called: boolean;
      } = { chosen: undefined, called: false };
      for (const listener of this.listeners["select-client-certificate"]) {
        listener(
          new FakePreventableEventImpl(),
          "https://example.com/",
          certificateList,
          (certificate?: FakeCertificate) => {
            state.called = true;
            state.chosen = certificate;
          },
        );
      }
      return state;
    }

    emitHtmlFullScreen(entered: boolean): void {
      const eventName = entered
        ? "enter-html-full-screen"
        : "leave-html-full-screen";
      for (const listener of this.listeners[eventName]) {
        listener();
      }
    }

    emitRenderProcessGone(reason: string): void {
      for (const listener of this.listeners["render-process-gone"]) {
        listener(fakeWebContentsEvent, { reason });
      }
    }

    emitResponsiveness(responsive: boolean): void {
      for (const listener of this.listeners[
        responsive ? "responsive" : "unresponsive"
      ]) {
        listener();
      }
    }

    capturePage(): Promise<FakeNativeImage> {
      return new Promise((resolve, reject) => {
        this.pendingCaptureResolvers.push(resolve);
        this.pendingCaptureRejecters.push(reject);
      });
    }

    /** Every OS print dialog this view was asked to open. */
    printCalls = 0;

    print(): void {
      this.printCalls += 1;
    }

    printToPDF(): Promise<Buffer> {
      return this.pdfResult instanceof Error
        ? Promise.reject(this.pdfResult)
        : Promise.resolve(this.pdfResult);
    }

    executeJavaScriptInIsolatedWorld(
      worldId: number,
      scripts: Array<{ code: string }>,
    ): Promise<unknown> {
      this.isolatedWorldCalls.push({ worldId, scripts });
      if (this.isolatedWorldResult === "pending") {
        return new Promise(() => {
          // Never settles: the read-timeout path.
        });
      }
      if (this.isolatedWorldResult === "reject") {
        return Promise.reject(new Error("script failed"));
      }
      return Promise.resolve(this.isolatedWorldResult);
    }

    executeJavaScript(): Promise<unknown> {
      this.mainWorldCalls += 1;
      return Promise.resolve(null);
    }

    public readonly debugger = {
      attached: false,
      attachCalls: [] as string[],
      detachCalls: 0,
      commands: [] as Array<{
        method: string;
        params?: Record<string, unknown>;
      }>,
      results: new Map<string, unknown>(),
      failures: new Map<string, Error>(),
      detachListeners: [] as Array<(event: unknown, reason: string) => void>,
      attachFailure: null as Error | null,
      isAttached(): boolean {
        return this.attached;
      },
      attach(protocolVersion?: string): void {
        if (this.attachFailure !== null) {
          throw this.attachFailure;
        }
        this.attachCalls.push(protocolVersion ?? "");
        this.attached = true;
      },
      detach(): void {
        this.detachCalls += 1;
        this.attached = false;
      },
      sendCommand(
        method: string,
        params?: Record<string, unknown>,
      ): Promise<unknown> {
        this.commands.push({ method, params });
        const failure = this.failures.get(method);
        if (failure) {
          return Promise.reject(failure);
        }
        const result = this.results.get(method);
        // A function stands in for a command whose answer depends on its
        // params — `Runtime.callFunctionOn` carries a different script each
        // time, and a single canned reply could not tell them apart.
        return Promise.resolve(
          typeof result === "function"
            ? (result as (params?: Record<string, unknown>) => unknown)(params)
            : (result ?? {}),
        );
      },
      on(event: string, listener: never): unknown {
        if (event === "detach") {
          this.detachListeners.push(listener);
        } else {
          this.messageListeners.push(listener);
        }
        return this;
      },
      emitMessage(method: string, params: unknown): void {
        for (const listener of this.messageListeners) {
          listener({}, method, params, "session-1");
        }
      },
      messageListeners: [] as Array<
        (
          event: unknown,
          method: string,
          params: unknown,
          sessionId: string,
        ) => void
      >,
      emitDetach(reason: string): void {
        for (const listener of this.detachListeners) {
          listener({}, reason);
        }
      },
    };

    setTitle(title: string): void {
      this.title = title;
    }

    setUrl(url: string): void {
      this.url = url;
    }

    /**
     * Chromium keeps zoom per origin inside the session, so a real one answers
     * with whatever the site was last left at rather than with 1. Held here so
     * the manager's echo — it reads the factor back rather than trusting the
     * request — is exercised instead of stubbed.
     */
    zoomFactor = 1;

    getZoomFactor(): number {
      return this.zoomFactor;
    }

    setZoomFactor(factor: number): void {
      this.zoomFactor = factor;
    }

    audioMuted = false;

    setAudioMuted(muted: boolean): void {
      this.audioMuted = muted;
    }

    /**
     * Fires `destroyed` like Electron's does. Setting the flag alone left the
     * whole teardown path — the handler the manager installs for a popup
     * closing itself — unexercised by every test that closes a view.
     */
    close(): void {
      this.emitDestroyed();
    }

    focus(): void {
      this.focusCalls += 1;
    }

    getTitle(): string {
      return this.title;
    }

    getURL(): string {
      return this.url;
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    isLoadingMainFrame(): boolean {
      return false;
    }

    loadURL(url: string): Promise<void> {
      this.url = url;
      this.loadURLCalls.push(url);
      return Promise.resolve();
    }

    on<TEventName extends keyof FakeWebContentsEventMap>(
      eventName: TEventName,
      listener: FakeWebContentsEventMap[TEventName],
    ): void {
      this.listeners[eventName].push(listener);
    }

    reload(): void {}

    setWindowOpenHandler(handler: FakeWindowOpenHandler): void {
      this.windowOpenHandler = handler;
    }

    stop(): void {}

    emitDidFailLoad(args: FakeDidFailLoadArgs): void {
      for (const listener of this.listeners["did-fail-load"]) {
        listener(
          fakeWebContentsEvent,
          args.errorCode,
          args.errorDescription,
          args.validatedURL,
          args.isMainFrame,
        );
      }
    }

    emitBeforeInput(
      input: Partial<FakeInput> & Pick<FakeInput, "key">,
    ): boolean {
      const event = new FakePreventableEventImpl();
      const resolvedInput: FakeInput = {
        alt: false,
        control: false,
        isAutoRepeat: false,
        isComposing: false,
        meta: false,
        shift: false,
        type: "keyDown",
        ...input,
      };
      for (const listener of this.listeners["before-input-event"]) {
        listener(event, resolvedInput);
      }
      return event.defaultPrevented;
    }

    emitConsoleMessage(details: Partial<FakeConsoleMessageDetails>): void {
      for (const listener of this.listeners["console-message"]) {
        listener({
          level: "info",
          message: "",
          lineNumber: 0,
          sourceId: "",
          ...details,
        });
      }
    }

    emitDidStopLoading(): void {
      for (const listener of this.listeners["did-stop-loading"]) {
        listener();
      }
    }

    emitPageFaviconUpdated(urls: string[]): void {
      for (const listener of this.listeners["page-favicon-updated"]) {
        listener(fakeWebContentsEvent, urls);
      }
    }

    async insertCSS(css: string): Promise<string> {
      this.insertedCss.push(css);
      if (this.insertCssFailure !== null) {
        throw this.insertCssFailure;
      }
      const key = `css-${this.nextCssKey}`;
      this.nextCssKey += 1;
      if (this.deferInsertCss) {
        // Held open so a test can let the page commit while an insertion is
        // still in flight, and answer the two out of order.
        return await new Promise<string>((resolve, reject) => {
          this.deferredInsertions.push((fail) => {
            if (fail === true) {
              reject(new Error("view is being destroyed"));
              return;
            }
            resolve(key);
          });
        });
      }
      return key;
    }

    async removeInsertedCSS(key: string): Promise<void> {
      this.removedCssKeys.push(key);
    }

    emitDidNavigate(url: string): void {
      this.url = url;
      // A new document takes the previous document's stylesheets with it, which
      // is what the shell's re-application is for.
      this.insertedCss.length = 0;
      for (const listener of this.listeners["did-navigate"]) {
        listener(fakeWebContentsEvent, url);
      }
    }

    emitDidNavigateInPage(url: string, isMainFrame = true): void {
      if (isMainFrame) {
        this.url = url;
      }
      for (const listener of this.listeners["did-navigate-in-page"]) {
        listener(fakeWebContentsEvent, url, isMainFrame);
      }
    }

    emitWillFrameNavigate(
      url: string,
      isMainFrame: boolean,
      initiatorOrigin?: string | null,
    ): boolean {
      const event = new FakeNavigationEventImpl({
        initiatorOrigin,
        isMainFrame,
        url,
      });
      for (const listener of this.listeners["will-frame-navigate"]) {
        listener(event);
      }
      return event.defaultPrevented;
    }

    emitWillNavigate(url: string, initiatorOrigin?: string | null): boolean {
      const event = new FakeNavigationEventImpl({
        initiatorOrigin,
        isMainFrame: true,
        url,
      });
      for (const listener of this.listeners["will-navigate"]) {
        listener(event, url);
      }
      return event.defaultPrevented;
    }

    emitWillRedirect(
      url: string,
      isMainFrame: boolean,
      initiatorOrigin?: string | null,
    ): boolean {
      const event = new FakeNavigationEventImpl({
        initiatorOrigin,
        isMainFrame,
        url,
      });
      for (const listener of this.listeners["will-redirect"]) {
        listener(event, url, false, isMainFrame);
      }
      return event.defaultPrevented;
    }

    emitWindowOpen(url: string): FakeWindowOpenDecision {
      if (this.windowOpenHandler === null) {
        throw new Error("Expected a window open handler to be registered.");
      }
      return this.windowOpenHandler({ url });
    }

    /** What Chromium's DevTools were pointed at, and how they were opened. */
    public devToolsHost: FakeWebContents | null = null;
    public readonly openDevToolsCalls: Array<{ mode?: string }> = [];
    public closeDevToolsCalls = 0;
    public readonly inspectElementCalls: Array<{ x: number; y: number }> = [];

    setDevToolsWebContents(host: FakeWebContents): void {
      this.devToolsHost = host;
    }

    openDevTools(options?: { mode?: string }): void {
      this.openDevToolsCalls.push(options ?? {});
      for (const listener of this.listeners["devtools-opened"]) {
        listener();
      }
    }

    closeDevTools(): void {
      this.closeDevToolsCalls += 1;
      for (const listener of this.listeners["devtools-closed"]) {
        listener();
      }
    }

    inspectElement(x: number, y: number): void {
      this.inspectElementCalls.push({ x, y });
    }

    /** The user closing the tools from their own toolbar. */
    emitDevToolsClosed(): void {
      for (const listener of this.listeners["devtools-closed"]) {
        listener();
      }
    }

    /** The page closing itself, as `window.close()` does. */
    emitDestroyed(): void {
      this.destroyed = true;
      for (const listener of this.listeners.destroyed) {
        listener();
      }
    }
  }

  let nextWebContentsId = 1;

  class FakeWebContentsView {
    public readonly boundsCalls: PatcherDesktopBrowserViewBounds[] = [];
    public readonly webContents: FakeWebContents;
    /** What the manager asked for when it created this view. */
    public readonly options: {
      webPreferences?: Record<string, unknown>;
      webContents?: FakeWebContents;
    };
    public visible = false;

    constructor(options?: {
      webPreferences?: Record<string, unknown>;
      webContents?: FakeWebContents;
    }) {
      this.options = options ?? {};
      // Electron adopts a passed `webContents` instead of making one; the popup
      // path depends on that, so the fake honours it.
      this.webContents =
        options?.webContents ?? new FakeWebContents(nextWebContentsId);
      if (options?.webContents === undefined) {
        nextWebContentsId += 1;
      }
    }

    setBounds(bounds: PatcherDesktopBrowserViewBounds): void {
      this.boundsCalls.push(bounds);
    }

    setVisible(visible: boolean): void {
      this.visible = visible;
    }
  }

  interface FakeFaviconFetchResponse {
    ok: boolean;
    headers: { get(name: string): string | null };
    arrayBuffer(): Promise<Buffer>;
  }

  class FakeSession {
    /** The partition's cookie jar, as much of it as the manager touches. */
    public storedCookies: FakeCookie[] = [];
    public readonly cookieSetCalls: unknown[] = [];
    public readonly cookieRemoveCalls: Array<{ url: string; name: string }> =
      [];
    public cookieSetFailure: Error | null = null;
    public readonly cookies = {
      get: (filter: { url?: string; name?: string }): Promise<FakeCookie[]> =>
        Promise.resolve(
          this.storedCookies.filter(
            (cookie) =>
              filter.name === undefined || cookie.name === filter.name,
          ),
        ),
      set: (details: unknown): Promise<void> => {
        this.cookieSetCalls.push(details);
        return this.cookieSetFailure === null
          ? Promise.resolve()
          : Promise.reject(this.cookieSetFailure);
      },
      remove: (url: string, name: string): Promise<void> => {
        this.cookieRemoveCalls.push({ url, name });
        return Promise.resolve();
      },
    };
    public readonly willDownloadListeners: FakeSessionListener[] = [];
    public beforeRequestListener: FakeOnBeforeRequestListener | null = null;
    public permissionCheckHandler: FakePermissionCheckHandler | null = null;
    public permissionRequestHandler: FakePermissionRequestHandler | null = null;
    public completedListener: FakeNetworkRequestListener | null = null;
    public errorListener: FakeNetworkRequestListener | null = null;
    public readonly webRequest = {
      onBeforeRequest: (listener: FakeOnBeforeRequestListener | null): void => {
        this.beforeRequestListener = listener;
      },
      onCompleted: (listener: FakeNetworkRequestListener | null): void => {
        this.completedListener = listener;
      },
      onErrorOccurred: (listener: FakeNetworkRequestListener | null): void => {
        this.errorListener = listener;
      },
    };

    public readonly fetchedUrls: string[] = [];
    /** Recorded so a PDF read can be shown to carry the session's cookies. */
    public readonly fetchInits: Array<Record<string, unknown> | undefined> = [];
    public fetchRejection: Error | null = null;
    public fetchResponse: FakeFaviconFetchResponse = {
      ok: true,
      headers: { get: () => "image/png" },
      arrayBuffer: async () => Buffer.from("icon-bytes"),
    };

    fetch(
      url: string,
      init?: Record<string, unknown>,
    ): Promise<FakeFaviconFetchResponse> {
      this.fetchedUrls.push(url);
      this.fetchInits.push(init);
      return this.fetchRejection === null
        ? Promise.resolve(this.fetchResponse)
        : Promise.reject(this.fetchRejection);
    }

    on(eventName: "will-download", listener: FakeSessionListener): void {
      this.willDownloadListeners.push(listener);
    }

    setPermissionCheckHandler(handler: FakePermissionCheckHandler): void {
      this.permissionCheckHandler = handler;
    }

    setPermissionRequestHandler(handler: FakePermissionRequestHandler): void {
      this.permissionRequestHandler = handler;
    }

    /** Preload scripts registered in the browsing session, by id. */
    public readonly preloadScripts = new Map<string, string>();
    public registerPreloadFailure: Error | null = null;

    registerPreloadScript(script: {
      id: string;
      type: string;
      filePath: string;
    }): string {
      if (this.registerPreloadFailure !== null) {
        throw this.registerPreloadFailure;
      }
      this.preloadScripts.set(script.id, script.filePath);
      return script.id;
    }

    unregisterPreloadScript(id: string): void {
      this.preloadScripts.delete(id);
    }
  }

  const fakeSessions: FakeSession[] = [];
  const fakeViews: FakeWebContentsView[] = [];
  // Configure a view the manager is about to create, for the cases where the
  // failure has to be armed before `attach` returns.
  const setup: { next: ((view: FakeWebContentsView) => void) | null } = {
    next: null,
  };

  return {
    fakeCapturedImage,
    fakeSessions,
    fakeViews,
    /** A stand-in for the popup `webContents` Electron hands to `createWindow`. */
    createFakeWebContents(): FakeWebContents {
      const contents = new FakeWebContents(nextWebContentsId);
      nextWebContentsId += 1;
      return contents;
    },
    get nextViewSetup() {
      return setup.next;
    },
    set nextViewSetup(value: ((view: FakeWebContentsView) => void) | null) {
      setup.next = value;
    },
    FakeWebContentsView: class extends FakeWebContentsView {
      constructor(options?: {
        webPreferences?: Record<string, unknown>;
        webContents?: FakeWebContents;
      }) {
        super(options);
        fakeViews.push(this);
        setup.next?.(this);
      }
    },
    session: {
      fromPartition() {
        const fakeSession = new FakeSession();
        fakeSessions.push(fakeSession);
        return fakeSession;
      },
    },
  };
});

vi.mock("electron", () => ({
  WebContentsView: electronMock.FakeWebContentsView,
  session: electronMock.session,
}));

interface FakeHostWindowArgs {
  contentBounds: DesktopBrowserHostContentBounds;
  webContentsId: number;
}

class FakeHostWebContents implements DesktopBrowserHostWebContents {
  public destroyed = false;
  public readonly sentPayloads: DesktopBrowserHostWebContentsPayload[] = [];
  public readonly sentMessages: Array<{
    channel: string;
    payload: DesktopBrowserHostWebContentsPayload;
  }> = [];
  readonly #id: number;

  constructor(id: number) {
    this.#id = id;
  }

  /**
   * Throws once destroyed, the way Electron's does — a plain field here is a
   * lie, and it is the lie that let a crash on window close reach a user: the
   * host's `webContents` is already gone when its child views finish closing.
   */
  get id(): number {
    if (this.destroyed) {
      throw new TypeError("Object has been destroyed");
    }
    return this.#id;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, payload: DesktopBrowserHostWebContentsPayload): void {
    this.sentPayloads.push(payload);
    this.sentMessages.push({ channel, payload });
  }
}

class FakeContentView implements DesktopBrowserHostContentView {
  public readonly addedViews: WebContentsView[] = [];
  public readonly removedViews: WebContentsView[] = [];

  addChildView(view: WebContentsView): void {
    this.addedViews.push(view);
  }

  removeChildView(view: WebContentsView): void {
    this.removedViews.push(view);
  }
}

class FakeHostWindow implements DesktopBrowserHostWindow {
  public contentBounds: DesktopBrowserHostContentBounds;
  public destroyed = false;
  public fullScreen = false;
  /** Every `setFullScreen` the manager asked for, in order. */
  public readonly fullScreenCalls: boolean[] = [];
  public readonly contentView = new FakeContentView();
  public readonly webContents: FakeHostWebContents;

  constructor({ contentBounds, webContentsId }: FakeHostWindowArgs) {
    this.contentBounds = contentBounds;
    this.webContents = new FakeHostWebContents(webContentsId);
  }

  getContentBounds(): DesktopBrowserHostContentBounds {
    return this.contentBounds;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isFullScreen(): boolean {
    return this.fullScreen;
  }

  setFullScreen(fullScreen: boolean): void {
    this.fullScreenCalls.push(fullScreen);
    this.fullScreen = fullScreen;
  }
}

beforeEach(() => {
  electronMock.fakeSessions.length = 0;
  electronMock.fakeViews.length = 0;
});

/**
 * Resolve every pending capturePage() on the view and let the snapshot
 * pipeline (push the bitmap, then hide the view) drain.
 */
async function settlePendingCaptures(
  view: (typeof electronMock.fakeViews)[number],
): Promise<void> {
  for (const resolve of view.webContents.pendingCaptureResolvers.splice(0)) {
    resolve(electronMock.fakeCapturedImage);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function snapshotPushesOf(
  hostWindow: FakeHostWindow,
): Array<{ tabId: string; dataUrl: string | null }> {
  const pushes: Array<{ tabId: string; dataUrl: string | null }> = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("dataUrl" in payload) {
      pushes.push(payload);
    }
  }
  return pushes;
}

interface AttachBrowserTabArgs {
  hostWindow: FakeHostWindow;
  manager: DesktopBrowserViewManager;
  tabId: string;
  url: string;
}

interface BrowserRequestBlockedArgs {
  url: string;
  method?: string;
  resourceType: FakeResourceType;
  frameOrigin?: string | null;
  webContentsId?: number;
}

function attachBrowserTab(args: AttachBrowserTabArgs): void {
  args.manager.attach({
    hostWindow: args.hostWindow,
    request: {
      tabId: args.tabId,
      url: args.url,
      bounds: { x: 100, y: 50, width: 500, height: 350 },
      visible: true,
    },
  });
}

function requireFakeView(
  index: number,
): (typeof electronMock.fakeViews)[number] {
  const view = electronMock.fakeViews[index];
  expect(view).toBeDefined();
  if (view === undefined) {
    throw new Error("Expected the browser view to be created.");
  }
  return view;
}

function requireWillDownloadListener(): FakeSessionListener {
  const fakeSession = electronMock.fakeSessions.at(-1);
  expect(fakeSession).toBeDefined();
  if (fakeSession === undefined) {
    throw new Error("Expected a browser session to be created.");
  }
  const listener = fakeSession.willDownloadListeners.at(-1);
  expect(listener).toBeDefined();
  if (listener === undefined) {
    throw new Error("Expected a will-download listener to be registered.");
  }
  return listener;
}

interface StartFakeDownloadArgs {
  filename: string;
  webContentsId: number;
}

/** Drive one `will-download`, returning what the shell did with it. */
function startFakeDownload(args: StartFakeDownloadArgs): {
  event: { defaultPrevented: boolean };
  item: FakeDownloadItem;
} {
  const event = {
    defaultPrevented: false,
    preventDefault(): void {
      event.defaultPrevented = true;
    },
  };
  const item = new FakeDownloadItem(args.filename);
  requireWillDownloadListener()(event, item, { id: args.webContentsId });
  return { event, item };
}

function downloadPayloads(
  hostWindow: FakeHostWindow,
): PatcherDesktopBrowserDownload[] {
  return hostWindow.webContents.sentMessages
    .filter(
      (message) => message.channel === PATCHER_DESKTOP_BROWSER_DOWNLOAD_CHANNEL,
    )
    .map((message) => message.payload as PatcherDesktopBrowserDownload);
}

function requireOnBeforeRequestListener(): FakeOnBeforeRequestListener {
  const fakeSession = electronMock.fakeSessions.at(-1);
  expect(fakeSession).toBeDefined();
  if (fakeSession === undefined) {
    throw new Error("Expected a browser session to be created.");
  }
  const listener = fakeSession.beforeRequestListener;
  expect(listener).not.toBeNull();
  if (listener === null) {
    throw new Error("Expected an onBeforeRequest listener to be registered.");
  }
  return listener;
}

function browserRequestBlocked(args: BrowserRequestBlockedArgs): boolean {
  const details: FakeOnBeforeRequestDetails = {
    url: args.url,
    method: args.method ?? "GET",
    resourceType: args.resourceType,
  };
  if (args.webContentsId !== undefined) {
    details.webContentsId = args.webContentsId;
  }
  if (args.frameOrigin !== undefined) {
    details.frame =
      args.frameOrigin === null ? null : { origin: args.frameOrigin };
  }

  const responses: FakeWebRequestCallbackResponse[] = [];
  requireOnBeforeRequestListener()(details, (nextResponse) => {
    responses.push(nextResponse);
  });
  const response = responses[0];
  if (response === undefined) {
    throw new Error("Expected onBeforeRequest to invoke its callback.");
  }
  return response.cancel;
}

function openTabPushesOf(hostWindow: FakeHostWindow): string[] {
  const pushes: string[] = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("url" in payload && !("tabId" in payload)) {
      pushes.push(payload.url);
    }
  }
  return pushes;
}

function scopedOpenTabPushesOf(
  hostWindow: FakeHostWindow,
): Array<{ tabId: string; url: string }> {
  const pushes: Array<{ tabId: string; url: string }> = [];
  for (const payload of hostWindow.webContents.sentPayloads) {
    if ("url" in payload && "tabId" in payload && !("title" in payload)) {
      pushes.push(payload);
    }
  }
  return pushes;
}

function faviconPushesOf(
  hostWindow: FakeHostWindow,
): Array<{ tabId: string; dataUrl: string | null }> {
  const pushes: Array<{ tabId: string; dataUrl: string | null }> = [];
  for (const message of hostWindow.webContents.sentMessages) {
    if (
      message.channel === PATCHER_DESKTOP_BROWSER_FAVICON_CHANNEL &&
      "dataUrl" in message.payload
    ) {
      pushes.push(message.payload);
    }
  }
  return pushes;
}

function requireFakeSession(): (typeof electronMock.fakeSessions)[number] {
  const fakeSession = electronMock.fakeSessions.at(-1);
  expect(fakeSession).toBeDefined();
  if (fakeSession === undefined) {
    throw new Error("Expected a browser session to be created.");
  }
  return fakeSession;
}

/** Let a favicon fetch and its push drain. */
async function settleFavicons(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Tab icons are the one page-supplied resource the trusted app renders, so the
// shell fetches them itself, in the browsing session, and hands over a data URI.
describe("DesktopBrowserViewManager favicons", () => {
  function attachTabForFavicons(): {
    hostWindow: FakeHostWindow;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 70,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    return { hostWindow, webContents: requireFakeView(0).webContents };
  }

  it("fetches a declared icon in the browsing session and pushes it as a data URI", async () => {
    const { hostWindow, webContents } = attachTabForFavicons();

    webContents.emitPageFaviconUpdated(["https://example.com/icon.png"]);
    await settleFavicons();

    // Fetched by the shell, through the session that owns the page's cookies and
    // the network firewall — never by the Patcher app origin.
    expect(requireFakeSession().fetchedUrls).toEqual([
      "https://example.com/icon.png",
    ]);
    expect(faviconPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        dataUrl: `data:image/png;base64,${Buffer.from("icon-bytes").toString("base64")}`,
      },
    ]);
  });

  it("never fetches a candidate the page did not declare over http(s)", async () => {
    const { hostWindow, webContents } = attachTabForFavicons();

    webContents.emitPageFaviconUpdated(["data:image/png;base64,AAAA"]);
    await settleFavicons();

    expect(requireFakeSession().fetchedUrls).toEqual([]);
    expect(faviconPushesOf(hostWindow)).toEqual([]);
  });

  it("does not refetch an icon it already pushed", async () => {
    const { webContents } = attachTabForFavicons();

    webContents.emitPageFaviconUpdated(["https://example.com/icon.png"]);
    await settleFavicons();
    webContents.emitPageFaviconUpdated(["https://example.com/icon.png"]);
    await settleFavicons();

    expect(requireFakeSession().fetchedUrls).toHaveLength(1);
  });

  // The bug this replaces: the icon was dropped at commit, so a reload — which
  // does not always re-announce an icon — left the tab bare.
  it("keeps the icon when the same page is reloaded", async () => {
    const { hostWindow, webContents } = attachTabForFavicons();

    webContents.emitPageFaviconUpdated(["https://example.com/icon.png"]);
    await settleFavicons();
    const pushedIcon = faviconPushesOf(hostWindow);

    // A reload commits the same URL and settles without announcing anything.
    webContents.emitDidNavigate("https://example.com/");
    webContents.emitDidStopLoading();

    expect(faviconPushesOf(hostWindow)).toEqual(pushedIcon);
  });

  it("re-keys a re-announced icon to the reloaded page without refetching", async () => {
    const { hostWindow, webContents } = attachTabForFavicons();

    webContents.emitPageFaviconUpdated(["https://example.com/icon.png"]);
    await settleFavicons();
    webContents.emitDidNavigate("https://example.com/");
    webContents.emitPageFaviconUpdated(["https://example.com/icon.png"]);
    await settleFavicons();
    webContents.emitDidStopLoading();

    expect(requireFakeSession().fetchedUrls).toHaveLength(1);
    expect(faviconPushesOf(hostWindow)).toHaveLength(1);
  });

  // The other half of the rule: an icon must not follow the tab to a page that
  // never claimed it.
  it("drops the icon once the tab settles on a different page", async () => {
    const { hostWindow, webContents } = attachTabForFavicons();

    webContents.emitPageFaviconUpdated(["https://example.com/icon.png"]);
    await settleFavicons();
    webContents.emitDidNavigate("https://other.test/");
    webContents.emitDidStopLoading();

    expect(faviconPushesOf(hostWindow).at(-1)).toEqual({
      tabId: "browser:a",
      dataUrl: null,
    });
  });

  // A page can rewrite its icon from script in a loop; the limiter is what stops
  // that from becoming an unbounded fetch loop in the shell.
  it("stops fetching a page that churns its icon", async () => {
    const { webContents } = attachTabForFavicons();

    for (let index = 0; index < 8; index += 1) {
      webContents.emitPageFaviconUpdated([
        `https://example.com/icon-${index}.png`,
      ]);
    }
    await settleFavicons();

    expect(requireFakeSession().fetchedUrls).toHaveLength(5);
  });
});

describe("DesktopBrowserViewManager", () => {
  it("forwards resolved browser shortcuts and suppresses the untrusted page", () => {
    const dispatchAppCommand = vi.fn();
    const focusHostWebContents = vi.fn();
    const resolveAppCommand = vi.fn(
      (input: { key: string; metaKey: boolean }) =>
        input.key === "l" && input.metaKey
          ? ("browser.focusLocation" as const)
          : null,
    );
    const manager = createDesktopBrowserViewManager({
      dispatchAppCommand,
      focusHostWebContents,
      partition: "persist:test",
      resolveAppCommand,
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 50,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com",
    });
    const webContents = requireFakeView(0).webContents;

    expect(webContents.emitBeforeInput({ key: "l", meta: true })).toBe(true);
    expect(focusHostWebContents).toHaveBeenCalledWith(50);
    expect(dispatchAppCommand).toHaveBeenCalledWith({
      command: "browser.focusLocation",
      hostWebContentsId: 50,
    });
    expect(
      webContents.emitBeforeInput({
        isAutoRepeat: true,
        key: "l",
        meta: true,
      }),
    ).toBe(false);
    expect(dispatchAppCommand).toHaveBeenCalledTimes(1);
  });

  it("allows loopback navigation requested from browser chrome", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 51,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "",
    });
    const view = requireFakeView(0);

    manager.navigate({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "http://localhost:5173/",
      },
    });

    expect(view.webContents.loadURLCalls).toEqual(["http://localhost:5173/"]);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("allows an initial loopback tab load when Electron omits webContents attribution", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 53,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);

    expect(view.webContents.loadURLCalls).toEqual(["http://localhost:5173/"]);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: 0,
      }),
    ).toBe(false);
  });

  it("blocks local main-frame form posts while allowing local get navigations", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 53,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);

    expect(
      browserRequestBlocked({
        url: "http://localhost:38986/api/v1/threads/thr_1/archive",
        method: "GET",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:38986/api/v1/threads/thr_1/archive",
        method: "POST",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(true);
    expect(
      browserRequestBlocked({
        url: "http://192.168.1.1/",
        method: "GET",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(true);
    expect(view.webContents.emitWillNavigate("http://192.168.1.1/")).toBe(true);
  });

  it("allows unattributed loopback main-frame requests with matching tabs", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 54,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:b",
      url: "http://localhost:5173/path",
    });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
      }),
    ).toBe(false);
  });

  it("keeps top-level loopback navigation allowed after a failed local load", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 52,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);

    view.webContents.emitDidFailLoad({
      errorCode: -102,
      errorDescription: "Connection refused",
      isMainFrame: true,
      validatedURL: "http://localhost:5173/",
    });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("keeps top-level loopback navigation allowed after an aborted local load", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 62,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("https://example.com/");

    manager.navigate({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "http://localhost:5173/",
      },
    });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);

    view.webContents.emitDidFailLoad({
      errorCode: -3,
      errorDescription: "Aborted",
      isMainFrame: true,
      validatedURL: "http://localhost:5173/",
    });

    expect(view.webContents.emitWillNavigate("http://localhost:5173/")).toBe(
      false,
    );
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("keeps top-level loopback navigation allowed after a local load is stopped", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 63,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("https://example.com/");

    manager.navigate({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "http://localhost:5173/",
      },
    });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);

    manager.stop({ hostWindow, tabId: "browser:a" });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("allows reloads of the current local main frame", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 61,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/");

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);

    manager.reload({ hostWindow, tabId: "browser:a" });

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("clears local subresource access after a local page commits to a public page", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 53,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/");

    expect(
      view.webContents.emitWillFrameNavigate(
        "http://localhost:5173/dashboard",
        true,
        "http://localhost:5173",
      ),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/dashboard",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);

    view.webContents.emitDidNavigate("https://example.com/");

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(true);
  });

  it("allows public-to-local top-level redirects after public commit", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 54,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("https://example.com/");

    expect(
      view.webContents.emitWillRedirect("http://localhost:38986/", true),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:38986/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("allows local back and forward history as top-level navigation", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 55,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/");
    view.webContents.emitDidNavigate("https://example.com/");
    view.webContents.historyEntries = [
      { title: "Local", url: "http://localhost:5173/" },
      { title: "Public", url: "https://example.com/" },
    ];
    view.webContents.activeHistoryIndex = 1;
    view.webContents.canGoBackResult = true;

    manager.goBack({ hostWindow, tabId: "browser:a" });

    expect(view.webContents.goBackCalls).toEqual(["goBack"]);
    expect(view.webContents.emitWillNavigate("http://localhost:5173/")).toBe(
      false,
    );
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);

    view.webContents.historyEntries = [
      { title: "Public", url: "https://example.com/" },
      { title: "Local", url: "http://localhost:5173/" },
    ];
    view.webContents.activeHistoryIndex = 0;
    view.webContents.canGoForwardResult = true;

    manager.goForward({ hostWindow, tabId: "browser:a" });

    expect(view.webContents.goForwardCalls).toEqual(["goForward"]);
    expect(view.webContents.emitWillNavigate("http://localhost:5173/")).toBe(
      false,
    );
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("allows same-origin local back and forward history", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 64,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/route-b",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/route-b");
    view.webContents.historyEntries = [
      { title: "Route A", url: "http://localhost:5173/route-a" },
      { title: "Route B", url: "http://localhost:5173/route-b" },
    ];
    view.webContents.activeHistoryIndex = 1;
    view.webContents.canGoBackResult = true;

    manager.goBack({ hostWindow, tabId: "browser:a" });

    expect(view.webContents.goBackCalls).toEqual(["goBack"]);
    expect(
      view.webContents.emitWillNavigate("http://localhost:5173/route-a"),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/route-a",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);

    view.webContents.emitDidNavigate("http://localhost:5173/route-a");
    view.webContents.activeHistoryIndex = 0;
    view.webContents.canGoForwardResult = true;

    manager.goForward({ hostWindow, tabId: "browser:a" });

    expect(view.webContents.goForwardCalls).toEqual(["goForward"]);
    expect(
      view.webContents.emitWillNavigate("http://localhost:5173/route-b"),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/route-b",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
      }),
    ).toBe(false);
  });

  it("allows same-origin local subresources and cross-port top-level navigation", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 56,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/");

    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "ws://localhost:5173/socket",
        resourceType: "webSocket",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:38986/api",
        resourceType: "xhr",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(true);
    expect(
      view.webContents.emitWillFrameNavigate(
        "http://localhost:38986/",
        true,
        "http://localhost:5173",
      ),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
  });

  it("allows top-level localhost frame navigation but blocks public iframe subresources", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 57,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);
    view.webContents.emitDidNavigate("http://localhost:5173/");

    expect(
      view.webContents.emitWillFrameNavigate(
        "http://localhost:5173/dashboard",
        true,
        "https://example.com",
      ),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/dashboard",
        resourceType: "mainFrame",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: view.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(false);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/api",
        resourceType: "xhr",
        webContentsId: view.webContents.id,
        frameOrigin: "https://example.com",
      }),
    ).toBe(true);
  });

  it("does not surface loopback popups as trusted browser tabs", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 58,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    const view = requireFakeView(0);

    expect(view.webContents.emitWindowOpen("http://localhost:38986/")).toEqual({
      action: "deny",
    });
    expect(openTabPushesOf(hostWindow)).toEqual([]);
    expect(scopedOpenTabPushesOf(hostWindow)).toEqual([]);
  });

  it("surfaces public popups with their source browser tab id", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 61,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);

    expect(view.webContents.emitWindowOpen("https://example.com/docs")).toEqual(
      {
        action: "deny",
      },
    );
    expect(openTabPushesOf(hostWindow)).toEqual(["https://example.com/docs"]);
    expect(scopedOpenTabPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        url: "https://example.com/docs",
      },
    ]);
  });

  // The crash a second window produced: closing a window tore down its
  // `webContents` first, and the views it owned then asked the gone window for
  // its id while computing their own key.
  it("releases the views of a window that is already destroyed", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 77,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    const hostWebContentsId = hostWindow.webContents.id;

    // Electron's order on window close: the window and its webContents are
    // already gone when `closed` fires, which is where releaseWindow is called
    // from — and it is handed the id for exactly that reason.
    hostWindow.destroyed = true;
    hostWindow.webContents.destroyed = true;

    expect(() => manager.releaseWindow(hostWebContentsId)).not.toThrow();
    expect(view.webContents.destroyed).toBe(true);
  });

  it("clears local subresource attribution on release and destroy", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 59,
    });

    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "http://localhost:5173/",
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:b",
      url: "http://localhost:3000/",
    });
    const releasedView = requireFakeView(0);
    const destroyedView = requireFakeView(1);
    releasedView.webContents.emitDidNavigate("http://localhost:5173/");
    destroyedView.webContents.emitDidNavigate("http://localhost:3000/");

    manager.releaseWindow(hostWindow.webContents.id);

    expect(releasedView.webContents.destroyed).toBe(true);
    expect(destroyedView.webContents.destroyed).toBe(true);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: releasedView.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(true);

    const secondHostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 60,
    });
    attachBrowserTab({
      manager,
      hostWindow: secondHostWindow,
      tabId: "browser:c",
      url: "http://localhost:5173/",
    });
    const destroyAllView = requireFakeView(2);
    destroyAllView.webContents.emitDidNavigate("http://localhost:5173/");

    manager.destroyAll();

    expect(destroyAllView.webContents.destroyed).toBe(true);
    expect(
      browserRequestBlocked({
        url: "http://localhost:5173/app.js",
        resourceType: "script",
        webContentsId: destroyAllView.webContents.id,
        frameOrigin: "http://localhost:5173",
      }),
    ).toBe(true);
  });

  it("snapshots then hides visible views on resize, revealing them clamped to the shrunken window", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 41,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }
    expect(view.boundsCalls[0]).toEqual({
      x: 100,
      y: 50,
      width: 500,
      height: 350,
    });
    expect(view.visible).toBe(true);

    // Mid-drag the chrome and the native view cannot stay glued; the view is
    // captured (so the renderer can paint a stand-in) and then hidden for the
    // burst instead of tracking anything.
    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    expect(view.visible).toBe(false);
    expect(snapshotPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        dataUrl: `data:image/jpeg;base64,${Buffer.from("jpeg-bytes").toString("base64")}`,
      },
    ]);

    // The reveal applies bounds before visibility, intersected with the live
    // window so a shrunken window never shows a spilling view; the null push
    // then clears the renderer's stand-in.
    hostWindow.contentBounds = { width: 400, height: 300 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls[1]).toEqual({
      x: 100,
      y: 50,
      width: 300,
      height: 250,
    });
    expect(view.visible).toBe(true);
    expect(snapshotPushesOf(hostWindow).at(-1)).toEqual({
      tabId: "browser:a",
      dataUrl: null,
    });

    // The clamp is non-destructive: growing back re-applies the full
    // renderer-desired rect, not the clamped remnant.
    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    hostWindow.contentBounds = { width: 700, height: 450 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls[2]).toEqual({
      x: 100,
      y: 50,
      width: 500,
      height: 350,
    });
    expect(view.visible).toBe(true);
  });

  it("drops a capture that resolves after the resize burst already ended", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 46,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    // A tap-resize can end the burst before the capture resolves. The live
    // view is visible again by then; a late bitmap push would linger under it
    // into the next burst.
    manager.beginWindowResize(hostWindow);
    manager.endWindowResize(hostWindow);
    await settlePendingCaptures(view);

    const bitmapPushes = snapshotPushesOf(hostWindow).filter(
      (push) => push.dataUrl !== null,
    );
    expect(bitmapPushes).toHaveLength(0);
    expect(view.visible).toBe(true);
  });

  it("never grows a view past its renderer-desired rect on a native window grow", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 43,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    // Extrapolating the view to the new window size would visibly break it
    // out of its panel; it must hold the renderer-measured rect until the
    // renderer pushes a fresh one.
    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    hostWindow.contentBounds = { width: 900, height: 640 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls[1]).toEqual({
      x: 100,
      y: 50,
      width: 500,
      height: 350,
    });
  });

  it("applies renderer pushes that land mid-resize on the reveal", async () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 44,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    await settlePendingCaptures(view);
    hostWindow.contentBounds = { width: 500, height: 300 };
    manager.setBounds({
      hostWindow,
      request: {
        tabId: "browser:a",
        bounds: { x: 200, y: 90, width: 400, height: 300 },
      },
    });
    manager.endWindowResize(hostWindow);

    // The reveal intersects the latest renderer rect (not the attach-time one)
    // with the live window.
    expect(view.boundsCalls.at(-1)).toEqual({
      x: 200,
      y: 90,
      width: 300,
      height: 210,
    });
    expect(view.visible).toBe(true);
  });

  it("defers renderer visibility changes made during a resize burst to the reveal", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 45,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    // A tab switch mid-drag declares the view visible; it must stay hidden
    // until the resize settles.
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.visible).toBe(false);

    manager.endWindowResize(hostWindow);
    expect(view.visible).toBe(true);
  });

  it("keeps hidden views hidden and untouched across a resize burst", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 42,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = electronMock.fakeViews[0];
    expect(view).toBeDefined();
    if (view === undefined) {
      throw new Error("Expected the browser view to be created.");
    }

    manager.beginWindowResize(hostWindow);
    hostWindow.contentBounds = { width: 400, height: 300 };
    manager.endWindowResize(hostWindow);

    expect(view.boundsCalls).toHaveLength(1);
    expect(view.visible).toBe(false);
  });

  it("silences the tab's own webContents, and no other", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 71,
    });
    for (const tabId of ["browser:a", "browser:b"]) {
      manager.attach({
        hostWindow,
        request: {
          tabId,
          url: "",
          bounds: { x: 0, y: 0, width: 500, height: 350 },
          visible: false,
        },
      });
    }

    manager.setMuted({
      hostWindow,
      request: { tabId: "browser:a", muted: true },
    });

    expect(requireFakeView(0).webContents.audioMuted).toBe(true);
    expect(requireFakeView(1).webContents.audioMuted).toBe(false);

    manager.setMuted({
      hostWindow,
      request: { tabId: "browser:a", muted: false },
    });

    expect(requireFakeView(0).webContents.audioMuted).toBe(false);
  });

  // A tab the user has never opened has no view to silence. The renderer keeps
  // the mute and re-applies it when the view exists, so the shell only has to
  // not throw.
  it("ignores a mute for a tab with no view", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 72,
    });

    expect(() => {
      manager.setMuted({
        hostWindow,
        request: { tabId: "browser:none", muted: true },
      });
    }).not.toThrow();
  });

  it("focuses a freshly-attached active tab so Cmd+C targets its webContents", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 70,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(1);
  });

  it("does not focus a freshly-attached inactive tab", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 71,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(0);
  });

  it("focuses on a real hidden → visible setVisible transition only once", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 72,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: false,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(0);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.webContents.focusCalls).toBe(1);

    // A redundant re-show must not yank focus back from the address bar.
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.webContents.focusCalls).toBe(1);
  });

  it("re-focuses after a hide → show cycle", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 73,
    });

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser:a",
        url: "",
        bounds: { x: 100, y: 50, width: 500, height: 350 },
        visible: true,
      },
    });

    const view = requireFakeView(0);
    expect(view.webContents.focusCalls).toBe(1);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: false },
    });
    expect(view.webContents.focusCalls).toBe(1);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    expect(view.webContents.focusCalls).toBe(2);
  });

  it("allows clipboard-sanitized-write but denies clipboard-read and device permissions", () => {
    // Write-only clipboard lets in-page copy buttons work; read and every
    // device/capability permission stay denied.
    expect(isAllowedBrowserPermission("clipboard-sanitized-write")).toBe(true);
    // A video's fullscreen button asks for this one. Denying it does not hide
    // the control, it makes it do nothing.
    expect(isAllowedBrowserPermission("fullscreen")).toBe(true);
    // ...and this one stays denied precisely because fullscreen is allowed: it
    // is what would let a page keep the Escape that gets the user out.
    expect(isAllowedBrowserPermission("keyboardLock")).toBe(false);
    expect(isAllowedBrowserPermission("pointerLock")).toBe(false);
    expect(isAllowedBrowserPermission("clipboard-read")).toBe(false);
    expect(isAllowedBrowserPermission("media")).toBe(false);
    expect(isAllowedBrowserPermission("notifications")).toBe(false);
    expect(isAllowedBrowserPermission("geolocation")).toBe(false);

    // The same decision flows through the handlers the session registers.
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 74,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });

    const fakeSession = electronMock.fakeSessions.at(-1);
    expect(fakeSession).toBeDefined();
    if (fakeSession === undefined) {
      throw new Error("Expected a browser session to be created.");
    }
    const checkHandler = fakeSession.permissionCheckHandler;
    const requestHandler = fakeSession.permissionRequestHandler;
    expect(checkHandler).not.toBeNull();
    expect(requestHandler).not.toBeNull();
    if (checkHandler === null || requestHandler === null) {
      throw new Error("Expected permission handlers to be registered.");
    }

    expect(checkHandler(null, "clipboard-sanitized-write")).toBe(true);
    expect(checkHandler(null, "clipboard-read")).toBe(false);
    expect(checkHandler(null, "media")).toBe(false);

    const requestGrants: boolean[] = [];
    requestHandler(null, "clipboard-sanitized-write", (granted) => {
      requestGrants.push(granted);
    });
    requestHandler(null, "clipboard-read", (granted) => {
      requestGrants.push(granted);
    });
    requestHandler(null, "media", (granted) => {
      requestGrants.push(granted);
    });
    expect(requestGrants).toEqual([true, false, false]);
  });
});

// Reading page content is the one browser command that answers, and the one
// that hands page-controlled bytes to an agent — so every refusal is typed and
// the read never runs in the page's own JS world.
describe("DesktopBrowserViewManager page reads", () => {
  function attachTabForReads(url = "https://example.com/"): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 80,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    return { hostWindow, manager, webContents: requireFakeView(0).webContents };
  }

  it("reads text and selection in an isolated world, never the page's own", async () => {
    const { hostWindow, manager, webContents } = attachTabForReads();
    webContents.setTitle("Example Domain");
    webContents.isolatedWorldResult = {
      contentType: "text/html",
      text: "hello world",
      textTruncated: false,
      selection: "world",
      selectionTruncated: false,
    };

    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({
      ok: true,
      tabId: "browser:a",
      url: "https://example.com/",
      title: "Example Domain",
      isLoading: false,
      contentKind: "html",
      text: "hello world",
      textTruncated: false,
      selection: "world",
      selectionTruncated: false,
    });
    // The world matters: in the page's own world a hostile document could
    // redefine innerText to forge this, and could detect the read happening.
    expect(webContents.mainWorldCalls).toBe(0);
    expect(webContents.isolatedWorldCalls).toHaveLength(1);
    expect(webContents.isolatedWorldCalls[0]?.worldId).toBe(
      PATCHER_DESKTOP_BROWSER_PAGE_READ_WORLD_ID,
    );
    expect(webContents.isolatedWorldCalls[0]?.scripts).toEqual([
      { code: PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT },
    ]);
  });

  it("distinguishes a missing view from a destroyed one and from an empty tab", async () => {
    const { hostWindow, manager, webContents } = attachTabForReads();

    await expect(
      manager.readPage({ hostWindow, tabId: "browser:missing" }),
    ).resolves.toEqual({ ok: false, reason: "no-view" });

    // The empty-URL new-tab convention: a live view showing nothing.
    webContents.setUrl("");
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "no-page" });
    expect(webContents.isolatedWorldCalls).toHaveLength(0);

    webContents.setUrl("https://example.com/");
    webContents.destroyed = true;
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "no-view" });
  });

  it("times out a page that never answers, and ignores its late reply", async () => {
    vi.useFakeTimers();
    try {
      const { hostWindow, manager, webContents } = attachTabForReads();
      webContents.isolatedWorldResult = "pending";

      const pending = manager.readPage({ hostWindow, tabId: "browser:a" });
      await vi.advanceTimersByTimeAsync(
        PATCHER_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS + 1,
      );

      await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports a throwing or malformed script as unreadable", async () => {
    const { hostWindow, manager, webContents } = attachTabForReads();

    webContents.isolatedWorldResult = "reject";
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });

    webContents.isolatedWorldResult = { text: "only text" };
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });
  });

  it("truncates a page-supplied title to the contract cap", async () => {
    const { hostWindow, manager, webContents } = attachTabForReads();
    webContents.setTitle(
      "t".repeat(PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH + 50),
    );
    webContents.isolatedWorldResult = {
      contentType: "text/html",
      text: "",
      textTruncated: false,
      selection: "",
      selectionTruncated: false,
    };

    const result = await manager.readPage({ hostWindow, tabId: "browser:a" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.title).toHaveLength(
        PATCHER_DESKTOP_BROWSER_MAX_TITLE_LENGTH,
      );
    }
  });
});

// A PDF is the one document the read script cannot see: Chromium's viewer
// leaves an empty wrapper in the main frame and renders the document in a
// process of its own. These cover the seam that replaces the DOM read — the
// refetch and what happens to each way it can fail.
describe("DesktopBrowserViewManager PDF reads", () => {
  const PDF_URL = "https://example.com/report.pdf";

  function attachPdfTab(
    args: {
      extractPdfText?: CreateDesktopBrowserViewManagerArgs["extractPdfText"];
    } = {},
  ): {
    fakeSession: (typeof electronMock.fakeSessions)[number];
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
      ...(args.extractPdfText === undefined
        ? {}
        : { extractPdfText: args.extractPdfText }),
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 85,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url: PDF_URL });
    const view = requireFakeView(0);
    view.webContents.setTitle("report.pdf");
    // What the viewer leaves behind: the content type says PDF, the body is
    // empty, and nothing in the DOM is the document.
    view.webContents.isolatedWorldResult = {
      contentType: "application/pdf",
      text: "",
      textTruncated: false,
      selection: "",
      selectionTruncated: false,
    };
    const fakeSession = electronMock.fakeSessions.at(-1);
    if (fakeSession === undefined) {
      throw new Error("Expected a browser session to be created.");
    }
    fakeSession.fetchResponse = {
      ok: true,
      headers: { get: () => "application/pdf" },
      arrayBuffer: async () => Buffer.from("%PDF-1.7 bytes"),
    };
    return { fakeSession, hostWindow, manager };
  }

  it("refetches the document through the browsing session and answers with its text", async () => {
    const calls: Array<{ bytes: Uint8Array; timeoutMs: number }> = [];
    const { fakeSession, hostWindow, manager } = attachPdfTab({
      extractPdfText: async (request) => {
        calls.push(request);
        return { ok: true, text: "Quarterly Report", truncated: false };
      },
    });

    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({
      ok: true,
      tabId: "browser:a",
      url: PDF_URL,
      title: "report.pdf",
      isLoading: false,
      contentKind: "pdf",
      text: "Quarterly Report",
      textTruncated: false,
      // A PDF's selection belongs to PDFium; the wrapper frame has none.
      selection: "",
      selectionTruncated: false,
    });

    expect(fakeSession.fetchedUrls).toContain(PDF_URL);
    // The cookies are the point: a PDF behind a login is refetched with the
    // session that opened it, or it is not readable at all.
    expect(fakeSession.fetchInits.at(-1)?.credentials).toBe("include");
    expect(calls[0]?.bytes).toEqual(
      new Uint8Array(Buffer.from("%PDF-1.7 bytes")),
    );
    expect(calls[0]?.timeoutMs).toBeGreaterThan(0);
  });

  it("refuses a document the session will not hand back, without parsing anything", async () => {
    let parsed = false;
    const { fakeSession, hostWindow, manager } = attachPdfTab({
      extractPdfText: async () => {
        parsed = true;
        return { ok: true, text: "", truncated: false };
      },
    });

    // A `blob:` URL, a POST-only document, a server that stopped answering:
    // all arrive here as one refusal, because none is fixed by asking again.
    fakeSession.fetchRejection = new Error("net::ERR_FAILED");
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });

    fakeSession.fetchRejection = null;
    fakeSession.fetchResponse = {
      ok: false,
      headers: { get: () => "text/html" },
      arrayBuffer: async () => Buffer.from(""),
    };
    await expect(
      manager.readPage({ hostWindow, tabId: "browser:a" }),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });

    expect(parsed).toBe(false);
  });

  it("passes the parser's own refusals through to the caller", async () => {
    // `too-large` and `password-protected` exist because each is worth a
    // different next step than "could not be read".
    for (const reason of [
      "too-large",
      "password-protected",
      "timeout",
    ] as const) {
      const { hostWindow, manager } = attachPdfTab({
        extractPdfText: async () => ({ ok: false, reason }),
      });

      await expect(
        manager.readPage({ hostWindow, tabId: "browser:a" }),
      ).resolves.toEqual({ ok: false, reason });

      electronMock.fakeViews.length = 0;
      electronMock.fakeSessions.length = 0;
    }
  });

  it("reads an ordinary page the ordinary way, with no refetch at all", async () => {
    const { fakeSession, hostWindow, manager } = attachPdfTab({
      extractPdfText: async () => ({ ok: true, text: "pdf", truncated: false }),
    });
    requireFakeView(0).webContents.isolatedWorldResult = {
      contentType: "text/html",
      text: "hello",
      textTruncated: false,
      selection: "",
      selectionTruncated: false,
    };

    const result = await manager.readPage({ hostWindow, tabId: "browser:a" });

    expect(result).toMatchObject({
      ok: true,
      contentKind: "html",
      text: "hello",
    });
    expect(fakeSession.fetchedUrls).toEqual([]);
  });
});

// The snapshot is what makes elements addressable, so these cover the seam the
// pure builder cannot: when the debugger attaches, and when the refs it handed
// out stop being trustworthy.
describe("DesktopBrowserViewManager snapshots", () => {
  function attachTabForSnapshots(url = "https://example.com/"): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 90,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    return { hostWindow, manager, webContents: requireFakeView(0).webContents };
  }

  function axTree(): { nodes: unknown[] } {
    return {
      nodes: [
        { nodeId: "1", role: { value: "main" }, childIds: ["2"] },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "Save" },
          backendDOMNodeId: 77,
        },
      ],
    };
  }

  it("attaches the debugger on first use, not when the tab is created", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.results.set("Accessibility.getFullAXTree", axTree());

    // A debugger on every tab from creation is overhead and exposure, and it
    // would move this tab's dialogs off Chromium's native path.
    expect(webContents.debugger.attachCalls).toHaveLength(0);

    const result = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });

    expect(webContents.debugger.attachCalls).toEqual(["1.3"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot).toContain('- button "Save" [ref=e1]');
      expect(result.refCount).toBe(1);
      expect(result.url).toBe("https://example.com/");
    }
  });

  it("reuses one session and enables the domain once across snapshots", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.results.set("Accessibility.getFullAXTree", axTree());

    await manager.snapshot({ hostWindow, request: { tabId: "browser:a" } });
    await manager.snapshot({ hostWindow, request: { tabId: "browser:a" } });

    expect(webContents.debugger.attachCalls).toHaveLength(1);
    expect(
      webContents.debugger.commands.filter(
        (command) => command.method === "Accessibility.enable",
      ),
    ).toHaveLength(1);
  });

  it("moves the generation on when a navigation invalidates its refs", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.results.set("Accessibility.getFullAXTree", axTree());

    const first = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });
    webContents.emitDidNavigate("https://example.com/next");
    const second = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });

    // Refs name nodes in the document that produced them. A caller holding an
    // old generation must be refused rather than resolved against whatever owns
    // that node id now.
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.generation).toBeGreaterThan(first.generation);
    }
  });

  it("says so when another debugger already holds the tab", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.attached = true;

    const result = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });

    // DevTools on the view is the realistic cause, and it is worth naming.
    expect(result).toMatchObject({ ok: false, reason: "debugger-unavailable" });
  });

  it("reports a protocol failure without throwing", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.failures.set(
      "Accessibility.getFullAXTree",
      new Error("Not allowed"),
    );

    await expect(
      manager.snapshot({ hostWindow, request: { tabId: "browser:a" } }),
    ).resolves.toMatchObject({ ok: false, reason: "failed" });
  });

  it("separates a missing view from a tab showing nothing", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();

    await expect(
      manager.snapshot({ hostWindow, request: { tabId: "browser:missing" } }),
    ).resolves.toEqual({ ok: false, reason: "no-view" });

    webContents.setUrl("");
    await expect(
      manager.snapshot({ hostWindow, request: { tabId: "browser:a" } }),
    ).resolves.toEqual({ ok: false, reason: "no-page" });
  });

  it("releases the debugger when the tab is closed", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.results.set("Accessibility.getFullAXTree", axTree());
    await manager.snapshot({ hostWindow, request: { tabId: "browser:a" } });

    manager.detach({ hostWindow, tabId: "browser:a" });

    expect(webContents.debugger.detachCalls).toBe(1);
  });

  it("recovers by reattaching after the session is lost", async () => {
    const { hostWindow, manager, webContents } = attachTabForSnapshots();
    webContents.debugger.results.set("Accessibility.getFullAXTree", axTree());
    await manager.snapshot({ hostWindow, request: { tabId: "browser:a" } });

    // DevTools opening, or a renderer crash, takes the session away.
    webContents.debugger.emitDetach("canceled by user");
    webContents.debugger.attached = false;

    const result = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });

    expect(result.ok).toBe(true);
    expect(webContents.debugger.attachCalls).toHaveLength(2);
  });
});

// Once the shell owns a tab's dialogs, Chromium stops drawing its native modal —
// so the app has to draw one, and the native view has to get out of the way. A
// dialog left half-handled is a wedged tab, which is the bug this replaces.
describe("DesktopBrowserViewManager dialogs", () => {
  async function attachTabWithDialogs(): Promise<{
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
    view: ReturnType<typeof requireFakeView>;
  }> {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 95,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const view = requireFakeView(0);
    view.webContents.debugger.results.set("Accessibility.getFullAXTree", {
      nodes: [{ nodeId: "1", role: { value: "main" } }],
    });
    // Dialog interception rides the same lazy attach automation pays for.
    await manager.snapshot({ hostWindow, request: { tabId: "browser:a" } });
    return { hostWindow, manager, view, webContents: view.webContents };
  }

  function dialogPushesOf(hostWindow: FakeHostWindow): unknown[] {
    const pushes: unknown[] = [];
    for (const message of hostWindow.webContents.sentMessages) {
      if (message.channel === "patcher-desktop:browser:dialog") {
        pushes.push(message.payload);
      }
    }
    return pushes;
  }

  function openDialog(
    webContents: ReturnType<typeof requireFakeView>["webContents"],
    params: Record<string, unknown>,
  ): void {
    webContents.debugger.emitMessage("Page.javascriptDialogOpening", params);
  }

  it("enables the Page domain so dialogs reach us at all", async () => {
    const { webContents } = await attachTabWithDialogs();

    expect(
      webContents.debugger.commands.filter(
        (command) => command.method === "Page.enable",
      ),
    ).toHaveLength(1);
  });

  it("hides the page and reports the dialog when one opens", async () => {
    const { hostWindow, view, webContents } = await attachTabWithDialogs();
    expect(view.visible).toBe(true);

    openDialog(webContents, {
      type: "confirm",
      message: "Delete everything?",
      defaultPrompt: "",
    });

    // A WebContentsView composites above the DOM, so the only way the app can
    // draw a modal over the page is for the page to stop being there.
    expect(view.visible).toBe(false);
    expect(dialogPushesOf(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        dialog: {
          type: "confirm",
          message: "Delete everything?",
          defaultPrompt: "",
        },
      },
    ]);
  });

  it("answers the page and brings the view back", async () => {
    const { hostWindow, manager, view, webContents } =
      await attachTabWithDialogs();
    openDialog(webContents, {
      type: "confirm",
      message: "Sure?",
      defaultPrompt: "",
    });

    await expect(
      manager.respondToDialog({
        hostWindow,
        request: { tabId: "browser:a", accept: true },
      }),
    ).resolves.toBe(true);

    expect(
      webContents.debugger.commands.filter(
        (command) => command.method === "Page.handleJavaScriptDialog",
      ),
    ).toEqual([
      { method: "Page.handleJavaScriptDialog", params: { accept: true } },
    ]);
    expect(view.visible).toBe(true);
    expect(dialogPushesOf(hostWindow).at(-1)).toEqual({
      tabId: "browser:a",
      dialog: null,
    });
  });

  it("sends prompt text only for a prompt being accepted", async () => {
    const { hostWindow, manager, webContents } = await attachTabWithDialogs();

    openDialog(webContents, {
      type: "prompt",
      message: "Name?",
      defaultPrompt: "anon",
    });
    await manager.respondToDialog({
      hostWindow,
      request: { tabId: "browser:a", accept: true, promptText: "Konstantin" },
    });

    openDialog(webContents, {
      type: "alert",
      message: "Done",
      defaultPrompt: "",
    });
    await manager.respondToDialog({
      hostWindow,
      // Chromium rejects promptText on a dialog that has no prompt.
      request: { tabId: "browser:a", accept: true, promptText: "ignored" },
    });

    expect(
      webContents.debugger.commands
        .filter((command) => command.method === "Page.handleJavaScriptDialog")
        .map((command) => command.params),
    ).toEqual([{ accept: true, promptText: "Konstantin" }, { accept: true }]);
  });

  it("refuses to answer a tab that has no dialog open", async () => {
    const { hostWindow, manager } = await attachTabWithDialogs();

    await expect(
      manager.respondToDialog({
        hostWindow,
        request: { tabId: "browser:a", accept: true },
      }),
    ).resolves.toBe(false);
    await expect(
      manager.respondToDialog({
        hostWindow,
        request: { tabId: "browser:missing", accept: true },
      }),
    ).resolves.toBe(false);
  });

  it("restores the view when the page closes the dialog itself", async () => {
    const { view, webContents } = await attachTabWithDialogs();
    openDialog(webContents, {
      type: "alert",
      message: "Hi",
      defaultPrompt: "",
    });
    expect(view.visible).toBe(false);

    webContents.debugger.emitMessage("Page.javascriptDialogClosed", {
      result: true,
    });

    expect(view.visible).toBe(true);
  });

  it("does not leave the view hidden when answering throws", async () => {
    const { hostWindow, manager, view, webContents } =
      await attachTabWithDialogs();
    openDialog(webContents, {
      type: "alert",
      message: "Hi",
      defaultPrompt: "",
    });
    webContents.debugger.failures.set(
      "Page.handleJavaScriptDialog",
      new Error("target gone"),
    );

    await expect(
      manager.respondToDialog({
        hostWindow,
        request: { tabId: "browser:a", accept: true },
      }),
    ).resolves.toBe(false);

    // Losing the page mid-answer must not cost the user their browser view.
    expect(view.visible).toBe(true);
  });

  it("truncates a page-supplied dialog message", async () => {
    const { hostWindow, webContents } = await attachTabWithDialogs();

    openDialog(webContents, {
      type: "alert",
      message: "m".repeat(
        PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH + 100,
      ),
      defaultPrompt: "",
    });

    const push = dialogPushesOf(hostWindow).at(-1) as {
      dialog: { message: string };
    };
    expect(push.dialog.message).toHaveLength(
      PATCHER_DESKTOP_BROWSER_MAX_DIALOG_MESSAGE_LENGTH,
    );
  });
});

// Interactions are where a mistake is a side effect on a real page rather than
// a wrong answer, so these cover the two things that stop that: the ref has to
// resolve to the element the caller meant, and the element has to be ready
// before anything is dispatched at it.
describe("DesktopBrowserViewManager interactions", () => {
  const READY_POINT = { x: 40, y: 25 };

  interface InteractionHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
    /** Answers keyed by the script being run, so each call can differ. */
    scriptResults: Map<string, unknown>;
    generation: number;
  }

  async function attachTabForInteractions(): Promise<InteractionHarness> {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 91,
    });
    attachBrowserTab({
      manager,
      hostWindow,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    const { webContents } = requireFakeView(0);

    webContents.debugger.results.set("Accessibility.getFullAXTree", {
      nodes: [
        { nodeId: "1", role: { value: "main" }, childIds: ["2"] },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "Save" },
          backendDOMNodeId: 77,
        },
      ],
    });
    webContents.debugger.results.set("Page.getFrameTree", {
      frameTree: { frame: { id: "frame-1" } },
    });
    webContents.debugger.results.set("Page.createIsolatedWorld", {
      executionContextId: 7,
    });
    webContents.debugger.results.set("DOM.resolveNode", {
      object: { objectId: "object-1" },
    });

    const scriptResults = new Map<string, unknown>([
      [PATCHER_BROWSER_ACTIONABILITY_SCRIPT, { ready: true, ...READY_POINT }],
    ]);
    webContents.debugger.results.set(
      "Runtime.callFunctionOn",
      (params?: Record<string, unknown>) => ({
        result: {
          value: scriptResults.get(String(params?.functionDeclaration)) ?? {
            ok: true,
          },
        },
      }),
    );

    // Refs only exist once a snapshot has handed them out.
    const snapshot = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });
    const generation = snapshot.ok ? snapshot.generation : -1;
    return { hostWindow, manager, webContents, scriptResults, generation };
  }

  function inputEvents(
    webContents: InteractionHarness["webContents"],
  ): Array<{ method: string; params?: Record<string, unknown> }> {
    return webContents.debugger.commands.filter((command) =>
      command.method.startsWith("Input."),
    );
  }

  beforeEach(() => {
    vi.useRealTimers();
  });

  it("clicks at the point the page reported, having waited for it", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: {
          action: "click",
          ref: "e1",
          button: "left",
          clickCount: 1,
          modifiers: [],
        },
      },
    });

    expect(result).toMatchObject({ ok: true, url: "https://example.com/" });
    // The ref has to travel to CDP as the backend node id the snapshot recorded,
    // not as the string the caller passed.
    expect(
      webContents.debugger.commands.find(
        (command) => command.method === "DOM.resolveNode",
      )?.params,
    ).toMatchObject({ backendNodeId: 77, executionContextId: 7 });
    expect(
      inputEvents(webContents).map((event) => [
        event.params?.type,
        event.params?.x,
        event.params?.y,
      ]),
    ).toEqual([
      ["mouseMoved", 40, 25],
      ["mousePressed", 40, 25],
      ["mouseReleased", 40, 25],
    ]);
  });

  it("sends a double click as two rising click counts", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: {
          action: "click",
          ref: "e1",
          button: "left",
          clickCount: 2,
          modifiers: [],
        },
      },
    });

    // One event claiming clickCount 2 is not a double click to Chromium.
    expect(
      inputEvents(webContents)
        .filter((event) => event.params?.type === "mousePressed")
        .map((event) => event.params?.clickCount),
    ).toEqual([1, 2]);
  });

  it("refuses a ref from a snapshot the page has moved past", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation: generation + 1,
        interaction: { action: "hover", ref: "e1" },
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "stale-refs" });
    // Nothing may reach the page: a click resolved against a stale ref is worse
    // than a refusal, because it silently hits the wrong element.
    expect(inputEvents(webContents)).toHaveLength(0);
  });

  it("refuses a ref the current snapshot never handed out", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "hover", ref: "e99" },
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "unknown-ref" });
    expect(inputEvents(webContents)).toHaveLength(0);
  });

  it("gives up with the reason when the element never becomes actionable", async () => {
    const { hostWindow, manager, webContents, scriptResults, generation } =
      await attachTabForInteractions();
    scriptResults.set(PATCHER_BROWSER_ACTIONABILITY_SCRIPT, {
      ready: false,
      reason: "covered",
    });

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "hover", ref: "e1" },
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "not-actionable" });
    // The message is the whole value of the check: "something is on top of it"
    // tells an agent to dismiss the overlay, where a bare failure would not.
    expect((result as { message?: string }).message).toContain("on top of");
    expect(inputEvents(webContents)).toHaveLength(0);
  }, 15_000);

  it("fills by selecting the old value and inserting the new one", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "fill", ref: "e1", text: "hello" },
      },
    });

    const scripts = webContents.debugger.commands
      .filter((command) => command.method === "Runtime.callFunctionOn")
      .map((command) => command.params?.functionDeclaration);
    expect(scripts).toContain(PATCHER_BROWSER_PREPARE_FILL_SCRIPT);
    expect(
      webContents.debugger.commands.find(
        (command) => command.method === "Input.insertText",
      )?.params,
    ).toEqual({ text: "hello" });
  });

  it("clears a field with a keystroke, because inserting nothing does nothing", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "fill", ref: "e1", text: "" },
      },
    });

    expect(
      webContents.debugger.commands.some(
        (command) => command.method === "Input.insertText",
      ),
    ).toBe(false);
    expect(
      inputEvents(webContents).map((event) => [
        event.method,
        event.params?.key,
      ]),
    ).toEqual([
      ["Input.dispatchKeyEvent", "Delete"],
      ["Input.dispatchKeyEvent", "Delete"],
    ]);
  });

  it("types one key event per character", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "type", ref: "e1", text: "ab" },
      },
    });

    // Down and up for each of two characters: what an autocomplete listens for
    // and what a one-shot fill would not produce.
    expect(
      inputEvents(webContents).map((event) => [
        event.params?.type,
        event.params?.key,
      ]),
    ).toEqual([
      ["keyDown", "a"],
      ["keyUp", "a"],
      ["keyDown", "b"],
      ["keyUp", "b"],
    ]);
  });

  it("refuses an unknown key before touching the page", async () => {
    const { hostWindow, manager, webContents, generation } =
      await attachTabForInteractions();

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "press", ref: null, key: "Frobnicate" },
      },
    });

    expect(result).toMatchObject({ ok: false, reason: "unsupported-key" });
    expect(inputEvents(webContents)).toHaveLength(0);
  });

  it("leaves an already-checked control alone", async () => {
    const { hostWindow, manager, webContents, scriptResults, generation } =
      await attachTabForInteractions();
    scriptResults.set(PATCHER_BROWSER_READ_CHECKED_SCRIPT, {
      ok: true,
      checked: true,
    });

    const result = await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        interaction: { action: "check", ref: "e1", checked: true },
      },
    });

    // "make it checked" is not "toggle it", so repeating the command is a no-op
    // rather than an unchecked box.
    expect(result).toMatchObject({ ok: true });
    expect(inputEvents(webContents)).toHaveLength(0);
  });

  it("restores the viewport when a resize asks for nothing", async () => {
    const { hostWindow, manager, webContents } =
      await attachTabForInteractions();

    await manager.interact({
      hostWindow,
      request: {
        tabId: "browser:a",
        interaction: { action: "resize", width: 0, height: 0 },
      },
    });

    expect(
      webContents.debugger.commands.some(
        (command) => command.method === "Emulation.clearDeviceMetricsOverride",
      ),
    ).toBe(true);
  });

  it("reports a tab with no live view rather than attaching a debugger to nothing", async () => {
    const { hostWindow, manager } = await attachTabForInteractions();

    await expect(
      manager.interact({
        hostWindow,
        request: {
          tabId: "browser:missing",
          interaction: { action: "hover", ref: "e1" },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

describe("DesktopBrowserViewManager observations", () => {
  interface ObservationHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: ReturnType<typeof requireFakeView>;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  }

  function attachTabForObservations(
    url = "https://example.com/",
  ): ObservationHarness {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 93,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    const view = requireFakeView(0);
    return { hostWindow, manager, view, webContents: view.webContents };
  }

  function requireNetworkListener(
    kind: "completed" | "error",
  ): FakeNetworkRequestListener {
    const fakeSession = electronMock.fakeSessions.at(-1);
    if (fakeSession === undefined) {
      throw new Error("Expected a browser session to be created.");
    }
    const listener =
      kind === "completed"
        ? fakeSession.completedListener
        : fakeSession.errorListener;
    if (listener === null) {
      throw new Error(`Expected an ${kind} listener to be registered.`);
    }
    return listener;
  }

  beforeEach(() => {
    electronMock.fakeSessions.length = 0;
    electronMock.fakeViews.length = 0;
  });

  it("captures the viewport without attaching a debugger to the tab", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    webContents.setTitle("Example");

    const pending = manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "screenshot", format: "jpeg", quality: 70 },
      },
    });
    await settlePendingCaptures(requireFakeView(0));

    expect(await pending).toEqual({
      ok: true,
      kind: "screenshot",
      tabId: "browser:a",
      url: "https://example.com/",
      title: "Example",
      mimeType: "image/jpeg",
      base64: Buffer.from("jpeg-bytes").toString("base64"),
      width: 800,
      height: 600,
    });
    // The whole point of the observation channel: a tab a human is browsing
    // keeps its dialogs on Chromium's native path, because nothing here
    // attaches the debugger or enables the Page domain.
    expect(webContents.debugger.attachCalls).toEqual([]);
  });

  it("encodes PNG when asked, so exact pixels survive", async () => {
    const { hostWindow, manager } = attachTabForObservations();

    const pending = manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "screenshot", format: "png", quality: 80 },
      },
    });
    await settlePendingCaptures(requireFakeView(0));
    const result = await pending;

    expect(result).toMatchObject({
      ok: true,
      mimeType: "image/png",
      base64: Buffer.from("png-bytes").toString("base64"),
    });
  });

  // The user's Cmd+P, which is a different thing from rendering a PDF for a
  // program: it opens the OS dialog and reports nothing back.
  it("opens the print dialog for a page, and not for an empty tab", () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();

    manager.print({ hostWindow, tabId: "browser:a" });
    expect(webContents.printCalls).toBe(1);

    // A tab showing nothing would print a blank sheet — a worse answer than
    // leaving the dialog closed.
    webContents.setUrl("");
    manager.print({ hostWindow, tabId: "browser:a" });
    expect(webContents.printCalls).toBe(1);

    // And a tab nobody has heard of is not an error, just nothing to print.
    manager.print({ hostWindow, tabId: "browser:missing" });
    expect(webContents.printCalls).toBe(1);
  });

  it("prints the page to a PDF", async () => {
    const { hostWindow, manager } = attachTabForObservations();

    await expect(
      manager.observe({
        hostWindow,
        request: { tabId: "browser:a", observation: { kind: "pdf" } },
      }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "pdf",
      base64: Buffer.from("%PDF-1.4\n").toString("base64"),
      byteLength: 9,
    });
  });

  it("refuses a capture of a tab that has loaded nothing", async () => {
    const { hostWindow, manager } = attachTabForObservations("");

    await expect(
      manager.observe({
        hostWindow,
        request: {
          tabId: "browser:a",
          observation: { kind: "screenshot", format: "jpeg", quality: 70 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });
  });

  it("reports a failed print as a refusal rather than rejecting", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    webContents.pdfResult = new Error("printing failed");

    await expect(
      manager.observe({
        hostWindow,
        request: { tabId: "browser:a", observation: { kind: "pdf" } },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
      message: "printing failed",
    });
  });

  it("records console messages from the moment the tab exists", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    webContents.emitConsoleMessage({
      level: "error",
      message: "boom",
      lineNumber: 12,
      sourceId: "https://example.com/app.js",
    });
    webContents.emitConsoleMessage({ level: "info", message: "hello" });

    const result = await manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "console", limit: 10 },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      kind: "console",
      droppedCount: 0,
    });
    expect(
      result.ok && result.kind === "console" ? result.entries : [],
    ).toEqual([
      expect.objectContaining({ level: "error", text: "boom", line: 12 }),
      expect.objectContaining({ level: "info", text: "hello" }),
    ]);
  });

  it("keeps the console log across a navigation, because the tab is the subject", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    webContents.emitConsoleMessage({ message: "before" });
    webContents.emitDidNavigate("https://example.com/next");
    webContents.emitConsoleMessage({ message: "after" });

    const result = await manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "console", limit: 10 },
      },
    });

    expect(
      result.ok && result.kind === "console"
        ? result.entries.map((entry) => entry.text)
        : [],
    ).toEqual(["before", "after"]);
  });

  it("records finished requests against the tab that made them", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    const completed = requireNetworkListener("completed");
    const failed = requireNetworkListener("error");

    completed({
      url: "https://example.com/app.js",
      method: "GET",
      resourceType: "script",
      statusCode: 200,
      fromCache: true,
      webContentsId: webContents.id,
      timestamp: 1_700_000_000_000,
    });
    failed({
      url: "http://127.0.0.1:9/",
      method: "GET",
      resourceType: "xhr",
      error: "net::ERR_BLOCKED_BY_CLIENT",
      webContentsId: webContents.id,
      timestamp: 1_700_000_000_001,
    });
    // A request from some other view must not land in this tab's log.
    completed({
      url: "https://elsewhere.test/",
      method: "GET",
      resourceType: "xhr",
      statusCode: 200,
      webContentsId: webContents.id + 1_000,
    });

    const result = await manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "network", limit: 50 },
      },
    });

    expect(
      result.ok && result.kind === "network" ? result.entries : [],
    ).toEqual([
      {
        method: "GET",
        url: "https://example.com/app.js",
        resourceType: "script",
        status: 200,
        fromCache: true,
        error: null,
        timestamp: 1_700_000_000_000,
      },
      {
        method: "GET",
        url: "http://127.0.0.1:9/",
        resourceType: "xhr",
        status: null,
        fromCache: false,
        error: "net::ERR_BLOCKED_BY_CLIENT",
        timestamp: 1_700_000_000_001,
      },
    ]);
  });

  it("says how many log entries the limit left behind", async () => {
    const { hostWindow, manager, webContents } = attachTabForObservations();
    for (const index of [1, 2, 3]) {
      webContents.emitConsoleMessage({ message: `line ${index}` });
    }

    const result = await manager.observe({
      hostWindow,
      request: {
        tabId: "browser:a",
        observation: { kind: "console", limit: 1 },
      },
    });

    expect(result).toMatchObject({ droppedCount: 2 });
    expect(
      result.ok && result.kind === "console"
        ? result.entries.map((entry) => entry.text)
        : [],
    ).toEqual(["line 3"]);
  });

  it("answers the console log for a tab with no page rather than refusing", async () => {
    // A new tab has nothing to capture, but "what has this tab logged" is still
    // a question with an answer, and the answer is "nothing".
    const { hostWindow, manager } = attachTabForObservations("");

    await expect(
      manager.observe({
        hostWindow,
        request: {
          tabId: "browser:a",
          observation: { kind: "console", limit: 10 },
        },
      }),
    ).resolves.toMatchObject({ ok: true, kind: "console", entries: [] });
  });

  it("reports a tab with no live view", async () => {
    const { hostWindow, manager } = attachTabForObservations();

    await expect(
      manager.observe({
        hostWindow,
        request: {
          tabId: "browser:missing",
          observation: { kind: "network", limit: 10 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

describe("DesktopBrowserViewManager storage", () => {
  type FakeSessionRecord = (typeof electronMock.fakeSessions)[number];

  interface StorageHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    session: FakeSessionRecord;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  }

  function attachTabForStorage(
    url = "https://example.com/app",
  ): StorageHarness {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 94,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    const session = electronMock.fakeSessions.at(-1);
    if (session === undefined) {
      throw new Error("Expected a browser session to be created.");
    }
    return {
      hostWindow,
      manager,
      session,
      webContents: requireFakeView(0).webContents,
    };
  }

  beforeEach(() => {
    electronMock.fakeSessions.length = 0;
    electronMock.fakeViews.length = 0;
  });

  it("reads the tab's cookies without attaching a debugger", async () => {
    const { hostWindow, manager, session, webContents } = attachTabForStorage();
    session.storedCookies = [
      {
        name: "session",
        value: "abc",
        domain: ".example.com",
        path: "/",
        secure: true,
        httpOnly: true,
        sameSite: "lax",
      },
    ];

    const result = await manager.storage({
      hostWindow,
      request: { tabId: "browser:a", operation: { kind: "cookies-get" } },
    });

    expect(result).toEqual({
      ok: true,
      kind: "cookies",
      tabId: "browser:a",
      url: "https://example.com/app",
      title: null,
      cookies: [
        {
          name: "session",
          value: "abc",
          domain: ".example.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ],
    });
    // Storage is an observation: reading it must not move this tab's dialogs
    // off Chromium's native path.
    expect(webContents.debugger.attachCalls).toEqual([]);
  });

  it("counts the cookies a saved state could not write instead of abandoning it", async () => {
    const { hostWindow, manager, session } = attachTabForStorage();
    session.cookieSetFailure = new Error("Failed to set cookie");

    await expect(
      manager.storage({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: {
            kind: "cookies-set",
            cookies: [
              {
                name: "a",
                value: "1",
                domain: "",
                path: "/",
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: "Lax",
              },
              {
                name: "b",
                value: "2",
                domain: "",
                path: "/",
                expires: -1,
                httpOnly: false,
                secure: false,
                sameSite: "Lax",
              },
            ],
          },
        },
      }),
    ).resolves.toEqual({ ok: true, kind: "written", applied: 0, rejected: 2 });
    // Both were attempted: one refusal is not a reason to stop.
    expect(session.cookieSetCalls).toHaveLength(2);
  });

  it("clears the cookies the tab's url carries", async () => {
    const { hostWindow, manager, session } = attachTabForStorage();
    session.storedCookies = [
      { name: "a", value: "1" },
      { name: "b", value: "2" },
    ];

    await expect(
      manager.storage({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "cookies-clear", name: null },
        },
      }),
    ).resolves.toEqual({ ok: true, kind: "removed", removed: 2 });
    expect(session.cookieRemoveCalls).toEqual([
      { url: "https://example.com/app", name: "a" },
      { url: "https://example.com/app", name: "b" },
    ]);
  });

  it("reads web storage out of the page's isolated world", async () => {
    const { hostWindow, manager, webContents } = attachTabForStorage();
    webContents.isolatedWorldResult = {
      items: [{ name: "token", value: "abc" }],
      truncated: false,
    };

    await expect(
      manager.storage({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "items-get", area: "local" },
        },
      }),
    ).resolves.toEqual({
      ok: true,
      kind: "items",
      tabId: "browser:a",
      url: "https://example.com/app",
      title: null,
      area: "local",
      items: [{ name: "token", value: "abc" }],
      truncated: false,
    });
    // Same privileged world the page read uses, so a page cannot shadow
    // `localStorage` to forge what it holds.
    expect(webContents.isolatedWorldCalls.at(-1)?.worldId).toBe(1729);
    expect(webContents.debugger.attachCalls).toEqual([]);
  });

  it("passes a page's own refusal back rather than reporting a generic failure", async () => {
    const { hostWindow, manager, webContents } = attachTabForStorage();
    webContents.isolatedWorldResult = {
      error: "This page's storage is not accessible.",
    };

    await expect(
      manager.storage({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "items-get", area: "session" },
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
      message: "This page's storage is not accessible.",
    });
  });

  it("gives up on a page that never runs the script", async () => {
    vi.useFakeTimers();
    try {
      const { hostWindow, manager, webContents } = attachTabForStorage();
      webContents.isolatedWorldResult = "pending";

      const pending = manager.storage({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "items-clear", area: "local", name: null },
        },
      });
      await vi.advanceTimersByTimeAsync(2_000);

      await expect(pending).resolves.toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses every operation on a tab that has loaded nothing", async () => {
    // Storage is per-origin, and a tab showing nothing has no origin — unlike
    // the console log, which is the tab's own and answers regardless.
    const { hostWindow, manager } = attachTabForStorage("");

    await expect(
      manager.storage({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "cookies-get" } },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });
  });

  it("reports a tab with no live view", async () => {
    const { hostWindow, manager } = attachTabForStorage();

    await expect(
      manager.storage({
        hostWindow,
        request: {
          tabId: "browser:missing",
          operation: { kind: "cookies-get" },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

// Stage E is the group that hands over what the rest of this API withholds, so
// what these pin down is where each command stops: which world an expression
// runs in, that the interception answers every paused request, and that a route
// does not outlive the session that installed it.
describe("DesktopBrowserViewManager control", () => {
  interface ControlHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
    generation: number;
  }

  async function attachTabForControl(
    url = "https://example.com/",
  ): Promise<ControlHarness> {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 94,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    const { webContents } = requireFakeView(0);

    webContents.debugger.results.set("Accessibility.getFullAXTree", {
      nodes: [
        { nodeId: "1", role: { value: "main" }, childIds: ["2"] },
        {
          nodeId: "2",
          role: { value: "button" },
          name: { value: "Save" },
          backendDOMNodeId: 77,
        },
      ],
    });
    webContents.debugger.results.set("Runtime.evaluate", {
      result: { objectId: "global-1" },
    });
    webContents.debugger.results.set("DOM.resolveNode", {
      object: { objectId: "element-1" },
    });
    webContents.debugger.results.set("Runtime.callFunctionOn", {
      result: { value: { title: "Example" } },
    });

    let generation = -1;
    if (url.length > 0) {
      const snapshot = await manager.snapshot({
        hostWindow,
        request: { tabId: "browser:a" },
      });
      generation = snapshot.ok ? snapshot.generation : -1;
    }
    return { hostWindow, manager, webContents, generation };
  }

  function commandsOf(
    webContents: ControlHarness["webContents"],
    prefix: string,
  ): Array<{ method: string; params?: Record<string, unknown> }> {
    return webContents.debugger.commands.filter((command) =>
      command.method.startsWith(prefix),
    );
  }

  it("evaluates in the page's own world, not the isolated one", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    const result = await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: {
          kind: "evaluate",
          expression: "() => ({ title: document.title })",
          ref: null,
        },
      },
    });

    // The handle comes from a plain `Runtime.evaluate`, which lands in the
    // page's default context — an isolated world would not see the page's own
    // globals, which is the entire reason to run an expression at all.
    expect(webContents.debugger.commands).toContainEqual({
      method: "Runtime.evaluate",
      params: { expression: "globalThis" },
    });
    expect(commandsOf(webContents, "Page.createIsolatedWorld")).toHaveLength(0);
    expect(result).toMatchObject({
      ok: true,
      kind: "evaluated",
      value: '{"title":"Example"}',
      truncated: false,
    });
  });

  it("passes the element a ref names as the expression's argument", async () => {
    const { generation, hostWindow, manager, webContents } =
      await attachTabForControl();

    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        generation,
        operation: {
          kind: "evaluate",
          expression: "(el) => el.textContent",
          ref: "e1",
        },
      },
    });

    // Resolved with no execution context, so the element arrives in the page's
    // world too — the same world the expression runs in.
    expect(commandsOf(webContents, "DOM.resolveNode")).toContainEqual({
      method: "DOM.resolveNode",
      params: { backendNodeId: 77 },
    });
    const call = commandsOf(webContents, "Runtime.callFunctionOn").at(-1);
    expect(call?.params).toMatchObject({
      objectId: "element-1",
      functionDeclaration: "(el) => el.textContent",
      arguments: [{ objectId: "element-1" }],
      awaitPromise: true,
    });
  });

  it("refuses a ref from a snapshot the page has moved past", async () => {
    const { generation, hostWindow, manager } = await attachTabForControl();

    await expect(
      manager.control({
        hostWindow,
        request: {
          tabId: "browser:a",
          generation: generation + 1,
          operation: {
            kind: "evaluate",
            expression: "(el) => el.textContent",
            ref: "e1",
          },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "stale-refs" });
  });

  it("hands back the page's own error when the expression throws", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();
    webContents.debugger.results.set("Runtime.callFunctionOn", {
      exceptionDetails: {
        text: "Uncaught",
        exception: { description: "TypeError: x is not a function" },
      },
    });

    // A thrown expression is the caller's to fix, and the page's own words are
    // the only thing that says what to change.
    await expect(
      manager.control({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "evaluate", expression: "() => x()", ref: null },
        },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "evaluation-failed",
      message: "TypeError: x is not a function",
    });
  });

  it("acts at the last point the pointer was moved to", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    for (const operation of [
      { kind: "mouse-move", x: 120, y: 64 },
      { kind: "mouse-button", button: "left", down: true },
      { kind: "mouse-button", button: "left", down: false },
      { kind: "mouse-wheel", deltaX: 0, deltaY: -240 },
    ] as const) {
      await manager.control({
        hostWindow,
        request: { tabId: "browser:a", operation },
      });
    }

    // Chromium wants a point on every mouse event while `mousedown` names none,
    // so the tracked point is what makes move → down → up a click.
    expect(
      commandsOf(webContents, "Input.").map((command) => [
        command.method,
        command.params?.type,
        command.params?.x,
        command.params?.y,
      ]),
    ).toEqual([
      ["Input.dispatchMouseEvent", "mouseMoved", 120, 64],
      ["Input.dispatchMouseEvent", "mousePressed", 120, 64],
      ["Input.dispatchMouseEvent", "mouseReleased", 120, 64],
      ["Input.dispatchMouseEvent", "mouseWheel", 120, 64],
    ]);
  });

  it("fulfills a paused request that matches and continues one that does not", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: {
          kind: "route-set",
          route: {
            pattern: "**/api/me",
            status: 201,
            contentType: "application/json",
            body: '{"ok":true}',
            headers: [{ name: "x-mock", value: "1" }],
          },
        },
      },
    });

    expect(commandsOf(webContents, "Fetch.enable")).toHaveLength(1);

    webContents.debugger.emitMessage("Fetch.requestPaused", {
      requestId: "req-1",
      request: { url: "https://example.com/api/me" },
    });
    webContents.debugger.emitMessage("Fetch.requestPaused", {
      requestId: "req-2",
      request: { url: "https://example.com/other" },
    });
    await Promise.resolve();

    expect(commandsOf(webContents, "Fetch.fulfillRequest")[0]?.params).toEqual({
      requestId: "req-1",
      responseCode: 201,
      responseHeaders: [
        { name: "content-type", value: "application/json" },
        { name: "x-mock", value: "1" },
      ],
      body: Buffer.from('{"ok":true}', "utf8").toString("base64"),
    });
    // Every paused request has to be answered: an unanswered one is a page that
    // never finishes loading.
    expect(commandsOf(webContents, "Fetch.continueRequest")[0]?.params).toEqual(
      {
        requestId: "req-2",
      },
    );

    const listed = await manager.control({
      hostWindow,
      request: { tabId: "browser:a", operation: { kind: "route-list" } },
    });
    expect(listed).toMatchObject({
      ok: true,
      kind: "routes",
      routes: [{ pattern: "**/api/me", matched: 1 }],
      offline: false,
    });
  });

  it("stops intercepting when the last route is removed", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();
    const route = {
      pattern: "**/api/**",
      status: 200,
      contentType: "text/plain",
      body: "",
      headers: [],
    };

    await manager.control({
      hostWindow,
      request: { tabId: "browser:a", operation: { kind: "route-set", route } },
    });
    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "route-clear", pattern: null },
      },
    });

    // An enabled Fetch domain pauses everything until something answers it, so
    // leaving it on with no routes behind it would stall the tab.
    expect(commandsOf(webContents, "Fetch.disable")).toHaveLength(1);

    await manager.control({
      hostWindow,
      request: { tabId: "browser:a", operation: { kind: "route-set", route } },
    });
    webContents.debugger.emitMessage("Fetch.requestPaused", {
      requestId: "req-1",
      request: { url: "https://example.com/api/me" },
    });
    await Promise.resolve();

    // Turning it back on must not leave two handlers behind: the second would
    // answer a request the first already finished.
    expect(commandsOf(webContents, "Fetch.enable")).toHaveLength(2);
    expect(commandsOf(webContents, "Fetch.fulfillRequest")).toHaveLength(1);
  });

  it("forgets its routes when the debugger goes away", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: {
          kind: "route-set",
          route: {
            pattern: "**",
            status: 200,
            contentType: "text/plain",
            body: "",
            headers: [],
          },
        },
      },
    });
    // A detach is the target letting go, so the handle is gone too.
    webContents.debugger.attached = false;
    for (const listener of webContents.debugger.detachListeners) {
      listener({}, "target closed");
    }

    // Chromium drops the interception with its client, so a route table that
    // survived would describe a tab that is no longer mocked.
    await expect(
      manager.control({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "route-list" } },
      }),
    ).resolves.toMatchObject({ ok: true, routes: [], offline: false });
  });

  it("takes one tab offline without touching the session", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();

    await manager.control({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "offline", offline: true },
      },
    });

    expect(
      commandsOf(webContents, "Network.emulateNetworkConditions")[0]?.params,
    ).toMatchObject({ offline: true });
    await expect(
      manager.control({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "route-list" } },
      }),
    ).resolves.toMatchObject({ offline: true });
  });

  it("answers a route question on a blank tab but refuses to drive one", async () => {
    const { hostWindow, manager } = await attachTabForControl("");

    // Routes are set up before a page loads as often as after, so a question
    // about the tab's own state is answerable; anything that needs a page is not.
    await expect(
      manager.control({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "route-list" } },
      }),
    ).resolves.toMatchObject({ ok: true, routes: [] });
    await expect(
      manager.control({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "mouse-move", x: 1, y: 1 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });
  });

  it("says when another debugger already holds the tab", async () => {
    const { hostWindow, manager, webContents } = await attachTabForControl();
    webContents.debugger.attached = false;
    webContents.debugger.attachFailure = new Error("already attached");

    // Force a fresh attach: the snapshot in the harness left one open.
    for (const listener of webContents.debugger.detachListeners) {
      listener({}, "devtools");
    }

    await expect(
      manager.control({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "evaluate", expression: "() => 1", ref: null },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "debugger-unavailable" });
  });

  it("reports a tab with no live view", async () => {
    const { hostWindow, manager } = await attachTabForControl();

    await expect(
      manager.control({
        hostWindow,
        request: {
          tabId: "browser:missing",
          operation: { kind: "route-list" },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

describe("DesktopBrowserViewManager recording", () => {
  interface RecordHarness {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContents: ReturnType<typeof requireFakeView>["webContents"];
  }

  function attachTabForRecording(url = "https://example.com/"): RecordHarness {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 95,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    return { hostWindow, manager, webContents: requireFakeView(0).webContents };
  }

  function commandsNamed(
    webContents: RecordHarness["webContents"],
    method: string,
  ): Array<{ method: string; params?: Record<string, unknown> }> {
    return webContents.debugger.commands.filter(
      (command) => command.method === method,
    );
  }

  function sendFrame(
    webContents: RecordHarness["webContents"],
    data: string,
    at: number,
  ): void {
    vi.setSystemTime(at);
    webContents.debugger.emitMessage("Page.screencastFrame", {
      data,
      sessionId: 7,
      metadata: { timestamp: at / 1000 },
    });
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("films a tab and hands the frames back in order", async () => {
    const { hostWindow, manager, webContents } = attachTabForRecording();

    await expect(
      manager.record({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "video-start", fps: 5 },
        },
      }),
    ).resolves.toMatchObject({ ok: true, kind: "recording", active: true });
    expect(
      commandsNamed(webContents, "Page.startScreencast")[0]?.params,
    ).toMatchObject({ format: "jpeg", everyNthFrame: 1 });

    sendFrame(webContents, "one", 0);
    sendFrame(webContents, "two", 400);
    vi.setSystemTime(600);
    const stopped = await manager.record({
      hostWindow,
      request: { tabId: "browser:a", operation: { kind: "video-stop" } },
    });

    expect(commandsNamed(webContents, "Page.stopScreencast")).toHaveLength(1);
    expect(stopped).toMatchObject({
      ok: true,
      kind: "video",
      frames: [
        { at: 0, base64: "one" },
        { at: 400, base64: "two" },
      ],
      durationMs: 600,
    });
  });

  it("acknowledges every frame, including the ones it does not keep", async () => {
    const { hostWindow, manager, webContents } = attachTabForRecording();
    await manager.record({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "video-start", fps: 1 },
      },
    });

    sendFrame(webContents, "one", 0);
    sendFrame(webContents, "two", 10);
    sendFrame(webContents, "three", 20);

    // The rule that decides whether a recording is a film or a single frame:
    // Chromium sends the next frame only once the last is acknowledged, so a
    // frame dropped for pacing must still be answered.
    expect(commandsNamed(webContents, "Page.screencastFrameAck")).toHaveLength(
      3,
    );
    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({ ok: true, droppedFrames: 2 });
  });

  it("marks a chapter where it happened", async () => {
    const { hostWindow, manager } = attachTabForRecording();
    await manager.record({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "video-start", fps: 5 },
      },
    });

    vi.setSystemTime(2_000);
    await expect(
      manager.record({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "video-chapter", title: "signed in" },
        },
      }),
    ).resolves.toMatchObject({ ok: true, kind: "recording", active: true });

    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({
      ok: true,
      chapters: [{ at: 2_000, title: "signed in" }],
    });
  });

  it("refuses a second film of the same tab, and a stop with nothing to stop", async () => {
    const { hostWindow, manager } = attachTabForRecording();

    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "not-recording" });

    await manager.record({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "video-start", fps: 5 },
      },
    });

    await expect(
      manager.record({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "video-start", fps: 5 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "already-recording" });
  });

  it("wires the frame listener once, however many films it takes", async () => {
    const { hostWindow, manager, webContents } = attachTabForRecording();

    for (const at of [0, 1_000]) {
      vi.setSystemTime(at);
      await manager.record({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "video-start", fps: 5 },
        },
      });
      await manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      });
    }
    sendFrame(webContents, "one", 2_000);

    // Two listeners would answer the same frame twice, and the second answer
    // fails against a frame the first already acknowledged.
    expect(commandsNamed(webContents, "Page.screencastFrameAck")).toHaveLength(
      1,
    );
  });

  it("hands the frames back even when the stop command fails", async () => {
    const { hostWindow, manager, webContents } = attachTabForRecording();
    await manager.record({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "video-start", fps: 5 },
      },
    });
    sendFrame(webContents, "one", 0);
    webContents.debugger.failures.set(
      "Page.stopScreencast",
      new Error("target closed"),
    );

    // Losing a recording because the stop call failed is the worse trade.
    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({
      ok: true,
      kind: "video",
      frames: [{ at: 0, base64: "one" }],
    });
  });

  it("forgets the film when the debugger goes away", async () => {
    const { hostWindow, manager, webContents } = attachTabForRecording();
    await manager.record({
      hostWindow,
      request: {
        tabId: "browser:a",
        operation: { kind: "video-start", fps: 5 },
      },
    });

    webContents.debugger.attached = false;
    for (const listener of webContents.debugger.detachListeners) {
      listener({}, "target closed");
    }

    // Chromium stopped the screencast with its client, so a recording that
    // survived would answer with a film that stopped growing minutes ago.
    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:a", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "not-recording" });
  });

  it("refuses to film a tab with no page, and answers for a tab with no view", async () => {
    const { hostWindow, manager } = attachTabForRecording("");

    await expect(
      manager.record({
        hostWindow,
        request: {
          tabId: "browser:a",
          operation: { kind: "video-start", fps: 5 },
        },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });
    await expect(
      manager.record({
        hostWindow,
        request: { tabId: "browser:gone", operation: { kind: "video-stop" } },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

describe("DesktopBrowserViewManager scoped snapshots", () => {
  function attachTabForScope(url = "https://example.com/") {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 96,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    const { webContents } = requireFakeView(0);
    webContents.debugger.results.set("Accessibility.getFullAXTree", {
      nodes: [
        { nodeId: "1", role: { value: "main" }, childIds: ["2", "4"] },
        {
          nodeId: "2",
          role: { value: "form" },
          name: { value: "Checkout" },
          backendDOMNodeId: 42,
          childIds: ["3"],
        },
        {
          nodeId: "3",
          role: { value: "button" },
          name: { value: "Pay" },
          backendDOMNodeId: 43,
        },
        {
          nodeId: "4",
          role: { value: "button" },
          name: { value: "Help" },
          backendDOMNodeId: 44,
        },
      ],
    });
    webContents.debugger.results.set("DOM.getDocument", {
      root: { nodeId: 1 },
    });
    webContents.debugger.results.set("DOM.querySelector", { nodeId: 9 });
    webContents.debugger.results.set("DOM.describeNode", {
      node: { backendNodeId: 42 },
    });
    return { hostWindow, manager, webContents };
  }

  it("snapshots what the selector matched and hands out refs for it alone", async () => {
    const { hostWindow, manager, webContents } = attachTabForScope();

    const result = await manager.snapshotIn({
      hostWindow,
      request: { tabId: "browser:a", selector: "form.checkout" },
    });

    expect(webContents.debugger.commands).toContainEqual({
      method: "DOM.querySelector",
      params: { nodeId: 1, selector: "form.checkout" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      // The sibling button outside the scope is the assertion: a scoped
      // snapshot that still carried the rest of the page would be pointless.
      expect(result.snapshot).toContain('button "Pay"');
      expect(result.snapshot).not.toContain("Help");
      expect(result.refCount).toBe(1);
    }
  });

  it("acts on the element the scoped refs name, not the one they used to", async () => {
    const { hostWindow, manager } = attachTabForScope();

    const whole = await manager.snapshot({
      hostWindow,
      request: { tabId: "browser:a" },
    });
    const scoped = await manager.snapshotIn({
      hostWindow,
      request: { tabId: "browser:a", selector: "form" },
    });

    // Both snapshots call something `e1`, so the second has to invalidate the
    // first — a stale `e1` resolving silently is the failure this prevents.
    expect(whole.ok && scoped.ok).toBe(true);
    if (whole.ok && scoped.ok) {
      expect(scoped.generation).toBeGreaterThan(whole.generation);
    }
  });

  it("says the selector is the problem when the browser will not parse it", async () => {
    const { hostWindow, manager, webContents } = attachTabForScope();
    webContents.debugger.failures.set(
      "DOM.querySelector",
      new Error("DOM Error while querying"),
    );

    await expect(
      manager.snapshotIn({
        hostWindow,
        request: { tabId: "browser:a", selector: "form.." },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "invalid-selector" });
  });

  it("tells a selector that matched nothing apart from one it cannot parse", async () => {
    const { hostWindow, manager, webContents } = attachTabForScope();
    // Zero is how the protocol spells "matched nothing"; it does not fail.
    webContents.debugger.results.set("DOM.querySelector", { nodeId: 0 });

    await expect(
      manager.snapshotIn({
        hostWindow,
        request: { tabId: "browser:a", selector: "#missing" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-match" });
  });

  it("refuses an element the accessibility tree does not describe", async () => {
    const { hostWindow, manager, webContents } = attachTabForScope();
    webContents.debugger.results.set("DOM.describeNode", {
      node: { backendNodeId: 4242 },
    });

    // A hidden element is in the DOM and not in the tree. Falling back to the
    // whole page here would answer a question nobody asked.
    await expect(
      manager.snapshotIn({
        hostWindow,
        request: { tabId: "browser:a", selector: "#hidden" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-match" });
  });

  it("answers for a blank tab and a tab with no view the way the unscoped one does", async () => {
    const blank = attachTabForScope("");
    await expect(
      blank.manager.snapshotIn({
        hostWindow: blank.hostWindow,
        request: { tabId: "browser:a", selector: "#main" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });

    const live = attachTabForScope();
    await expect(
      live.manager.snapshotIn({
        hostWindow: live.hostWindow,
        request: { tabId: "browser:gone", selector: "#main" },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
  });
});

describe("DesktopBrowserViewManager full-page captures", () => {
  function attachTabForFullPage(url = "https://example.com/") {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 700, height: 450 },
      webContentsId: 97,
    });
    attachBrowserTab({ manager, hostWindow, tabId: "browser:a", url });
    const { webContents } = requireFakeView(0);
    webContents.isolatedWorldResult = { width: 1280, height: 4200 };
    webContents.debugger.results.set("Page.captureScreenshot", {
      data: Buffer.from("full-page-bytes").toString("base64"),
    });
    return { hostWindow, manager, webContents };
  }

  it("captures the measured document, at 1:1 and beyond the viewport", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.setTitle("Example");

    const result = await manager.captureFullPage({
      hostWindow,
      request: { tabId: "browser:a", format: "jpeg", quality: 70 },
    });

    // The size is measured in the page-read isolated world, not through
    // `Page.getLayoutMetrics`: that would want the `Page` domain, and enabling
    // it is what moves a tab's dialogs off Chromium's native modal.
    expect(webContents.isolatedWorldCalls.at(-1)?.scripts).toEqual([
      { code: PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT },
    ]);
    expect(webContents.debugger.commands).toContainEqual({
      method: "Page.captureScreenshot",
      params: {
        format: "jpeg",
        quality: 70,
        clip: { x: 0, y: 0, width: 1280, height: 4200, scale: 1 },
        captureBeyondViewport: true,
      },
    });
    expect(result).toEqual({
      ok: true,
      tabId: "browser:a",
      url: "https://example.com/",
      title: "Example",
      mimeType: "image/jpeg",
      base64: Buffer.from("full-page-bytes").toString("base64"),
      width: 1280,
      height: 4200,
      truncated: false,
    });
  });

  it("attaches the debugger without taking the tab's dialogs over", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();

    await manager.captureFullPage({
      hostWindow,
      request: { tabId: "browser:a", format: "jpeg", quality: 70 },
    });

    // The trade this capture makes, pinned in both directions: it does need a
    // session, and it must not enable `Page` — a picture should not cost the
    // user Chromium's own alert() modal for the rest of the session.
    expect(webContents.debugger.attachCalls).toEqual(["1.3"]);
    expect(
      webContents.debugger.commands.map((command) => command.method),
    ).not.toContain("Page.enable");
  });

  it("omits quality for PNG, which has no such knob", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();

    await manager.captureFullPage({
      hostWindow,
      request: { tabId: "browser:a", format: "png", quality: 70 },
    });

    expect(
      webContents.debugger.commands.find(
        (command) => command.method === "Page.captureScreenshot",
      )?.params,
    ).toEqual({
      format: "png",
      clip: { x: 0, y: 0, width: 1280, height: 4200, scale: 1 },
      captureBeyondViewport: true,
    });
  });

  it("clips a document past the texture limit and says it did", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.isolatedWorldResult = {
      width: 1280,
      height: PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION * 3,
    };

    const result = await manager.captureFullPage({
      hostWindow,
      request: { tabId: "browser:a", format: "jpeg", quality: 70 },
    });

    expect(result).toMatchObject({
      ok: true,
      height: PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION,
      truncated: true,
    });
  });

  it("refuses a picture past what the bridge carries rather than cutting it", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.debugger.results.set("Page.captureScreenshot", {
      data: "a".repeat(
        PATCHER_DESKTOP_BROWSER_MAX_SCREENSHOT_BASE64_LENGTH + 1,
      ),
    });

    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:a", format: "jpeg", quality: 70 },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "too-large" });
  });

  it("reports a page that will not say how large it is", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.isolatedWorldResult = "pending";

    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:a", format: "jpeg", quality: 70 },
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "failed",
      message: "The page did not answer how large it is in time.",
    });
    // Nothing was asked of Chromium: a clip built from a size nobody measured
    // is a capture of the wrong region.
    expect(
      webContents.debugger.commands.map((command) => command.method),
    ).not.toContain("Page.captureScreenshot");
  });

  it("says when DevTools has the tab, instead of quietly capturing the viewport", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.debugger.attachFailure = new Error(
      "Another debugger is attached",
    );

    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:a", format: "jpeg", quality: 70 },
      }),
    ).resolves.toMatchObject({
      ok: false,
      reason: "debugger-unavailable",
      message:
        "Could not attach the browser debugger: Another debugger is attached",
    });
  });

  it("distinguishes a tab with no view from one that has loaded nothing", async () => {
    const { hostWindow, manager } = attachTabForFullPage("");

    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:missing", format: "jpeg", quality: 70 },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-view" });
    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:a", format: "jpeg", quality: 70 },
      }),
    ).resolves.toMatchObject({ ok: false, reason: "no-page" });
  });

  it("reports a rejected capture as a refusal rather than rejecting", async () => {
    const { hostWindow, manager, webContents } = attachTabForFullPage();
    webContents.debugger.failures.set(
      "Page.captureScreenshot",
      new Error("capture failed"),
    );

    await expect(
      manager.captureFullPage({
        hostWindow,
        request: { tabId: "browser:a", format: "jpeg", quality: 70 },
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
      message: "capture failed",
    });
  });
});

describe("browser downloads", () => {
  function attachTabForDownload(): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    webContentsId: number;
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    return {
      hostWindow,
      manager,
      webContentsId: requireFakeView(0).webContents.id,
    };
  }

  // The whole point: a download is written, without the save dialog Electron
  // shows by default — which is what setting the path suppresses.
  it("saves to the downloads folder under a sanitized name", () => {
    const { hostWindow, webContentsId } = attachTabForDownload();

    const { event, item } = startFakeDownload({
      filename: "../../.ssh/authorized_keys",
      webContentsId,
    });

    expect(event.defaultPrevented).toBe(false);
    expect(item.savePath).toBe(`${TEST_DOWNLOAD_DIRECTORY}/authorized_keys`);
    expect(downloadPayloads(hostWindow)).toEqual([
      {
        id: "download-1",
        tabId: "browser:a",
        filename: "authorized_keys",
        savePath: `${TEST_DOWNLOAD_DIRECTORY}/authorized_keys`,
        url: "https://example.com/file",
        mimeType: "application/octet-stream",
        state: "started",
      },
    ]);
  });

  it("reports the outcome under the id it started with", () => {
    const { hostWindow, webContentsId } = attachTabForDownload();
    const { item } = startFakeDownload({
      filename: "report.pdf",
      webContentsId,
    });

    item.finish("completed");

    const payloads = downloadPayloads(hostWindow);
    expect(payloads.map((payload) => payload.state)).toEqual([
      "started",
      "completed",
    ]);
    // One download, one id — this is what lets the renderer replace its own
    // in-flight message rather than stacking a second one.
    expect(new Set(payloads.map((payload) => payload.id)).size).toBe(1);
  });

  it("passes a failed transfer through as its own state", () => {
    const { hostWindow, webContentsId } = attachTabForDownload();
    const { item } = startFakeDownload({ filename: "big.iso", webContentsId });

    item.finish("interrupted");

    expect(downloadPayloads(hostWindow).at(-1)?.state).toBe("interrupted");
  });

  // A page that fires downloads in a loop is farming the user's disk. The
  // refusal is reported rather than silent, because the same cap catches a
  // legitimate "download all" button.
  it("refuses past the rate limit, and says so", () => {
    const { hostWindow, webContentsId } = attachTabForDownload();

    for (let index = 0; index < 5; index += 1) {
      const { event } = startFakeDownload({
        filename: `file-${index}.txt`,
        webContentsId,
      });
      expect(event.defaultPrevented).toBe(false);
    }
    const { event, item } = startFakeDownload({
      filename: "file-6.txt",
      webContentsId,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(item.savePath).toBeNull();
    expect(downloadPayloads(hostWindow).at(-1)).toEqual({
      id: "download-6",
      tabId: "browser:a",
      filename: "file-6.txt",
      savePath: null,
      url: "https://example.com/file",
      mimeType: "application/octet-stream",
      state: "refused",
    });
  });

  // Nothing to attribute it to and nobody to tell, so it must not be written.
  it("refuses a download from a view it does not track", () => {
    const { hostWindow, webContentsId } = attachTabForDownload();

    const { event, item } = startFakeDownload({
      filename: "orphan.txt",
      webContentsId: webContentsId + 999,
    });

    expect(event.defaultPrevented).toBe(true);
    expect(item.savePath).toBeNull();
    expect(downloadPayloads(hostWindow)).toEqual([]);
  });

  it("steps around a name already on disk", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
      downloadPathExists: (path) =>
        path === `${TEST_DOWNLOAD_DIRECTORY}/report.pdf`,
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });

    const { item } = startFakeDownload({
      filename: "report.pdf",
      webContentsId: requireFakeView(0).webContents.id,
    });

    expect(item.savePath).toBe(`${TEST_DOWNLOAD_DIRECTORY}/report (1).pdf`);
  });
});

describe("browser download actions", () => {
  interface DownloadActionHarness {
    manager: DesktopBrowserViewManager;
    openCalls: string[];
    revealCalls: string[];
    savePath: string;
  }

  /** A manager that has written exactly one download. */
  function harnessWithOneDownload(openFailure = ""): DownloadActionHarness {
    const openCalls: string[] = [];
    const revealCalls: string[] = [];
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
      openDownloadPath: async (savePath) => {
        openCalls.push(savePath);
        return openFailure;
      },
      revealDownloadPath: (savePath) => {
        revealCalls.push(savePath);
      },
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    startFakeDownload({
      filename: "report.pdf",
      webContentsId: requireFakeView(0).webContents.id,
    });
    return {
      manager,
      openCalls,
      revealCalls,
      savePath: `${TEST_DOWNLOAD_DIRECTORY}/report.pdf`,
    };
  }

  it("opens a file it downloaded", async () => {
    const { manager, openCalls, savePath } = harnessWithOneDownload();

    await expect(
      manager.downloadAction({ action: "open", savePath }),
    ).resolves.toEqual({ ok: true });
    expect(openCalls).toEqual([savePath]);
  });

  it("shows a file it downloaded in the file manager", async () => {
    const { manager, revealCalls, savePath } = harnessWithOneDownload();

    await expect(
      manager.downloadAction({ action: "reveal", savePath }),
    ).resolves.toEqual({ ok: true });
    expect(revealCalls).toEqual([savePath]);
  });

  // The property the whole design rests on: without it this is "open any file
  // on this machine", reachable from the renderer.
  it("refuses a path it did not write, and touches nothing", async () => {
    const { manager, openCalls, revealCalls } = harnessWithOneDownload();

    await expect(
      manager.downloadAction({
        action: "open",
        savePath: "/Users/someone/.ssh/id_rsa",
      }),
    ).resolves.toEqual({
      ok: false,
      reason: "unknown-path",
      message: "Patcher did not download that file.",
    });
    // Even a path inside the downloads folder is refused unless Patcher wrote it.
    await expect(
      manager.downloadAction({
        action: "reveal",
        savePath: `${TEST_DOWNLOAD_DIRECTORY}/someone-elses.pdf`,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "unknown-path" });
    expect(openCalls).toEqual([]);
    expect(revealCalls).toEqual([]);
  });

  // The realistic failure: the user moved or deleted the file afterwards.
  // Electron reports that as a non-empty string rather than by rejecting.
  it("passes the OS refusal through as a failure", async () => {
    const { manager, savePath } = harnessWithOneDownload("No such file");

    await expect(
      manager.downloadAction({ action: "open", savePath }),
    ).resolves.toEqual({
      ok: false,
      reason: "failed",
      message: "No such file",
    });
  });
});

describe("browser chrome overlay", () => {
  function attachVisibleTab(): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    const view = requireFakeView(0);
    expect(view.visible).toBe(true);
    return { hostWindow, manager, view };
  }

  function snapshotPayloads(hostWindow: FakeHostWindow): unknown[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) =>
          message.channel === PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
      )
      .map((message) => message.payload);
  }

  // The ordering is the feature: hiding first would flash an empty panel where
  // the page was, which a menu the user opened cannot afford.
  it("captures the page before hiding it", async () => {
    const { hostWindow, manager, view } = attachVisibleTab();

    manager.setOverlay({
      hostWindow,
      request: { tabId: "browser:a", active: true },
    });

    // Still showing the live page while the capture is in flight.
    expect(view.visible).toBe(true);

    await settlePendingCaptures(view);

    expect(view.visible).toBe(false);
    expect(snapshotPayloads(hostWindow).at(-1)).toMatchObject({
      tabId: "browser:a",
    });
  });

  it("reveals the page and drops the placeholder when the overlay closes", async () => {
    const { hostWindow, manager, view } = attachVisibleTab();
    manager.setOverlay({
      hostWindow,
      request: { tabId: "browser:a", active: true },
    });
    await settlePendingCaptures(view);

    manager.setOverlay({
      hostWindow,
      request: { tabId: "browser:a", active: false },
    });

    expect(view.visible).toBe(true);
    // Revealed first, then the placeholder cleared, so the swap never flashes.
    expect(snapshotPayloads(hostWindow).at(-1)).toEqual({
      tabId: "browser:a",
      dataUrl: null,
    });
  });

  // A capture that never arrives must not leave a live page under a panel that
  // is already drawn over it.
  it("hides the page even when the capture fails", async () => {
    const { hostWindow, manager, view } = attachVisibleTab();

    manager.setOverlay({
      hostWindow,
      request: { tabId: "browser:a", active: true },
    });
    for (const reject of view.webContents.pendingCaptureRejecters.splice(0)) {
      reject(new Error("capture failed"));
    }
    await Promise.resolve();
    await Promise.resolve();

    expect(view.visible).toBe(false);
  });
});

describe("find in page", () => {
  function attachVisibleTab(): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    return { hostWindow, manager, view: requireFakeView(0) };
  }

  function findResults(hostWindow: FakeHostWindow): unknown[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) =>
          message.channel === PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
      )
      .map((message) => message.payload);
  }

  it("starts a session for a query and steps through it without restarting", () => {
    const { hostWindow, manager, view } = attachVisibleTab();

    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "start", query: "needle" },
    });
    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "next", query: "needle" },
    });
    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "previous", query: "needle" },
    });

    expect(view.webContents.findInPageCalls).toEqual([
      { text: "needle", options: { findNext: true, forward: true } },
      { text: "needle", options: { findNext: false, forward: true } },
      { text: "needle", options: { findNext: false, forward: false } },
    ]);
  });

  // A step with nothing running behind it is a search, not a no-op: the first
  // Enter after a navigation ended the session has to find something.
  it("treats a step with no session as a new search", () => {
    const { hostWindow, manager, view } = attachVisibleTab();

    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "next", query: "needle" },
    });

    expect(view.webContents.findInPageCalls).toEqual([
      { text: "needle", options: { findNext: true, forward: true } },
    ]);
  });

  it("pushes the count for the running query", () => {
    const { hostWindow, manager, view } = attachVisibleTab();
    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "start", query: "needle" },
    });

    view.webContents.emitFoundInPage({
      requestId: 1,
      activeMatchOrdinal: 1,
      matches: 3,
      finalUpdate: false,
    });
    view.webContents.emitFoundInPage({
      requestId: 1,
      activeMatchOrdinal: 1,
      matches: 12,
      finalUpdate: true,
    });

    expect(findResults(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        activeMatchOrdinal: 1,
        matches: 3,
        finalUpdate: false,
      },
      {
        tabId: "browser:a",
        activeMatchOrdinal: 1,
        matches: 12,
        finalUpdate: true,
      },
    ]);
  });

  // The user typed another character; the old query keeps answering. Its count
  // must never land on the new one.
  it("drops results belonging to a superseded query", () => {
    const { hostWindow, manager, view } = attachVisibleTab();
    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "start", query: "need" },
    });
    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "start", query: "needle" },
    });

    view.webContents.emitFoundInPage({
      requestId: 1,
      activeMatchOrdinal: 4,
      matches: 40,
      finalUpdate: true,
    });
    view.webContents.emitFoundInPage({
      requestId: 2,
      activeMatchOrdinal: 1,
      matches: 2,
      finalUpdate: true,
    });

    expect(findResults(hostWindow)).toEqual([
      {
        tabId: "browser:a",
        activeMatchOrdinal: 1,
        matches: 2,
        finalUpdate: true,
      },
    ]);
  });

  it("ends the session and hands the keyboard back on stop", () => {
    const { hostWindow, manager, view } = attachVisibleTab();
    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "start", query: "needle" },
    });
    const focusCallsBefore = view.webContents.focusCalls;

    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "stop", query: "" },
    });

    expect(view.webContents.stopFindInPageCalls).toEqual(["clearSelection"]);
    expect(view.webContents.focusCalls).toBe(focusCallsBefore + 1);
  });

  // Clearing the field is "stop searching", not "search for nothing" —
  // Chromium's own find refuses an empty string.
  it("reads an empty query as the end of the session", () => {
    const { hostWindow, manager, view } = attachVisibleTab();
    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "start", query: "needle" },
    });

    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "start", query: "" },
    });

    expect(view.webContents.findInPageCalls).toHaveLength(1);
    expect(view.webContents.stopFindInPageCalls).toEqual(["clearSelection"]);
  });

  // A new document ends Chromium's session with it, so a straggling result from
  // the old page must not be pushed as if it described the new one.
  it("forgets the session when the tab navigates", () => {
    const { hostWindow, manager, view } = attachVisibleTab();
    manager.find({
      hostWindow,
      request: { tabId: "browser:a", action: "start", query: "needle" },
    });

    view.webContents.emitDidNavigate("https://example.com/next");
    view.webContents.emitFoundInPage({
      requestId: 1,
      activeMatchOrdinal: 1,
      matches: 9,
      finalUpdate: true,
    });

    expect(findResults(hostWindow)).toEqual([]);
  });
});

describe("questions the network asks", () => {
  function attachVisibleTab(): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    return { hostWindow, manager, view: requireFakeView(0) };
  }

  function promptPushes(hostWindow: FakeHostWindow): unknown[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) =>
          message.channel === PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
      )
      .map((message) => message.payload);
  }

  function pageSecurityPushes(hostWindow: FakeHostWindow): unknown[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) =>
          message.channel === PATCHER_DESKTOP_BROWSER_PAGE_SECURITY_CHANNEL,
      )
      .map((message) => message.payload);
  }

  function openPrompt(hostWindow: FakeHostWindow): { id: string } | null {
    const pushed = promptPushes(hostWindow).at(-1) as
      | { prompt: { id: string } | null }
      | undefined;
    return pushed?.prompt ?? null;
  }

  describe("basic auth", () => {
    // The dead end this closes: Electron cancels every challenge on its own, so
    // the page simply failed with nothing said.
    it("asks, and hands over what the user typed", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();

      const login = view.webContents.emitLogin({
        isRequestForNavigation: true,
      });
      expect(login.called).toBe(false);
      expect(promptPushes(hostWindow).at(-1)).toMatchObject({
        tabId: "browser:a",
        prompt: { kind: "auth", host: "example.com", insecure: false },
      });

      const prompt = openPrompt(hostWindow);
      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: prompt?.id ?? "",
          answer: { kind: "credentials", username: "ada", password: "hunter2" },
        },
      });

      expect(login.credentials).toEqual(["ada", "hunter2"]);
    });

    it("cancels the request when the user declines", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      const login = view.webContents.emitLogin({
        isRequestForNavigation: true,
      });

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "cancel" },
        },
      });

      // Electron reads "no username" as a cancel, which is what a declined
      // prompt has to mean.
      expect(login.called).toBe(true);
      expect(login.credentials).toBeNull();
    });

    // The phishing shape: any page can embed an image from an attacker's server
    // and have it answer 401, putting a password box over someone else's site.
    it("refuses a cross-origin subresource without asking", () => {
      const { hostWindow, view } = attachVisibleTab();

      const login = view.webContents.emitLogin({
        isRequestForNavigation: false,
        url: "https://cdn.evil.test/pixel.png",
        authInfo: { host: "cdn.evil.test" },
      });

      expect(login.called).toBe(true);
      expect(login.credentials).toBeNull();
      expect(promptPushes(hostWindow)).toEqual([]);
    });

    it("asks for the page's own subresources", () => {
      const { hostWindow, view } = attachVisibleTab();

      view.webContents.emitLogin({
        isRequestForNavigation: false,
        url: "https://example.com/assets/app.css",
      });

      expect(openPrompt(hostWindow)).toMatchObject({ kind: "auth" });
    });

    it("refuses a proxy challenge outright", () => {
      const { hostWindow, view } = attachVisibleTab();

      const login = view.webContents.emitLogin({
        isRequestForNavigation: true,
        authInfo: { isProxy: true },
      });

      expect(login.called).toBe(true);
      expect(promptPushes(hostWindow)).toEqual([]);
    });

    // A protected directory challenges once per request; one password answers
    // the page, its stylesheet and its images together.
    it("settles every request for the same realm with one answer", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      const first = view.webContents.emitLogin({
        isRequestForNavigation: true,
      });
      const second = view.webContents.emitLogin({
        isRequestForNavigation: false,
        url: "https://example.com/style.css",
      });

      // Only one question was asked.
      expect(
        promptPushes(hostWindow).filter(
          (push) => (push as { prompt: unknown }).prompt !== null,
        ),
      ).toHaveLength(1);

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "credentials", username: "ada", password: "hunter2" },
        },
      });

      expect(first.credentials).toEqual(["ada", "hunter2"]);
      expect(second.credentials).toEqual(["ada", "hunter2"]);
    });

    it("says so when the credentials would go in the clear", () => {
      const { hostWindow, view } = attachVisibleTab();

      view.webContents.emitLogin({
        isRequestForNavigation: true,
        url: "http://example.com/private",
        authInfo: { port: 80 },
      });

      expect(openPrompt(hostWindow)).toMatchObject({ insecure: true });
    });
  });

  describe("certificate errors", () => {
    it("asks about the page's own certificate and proceeds when told to", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();

      const first = view.webContents.emitCertificateError({});
      expect(first.trusted).toBeNull();
      expect(openPrompt(hostWindow)).toMatchObject({
        kind: "certificate",
        host: "example.com",
        errorCode: "net::ERR_CERT_AUTHORITY_INVALID",
        issuerName: "Test CA",
      });

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });

      expect(first.trusted).toBe(true);
    });

    // Accepting once is accepting for the session — otherwise every subresource
    // on a dev box with a self-signed certificate is another dialog.
    it("remembers an accepted certificate for the same host", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      view.webContents.emitCertificateError({});
      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });

      const again = view.webContents.emitCertificateError({
        isMainFrame: false,
      });

      expect(again.trusted).toBe(true);
    });

    // A different certificate from the same host is a different decision.
    it("asks again when the certificate changes", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      view.webContents.emitCertificateError({});
      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });

      const swapped = view.webContents.emitCertificateError({
        certificate: { fingerprint: "sha256/BBBB" },
      });

      expect(swapped.trusted).toBeNull();
      expect(openPrompt(hostWindow)).toMatchObject({
        fingerprint: "sha256/BBBB",
      });
    });

    // A user cannot judge a subresource they cannot see.
    it("refuses a subresource's bad certificate without asking", () => {
      const { hostWindow, view } = attachVisibleTab();

      const result = view.webContents.emitCertificateError({
        isMainFrame: false,
      });

      expect(result.trusted).toBe(false);
      expect(promptPushes(hostWindow)).toEqual([]);
    });
  });

  describe("client certificates", () => {
    // Electron's default hands over the first certificate in the store, which
    // is a credential chosen for the user by position.
    it("asks which certificate to present", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      const list = [
        {
          fingerprint: "a",
          issuerName: "Corp CA",
          subjectName: "ada@corp",
          validExpiry: 1_800_000_000,
          validStart: 1_700_000_000,
        },
        {
          fingerprint: "b",
          issuerName: "Corp CA",
          subjectName: "ada@other",
          validExpiry: 1_800_000_000,
          validStart: 1_700_000_000,
        },
      ];

      const selection = view.webContents.emitSelectClientCertificate(list);
      expect(selection.called).toBe(false);
      expect(openPrompt(hostWindow)).toMatchObject({
        kind: "client-certificate",
        certificates: [
          { index: 0, subjectName: "ada@corp" },
          { index: 1, subjectName: "ada@other" },
        ],
      });

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "client-certificate", index: 1 },
        },
      });

      expect(selection.chosen).toBe(list[1]);
    });
  });

  describe("answering", () => {
    it("hides the page while a question is open and reveals it after", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      expect(view.visible).toBe(true);

      view.webContents.emitLogin({ isRequestForNavigation: true });
      expect(view.visible).toBe(false);

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "cancel" },
        },
      });

      expect(view.visible).toBe(true);
      expect(promptPushes(hostWindow).at(-1)).toEqual({
        tabId: "browser:a",
        prompt: null,
      });
    });

    // A human can be typing while the tab moves on; the answer they finish is
    // for a question that is no longer being asked.
    it("drops an answer that names a prompt that is gone", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      view.webContents.emitLogin({ isRequestForNavigation: true });

      await expect(
        manager.respondToPagePrompt({
          hostWindow,
          request: {
            tabId: "browser:a",
            id: "page-prompt-999",
            answer: { kind: "cancel" },
          },
        }),
      ).resolves.toBe(false);
      expect(view.visible).toBe(false);
    });

    // The shapes differ because the decisions do: "proceed" is about a
    // certificate and must never turn into a login.
    it("treats an answer of the wrong shape as a refusal", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      const login = view.webContents.emitLogin({
        isRequestForNavigation: true,
      });

      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });

      expect(login.credentials).toBeNull();
      expect(login.called).toBe(true);
    });

    // The padlock's whole reason to exist: a page under a certificate the user
    // waved through is encrypted and unverified, and the renderer cannot tell —
    // it never sees the error, and the exception applies to every later tab on
    // the same host without asking again.
    it("reports a hand-trusted certificate to the renderer on the next navigation", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();

      view.webContents.emitDidNavigate("https://example.com/");
      expect(pageSecurityPushes(hostWindow).at(-1)).toEqual({
        tabId: "browser:a",
        certificateTrustedByUser: false,
      });

      view.webContents.emitCertificateError({});
      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });
      view.webContents.emitDidNavigate("https://example.com/");

      expect(pageSecurityPushes(hostWindow).at(-1)).toEqual({
        tabId: "browser:a",
        certificateTrustedByUser: true,
      });
    });

    // The exception is the host's, not the page's, so leaving it clears the claim.
    it("stops reporting it once the tab leaves that host", async () => {
      const { hostWindow, manager, view } = attachVisibleTab();
      view.webContents.emitCertificateError({});
      await manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: "browser:a",
          id: openPrompt(hostWindow)?.id ?? "",
          answer: { kind: "proceed" },
        },
      });

      view.webContents.emitDidNavigate("https://other.test/");

      expect(pageSecurityPushes(hostWindow).at(-1)).toEqual({
        tabId: "browser:a",
        certificateTrustedByUser: false,
      });
    });

    it("refuses a second question while one is open", () => {
      const { hostWindow, view } = attachVisibleTab();
      view.webContents.emitLogin({ isRequestForNavigation: true });

      const certificate = view.webContents.emitCertificateError({});

      expect(certificate.trusted).toBe(false);
      expect(
        promptPushes(hostWindow).filter(
          (push) => (push as { prompt: unknown }).prompt !== null,
        ),
      ).toHaveLength(1);
    });
  });
});

describe("fullscreen", () => {
  function attachVisibleTab(): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    return { hostWindow, manager, view: requireFakeView(0) };
  }

  const FULL_WINDOW = { x: 0, y: 0, width: 900, height: 600 };
  const PANEL = { x: 100, y: 50, width: 500, height: 350 };

  // Electron's default for HTML fullscreen is to put the whole app window into
  // the OS's fullscreen. The page asked for a big video, not for the user's
  // window state, so the view expands instead.
  it("does not let a page resize the window", () => {
    const { view } = attachVisibleTab();

    expect(view.options.webPreferences).toMatchObject({
      disableHtmlFullscreenWindowResize: true,
    });
  });

  it("gives a page that asked for fullscreen the whole window, and takes it back", () => {
    const { view } = attachVisibleTab();

    view.webContents.emitHtmlFullScreen(true);
    expect(view.boundsCalls.at(-1)).toEqual(FULL_WINDOW);

    view.webContents.emitHtmlFullScreen(false);
    expect(view.boundsCalls.at(-1)).toEqual(PANEL);
  });

  // What a video's fullscreen button does in Chromium: the window goes to the
  // OS's full screen too, and comes back when the video leaves it.
  it("takes the window to the OS's full screen with the page", () => {
    const { hostWindow, view } = attachVisibleTab();

    view.webContents.emitHtmlFullScreen(true);
    expect(hostWindow.fullScreenCalls).toEqual([true]);

    view.webContents.emitHtmlFullScreen(false);
    expect(hostWindow.fullScreenCalls).toEqual([true, false]);
  });

  // The user put the window there; a video ending is not a reason to drop them
  // out of it.
  it("leaves a window the user had already made full screen alone", () => {
    const { hostWindow, view } = attachVisibleTab();
    hostWindow.fullScreen = true;

    view.webContents.emitHtmlFullScreen(true);
    view.webContents.emitHtmlFullScreen(false);

    expect(hostWindow.fullScreenCalls).toEqual([]);
    expect(hostWindow.fullScreen).toBe(true);
  });

  it("gives the window back when the tab closes mid-video", () => {
    const { hostWindow, manager, view } = attachVisibleTab();
    view.webContents.emitHtmlFullScreen(true);

    manager.detach({ hostWindow, tabId: "browser:a" });

    expect(hostWindow.fullScreenCalls).toEqual([true, false]);
  });

  // The user's own Cmd+Shift+F is gated on the window already being full
  // screen, so it has no business moving the window.
  it("never moves the window for the user's own request", () => {
    const { hostWindow, manager } = attachVisibleTab();
    hostWindow.fullScreen = true;

    manager.setFullscreen({
      hostWindow,
      request: { tabId: "browser:a", fullscreen: true },
    });
    manager.setFullscreen({
      hostWindow,
      request: { tabId: "browser:a", fullscreen: false },
    });

    expect(hostWindow.fullScreenCalls).toEqual([]);
  });

  // The renderer keeps measuring and pushing its panel rect while a video is
  // fullscreen; none of it may shrink the view back.
  it("ignores the renderer's rect while fullscreen", () => {
    const { hostWindow, manager, view } = attachVisibleTab();
    view.webContents.emitHtmlFullScreen(true);

    manager.setBounds({
      hostWindow,
      request: {
        tabId: "browser:a",
        bounds: { x: 10, y: 10, width: 20, height: 20 },
      },
    });

    expect(view.boundsCalls.at(-1)).toEqual(FULL_WINDOW);
    // ...and the rect it pushed is what the page comes back to.
    view.webContents.emitHtmlFullScreen(false);
    expect(view.boundsCalls.at(-1)).toEqual({
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    });
  });

  it("expands for the user's own request too", () => {
    const { hostWindow, manager, view } = attachVisibleTab();

    manager.setFullscreen({
      hostWindow,
      request: { tabId: "browser:a", fullscreen: true },
    });
    expect(view.boundsCalls.at(-1)).toEqual(FULL_WINDOW);

    manager.setFullscreen({
      hostWindow,
      request: { tabId: "browser:a", fullscreen: false },
    });
    expect(view.boundsCalls.at(-1)).toEqual(PANEL);
  });

  // Two different decisions: a video leaving its own fullscreen must not undo
  // the one the user asked for.
  it("keeps the user's fullscreen when the page leaves its own", () => {
    const { hostWindow, manager, view } = attachVisibleTab();
    manager.setFullscreen({
      hostWindow,
      request: { tabId: "browser:a", fullscreen: true },
    });

    view.webContents.emitHtmlFullScreen(true);
    view.webContents.emitHtmlFullScreen(false);

    expect(view.boundsCalls.at(-1)).toEqual(FULL_WINDOW);
  });
});

describe("developer tools", () => {
  const PANEL = { x: 0, y: 300, width: 900, height: 300 };

  function attachTab(): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    return { hostWindow, manager, view: requireFakeView(0) };
  }

  function devToolsPushes(hostWindow: FakeHostWindow): unknown[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) =>
          message.channel === PATCHER_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL,
      )
      .map((message) => message.payload);
  }

  // The point of the whole item: what opens is Chromium's own DevTools, drawn
  // into a view we own, rather than a panel that imitates them.
  it("points Chromium's own DevTools at a view of ours", () => {
    const { hostWindow, manager, view } = attachTab();

    manager.setDevTools({
      hostWindow,
      request: { tabId: "browser:a", open: true, bounds: PANEL },
    });

    const devToolsView = requireFakeView(1);
    expect(view.webContents.devToolsHost).toBe(devToolsView.webContents);
    // Detached, because the host is ours: without it Chromium would dock the
    // tools into a window of its own choosing.
    expect(view.webContents.openDevToolsCalls).toEqual([{ mode: "detach" }]);
    expect(devToolsView.boundsCalls.at(-1)).toEqual(PANEL);
    expect(hostWindow.contentView.addedViews).toContain(devToolsView);
    expect(devToolsPushes(hostWindow)).toEqual([
      { tabId: "browser:a", open: true },
    ]);
  });

  // The same call opens and places, so a resize is a re-send.
  it("moves the panel without opening a second one", () => {
    const { hostWindow, manager } = attachTab();
    manager.setDevTools({
      hostWindow,
      request: { tabId: "browser:a", open: true, bounds: PANEL },
    });

    manager.setDevTools({
      hostWindow,
      request: {
        tabId: "browser:a",
        open: true,
        bounds: { x: 0, y: 400, width: 900, height: 200 },
      },
    });

    expect(electronMock.fakeViews).toHaveLength(2);
    expect(requireFakeView(1).boundsCalls.at(-1)).toEqual({
      x: 0,
      y: 400,
      width: 900,
      height: 200,
    });
  });

  it("closes them, and takes the view with them", () => {
    const { hostWindow, manager, view } = attachTab();
    manager.setDevTools({
      hostWindow,
      request: { tabId: "browser:a", open: true, bounds: PANEL },
    });
    const devToolsView = requireFakeView(1);

    manager.setDevTools({
      hostWindow,
      request: { tabId: "browser:a", open: false, bounds: PANEL },
    });

    expect(view.webContents.closeDevToolsCalls).toBe(1);
    expect(hostWindow.contentView.removedViews).toContain(devToolsView);
    expect(devToolsPushes(hostWindow).at(-1)).toEqual({
      tabId: "browser:a",
      open: false,
    });
  });

  // The tools have their own close button, and the renderer owns the space they
  // are drawn in — so it has to hear about it.
  it("reports the tools closing themselves", () => {
    const { hostWindow, manager, view } = attachTab();
    manager.setDevTools({
      hostWindow,
      request: { tabId: "browser:a", open: true, bounds: PANEL },
    });

    view.webContents.emitDevToolsClosed();

    expect(devToolsPushes(hostWindow).at(-1)).toEqual({
      tabId: "browser:a",
      open: false,
    });
  });

  // It is a native view like the page's, so anything that hides one has to hide
  // the other or it composites over the app's own chrome.
  it("hides the panel with the page it belongs to", () => {
    const { hostWindow, manager } = attachTab();
    manager.setDevTools({
      hostWindow,
      request: { tabId: "browser:a", open: true, bounds: PANEL },
    });
    const devToolsView = requireFakeView(1);
    expect(devToolsView.visible).toBe(true);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: false },
    });

    expect(devToolsView.visible).toBe(false);
  });

  // The page goes away for reasons that leave the panel where it is — chief
  // among them a failed load, where the app draws "page unavailable" in the
  // page's rect. Chromium keeps DevTools usable then, and a failed load is
  // exactly when they are worth having.
  it("keeps the panel up when the page hides but the panel is still on screen", () => {
    const { hostWindow, manager } = attachTab();
    manager.setDevTools({
      hostWindow,
      request: { tabId: "browser:a", open: true, bounds: PANEL },
    });
    manager.setDevToolsVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    const devToolsView = requireFakeView(1);

    manager.setVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: false },
    });

    expect(devToolsView.visible).toBe(true);
  });

  it("hides it once the app says the panel has gone", () => {
    const { hostWindow, manager } = attachTab();
    manager.setDevTools({
      hostWindow,
      request: { tabId: "browser:a", open: true, bounds: PANEL },
    });
    manager.setDevToolsVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    const devToolsView = requireFakeView(1);

    manager.setDevToolsVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: false },
    });

    expect(devToolsView.visible).toBe(false);
  });

  // An overlay is a dropdown the app draws over the page area, and it can reach
  // down over this panel too — so that reason still hides both views.
  it("still hides it under an overlay the app draws", async () => {
    const { hostWindow, manager, view } = attachTab();
    manager.setDevTools({
      hostWindow,
      request: { tabId: "browser:a", open: true, bounds: PANEL },
    });
    manager.setDevToolsVisible({
      hostWindow,
      request: { tabId: "browser:a", visible: true },
    });
    const devToolsView = requireFakeView(1);

    manager.setOverlay({
      hostWindow,
      request: { tabId: "browser:a", active: true },
    });
    // The overlay path captures a placeholder before hiding, so the hide lands
    // a tick later than the request.
    await settlePendingCaptures(view);

    expect(devToolsView.visible).toBe(false);
  });

  it("tears the panel down with its tab", () => {
    const { hostWindow, manager, view } = attachTab();
    manager.setDevTools({
      hostWindow,
      request: { tabId: "browser:a", open: true, bounds: PANEL },
    });

    manager.detach({ hostWindow, tabId: "browser:a" });

    expect(view.webContents.closeDevToolsCalls).toBe(1);
    expect(hostWindow.contentView.removedViews).toContain(requireFakeView(1));
  });
});

describe("real popups", () => {
  const OPENER = "browser:a";

  function attachOpener(options: { claimsPopups: boolean }): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: OPENER,
      url: "https://example.com/",
    });
    if (options.claimsPopups) {
      manager.setPopupTabs({ hostWindow, request: { tabIds: [OPENER] } });
    }
    return { hostWindow, manager, view: requireFakeView(0) };
  }

  function popupPushes(hostWindow: FakeHostWindow): unknown[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) => message.channel === PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL,
      )
      .map((message) => message.payload);
  }

  /** Open a popup the way Chromium does: ask, then build the window. */
  function openPopup(
    view: (typeof electronMock.fakeViews)[number],
    url: string,
    options: { webContents?: unknown } = {},
  ): { contents: unknown; decision: { action: string } } {
    const decision = view.webContents.emitWindowOpen(url);
    const contents = decision.createWindow?.({
      webPreferences: { sandbox: true },
      ...options,
    });
    return { contents, decision };
  }

  // The whole point: `window.open()` returns a handle and the popup has a live
  // opener, which is what an OAuth flow talks to.
  it("lets a claimed tab open a real window, and names the tab for it", () => {
    const { hostWindow, view } = attachOpener({ claimsPopups: true });

    const { decision } = openPopup(view, "https://accounts.example.com/oauth");

    expect(decision).toMatchObject({ action: "allow", outlivesOpener: false });
    expect(popupPushes(hostWindow)).toEqual([
      {
        kind: "opened",
        openerTabId: OPENER,
        tabId: "browser-popup:1",
        url: "https://accounts.example.com/oauth",
      },
    ]);
  });

  // The load-bearing line: Chromium already made the popup's webContents, and
  // building a fresh one instead would produce a window with no opener that
  // looks exactly the same.
  it("adopts the webContents Electron passed rather than making one", () => {
    const { view } = attachOpener({ claimsPopups: true });
    const guest = electronMock.createFakeWebContents();

    const { contents } = openPopup(view, "https://accounts.example.com/oauth", {
      webContents: guest,
    });

    expect(contents).toBe(guest);
  });

  // The shape half the OAuth SDKs use: open a blank window, then write into it.
  it("allows about:blank for a claimed tab", () => {
    const { hostWindow, view } = attachOpener({ claimsPopups: true });

    const { decision } = openPopup(view, "about:blank");

    expect(decision.action).toBe("allow");
    expect(popupPushes(hostWindow).at(-1)).toMatchObject({
      url: "about:blank",
    });
  });

  it("still refuses what the popup policy always refused", () => {
    const { hostWindow, view } = attachOpener({ claimsPopups: true });

    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "http://127.0.0.1:38986/",
    ]) {
      expect(view.webContents.emitWindowOpen(url).action).toBe("deny");
    }
    expect(popupPushes(hostWindow)).toEqual([]);
  });

  // A surface that has not claimed popups keeps the older behaviour, because a
  // thread panel may send the link to the system browser instead.
  it("denies and pushes a plain tab for an unclaimed tab", () => {
    const { hostWindow, view } = attachOpener({ claimsPopups: false });

    const decision = view.webContents.emitWindowOpen(
      "https://example.com/docs",
    );

    expect(decision).toEqual({ action: "deny" });
    expect(popupPushes(hostWindow)).toEqual([]);
    expect(hostWindow.webContents.sentPayloads).toContainEqual({
      tabId: OPENER,
      url: "https://example.com/docs",
    });
  });

  it("stops claiming a tab the renderer dropped", () => {
    const { hostWindow, manager, view } = attachOpener({ claimsPopups: true });

    manager.setPopupTabs({ hostWindow, request: { tabIds: [] } });

    expect(
      view.webContents.emitWindowOpen("https://accounts.example.com/oauth")
        .action,
    ).toBe("deny");
  });

  // A page churning popups is a page churning popups, opener or not.
  it("holds real popups to the same rate limit", () => {
    const { view } = attachOpener({ claimsPopups: true });

    const actions: string[] = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      actions.push(
        view.webContents.emitWindowOpen(`https://example.com/${attempt}`)
          .action,
      );
    }

    expect(actions).toContain("allow");
    expect(actions.at(-1)).toBe("deny");
  });

  // The popup arrived with its page. Loading the tab's URL into it would
  // navigate away from the flow it was opened for.
  it("places an adopted popup without loading into it", () => {
    const { hostWindow, manager, view } = attachOpener({ claimsPopups: true });
    openPopup(view, "https://accounts.example.com/oauth");
    const popupView = requireFakeView(1);

    manager.attach({
      hostWindow,
      request: {
        tabId: "browser-popup:1",
        url: "https://accounts.example.com/oauth",
        bounds: { x: 0, y: 0, width: 400, height: 300 },
        visible: true,
      },
    });

    expect(popupView.webContents.loadURLCalls).toEqual([]);
    expect(popupView.visible).toBe(true);
    expect(popupView.boundsCalls.at(-1)).toEqual({
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
  });

  // How every OAuth flow ends. Only the shell sees it, so only the shell can
  // say the tab is gone.
  it("reports a popup that closed itself", () => {
    const { hostWindow, view } = attachOpener({ claimsPopups: true });
    openPopup(view, "https://accounts.example.com/oauth");

    requireFakeView(1).webContents.emitDestroyed();

    expect(popupPushes(hostWindow).at(-1)).toEqual({
      kind: "closed",
      tabId: "browser-popup:1",
    });
  });

  // The renderer closing a tab is not news to the renderer.
  it("says nothing when the renderer closes the tab itself", () => {
    const { hostWindow, manager, view } = attachOpener({ claimsPopups: true });
    openPopup(view, "https://accounts.example.com/oauth");

    manager.detach({ hostWindow, tabId: "browser-popup:1" });
    requireFakeView(1).webContents.emitDestroyed();

    expect(popupPushes(hostWindow).filter((push) => push !== null)).toEqual([
      {
        kind: "opened",
        openerTabId: OPENER,
        tabId: "browser-popup:1",
        url: "https://accounts.example.com/oauth",
      },
    ]);
  });
});

describe("PDF", () => {
  // One webPreferences flag decides whether a whole class of link works, and a
  // later edit could flip it without anything failing loudly: `plugins` is what
  // loads Chromium's PDF viewer, and without it a PDF link is not a page but a
  // download — Chromium's fallback for a document it cannot display.
  it("keeps Chromium's PDF viewer enabled", () => {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    attachBrowserTab({
      hostWindow: new FakeHostWindow({
        contentBounds: { width: 900, height: 600 },
        webContentsId: 1,
      }),
      manager,
      tabId: "browser:a",
      url: "https://example.com/paper.pdf",
    });

    expect(requireFakeView(0).options.webPreferences).toMatchObject({
      plugins: true,
    });
  });
});

describe("a page that stops answering", () => {
  function attachTab(): {
    hostWindow: FakeHostWindow;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/",
    });
    return { hostWindow, view: requireFakeView(0) };
  }

  function lastErrorText(hostWindow: FakeHostWindow): string | null {
    const states = hostWindow.webContents.sentPayloads.filter(
      (payload): payload is typeof payload & { errorText: string | null } =>
        "errorText" in payload,
    );
    return states.at(-1)?.errorText ?? null;
  }

  // The dead end: a crashed renderer leaves a blank view with no error screen
  // and nothing to click.
  it("reports a crash through the error screen that already exists", () => {
    const { hostWindow, view } = attachTab();

    view.webContents.emitRenderProcessGone("crashed");

    expect(lastErrorText(hostWindow)).toBe("This page crashed.");
  });

  it("names running out of memory as itself", () => {
    const { hostWindow, view } = attachTab();

    view.webContents.emitRenderProcessGone("oom");

    expect(lastErrorText(hostWindow)).toBe("This page ran out of memory.");
  });

  // A renderer that exited cleanly is a tab being torn down, not a failure.
  it("says nothing about a clean exit", () => {
    const { hostWindow, view } = attachTab();

    view.webContents.emitRenderProcessGone("clean-exit");

    expect(lastErrorText(hostWindow)).toBeNull();
  });

  it("reports a hang, and takes it back when the page recovers", () => {
    const { hostWindow, view } = attachTab();

    view.webContents.emitResponsiveness(false);
    expect(lastErrorText(hostWindow)).toBe("This page is not responding.");

    view.webContents.emitResponsiveness(true);
    expect(lastErrorText(hostWindow)).toBeNull();
  });

  // Recovering from a hang must not clear a load error the page had underneath.
  it("leaves a real load error alone", () => {
    const { hostWindow, view } = attachTab();
    view.webContents.emitDidFailLoad({
      errorCode: -105,
      errorDescription: "ERR_NAME_NOT_RESOLVED",
      isMainFrame: true,
      validatedURL: "https://example.com/",
    });

    view.webContents.emitResponsiveness(true);

    expect(lastErrorText(hostWindow)).toBe("ERR_NAME_NOT_RESOLVED");
  });
});

describe("plugin page styles", () => {
  const GITHUB_STYLE = {
    pluginId: "declutter",
    styleId: "feed",
    matches: ["https://github.com/**"],
    css: ".feed { display: none }",
  };

  function attachTab(url: string): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({ hostWindow, manager, tabId: "browser:a", url });
    return { hostWindow, manager, view: requireFakeView(0) };
  }

  // The whole point of holding these in the shell: inserted CSS lives one
  // document, so the moment the page commits is the moment to re-apply, and a
  // renderer round trip would be a race against first paint.
  it("applies a matching style when the page commits", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();
    view.webContents.insertedCss.length = 0;

    view.webContents.emitDidNavigate("https://github.com/patcher/pulls");
    await Promise.resolve();

    expect(view.webContents.insertedCss).toEqual([".feed { display: none }"]);
  });

  it("leaves a page no declared site matches alone", async () => {
    const { hostWindow, manager, view } = attachTab("https://example.test/");
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();

    view.webContents.emitDidNavigate("https://example.test/other");
    await Promise.resolve();

    expect(view.webContents.insertedCss).toEqual([]);
  });

  // A pattern only names a website because `patcher.sites` normalised it, and that
  // happened two processes away — so the shell decides for itself that Patcher's own
  // blank page is not a site. `**` is the pattern that shows it: a style for
  // "everything" must not restyle the app's own pages.
  it("treats a page that is not a site as no page at all", async () => {
    const { hostWindow, manager, view } = attachTab("");
    manager.setPageStyles({
      hostWindow,
      request: {
        styles: [{ ...GITHUB_STYLE, matches: ["**"] }],
      },
    });
    await Promise.resolve();

    expect(view.webContents.insertedCss).toEqual([]);
  });

  it("applies to a page already open when the style arrives", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.emitDidNavigate("https://github.com/");
    await Promise.resolve();
    expect(view.webContents.insertedCss).toEqual([]);

    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();

    expect(view.webContents.insertedCss).toEqual([".feed { display: none }"]);
  });

  // Removing the plugin has to take the styling off the page in front of the
  // user, not wait for them to navigate.
  it("removes a style the renderer stopped declaring", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.emitDidNavigate("https://github.com/");
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();
    await Promise.resolve();

    manager.setPageStyles({ hostWindow, request: { styles: [] } });
    await Promise.resolve();

    expect(view.webContents.removedCssKeys).toEqual(["css-1"]);
  });

  it("does not insert the same style twice for one document", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.emitDidNavigate("https://github.com/");
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(view.webContents.insertedCss).toEqual([".feed { display: none }"]);
  });

  // An SPA route change keeps the document, so the stylesheets survive with it —
  // but the address moved, and that is where one site's pattern stops matching.
  it("reconciles when a same-document navigation leaves the matching path", async () => {
    const { hostWindow, manager, view } = attachTab(
      "https://github.com/patcher/pulls",
    );
    view.webContents.emitDidNavigate("https://github.com/patcher/pulls");
    manager.setPageStyles({
      hostWindow,
      request: {
        styles: [
          { ...GITHUB_STYLE, matches: ["https://github.com/patcher/**"] },
        ],
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.webContents.insertedCss).toHaveLength(1);

    view.webContents.emitDidNavigateInPage("https://github.com/elsewhere");
    await Promise.resolve();
    await Promise.resolve();

    expect(view.webContents.removedCssKeys).toEqual(["css-1"]);
  });

  // `insertCSS` is a promise, so a second commit can land between asking and
  // being answered — and the answer for the document that is gone must not take
  // the new document's key with it, or the stylesheet stays on the page with
  // nothing remembering it: unremovable, and inserted a second time by the next
  // push.
  it("keeps the new document's key when a stale insertion answers late", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.deferInsertCss = true;
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();

    // The page commits while the first insertion is still open, and the new
    // document's own insertion answers first.
    view.webContents.emitDidNavigate("https://github.com/patcher/pulls");
    await Promise.resolve();
    expect(view.webContents.deferredInsertions).toHaveLength(2);
    view.webContents.deferredInsertions[1]?.();
    await Promise.resolve();
    await Promise.resolve();
    view.webContents.deferredInsertions[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    // The style is still known to be applied, so dropping the plugin takes it
    // off the page the user is looking at.
    manager.setPageStyles({ hostWindow, request: { styles: [] } });
    await Promise.resolve();

    expect(view.webContents.removedCssKeys).toEqual(["css-2"]);
  });

  // The same race as above, the other way round: the insertion that answers late
  // *failed*. A page being torn down is exactly what rejects one, which is also
  // exactly when the next document commits — so if the stale failure clears the
  // slot, the new document's insertion finds it gone, concludes it was released,
  // and takes its own stylesheet back off the page.
  it("leaves the new document's claim alone when a stale insertion fails late", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.deferInsertCss = true;
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();

    view.webContents.emitDidNavigate("https://github.com/patcher/pulls");
    await Promise.resolve();
    expect(view.webContents.deferredInsertions).toHaveLength(2);
    // The old document's insertion fails first, while the new one is still open.
    view.webContents.deferredInsertions[0]?.(true);
    await Promise.resolve();
    await Promise.resolve();
    view.webContents.deferredInsertions[1]?.();
    await Promise.resolve();
    await Promise.resolve();

    // Nothing was taken back, and the style is known to be applied — so dropping
    // the plugin takes it off the page the user is looking at.
    expect(view.webContents.removedCssKeys).toEqual([]);
    manager.setPageStyles({ hostWindow, request: { styles: [] } });
    await Promise.resolve();
    expect(view.webContents.removedCssKeys).toEqual(["css-2"]);
  });

  // And the other half of that condition: within one document a style can be
  // released and re-declared while the first insertion is still open — a plugin
  // disabled and re-enabled, or two pushes in a row. The late failure belongs to
  // a claim nobody holds any more, so it must not drop the live key.
  it("leaves a re-claimed slot alone when the released insertion fails late", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.emitDidNavigate("https://github.com/");
    view.webContents.deferInsertCss = true;
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();
    // Released while its insertion is still open, then declared again.
    manager.setPageStyles({ hostWindow, request: { styles: [] } });
    await Promise.resolve();
    manager.setPageStyles({ hostWindow, request: { styles: [GITHUB_STYLE] } });
    await Promise.resolve();
    expect(view.webContents.deferredInsertions).toHaveLength(2);

    view.webContents.deferredInsertions[1]?.();
    await Promise.resolve();
    await Promise.resolve();
    view.webContents.deferredInsertions[0]?.(true);
    await Promise.resolve();
    await Promise.resolve();

    manager.setPageStyles({ hostWindow, request: { styles: [] } });
    await Promise.resolve();

    // The empty key is the released claim; `css-2` is the live stylesheet, and it
    // came off because the shell still knew about it.
    expect(view.webContents.removedCssKeys).toEqual(["", "css-2"]);
  });

  it("keeps going when one page refuses an insertion", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    view.webContents.emitDidNavigate("https://github.com/");
    view.webContents.insertCssFailure = new Error("view is being destroyed");

    manager.setPageStyles({
      hostWindow,
      request: {
        styles: [
          GITHUB_STYLE,
          { ...GITHUB_STYLE, styleId: "second", css: ".other { color: red }" },
        ],
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // Both were attempted: the first one's rejection did not abandon the
    // second, and neither was remembered as applied.
    expect(view.webContents.insertedCss).toEqual([
      ".feed { display: none }",
      ".other { color: red }",
    ]);
    expect(view.webContents.removedCssKeys).toEqual([]);
  });
});

// The other half of the page surface. A style is data the shell applies; a script
// is the plugin's own program in a website's renderer, so these tests are mostly
// about what the shell refuses.
describe("plugin page scripts", () => {
  const GITHUB_SCRIPT = {
    pluginId: "site-tweaks",
    scriptId: "toolbar",
    matches: ["https://github.com/**"],
    code: "patcher.ready(function(){})",
  };

  function attachTab(url: string): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({ hostWindow, manager, tabId: "browser:a", url });
    return { hostWindow, manager, view: requireFakeView(0) };
  }

  function pageScriptCalls(
    hostWindow: FakeHostWindow,
  ): PatcherDesktopBrowserPageScriptCall[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) =>
          message.channel === PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL,
      )
      .map((message) => message.payload as PatcherDesktopBrowserPageScriptCall);
  }

  // The property the whole surface rests on: a user with no page-script plugin
  // runs a browser whose pages hold no Patcher code at all.
  it("installs no preload until a script is declared, and removes it again", () => {
    const { hostWindow, manager } = attachTab("https://github.com/");
    const browserSession = requireFakeSession();
    expect([...browserSession.preloadScripts.keys()]).toEqual([]);

    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });
    expect([...browserSession.preloadScripts.values()]).toEqual([
      TEST_PAGE_SCRIPT_PRELOAD_PATH,
    ]);

    manager.setPageScripts({ hostWindow, request: { scripts: [] } });
    expect([...browserSession.preloadScripts.keys()]).toEqual([]);
  });

  it("hands a matching frame the script, grouped into one world per plugin", () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: {
        scripts: [
          GITHUB_SCRIPT,
          { ...GITHUB_SCRIPT, scriptId: "second", code: "/* second */" },
          {
            ...GITHUB_SCRIPT,
            pluginId: "other",
            scriptId: "only",
            code: "/* other */",
          },
        ],
      },
    });

    const bootstrap = manager.pageScriptBootstrap({
      webContentsId: view.webContents.id,
      url: "https://github.com/patcher/pulls",
    });

    expect(bootstrap.worlds).toEqual([
      {
        pluginId: "site-tweaks",
        worldId: 9001,
        scripts: [
          { scriptId: "toolbar", code: "patcher.ready(function(){})" },
          { scriptId: "second", code: "/* second */" },
        ],
      },
      {
        pluginId: "other",
        worldId: 9002,
        scripts: [{ scriptId: "only", code: "/* other */" }],
      },
    ]);
  });

  it("hands nothing to a page no declared site matches", () => {
    const { hostWindow, manager, view } = attachTab("https://example.test/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    expect(
      manager.pageScriptBootstrap({
        webContentsId: view.webContents.id,
        url: "https://example.test/",
      }).worlds,
    ).toEqual([]);
  });

  // A pattern is only known to name a website because `patcher.sites` normalised it,
  // and normalising happens two processes away. So the shell decides for itself
  // that a blank page, a `file://` document and Patcher's own pages are not sites —
  // `**` reaching them would be a plugin on every page a tab can show.
  it("hands nothing to a page that is not a site", () => {
    const { hostWindow, manager, view } = attachTab("about:blank");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [{ ...GITHUB_SCRIPT, matches: ["**"] }] },
    });

    for (const url of ["about:blank", "file:///Users/me/notes.html"]) {
      expect(
        manager.pageScriptBootstrap({
          webContentsId: view.webContents.id,
          url,
        }).worlds,
      ).toEqual([]);
    }
  });

  it("hands nothing to a webContents this manager does not own", () => {
    const { hostWindow, manager } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    expect(
      manager.pageScriptBootstrap({
        webContentsId: 9999,
        url: "https://github.com/",
      }).worlds,
    ).toEqual([]);
  });

  it("forwards a call to the window's renderer and answers the page", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    const answer = manager.pageScriptRpc({
      webContentsId: view.webContents.id,
      url: "https://github.com/patcher/pulls",
      request: {
        pluginId: "site-tweaks",
        method: "addNote",
        input: '{"body":"hi"}',
      },
    });
    await Promise.resolve();

    const forwarded = pageScriptCalls(hostWindow);
    expect(forwarded).toEqual([
      {
        callId: "page-script-1",
        tabId: "browser:a",
        pluginId: "site-tweaks",
        method: "addNote",
        input: '{"body":"hi"}',
        url: "https://github.com/patcher/pulls",
      },
    ]);

    manager.respondToPageScriptCall({
      result: { callId: "page-script-1", ok: true, result: '{"notes":[]}' },
    });
    await expect(answer).resolves.toEqual({
      ok: true,
      result: '{"notes":[]}',
    });
  });

  // The check that bounds a browsed renderer that has been taken over: the
  // address is Chromium's answer, and the plugin is re-checked against it on
  // every call rather than once when the script was injected.
  it("refuses a plugin that declares no script for the address it is on", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    await expect(
      manager.pageScriptRpc({
        webContentsId: view.webContents.id,
        url: "https://example.test/",
        request: { pluginId: "site-tweaks", method: "addNote", input: "" },
      }),
    ).resolves.toEqual({
      ok: false,
      message:
        'patcher.rpc: plugin "site-tweaks" declares no page script for this address.',
    });
    expect(pageScriptCalls(hostWindow)).toEqual([]);
  });

  it("refuses a plugin the page's own scripts do not include", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    await expect(
      manager.pageScriptRpc({
        webContentsId: view.webContents.id,
        url: "https://github.com/",
        request: { pluginId: "somebody-else", method: "read", input: "" },
      }),
    ).resolves.toEqual({
      ok: false,
      message:
        'patcher.rpc: plugin "somebody-else" declares no page script for this address.',
    });
  });

  it("stops answering a script that calls in a loop", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });
    const call = (): Promise<unknown> =>
      manager.pageScriptRpc({
        webContentsId: view.webContents.id,
        url: "https://github.com/",
        request: { pluginId: "site-tweaks", method: "notes", input: "" },
      });

    for (let index = 0; index < 60; index += 1) {
      void call();
    }
    await Promise.resolve();
    expect(pageScriptCalls(hostWindow)).toHaveLength(60);

    await expect(call()).resolves.toEqual({
      ok: false,
      message: "patcher.rpc: too many calls — at most 60 every 10 seconds.",
    });
    expect(pageScriptCalls(hostWindow)).toHaveLength(60);
  });

  // Correlating by id is what makes this safe: the page that asked may be gone.
  it("drops an answer to a call nothing is waiting on", () => {
    const { hostWindow, manager } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    expect(() =>
      manager.respondToPageScriptCall({
        result: { callId: "page-script-404", ok: false, message: "late" },
      }),
    ).not.toThrow();
  });

  it("carries a plugin's refusal back to the script that asked", async () => {
    const { hostWindow, manager, view } = attachTab("https://github.com/");
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });

    const answer = manager.pageScriptRpc({
      webContentsId: view.webContents.id,
      url: "https://github.com/",
      request: { pluginId: "site-tweaks", method: "nope", input: "" },
    });
    await Promise.resolve();
    manager.respondToPageScriptCall({
      result: {
        callId: "page-script-1",
        ok: false,
        message: 'plugin "site-tweaks" has no rpc method "nope"',
      },
    });

    await expect(answer).resolves.toEqual({
      ok: false,
      message: 'plugin "site-tweaks" has no rpc method "nope"',
    });
  });

  // A session that will not take the preload leaves scripts not running, and
  // must not remember that it succeeded — the next push has to try again.
  it("retries the preload after a session refuses it", () => {
    const { hostWindow, manager } = attachTab("https://github.com/");
    const browserSession = requireFakeSession();
    browserSession.registerPreloadFailure = new Error(
      "session is shutting down",
    );

    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });
    expect([...browserSession.preloadScripts.keys()]).toEqual([]);

    browserSession.registerPreloadFailure = null;
    manager.setPageScripts({
      hostWindow,
      request: { scripts: [GITHUB_SCRIPT] },
    });
    expect([...browserSession.preloadScripts.keys()]).toEqual([
      "patcher-page-scripts",
    ]);
  });
});

describe("reopening a closed browser tab", () => {
  const HISTORY = [
    {
      title: "Search",
      url: "https://example.com/search",
      pageState: "state-0",
    },
    {
      title: "Result",
      url: "https://example.com/result",
      pageState: "state-1",
    },
  ];

  function attachWithHistory(): {
    hostWindow: FakeHostWindow;
    manager: DesktopBrowserViewManager;
    view: (typeof electronMock.fakeViews)[number];
  } {
    const manager = createDesktopBrowserViewManager({
      partition: "persist:test",
    });
    const hostWindow = new FakeHostWindow({
      contentBounds: { width: 900, height: 600 },
      webContentsId: 1,
    });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/search",
    });
    const view = requireFakeView(0);
    view.webContents.historyEntries = HISTORY;
    view.webContents.activeHistoryIndex = 1;
    return { hostWindow, manager, view };
  }

  // The point of capturing at all: `pageState` is Chromium's serialized scroll
  // position and form values, and it exists only until the view is destroyed.
  it("restores the page's own history and scroll, not just its URL", () => {
    const { hostWindow, manager } = attachWithHistory();

    manager.detach({ hostWindow, tabId: "browser:a" });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/result",
    });

    const reopened = requireFakeView(1);
    expect(reopened.webContents.restoreCalls).toEqual([
      { entries: HISTORY, index: 1 },
    ]);
    // Restoring drives its own navigation; loading as well would fetch the page
    // twice and the user would watch it happen.
    expect(reopened.webContents.loadURLCalls).toEqual([]);
  });

  it("loads normally for a tab it has no session for", () => {
    const { hostWindow, manager } = attachWithHistory();

    manager.detach({ hostWindow, tabId: "browser:a" });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:b",
      url: "https://example.com/other",
    });

    const fresh = requireFakeView(1);
    expect(fresh.webContents.restoreCalls).toEqual([]);
    expect(fresh.webContents.loadURLCalls).toEqual([
      "https://example.com/other",
    ]);
  });

  // A session is spent when it is used: a later reload or re-attach of the same
  // tab must behave like any other tab.
  it("uses a session once", () => {
    const { hostWindow, manager } = attachWithHistory();
    manager.detach({ hostWindow, tabId: "browser:a" });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/result",
    });

    manager.detach({ hostWindow, tabId: "browser:a" });
    // The reopened view never navigated (its history is empty), so there is
    // nothing to capture the second time.
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/result",
    });

    expect(requireFakeView(2).webContents.restoreCalls).toEqual([]);
  });

  // The renderer is the authority on where a reopened tab should be: if it
  // reopens at a different URL, stale history must not override it.
  it("ignores a session that disagrees with the URL asked for", () => {
    const { hostWindow, manager } = attachWithHistory();

    manager.detach({ hostWindow, tabId: "browser:a" });
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://elsewhere.test/",
    });

    const reopened = requireFakeView(1);
    expect(reopened.webContents.restoreCalls).toEqual([]);
    expect(reopened.webContents.loadURLCalls).toEqual([
      "https://elsewhere.test/",
    ]);
  });

  it("falls back to a plain load when restoring fails", async () => {
    const { hostWindow, manager } = attachWithHistory();
    manager.detach({ hostWindow, tabId: "browser:a" });

    electronMock.nextViewSetup = (view) => {
      view.webContents.restoreFailure = new Error("restore failed");
    };
    attachBrowserTab({
      hostWindow,
      manager,
      tabId: "browser:a",
      url: "https://example.com/result",
    });
    electronMock.nextViewSetup = null;
    await Promise.resolve();
    await Promise.resolve();

    expect(requireFakeView(1).webContents.loadURLCalls).toEqual([
      "https://example.com/result",
    ]);
  });
});
