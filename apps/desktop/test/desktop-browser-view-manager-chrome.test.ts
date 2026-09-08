import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATCHER_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PLACED_OPEN_TAB_CHANNEL,
  PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
} from "../src/desktop-browser-ipc.js";
import { type DesktopBrowserViewManager } from "../src/desktop-browser-view.js";
import { FakeHostWindow } from "./desktop-browser-host-window-fakes.js";
import {
  type FakeWindowOpenDecision,
  electronMock,
  resetElectronMock,
} from "./desktop-browser-electron-fakes.js";
import {
  TEST_DOWNLOAD_DIRECTORY,
  attachBrowserTab,
  createDesktopBrowserViewManager,
  downloadPayloads,
  requireFakeView,
  settlePendingCaptures,
  startFakeDownload,
} from "./desktop-browser-view-manager-harness.js";

/**
 * The chrome around the page: downloads, the overlay, find-in-page, fullscreen,
 * developer tools, popups, and reopening a tab that was closed.
 *
 * Part of the `desktop-browser-view-manager` suite — see that file for the
 * shared harness and the rest of the split (#80).
 */

vi.mock("electron", async () => {
  const fakes = await import("./desktop-browser-electron-fakes.js");
  return fakes.electronModule;
});

beforeEach(resetElectronMock);

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

  /** What the newest open-tab channel carried, placement included. */
  function placedOpenTabPushes(hostWindow: FakeHostWindow): unknown[] {
    return hostWindow.webContents.sentMessages
      .filter(
        (message) =>
          message.channel === PATCHER_DESKTOP_BROWSER_PLACED_OPEN_TAB_CHANNEL,
      )
      .map((message) => message.payload);
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
  ): { contents: unknown; decision: FakeWindowOpenDecision } {
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

    expect(decision).toMatchObject({ action: "allow", outlivesOpener: true });
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

  // Closing the page you searched from is not a request to close the page you
  // opened from it — and here both are tabs in one strip, so Electron's default
  // took the second down with the first.
  it("opens a popup that outlives the tab that opened it", () => {
    const { view } = attachOpener({ claimsPopups: true });

    const { decision } = openPopup(view, "https://accounts.example.com/oauth");

    expect(decision.outlivesOpener).toBe(true);
  });

  // Cmd/Ctrl+click and the middle button. Chromium creates no guest
  // `webContents` for a background tab, so hosting one as a popup reached
  // `createWindow` with neither a `webContents` nor `webPreferences` and threw
  // in the main process — a dialog across the whole app instead of a new tab.
  it("opens a modified click as a tab, even on a tab that claims popups", () => {
    const { hostWindow, view } = attachOpener({ claimsPopups: true });

    const decision = view.webContents.emitWindowOpen(
      "https://example.com/docs",
      "background-tab",
    );

    expect(decision).toEqual({ action: "deny" });
    expect(popupPushes(hostWindow)).toEqual([]);
    expect(hostWindow.webContents.sentPayloads).toContainEqual({
      tabId: OPENER,
      url: "https://example.com/docs",
    });
    // And it goes to the background: the gesture queues a page to come back
    // to, so taking the window away from the links is the one thing it must
    // not do.
    expect(placedOpenTabPushes(hostWindow)).toEqual([
      {
        background: true,
        tabId: OPENER,
        url: "https://example.com/docs",
      },
    ]);
  });

  // An unmodified `target="_blank"` on a surface that hosts no popups is still
  // the foreground: the page asked to be somewhere else, and no gesture said
  // otherwise.
  it("opens a plain popup fallback in the foreground", () => {
    const { hostWindow, view } = attachOpener({ claimsPopups: false });

    view.webContents.emitWindowOpen(
      "https://example.com/docs",
      "foreground-tab",
    );

    expect(placedOpenTabPushes(hostWindow)).toEqual([
      {
        background: false,
        tabId: OPENER,
        url: "https://example.com/docs",
      },
    ]);
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
