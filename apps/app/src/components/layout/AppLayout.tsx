import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type ReactNode,
} from "react";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useAtom, useStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import type { ProjectResponse } from "@patcher/server-contract";
import { Icon } from "@patcher/shared-ui/icon";
import { RESOURCE_ROUTE_LABEL_EVENT } from "@patcher/shared-ui/resource-list";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar.js";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { AgentPanelSidebar } from "@/components/sidebar/AgentPanelSidebar";
import { PluginLeadingPanel } from "./PluginLeadingPanel";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import { AppCommandShortcutHint } from "@/components/commands/AppCommandShortcutHint";
import { SettingsSidebar } from "@/components/settings/SettingsSidebar";
import { ToolsSidebar } from "@/components/tools/ToolsSidebar";
import { ToolsHubExperimentProvider } from "@/components/tools/tools-experiment-context";
import {
  resolveAutomationBreadcrumbs,
  resolveToolsBreadcrumbs,
} from "@/components/tools/tools-navigation";
import { AppBreadcrumbs } from "./AppBreadcrumbs";
import { resourceRouteLabelAtom } from "./resourceRouteLabelAtom";
import { AppPageHeader, HEADER_ICON_BUTTON_CLASS } from "./AppPageHeader";
import { stripProjectThreads } from "@/hooks/queries/project-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import {
  didThreadDetailBootstrapRefreshAfterMount,
  getLatestPendingInteraction,
  useThread,
  useThreadDetailBootstrap,
  useThreadPendingInteractions,
} from "@/hooks/queries/thread-queries";
import { useRouteState } from "@/hooks/useRouteState";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { applyResizeCursor, clearResizeCursor } from "@/lib/resizeCursor";
import { cn } from "@patcher/shared-ui/lib/utils";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import { ProjectActionsMenu } from "@/components/project/ProjectActionsMenu";
import { ProjectActionsProvider } from "@/components/project/ProjectActionsProvider";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "@/components/plugin/PluginPanelHeader";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { usePluginSlots, type PluginNavPanelSlot } from "@/lib/plugin-slots";
import { createLocalStorageSyncStorage } from "@/lib/browser-storage";
import { classifySurfaceRoute } from "@/lib/app-surface-tabs";
import { useBrowserSurfaceRouteSync } from "@/hooks/useBrowserSurfaceRouteSync";
import {
  CHROME_ROW_CLASS,
  getPatcherDesktopInfo,
  isDesktopBrowserAvailable,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
  SIDEBAR_TRIGGER_TRAILING_INSET_CLASS,
} from "@/lib/patcher-desktop";
import {
  BROWSER_SURFACE_ROUTE_PATH,
  getLegacyProjectComposeRoutePath,
  getProjectSettingsRoutePath,
  getRootComposeRoutePath,
  getThreadRoutePath,
  isProjectlessProjectId,
  isToolsRoutePath,
  PLUGIN_PANEL_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
} from "@/lib/route-paths";
import { useQuickCreateProjectController } from "@/hooks/useQuickCreateProject";
import { IframeDragGuardOverlay } from "@/lib/iframe-drag-guard";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import { useFaviconBadge } from "@/lib/favicon-color-preference";
import { shouldShowFaviconAttentionDot } from "./faviconAttentionDot";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
} from "@/components/commands/AppCommandProvider";
import { useIsCompactViewport } from "@patcher/shared-ui/hooks/use-compact-viewport";
import {
  shouldRestoreIOSViewportOnKeyboardDismissal,
  useMobileVisualViewportHeight,
} from "./useMobileVisualViewportHeight";
import { wsManager } from "@/lib/ws";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { findPaneByThread } from "@/lib/split-layout";
import { applyThreadOpenToLayout } from "@/views/thread-detail/splitThreadNavigation";
import { useThreadSplitsEnabled } from "@/hooks/useThreadSplitsEnabled";
import { useSplitWorkspaceActive } from "@/hooks/useSplitWorkspaceActive";
import { useAppSettingsRouteMemory } from "@/hooks/useAppSettingsRouteMemory";
import { useSystemConfig } from "@/hooks/queries/system-queries";

/**
 * Hosted here rather than behind its route: this is a browser, so the browser
 * surface is a region of the shell that outlives navigation, not a page the
 * router swaps in and out. Keeping it mounted keeps its tabs, omnibox draft,
 * find state and recently-used cycle alive while the user is elsewhere in the
 * app — the native `WebContentsView`s already survived, since only an explicit
 * tab close detaches one.
 *
 * Lazy for the same reason `App.tsx` loads it lazily; both specifiers resolve to
 * the one module, so this is the same chunk rather than a second copy.
 */
const BrowserSurfaceView = lazy(() => import("@/views/BrowserSurfaceView"));

