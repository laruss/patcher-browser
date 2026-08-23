import { useCallback, useEffect, useRef } from "react";
import {
  clampPatcherDesktopBrowserViewBounds,
  type PatcherDesktopBrowserViewBounds,
} from "@patcher/desktop-contract";
import { Icon } from "@patcher/shared-ui/icon";
import { cn } from "@patcher/shared-ui/lib/utils";
import { CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS } from "@/components/ui/chromeStyleTokens";
import { getDesktopBrowserApi } from "@/lib/patcher-desktop";
import { BROWSER_VIEW_BOUNDS_SYNC_EVENT } from "@/lib/browser-view-bounds-sync";

/**
 * The space Chromium's own DevTools are drawn into, and the one control they
 * cannot draw themselves.
 *
 * Almost nothing here is ours: the panel is real DevTools — Elements, Console,
 * Network, Sources — hosted by the shell in a native view that composites above
 * the DOM, so the app's job is to reserve the area and keep reporting where it
 * is, exactly as it does for the page itself.
 *
 * The exception is the close button. DevTools are opened detached, because the
 * host view is ours, and a detached DevTools expects a window frame to carry
 * its close control — so it draws none. A panel that can only be closed by a
 * keyboard shortcut is a panel some users cannot close, which outweighs the
 * preference for adding no chrome of our own.
 *
 * The layout question is the one the find bar answered the same way: the panel
 * takes space and the page shrinks above it, because two native views cannot be
 * stacked and a frozen page would defeat the point of inspecting a live one.
 */

/** Chromium's own default docked height, near enough. */
export const BROWSER_DEV_TOOLS_PANEL_HEIGHT_CLASS = "h-80";

export interface BrowserDevToolsPanelProps {
  onClose: () => void;
  tabId: string;
}

export function BrowserDevToolsPanel({
  onClose,
  tabId,
}: BrowserDevToolsPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lastBoundsRef = useRef<PatcherDesktopBrowserViewBounds | null>(null);

  const syncBounds = useCallback(() => {
    const element = containerRef.current;
    const browserApi = getDesktopBrowserApi();
    if (element === null || browserApi?.setDevTools === undefined) {
      return;
    }
    const rect = element.getBoundingClientRect();
    const bounds = clampPatcherDesktopBrowserViewBounds({
      bounds: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    const last = lastBoundsRef.current;
    if (
      last !== null &&
      last.x === bounds.x &&
      last.y === bounds.y &&
      last.width === bounds.width &&
      last.height === bounds.height
    ) {
      return;
    }
    lastBoundsRef.current = bounds;
    // The same call opens and places: re-sending with `open: true` is how a
    // resize is reported, so there is no second channel for placement.
    browserApi.setDevTools({ tabId, open: true, bounds });
  }, [tabId]);

  // Whether the panel is on screen, which the shell cannot work out for itself.
  // It hides native views with the page they belong to, and the page goes away
  // for reasons that leave this panel exactly where it was — a failed load,
  // where the app draws "page unavailable" in the page's rect and DevTools are
  // the thing you most want. Mounted means on screen: this panel is rendered
  // only for the active tab's own tools.
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.setDevToolsVisible === undefined) {
      return;
    }
    browserApi.setDevToolsVisible({ tabId, visible: true });
    return () => {
      browserApi.setDevToolsVisible?.({ tabId, visible: false });
    };
  }, [tabId]);

  useEffect(() => {
    syncBounds();
    const element = containerRef.current;
    if (element === null) {
      return;
    }
    const observer = new ResizeObserver(() => {
      syncBounds();
    });
    observer.observe(element);
    window.addEventListener("resize", syncBounds);
    window.addEventListener(BROWSER_VIEW_BOUNDS_SYNC_EVENT, syncBounds);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.removeEventListener(BROWSER_VIEW_BOUNDS_SYNC_EVENT, syncBounds);
    };
  }, [syncBounds]);

  return (
    <div
      className={`flex w-full shrink-0 flex-col border-t border-border bg-sidebar ${BROWSER_DEV_TOOLS_PANEL_HEIGHT_CLASS}`}
    >
      <div className="flex h-7 shrink-0 items-center justify-end px-1">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close developer tools"
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS,
          )}
        >
          <Icon name="X" className="size-3.5" aria-hidden />
        </button>
      </div>
      <div
        ref={containerRef}
        // The measured area, and the only part that is not ours: whatever is
        // drawn here is Chromium's.
        className="min-h-0 w-full flex-1"
        data-testid="browser-dev-tools-panel"
      />
    </div>
  );
}
