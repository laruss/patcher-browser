import { pluginSiteOrigin } from "@patcher/domain/plugin-site-access";
import type { BrowserViewEntry } from "./desktop-browser-view.js";
import type { SiteTarget } from "./desktop-site-authority.js";
import { rememberCredentialPassword } from "./desktop-credential-redaction.js";
import { CREDENTIAL_WORLD_ID } from "./credential-release-ipc.js";

/** Site operations and native passkey UI share the same tracked tab lifecycle. */
export function createBrowserSiteTargets(
  entries: Map<string, BrowserViewEntry>,
  entriesByWebContentsId: Map<number, BrowserViewEntry>,
  send: Parameters<typeof resolveBrowserSiteTarget>[0]["send"],
) {
  return {
    resolveSiteTarget: (tabId: string) =>
      resolveBrowserSiteTarget({
        tabId,
        entries: entries.values(),
        exists: (entry) =>
          entriesByWebContentsId.get(entry.view.webContents.id) === entry,
        send,
      }),
    webAuthnTarget: (id: number) => {
      const entry = entriesByWebContentsId.get(id);
      if (!entry || entry.hostWindow.isDestroyed()) return null;
      return {
        hostWebContentsId: entry.hostWindow.webContents.id,
        current: () =>
          entriesByWebContentsId.get(id) === entry &&
          !entry.view.webContents.isDestroyed() &&
          !entry.hostWindow.isDestroyed() &&
          entry.visible &&
          !entry.overlayActive &&
          !entry.pendingDialog &&
          !entry.pagePrompt,
      };
    },
  };
}

export function resolveBrowserSiteTarget(args: {
  tabId: string;
  entries: Iterable<BrowserViewEntry>;
  exists(entry: BrowserViewEntry): boolean;
  send(
    entry: BrowserViewEntry,
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;
}): SiteTarget | null {
  const found = [...args.entries].filter(
    (entry) =>
      entry.tabId === args.tabId &&
      !entry.view.webContents.isDestroyed() &&
      !entry.hostWindow.isDestroyed(),
  );
  if (found.length !== 1) return null;
  const entry = found[0]!;
  const current = () => {
    if (
      entry.view.webContents.isDestroyed() ||
      entry.hostWindow.isDestroyed() ||
      !args.exists(entry)
    )
      return null;
    const url = entry.view.webContents.getURL(),
      origin = pluginSiteOrigin(url);
    return origin === null
      ? null
      : { tabId: args.tabId, url, origin, documentId: entry.runtimeDocumentId };
  };
  const context = current();
  if (!context) return null;
  return {
    context,
    current,
    hostWebContentsId: entry.hostWindow.webContents.id,
    credentials: {
      webContentsId: entry.view.webContents.id,
      interactive: () =>
        current() !== null &&
        entry.visible &&
        !entry.overlayActive &&
        !entry.pendingDialog &&
        !entry.pagePrompt &&
        entry.hostWindow.isFocused?.() === true &&
        entry.hostWindow.isMinimized?.() !== true,
      send: (method, params) => args.send(entry, method, params),
      execute: (code) =>
        entry.view.webContents.executeJavaScriptInIsolatedWorld(
          CREDENTIAL_WORLD_ID,
          [{ code }],
        ),
      rememberPassword: (id) =>
        rememberCredentialPassword(entry, context.documentId, id),
    },
    authPrompt: () => {
      const pending = entry.pagePrompt;
      return pending?.details.kind === "auth" && pending.nativeAuth
        ? {
            id: pending.details.id,
            host: pending.details.host,
            insecure: pending.details.insecure,
            ...pending.nativeAuth,
            urls: [
              ...(entry.pendingAuth?.requestUrls ??
                new Set([pending.nativeAuth.url])),
            ],
          }
        : null;
    },
  };
}