const SIDEBAR_WIDTH_KEY = "patcher.sidebar.width";
const SIDEBAR_OPEN_KEY = "patcher.sidebar.open";
// The panel is no longer only a nav list: the agent screens (New thread, a
// thread) paint inside it, so it has to hold a conversation and a composer. The
// ceiling is raised well past the default so dragging the panel wide is a real
// option rather than a nudge; the floor stays where the nav list still reads.
const SIDEBAR_MIN_WIDTH = 240;
const SIDEBAR_MAX_WIDTH = 900;
/** The default never grows past this, however wide the display is. */
const SIDEBAR_DEFAULT_MAX_WIDTH = 400;

function clampSidebarWidth(value: number) {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

/**
 * A third of the window, capped — enough for a conversation on a laptop, and not
 * a third of an ultrawide on a large display.
 *
 * Read once at module load rather than tracked: this is only the fallback for a
 * panel whose width has never been dragged, and a stored width always wins. A
 * default that chased the window would move a panel the user never sized.
 */
export function resolveDefaultSidebarWidth(viewportWidth: number): number {
  return clampSidebarWidth(
    Math.min(Math.round(viewportWidth / 3), SIDEBAR_DEFAULT_MAX_WIDTH),
  );
}

const SIDEBAR_DEFAULT_WIDTH = resolveDefaultSidebarWidth(
  typeof window === "undefined" ? SIDEBAR_DEFAULT_MAX_WIDTH : window.innerWidth,
);

/**
 * Width for a live resize drag, clamped to the sidebar's range.
 *
 * The sidebar is on the window's trailing edge and its grab handle is on its
 * leading one, so dragging **left** widens it: the pointer delta is subtracted,
 * not added. Extracted and tested because flipping that sign is the kind of
 * regression that still "works" — the drag simply runs backwards.
 */
export function resolveSidebarResizeWidth({
  deltaX,
  startWidth,
}: {
  deltaX: number;
  startWidth: number;
}): number {
  return clampSidebarWidth(startWidth - deltaX);
}

const sidebarWidthStorage = createLocalStorageSyncStorage<number>({
  parse: (storedValue, initialValue) => {
    if (storedValue === null) {
      return initialValue;
    }
    const parsedValue = Number(storedValue);
    if (!Number.isFinite(parsedValue)) {
      return initialValue;
    }
    return clampSidebarWidth(parsedValue);
  },
  serialize: (value) => String(clampSidebarWidth(value)),
});
const sidebarWidthAtom = atomWithStorage<number>(
  SIDEBAR_WIDTH_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  sidebarWidthStorage,
  { getOnInit: true },
);

// Held in jotai (rather than as `useState` inside AppLayout) so that toggling
// the sidebar does not re-render AppLayout — only the small bridge below
// subscribes. AppLayout's `children` reference stays stable across toggles,
// so React's element-reference bailout skips re-rendering the entire route
// subtree (ThreadDetailView, the timeline, etc.).
const sidebarOpenStorage = createLocalStorageSyncStorage<boolean>({
  parse: (storedValue, initialValue) => {
    if (storedValue === "true") return true;
    if (storedValue === "false") return false;
    return initialValue;
  },
  serialize: (value) => String(value),
});
const sidebarOpenAtom = atomWithStorage<boolean>(
  SIDEBAR_OPEN_KEY,
  true,
  sidebarOpenStorage,
  { getOnInit: true },
);

interface SidebarStateBridgeProps {
  className?: string;
  providerRef: Ref<HTMLDivElement>;
  style: CSSProperties;
  /**
   * The panel is the only place this route paints. Collapsed, it would show
   * nothing at all, so entering such a route opens it — once, so the user can
   * still collapse it and stay collapsed while reading.
   */
  opensForRoute: boolean;
  children: ReactNode;
}

type SidebarResizeMouseEvent = ReactMouseEvent<HTMLDivElement>;
type SidebarOpenChangeHandler = (open: boolean) => void;

type SidebarProviderStyle = CSSProperties & {
  "--sidebar-width": string;
};

/**
 * Opening the panel, and the app's toggle chord — both inside the provider,
 * because both need to know which of its two open states is the panel right now.
 *
 * The sidebar keeps one state for the docked panel and another for the drawer it
 * becomes on a narrow window, and only the viewport says which applies. From
 * outside the provider — where the bridge below has to live, since it renders it
 * — only the docked one is reachable, and setting it on a narrow window opens
 * nothing: an agent screen would paint into a closed drawer and the route would
 * look like it had done nothing at all.
 */
function SidebarRouteOpener({ opensForRoute }: { opensForRoute: boolean }) {
  const { isCompactViewport, setOpen, setOpenMobile, toggleSidebar } =
    useSidebar();
  useAppCommandHandler("sidebar.toggle", () => {
    toggleSidebar();
    return true;
  });
  // Keyed on entering such a route, not on `open`: re-opening whenever the user
  // collapses would make the panel impossible to close while reading a thread.
  useEffect(() => {
    if (opensForRoute && !isCompactViewport) {
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entering the route is the trigger
  }, [opensForRoute]);
  // The drawer also opens when it *becomes* the panel, which the docked one has
  // no need of: the docked state is persisted, so widening a window restores
  // whatever the user last chose, while the drawer always starts closed. Without
  // the second trigger, narrowing a window while reading a thread would put the
  // thread behind the browser with no sign of where it went.
  useEffect(() => {
    if (opensForRoute && isCompactViewport) {
      setOpenMobile(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- entering the route, or the drawer becoming the panel, is the trigger
  }, [opensForRoute, isCompactViewport]);
  return null;
}

function SidebarStateBridge({
  className,
  providerRef,
  style,
  opensForRoute,
  children,
}: SidebarStateBridgeProps) {
  const [open, setOpen] = useAtom(sidebarOpenAtom);
  const handleOpenChange = useCallback<SidebarOpenChangeHandler>(
    (nextOpen) => {
      setOpen(nextOpen);
      window.requestAnimationFrame(dispatchBrowserViewBoundsSync);
    },
    [setOpen],
  );
  return (
    <SidebarProvider
      ref={providerRef}
      style={style}
      className={className}
      data-testid="app-layout-root"
      open={open}
      onOpenChange={handleOpenChange}
    >
      <SidebarRouteOpener opensForRoute={opensForRoute} />
      {children}
    </SidebarProvider>
  );
}

/**
 * Runs the route ↔ tab-strip sync without AppLayout subscribing to the tabs
 * atom, the same trick {@link SidebarStateBridge} uses: every tab title change
 * would otherwise re-render the whole route subtree.
 */
function BrowserSurfaceRouteSyncBridge({
  enabled,
  path,
  title,
}: {
  enabled: boolean;
  path: string | null;
  title: string;
}) {
  useBrowserSurfaceRouteSync({
    enabled,
    target: path === null ? null : { path, title },
  });
  return null;
}

function resetSidebarResizeDocumentState(): void {
  document.body.classList.remove("sidebar-resizing");
  clearResizeCursor();
  document.body.style.userSelect = "";
}

interface SidebarTriggerOverlayProps {
  usesDesktopChrome: boolean;
}

/**
 * Sidebar toggle pinned at the app's top-**right**, rendered once at the layout
 * root — outside the sliding sidebar panel and the content inset — so it holds a
 * constant position while the sidebar animates in/out behind it, instead of
 * riding whichever container would otherwise host it. Whatever chrome it covers
 * reserves its footprint as animated padding, so toggling slides that content
 * smoothly past it rather than snapping around a toggle that mounts/unmounts.
 *
 * It sits at the trailing end because that is the end the sidebar is on: a
 * toggle belongs next to the thing it toggles. That end used to be taken by the
 * thread's window-panel toggle; the agent screens moving into the side panel
 * took their header off the title-bar row and freed it.
 *
 * The macOS traffic lights keep the *leading* end whatever the sidebar does, so
 * unlike the left-hand version this one needs no offset for them, and one inset
 * serves desktop chrome and the web build alike.
 *
 * Desktop chrome keeps the strip a window-drag region; only the button itself
 * is no-drag, so the title strip above and below the (shorter) button stays
 * draggable rather than becoming an oversized dead zone.
 */
function SidebarTriggerOverlay({
  usesDesktopChrome,
}: SidebarTriggerOverlayProps) {
  const shortcut = useAppCommandShortcut("sidebar.toggle");
  const triggerProps = {
    "aria-label": shortcut
      ? `Toggle sidebar (${shortcut.label})`
      : "Toggle sidebar",
    "aria-keyshortcuts": shortcut?.ariaKeyshortcuts,
  };
  if (usesDesktopChrome) {
    return (
      <div
        data-testid="app-desktop-sidebar-trigger"
        className={cn(
          "fixed top-0 right-0 z-50",
          CHROME_ROW_CLASS,
          SIDEBAR_TRIGGER_TRAILING_INSET_CLASS,
          MACOS_WINDOW_DRAG_CLASS,
        )}
      >
        {/* The overlay's CHROME_ROW_CLASS box-centers the trigger on the shared
            traffic-light axis, matching the sidebar arrows and page-title
            header in desktop chrome. */}
        <SidebarTrigger
          className={MACOS_CHROME_CONTROL_NO_DRAG_CLASS}
          {...triggerProps}
        />
        {/* The hint trails the trigger, so at this end it goes to its left. */}
        <AppCommandShortcutHint
          shortcut={shortcut}
          className={cn(
            "absolute right-full mr-1",
            MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS,
          )}
        />
      </div>
    );
  }
  return (
    <div
      data-testid="app-sidebar-trigger-overlay"
      className={cn(
        "fixed top-[env(safe-area-inset-top)] right-[env(safe-area-inset-right)] z-50",
        CHROME_ROW_CLASS,
        SIDEBAR_TRIGGER_TRAILING_INSET_CLASS,
      )}
    >
      <SidebarTrigger {...triggerProps} />
      <AppCommandShortcutHint
        shortcut={shortcut}
        className="absolute right-full mr-1"
      />
    </div>
  );
}

const routeTitles: Record<string, { title: string; subtitle?: string }> = {
  "/": { title: "Patcher" },
  "/settings": { title: "Settings" },
  "/automations": { title: "Automations" },
  "/skills": { title: "Skills" },
};

function resolveRouteTitle(
  pathname: string,
): { title: string; subtitle?: string } | undefined {
  // The global settings page owns /settings/:section. Legacy plugin settings
  // links still match briefly before AppRoutes redirects them to Tools.
  if (matchPath(`${SETTINGS_ROUTE_PATH}/*`, pathname)) {
    return routeTitles[SETTINGS_ROUTE_PATH];
  }
  return routeTitles[pathname];
}

interface AppHeaderProps {
  /**
   * True for routes that should use quiet chrome. This suppresses the center
   * title; project-scoped quiet routes also get project actions on the right.
   */
  usesProjectChromeStyle: boolean;
  usesDesktopChrome: boolean;
  /**
   * True when this header is inside a browser tab rather than at the window top.
   * The tab strip above owns the title-bar row then — its chrome reserves, its
   * drag region — so this header must claim neither.
   */
  isInsideBrowserTab: boolean;
  isSettingsView: boolean;
  projectId?: string;
  project?: ProjectResponse;
  /** Registered navPanel when this is a plugin panel route (design §5.2):
   * the shared header shows plugin icon + title, plus the registration's
   * `headerContent` as the actions. */
  pluginPanel?: PluginNavPanelSlot;
  /** The panel route's splat remainder ("" at the panel root). */
  pluginPanelSubPath?: string;
  meta: {
    title: string;
    subtitle?: string;
    breadcrumbs?: Array<{ label: string; to?: string }>;
  };
}

function AppHeader({
  usesProjectChromeStyle,
  usesDesktopChrome,
  isInsideBrowserTab,
  isSettingsView,
  projectId,
  project,
  pluginPanel,
  pluginPanelSubPath,
  meta,
}: AppHeaderProps) {
  const headerBreadcrumbs = meta.breadcrumbs;
  const headerTitle =
    headerBreadcrumbs || usesProjectChromeStyle ? undefined : meta.title;

  const hasCenterContent =
    Boolean(headerBreadcrumbs) ||
    Boolean(headerTitle) ||
    Boolean(meta.subtitle);

  const center = headerBreadcrumbs ? (
    <div className="min-w-0 flex-1">
      <AppBreadcrumbs
        breadcrumbs={headerBreadcrumbs}
        usesDesktopChrome={usesDesktopChrome}
      />
    </div>
  ) : pluginPanel ? (
    <PluginPanelHeaderCenter panel={pluginPanel} />
  ) : hasCenterContent ? (
    <div className="min-w-0 flex-1">
      {headerTitle ? (
        <p className="truncate text-sm font-semibold">{headerTitle}</p>
      ) : null}
      {meta.subtitle ? (
        <p className="truncate text-xs text-muted-foreground">
          {meta.subtitle}
        </p>
      ) : null}
    </div>
  ) : null;

  const actions = pluginPanel ? (
    <PluginPanelHeaderActions
      panel={pluginPanel}
      subPath={pluginPanelSubPath ?? ""}
    />
  ) : usesProjectChromeStyle &&
    projectId &&
    !isProjectlessProjectId(projectId) ? (
    <>
      <Link
        to={getProjectSettingsRoutePath(projectId)}
        className={cn(
          HEADER_ICON_BUTTON_CLASS,
          "inline-flex items-center justify-center transition-colors",
          isSettingsView
            ? "bg-state-active text-foreground"
            : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
        )}
        aria-label="Project settings"
        aria-current={isSettingsView ? "page" : undefined}
      >
        <Icon name="Settings" />
      </Link>
      {project ? (
        <ProjectActionsMenu
          project={project}
          triggerClassName={HEADER_ICON_BUTTON_CLASS}
        />
      ) : null}
    </>
  ) : null;

  return (
    <AppPageHeader
      center={center}
      actions={actions}
      isWindowDragRegion={!isInsideBrowserTab}
      ownsWindowTopLeft={!isInsideBrowserTab}
      ownsWindowTopRight={!isInsideBrowserTab}
    />
  );
}

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const quickCreateProject = useQuickCreateProjectController();
  const isCompactViewport = useIsCompactViewport();
  const threadSplitsEnabled = useThreadSplitsEnabled();
  const splitWorkspaceActive = useSplitWorkspaceActive();
  const store = useStore();
  const contentShellRef = useRef<HTMLDivElement>(null);
  const restoreIOSViewportOnKeyboardDismissal = useMemo(
    () => shouldRestoreIOSViewportOnKeyboardDismissal(navigator),
    [],
  );
  useMobileVisualViewportHeight(
    contentShellRef,
    isCompactViewport,
    restoreIOSViewportOnKeyboardDismissal,
  );
  const location = useLocation();
  const [resourceRouteLabel, setResourceRouteLabel] = useAtom(
    resourceRouteLabelAtom,
  );
  useEffect(() => {
    setResourceRouteLabel(null);
    function handleResourceRouteLabel(event: Event) {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail;
      if (
        typeof detail !== "object" ||
        detail === null ||
        !("label" in detail) ||
        (typeof detail.label !== "string" && detail.label !== null)
      ) {
        return;
      }
      setResourceRouteLabel(detail.label);
    }
    window.addEventListener(
      RESOURCE_ROUTE_LABEL_EVENT,
      handleResourceRouteLabel,
    );
    return () => {
      window.removeEventListener(
        RESOURCE_ROUTE_LABEL_EVENT,
        handleResourceRouteLabel,
      );
    };
  }, [location.pathname, setResourceRouteLabel]);
  const navigate = useNavigate();
  const {
    appRoutePath,
    settingsRoutePath,
    toolsBackRoutePath,
    toolsRoutePath,
  } = useAppSettingsRouteMemory();
  useEffect(
    () =>
      wsManager.onThreadOpen((signal) => {
        const route = getThreadRoutePath({
          projectId: signal.projectId,
          threadId: signal.threadId,
        });
        if (!threadSplitsEnabled) {
          void navigate(route);
          return;
        }
        const current = store.get(splitLayoutAtom);
        const alreadyOpen =
          current !== null &&
          findPaneByThread(current.root, signal.projectId, signal.threadId) !==
            null;
        const next = applyThreadOpenToLayout(
          current,
          { projectId: signal.projectId, threadId: signal.threadId },
          isCompactViewport ? "replace" : signal.split,
        );
        if (next !== current) {
          store.set(splitLayoutAtom, next);
        }
        void navigate(route, alreadyOpen ? { replace: true } : undefined);
      }),
    [isCompactViewport, navigate, store, threadSplitsEnabled],
  );
  useAppCommandHandler("thread.new", () => {
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
    return true;
  });
  useAppCommandHandler("settings.open", () => {
    void navigate(settingsRoutePath);
    return true;
  });
  // Native server rail "+" tile.
  useAppCommandHandler("settings.openServers", () => {
    void navigate(`${SETTINGS_ROUTE_PATH}/servers`);
    return true;
  });
  const {
    projectId,
    threadId,
    isThreadView,
    isArchivedView,
    isSettingsView,
    isRootView,
  } = useRouteState();
  const archivedSectionId = isArchivedView
    ? new URLSearchParams(location.search).get("sectionId")
    : null;
  // Plugin panel routes ride the shared header (design §5.2): icon + panel
  // title in the center, the registration's headerContent as the actions.
  const { navPanels } = usePluginSlots();
  // Global settings routes swap the app sidebar for the settings sidebar.
  const isGlobalSettingsView =
    matchPath(`${SETTINGS_ROUTE_PATH}/*`, location.pathname) !== null;
  const systemConfigQuery = useSystemConfig();
  const toolsHubEnabled = systemConfigQuery.data?.experiments.toolsHub === true;
  const isGlobalToolsView =
    toolsHubEnabled && isToolsRoutePath(location.pathname);
  // The browser surface is chrome of its own: its tab strip takes the window's
  // title-bar row (reserving the pinned sidebar trigger the way a page header
  // would) and the page fills everything below, so the shell adds neither a
  // header nor content padding here.
  const isBrowserSurfaceView =
    matchPath(BROWSER_SURFACE_ROUTE_PATH, location.pathname) !== null;
  // The web build has no native views to keep alive and no shell to keep them
  // in, so it leaves the surface on its route — which is where its "needs the
  // desktop app" screen comes from. `App.tsx` reads the same gate to decide
  // whether that route still renders anything.
  const [hostsBrowserSurface] = useState(isDesktopBrowserAvailable);
  // Where this route paints, now that the browser holds the main area for all of
  // them. Desktop-only for the same reason as the surface itself: with no
  // browser to host them, the web build keeps every route in `main`.
  const surfaceRouteKind = classifySurfaceRoute(location.pathname);
  // The agent screens paint in the side panel rather than the main area, so the
  // browser can stay put underneath them.
  const isAgentPanelRoute =
    hostsBrowserSurface && surfaceRouteKind === "agent-panel";
  // ...and every remaining destination paints inside a browser tab.
  const isAppTabRoute = hostsBrowserSurface && surfaceRouteKind === "app-tab";
  const pluginPanelMatch = matchPath(
    PLUGIN_PANEL_ROUTE_PATH,
    location.pathname,
  );
  const pluginPanel = pluginPanelMatch
    ? navPanels.find(
        (candidate) =>
          candidate.pluginId === pluginPanelMatch.params.pluginId &&
          candidate.path === pluginPanelMatch.params.panelPath,
      )
    : undefined;
  const sidebarNavigationQuery = useSidebarNavigation();
  const projects = useMemo(
    () => sidebarNavigationQuery.data?.projects.map(stripProjectThreads),
    [sidebarNavigationQuery.data],
  );
  const sidebarThreads = useMemo(() => {
    const sidebarNavigation = sidebarNavigationQuery.data;
    if (!sidebarNavigation) {
      return [];
    }
    return [
      ...sidebarNavigation.projects.flatMap((project) => project.threads),
      ...sidebarNavigation.personalProject.threads,
    ];
  }, [sidebarNavigationQuery.data]);
  const titleMentionResources = useMemo(() => {
    const sectionNamesById = new Map<string, string>();
    const projectNamesById = new Map<string, string>();
    const threadById = new Map(
      sidebarThreads.map((entry) => [entry.id, entry]),
    );
    const navigation = sidebarNavigationQuery.data;
    if (navigation) {
      for (const section of navigation.sections) {
        sectionNamesById.set(section.id, section.name);
      }
      for (const projectEntry of navigation.projects) {
        projectNamesById.set(projectEntry.id, projectEntry.name);
      }
      projectNamesById.set(
        navigation.personalProject.id,
        navigation.personalProject.name,
      );
    }
    return { sectionNamesById, projectNamesById, threadById };
  }, [sidebarNavigationQuery.data, sidebarThreads]);
  const threadDetailBootstrapQuery = useThreadDetailBootstrap(threadId ?? "", {
    enabled: isThreadView && Boolean(threadId),
    timelinePrefetch: isThreadView && Boolean(threadId),
  });
  const hasThreadDetailBootstrapSettled =
    threadDetailBootstrapQuery.isSuccess || threadDetailBootstrapQuery.isError;
  const [sidebarWidth, setSidebarWidth] = useAtom(sidebarWidthAtom);
  const [isSidebarResizing, setIsSidebarResizing] = useState(false);
  const providerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);
  const liveWidthRef = useRef(sidebarWidth);
  const animationFrameRef = useRef<number | null>(null);
  // Plugin panel routes hand their header to the split workspace, which draws a
  // pane header per pane. When the workspace is inactive it draws none, so the
  // shared header must come back — it reserves the sidebar trigger footprint,
  // and without it the trigger overlays the panel body.
  const showHeader =
    !isThreadView &&
    !isRootView &&
    !isBrowserSurfaceView &&
    !(splitWorkspaceActive && pluginPanelMatch !== null);
  const [desktopInfo] = useState(getPatcherDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const sidebarProviderStyle: SidebarProviderStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
  };

  const project = projectId
    ? projects?.find((candidate) => candidate.id === projectId)
    : undefined;
  const archivedSectionName = archivedSectionId
    ? (sidebarNavigationQuery.data?.sections.find(
        (section) => section.id === archivedSectionId,
      )?.name ?? archivedSectionId)
    : null;
  const projectName = projectId ? project?.name : undefined;
  const projectLabel = projectName ?? (projectId ? projectId : undefined);
  const { data: thread } = useThread(threadId ?? "", {
    enabled:
      Boolean(threadId) && (!isThreadView || hasThreadDetailBootstrapSettled),
    refetchOnMount:
      isThreadView &&
      didThreadDetailBootstrapRefreshAfterMount(threadDetailBootstrapQuery)
        ? false
        : "always",
  });
  const threadDisplayTitle = thread
    ? getThreadDisplayTitle(thread)
    : threadId
      ? `Thread ${threadId.slice(0, 8)}`
      : "Thread";
  // Gated with the rest of the Tools surface: ROOT_ROUTE_ALIASES maps /skills
  // into Tools crumbs, so a gate-off user following an old link would otherwise
  // see Tools chrome for the whole config fetch before ToolsExperimentGate
  // redirects them away.
  const toolsBreadcrumbs = toolsHubEnabled
    ? resolveToolsBreadcrumbs(
        location.pathname,
        location.search,
        resourceRouteLabel,
      )
    : null;
  const automationBreadcrumbs = resolveAutomationBreadcrumbs(
    location.pathname,
    resourceRouteLabel,
  );
  const routeBreadcrumbs = toolsBreadcrumbs ?? automationBreadcrumbs;
  const meta = isThreadView
    ? {
        title: thread ? getThreadDisplayTitle(thread) : "Thread",
        subtitle: undefined,
      }
    : routeBreadcrumbs
      ? {
          title: "",
          subtitle: undefined,
          breadcrumbs: routeBreadcrumbs,
        }
      : isArchivedView && projectId
        ? isProjectlessProjectId(projectId)
          ? {
              title: "",
              subtitle: undefined,
              breadcrumbs: [
                { label: "Threads", to: getRootComposeRoutePath() },
                ...(archivedSectionName
                  ? [{ label: archivedSectionName }]
                  : []),
                { label: "Archived" },
              ],
            }
          : {
              title: "",
              subtitle: undefined,
              breadcrumbs: [
                {
                  label: projectLabel ?? projectId,
                  to: getLegacyProjectComposeRoutePath(projectId),
                },
                { label: "Archived" },
              ],
            }
        : isSettingsView && projectId
          ? {
              title: "",
              subtitle: undefined,
              breadcrumbs: [
                {
                  label: projectLabel ?? projectId,
                  to: getLegacyProjectComposeRoutePath(projectId),
                },
                { label: "Settings" },
              ],
            }
          : projectId
            ? {
                title: projectLabel ?? projectId,
                subtitle: undefined,
              }
            : (resolveRouteTitle(location.pathname) ?? { title: "" });

  const documentTitle = (() => {
    if (isThreadView) {
      return threadDisplayTitle;
    }
    if (pluginPanel) {
      return pluginPanel.title;
    }
    if (routeBreadcrumbs) {
      const sectionLabel = routeBreadcrumbs[0]?.label ?? "Patcher";
      const pageLabel = routeBreadcrumbs.at(-1)?.label ?? sectionLabel;
      return pageLabel === sectionLabel
        ? sectionLabel
        : `${pageLabel} · ${sectionLabel}`;
    }
    if (isArchivedView && projectId) {
      if (isProjectlessProjectId(projectId)) {
        return archivedSectionName
          ? `${archivedSectionName} · Archived`
          : "Threads · Archived";
      }
      return `${projectLabel ?? projectId} · Archived`;
    }
    if (isSettingsView && projectId) {
      return `${projectLabel ?? projectId} · Settings`;
    }
    if (projectId) {
      return projectLabel ?? projectId;
    }
    const routeTitle = resolveRouteTitle(location.pathname)?.title;
    return routeTitle && routeTitle.length > 0 ? routeTitle : "Patcher";
  })();
  // The sidebar list omits archived threads and side chats, so it can't answer
  // whether the currently-viewed thread is blocked on input. Read the current
  // thread's pending interactions directly (the thread view already warms this
  // cache) so an in-view thread waiting on the user always lights the favicon,
  // mirroring how the in-view unread signal covers every thread kind.
  const currentThreadPendingInteractionsQuery = useThreadPendingInteractions(
    threadId ?? "",
    { enabled: isThreadView && Boolean(threadId) },
  );
  const currentThreadHasPendingInteraction =
    getLatestPendingInteraction(currentThreadPendingInteractionsQuery.data) !==
    null;
  const faviconBadge = shouldShowFaviconAttentionDot({
    currentThreadHasPendingInteraction,
    isThreadView,
    sidebarThreads,
    thread,
  })
    ? "unread"
    : "none";
  useFaviconBadge(faviconBadge);

  const handleResizeMouseDown = useCallback(
    (event: SidebarResizeMouseEvent) => {
      event.preventDefault();
      setIsSidebarResizing(true);
      startXRef.current = event.clientX;
      startWidthRef.current = liveWidthRef.current;
      document.body.classList.add("sidebar-resizing");
      applyResizeCursor("horizontal");
      document.body.style.userSelect = "none";
    },
    [],
  );

  const finishSidebarResize = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    providerRef.current?.style.setProperty(
      "--sidebar-width",
      `${liveWidthRef.current}px`,
    );
    dispatchBrowserViewBoundsSync();
    setSidebarWidth(liveWidthRef.current);
    setIsSidebarResizing(false);
    resetSidebarResizeDocumentState();
  }, [setSidebarWidth]);

  useEffect(() => {
    if (!isSidebarResizing) return;

    const applyLiveWidth = () => {
      animationFrameRef.current = null;
      providerRef.current?.style.setProperty(
        "--sidebar-width",
        `${liveWidthRef.current}px`,
      );
      dispatchBrowserViewBoundsSync();
    };

    const handleMouseMove = (event: MouseEvent) => {
      liveWidthRef.current = resolveSidebarResizeWidth({
        deltaX: event.clientX - startXRef.current,
        startWidth: startWidthRef.current,
      });
      if (animationFrameRef.current === null) {
        animationFrameRef.current =
          window.requestAnimationFrame(applyLiveWidth);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        finishSidebarResize();
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", finishSidebarResize);
    window.addEventListener("blur", finishSidebarResize);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", finishSidebarResize);
      window.removeEventListener("blur", finishSidebarResize);
      window.removeEventListener("keydown", handleKeyDown);
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      resetSidebarResizeDocumentState();
    };
  }, [finishSidebarResize, isSidebarResizing]);

  useEffect(() => {
    liveWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = documentTitle;
  }, [documentTitle]);

  // Patcher's own screens: the shared header, then the route's output. Composed once
  // and placed in one of two hosts — inside the browser's active tab on desktop,
  // or straight into the content shell on the web build, which has no surface.
  const appScreen = (
    <>
      {showHeader ? (
        <AppHeader
          usesDesktopChrome={usesDesktopChrome}
          isInsideBrowserTab={isAppTabRoute}
          usesProjectChromeStyle={
            isRootView || isArchivedView || isSettingsView
          }
          isSettingsView={isSettingsView}
          projectId={projectId}
          project={project}
          pluginPanel={pluginPanel}
          pluginPanelSubPath={pluginPanelMatch?.params["*"] ?? ""}
          meta={meta}
        />
      ) : null}
      <main
        data-testid="app-layout-route-main"
        className={cn(
          "flex min-h-0 flex-1 flex-col",
          !isBrowserSurfaceView && "p-4 md:p-5",
        )}
      >
        {/* An agent route's children paint in the side panel instead;
            rendering them here too would mount the screen twice. */}
        {isAgentPanelRoute ? null : children}
      </main>
    </>
  );

  return (
    <ToolsHubExperimentProvider enabled={toolsHubEnabled}>
      <ProjectActionsProvider>
        <ThreadTitleMentionResourcesProvider {...titleMentionResources}>
          <ThreadActionsProvider>
            <IframeDragGuardOverlay active={isSidebarResizing} />
            <SidebarStateBridge
              providerRef={providerRef}
              style={sidebarProviderStyle}
              opensForRoute={isAgentPanelRoute}
            >
              {/* The leading edge belongs to plugins, and renders nothing at
                  all until one asks for it — see PluginLeadingPanel. First in
                  DOM order because it is in flow: it takes its width from the
                  row, and the inset below shrinks to what is left. */}
              <PluginLeadingPanel />
              {/* Content first, sidebar after: the sidebar reserves its width
                  with an in-flow "gap" element rendered where <Sidebar> sits,
                  and the panel itself is fixed. DOM order is therefore what puts
                  the sidebar on the trailing edge — `side="right"` alone would
                  pin the panel right while the gap still held space on the
                  left. */}
              <SidebarInset>
                <div
                  ref={contentShellRef}
                  data-testid="app-layout-content-shell"
                  className="relative flex h-full min-h-0 min-w-0 w-full flex-col pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]"
                >
                  {hostsBrowserSurface ? (
                    <Suspense fallback={null}>
                      <BrowserSurfaceView
                        appScreen={isAppTabRoute ? appScreen : null}
                      />
                    </Suspense>
                  ) : (
                    appScreen
                  )}
                </div>
              </SidebarInset>
              {isAgentPanelRoute ? (
                <AgentPanelSidebar
                  backLabel="Threads"
                  backTo={BROWSER_SURFACE_ROUTE_PATH}
                  isResizing={isSidebarResizing}
                  onResizeMouseDown={handleResizeMouseDown}
                >
                  {children}
                </AgentPanelSidebar>
              ) : isGlobalSettingsView ? (
                <SettingsSidebar
                  onResizeMouseDown={handleResizeMouseDown}
                  isResizing={isSidebarResizing}
                  showTopReserve={true}
                  appRoutePath={appRoutePath}
                />
              ) : isGlobalToolsView ? (
                <ToolsSidebar
                  onResizeMouseDown={handleResizeMouseDown}
                  isResizing={isSidebarResizing}
                  showTopReserve={true}
                  appRoutePath={toolsBackRoutePath}
                />
              ) : (
                <AppSidebar
                  onResizeMouseDown={handleResizeMouseDown}
                  isResizing={isSidebarResizing}
                  showTopReserve={true}
                  settingsRoutePath={settingsRoutePath}
                  toolsRoutePath={toolsHubEnabled ? toolsRoutePath : undefined}
                />
              )}
              <SidebarTriggerOverlay usesDesktopChrome={usesDesktopChrome} />
              <BrowserSurfaceRouteSyncBridge
                enabled={hostsBrowserSurface}
                path={
                  isAppTabRoute
                    ? `${location.pathname}${location.search}`
                    : null
                }
                title={documentTitle}
              />
            </SidebarStateBridge>
            <ProjectPathDialog
              target={quickCreateProject.projectPathDialog.target}
              pending={quickCreateProject.isCreating}
              platform={quickCreateProject.platform}
              hostId={quickCreateProject.hostId}
              hostName={quickCreateProject.hostName}
              hosts={quickCreateProject.hosts}
              onOpenChange={quickCreateProject.projectPathDialog.onOpenChange}
              onSubmit={quickCreateProject.submitProjectPath}
            />
          </ThreadActionsProvider>
        </ThreadTitleMentionResourcesProvider>
      </ProjectActionsProvider>
    </ToolsHubExperimentProvider>
  );
}
