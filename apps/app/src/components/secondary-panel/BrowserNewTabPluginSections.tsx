import { COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@patcher/shared-ui/coarse-pointer-sizing";
import { cn } from "@patcher/shared-ui/lib/utils";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import {
  usePluginContributions,
  usePluginNewTabSections,
  type PluginNewTabSection,
} from "@/hooks/queries/plugin-contribution-queries";
import { getBrowserUrlHost } from "@/lib/browser-url";
import {
  LAUNCHER_ROW_BASE_CLASS,
  LAUNCHER_ROW_ICON_CLASS,
  LauncherRowTrailing,
  LauncherSectionHeader,
} from "./launcherRow";

export interface BrowserNewTabPluginSectionsProps {
  /** The tab whose new-tab screen this is; a widget is asked per tab. */
  tabId: string;
  onNavigate: (url: string) => void;
}

/**
 * Plugin sections on the new-tab screen (`browser.newTab.widgets`), after Patcher's
 * own recently-visited list.
 *
 * Rows are links the plugin already resolved, so clicking one navigates without
 * calling the plugin back: a saved-pages list behaves like part of the browser
 * rather than a remote call per click.
 */
export function BrowserNewTabPluginSections({
  onNavigate,
  tabId,
}: BrowserNewTabPluginSectionsProps) {
  const widgets = usePluginContributions().data?.browserNewTabWidgets ?? [];
  const sections = usePluginNewTabSections(
    { tabId },
    // Nobody declared a section, so a new tab asks nothing at all.
    { enabled: widgets.length > 0 },
  );
  const data = sections.data ?? [];
  if (data.length === 0) {
    return null;
  }
  return (
    <>
      {data.map((section) => (
        <BrowserNewTabPluginSection
          key={`${section.pluginId}:${section.widgetId}`}
          onNavigate={onNavigate}
          section={section}
        />
      ))}
    </>
  );
}

function BrowserNewTabPluginSection({
  onNavigate,
  section,
}: {
  onNavigate: (url: string) => void;
  section: PluginNewTabSection;
}) {
  return (
    <section>
      <LauncherSectionHeader
        label={section.label}
        count={section.rows.length}
      />
      <ul aria-label={section.label} className="flex flex-col gap-px">
        {section.rows.map((row) => {
          // The plugin's own subtitle if it gave one, and the host otherwise:
          // a row in a list of places should say where it goes.
          const secondary = row.subtitle ?? getBrowserUrlHost(row.url);
          return (
            <li key={`${row.url}:${row.title}`}>
              <button
                type="button"
                onClick={() => onNavigate(row.url)}
                className={cn(LAUNCHER_ROW_BASE_CLASS, "hover:bg-state-hover")}
              >
                <span className={LAUNCHER_ROW_ICON_CLASS}>
                  <PluginIcon
                    pluginId={section.pluginId}
                    icon={null}
                    className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
                  />
                </span>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate text-foreground">{row.title}</span>
                  {secondary.length > 0 && secondary !== row.title ? (
                    <span className="truncate font-mono text-muted-foreground [flex-shrink:9999]">
                      {secondary}
                    </span>
                  ) : null}
                </span>
                <LauncherRowTrailing idle={null} isActive={false} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
