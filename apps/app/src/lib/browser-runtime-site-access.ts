import { z } from "zod";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { scopedPageContributionsSchema } from "@patcher/desktop-contract";
import { getDesktopBrowserApi } from "./patcher-desktop";

export interface PluginSiteAccessStatus {
  pluginId: string;
  name: string;
  enabled: boolean;
  available: boolean;
  origins: string[];
  permissions: string[];
  sites: string[];
}
const statusSchema = z
  .object({
    plugins: z.array(
      z
        .object({
          pluginId: z.string(),
          name: z.string(),
          enabled: z.boolean(),
          available: z.boolean(),
          origins: z.array(z.string()),
          permissions: z.array(z.string()),
          sites: z.array(z.string()),
        })
        .strict(),
    ),
    contributions: scopedPageContributionsSchema,
    cleanup: z.array(
      z.object({ pluginId: z.string(), tabId: z.string() }).strict(),
    ),
  })
  .strict();
export const SITE_ACCESS_QUERY_KEY = ["plugins", "site-access"] as const;
export function usePluginSiteAccess() {
  return useQuery({
    queryKey: SITE_ACCESS_QUERY_KEY,
    queryFn: async () => {
      const response = await fetch("/api/v1/plugins/site-access");
      if (!response.ok) throw new Error("Could not read plugin site access");
      return statusSchema.parse(await response.json());
    },
  });
}

export function useBrowserRuntimeSiteAccess() {
  const client = useQueryClient();
  useEffect(
    () =>
      getDesktopBrowserApi()?.onSiteAccessChanged?.(() => {
        void client.invalidateQueries({ queryKey: SITE_ACCESS_QUERY_KEY });
      }),
    [client],
  );
  const contributions = usePluginSiteAccess().data?.contributions;
  useEffect(() => {
    if (contributions)
      getDesktopBrowserApi()?.setScopedPageContributions?.(contributions);
  }, [contributions]);
  useEffect(() => {
    const browser = getDesktopBrowserApi();
    if (!browser?.onScopedPageScriptCall || !browser.respondToPageScriptCall)
      return;
    const respond = browser.respondToPageScriptCall.bind(browser);
    return browser.onScopedPageScriptCall((call) => {
      void fetch("/api/v1/plugins/site-access/page-rpc", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pluginId: call.pluginId,
          token: call.token,
          method: call.method,
          input: call.input,
        }),
      })
        .then(async (response) => {
          const answer = (await response.json()) as {
            ok: boolean;
            result?: string;
          };
          if (!response.ok || !answer.ok || typeof answer.result !== "string")
            throw new Error("Refused");
          respond({ callId: call.callId, ok: true, result: answer.result });
        })
        .catch(() =>
          respond({
            callId: call.callId,
            ok: false,
            message: "Runtime page RPC refused",
          }),
        );
    });
  }, []);
}

/** Runtime auth answers must reach the separate native capability consumer. */
export async function respondWithRuntimePluginAuth(args: {
  tabId: string;
  id: string;
  host: string;
  insecure: boolean;
}): Promise<boolean> {
  const browser = getDesktopBrowserApi();
  if (!browser?.respondToScopedAuth) return false;
  try {
    const response = await fetch("/api/v1/plugins/site-access/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!response.ok) return false;
    const body = z
      .object({
        ok: z.literal(true),
        credentials: z
          .object({
            token: z.uuid(),
            username: z.string().max(4096),
            password: z.string().max(4096),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .parse(await response.json());
    if (!body.credentials) return false;
    const { token, ...credentials } = body.credentials;
    return await browser.respondToScopedAuth({
      tabId: args.tabId,
      id: args.id,
      token,
      answer: { kind: "credentials", ...credentials },
    });
  } catch {
    return false;
  }
}
