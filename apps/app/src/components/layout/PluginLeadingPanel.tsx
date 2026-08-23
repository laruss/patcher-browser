import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Icon, type IconName } from "@patcher/shared-ui/icon";
import { cn } from "@patcher/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@patcher/shared-ui/tooltip";
import { useAtomValue } from "jotai";
import { matchesBrowserUrlPattern } from "@patcher/domain/browser-url-pattern";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import {
  usePluginSlots,
  type PluginLeadingPanelSlot,
} from "@/lib/plugin-slots";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";
import {
  browserSurfaceTabsAtom,
  getActiveBrowserSurfaceTab,
  isWebSurfaceTab,
} from "@/lib/browser-surface-tabs";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import {
  CHROME_ROW_HEIGHT_CLASS,
  getPatcherDesktopInfo,
  MACOS_TRAFFIC_LIGHT_TOP_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
} from "@/lib/patcher-desktop";

/**
 * The window's leading edge, which belongs to plugins.
 *
 * Patcher contributes nothing here, and that is the point: with no registrations
 * there is no panel, no rail and no toggle — an empty column would be Patcher
 * claiming an edge it has no use for. What the panel looks like follows from
 * how many plugins asked for it rather than from anything anyone configured:
 *
 * - **none** — nothing renders, and the shell's leading edge is the main area's.
 * - **one** — that plugin gets the panel whole, with no chrome of Patcher's own
 *   around it. A rail to switch between one thing is a control that does
 *   nothing.
 * - **two or more** — Patcher draws a rail of icons, because now there is a choice
 *   to make and only the host can offer it.
 *
 * Unlike the sidebar this panel is not collapsible: it exists only when a
 * plugin put something in it, so the way to be rid of it is to disable the
 * plugin. It is resizable, because how much room a plugin's panel needs is the
 * user's judgement, not the plugin's.
 */

const LEADING_PANEL_WIDTH_KEY = "patcher.leadingPanel.width";
const LEADING_PANEL_ACTIVE_KEY = "patcher.leadingPanel.active";
export const LEADING_PANEL_MIN_WIDTH = 200;
export const LEADING_PANEL_MAX_WIDTH = 640;
export const LEADING_PANEL_DEFAULT_WIDTH = 280;

export function clampLeadingPanelWidth(value: number): number {
  return Math.min(
    LEADING_PANEL_MAX_WIDTH,
    Math.max(LEADING_PANEL_MIN_WIDTH, value),
  );
}

/**
 * Width for a live resize drag, clamped.
 *
 * This panel is on the leading edge and its handle is on its trailing one, so
 * dragging **right** widens it — the opposite sign to the sidebar's, which is
 * the kind of mistake that still "works" and simply runs backwards.
 */
export function resolveLeadingPanelResizeWidth({
  deltaX,
  startWidth,
}: {
  deltaX: number;
  startWidth: number;
}): number {
  return clampLeadingPanelWidth(startWidth + deltaX);
}

/**
 * Which panel is showing, given what is registered and what the user last
 * chose. A stored choice for a plugin that is no longer installed is not an
 * error — it is a plugin that was disabled — so it falls back to the first
 * registration rather than leaving the panel blank.
 */
export function resolveActiveLeadingPanel({
  panels,
  storedId,
}: {
  panels: readonly PluginLeadingPanelSlot[];
  storedId: string | null;
}): PluginLeadingPanelSlot | null {
  if (panels.length === 0) {
    return null;
  }
  return (
    panels.find((panel) => leadingPanelKey(panel) === storedId) ?? panels[0]!
  );
}

export function leadingPanelKey(panel: PluginLeadingPanelSlot): string {
  return `${panel.pluginId}/${panel.id}`;
}

function readStoredWidth(): number {
  if (typeof window === "undefined") {
    return LEADING_PANEL_DEFAULT_WIDTH;
  }
  const stored = Number(window.localStorage.getItem(LEADING_PANEL_WIDTH_KEY));
  return Number.isFinite(stored) && stored > 0
    ? clampLeadingPanelWidth(stored)
    : LEADING_PANEL_DEFAULT_WIDTH;
}

function readStoredActiveId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(LEADING_PANEL_ACTIVE_KEY);
}

/**
 * Whether the leading panel is on screen — which is to say whether any plugin
 * asked for it.
 *
 * The surfaces that would otherwise reserve the macOS traffic lights read this:
 * the lights sit in the window's top-left, and when this panel is there, that
 * corner is the panel's. Two surfaces reserving one strip is how content ends
 * up inset twice; none reserving it is BB-46.
 */
export function useIsLeadingPanelShowing(): boolean {
  return useApplicableLeadingPanels().length > 0;
}

/**
 * The address of the page in the active browser tab, or null.
 *
 * Read off the strip rather than from the surface, and deliberately not scoped
 * to the route: this panel is the *window's* leading edge, so a site-scoped
 * panel that vanished the moment the user glanced at a thread would take the
 * work they were doing in it with them.
 */
function useActiveBrowserUrl(): string | null {
  const tabs = useAtomValue(browserSurfaceTabsAtom);
  const active = getActiveBrowserSurfaceTab(tabs);
  if (active === null || !isWebSurfaceTab(active) || active.url.length === 0) {
    return null;
  }
  return active.url;
}

