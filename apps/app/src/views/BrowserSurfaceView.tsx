import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtom } from "jotai";
import { useLocation, useNavigate } from "react-router-dom";
import { BrowserTabDeck } from "@/components/secondary-panel/BrowserTabDeck";
import type {
  BrowserTabFaviconArgs,
  BrowserTabLoadingArgs,
} from "@/components/secondary-panel/BrowserTabContent";
import type { UpdateBrowserTabArgs } from "@/components/secondary-panel/useThreadFileTabs";
import { BrowserDevToolsPanel } from "@/components/browser-surface/BrowserDevToolsPanel";
import { BrowserFindBar } from "@/components/browser-surface/BrowserFindBar";
import { BrowserSurfaceChrome } from "@/components/browser-surface/BrowserSurfaceChrome";
import { BrowserSurfaceTabStrip } from "@/components/browser-surface/BrowserSurfaceTabStrip";
import { BrowserTabSwitcher } from "@/components/browser-surface/BrowserTabSwitcher";
import { BROWSER_SELECT_TAB_APP_COMMAND_IDS } from "@patcher/domain";
import {
  useAppCommandHandler,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import {
  resolvePluginExternalLink,
  runPluginContextMenuItem,
  runPluginFindAction,
  runPluginTabAction,
  usePluginContributions,
} from "@/hooks/queries/plugin-contribution-queries";
import {
  closeDesktopWindow,
  getDesktopBrowserApi,
} from "@/lib/patcher-desktop";
import { browserFaviconsAtom, setBrowserFavicon } from "@/lib/browser-favicons";
import {
  browserMutedTabsAtom,
  withBrowserTabMuted,
} from "@/lib/browser-tab-mute";
import {
  forgetPluginBrowserTabStatuses,
  usePluginBrowserTabStatuses,
} from "@/lib/plugin-browser-tab-status";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { buildBrowserSearchUrl } from "@patcher/domain/browser-search-engine";
import { useBrowserSearchEngine } from "@/lib/browser-search-engine";
import { useBrowserFind } from "@/lib/browser-find";
import { useBrowserHistorySearch } from "@/lib/browser-history";
import {
  BROWSER_ZOOM_DEFAULT_FACTOR,
  clampBrowserZoomFactor,
  stepBrowserZoomFactor,
} from "@/lib/browser-zoom";
import { useBrowserTabCycling } from "@/lib/browser-tab-mru";
import {
  BROWSER_SURFACE_SCOPE_ID,
  closeBrowserSurfaceTab,
  getActiveBrowserSurfaceTab,
  isPinnedSurfaceTab,
  isWebSurfaceTab,
  useBrowserSurfaceTabs,
  type BrowserSurfaceTab,
} from "@/lib/browser-surface-tabs";
import {
  PATCHER_APP_TAB_DESTINATIONS,
  resolveSurfaceTabRoute,
} from "@/lib/app-surface-tabs";
import { getPluginPanelRoutePath, isRoutePath } from "@/lib/route-paths";
import { usePluginSlots } from "@/lib/plugin-slots";
import {
  createOmniboxAppRouteProvider,
  createOmniboxHistoryProvider,
  createOmniboxNavigationProvider,
  createOmniboxOpenTabsProvider,
  createOmniboxPluginProviders,
  createOmniboxSearchProvider,
  createPluginOmniboxSuggestionSource,
} from "@/lib/omnibox";

/**
 * The browser as a top-level surface rather than a panel inside a thread.
 *
 * The Electron layer is reused unchanged: `BrowserTabDeck` mounts only the
 * active tab's `BrowserTabContent`, which owns the native `WebContentsView`
 * bounds sync, the resize snapshot and the load-error screens. What this view
 * adds is thread-independent tab ownership, a tab strip, and the omnibox chrome
 * — so the deck's own address bar is turned off (`showChrome={false}`).
 *
 * `threadId` here is the deck's opaque scope key, not a thread — see
 * `BROWSER_SURFACE_SCOPE_ID`. `environmentId` is null because a surface tab
 * belongs to no workspace.
 *
 * On desktop the view is **hosted by `AppLayout` rather than by a route**, so it
 * holds the main area for every route: the agent screens paint in the side panel
 * beside it, and Patcher's own destinations paint inside it as {@link
 * BrowserSurfaceViewProps.appScreen}. Nothing displaces it, which is why there is
 * no longer an inactive state to keep correct.
 */
export interface BrowserSurfaceViewProps {
  /**
   * The Patcher screen the window is currently routed to — Settings, Extensions, a
   * plugin's panel — rendered in place of the page area when present.
   *
   * Route-driven rather than read off the active tab, and deliberately: the two
   * agree within a commit, but the strip is corrected by an effect, so painting
   * from the tab would show the page the user just left for one frame. What the
   * strip decides is which tab is *highlighted*; what this decides is what is on
   * screen.
   */
  appScreen?: ReactNode;
}

export function BrowserSurfaceView({
  appScreen = null,
}: BrowserSurfaceViewProps = {}) {
  const {
    activateTab,
    activeWebTab,
    adoptTab,
    closeTab,
    duplicateTab,
    ensureWebTab,
    moveTab,
    openTab,
    reopenClosedTab,
    setTabPinned,
    state,
    updateTab,
    webTabs,
  } = useBrowserSurfaceTabs();
  const searchBrowserHistory = useBrowserHistorySearch();
  // The chosen search engine: what the omnibox's own search row and the page
  // menu's "Search for …" both send a query to.
  const searchEngine = useBrowserSearchEngine();
  const navigate = useNavigate();
  const showsAppScreen = appScreen !== null;
  const webTabCount = webTabs.length;

  useEffect(() => {
    // The surface is never without a page: an empty-URL tab shows the new-tab
    // screen, which is also what the user gets after closing the last one. App
    // tabs do not count — a strip holding only Settings still owes the browser
    // somewhere to go.
    //
    // In the background, so closing the last page while reading Settings does
    // not throw the user out of Settings: the replacement is a page to come
    // back to, not one being asked for.
    if (webTabCount === 0) {
      ensureWebTab();
    }
  }, [ensureWebTab, webTabCount]);

  const location = useLocation();
  const currentPath = `${location.pathname}${location.search}`;
  /**
   * Tab selection, with the navigation it implies. Every entry point goes
   * through here — the strip, the switcher, Cmd+1..8, the MRU cycle, the
   * omnibox — because a tab that cannot paint where the window is standing is
   * not selected, it is merely highlighted.
   */
  const goToTabRoute = useCallback(
    (tab: BrowserSurfaceTab | null) => {
      const route = resolveSurfaceTabRoute({
        isOnAppTabRoute: showsAppScreen,
        tab,
      });
      // Already there is not a navigation: re-selecting the active tab, or
      // closing a background one, would otherwise push a duplicate history
      // entry and make Back do nothing visible.
      if (route !== null && route !== currentPath) {
        void navigate(route);
      }
    },
    [currentPath, navigate, showsAppScreen],
  );

  const activateSurfaceTab = useCallback(
    (tabId: string) => {
      activateTab(tabId);
      goToTabRoute(state.tabs.find((tab) => tab.id === tabId) ?? null);
    },
    [activateTab, goToTabRoute, state.tabs],
  );

  const openSurfaceTab = useCallback(
    (url?: string) => {
      const tab = openTab(url);
      goToTabRoute(tab);
      return tab;
    },
    [goToTabRoute, openTab],
  );

  // Page icons live for this window's session, deliberately — see
  // `browser-favicons.ts` for why they are not stored with the tabs. The deck
  // mounts only the active tab, so the strip shows an icon for every tab visited
  // since the app started and its generic mark for the rest.
  const [favicons, setFavicons] = useAtom(browserFaviconsAtom);
  // Which tabs the user silenced — window session state, for the reasons in
  // `browser-tab-mute.ts`.
  const [mutedTabIds, setMutedTabIds] = useAtom(browserMutedTabsAtom);

  const dropFavicon = useCallback(
    (tabId: string) => {
      setFavicons((current) =>
        setBrowserFavicon(current, { dataUrl: null, tabId }),
      );
    },
    [setFavicons],
  );

  const closeSurfaceTab = useCallback(
    (tabId: string) => {
      // Whoever inherits the strip decides where the window goes; the reducer is
      // pure, so asking it here costs nothing and keeps the successor rule in
      // one place.
      const remaining = closeBrowserSurfaceTab(state, tabId);
      // An empty strip is a window with nothing to show, so it goes — which is
      // what closing the last tab does in every other browser. Decided here
      // rather than from an effect watching the count, because the effect that
      // guarantees a page would race it and reopen one.
      if (remaining.tabs.length === 0 && closeDesktopWindow()) {
        return;
      }
      closeTab(tabId);
      dropFavicon(tabId);
      // A tab id is never reused, so its mute and any plugin mark on it would
      // otherwise sit in window state for nothing.
      setMutedTabIds((current) =>
        withBrowserTabMuted(current, { muted: false, tabId }),
      );
      forgetPluginBrowserTabStatuses(tabId);
      goToTabRoute(getActiveBrowserSurfaceTab(remaining));
    },
    [closeTab, dropFavicon, goToTabRoute, setMutedTabIds, state],
  );

  // Duplicating focuses the copy, so the window has to follow it — same rule as
  // opening one.
  const duplicateSurfaceTab = useCallback(
    (tabId: string) => {
      goToTabRoute(duplicateTab(tabId));
    },
    [duplicateTab, goToTabRoute],
  );

  /**
   * Silence a tab's page.
   *
   * The record is the renderer's and the effect is the shell's, so both are set
   * here; a tab whose view does not exist yet keeps the record and gets the call
   * when it does (see the effect below).
   */
  const setSurfaceTabMuted = useCallback(
    ({ muted, tabId }: { muted: boolean; tabId: string }) => {
      setMutedTabIds((current) =>
        withBrowserTabMuted(current, { muted, tabId }),
      );
      getDesktopBrowserApi()?.setMuted?.({ muted, tabId });
    },
    [setMutedTabIds],
  );

  const handleUpdate = useCallback(
    ({ tabId, title, url }: UpdateBrowserTabArgs) => {
      updateTab({ tabId, title, url });
    },
    [updateTab],
  );

  const handleOpen = useCallback(() => {
    openSurfaceTab();
  }, [openSurfaceTab]);

  // Popups (`window.open`, `target="_blank"`) become a new surface tab. The
  // shell denies every native popup and pushes the request to the renderer
  // instead, so a route with no subscriber is a link that does nothing at all.
  //
  // The scoped channel names the tab that asked, which is what keeps a thread
  // panel's popups out of the surface; the unscoped one is the fallback for a
  // shell that predates attribution, where a route path belongs to
  // `RouteNavigationProvider` rather than here.
  const surfaceTabIds = useMemo(
    () => new Set(webTabs.map((tab) => tab.id)),
    [webTabs],
  );
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi === null) {
      return;
    }
    if (browserApi.onScopedOpenTab) {
      return browserApi.onScopedOpenTab(({ tabId, url }) => {
        if (surfaceTabIds.has(tabId)) {
          openSurfaceTab(url);
        }
      });
    }
    return browserApi.onOpenTab(({ url }) => {
      if (isRoutePath({ path: url })) {
        return;
      }
      openSurfaceTab(url);
    });
  }, [openSurfaceTab, surfaceTabIds]);

  // The current `openSurfaceTab`, for the drain below: it runs for the life of
  // the surface, and this identity changes every time the route does.
  const openSurfaceTabRef = useRef(openSurfaceTab);
  useEffect(() => {
    openSurfaceTabRef.current = openSurfaceTab;
  }, [openSurfaceTab]);

  // Links macOS handed the shell because Patcher is the user's default browser. A
  // pull rather than a subscription, and that is the shape the cold start
  // forces: the click that launched Patcher was delivered to the main process before
  // this renderer existed, so the queue is drained here on mount, and again on
  // every nudge saying more arrived while the app was running.
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    const takeExternalUrls = browserApi?.takeExternalUrls;
    if (browserApi === null || takeExternalUrls === undefined) {
      return;
    }
    let mounted = true;
    const drain = (): void => {
      void takeExternalUrls
        .call(browserApi)
        .then(async (urls) => {
          for (const url of urls) {
            // Plugins get the link before it becomes a tab: this is the routing
            // seam the "which browser opens what" apps exist for, and it only
            // exists while Patcher is the default browser. Nobody deciding —
            // including a server that is not listening — opens the link
            // unchanged.
            const decision = await resolvePluginExternalLink(url);
            // A surface that went away between asking and answering drops what
            // it took: opening a tab from here would navigate a window that is
            // gone.
            if (!mounted || decision?.handled === true) {
              continue;
            }
            openSurfaceTabRef.current(decision?.url ?? url);
          }
        })
        // The queue is already empty by the time anything here can fail, so a
        // failure is only ever a link that does not open — never an unhandled
        // rejection in the surface.
        .catch(() => undefined);
    };
    drain();
    const unsubscribe = browserApi.onExternalUrlsPending?.(drain);
    return () => {
      mounted = false;
      unsubscribe?.();
    };
    // Mount to unmount, deliberately: `takeExternalUrls` empties the shell's
    // queue, so a re-run mid-drain would flip `mounted` and drop the links this
    // surface has already taken. `openSurfaceTab` changes identity with the
    // route — which the first link opening from an app tab does — so it is read
    // through a ref rather than depended on.
  }, []);

  // Real popups. This surface claims them for its own tabs: it owns them, so it
  // can host a window Chromium created — which is what gives a page back the
  // handle `window.open()` returns and the `window.opener` an OAuth flow talks
  // to. The thread panel deliberately claims nothing: there a link follows the
  // user's in-app-link preference and may leave for the system browser, where
  // an opener means nothing.
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.setPopupTabs === undefined) {
      return;
    }
    browserApi.setPopupTabs({ tabIds: [...surfaceTabIds] });
  }, [surfaceTabIds]);

  // What each tab's zoom actually is, as the shell reports it. Kept rather than
  // derived because zoom changes from both ends: the user steps it, and
  // Chromium restores a site's remembered zoom when a tab navigates there.
  const [zoomFactors, setZoomFactors] = useState<Record<string, number>>({});
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.onZoom === undefined) {
      return;
    }
    return browserApi.onZoom(({ tabId, factor }) => {
      setZoomFactors((current) =>
        current[tabId] === factor ? current : { ...current, [tabId]: factor },
      );
    });
  }, []);

  // Which tabs are on a certificate a human waved through, as the shell reports
  // it. Kept per tab rather than read at mount for the reason the zoom record is:
  // the push comes once per navigation, and a tab switched back to must not
  // re-earn a claim the browser already knows is false.
  const [certificateTrustedTabIds, setCertificateTrustedTabIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.onPageSecurity === undefined) {
      return;
    }
    return browserApi.onPageSecurity(({ certificateTrustedByUser, tabId }) => {
      setCertificateTrustedTabIds((current) => {
        if (current.has(tabId) === certificateTrustedByUser) {
          return current;
        }
        const next = new Set(current);
        if (certificateTrustedByUser) {
          next.add(tabId);
        } else {
          next.delete(tabId);
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.onPopup === undefined) {
      return;
    }
    return browserApi.onPopup((popup) => {
      if (popup.kind === "closed") {
        // The page closed its own popup, which is how every OAuth flow ends.
        closeTab(popup.tabId);
        dropFavicon(popup.tabId);
        return;
      }
      if (surfaceTabIds.has(popup.openerTabId)) {
        adoptTab({ tabId: popup.tabId, url: popup.url });
      }
    });
  }, [adoptTab, closeTab, dropFavicon, surfaceTabIds]);

  // "Search for <selection>" from a page's context menu. The shell sends the
  // query rather than a URL, because the search engine is the omnibox's and
  // only the renderer knows it.
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.onSearchSelection === undefined) {
      return;
    }
    return browserApi.onSearchSelection(({ query, tabId }) => {
      if (surfaceTabIds.has(tabId)) {
        openSurfaceTab(buildBrowserSearchUrl(query, searchEngine.urlTemplate));
      }
    });
  }, [openSurfaceTab, searchEngine.urlTemplate, surfaceTabIds]);

  // Plugin context-menu entries. Declared up front and handed to the shell, so
  // a right-click composes its menu without waiting on the server; the click is
  // what travels back.
  const contributedMenuItems =
    usePluginContributions().data?.browserContextMenuItems;
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.setContextMenuItems === undefined) {
      return;
    }
    browserApi.setContextMenuItems({
      items: (contributedMenuItems ?? []).map((item) => ({
        pluginId: item.pluginId,
        itemId: item.itemId,
        title: item.title,
        when: item.when,
      })),
    });
  }, [contributedMenuItems]);

  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.onContextMenuInvoke === undefined) {
      return;
    }
    return browserApi.onContextMenuInvoke((invoke) => {
      if (!surfaceTabIds.has(invoke.tabId)) {
        return;
      }
      void runPluginContextMenuItem(invoke);
    });
  }, [surfaceTabIds]);

  // Plugin entries on a tab's own menu, and plugin marks on the tabs themselves —
  // the two halves of Phase 8's tab surface. The entries are declared and come
  // from the server; the marks are set live by a plugin's frontend, so they are
  // read from the renderer store rather than fetched.
  const contributedTabActions =
    usePluginContributions().data?.browserTabActions;
  const pluginTabStatuses = usePluginBrowserTabStatuses();

  // Re-assert every mute whenever the strip's active tab changes.
  //
  // Mute lives on a `webContents`, and the deck creates one only when its tab is
  // first shown — so a tab muted before it was ever opened has nothing to
  // silence at the time. The deck is a child of this view, and React runs child
  // effects first, so by the time this runs the newly-active tab's view exists.
  // Every other call in the loop is a no-op the shell drops.
  useEffect(() => {
    const setMuted = getDesktopBrowserApi()?.setMuted;
    if (setMuted === undefined) {
      return;
    }
    for (const tabId of mutedTabIds) {
      setMuted({ muted: true, tabId });
    }
  }, [mutedTabIds, state.activeTabId]);

  const runTabAction = useCallback(
    ({
      action,
      tabId,
    }: {
      action: { itemId: string; pluginId: string };
      tabId: string;
    }) => {
      const tab = state.tabs.find((one) => one.id === tabId);
      if (tab === undefined) {
        return;
      }
      void runPluginTabAction({
        active: state.activeTabId === tabId,
        itemId: action.itemId,
        muted: mutedTabIds.has(tabId),
        pinned: isPinnedSurfaceTab(tab),
        pluginId: action.pluginId,
        tabId,
        // Null says "a Patcher screen" — a tab with no page at all, which is what an
        // action has to be able to tell apart from a tab with no page *yet*.
        title: tab.title,
        url: isWebSurfaceTab(tab) ? tab.url : null,
      });
    },
    [mutedTabIds, state.activeTabId, state.tabs],
  );

  // Which tabs are loading, so the strip can spin in place of the icon. Only the
  // mounted (active) tab reports, and it reports "not loading" on unmount.
  const [loadingTabIds, setLoadingTabIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const handleLoadingChange = useCallback(
    ({ isLoading, tabId }: BrowserTabLoadingArgs) => {
      setLoadingTabIds((current) => {
        if (current.has(tabId) === isLoading) {
          return current;
        }
        const next = new Set(current);
        if (isLoading) {
          next.add(tabId);
        } else {
          next.delete(tabId);
        }
        return next;
      });
    },
    [],
  );
  const handleFavicon = useCallback(
    ({ dataUrl, tabId }: BrowserTabFaviconArgs) => {
      setFavicons((current) => setBrowserFavicon(current, { dataUrl, tabId }));
    },
    [setFavicons],
  );
  // Icons outlive their tab now that they are stored, so closing one has to take
  // its icon with it. Done on the close rather than by reconciling the map
  // against the open tabs: that reconcile runs on every change to the strip,
  // including the commit where a restored tab list has not landed yet, and it
  // wiped every icon it could not yet see a tab for.

  // Patcher's own destinations, plus every panel a plugin registered. The panels ride
  // the same list rather than a parallel mechanism, so a plugin's screen is
  // reachable from the address bar on the same terms as Settings.
  const { navPanels } = usePluginSlots();
  const appRoutes = useMemo(
    () => [
      ...PATCHER_APP_TAB_DESTINATIONS,
      ...navPanels.map((panel) => ({
        id: `plugin:${panel.pluginId}/${panel.path}`,
        keywords: [panel.title, panel.pluginId],
        path: getPluginPanelRoutePath({
          pluginId: panel.pluginId,
          path: panel.path,
        }),
        subtitle: "Plugin panel",
        title: panel.title,
      })),
    ],
    [navPanels],
  );

  const openAppRoute = useCallback(
    (path: string) => {
      void navigate(path);
    },
    [navigate],
  );

  // One shared request per query across every plugin provider; stable for the
  // life of the surface so it can dedupe consecutive runs. A lazy `useState`
  // initializer rather than a ref read during render, which is the same "build
  // it once" but without reading `.current` where React cannot see it.
  const [pluginSuggestionSource] = useState(
    createPluginOmniboxSuggestionSource,
  );
  const contributedOmniboxProviders =
    usePluginContributions().data?.omniboxProviders;

  // Registration order is the tie-break for equal scores, so the two providers
  // that own the default action come first and plugins come last — a plugin
  // cannot outrank the browser's own default action. Rebuilding this list as
  // tabs, history or installed plugins change does not disturb a query in
  // flight — see `useOmnibox`.
  const omniboxProviders = useMemo(
    () => [
      createOmniboxNavigationProvider(),
      createOmniboxSearchProvider({
        searchUrlTemplate: searchEngine.urlTemplate,
      }),
      createOmniboxOpenTabsProvider({
        activeTabId: state.activeTabId,
        tabs: webTabs,
      }),
      createOmniboxHistoryProvider({ search: searchBrowserHistory }),
      createOmniboxAppRouteProvider({ routes: appRoutes }),
      ...createOmniboxPluginProviders({
        contributions: contributedOmniboxProviders ?? [],
        source: pluginSuggestionSource,
      }),
    ],
    [
      appRoutes,
      contributedOmniboxProviders,
      pluginSuggestionSource,
      searchBrowserHistory,
      searchEngine.urlTemplate,
      state.activeTabId,
      webTabs,
    ],
  );

  // Browser tab commands. Registered here because this is what owns the tabs;
  // the chrome owns only the address bar and its reload.
  const tabIds = useMemo(() => state.tabs.map((tab) => tab.id), [state.tabs]);
  const { cycleRecentTab, selectSwitcherTab, switcher } = useBrowserTabCycling({
    activateTab: activateSurfaceTab,
    activeTabId: state.activeTabId,
    tabIds,
  });
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);

  const isSwitcherOpen = switcher !== null;
  const activeWebTabId = activeWebTab?.id ?? null;
  // Everything the surface draws over the page area goes through one overlay,
  // because there is one page to freeze: two owners writing `setOverlay` for the
  // same tab would have the second one's close thaw the first one's panel. Which
  // is why the chrome's own panels arrive here as a flag instead of a call.
  const [isTabMenuOpen, setIsTabMenuOpen] = useState(false);
  const [isChromePanelOpen, setIsChromePanelOpen] = useState(false);
  const needsPageOverlay = isSwitcherOpen || isTabMenuOpen || isChromePanelOpen;
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.setOverlay === undefined || activeWebTabId === null) {
      return;
    }
    browserApi.setOverlay({ tabId: activeWebTabId, active: needsPageOverlay });
    return () => {
      browserApi.setOverlay?.({ tabId: activeWebTabId, active: false });
    };
  }, [activeWebTabId, needsPageOverlay]);

  // Find in page. Owned here rather than by the chrome because the bar takes a
  // strip of layout of its own — the page below it shrinks while it is open.
  const find = useBrowserFind({
    tabId: activeWebTab?.id ?? null,
    url: activeWebTab?.url ?? "",
  });
  const contributedFindActions =
    usePluginContributions().data?.browserFindActions;
  const runFindAction = useCallback(
    (action: { itemId: string; pluginId: string }) => {
      if (activeWebTab === null) {
        return;
      }
      void runPluginFindAction({
        itemId: action.itemId,
        pageUrl: activeWebTab.url,
        pluginId: action.pluginId,
        query: find.query,
        tabId: activeWebTab.id,
      });
    },
    [activeWebTab, find.query],
  );
  // Declined on an app screen so the chord falls through to whatever that screen
  // does with it: there is no page to search, and a find bar over one would be a
  // control wired to nothing.
  useAppCommandHandler("browser.find", () =>
    activeWebTab === null ? false : find.open(),
  );

  // Give the page the whole window. Offered only while the app window is
  // already full screen: covering the tab strip and the omnibox in an ordinary
  // window would leave the user with a page and no browser around it, and no
  // obvious way back. In an ordinary window the chord does nothing, which is
  // what a browser does with a shortcut that does not apply.
  const windowState = useDesktopWindowState();
  const [isPageFullscreen, setIsPageFullscreen] = useState(false);
  const setTabFullscreen = useCallback(
    (fullscreen: boolean) => {
      const browserApi = getDesktopBrowserApi();
      if (browserApi?.setFullscreen === undefined || activeWebTab === null) {
        return false;
      }
      browserApi.setFullscreen({ tabId: activeWebTab.id, fullscreen });
      setIsPageFullscreen(fullscreen);
      return true;
    },
    [activeWebTab],
  );
  useAppCommandHandler("browser.fullscreen.toggle", () => {
    if (!windowState.isFullScreen) {
      return false;
    }
    return setTabFullscreen(!isPageFullscreen);
  });
  // Leaving the window's own full screen takes the page's with it — otherwise a
  // view sized to the whole window would stay over the chrome of a normal one.
  useEffect(() => {
    if (!windowState.isFullScreen && isPageFullscreen) {
      setTabFullscreen(false);
    }
  }, [isPageFullscreen, setTabFullscreen, windowState.isFullScreen]);

  // ...and so does switching tabs: the expansion belongs to the tab it was
  // asked for, and a tab left expanded would come back that way over a strip
  // the user can no longer see.
  useEffect(() => {
    if (activeWebTabId === null) {
      return;
    }
    return () => {
      getDesktopBrowserApi()?.setFullscreen?.({
        tabId: activeWebTabId,
        fullscreen: false,
      });
      setIsPageFullscreen(false);
    };
  }, [activeWebTabId]);

  // Chromium's own DevTools, per tab as in Chromium: switching tabs hides one
  // tab's tools and shows the other's, and the shell reports both directions
  // because "Inspect" and the tools' own close button are not this app's doing.
  const [devToolsTabIds, setDevToolsTabIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  useEffect(() => {
    const browserApi = getDesktopBrowserApi();
    if (browserApi?.onDevToolsState === undefined) {
      return;
    }
    return browserApi.onDevToolsState(({ open, tabId }) => {
      setDevToolsTabIds((current) => {
        if (current.has(tabId) === open) {
          return current;
        }
        const next = new Set(current);
        if (open) {
          next.add(tabId);
        } else {
          next.delete(tabId);
        }
        return next;
      });
    });
  }, []);
  const isDevToolsOpen =
    activeWebTab !== null && devToolsTabIds.has(activeWebTab.id);
  const setDevToolsOpen = useCallback(
    (open: boolean) => {
      const browserApi = getDesktopBrowserApi();
      if (browserApi?.setDevTools === undefined || activeWebTab === null) {
        return false;
      }
      // Opening carries an empty rect: the panel is not mounted yet, and it
      // pushes the real one as soon as it is. The shell answers
      // `devtools-opened` either way, which is what mounts it.
      browserApi.setDevTools({
        tabId: activeWebTab.id,
        open,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      });
      return true;
    },
    [activeWebTab],
  );
  const closeDevTools = useCallback(() => {
    setDevToolsOpen(false);
  }, [setDevToolsOpen]);
  useAppCommandHandler("browser.devTools.toggle", () =>
    setDevToolsOpen(!isDevToolsOpen),
  );

  useAppCommandHandler("browser.newTab", () => {
    openSurfaceTab();
    return true;
  });
  useAppCommandHandler("browser.closeTab", () => {
    if (state.activeTabId === null) {
      return false;
    }
    closeSurfaceTab(state.activeTabId);
    return true;
  });
  // Zoom belongs to the tab, and its current value belongs to the shell: a site
  // the user zoomed before comes back zoomed without anyone asking, so the
  // steps walk from what the shell last reported rather than from a count kept
  // here.
  const stepZoom = useCallback(
    (next: (current: number) => number) => {
      const tabId = activeWebTab?.id;
      const setZoom = getDesktopBrowserApi()?.setZoom;
      if (tabId === undefined || setZoom === undefined) {
        return false;
      }
      setZoom({
        tabId,
        factor: clampBrowserZoomFactor(
          next(zoomFactors[tabId] ?? BROWSER_ZOOM_DEFAULT_FACTOR),
        ),
      });
      return true;
    },
    [activeWebTab?.id, zoomFactors],
  );

  useAppCommandHandler("browser.zoomIn", () =>
    stepZoom((current) => stepBrowserZoomFactor(current, "in")),
  );
  useAppCommandHandler("browser.zoomOut", () =>
    stepZoom((current) => stepBrowserZoomFactor(current, "out")),
  );
  useAppCommandHandler("browser.zoomReset", () =>
    stepZoom(() => BROWSER_ZOOM_DEFAULT_FACTOR),
  );

  useAppCommandHandler("browser.print", () => {
    const tabId = activeWebTab?.id;
    const print = getDesktopBrowserApi()?.print;
    if (tabId === undefined || print === undefined) {
      return false;
    }
    print({ tabId });
    return true;
  });

  useAppCommandHandler("browser.reopenClosedTab", () => {
    reopenClosedTab();
    return true;
  });
  useAppCommandHandler("browser.selectLastTab", () => {
    const last = state.tabs.at(-1);
    if (last === undefined) {
      return false;
    }
    activateSurfaceTab(last.id);
    return true;
  });
  useAppCommandHandler("browser.recentTab.next", () => {
    cycleRecentTab(1);
    return true;
  });
  useAppCommandHandler("browser.recentTab.previous", () => {
    cycleRecentTab(-1);
    return true;
  });
  useAppCommandHandler("browser.goBack", () => {
    if (state.activeTabId === null || desktopBrowser === null) {
      return false;
    }
    desktopBrowser.goBack(state.activeTabId);
    return true;
  });
  useAppCommandHandler("browser.goForward", () => {
    if (state.activeTabId === null || desktopBrowser === null) {
      return false;
    }
    desktopBrowser.goForward(state.activeTabId);
    return true;
  });
  // Cmd+1..8 by position. A number past the last tab does nothing rather than
  // clamping, which is Chromium's behaviour and the one that never surprises.
  useIndexedAppCommandHandlers(BROWSER_SELECT_TAB_APP_COMMAND_IDS, (index) => {
    const tab = state.tabs[index];
    if (tab === undefined) {
      return false;
    }
    activateSurfaceTab(tab.id);
    return true;
  });

  return (
    // `data-app-browser` puts the whole surface in the browser command context,
    // so Cmd+L and Cmd+R work from the tab strip and chrome, not just from
    // inside the page. It covers an app screen too, which is what a browser
    // does: Cmd+T from Settings opens a tab. The handlers that need a page
    // decline when there is none, so the chord falls through instead of acting
    // on the wrong thing.
    <div data-app-browser className="relative flex h-full min-h-0 flex-col">
      <BrowserSurfaceTabStrip
        activeTabId={state.activeTabId}
        favicons={favicons}
        loadingTabIds={loadingTabIds}
        mutedTabIds={mutedTabIds}
        onActivate={activateSurfaceTab}
        onClose={closeSurfaceTab}
        onDuplicate={duplicateSurfaceTab}
        onMenuOpenChange={setIsTabMenuOpen}
        onMove={moveTab}
        onOpen={handleOpen}
        onRunTabAction={runTabAction}
        onSetMuted={setSurfaceTabMuted}
        onSetPinned={setTabPinned}
        pluginStatuses={pluginTabStatuses}
        tabActions={contributedTabActions}
        tabs={state.tabs}
      />
      {/* No address bar over an app screen: Patcher's own screens are not pages to
          type a URL into, and an omnibox that could not describe what is below
          it would be chrome pretending to drive something. */}
      {showsAppScreen || activeWebTab === null ? null : (
        <BrowserSurfaceChrome
          key={activeWebTab.id}
          certificateTrustedByUser={certificateTrustedTabIds.has(
            activeWebTab.id,
          )}
          onActivateTab={activateSurfaceTab}
          onOpenAppRoute={openAppRoute}
          onPageOverlayChange={setIsChromePanelOpen}
          providers={omniboxProviders}
          tabId={activeWebTab.id}
          url={activeWebTab.url}
        />
      )}
      {find.isOpen ? (
        <BrowserFindBar
          actions={contributedFindActions}
          focusToken={find.focusToken}
          matches={find.matches}
          onClose={find.close}
          onRunAction={runFindAction}
          onSearch={find.search}
          onStep={find.step}
          query={find.query}
        />
      ) : null}
      {switcher === null ? null : (
        <BrowserTabSwitcher
          favicons={favicons}
          onSelect={selectSwitcherTab}
          switcher={switcher}
          tabs={state.tabs}
        />
      )}
      {/* An app screen replaces the deck rather than covering it: a
          `WebContentsView` is an OS overlay no DOM node can paint over, so the
          page has to leave. Unmounting the deck is what takes it away — the tab
          content hides its native view on cleanup, and the view itself survives
          for when the tab comes back. */}
      {appScreen ?? (
        <BrowserTabDeck
          browserTabs={webTabs}
          activeBrowserTabId={state.activeTabId}
          environmentId={null}
          // The surface owns the whole page area whenever the deck is rendered
          // at all, so the native view may show as soon as it attaches — there
          // is no drawer animation to wait out.
          canShowNativeBrowserView={true}
          showChrome={false}
          threadId={BROWSER_SURFACE_SCOPE_ID}
          onUpdate={handleUpdate}
          onFavicon={handleFavicon}
          onLoadingChange={handleLoadingChange}
        />
      )}
      {isDevToolsOpen && activeWebTab !== null ? (
        <BrowserDevToolsPanel onClose={closeDevTools} tabId={activeWebTab.id} />
      ) : null}
    </div>
  );
}

export default BrowserSurfaceView;
