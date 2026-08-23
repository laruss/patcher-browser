// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  browserSurfaceTabsAtom,
  createAppSurfaceTab,
  createBrowserSurfaceTab,
  getActiveBrowserSurfaceTab,
  getBrowserSurfaceTabsStorageKey,
  isAppSurfaceTab,
  type BrowserSurfaceTabsState,
} from "@/lib/browser-surface-tabs";
import { useBrowserSurfaceRouteSync } from "./useBrowserSurfaceRouteSync";

/**
 * The strip and the window can each move, and the sync's whole job is that
 * whichever moved is the one the other follows. These cases are the two
 * directions and the one place they must not fight.
 */

interface HarnessArgs {
  initialPath?: string;
  state: BrowserSurfaceTabsState;
  target: { path: string; title: string } | null;
}

function renderSync({ initialPath = "/browser", state, target }: HarnessArgs) {
  const store = createStore();
  store.set(browserSurfaceTabsAtom, state);

  function Probe({ next }: { next: HarnessArgs["target"] }) {
    const { pathname } = useLocation();
    useBrowserSurfaceRouteSync({ enabled: true, target: next });
    // Painted rather than captured into a closure: where the window ended up is
    // an observation about the rendered tree, and reading it from the DOM is
    // what makes it one.
    return <span data-testid="pathname">{pathname}</span>;
  }

  function wrap(next: HarnessArgs["target"]): ReactNode {
    return (
      <Provider store={store}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Probe next={next} />
        </MemoryRouter>
      </Provider>
    );
  }

  const result = render(wrap(target));
  return {
    activeTab: () =>
      getActiveBrowserSurfaceTab(store.get(browserSurfaceTabsAtom)),
    pathname: () => screen.getByTestId("pathname").textContent,
    store,
    tabs: () => store.get(browserSurfaceTabsAtom).tabs,
    setTarget(next: HarnessArgs["target"]) {
      result.rerender(wrap(next));
    },
  };
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(getBrowserSurfaceTabsStorageKey());
});

describe("useBrowserSurfaceRouteSync", () => {
  it("opens a tab for the destination the window is on", () => {
    const web = createBrowserSurfaceTab("https://example.com");
    const harness = renderSync({
      state: { activeTabId: web.id, tabs: [web] },
      target: { path: "/settings", title: "Settings" },
    });

    expect(harness.tabs()).toHaveLength(2);
    const active = harness.activeTab();
    expect(active !== null && isAppSurfaceTab(active) && active.path).toBe(
      "/settings",
    );
  });

  it("records the title once the screen resolves one", () => {
    const web = createBrowserSurfaceTab("https://example.com");
    const harness = renderSync({
      state: { activeTabId: web.id, tabs: [web] },
      target: { path: "/plugins/helm/wiki", title: "Patcher" },
    });

    act(() => {
      harness.setTarget({ path: "/plugins/helm/wiki", title: "Helm Wiki" });
    });

    const active = harness.activeTab();
    expect(active !== null && isAppSurfaceTab(active) && active.title).toBe(
      "Helm Wiki",
    );
    expect(harness.tabs()).toHaveLength(2);
  });

  it("hands the main area back to a web tab when the window leaves", () => {
    const web = createBrowserSurfaceTab("https://example.com");
    const settings = createAppSurfaceTab({ path: "/settings", title: null });
    const harness = renderSync({
      initialPath: "/settings",
      state: { activeTabId: settings.id, tabs: [web, settings] },
      target: { path: "/settings", title: "Settings" },
    });

    act(() => {
      harness.setTarget(null);
    });

    expect(harness.activeTab()?.id).toBe(web.id);
  });

  // An agent's `browser_tabs_open` writes the strip directly; it never touches
  // the router. Without this the tab would be highlighted while Settings stayed
  // on screen — selected everywhere except where it matters.
  it("follows a tab activated from outside the router", async () => {
    const web = createBrowserSurfaceTab("https://example.com");
    const settings = createAppSurfaceTab({ path: "/settings", title: null });
    const harness = renderSync({
      initialPath: "/settings",
      state: { activeTabId: settings.id, tabs: [web, settings] },
      target: { path: "/settings", title: "Settings" },
    });
    expect(harness.pathname()).toBe("/settings");

    await act(async () => {
      harness.store.set(browserSurfaceTabsAtom, {
        activeTabId: web.id,
        tabs: [web, settings],
      });
    });

    expect(harness.pathname()).toBe("/browser");
  });

  // The other direction, on the very same commit: arriving at a destination
  // must not be read as "a web tab is selected here" and bounced straight back.
  it("does not bounce off a destination it has just arrived at", () => {
    const web = createBrowserSurfaceTab("https://example.com");
    const harness = renderSync({
      initialPath: "/settings",
      state: { activeTabId: web.id, tabs: [web] },
      target: { path: "/settings", title: "Settings" },
    });

    expect(harness.pathname()).toBe("/settings");
  });
});
