import type {
  PluginBrowserAuthChallenge,
  PluginBrowserAuthCredentials,
} from "@patcher/plugin-sdk";
import type { LoadedPlugin } from "./plugin-service-internal.js";
import type { createPluginRuntime } from "./plugin-runtime.js";
import type { PluginSiteAccess } from "./plugin-site-access.js";
import { withPluginTimeout } from "./plugin-timeout.js";

export async function resolvePluginBrowserAuth(args: {
  challenge: PluginBrowserAuthChallenge;
  runtimePromptId?: string;
  loaded: ReadonlyMap<string, LoadedPlugin>;
  siteAccess?: PluginSiteAccess;
  invokeCallback: ReturnType<typeof createPluginRuntime>["invokeCallback"];
}): Promise<(PluginBrowserAuthCredentials & { token?: string }) | null> {
  const { challenge, runtimePromptId } = args;
  for (const [pluginId, plugin] of [...args.loaded.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const runtime = plugin.manifest.siteAccess === "runtime";
    if (runtime !== (runtimePromptId !== undefined)) continue;
    for (const provider of plugin.handle.authProviders) {
      const invoke = () =>
        args.invokeCallback(
          pluginId,
          { kind: "browserAuth", payload: challenge },
          async (payload) =>
            withPluginTimeout({
              run: async () => provider(payload),
              timeoutMs: 5_000,
            }),
        );
      const outcome = runtime
        ? await args.siteAccess
            ?.withAuthPrompt(
              pluginId,
              challenge.tabId,
              runtimePromptId!,
              invoke,
            )
            .catch(() => ({ ok: false as const }))
        : await invoke();
      if (!outcome || !outcome.ok || outcome.value === null) {
        continue;
      }
      const credentials =
        outcome.value as Partial<PluginBrowserAuthCredentials>;
      // A provider that answered with something other than credentials has
      // not answered: the browser asks the user rather than sending a
      // half-formed login.
      if (
        typeof credentials?.username !== "string" ||
        typeof credentials.password !== "string"
      ) {
        continue;
      }
      const value = {
        username: credentials.username,
        password: credentials.password,
      };
      if (!runtime) return value;
      try {
        const token = await args.siteAccess?.prepareAuth(
          pluginId,
          challenge.tabId,
          runtimePromptId!,
          value,
        );
        if (token) return { ...value, token };
      } catch {
        /* Stale native prompt or revoked policy: try no fallback. */
      }
    }
  }
  return null;
}
