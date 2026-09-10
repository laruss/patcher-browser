import type { PatcherDesktopBrowserViewBounds } from "@patcher/desktop-contract";

/**
 * Electron, faked: the module the view manager imports, and the `WebContentsView`
 * and `Session` objects it gets back.
 *
 * Its own module because six test files now drive the same manager and every one
 * of them needs this mock — the alternative was one 8 360-line file pinned at that
 * length, where an assertion could not be added without deleting another (#80).
 * A test file installs it with
 *
 * ```ts
 * vi.mock("electron", async () => {
 *   const { electronModule } = await import("./desktop-browser-electron-fakes.js");
 *   return electronModule;
 * });
 * ```
 *
 * — an async factory rather than {@link vi.hoisted}, because `vi.mock` is hoisted
 * above the imports and its factory is the only place a module can be reached
 * from up there.
 */

export interface FakePreventableEvent {
  defaultPrevented: boolean;
  preventDefault(): void;
}

export interface FakeWebContentsEvent {}

export interface FakeNavigationEvent extends FakePreventableEvent {
  initiator?: FakeWebFrameMain | null;
  isMainFrame: boolean;
  url: string;
}

export type FakeVoidWebContentsListener = () => void;

export type FakeWillFrameNavigateListener = (
  event: FakeNavigationEvent,
) => void;

export type FakeWillNavigateListener = (
  event: FakeNavigationEvent,
  url: string,
) => void;

export type FakeWillRedirectListener = (
  event: FakeNavigationEvent,
  url: string,
  isInPlace: boolean,
  isMainFrame: boolean,
) => void;

export type FakeDidNavigateListener = (
  event: FakeWebContentsEvent,
  url: string,
) => void;

export type FakeDidNavigateInPageListener = (
  event: FakeWebContentsEvent,
  url: string,
  isMainFrame: boolean,
) => void;

export type FakePageFaviconUpdatedListener = (
  event: FakeWebContentsEvent,
  urls: string[],
) => void;

export type FakeDidFailLoadListener = (
  event: FakeWebContentsEvent,
  errorCode: number,
  errorDescription: string,
  validatedURL: string,
  isMainFrame: boolean,
) => void;

export interface FakeContextMenuParams {
  editFlags: {
    canCopy: boolean;
    canCut: boolean;
    canPaste: boolean;
    canRedo: boolean;
    canSelectAll: boolean;
    canUndo: boolean;
  };
}

export type FakeContextMenuListener = (
  event: FakeWebContentsEvent,
  params: FakeContextMenuParams,
) => void;

export interface FakeInput {
  alt: boolean;
  control: boolean;
  isAutoRepeat: boolean;
  isComposing: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
  type: string;
}

export type FakeBeforeInputListener = (
  event: FakePreventableEvent,
  input: FakeInput,
) => void;

