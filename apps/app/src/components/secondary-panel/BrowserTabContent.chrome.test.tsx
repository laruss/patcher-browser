// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type {
  PatcherDesktopBrowserApi,
  PatcherDesktopBrowserState,
} from "@patcher/desktop-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPatcherDesktopApi,
  createNoopDesktopBrowserApi,
} from "@/test/patcher-desktop-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { BrowserTabContent } from "./BrowserTabContent";

const desktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos" as const,
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

interface BrowserChromeHarness {
  api: PatcherDesktopBrowserApi;
  emitState: (state: PatcherDesktopBrowserState) => void;
  goBack: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function createBrowserChromeHarness(): BrowserChromeHarness {
  const stateListeners = new Set<(state: PatcherDesktopBrowserState) => void>();
  const goBack = vi.fn();
  const stop = vi.fn();
  const api: PatcherDesktopBrowserApi = {
    ...createNoopDesktopBrowserApi(),
    goBack,
    stop,
    onState(listener) {
      stateListeners.add(listener);
      return () => stateListeners.delete(listener);
    },
  };
  return {
    api,
    emitState(state) {
      for (const listener of stateListeners) listener(state);
    },
    goBack,
    stop,
  };
}

function browserState(
  overrides: Partial<PatcherDesktopBrowserState> = {},
): PatcherDesktopBrowserState {
  return {
    tabId: "browser:test",
    url: "https://example.com/docs",
    title: "Example docs",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides,
  };
}

function renderBrowserChrome(harness: BrowserChromeHarness, initialUrl = "") {
  window.patcherDesktop = createPatcherDesktopApi(desktopInfo, harness.api);
  // The tab records what it visits in the server-backed history store, so it
  // needs a query client even when the test is only about its chrome.
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <>
      <BrowserTabContent
        tabId="browser:test"
        initialUrl={initialUrl}
        addressFocusRequest={null}
        canShowNativeBrowserView={false}
        visibilityCoordinator={null}
        environmentId={null}
        threadId="thread-1"
        onUpdate={() => {}}
      />
      <button type="button">Outside browser</button>
    </>,
    { wrapper },
  );
}

function expectChromeVisible(): HTMLElement {
  const chrome = screen.getByTestId("browser-tab-nav-bar");
  expect(chrome.dataset.state).toBe("expanded");
  expect(chrome.classList).toContain("h-11");
  expect(screen.getByTestId("browser-tab-nav-controls").classList).toContain(
    "opacity-100",
  );
  return chrome;
}

describe("BrowserTabContent persistent navigation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
    delete window.patcherDesktop;
  });

  it("keeps the top navigation visible through pointer and focus changes", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    const chrome = expectChromeVisible();

    fireEvent.pointerLeave(chrome);
    act(() => screen.getByRole("button", { name: "Outside browser" }).focus());
    expectChromeVisible();
    expect(screen.getByLabelText("Address and search bar")).not.toBeNull();
  });

  it("keeps navigation visible while loading and preserves the stop action", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");

    act(() => harness.emitState(browserState({ isLoading: true })));
    expectChromeVisible();

    const stopButton = screen.getByRole("button", { name: "Stop loading" });
    fireEvent.click(stopButton);
    expect(harness.stop).toHaveBeenCalledWith("browser:test");
  });

  it("preserves browser navigation actions", () => {
    const harness = createBrowserChromeHarness();
    renderBrowserChrome(harness, "https://example.com/docs");
    expectChromeVisible();

    act(() => harness.emitState(browserState({ canGoBack: true })));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(harness.goBack).toHaveBeenCalledWith("browser:test");
  });
});
