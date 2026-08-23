import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEventHandler,
} from "react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Icon, type IconName } from "@patcher/shared-ui/icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@patcher/shared-ui/context-menu";
import { cn } from "@patcher/shared-ui/lib/utils";
import { useDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { PluginBrowserTabStatus } from "@patcher/plugin-sdk";
import { pluginIconName } from "@/components/plugin/PluginIcon";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { useIsCompactViewport } from "@patcher/shared-ui/hooks/use-compact-viewport";
import { useOptionalIsSidebarShowing } from "@/components/ui/sidebar.js";
import {
  CHROME_ROW_HEIGHT_CLASS,
  getPatcherDesktopInfo,
  MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
  SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS,
} from "@/lib/patcher-desktop";
import { resolveAppTabIconName } from "@/lib/app-surface-tabs";
import {
  isAppSurfaceTab,
  isPinnedSurfaceTab,
  type BrowserSurfaceTab,
} from "@/lib/browser-surface-tabs";
import { getBrowserUrlHost } from "@/lib/browser-url";
import { useIsLeadingPanelShowing } from "@/components/layout/PluginLeadingPanel";

/** A plugin's entry on the tab menu (`browser.tab.actions`). */
export interface BrowserSurfaceTabAction {
  pluginId: string;
  itemId: string;
  title: string;
}

export interface BrowserSurfaceTabStripProps {
  activeTabId: string | null;
  /**
   * Page icons by tab id, as `data:` URIs the desktop shell built (see
   * `desktop-browser-favicon.ts`). Missing means "not known this session", not
   * "no icon" — the deck mounts one tab at a time, so a tab contributes its icon
   * the first time it is visited.
   */
  favicons?: Readonly<Record<string, string>>;
  /** Tabs currently loading a page; they spin in place of their icon. */
  loadingTabIds?: ReadonlySet<string>;
  /** Tabs the user silenced; they carry a muted mark. */
  mutedTabIds?: ReadonlySet<string>;
  /** Plugin marks on tabs, by tab id — see `plugin-browser-tab-status.ts`. */
  pluginStatuses?: ReadonlyMap<string, PluginBrowserTabStatus>;
  /** Plugin entries appended to every tab's menu, in plugin id order. */
  tabActions?: readonly BrowserSurfaceTabAction[];
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onDuplicate: (tabId: string) => void;
  /** Drop a dragged tab at a position in the strip. */
  onMove: (args: { tabId: string; toIndex: number }) => void;
  /**
   * Called as a tab's menu opens and closes.
   *
   * The menu hangs over the page area, and a page is a native `WebContentsView`
   * that composites above the DOM — so it has to be frozen and hidden while the
   * menu is up. The surface owns that (`setOverlay`), because several panels
   * compete for one window's page; the strip only says when it needs it.
   */
  onMenuOpenChange?: (open: boolean) => void;
  onOpen: () => void;
  onRunTabAction: (args: {
    action: BrowserSurfaceTabAction;
    tabId: string;
  }) => void;
  onSetMuted: (args: { muted: boolean; tabId: string }) => void;
  onSetPinned: (args: { pinned: boolean; tabId: string }) => void;
  tabs: readonly BrowserSurfaceTab[];
}

interface TabStripChromeReserveArgs {
  /** Null outside a `SidebarProvider`, where nothing is pinned over the strip. */
  isSidebarShowing: boolean | null;
  isCompactViewport: boolean;
  reserveMacosTrafficLights: boolean;
}

/**
 * Padding classes that clear the window's pinned title-bar chrome. The surface
 * draws no page header, so this strip *is* the title-bar row and inherits its
 * obligations — the same two, reserved by the same rule, as AppPageHeader: the
 * macOS traffic lights at the leading end while they are visible, and the pinned
 * sidebar trigger at the trailing end while the sidebar is collapsed (an open
 * sidebar covers the trigger and reserves it in its own top row).
 *
 * Both tokens are sized against a 16px base inset, which is why the strip is
 * `px-4` rather than the tighter inset a tab row would otherwise use — see
 * {@link MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS} for that geometry.
 */
export function resolveTabStripChromeReserveClassName({
  isSidebarShowing,
  isCompactViewport,
  reserveMacosTrafficLights,
}: TabStripChromeReserveArgs): string {
  return cn(
    reserveMacosTrafficLights && MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS,
    (isCompactViewport || isSidebarShowing === false) &&
      SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS,
  );
}

/**
 * Tab sizing, Chromium's rule: every tab is the same width whatever its title
 * says, that width is Chromium's own 240px until the tabs stop fitting, and from
 * there they shrink together down to a floor.
 *
 * An identical fixed width — not `flex-1`, which would divide the strip and
 * stretch two tabs across it — is what makes the widths equal and content-
 * independent: a title cannot widen its own tab, and a half-empty strip leaves
 * the space after the last tab rather than inflating tabs into it. Shrinking is
 * `shrink` against that shared width: equal bases shrink by equal amounts, so the
 * tabs stay identical the whole way down. No measuring, no resize observer.
 *
 * A definite `w-60` rather than `basis-60`, and the difference is the whole of a
 * bug that outlived two attempts to fix it. Both give the same flex base size,
 * but they give the tab list around the tabs different **max-content** sizes, and
 * that size is what the list is sized by (it is `flex: 0 1 auto`). Flexbox
 * computes it from the items' content, not their bases: each item offers
 * `(max-content contribution − flex base size)`, and when *every* tab's content
 * is narrower than 240 — a fresh tab reading "New tab", a host name, a page that
 * has not reported a title yet — that difference is negative for all of them, the
 * list shrinks below 240 × N, and the tabs shrink with it. One long title arrives
 * and they all snap back out. A definite width makes the contribution definite
 * too, so it equals the base, the difference is zero, and the list is 240 × N
 * whatever the pages say.
 *
 * The floor is what a tab still needs when its title has been squeezed out
 * entirely: the page icon and the close control, nothing else. It is the sum of
 * the tab's own geometry (`pl-2` + a `size-4` icon + `gap-1.5` + the `pr-7`
 * reserved for the close control = 58px, rounded to 60), so changing any of those
 * paddings means recomputing it. Below the floor the strip clips instead of
 * scrolling (see the list container).
 *
 * Marks — a mute, a plugin's status — ride inside the same row and never shrink,
 * so they take from the title rather than from the floor. A tab squeezed all the
 * way down *and* carrying a mark clips it, which is the trade the floor already
 * makes for the title.
 */
const TAB_WIDTH_CLASS = "min-w-15 w-60 shrink";

/**
 * A tab's visible name. Titles arrive asynchronously — from the native view for
 * a web tab, from the screen's own document title for an app tab — so the host
 * (or the path) is the interim label, and "New tab" covers a tab with no page
 * yet (empty URL — see the desktop browser IPC contract).
 */
export function browserSurfaceTabLabel(tab: BrowserSurfaceTab): string {
  if (tab.title !== null && tab.title.trim().length > 0) {
    return tab.title;
  }
  if (isAppSurfaceTab(tab)) {
    return tab.path;
  }
  if (tab.url.length === 0) {
    return "New tab";
  }
  const host = getBrowserUrlHost(tab.url);
  return host.length > 0 ? host : tab.url;
}

/**
 * A tab's page icon: a spinner while it loads (Chromium's own trade — progress is
 * worth more than identity on a tab you are waiting for), then the page's icon, or
 * the generic mark for a tab whose icon this session has not seen.
 *
 * The image is decorative: the tab's title names it, and `alt` text from a page
 * would be a second attacker-controlled string in the strip.
 */
function BrowserSurfaceTabIcon({
  appIcon,
  dataUrl,
  isLoading,
}: {
  /** Set for an app tab, which has no page and so never has a page icon. */
  appIcon: IconName | null;
  dataUrl: string | null;
  isLoading: boolean;
}) {
  if (appIcon !== null) {
    return (
      <Icon name={appIcon} className="size-4 shrink-0 opacity-70" aria-hidden />
    );
  }
  if (isLoading) {
    return (
      <Icon
        name="Spinner"
        className="size-4 shrink-0 animate-spin opacity-70"
        aria-hidden="true"
      />
    );
  }
  if (dataUrl === null) {
    return (
      <Icon
        name="Globe"
        className="size-4 shrink-0 opacity-70"
        aria-hidden="true"
      />
    );
  }
  return <img src={dataUrl} alt="" className="size-4 shrink-0 rounded-sm" />;
}

/**
 * A pinned tab, Chromium's shape: the page icon and nothing else, at the width
 * that holds it. No title (the strip is where the user keeps what they always
 * have open, and they know these by their marks) and no close control — the
 * chord and the menu still close it, but a pin the pointer can undo by accident
 * is not pinned.
 *
 * Sized by its content rather than by a number, unlike {@link TAB_WIDTH_CLASS}:
 * what a pinned tab holds is bounded — an icon and at most two marks — so there
 * is nothing here for a page title to inflate, and `shrink-0` keeps the pinned
 * block out of the shrink pool the unpinned tabs share.
 */
const PINNED_TAB_WIDTH_CLASS = "w-auto shrink-0";

/** A tab moves along the strip and nowhere else. */
const restrictTabDragToHorizontalAxis: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});

