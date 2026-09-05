// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { getBrowserSurfaceTabsStorageKey } from "@/lib/browser-surface-tabs";
import { browserTabOwnersStorageKey } from "./tab-owners";

// Ownership has to be scoped exactly as the tabs are, or it is a map about tabs
// most of its readers do not have: every write prunes claims whose tabs are not
// open *here*, so one shared store would let a second window quietly hand the
// first window's agent tabs back to the person.
describe("browser tab owners storage key", () => {
  afterEach(() => {
    Reflect.deleteProperty(window, "patcherDesktop");
  });

  function withWindowKey(windowKey: string): string {
    Object.defineProperty(window, "patcherDesktop", {
      configurable: true,
      value: { windowKey },
    });
    return browserTabOwnersStorageKey();
  }

  it("scopes claims to the window the shell says this is", () => {
    const unscoped = browserTabOwnersStorageKey();
    const main = withWindowKey("main");
    const second = withWindowKey("window-second");

    expect(main).not.toBe(second);
    expect(main).toContain("main");
    // One shared store is what a web build and a shell too old to name its
    // windows get — which is also what every build had before windows split.
    expect(unscoped).not.toBe(main);
    expect(main.startsWith(unscoped)).toBe(true);
  });

  it("splits on the same windows the tabs do", () => {
    const tabsUnscoped = getBrowserSurfaceTabsStorageKey();
    const ownersUnscoped = browserTabOwnersStorageKey();
    withWindowKey("main");
    const tabsMain = getBrowserSurfaceTabsStorageKey();
    const ownersMain = browserTabOwnersStorageKey();

    // The two keys are separate strings; what must not drift is *when* they
    // change. A tabs store that split while the owners store stayed shared is
    // the shape of the bug this pins.
    expect(tabsMain !== tabsUnscoped).toBe(ownersMain !== ownersUnscoped);
    expect(tabsMain).not.toBe(tabsUnscoped);
  });
});
