import { z } from "zod";

const pluginList = z.object({
  plugins: z.array(
    z.object({
      id: z.string(),
      enabled: z.boolean(),
      source: z.string(),
      provenance: z.string(),
    }),
  ),
});

/** Menu visibility follows the plugin setting, independently of vault/Keychain
 * readiness. This metadata does not authorize any credential operation. */
export async function fetchPasswordManagerMenuEnabled(args: {
  serverUrl: string;
  fetchImpl: typeof fetch;
  headers: HeadersInit;
}): Promise<boolean> {
  const url = new URL(args.serverUrl);
  url.pathname = "/api/v1/plugins";
  url.search = "";
  url.hash = "";
  const response = await args.fetchImpl(url.toString(), {
    headers: args.headers,
  });
  if (!response.ok)
    throw new Error(`Plugin metadata request failed: HTTP ${response.status}`);
  const payload = pluginList.parse(await response.json());
  return payload.plugins.some(
    (plugin) =>
      plugin.id === "password-manager" &&
      plugin.enabled &&
      plugin.provenance === "builtin" &&
      plugin.source === "builtin:password-manager",
  );
}