const TAB_DRAG_MODIFIERS: Modifier[] = [restrictTabDragToHorizontalAxis];

/** Marks after the title: what the user did to the tab, then what a plugin said. */
function BrowserSurfaceTabMarks({
  isMuted,
  pluginStatus,
}: {
  isMuted: boolean;
  pluginStatus: PluginBrowserTabStatus | null;
}) {
  return (
    <>
      {isMuted ? (
        <Icon
          name="VolumeOff"
          className="size-3.5 shrink-0 opacity-70"
          aria-label="Muted"
        />
      ) : null}
      {pluginStatus === null ? null : (
        <Icon
          name={pluginIconName(pluginStatus.icon)}
          className={cn(
            "size-3.5 shrink-0",
            pluginStatus.tone === "running" &&
              "animate-shine-icon text-success motion-safe:[animation-duration:1.5s]",
            pluginStatus.tone === "success" && "text-success",
            pluginStatus.tone === "error" && "text-destructive",
          )}
          aria-label={pluginStatus.label}
        />
      )}
    </>
  );
}

interface BrowserSurfaceTabStripTabProps {
  faviconDataUrl: string | null;
  isActive: boolean;
  isLoading: boolean;
  isMuted: boolean;
  /** Null outside desktop chrome, where the strip is not a drag handle. */
  noDragClassName: string | null;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  /** False while there is nothing to reorder — a strip holding one tab. */
  isDraggable: boolean;
  onDuplicate: (tabId: string) => void;
  onMenuOpenChange: (args: { open: boolean; tabId: string }) => void;
  onRunTabAction: (args: {
    action: BrowserSurfaceTabAction;
    tabId: string;
  }) => void;
  onSetMuted: (args: { muted: boolean; tabId: string }) => void;
  onSetPinned: (args: { pinned: boolean; tabId: string }) => void;
  pluginStatus: PluginBrowserTabStatus | null;
  showsDivider: boolean;
  tab: BrowserSurfaceTab;
  tabActions: readonly BrowserSurfaceTabAction[];
}

