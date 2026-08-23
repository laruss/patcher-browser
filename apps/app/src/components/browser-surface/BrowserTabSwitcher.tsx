import { useEffect, useRef } from "react";
import { Icon } from "@patcher/shared-ui/icon";
import { cn } from "@patcher/shared-ui/lib/utils";
import { resolveAppTabIconName } from "@/lib/app-surface-tabs";
import {
  isAppSurfaceTab,
  type BrowserSurfaceTab,
} from "@/lib/browser-surface-tabs";
import type { BrowserTabSwitcherState } from "@/lib/browser-tab-mru";
import { browserSurfaceTabLabel } from "./BrowserSurfaceTabStrip";

export interface BrowserTabSwitcherProps {
  favicons?: Readonly<Record<string, string>>;
  onSelect: (tabId: string) => void;
  switcher: BrowserTabSwitcherState;
  tabs: readonly BrowserSurfaceTab[];
}

/**
 * The list an IDE shows while Ctrl is held: recently used first, the highlight
 * moving down it on each Tab, and the tab switching when Ctrl is released.
 *
 * It floats over the page, which React cannot do while a live `WebContentsView`
 * composites above the DOM — the surface freezes the page for as long as this
 * is open (`setOverlay`), the same trade the downloads dropdown makes.
 */
export function BrowserTabSwitcher({
  favicons = {},
  onSelect,
  switcher,
  tabs,
}: BrowserTabSwitcherProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the panel so the keys that drive it land in the DOM: the next
  // Ctrl+Tab has to resolve inside the browser command context, and the Ctrl
  // release has to be seen at all.
  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, []);

  const rows = switcher.order.flatMap((tabId) => {
    const tab = tabs.find((candidate) => candidate.id === tabId);
    return tab === undefined ? [] : [tab];
  });
  // By id, not by row position: a tab that went away while the list was open
  // (a popup closing itself, an agent closing a tab) leaves the frozen order
  // longer than `rows`, and a positional highlight would then point at the
  // wrong tab — a different one from the one landing on would activate.
  const highlightedTabId = switcher.order[switcher.index] ?? null;

  return (
    <div
      // Over the whole page area, so a click anywhere outside the list lands on
      // this scrim and closes the walk rather than on the page behind it.
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/30"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onSelect(highlightedTabId ?? "");
        }
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="listbox"
        aria-label="Recent tabs"
        aria-activedescendant={
          highlightedTabId === null
            ? undefined
            : `browser-tab-switcher-${highlightedTabId}`
        }
        className="max-h-[70vh] w-[28rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
      >
        {rows.map((tab) => {
          const isHighlighted = tab.id === highlightedTabId;
          const dataUrl = favicons[tab.id] ?? null;
          return (
            <div
              key={tab.id}
              id={`browser-tab-switcher-${tab.id}`}
              role="option"
              aria-selected={isHighlighted}
              onMouseDown={(event) => {
                // Land on a row the user picked directly, without waiting for
                // the Ctrl release that will never come from a mouse.
                event.preventDefault();
                onSelect(tab.id);
              }}
              className={cn(
                "flex w-full min-w-0 cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm",
                isHighlighted
                  ? "bg-state-active text-foreground"
                  : "text-muted-foreground",
              )}
            >
              {isAppSurfaceTab(tab) ? (
                <Icon
                  name={resolveAppTabIconName(tab.path)}
                  className="size-4 shrink-0 opacity-70"
                  aria-hidden
                />
              ) : dataUrl === null ? (
                <Icon
                  name="Globe"
                  className="size-4 shrink-0 opacity-70"
                  aria-hidden
                />
              ) : (
                <img
                  src={dataUrl}
                  alt=""
                  className="size-4 shrink-0 rounded-sm"
                />
              )}
              <span className="min-w-0 flex-1 truncate">
                {browserSurfaceTabLabel(tab)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
