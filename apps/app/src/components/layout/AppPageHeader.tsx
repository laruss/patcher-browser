import { useState, type ReactNode, type Ref } from "react";
import { useIsSidebarShowing } from "@/components/ui/sidebar.js";
import {
  COARSE_POINTER_HEADER_ICON_BUTTON_CLASS,
  COARSE_POINTER_HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS,
} from "@patcher/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@patcher/shared-ui/hooks/use-compact-viewport";
import {
  CHROME_ROW_CLASS,
  CHROME_ROW_HEIGHT_CLASS,
  getPatcherDesktopInfo,
  MACOS_CHROME_CONTROL_AXIS_CLASS,
  MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  MACOS_WINDOW_NO_DRAG_CLASS,
  shouldReserveMacosTrafficLights,
  shouldUseMacosDesktopChrome,
  SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS,
} from "@/lib/patcher-desktop";
import { useDesktopWindowState } from "@/hooks/useDesktopWindowState";
import { useIsLeadingPanelShowing } from "./PluginLeadingPanel";
import { cn } from "@patcher/shared-ui/lib/utils";

/**
 * Shared sizing for icon-only header action buttons (sidebar trigger, kebab
 * menu, secondary-panel toggle, etc.). Keeps button dimensions and SVG sizing
 * consistent across coarse touch and desktop contexts.
 */
export const HEADER_ICON_BUTTON_CLASS = COARSE_POINTER_HEADER_ICON_BUTTON_CLASS;

/**
 * Header icon button whose glyph is painted one optical step smaller than
 * {@link HEADER_ICON_BUTTON_CLASS} while keeping the same button box (and hit
 * target). Used for visually dense glyphs that otherwise read oversized next
 * to compact header controls.
 */
export const HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS =
  COARSE_POINTER_HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS;

/**
 * Shared geometry for the maximize and close controls at the end of a pane
 * header. Keeping both controls on one class gives their button boxes and
 * glyphs the same center axis.
 */
export const HEADER_PANE_ACTION_ICON_BUTTON_CLASS =
  HEADER_REDUCED_GLYPH_ICON_BUTTON_CLASS;

/**
 * Seam that separates a header row from the body below it. Every app header
 * carries this seam, so it belongs to the shared chrome instead of to each
 * call site. Panes without it read as if their title bar floats on the body.
 */
export const HEADER_SEAM_CLASS = "border-b border-border-seam-vertical/60";

interface AppPageHeaderProps {
  center?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headerRef?: Ref<HTMLElement>;
  /**
   * Whether this header occupies the native title-bar row and may drag the
   * desktop window. Split panes below the workspace's top edge disable this.
   */
  isWindowDragRegion?: boolean;
  /**
   * Whether this header owns the window's top-left chrome footprint. A split
   * may have several top-row drag regions, but only its structural top-left
   * leaf may clear the pinned sidebar trigger and macOS traffic lights.
   */
  ownsWindowTopLeft?: boolean;
  /**
   * Whether this header owns the window's top-right chrome footprint — the
   * pinned sidebar trigger. False for a header that sits below a row which
   * already reserved it, such as the browser surface's tab strip when an app
   * screen renders inside a tab.
   */
  ownsWindowTopRight?: boolean;
}

export function AppPageHeader({
  center,
  actions,
  className,
  headerRef,
  isWindowDragRegion = true,
  ownsWindowTopLeft = true,
  ownsWindowTopRight = true,
}: AppPageHeaderProps) {
  const isSidebarShowing = useIsSidebarShowing();
  const isCompactViewport = useIsCompactViewport();
  const [desktopInfo] = useState(getPatcherDesktopInfo);
  const desktopWindowState = useDesktopWindowState();
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);
  // Not while the plugin panel is there: it owns the window's leading edge, so
  // it holds the lights' strip open and this header is no longer under them.
  const isLeadingPanelShowing = useIsLeadingPanelShowing();
  const reserveMacosTrafficLights =
    !isLeadingPanelShowing &&
    shouldReserveMacosTrafficLights({
      desktopInfo,
      windowState: desktopWindowState,
    });
  // Trailing: the pinned trigger is over this header only while the sidebar is
  // collapsed — an open one covers it instead, and reserves it in its own top
  // row. On compact viewports the sidebar opens as an overlay above the header,
  // so the reserve holds across drawer state rather than shifting content behind
  // the overlay.
  const shouldReserveSidebarTrigger =
    ownsWindowTopRight && (isCompactViewport || !isSidebarShowing);
  return (
    <header
      ref={headerRef}
      className={cn(
        CHROME_ROW_HEIGHT_CLASS,
        HEADER_SEAM_CLASS,
        // The fill and the seam stay full-bleed; the inset lives on the content
        // row below, because that is the element the chrome reserves replace a
        // side of. See `lib/patcher-desktop.ts` — an inset on this element instead
        // would make every reserve 16px too wide.
        "relative shrink-0 bg-surface-scrim backdrop-blur-sm",
        usesDesktopChrome && isWindowDragRegion && MACOS_WINDOW_DRAG_CLASS,
        className,
      )}
    >
      <div
        data-testid="app-page-header-content-row"
        className={cn(
          // Center title/actions on the shared chrome axis using the full
          // chrome-row height so native title-bar controls stay aligned.
          CHROME_ROW_CLASS,
          "relative z-10 gap-1 px-4 md:gap-2",
          // In macOS desktop chrome, keep header content on the shared native
          // traffic-light axis so the title bar lines up with the lights, the
          // pinned collapse trigger, and the sidebar arrows. No-op in the web
          // build (no traffic lights).
          usesDesktopChrome && MACOS_CHROME_CONTROL_AXIS_CLASS,
          // Two pinned ends, reserved independently: the macOS traffic lights
          // hold the leading one whenever they are visible, and the sidebar
          // toggle holds the trailing one (see AppLayout's
          // SidebarTriggerOverlay).
          "transition-[padding] duration-200 ease-linear",
          ownsWindowTopLeft &&
            reserveMacosTrafficLights &&
            MACOS_TRAFFIC_LIGHT_LEADING_RESERVE_CLASS,
          shouldReserveSidebarTrigger && SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS,
        )}
      >
        {center ? (
          <div className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-0 max-w-full items-center gap-2">
              {center}
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1" />
        )}
        {actions ? (
          <div
            className={cn(
              "flex shrink-0 items-center gap-1",
              usesDesktopChrome && MACOS_WINDOW_NO_DRAG_CLASS,
            )}
          >
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
