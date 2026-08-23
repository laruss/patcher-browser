import { useMemo } from "react";
import {
  BUILT_IN_BROWSER_SEARCH_ENGINES,
  DEFAULT_BROWSER_SEARCH_ENGINE_ID,
  resolveBrowserSearchEngine,
  type BrowserSearchEngine,
} from "@patcher/domain/browser-search-engine";
import { usePluginContributions } from "@/hooks/queries/plugin-contribution-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";

/**
 * Which search engine the address bar uses, and the whole list to choose from.
 *
 * Two sources: Patcher's own engines and whatever plugins declared
 * (`patcher.browser.registerSearchEngine`). Read through a hook rather than threaded
 * as a prop because the two places that need it — the omnibox and the surface —
 * are not on one path, and both are already inside the query cache.
 */
export interface BrowserSearchEngineOption extends BrowserSearchEngine {
  /** Null for Patcher's own; the plugin's id for a declared one, so the list can say. */
  pluginId: string | null;
}

export function useBrowserSearchEngineOptions(): readonly BrowserSearchEngineOption[] {
  const contributed = usePluginContributions().data?.browserSearchEngines;
  return useMemo(() => {
    const options: BrowserSearchEngineOption[] =
      BUILT_IN_BROWSER_SEARCH_ENGINES.map((engine) => ({
        ...engine,
        pluginId: null,
      }));
    for (const engine of contributed ?? []) {
      // Patcher's own win a collision: a plugin cannot quietly replace the engine the
      // user's setting already names.
      if (options.some((option) => option.id === engine.id)) {
        continue;
      }
      options.push({
        id: engine.id,
        name: engine.name,
        urlTemplate: engine.urlTemplate,
        pluginId: engine.pluginId,
      });
    }
    return options;
  }, [contributed]);
}

/**
 * The engine to search with. Falls back to Patcher's default while the config is
 * still loading and for a setting naming an engine whose plugin is gone — see
 * {@link resolveBrowserSearchEngine}.
 */
export function useBrowserSearchEngine(): BrowserSearchEngine {
  // `generalSettings` is optional-chained the way the rest of the app does it: the
  // config can be absent while it loads, and a partial one is what an offline or
  // stubbed client has.
  const engineId =
    useSystemConfig().data?.generalSettings?.browserSearchEngineId ??
    DEFAULT_BROWSER_SEARCH_ENGINE_ID;
  const options = useBrowserSearchEngineOptions();
  return useMemo(
    () => resolveBrowserSearchEngine({ engineId, engines: options }),
    [engineId, options],
  );
}
