import { useEffect } from "react";
import { Icon } from "@patcher/shared-ui/icon";
import { PluginSlotMount } from "@/components/plugin/PluginSlotMount";
import { usePluginSlots } from "@/lib/plugin-slots";
import { dispatchBrowserViewBoundsSync } from "@/lib/browser-view-bounds-sync";

/** In flow so the native page remains visible and credential actions can use it. */
export function BrowserPluginToolbarPanel({
  id,
  tabId,
  url,
  onClose,
}: {
  id: string | null;
  tabId: string;
  url: string;
  onClose: () => void;
}) {
  const panel = usePluginSlots().browserToolbarPanels?.find(
    (item) => `${item.pluginId}/${item.id}` === id,
  );
  useEffect(() => {
    dispatchBrowserViewBoundsSync();
    return () => dispatchBrowserViewBoundsSync();
  }, [panel]);
  if (!panel) return null;
  return (
    <section
      id="browser-plugin-toolbar-panel"
      aria-label={panel.title}
      className="relative ml-auto mr-2 flex max-h-[min(24rem,50vh)] w-80 max-w-full flex-col overflow-auto rounded-md border border-border bg-background shadow-sm"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <button
        type="button"
        aria-label={`Close ${panel.title}`}
        onClick={onClose}
        className="absolute right-2 top-2 z-10 rounded p-1 text-muted-foreground hover:bg-state-hover"
      >
        <Icon name="X" className="size-4" aria-hidden />
      </button>
      <PluginSlotMount
        key={`${panel.pluginId}/${panel.id}/${panel.generation}/${tabId}/${url}`}
        pluginId={panel.pluginId}
        slotKind="experimental_browserToolbarPanel"
        slotId={panel.id}
      >
        <panel.component browserTabId={tabId} browserUrl={url} />
      </PluginSlotMount>
    </section>
  );
}