function BrowserSurfaceTabStripTab({
  faviconDataUrl,
  isActive,
  isDraggable,
  isLoading,
  isMuted,
  noDragClassName,
  onActivate,
  onClose,
  onDuplicate,
  onMenuOpenChange,
  onRunTabAction,
  onSetMuted,
  onSetPinned,
  pluginStatus,
  showsDivider,
  tab,
  tabActions,
}: BrowserSurfaceTabStripTabProps) {
  const label = browserSurfaceTabLabel(tab);
  const isApp = isAppSurfaceTab(tab);
  const isPinned = isPinnedSurfaceTab(tab);
  const { isDragging, listeners, setNodeRef, transform, transition } =
    useSortable({ id: tab.id, disabled: !isDraggable });
  // An app tab is a remembered route rather than a live page, so two of the
  // browser's own entries do not apply to one: duplicating it would leave two
  // tabs claiming one route, and there is no page of its own to silence — a Patcher
  // screen shares the app's `webContents`, so muting it would mute Patcher.
  const canDuplicate = !isApp;
  const canMute = !isApp && tab.url.length > 0;
  return (
    <ContextMenu
      onOpenChange={(open) => {
        onMenuOpenChange({ open, tabId: tab.id });
      }}
    >
      <ContextMenuTrigger asChild>
        {/* The tab's fill lives on this box, the same box the close control is
            positioned inside, so the control cannot land off the tab. Painting
            the inner button instead is what put it outside. */}
        <div
          ref={setNodeRef}
          style={{ transform: CSS.Translate.toString(transform), transition }}
          className={cn(
            "group relative flex items-stretch rounded-md transition-colors",
            isActive
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
            isPinned ? PINNED_TAB_WIDTH_CLASS : TAB_WIDTH_CLASS,
            // The tab being carried draws above its neighbours, and its own
            // transform must not animate while the pointer is driving it.
            isDragging && "z-10 transition-none",
            noDragClassName,
          )}
          {...listeners}
        >
          {showsDivider ? (
            <span
              aria-hidden
              className="absolute inset-y-1.5 left-0 w-px bg-border"
            />
          ) : null}
          {/* The tab is one control filling the box: the padding above and
              below the title activates it too. Room for the close control is
              reserved rather than overlapped, at every width — the floor is
              sized to hold it. A pinned tab reserves nothing, having none. */}
          <button
            type="button"
            role="tab"
            aria-selected={isActive}
            // The name a pinned tab does not show still has to be reachable —
            // by a screen reader, and by hovering.
            {...(isPinned ? { "aria-label": label, title: label } : {})}
            onClick={() => {
              onActivate(tab.id);
            }}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              isPinned ? "justify-center px-2" : "pl-2 pr-7",
            )}
          >
            <BrowserSurfaceTabIcon
              appIcon={isApp ? resolveAppTabIconName(tab.path) : null}
              dataUrl={faviconDataUrl}
              isLoading={isLoading}
            />
            {isPinned ? null : (
              <span className="min-w-0 truncate">{label}</span>
            )}
            <BrowserSurfaceTabMarks
              isMuted={isMuted}
              pluginStatus={pluginStatus}
            />
          </button>
          {isPinned ? null : (
            <button
              type="button"
              aria-label={`Close ${label}`}
              onClick={() => {
                onClose(tab.id);
              }}
              // No `noDragClassName` here: the whole tab is already carved out
              // of the drag region by its box, and that class carries
              // `relative`, which tailwind-merge would apply *over* the
              // `absolute` below — which is what threw this control out of the
              // tab in desktop chrome.
              className="absolute inset-y-1 right-1 flex items-center rounded px-0.5 opacity-0 transition-opacity hover:bg-state-active group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {/* Same size Patcher's other tab close affordance uses (see
                  TAB_PILL_AFFORDANCE_ICON_CLASS): the control reads as a
                  secondary mark on the tab rather than a second glyph
                  competing with the title. */}
              <Icon name="X" className="size-3.5" aria-hidden />
            </button>
          )}
        </div>
      </ContextMenuTrigger>
      {/* Patcher's own entries first, then whatever plugins added — the same order
          the page's context menu uses, so a plugin cannot displace the entry a
          user is reaching for. */}
      <ContextMenuContent className="w-52">
        {canDuplicate ? (
          <ContextMenuItem
            onSelect={() => {
              onDuplicate(tab.id);
            }}
          >
            <Icon name="Copy" aria-hidden />
            Duplicate
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem
          onSelect={() => {
            onSetPinned({ pinned: !isPinned, tabId: tab.id });
          }}
        >
          <Icon name={isPinned ? "PinOff" : "Pin"} aria-hidden />
          {isPinned ? "Unpin tab" : "Pin tab"}
        </ContextMenuItem>
        {canMute ? (
          <ContextMenuItem
            onSelect={() => {
              onSetMuted({ muted: !isMuted, tabId: tab.id });
            }}
          >
            <Icon name={isMuted ? "VolumeHigh" : "VolumeOff"} aria-hidden />
            {isMuted ? "Unmute tab" : "Mute tab"}
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            onClose(tab.id);
          }}
        >
          <Icon name="X" aria-hidden />
          Close tab
        </ContextMenuItem>
        {tabActions.length === 0 ? null : <ContextMenuSeparator />}
        {tabActions.map((action) => (
          <ContextMenuItem
            key={`${action.pluginId}:${action.itemId}`}
            onSelect={() => {
              onRunTabAction({ action, tabId: tab.id });
            }}
          >
            <Icon name="Zap" aria-hidden />
            {action.title}
          </ContextMenuItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const NO_LOADING_TAB_IDS: ReadonlySet<string> = new Set();
const NO_MUTED_TAB_IDS: ReadonlySet<string> = new Set();
const NO_PLUGIN_TAB_STATUSES: ReadonlyMap<string, PluginBrowserTabStatus> =
  new Map();
const NO_TAB_ACTIONS: readonly BrowserSurfaceTabAction[] = [];

export function BrowserSurfaceTabStrip({
  activeTabId,
  favicons = {},
  loadingTabIds = NO_LOADING_TAB_IDS,
  mutedTabIds = NO_MUTED_TAB_IDS,
  pluginStatuses = NO_PLUGIN_TAB_STATUSES,
  tabActions = NO_TAB_ACTIONS,
  onActivate,
  onClose,
  onDuplicate,
  onMenuOpenChange,
  onMove,
  onOpen,
  onRunTabAction,
  onSetMuted,
  onSetPinned,
  tabs,
}: BrowserSurfaceTabStripProps) {
  const [desktopInfo] = useState(getPatcherDesktopInfo);
  // Which tab's menu is open, rather than a plain boolean: right-clicking a
  // second tab opens its menu and closes the first one's, and the two callbacks
  // can arrive in either order. Keyed by id, a stale close cannot cancel a live
  // open.
  const [menuTabId, setMenuTabId] = useState<string | null>(null);
  const handleMenuOpenChange = useCallback(
    ({ open, tabId }: { open: boolean; tabId: string }) => {
      setMenuTabId((current) =>
        open ? tabId : current === tabId ? null : current,
      );
    },
    [],
  );
  const isTabMenuOpen = menuTabId !== null;
  useEffect(() => {
    onMenuOpenChange?.(isTabMenuOpen);
  }, [isTabMenuOpen, onMenuOpenChange]);
  const {
    beginDragClickSuppression,
    clearDragClickSuppressionSoon,
    consumeDragClickSuppression,
  } = useDragClickSuppression();
  // The same activation constraints the thread panel's tab strip uses: a few
  // pixels of travel before a press becomes a drag, so a click still selects the
  // tab, and a hold on touch, where there is no hover to distinguish the two.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 6 },
    }),
  );
  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const handleClickCapture = useCallback<MouseEventHandler<HTMLDivElement>>(
    (event) => {
      if (!consumeDragClickSuppression()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [consumeDragClickSuppression],
  );
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      // A drop is not a click on the tab it landed on, and the pointer sequence
      // ends with one — so the click is swallowed rather than activating a tab
      // the user was only carrying.
      clearDragClickSuppressionSoon();
      const over = event.over;
      if (over === null) {
        return;
      }
      const toIndex = tabIds.indexOf(String(over.id));
      if (toIndex === -1) {
        return;
      }
      onMove({ tabId: String(event.active.id), toIndex });
    },
    [clearDragClickSuppressionSoon, onMove, tabIds],
  );
  const desktopWindowState = useDesktopWindowState();
  const isCompactViewport = useIsCompactViewport();
  const isSidebarShowing = useOptionalIsSidebarShowing();
  const isLeadingPanelShowing = useIsLeadingPanelShowing();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const chromeReserveClassName = resolveTabStripChromeReserveClassName({
    isCompactViewport,
    isSidebarShowing,
    // Not while the plugin panel is there: it owns the window's leading edge
    // and holds the lights' strip open itself.
    reserveMacosTrafficLights:
      !isLeadingPanelShowing &&
      shouldReserveMacosTrafficLights({
        desktopInfo,
        windowState: desktopWindowState,
      }),
  });
  // In desktop chrome the strip is the window's drag handle, so every control on
  // it has to opt back out of dragging to stay clickable.
  const noDragClassName = usesDesktopChrome ? MACOS_WINDOW_NO_DRAG_CLASS : null;
  return (
    <div
      className={cn(
        "flex shrink-0 items-stretch gap-1 border-b border-border bg-sidebar px-4 py-1",
        // The shared title-bar row: the pinned trigger and the traffic lights are
        // centered on this height, so a shorter strip would let them spill onto
        // the omnibox row below.
        CHROME_ROW_HEIGHT_CLASS,
        usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
        "transition-[padding] duration-200 ease-linear",
        chromeReserveClassName,
      )}
    >
      {/* The tabs get their own box so the new-tab button, which never shrinks,
          stays outside what clipping can reach. The box is sized by its tabs
          rather than by the strip (no `flex-1`), which is what puts the new-tab
          button immediately after the last tab instead of against the right edge
          — and "by its tabs" holds only because each tab caps its own
          contribution (see TAB_WIDTH_CLASS); `min-w-0` still lets it be squeezed
          below its content, and then it clips. No scrolling: past the width floor
          the strip clips, which is the cost of the floor being a floor. */}
      {/* Reordering is a drag within this one row, so the carried tab never
          leaves the box and needs no lifted clone portaled past the `overflow`
          — unlike the thread panel's strip, which scrolls. The axis is
          restricted for the same reason: a tab dragged upwards would only be
          able to come back down. */}
      <DndContext
        sensors={sensors}
        modifiers={TAB_DRAG_MODIFIERS}
        onDragStart={beginDragClickSuppression}
        onDragCancel={clearDragClickSuppressionSoon}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={tabIds}
          strategy={horizontalListSortingStrategy}
        >
          <div
            className="flex min-w-0 items-stretch overflow-hidden"
            role="tablist"
            aria-label="Browser tabs"
            onClickCapture={handleClickCapture}
          >
            {tabs.map((tab, index) => (
              <BrowserSurfaceTabStripTab
                key={tab.id}
                faviconDataUrl={favicons[tab.id] ?? null}
                isActive={tab.id === activeTabId}
                isDraggable={tabs.length > 1}
                isLoading={loadingTabIds.has(tab.id)}
                isMuted={mutedTabIds.has(tab.id)}
                noDragClassName={noDragClassName}
                onActivate={onActivate}
                onClose={onClose}
                onDuplicate={onDuplicate}
                onMenuOpenChange={handleMenuOpenChange}
                onRunTabAction={onRunTabAction}
                onSetMuted={onSetMuted}
                onSetPinned={onSetPinned}
                pluginStatus={pluginStatuses.get(tab.id) ?? null}
                // Chromium's separator rule: a hairline on the edge two plain tabs
                // share, and none touching the selected tab, which is already
                // bounded by its own fill. Tabs sit flush, so "the edge they share"
                // is one edge — hence a divider drawn on it rather than a gap
                // between them.
                showsDivider={
                  index > 0 &&
                  tab.id !== activeTabId &&
                  tabs[index - 1]?.id !== activeTabId
                }
                tab={tab}
                tabActions={tabActions}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <button
        type="button"
        aria-label="New tab"
        onClick={onOpen}
        className={cn(
          "flex shrink-0 items-center rounded-md px-2 text-muted-foreground transition-colors hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          noDragClassName,
        )}
      >
        <Icon name="Plus" aria-hidden />
      </button>
    </div>
  );
}
