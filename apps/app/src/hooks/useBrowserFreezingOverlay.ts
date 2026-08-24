import { useEffect } from "react";
import { atom, useAtomValue, useSetAtom } from "jotai";

/**
 * Count of open menus that the in-app browser has to freeze for.
 *
 * The native browser `WebContentsView` composites above the DOM, so a menu
 * portaled into `document.body` over the page area opens behind it: there, but
 * invisible and unclickable. What puts it back is freezing the page to a bitmap
 * and hiding the view (`setOverlay`), which keeps the page on screen under the
 * menu — the difference from {@link useBrowserDimmingModal}, whose modals cover
 * the whole panel and so hide the view outright.
 *
 * A count, not a boolean, because there is one page and several things that can
 * be drawn over it: two menus can be up at once — a sidebar row's context menu
 * over a thread header's dropdown — and the first to close must not thaw the
 * page under the second.
 *
 * `BrowserSurfaceView` is the single reader, and folds this into the one
 * `setOverlay` call it owns.
 */
const browserFreezingOverlayCountAtom = atom(0);

/**
 * Register a menu as page-freezing while `active`: increments the shared count
 * on open and decrements on close/unmount.
 */
export function useBrowserFreezingOverlay(active: boolean): void {
  const setCount = useSetAtom(browserFreezingOverlayCountAtom);
  useEffect(() => {
    if (!active) {
      return;
    }
    setCount((count) => count + 1);
    return () => setCount((count) => count - 1);
  }, [active, setCount]);
}

/** Whether any page-freezing menu is currently open. */
export function useIsBrowserFreezingOverlayOpen(): boolean {
  return useAtomValue(browserFreezingOverlayCountAtom) > 0;
}
