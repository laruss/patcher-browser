import { beforeEach, describe, expect, it, vi } from "vitest";
import { isAllowedBrowserPermission } from "../src/desktop-browser-view.js";
import { FakeHostWindow } from "./desktop-browser-host-window-fakes.js";
import {
  electronMock,
  resetElectronMock,
} from "./desktop-browser-electron-fakes.js";
import {
  attachBrowserTab,
  browserRequestBlocked,
  createDesktopBrowserViewManager,
  faviconPushesOf,
  openTabPushesOf,
  requireFakeSession,
  requireFakeView,
  scopedOpenTabPushesOf,
  settleFavicons,
  settlePendingCaptures,
  snapshotPushesOf,
} from "./desktop-browser-view-manager-harness.js";

/**
 * The view manager: attaching a tab, navigating it, the policy on what it may
 * load, and the icons it pushes back.
 *
 * One of six suites over the same manager. The Electron mock and the shared
 * helpers live in `desktop-browser-electron-fakes.ts` and
 * `desktop-browser-view-manager-harness.ts`; the other five are the
 * `-reads`, `-automation`, `-session`, `-chrome` and `-plugins` files beside
 * this one. Split there under #80.
 */

vi.mock("electron", async () => {
  const fakes = await import("./desktop-browser-electron-fakes.js");
  return fakes.electronModule;
});

beforeEach(resetElectronMock);

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