export interface FakeFoundInPageResult {
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

export type FakeFoundInPageListener = (
  event: FakeWebContentsEvent,
  result: FakeFoundInPageResult,
) => void;

export interface FakeFindInPageOptions {
  findNext?: boolean;
  forward?: boolean;
}

export interface FakeAuthInfo {
  isProxy: boolean;
  scheme: string;
  host: string;
  port: number;
  realm: string;
}

export type FakeAuthCallback = (username?: string, password?: string) => void;

export type FakeLoginListener = (
  event: FakePreventableEvent,
  details: { url: string; isRequestForNavigation?: boolean },
  authInfo: FakeAuthInfo,
  callback: FakeAuthCallback,
) => void;

export interface FakeCertificate {
  fingerprint: string;
  issuerName: string;
  subjectName: string;
  validExpiry: number;
  validStart: number;
}

export type FakeCertificateErrorListener = (
  event: FakePreventableEvent,
  url: string,
  error: string,
  certificate: FakeCertificate,
  callback: (isTrusted: boolean) => void,
  isMainFrame: boolean,
) => void;

export type FakeSelectClientCertificateListener = (
  event: FakePreventableEvent,
  url: string,
  certificateList: FakeCertificate[],
  callback: (certificate?: FakeCertificate) => void,
) => void;

export type FakeRenderProcessGoneListener = (
  event: FakeWebContentsEvent,
  details: { reason: string },
) => void;

export interface FakeWebContentsEventMap {
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

export interface FakeConsoleMessageDetails {
  level: "debug" | "info" | "warning" | "error";
  message: string;
  lineNumber: number;
  sourceId: string;
}

export type FakeConsoleMessageListener = (
  details: FakeConsoleMessageDetails,
) => void;

export type FakeResourceType =
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

export interface FakeWebFrameMain {
  origin: string;
}

export interface FakeOnBeforeRequestDetails {
  url: string;
  method?: string;
  resourceType: FakeResourceType;
  webContentsId?: number;
  frame?: FakeWebFrameMain | null;
}

export interface FakeWebRequestCallbackResponse {
  cancel: boolean;
}

export type FakeOnBeforeRequestCallback = (
  response: FakeWebRequestCallbackResponse,
) => void;

export type FakeOnBeforeRequestListener = (
  details: FakeOnBeforeRequestDetails,
  callback: FakeOnBeforeRequestCallback,
) => void;

export interface FakeNetworkRequestDetails {
  url: string;
  method?: string;
  resourceType?: FakeResourceType;
  webContentsId?: number;
  statusCode?: number;
  fromCache?: boolean;
  error?: string;
  timestamp?: number;
}

export type FakeNetworkRequestListener = (
  details: FakeNetworkRequestDetails,
) => void;

export interface FakeCookie {
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

export interface FakeSessionEvent {
  preventDefault(): void;
}

export type FakeDownloadDoneState = "completed" | "cancelled" | "interrupted";

export type FakeDownloadDoneListener = (
  event: FakeSessionEvent,
  state: FakeDownloadDoneState,
) => void;

/**
 * Electron's `DownloadItem`, as far as the manager touches it: the name the
 * page asked for, the path we choose, and the one terminal event.
 */
export class FakeDownloadItem {
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

export type FakeSessionListener = (
  event: FakeSessionEvent,
  item: FakeDownloadItem,
  webContents: { id: number },
) => void;

export type FakePermissionRequestHandler = (
  webContents: unknown,
  permission: string,
  callback: (granted: boolean) => void,
) => void;

export type FakePermissionCheckHandler = (
  webContents: unknown,
  permission: string,
) => boolean;

export interface FakeWindowOpenDetails {
  /**
   * How Chromium was asked to open the window. Only `background-tab` — a
   * middle-click or Cmd/Ctrl+click — is told apart here, and it is the one for
   * which Chromium creates no guest `webContents`.
   */
  disposition: FakeWindowOpenDisposition;
  url: string;
}

/** Electron's own set, from `HandlerDetails.disposition`. */
export type FakeWindowOpenDisposition =
  | "default"
  | "foreground-tab"
  | "background-tab"
  | "new-window"
  | "other";

export interface FakeWindowOpenDecision {
  action: "deny" | "allow";
  outlivesOpener?: boolean;
  /** Present on "allow": the shell builds the popup's view here. */
  createWindow?: (options: FakeWindowOpenOptions) => unknown;
}

export interface FakeWindowOpenOptions {
  webPreferences?: Record<string, unknown>;
  /**
   * The `webContents` Chromium already made for the popup, carrying the opener
   * link. Electron passes it through so the constructed view adopts it.
   */
  webContents?: unknown;
}

export type FakeWindowOpenHandler = (
  details: FakeWindowOpenDetails,
) => FakeWindowOpenDecision;

function createElectronMock() {
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
      off(event: string, listener: never): unknown {
        const list =
          event === "detach" ? this.detachListeners : this.messageListeners;
        const at = list.indexOf(listener);
        if (at >= 0) {
          list.splice(at, 1);
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
     * Whether this page is throttled when it is off screen, and every change
     * in order — the order is the assertion, since asking for frames after the
     * event has been sent would be asking too late (#114).
     */
    backgroundThrottling = true;
    public readonly backgroundThrottlingCalls: boolean[] = [];

    setBackgroundThrottling(allowed: boolean): void {
      this.backgroundThrottling = allowed;
      this.backgroundThrottlingCalls.push(allowed);
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

    emitWindowOpen(
      url: string,
      disposition: FakeWindowOpenDisposition = "new-window",
    ): FakeWindowOpenDecision {
      if (this.windowOpenHandler === null) {
        throw new Error("Expected a window open handler to be registered.");
      }
      return this.windowOpenHandler({ disposition, url });
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
}

export const electronMock = createElectronMock();

/** What `vi.mock("electron", …)` returns: the two things the shell imports. */
export const electronModule = {
  WebContentsView: electronMock.FakeWebContentsView,
  session: electronMock.session,
};

/** Forget the views and sessions the last test made. */
export function resetElectronMock(): void {
  electronMock.fakeSessions.length = 0;
  electronMock.fakeViews.length = 0;
}
