import { useEffect, useMemo, useRef } from "react";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getDesktopBrowserApi } from "@/lib/patcher-desktop";
import {
  BrowserTabContent,
  type BrowserAddressFocusRequest,
  type BrowserTabFaviconArgs,
  type BrowserTabLoadingArgs,
} from "./BrowserTabContent";
import {
  createBrowserViewVisibilityCoordinator,
  destroyPersistedBrowserView,
} from "./browserViewVisibilityCoordinator";
import type { UpdateBrowserTabArgs } from "./useThreadFileTabs";

export interface BrowserTabDeckProps {
  browserTabs: readonly BrowserFixedPanelTab[];
  activeBrowserTabId: string | null;
  addressFocusRequest?: BrowserAddressFocusRequest | null;
  onAddressFocusRequestConsumed?: (request: BrowserAddressFocusRequest) => void;
  environmentId: string | null;
  /**
   * Readiness-gated permission for the active native browser view to become
   * visible. Wide layout passes logical panel-open state; compact layout waits
   * for drawer animation completion plus the post-open bounds sync.
   */
  canShowNativeBrowserView: boolean;
  /** Forwarded to the tab content — see `BrowserTabContentProps.showChrome`. */
  showChrome?: boolean;
  threadId: string;
  onUpdate: (args: UpdateBrowserTabArgs) => void;
  /** Forwarded to the tab content — see `BrowserTabContentProps.onFavicon`. */
  onFavicon?: (args: BrowserTabFaviconArgs) => void;
  /** Forwarded to the tab content — see `BrowserTabContentProps.onLoadingChange`. */
  onLoadingChange?: (args: BrowserTabLoadingArgs) => void;
}

interface BrowserTabIdSnapshot {
  tabIds: ReadonlySet<string>;
  threadId: string;
}

interface BuildBrowserTabIdSetArgs {
  browserTabs: readonly BrowserFixedPanelTab[];
}

export function buildBrowserTabIdSet({
  browserTabs,
}: BuildBrowserTabIdSetArgs): ReadonlySet<string> {
  return new Set(browserTabs.map((tab) => tab.id));
}

/**
 * Picks the single browser tab whose content the deck mounts. Returns the tab
 * matching `activeBrowserTabId`, or null when there is no active id or the
 * active id is not an open browser tab. Selecting exactly one tab (never the
 * inactive persisted ones) is what keeps thread restore lazy: only the active
 * tab's native `WebContentsView` is ever created/shown.
 */
export function selectActiveBrowserTab(
  browserTabs: readonly BrowserFixedPanelTab[],
  activeBrowserTabId: string | null,
): BrowserFixedPanelTab | null {
  if (activeBrowserTabId === null) {
    return null;
  }
  return browserTabs.find((tab) => tab.id === activeBrowserTabId) ?? null;
}

/**
 * Mounts only the active browser tab's content. Inactive persisted tabs remain
 * tab metadata until selected, so restoring a thread never eagerly creates and
 * loads a batch of hidden native `WebContentsView`s from stale persisted URLs.
 *
 * The native view manager keeps already-created views keyed by tab id, so
 * switching away unmounts the React content and hides the native view without
 * destroying the page. A tab's view is torn down when it leaves this thread's
 * open-tab list; thread navigation only unmounts this deck, so retained views
 * stay alive for when the user returns.
 *
 * When no browser tab is the active panel tab, React content unmounts but the
 * native views remain retained and hidden by their component cleanup.
 */
export function BrowserTabDeck({
  browserTabs,
  activeBrowserTabId,
  addressFocusRequest = null,
  onAddressFocusRequestConsumed,
  environmentId,
  canShowNativeBrowserView,
  showChrome = true,
  threadId,
  onUpdate,
  onFavicon,
  onLoadingChange,
}: BrowserTabDeckProps) {
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  const previousTabIdsRef = useRef<BrowserTabIdSnapshot | null>(null);
  const visibilityCoordinator = useMemo(
    () =>
      desktopBrowser === null
        ? null
        : createBrowserViewVisibilityCoordinator(desktopBrowser),
    [desktopBrowser],
  );

  useEffect(() => {
    const tabIds = buildBrowserTabIdSet({ browserTabs });
    const previous = previousTabIdsRef.current;
    if (
      desktopBrowser !== null &&
      previous !== null &&
      previous.threadId === threadId
    ) {
      for (const tabId of previous.tabIds) {
        if (!tabIds.has(tabId)) {
          destroyPersistedBrowserView({ desktopBrowser, tabId });
        }
      }
    }
    previousTabIdsRef.current = { tabIds, threadId };
  }, [browserTabs, desktopBrowser, threadId]);

  const activeBrowserTab = selectActiveBrowserTab(
    browserTabs,
    activeBrowserTabId,
  );
  if (activeBrowserTab === null) {
    return null;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-sidebar">
      <BrowserTabContent
        key={activeBrowserTab.id}
        tabId={activeBrowserTab.id}
        initialUrl={activeBrowserTab.url}
        addressFocusRequest={
          addressFocusRequest?.tabId === activeBrowserTab.id
            ? addressFocusRequest
            : null
        }
        onAddressFocusRequestConsumed={onAddressFocusRequestConsumed}
        canShowNativeBrowserView={canShowNativeBrowserView}
        visibilityCoordinator={visibilityCoordinator}
        environmentId={environmentId}
        showChrome={showChrome}
        threadId={threadId}
        onUpdate={onUpdate}
        onFavicon={onFavicon}
        onLoadingChange={onLoadingChange}
      />
    </div>
  );
}
