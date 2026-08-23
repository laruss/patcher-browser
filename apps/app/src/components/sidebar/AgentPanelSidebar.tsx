import {
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { CompactViewportOverrideProvider } from "@patcher/shared-ui/hooks/use-compact-viewport";
import { cn } from "@patcher/shared-ui/lib/utils";
import { Sidebar, useCloseMobileSidebar } from "@/components/ui/sidebar.js";
import { SectionSidebarIcon, SectionSidebarRow } from "./SectionSidebar";
import { SidebarHistoryNavigationControls } from "./SidebarHistoryNavigationControls";
import {
  CHROME_ROW_CLASS,
  getPatcherDesktopInfo,
  MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
  MACOS_WINDOW_DRAG_CLASS,
  shouldUseMacosDesktopChrome,
  SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS,
} from "@/lib/patcher-desktop";

/**
 * The side panel while an agent screen owns it: New thread, or a thread.
 *
 * Same shape as {@link SectionSidebar} — a back row above the section's own
 * content — and deliberately so, because it is the same idea one step deeper:
 * the panel is a stack whose base is the thread list. What differs is the
 * content box. A section is a list and takes the sidebar's padded, scrolling
 * content area; a conversation owns its height and scrolls itself, so this one
 * hands over a full-bleed flex column and adds no padding of its own.
 *
 * `backTo` leaves the agent route rather than popping history, so the control
 * behaves the same whether the user walked here or opened the URL directly.
 * Leaving is what returns the panel to the list, because the panel shows the
 * list on every route that is not an agent one.
 */
export function AgentPanelSidebar({
  backLabel,
  backTo,
  children,
  isResizing,
  onResizeMouseDown,
}: {
  backLabel: string;
  backTo: string;
  children: ReactNode;
  isResizing: boolean;
  onResizeMouseDown: (event: ReactMouseEvent<HTMLDivElement>) => void;
}) {
  const closeOnMobile = useCloseMobileSidebar();
  const [desktopInfo] = useState(getPatcherDesktopInfo);
  const usesDesktopChrome = shouldUseMacosDesktopChrome(desktopInfo);

  return (
    <Sidebar side="right">
      <div
        data-testid="agent-panel-sidebar-top-reserve-row"
        className={cn(
          CHROME_ROW_CLASS,
          "shrink-0 justify-end px-2",
          // The pinned sidebar trigger sits over this row while the panel is
          // open, so the controls here clear its footprint.
          SIDEBAR_TRIGGER_TRAILING_RESERVE_CLASS,
          usesDesktopChrome && MACOS_WINDOW_DRAG_CLASS,
        )}
      >
        <SidebarHistoryNavigationControls
          onNavigate={closeOnMobile}
          className={cn(
            "group-data-[collapsible=icon]:hidden",
            usesDesktopChrome && MACOS_CHROME_CONTROL_NO_DRAG_CLASS,
          )}
        />
      </div>
      <div className="shrink-0 px-2 pb-2 group-data-[collapsible=icon]:hidden">
        <SectionSidebarRow active={false} label={backLabel} to={backTo}>
          <SectionSidebarIcon name="ChevronLeft" />
        </SectionSidebarRow>
      </div>
      {/* Full bleed: the screen below owns its own scrolling, so this box only
          gives it the remaining height. */}
      <div
        data-testid="agent-panel-sidebar-content"
        className="flex min-h-0 min-w-0 flex-1 flex-col group-data-[collapsible=icon]:hidden"
      >
        {/* The panel is one narrow column, and this app already has a name for
            that: the compact viewport, which is what tells a thread to render
            as a single page surface instead of a split workspace. Without it
            the screens here keep the layout they were given for a full-width
            main area — panes side by side in 400px, pane headers for a
            workspace that cannot exist, a secondary panel splitting the column
            again, and a leading reserve for traffic lights that are at the
            other end of the window.

            Unconditional rather than measured: the panel can be dragged wide,
            but a split workspace inside a side panel is wrong at every width,
            and a width-derived answer would re-lay-out the conversation mid-
            drag. */}
        <CompactViewportOverrideProvider isCompactViewport>
          {children}
        </CompactViewportOverrideProvider>
      </div>
      <div
        data-testid="agent-panel-sidebar-resize-handle"
        className={cn(
          // Leading edge, like the other sidebars': the panel is on the right,
          // so its grabbable seam is the one facing the content.
          "absolute -left-1.5 top-0 z-30 hidden h-full w-3 cursor-col-resize md:block",
          "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors hover:before:bg-sidebar-border",
          "group-data-[collapsible=icon]:hidden",
          isResizing && "before:bg-sidebar-border",
        )}
        onMouseDown={onResizeMouseDown}
      />
    </Sidebar>
  );
}
