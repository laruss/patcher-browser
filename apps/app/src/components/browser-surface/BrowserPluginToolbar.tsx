import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@patcher/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@patcher/shared-ui/tooltip";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { invalidatePluginToolbarStates } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  runPluginToolbarItem,
  usePluginContributions,
  usePluginToolbarStates,
  type PluginBrowserToolbarItemContribution,
  type PluginToolbarItemState,
} from "@/hooks/queries/plugin-contribution-queries";
import { BROWSER_CHROME_ICON_BUTTON_CLASS } from "./browserChromeButtonClass";

export interface BrowserPluginToolbarProps {
  /** The active tab, whose page these controls are about. */
  tabId: string;
  title: string | null;
  url: string;
}

/**
 * Plugin controls on the browser's toolbar row (`browser.toolbar.items`).
 *
 * Between the address bar and Patcher's own buttons, which is where a browser keeps
 * what other people added — Patcher's controls stay where the user learned them.
 *
 * Two things are asked of the server here and they are deliberately unequal: the
 * *declarations* come with every other contribution, once, and the per-page
 * *states* are asked only if some control declared one. A plugin whose control
 * looks the same everywhere costs nothing as the user browses.
 */
export function BrowserPluginToolbar({
  tabId,
  title,
  url,
}: BrowserPluginToolbarProps) {
  const queryClient = useQueryClient();
  const items = usePluginContributions().data?.browserToolbarItems ?? [];
  const wantsStates = items.some((item) => item.hasState);
  const states = usePluginToolbarStates(
    { tabId, title, url },
    // A page is needed to ask about, and someone has to be asking.
    { enabled: wantsStates && url.length > 0 },
  );
  // No page means nothing for a control to be about, and a press would be
  // refused by the server anyway — so the row is not drawn over Patcher's own
  // screens, which is what `PluginBrowserToolbarContext.url` promises.
  if (items.length === 0 || url.length === 0) {
    return null;
  }
  return (
    // Its own provider rather than the sidebar's: this row is rendered on its own
    // in tests and could be rendered outside `AppLayout` later, and a Radix
    // tooltip with no provider above it throws. The delay matches the sidebar's so
    // chrome tooltips feel the same wherever they are.
    <TooltipProvider delayDuration={300} disableHoverableContent>
      {items.map((item) => (
        <BrowserPluginToolbarButton
          key={`${item.pluginId}:${item.itemId}`}
          item={item}
          onPress={async () => {
            await runPluginToolbarItem({
              itemId: item.itemId,
              pluginId: item.pluginId,
              tabId,
              title,
              url,
            });
            // The press is what changes the answer — a star that just saved
            // this page has to fill in.
            await invalidatePluginToolbarStates({ queryClient });
          }}
          state={
            states.data?.find(
              (candidate) =>
                candidate.pluginId === item.pluginId &&
                candidate.itemId === item.itemId,
            ) ?? null
          }
        />
      ))}
    </TooltipProvider>
  );
}

function BrowserPluginToolbarButton({
  item,
  onPress,
  state,
}: {
  item: PluginBrowserToolbarItemContribution;
  onPress: () => void;
  state: PluginToolbarItemState | null;
}) {
  // The declaration is the fallback for both, so the control is complete before
  // any answer arrives and does not change shape when one does.
  const label = state?.title ?? item.title;
  const isActive = state?.active === true;
  return (
    // Patcher's own chrome buttons carry conventional glyphs — back, reload — and need
    // no tooltip. A plugin's icon is not conventional, so this one says what it is
    // on hover, through the design system rather than a native `title`.
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onPress}
          aria-label={label}
          aria-pressed={isActive}
          className={cn(
            BROWSER_CHROME_ICON_BUTTON_CLASS,
            isActive ? "text-foreground" : "text-muted-foreground",
          )}
        >
          <PluginIcon
            pluginId={item.pluginId}
            icon={item.icon}
            className={cn(isActive && "text-primary")}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
