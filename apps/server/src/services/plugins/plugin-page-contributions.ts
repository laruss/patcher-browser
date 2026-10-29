import type { LoadedPlugin } from "./plugin-service-internal.js";
import type { PluginSiteAccess } from "./plugin-site-access.js";
import type {
  PluginPageScriptContribution,
  PluginPageStyleContribution,
} from "./plugin-service.js";

export function listLegacyPageContributions(
  loaded: ReadonlyMap<string, LoadedPlugin>,
  sites?: PluginSiteAccess,
) {
  const styles: PluginPageStyleContribution[] = [],
    scripts: PluginPageScriptContribution[] = [];
  for (const [pluginId, plugin] of [...loaded.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (plugin.manifest.siteAccess === "runtime" || sites?.isRuntime(pluginId))
      continue;
    for (const style of plugin.handle.pageStyles)
      styles.push({
        pluginId,
        styleId: style.id,
        matches: [...style.matches],
        css: style.css,
      });
    for (const script of plugin.handle.pageScripts)
      scripts.push({
        pluginId,
        scriptId: script.id,
        matches: [...script.matches],
        code: script.code,
      });
  }
  return { styles, scripts };
}
