// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { PatcherDesktopBrowserDownload } from "@patcher/desktop-contract";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import {
  createPatcherDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/patcher-desktop-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useBrowserDownloadNotifications } from "@/lib/browser-downloads";
import { getBrowserSurfaceTabsStorageKey } from "@/lib/browser-surface-tabs";
import { BrowserSurfaceView } from "./BrowserSurfaceView";

// Literal Control rather than `mod`, so the chord resolves the same whatever
// platform jsdom reports — the real binding's scope is pinned server-side.
const commandFixture = vi.hoisted(() => ({
  keybindings: [
    {
      command: "browser.recentTab.next" as const,
      desktopOnly: false,
      shortcut: {
        key: "Tab",
        mod: false,
        meta: false,
        control: true,
        alt: false,
        shift: false,
      },
      when: { all: ["mainSurface" as const], none: [] },
    },
  ],
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({
    data: {
      generalSettings: { showKeyboardHints: false },
      keybindings: commandFixture.keybindings,
    },
  }),
}));

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

const ACTIVE_TAB_ID = "browser:one";

function completedDownload(): PatcherDesktopBrowserDownload {
  return {
    id: "download-1",
    tabId: ACTIVE_TAB_ID,
    filename: "report.pdf",
    savePath: "/Users/someone/Downloads/report.pdf",
    url: "https://example.test/report.pdf",
    mimeType: "application/pdf",
    state: "completed",
  };
}

/** Two loaded tabs, because the switcher has nothing to walk with one. */
function seedTwoLoadedTabs(): void {
  window.localStorage.setItem(
    getBrowserSurfaceTabsStorageKey(),
    JSON.stringify({
      activeTabId: ACTIVE_TAB_ID,
      tabs: [
        {
          environmentId: null,
          id: ACTIVE_TAB_ID,
          kind: "browser",
          title: null,
          url: "https://one.test/",
        },
        {
          environmentId: null,
          id: "browser:two",
          kind: "browser",
          title: null,
          url: "https://two.test/",
        },
      ],
    }),
  );
}

/**
 * The surface plus the download reporter that feeds its chrome, which is how the
 * two meet in the running app — the reporter is mounted above the router.
 */
function OverlayHarness() {
  useBrowserDownloadNotifications();
  return (
    <MemoryRouter initialEntries={["/browser"]}>
      <BrowserSurfaceView />
    </MemoryRouter>
  );
}

function renderSurface() {
  const setOverlay = vi.fn();
  const downloadListeners: Array<
    (download: PatcherDesktopBrowserDownload) => void
  > = [];
  window.patcherDesktop = createPatcherDesktopApi(desktopInfo, {
    ...createNoopDesktopBrowserApi(),
    setOverlay,
    onDownload(listener) {
      downloadListeners.push(listener);
      return () => {};
    },
  });

  const { wrapper: Wrapper } = createQueryClientTestHarness();
  render(
    <Wrapper>
      <AppCommandProvider>
        <OverlayHarness />
      </AppCommandProvider>
    </Wrapper>,
  );

  return {
    setOverlay,
    emitDownload() {
      act(() => {
        // The subscription is renewed as state changes, and this fake's
        // unsubscribe keeps the dead listeners, so only the last one is live.
        downloadListeners.at(-1)?.(completedDownload());
      });
    },
  };
}

function pressCycleChord(): void {
  act(() => {
    fireEvent(
      window,
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "Tab",
      }),
    );
  });
}

/** Releasing Control is what lands the walk. */
function releaseControl(): void {
  act(() => {
    fireEvent(
      document,
      new KeyboardEvent("keyup", { bubbles: true, key: "Control" }),
    );
  });
}

beforeEach(() => {
  window.localStorage.removeItem(getBrowserSurfaceTabsStorageKey());
  // The reporter hands finished downloads to plugins over HTTP; nothing here
  // asserts on that, but an unstubbed fetch rejects into an unhandled promise.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}")),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(getBrowserSurfaceTabsStorageKey());
  delete window.patcherDesktop;
  vi.unstubAllGlobals();
});

describe("BrowserSurfaceView: one owner of the page freeze", () => {
  // The page is a native view that composites above the DOM, so anything the
  // surface draws over it needs the page frozen to a bitmap and hidden — and
  // there is one page, so there can be one caller. With two, the switcher's
  // close thaws the page under the downloads list that is still open, and the
  // view comes back over it: a panel that is there but invisible and
  // unclickable. The switcher is the one that reaches this, because it is driven
  // by keys and the list closes on a click outside, not a keypress.
  it("keeps the page frozen for the downloads list while the switcher comes and goes", () => {
    seedTwoLoadedTabs();
    const { emitDownload, setOverlay } = renderSurface();
    emitDownload();

    fireEvent.click(screen.getByRole("button", { name: /^Downloads/ }));
    expect(setOverlay).toHaveBeenLastCalledWith({
      tabId: ACTIVE_TAB_ID,
      active: true,
    });

    // Two steps around a two-tab cycle land back on the tab we started in, so
    // the walk closes without switching — nothing but the freeze changes.
    pressCycleChord();
    pressCycleChord();
    releaseControl();

    expect(screen.queryByRole("menu", { name: "Downloads" })).not.toBeNull();
    expect(setOverlay).toHaveBeenLastCalledWith({
      tabId: ACTIVE_TAB_ID,
      active: true,
    });
  });
});
