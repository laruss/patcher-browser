import { expect } from "vitest";
import type { PatcherDesktopBrowserDownload } from "@patcher/desktop-contract";
import {
  PATCHER_DESKTOP_BROWSER_DOWNLOAD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FAVICON_CHANNEL,
  PATCHER_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
} from "../src/desktop-browser-ipc.js";
import {
  createDesktopBrowserViewManager as createProductionDesktopBrowserViewManager,
  type CreateDesktopBrowserViewManagerArgs,
  type DesktopBrowserViewManager,
} from "../src/desktop-browser-view.js";
import type { FakeHostWindow } from "./desktop-browser-host-window-fakes.js";
import {
  electronMock,
  FakeDownloadItem,
  type FakeOnBeforeRequestDetails,
  type FakeOnBeforeRequestListener,
  type FakeResourceType,
  type FakeSessionListener,
  type FakeWebRequestCallbackResponse,
} from "./desktop-browser-electron-fakes.js";

/**
 * The manager under test, and the small vocabulary its suites drive it with.
 *
 * Split out of `desktop-browser-view-manager.test.ts` alongside
 * `desktop-browser-electron-fakes.ts`, for the reason given there (#80).
 */

export const TEST_DOWNLOAD_DIRECTORY = "/tmp/patcher-test-downloads";
export const TEST_PAGE_SCRIPT_PRELOAD_PATH =
  "/app/dist/page-script-preload.cjs";

export function createDesktopBrowserViewManager(
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
/**
 * Resolve every pending capturePage() on the view and let the snapshot
 * pipeline (push the bitmap, then hide the view) drain.
 */
export async function settlePendingCaptures(
  view: (typeof electronMock.fakeViews)[number],
): Promise<void> {
  for (const resolve of view.webContents.pendingCaptureResolvers.splice(0)) {
    resolve(electronMock.fakeCapturedImage);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export function snapshotPushesOf(
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

export interface AttachBrowserTabArgs {
  hostWindow: FakeHostWindow;
  manager: DesktopBrowserViewManager;
  tabId: string;
  url: string;
}

export interface BrowserRequestBlockedArgs {
  url: string;
  method?: string;
  resourceType: FakeResourceType;
  frameOrigin?: string | null;
  webContentsId?: number;
}

export function attachBrowserTab(args: AttachBrowserTabArgs): void {
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

export function requireFakeView(
  index: number,
): (typeof electronMock.fakeViews)[number] {
  const view = electronMock.fakeViews[index];
  expect(view).toBeDefined();
  if (view === undefined) {
    throw new Error("Expected the browser view to be created.");
  }
  return view;
}

export function requireWillDownloadListener(): FakeSessionListener {
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

export interface StartFakeDownloadArgs {
  filename: string;
  webContentsId: number;
}

/** Drive one `will-download`, returning what the shell did with it. */
export function startFakeDownload(args: StartFakeDownloadArgs): {
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

export function downloadPayloads(
  hostWindow: FakeHostWindow,
): PatcherDesktopBrowserDownload[] {
  return hostWindow.webContents.sentMessages
    .filter(
      (message) => message.channel === PATCHER_DESKTOP_BROWSER_DOWNLOAD_CHANNEL,
    )
    .map((message) => message.payload as PatcherDesktopBrowserDownload);
}

export function requireOnBeforeRequestListener(): FakeOnBeforeRequestListener {
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

export function browserRequestBlocked(
  args: BrowserRequestBlockedArgs,
): boolean {
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

// By channel, not by payload shape: the three open-tab channels differ only in
// which fields they carry, so shape-matching read one channel's push as
// another's the moment a third was added.
export function pushesOnChannel(
  hostWindow: FakeHostWindow,
  channel: string,
): unknown[] {
  return hostWindow.webContents.sentMessages
    .filter((message) => message.channel === channel)
    .map((message) => message.payload);
}

export function openTabPushesOf(hostWindow: FakeHostWindow): string[] {
  return pushesOnChannel(hostWindow, PATCHER_DESKTOP_BROWSER_OPEN_TAB_CHANNEL)
    .filter(
      (payload): payload is { url: string } =>
        typeof payload === "object" && payload !== null && "url" in payload,
    )
    .map((payload) => payload.url);
}

export function scopedOpenTabPushesOf(hostWindow: FakeHostWindow): unknown[] {
  return pushesOnChannel(
    hostWindow,
    PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  );
}

export function faviconPushesOf(
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

export function requireFakeSession(): (typeof electronMock.fakeSessions)[number] {
  const fakeSession = electronMock.fakeSessions.at(-1);
  expect(fakeSession).toBeDefined();
  if (fakeSession === undefined) {
    throw new Error("Expected a browser session to be created.");
  }
  return fakeSession;
}

/** Let a favicon fetch and its push drain. */
export async function settleFavicons(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
