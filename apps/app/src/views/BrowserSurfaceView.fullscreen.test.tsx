// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type {
  PatcherDesktopApi,
  PatcherDesktopBrowserApi,
  PatcherDesktopBrowserSetFullscreenRequest,
  PatcherDesktopWindowState,
  PatcherDesktopWindowStateChangeHandler,
} from "@patcher/desktop-contract";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { createNoopDesktopBrowserApi } from "@/test/patcher-desktop-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { getBrowserSurfaceTabsStorageKey } from "@/lib/browser-surface-tabs";
import { BrowserSurfaceView } from "./BrowserSurfaceView";

// Literal Control rather than `mod`, so the chord resolves the same whatever
// platform jsdom reports. What is under test is the handler, not the chord —
// the real binding's scope is pinned server-side.
const commandFixture = vi.hoisted(() => ({
  keybindings: [
    {
      command: "browser.fullscreen.toggle" as const,
      desktopOnly: false,
      shortcut: {
        key: "f",
        mod: false,
        meta: false,
        control: true,
        alt: false,
        shift: true,
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

interface FullscreenHarness {
  calls: PatcherDesktopBrowserSetFullscreenRequest[];
  /** Move the app window in or out of the OS's own full screen. */
  setWindowFullScreen: (isFullScreen: boolean) => void;
}

function renderSurface(initialWindowFullScreen: boolean): FullscreenHarness {
  const calls: PatcherDesktopBrowserSetFullscreenRequest[] = [];
  const windowStateListeners =
    new Set<PatcherDesktopWindowStateChangeHandler>();
  let windowState: PatcherDesktopWindowState = {
    isFullScreen: initialWindowFullScreen,
  };
  const browser: PatcherDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    setFullscreen(request) {
      calls.push(request);
    },
  };
  window.patcherDesktop = {
    ...desktopInfo,
    browser,
    async checkForUpdates() {
      return desktopInfo;
    },
    async getInfo() {
      return desktopInfo;
    },
    async getWindowState() {
      return windowState;
    },
    async installUpdate() {},
    onChange() {
      return () => {};
    },
    onWindowStateChange(listener) {
      windowStateListeners.add(listener);
      return () => {
        windowStateListeners.delete(listener);
      };
    },
    setTheme() {},
    openExternalUrl() {},
  } as PatcherDesktopApi;

  const { wrapper: Wrapper } = createQueryClientTestHarness();
  render(
    <Wrapper>
      <AppCommandProvider>
        <MemoryRouter initialEntries={["/browser"]}>
          <BrowserSurfaceView />
        </MemoryRouter>
      </AppCommandProvider>
    </Wrapper>,
  );

  return {
    calls,
    setWindowFullScreen(isFullScreen) {
      windowState = { isFullScreen };
      act(() => {
        for (const listener of windowStateListeners) {
          listener(windowState);
        }
      });
    },
  };
}

function pressFullscreenChord(): void {
  act(() => {
    fireEvent(
      window,
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        shiftKey: true,
        key: "f",
      }),
    );
  });
}

beforeEach(() => {
  window.localStorage.removeItem(getBrowserSurfaceTabsStorageKey());
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(getBrowserSurfaceTabsStorageKey());
  delete window.patcherDesktop;
});

describe("BrowserSurfaceView: giving the page the whole window", () => {
  // Covering the tab strip and the omnibox inside an ordinary window would
  // leave a page with no browser around it, so the chord does nothing there —
  // which is what a browser does with a shortcut that does not apply.
  it("does nothing while the app window is not full screen", async () => {
    const harness = renderSurface(false);
    await act(async () => {});

    pressFullscreenChord();

    expect(harness.calls).toEqual([]);
  });

  it("expands the page, and gives the chrome back on a second press", async () => {
    const harness = renderSurface(true);
    await act(async () => {});

    pressFullscreenChord();
    pressFullscreenChord();

    expect(harness.calls.map((call) => call.fullscreen)).toEqual([true, false]);
  });

  // Otherwise a view sized to the whole window stays over the chrome of a
  // normal one.
  it("comes back when the window leaves its own full screen", async () => {
    const harness = renderSurface(true);
    await act(async () => {});
    pressFullscreenChord();

    harness.setWindowFullScreen(false);

    expect(harness.calls.at(-1)?.fullscreen).toBe(false);
  });
});
