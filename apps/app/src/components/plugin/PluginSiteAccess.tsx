import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  pluginSiteCeilingAllows,
  pluginSiteOrigin,
} from "@patcher/domain/plugin-site-access";
import {
  usePluginSiteAccess,
  SITE_ACCESS_QUERY_KEY,
  type PluginSiteAccessStatus,
} from "@/lib/browser-runtime-site-access";
import { getDesktopBrowserApi } from "@/lib/patcher-desktop";

function SiteAccessControls({
  plugin,
  tabId,
  url,
  cleanup,
}: {
  plugin: PluginSiteAccessStatus;
  tabId?: string;
  url?: string;
  cleanup: Array<{ pluginId: string; tabId: string }>;
}) {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const origin = url ? pluginSiteOrigin(url) : null;
  const allowed = origin !== null && plugin.origins.includes(origin);
  async function mutate(method: "confirm" | "revoke", grantedOrigin?: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/plugins/site-access/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pluginId: plugin.pluginId,
          ...(method === "confirm" ? { tabId } : { origin: grantedOrigin }),
        }),
      });
      if (!response.ok) throw new Error("Site access was refused or cancelled");
      await client.invalidateQueries({ queryKey: SITE_ACCESS_QUERY_KEY });
    } catch {
      setError("Site access was refused or cancelled");
    } finally {
      setBusy(false);
    }
  }
  const pending = cleanup.filter(
    (item) =>
      item.pluginId === plugin.pluginId &&
      (tabId === undefined || tabId === item.tabId),
  );
  return (
    <div className="flex flex-col gap-2 p-3 text-xs">
      <span className="font-medium">{plugin.name}</span>
      <span className="break-all text-muted-foreground">
        Declared sites: {plugin.sites.join(", ") || "None"}
      </span>
      <span className="break-all text-muted-foreground">
        Permissions: {plugin.permissions.join(", ") || "None"}
      </span>
      {!plugin.available ? (
        <span>Site access requires the connected desktop app.</span>
      ) : null}
      {tabId && origin && pluginSiteCeilingAllows(plugin.sites, url!) ? (
        <button
          type="button"
          disabled={busy || !plugin.available || (!allowed && !plugin.enabled)}
          className="text-left underline"
          onClick={() => {
            void mutate(allowed ? "revoke" : "confirm", origin);
          }}
        >
          {allowed ? `Revoke ${origin}` : `Allow here: ${origin}`}
        </button>
      ) : null}
      {tabId === undefined
        ? plugin.origins.map((item) => (
            <div className="flex justify-between gap-2" key={item}>
              <span className="break-all">{item}</span>
              <button
                type="button"
                disabled={busy}
                className="underline"
                onClick={() => {
                  void mutate("revoke", item);
                }}
              >
                Revoke
              </button>
            </div>
          ))
        : null}
      {pending.map((item) => (
        <div key={item.tabId} className="flex flex-col gap-1">
          <span>
            Access was revoked. Previously injected scripts may remain until
            this page is reloaded.
          </span>
          <button
            type="button"
            className="text-left underline"
            onClick={() => {
              getDesktopBrowserApi()?.reload(item.tabId);
              void client.invalidateQueries({
                queryKey: SITE_ACCESS_QUERY_KEY,
              });
            }}
          >
            Reload page
          </button>
        </div>
      ))}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}

export function PluginSiteAccess({ pluginId }: { pluginId: string }) {
  const query = usePluginSiteAccess(),
    plugin = query.data?.plugins.find((item) => item.pluginId === pluginId);
  if (!plugin) return null;
  return (
    <div className="rounded border border-border">
      <div className="p-3 text-sm font-medium">Site access</div>
      <SiteAccessControls plugin={plugin} cleanup={query.data?.cleanup ?? []} />
    </div>
  );
}
export function BrowserRuntimeSiteAccess({
  tabId,
  url,
}: {
  tabId: string;
  url: string;
}) {
  const query = usePluginSiteAccess();
  const plugins =
    query.data?.plugins.filter(
      (plugin) =>
        pluginSiteCeilingAllows(plugin.sites, url) ||
        query.data?.cleanup.some(
          (item) => item.pluginId === plugin.pluginId && item.tabId === tabId,
        ),
    ) ?? [];
  return (
    <>
      {plugins.map((plugin) => (
        <SiteAccessControls
          key={plugin.pluginId}
          plugin={plugin}
          tabId={tabId}
          url={url}
          cleanup={query.data?.cleanup ?? []}
        />
      ))}
    </>
  );
}
