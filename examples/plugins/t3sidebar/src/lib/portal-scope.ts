/**
 * Portaled content leaves the plugin mount. These attributes restore the
 * plugin style scope and mark the content as an interactive overlay.
 */
declare const __PATCHER_PLUGIN_ID__: string | undefined;

export function usePortalScopeProps(): {
  "data-patcher-portaled-overlay": "";
  "data-patcher-plugin-root": "";
  "data-patcher-plugin"?: string;
} {
  const pluginId =
    typeof __PATCHER_PLUGIN_ID__ === "string"
      ? __PATCHER_PLUGIN_ID__
      : undefined;
  return {
    "data-patcher-portaled-overlay": "",
    "data-patcher-plugin-root": "",
    ...(pluginId === undefined ? {} : { "data-patcher-plugin": pluginId }),
  };
}
