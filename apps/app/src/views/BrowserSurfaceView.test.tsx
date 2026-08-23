// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import type { PatcherDesktopBrowserStateHandler } from "@patcher/desktop-contract";
import {
  createPatcherDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/patcher-desktop-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { getBrowserSurfaceTabsStorageKey } from "@/lib/browser-surface-tabs";
import { getBrowserFaviconsStorageKey } from "@/lib/browser-favicons";
import { getBrowserMutedTabsStorageKey } from "@/lib/browser-tab-mute";
import { BrowserSurfaceView } from "./BrowserSurfaceView";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

function renderSurface(
  browserApi = createNoopDesktopBrowserApi(),
  {
    appScreen = null,
    closeWindow,
  }: { appScreen?: ReactNode; closeWindow?: () => void } = {},
) {
  window.patcherDesktop = {
    ...createPatcherDesktopApi(desktopInfo, browserApi),
    // Absent by default, which is a shell older than the call and the web
    // build — both of which must keep the older behaviour.
    ...(closeWindow === undefined ? {} : { closeWindow }),
  };
  // A fresh jotai store per test (the tab atom is module-scoped, so without one
  // the previous test's tabs leak into the next) plus a query client, which the
  // surface needs to read its plugin omnibox contributions.
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  // A router because tab selection navigates: picking Patcher's own screen sends the
  // window to it, and picking a page sends it back to the browser.
  const result = render(
    <Wrapper>
      <MemoryRouter initialEntries={["/browser"]}>
        <BrowserSurfaceView appScreen={appScreen} />
      </MemoryRouter>
    </Wrapper>,
  );
  return {
    ...result,
    /**
     * Give the surface an app screen, or take it away, without remounting —
     * the way AppLayout does when the window navigates to Settings and back.
     */
    setAppScreen(next: ReactNode) {
      result.rerender(
        <Wrapper>
          <MemoryRouter initialEntries={["/browser"]}>
            <BrowserSurfaceView appScreen={next} />
          </MemoryRouter>
        </Wrapper>,
      );
    },
  };
}

function tabButtons(): HTMLElement[] {
  return screen.getAllByRole("tab");
}

/**
 * Put a strip with a loaded page in storage, the way a restored window has one.
 *
 * The surface's own tabs start empty (`url: ""`), and some of what the tab menu
 * offers applies only to a tab with a page — muting a page that does not exist
 * is the entry this is here to reach.
 */
function seedLoadedTab(tabId: string, url: string): void {
  window.localStorage.setItem(
    getBrowserSurfaceTabsStorageKey(),
    JSON.stringify({
      activeTabId: tabId,
      tabs: [
        { environmentId: null, id: tabId, kind: "browser", title: null, url },
      ],
    }),
  );
}

function clearSurfaceStorage(): void {
  window.localStorage.removeItem(getBrowserSurfaceTabsStorageKey());
  // Page icons are session-scoped rather than React state, so they outlive a
  // test's unmount the same way they outlive a reload. So do mutes.
  window.sessionStorage.removeItem(getBrowserFaviconsStorageKey());
  window.sessionStorage.removeItem(getBrowserMutedTabsStorageKey());
}

beforeEach(clearSurfaceStorage);

afterEach(() => {
  cleanup();
  clearSurfaceStorage();
});

describe("BrowserSurfaceView", () => {
  // Page icons come from the shell on their own channel, one push per tab. The
  // surface holds them because the deck unmounts every tab but the active one, so
  // a tab's icon has to outlive its content.
  it("shows an icon the shell pushed for a tab", () => {
    const attachedTabIds: string[] = [];
    const faviconListeners: Array<
      (favicon: { tabId: string; dataUrl: string | null }) => void
    > = [];
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      attach(request) {
        attachedTabIds.push(request.tabId);
      },
      onFavicon(listener) {
        faviconListeners.push(listener);
        return () => {};
      },
    });

    const tabId = attachedTabIds.at(-1);
    expect(tabId).toBeDefined();
    expect(tabButtons()[0]?.querySelector("img")).toBeNull();

    act(() => {
      for (const listener of faviconListeners) {
        listener({ dataUrl: "data:image/png;base64,aWNvbg==", tabId: tabId! });
      }
    });

    expect(tabButtons()[0]?.querySelector("img")?.getAttribute("src")).toBe(
      "data:image/png;base64,aWNvbg==",
    );
  });

  // An app screen — Settings, Extensions, a plugin panel — takes the page area
  // rather than covering it, because nothing in the DOM can draw over an
  // OS-level overlay. The page must therefore *leave* and come back, and coming
  // back must not mean being recreated.
  it("hides the page for an app screen and brings the same one back", () => {
    const attach = vi.fn();
    const detach = vi.fn();
    const setVisible = vi.fn();
    const stateListeners: PatcherDesktopBrowserStateHandler[] = [];
    const { setAppScreen } = renderSurface({
      ...createNoopDesktopBrowserApi(),
      attach,
      detach,
      setVisible,
      onState(listener) {
        stateListeners.push(listener);
        return () => {};
      },
    });

    expect(attach).toHaveBeenCalledTimes(1);
    const tabId = attach.mock.calls[0]?.[0].tabId as string;
    // Give the tab a page, the way the shell reports one after a navigation:
    // an empty tab hides its view for want of content, which would make the
    // assertions below pass for the wrong reason.
    act(() => {
      for (const listener of stateListeners) {
        listener({
          canGoBack: false,
          canGoForward: false,
          errorText: null,
          isLoading: false,
          tabId,
          title: "Example",
          url: "https://example.com/",
        });
      }
    });
    expect(setVisible).toHaveBeenLastCalledWith({ tabId, visible: true });

    setAppScreen(<p>Settings</p>);

    // The screen is on, the page is off, and the strip still holds the tab.
    expect(screen.getByText("Settings")).toBeTruthy();
    expect(tabButtons()).toHaveLength(1);
    expect(setVisible).toHaveBeenLastCalledWith({ tabId, visible: false });

    setAppScreen(null);

    expect(setVisible).toHaveBeenLastCalledWith({ tabId, visible: true });
    // The same page came back, not a new one. The deck really did unmount and
    // remount — that is how the overlay is taken away — so it asks for the view
    // again, and the shell hands back the one it kept under this id. What must
    // never happen is a detach, which is the call that destroys the page.
    expect(
      attach.mock.calls.every(([request]) => request.tabId === tabId),
    ).toBe(true);
    expect(detach).not.toHaveBeenCalled();
  });

  // The surface is the product here, so it must never present an empty frame.
  it("opens one tab on first mount", () => {
    renderSurface();

    expect(tabButtons()).toHaveLength(1);
    expect(tabButtons()[0]?.textContent).toBe("New tab");
    expect(tabButtons()[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("adds and focuses a tab from the strip", () => {
    renderSurface();

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));

    const tabs = tabButtons();
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("false");
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("closes a tab and refocuses a survivor", () => {
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(tabButtons()).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: /^Close / })[1]);

    const tabs = tabButtons();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.getAttribute("aria-selected")).toBe("true");
  });

  // The fallback, and what the web build always gets: with no shell to ask,
  // closing the last tab must leave the new-tab screen rather than an empty
  // surface. `createPatcherDesktopApi` has no `closeWindow`, which is the shape of a
  // shell that predates it.
  it("reopens an empty tab after the last one closes, with no shell to close", () => {
    renderSurface();

    fireEvent.click(screen.getByRole("button", { name: /^Close / }));

    expect(tabButtons()).toHaveLength(1);
    expect(tabButtons()[0]?.textContent).toBe("New tab");
  });

  // What every other browser does, and what a second window made obvious: a
  // strip with nothing left in it is a window with nothing to show.
  it("closes the window when the last tab goes", () => {
    const closeWindow = vi.fn();
    renderSurface(createNoopDesktopBrowserApi(), { closeWindow });

    fireEvent.click(screen.getByRole("button", { name: /^Close / }));

    expect(closeWindow).toHaveBeenCalledTimes(1);
    // The tab is left standing on purpose: the window is going, and if the
    // shell somehow does not close it, the user is left with the tab rather
    // than with nothing.
    expect(tabButtons()).toHaveLength(1);
  });

  // Only when the strip empties. Anything left in it is something to show, so
  // the window stays and the survivor takes over.
  it("keeps the window while any tab remains", () => {
    const closeWindow = vi.fn();
    renderSurface(createNoopDesktopBrowserApi(), { closeWindow });
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));

    fireEvent.click(screen.getAllByRole("button", { name: /^Close / })[1]);

    expect(closeWindow).not.toHaveBeenCalled();
    expect(tabButtons()).toHaveLength(1);
  });

  // The tab menu, end to end: the strip asks, the surface records it and tells
  // the shell, and the tab comes back marked.
  it("mutes a tab from its menu and marks it", () => {
    const setMuted = vi.fn();
    seedLoadedTab("browser:loud", "https://example.test/");
    renderSurface({ ...createNoopDesktopBrowserApi(), setMuted });

    fireEvent.contextMenu(tabButtons()[0]?.parentElement as HTMLElement);
    fireEvent.click(screen.getByText("Mute tab"));

    expect(setMuted).toHaveBeenCalledWith({
      muted: true,
      tabId: "browser:loud",
    });
    expect(screen.getAllByLabelText("Muted")).toHaveLength(1);
  });

  // A mute is set on a `webContents`, and a tab that has never been shown does
  // not have one yet — so the surface re-asserts it when the strip's active tab
  // changes, by which time the deck has built the view.
  it("re-asserts a mute when the active tab changes", () => {
    const setMuted = vi.fn();
    seedLoadedTab("browser:loud", "https://example.test/");
    renderSurface({ ...createNoopDesktopBrowserApi(), setMuted });
    fireEvent.contextMenu(tabButtons()[0]?.parentElement as HTMLElement);
    fireEvent.click(screen.getByText("Mute tab"));
    setMuted.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));

    expect(setMuted).toHaveBeenCalledWith({
      muted: true,
      tabId: "browser:loud",
    });
  });

  it("duplicates a tab beside the one it came from", () => {
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));

    fireEvent.contextMenu(tabButtons()[0]?.parentElement as HTMLElement);
    fireEvent.click(screen.getByText("Duplicate"));

    const tabs = tabButtons();
    expect(tabs).toHaveLength(3);
    // Beside its source, and focused.
    expect(tabs[1]?.getAttribute("aria-selected")).toBe("true");
  });

  // The menu hangs over the page area, and a page is a native view that
  // composites above the DOM — so it has to be frozen and hidden while the menu
  // is up, or the menu is drawn behind the page.
  it("freezes the page while a tab's menu is open, and thaws it after", () => {
    const setOverlay = vi.fn();
    seedLoadedTab("browser:loud", "https://example.test/");
    renderSurface({ ...createNoopDesktopBrowserApi(), setOverlay });
    setOverlay.mockClear();

    fireEvent.contextMenu(tabButtons()[0]?.parentElement as HTMLElement);

    expect(setOverlay).toHaveBeenCalledWith({
      tabId: "browser:loud",
      active: true,
    });

    setOverlay.mockClear();
    fireEvent.click(screen.getByText("Pin tab"));

    expect(setOverlay).toHaveBeenCalledWith({
      tabId: "browser:loud",
      active: false,
    });
  });

  // Pinning reorders the strip rather than flagging a tab in place.
  it("pins a tab into the leading block", () => {
    renderSurface();
    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    const pinnedId = tabButtons()[1]?.getAttribute("aria-label");

    fireEvent.contextMenu(tabButtons()[1]?.parentElement as HTMLElement);
    fireEvent.click(screen.getByText("Pin tab"));

    // A pinned tab shows its icon alone, so its name moves to `aria-label`.
    expect(tabButtons()[0]?.getAttribute("aria-label")).toBe(
      pinnedId ?? "New tab",
    );
    expect(screen.getAllByRole("button", { name: /^Close / })).toHaveLength(1);
  });

  // The surface owns the omnibox chrome, so the tab content must not render its
  // own address bar underneath it.
  it("renders exactly one address bar — the surface's own", () => {
    renderSurface();

    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByTestId("browser-tab-nav-bar")).toBeNull();
  });

  it("navigates the active tab from the omnibox", () => {
    const attach = vi.fn();
    const navigate = vi.fn();
    renderSurface({ ...createNoopDesktopBrowserApi(), attach, navigate });
    const input = screen.getByRole("combobox");

    fireEvent.change(input, { target: { value: "example.com" } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);

    expect(navigate).toHaveBeenCalledWith({
      // The tab the deck attached is the one the omnibox must drive.
      tabId: attach.mock.calls[0]?.[0].tabId as string,
      url: "https://example.com",
    });
  });

  // The point of the surface is that it drives the real Electron browser layer,
  // so assert the native view is attached for the focused tab — and for the
  // newly focused one after a switch, since only the active tab is mounted.
  it("attaches the active tab's native view, and the next one on switch", () => {
    const attach = vi.fn();
    renderSurface({ ...createNoopDesktopBrowserApi(), attach });

    expect(attach).toHaveBeenCalledTimes(1);
    const firstTabId = attach.mock.calls[0]?.[0].tabId as string;
    expect(tabButtons()[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));

    expect(attach).toHaveBeenCalledTimes(2);
    expect(attach.mock.calls[1]?.[0].tabId).not.toBe(firstTabId);
  });

  // A page's `target="_blank"` link never becomes a native popup: the shell
  // denies it and pushes the request back, so this surface is what has to turn
  // it into a tab. With no subscriber the link did nothing at all.
  it("opens a popup from one of its own tabs as a new tab", () => {
    const attach = vi.fn();
    const scopedListeners: Array<
      (request: { tabId: string; url: string }) => void
    > = [];
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      attach,
      onScopedOpenTab(listener) {
        scopedListeners.push(listener);
        return () => {};
      },
    });
    const tabId = attach.mock.calls[0]?.[0].tabId as string;
    // The subscription is renewed as the tab list changes and this fake's
    // unsubscribe keeps the dead listeners, so the last one is the live one.
    const emit = (request: { tabId: string; url: string }) => {
      act(() => {
        scopedListeners.at(-1)?.(request);
      });
    };

    // A popup from a tab this surface does not own is another view's business.
    emit({ tabId: "not-a-surface-tab", url: "https://example.com/elsewhere" });
    expect(tabButtons()).toHaveLength(1);

    emit({ tabId, url: "https://example.com/popup" });

    expect(tabButtons()).toHaveLength(2);
    // Foreground, as every browser opens one: the popup's tab is the one the
    // deck then attaches, so its page is what loads.
    expect(attach.mock.calls.at(-1)?.[0].url).toBe("https://example.com/popup");
  });

  // Real popups: the shell created the window and chose the tab id, because the
  // page had its `window.open()` handle before this surface heard of the tab.
  it("adopts a popup the shell created, and drops it when it closes itself", () => {
    const attach = vi.fn();
    const setPopupTabs = vi.fn();
    const popupListeners: Array<
      (
        popup:
          | { kind: "opened"; openerTabId: string; tabId: string; url: string }
          | { kind: "closed"; tabId: string },
      ) => void
    > = [];
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      attach,
      setPopupTabs,
      onPopup(listener) {
        popupListeners.push(listener);
        return () => {};
      },
    });
    const openerTabId = attach.mock.calls[0]?.[0].tabId as string;
    const emit = (popup: Parameters<(typeof popupListeners)[number]>[0]) => {
      act(() => {
        popupListeners.at(-1)?.(popup);
      });
    };

    // The surface claims its own tabs, which is what lets the shell host a real
    // popup for them at all.
    expect(setPopupTabs.mock.calls.at(-1)?.[0].tabIds).toEqual([openerTabId]);

    // A popup from a tab this surface does not own is another view's business.
    emit({
      kind: "opened",
      openerTabId: "not-a-surface-tab",
      tabId: "browser-popup:9",
      url: "https://accounts.example.com/oauth",
    });
    expect(tabButtons()).toHaveLength(1);

    emit({
      kind: "opened",
      openerTabId,
      tabId: "browser-popup:1",
      url: "https://accounts.example.com/oauth",
    });

    expect(tabButtons()).toHaveLength(2);
    // The shell's id, not one this surface invented: the view it already holds
    // is keyed by it.
    expect(attach.mock.calls.at(-1)?.[0].tabId).toBe("browser-popup:1");

    // How an OAuth flow ends.
    emit({ kind: "closed", tabId: "browser-popup:1" });

    expect(tabButtons()).toHaveLength(1);
  });

  // Links macOS handed the shell because Patcher is the user's default browser. The
  // surface pulls them: the click that launched Patcher reached main before this
  // renderer existed, so there was nobody to push to.
  it("opens the links waiting in the shell when it mounts", async () => {
    const takeExternalUrls = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValue(["https://example.com/from-mail"]);
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      takeExternalUrls,
    });

    await act(async () => {});

    expect(takeExternalUrls).toHaveBeenCalledTimes(1);
    expect(tabButtons()).toHaveLength(2);
  });

  // The routing seam: plugins see a link the system opened before it becomes a
  // tab, and the first decision wins.
  it("opens the address a plugin rewrote, and nothing for one it took over", async () => {
    const decisions = [
      { url: "https://work.example.com/issue" },
      { handled: true },
    ];
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (input) => {
        if (!String(input).includes("/plugins/browser/external-link")) {
          return new Response("{}", {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({ ok: true, decision: decisions.shift() ?? null }),
          { headers: { "content-type": "application/json" } },
        );
      });
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      async takeExternalUrls() {
        return [
          "https://tracker.example.com/1",
          "https://tracker.example.com/2",
        ];
      },
    });

    await act(async () => {});

    // One tab for the rewritten link, none for the one the plugin took over —
    // plus the tab the surface starts with.
    expect(tabButtons()).toHaveLength(2);
    fetchSpy.mockRestore();
  });

  it("drains again when the shell says more arrived", async () => {
    const pendingListeners: Array<() => void> = [];
    const takeExternalUrls = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["https://example.com/later"]);
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      takeExternalUrls,
      onExternalUrlsPending(listener) {
        pendingListeners.push(listener);
        return () => {};
      },
    });
    await act(async () => {});

    await act(async () => {
      pendingListeners.at(-1)?.();
    });

    expect(takeExternalUrls).toHaveBeenCalledTimes(2);
    expect(tabButtons()).toHaveLength(2);
  });

  // Version skew: a shell predating source-attributed popups offers only the
  // unscoped channel, and the link still has to open.
  it("opens a popup from a shell with no scoped channel", () => {
    const openTabListeners: Array<(request: { url: string }) => void> = [];
    renderSurface({
      ...createNoopDesktopBrowserApi(),
      onOpenTab(listener) {
        openTabListeners.push(listener);
        return () => {};
      },
    });

    act(() => {
      openTabListeners.at(-1)?.({ url: "https://example.com/popup" });
    });

    expect(tabButtons()).toHaveLength(2);
  });
});