/**
 * The panels that apply right now: every registration, minus those scoped to a
 * site the active tab is not on.
 *
 * Filtered here rather than left to each component, because what is at stake is
 * whether Patcher draws the column at all — a panel that renders nothing still
 * reserves an edge, and on macOS still claims the traffic lights.
 */
function useApplicableLeadingPanels(): readonly PluginLeadingPanelSlot[] {
  const { leadingPanels } = usePluginSlots();
  const browserUrl = useActiveBrowserUrl();
  return useMemo(
    () =>
      leadingPanels.filter(
        (panel) =>
          panel.matches === undefined ||
          (browserUrl !== null &&
            panel.matches.some((pattern) =>
              matchesBrowserUrlPattern(pattern, browserUrl),
            )),
      ),
    [browserUrl, leadingPanels],
  );
}

export function PluginLeadingPanel() {
  const leadingPanels = useApplicableLeadingPanels();
  const browserUrl = useActiveBrowserUrl();
  const [width, setWidth] = useState(readStoredWidth);
  const [activeId, setActiveId] = useState(readStoredActiveId);
  const [isResizing, setIsResizing] = useState(false);

  const [desktopInfo] = useState(getPatcherDesktopInfo);
  const desktopWindowState = useDesktopWindowState();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  const reserveMacosTrafficLights = shouldReserveMacosTrafficLights({
    desktopInfo,
    windowState: desktopWindowState,
  });

  const active = useMemo(
    () =>
      resolveActiveLeadingPanel({ panels: leadingPanels, storedId: activeId }),
    [activeId, leadingPanels],
  );

  // The panel is in flow, so opening it, closing it or dragging it narrower
  // moves the main area — and the browser's native view is positioned from
  // measured DOM, not from layout, so it has to be told.
  const hasPanel = active !== null;
  useEffect(() => {
    dispatchBrowserViewBoundsSync();
  }, [hasPanel, width]);

  if (active === null) {
    return null;
  }

  const showsRail = leadingPanels.length > 1;

  const handleResizeMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    setIsResizing(true);
    let latestWidth = startWidth;
    const onMove = (moveEvent: globalThis.MouseEvent) => {
      latestWidth = resolveLeadingPanelResizeWidth({
        deltaX: moveEvent.clientX - startX,
        startWidth,
      });
      setWidth(latestWidth);
    };
    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      // Persisted on release rather than on every move: the drag is a stream of
      // events and localStorage is synchronous.
      window.localStorage.setItem(LEADING_PANEL_WIDTH_KEY, String(latestWidth));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      data-testid="plugin-leading-panel"
      className="relative flex h-full shrink-0 border-r border-border bg-sidebar"
      style={{ width: `${width}px` }}
    >
      {reserveMacosTrafficLights ? (
        // The lights are in this panel's own top-left now, so it holds the
        // strip open instead of drawing under them. Also the window's drag
        // region there, as the surface owning that corner always is.
        <div
          data-testid="plugin-leading-panel-top-reserve-row"
          className={cn(
            "absolute inset-x-0 top-0 z-10",
            CHROME_ROW_HEIGHT_CLASS,
            usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
          )}
        />
      ) : null}
      {showsRail ? (
        // Its own provider rather than the sidebar's: this panel is a region of
        // the shell in its own right, and a rail whose tooltips depend on where
        // it happens to be mounted is a trap for whoever moves it.
        <TooltipProvider>
          <div
            data-testid="plugin-leading-panel-rail"
            role="tablist"
            aria-label="Plugin panels"
            className={cn(
              "flex h-full w-11 shrink-0 flex-col items-center gap-1 border-r border-border py-2",
              reserveMacosTrafficLights &&
                MACOS_TRAFFIC_LIGHT_TOP_RESERVE_CLASS,
            )}
          >
            {leadingPanels.map((panel) => {
              const key = leadingPanelKey(panel);
              const isActive = key === leadingPanelKey(active);
              return (
                <Tooltip key={key}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-label={panel.title}
                      onClick={() => {
                        setActiveId(key);
                        window.localStorage.setItem(
                          LEADING_PANEL_ACTIVE_KEY,
                          key,
                        );
                      }}
                      className={cn(
                        "flex size-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        isActive
                          ? "bg-state-active text-foreground"
                          : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
                      )}
                    >
                      <Icon name={panel.icon as IconName} aria-hidden />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{panel.title}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
      ) : null}
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
          reserveMacosTrafficLights && MACOS_TRAFFIC_LIGHT_TOP_RESERVE_CLASS,
        )}
      >
        {/* A plugin's panel is its own: the mount scopes its stylesheet and
            contains a crash to this slot rather than to the window. */}
        <PluginSlotMount
          pluginId={active.pluginId}
          slotKind="experimental_leadingPanel"
          slotId={active.id}
        >
          <active.component browserUrl={browserUrl} />
        </PluginSlotMount>
      </div>
      <div
        data-testid="plugin-leading-panel-resize-handle"
        className={cn(
          // Trailing edge: the panel is on the left, so its grabbable seam is
          // the one facing the content.
          "absolute -right-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
          isResizing && "before:bg-sidebar-border",
        )}
        onMouseDown={handleResizeMouseDown}
      />
    </div>
  );
}
