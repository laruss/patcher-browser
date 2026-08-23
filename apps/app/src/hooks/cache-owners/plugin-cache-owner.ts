import type { QueryClient } from "@tanstack/react-query";
import {
  allPluginListQueryKeyPrefix,
  pluginListQueryKey,
  pluginSettingsViewQueryKey,
  toPluginListItem,
  type PluginListResult,
  type PluginSettingsView,
} from "../queries/plugin-settings-queries";
import type { InstalledPlugin } from "@patcher/server-contract";
import { allPluginCatalogSearchQueryKeyPrefix } from "../queries/plugin-catalog-queries";
import { pluginToolbarStatesQueryKeyPrefix } from "../queries/plugin-contribution-queries";

/**
 * Cache owner for plugin management data. The PUT /plugins/:id/settings
 * response is the refreshed settings view, so the mutation seeds it directly
 * instead of refetching; realtime `plugins-changed` invalidation (the
 * registry) covers every other writer.
 */
export function applyPluginSettingsView(args: {
  queryClient: QueryClient;
  pluginId: string;
  view: PluginSettingsView;
}): void {
  args.queryClient.setQueryData(
    pluginSettingsViewQueryKey(args.pluginId),
    args.view,
  );
}

/**
 * Seed the canonical installed-plugin response before a post-install route
 * transition. The detail route reads this list, so waiting for invalidation to
 * refetch can otherwise flash a false "Plugin not found" state.
 */
export function applyInstalledPlugin(args: {
  queryClient: QueryClient;
  plugin: InstalledPlugin;
}): void {
  const installed = toPluginListItem(args.plugin);
  args.queryClient.setQueryData<PluginListResult>(
    pluginListQueryKey(true),
    (current) => {
      const plugins = current?.plugins ?? [];
      const existingIndex = plugins.findIndex(
        (candidate) => candidate.id === installed.id,
      );
      if (existingIndex === -1) {
        return { plugins: [...plugins, installed] };
      }
      return {
        plugins: plugins.map((candidate, index) =>
          index === existingIndex ? installed : candidate,
        ),
      };
    },
  );
}

/**
 * Refetch the installed-plugin list after an enable/disable POST. The
 * realtime `plugins-changed` broadcast covers other windows; this gives the
 * acting window an immediate refresh.
 */
export function invalidatePluginList(args: {
  queryClient: QueryClient;
}): Promise<void> {
  return args.queryClient.invalidateQueries({
    queryKey: allPluginListQueryKeyPrefix(),
  });
}

/**
 * Refetch catalog results after an install. Search rows carry installed and
 * compatibility state, so plugin lifecycle changes also invalidate this
 * prefix.
 */
export function invalidatePluginCatalogSearch(args: {
  queryClient: QueryClient;
}): void {
  void args.queryClient.invalidateQueries({
    queryKey: allPluginCatalogSearchQueryKeyPrefix(),
  });
}

/**
 * Ask again what plugins' toolbar controls look like, after a press.
 *
 * The press is the one thing that can change the answer from inside this window
 * — a star that has just saved this page has to fill in — and the plugin is the
 * one who decides what the new look is, so this refetches rather than writing a
 * guess into the cache. Every tab's entry goes, not just the pressed tab's: the
 * same page can be open in more than one.
 */
export function invalidatePluginToolbarStates(args: {
  queryClient: QueryClient;
}): Promise<void> {
  return args.queryClient.invalidateQueries({
    queryKey: pluginToolbarStatesQueryKeyPrefix(),
  });
}
