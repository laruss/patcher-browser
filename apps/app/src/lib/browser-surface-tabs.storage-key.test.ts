// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  adoptLegacyBrowserSurfaceTabs,
  getBrowserSurfaceTabsStorageKey,
} from "./browser-surface-tabs";

// Two windows are two browsers. The storage key is the whole of that decision:
// one key means one tab list shared by every window — including which tab is
// active — while each window still builds its own native view for every tab in
// it, so the same page ends up loaded twice.
describe("browser surface tab storage key", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "patcherDesktop");
  });

  function withWindowKey(windowKey: string): string {
    Object.defineProperty(window, "patcherDesktop", {
      configurable: true,
      value: { windowKey },
    });
    return getBrowserSurfaceTabsStorageKey();
  }

  it("scopes the store to the window the shell says this is", () => {
    const unscoped = getBrowserSurfaceTabsStorageKey();
    const main = withWindowKey("main");
    const second = withWindowKey("window-second");

    expect(main).not.toBe(second);
    expect(main).toContain("main");
    expect(second).toContain("window-second");
    // Falling back to one shared store is what a web build and a shell older
    // than the argument get — the behaviour every build had before.
    expect(unscoped).not.toBe(main);
    expect(main.startsWith(unscoped)).toBe(true);
  });
});

describe("adopting a pre-window-scoping tab list", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "patcherDesktop");
    window.localStorage.clear();
  });

  function useWindow(windowKey: string): string {
    Object.defineProperty(window, "patcherDesktop", {
      configurable: true,
      value: { windowKey },
    });
    return getBrowserSurfaceTabsStorageKey();
  }

  const LEGACY = "patcher.browserSurface.tabs-1";
  const STORED = JSON.stringify({ activeTabId: null, tabs: [] });

  it("hands the old list to the first window and leaves the next one empty", () => {
    window.localStorage.setItem(LEGACY, STORED);

    const firstKey = useWindow("main");
    adoptLegacyBrowserSurfaceTabs();

    expect(window.localStorage.getItem(firstKey)).toBe(STORED);
    // Gone, so the second window starts empty instead of inheriting the same
    // list — which would be the shared-tabs bug, reintroduced at upgrade time.
    expect(window.localStorage.getItem(LEGACY)).toBeNull();

    const secondKey = useWindow("window-second");
    adoptLegacyBrowserSurfaceTabs();

    expect(window.localStorage.getItem(secondKey)).toBeNull();
  });

  it("never overwrites tabs a window already has", () => {
    const own = JSON.stringify({ activeTabId: "browser:own", tabs: [] });
    const key = useWindow("main");
    window.localStorage.setItem(key, own);
    window.localStorage.setItem(LEGACY, STORED);

    adoptLegacyBrowserSurfaceTabs();

    expect(window.localStorage.getItem(key)).toBe(own);
  });
});
