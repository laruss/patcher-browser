import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";
import { z } from "zod";
import {
  SITE_ACCESS_CHANNELS,
  scopedAuthAnswerSchema,
  scopedBrowserCommandSchema,
  scopedPageContributionsSchema,
  patcherDesktopPageScriptRpcRequestSchema,
} from "@patcher/desktop-contract";
import {
  createDesktopSiteAuthority,
  type DesktopSiteAuthority,
} from "./desktop-site-authority.js";
import type { DesktopBrowserViewManager } from "./desktop-browser-view.js";
import { executeScopedBrowserCommand } from "./desktop-scoped-browser-command.js";

export function createNativeSiteAuthority(
  manager: () => DesktopBrowserViewManager | null,
) {
  return createDesktopSiteAuthority({
    resolve: (tabId) => manager()?.resolveSiteTarget(tabId) ?? null,
    changed: () => manager()?.sitePolicyChanged(),
    cleanup: () => manager()?.siteCleanup() ?? [],
    cancelAuth: (target, id) => {
      const hostWindow = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.id === target.hostWebContentsId,
      );
      if (hostWindow)
        void manager()?.respondToPagePrompt({
          hostWindow,
          request: {
            tabId: target.context.tabId,
            id,
            answer: { kind: "cancel" },
          },
        });
    },
    async confirm(policy, target, signal) {
      const window = BrowserWindow.getAllWindows().find(
        (candidate) => candidate.webContents.id === target.hostWebContentsId,
      );
      if (!window || signal.aborted) return false;
      const choice = await dialog.showMessageBox(window, {
        type: "question",
        title: "Allow plugin site access",
        buttons: ["Cancel", "Allow here"],
        defaultId: 0,
        cancelId: 0,
        signal,
        message: `Allow ${policy.name} on ${target.context.origin}?`,
        detail: `Plugin: ${policy.pluginId}\nExact origin: ${target.context.origin}\nPermissions: ${policy.permissions.join(", ")}\nDeclared sites: ${policy.sites.join(", ")}\nAccess continues until you revoke it. Injected scripts may require a page reload to remove.`,
      });
      return choice.response === 1 && !signal.aborted;
    },
  });
}

export function registerDesktopSiteIpc(args: {
  manager: DesktopBrowserViewManager;
  current: () => DesktopSiteAuthority | undefined;
  authorize: (event: IpcMainInvokeEvent) => boolean;
}) {
  ipcMain.handle(SITE_ACCESS_CHANNELS.host, (event) => {
    if (!args.authorize(event)) throw new Error("Refused");
    return event.sender.id;
  });
  ipcMain.handle(SITE_ACCESS_CHANNELS.auth, (event, payload: unknown) => {
    const parsed = scopedAuthAnswerSchema.safeParse(payload),
      authority = args.current(),
      hostWindow = BrowserWindow.fromWebContents(event.sender);
    if (!parsed.success || !authority || !hostWindow || !args.authorize(event))
      return false;
    try {
      authority.consumeAuth(parsed.data, event.sender.id);
      return args.manager.respondToPagePrompt({
        hostWindow,
        request: {
          tabId: parsed.data.tabId,
          id: parsed.data.id,
          answer: parsed.data.answer,
        },
      });
    } catch {
      return false;
    }
  });
  ipcMain.handle(
    SITE_ACCESS_CHANNELS.execute,
    async (event, payload: unknown) => {
      const parsed = scopedBrowserCommandSchema.safeParse(payload);
      const authority = args.current(),
        hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (
        !parsed.success ||
        !authority ||
        !hostWindow ||
        !args.authorize(event)
      )
        return {
          ok: false,
          code: "external_access_denied",
          message: "Runtime site access refused this command",
        };
      return executeScopedBrowserCommand({
        manager: args.manager,
        authority,
        hostWindow,
        ...parsed.data,
      });
    },
  );
  ipcMain.handle(
    SITE_ACCESS_CHANNELS.contributions,
    (event, payload: unknown) => {
      const parsed = scopedPageContributionsSchema.safeParse(payload);
      if (!parsed.success || !args.authorize(event)) return;
      args.current()?.setContributions(parsed.data);
    },
  );
  ipcMain.on(SITE_ACCESS_CHANNELS.bootstrap, (event) => {
    let answer: ReturnType<DesktopBrowserViewManager["siteScriptBootstrap"]> = {
      worlds: [],
      documentId: null,
    };
    try {
      if (event.senderFrame === event.sender.mainFrame)
        answer = args.manager.siteScriptBootstrap(
          event.sender.id,
          event.senderFrame.url,
        );
    } catch {
      /* Empty bootstrap fails closed. */
    }
    event.returnValue = answer;
  });
  ipcMain.on(SITE_ACCESS_CHANNELS.restored, (event) => {
    event.returnValue =
      event.senderFrame === event.sender.mainFrame
        ? args.manager.siteDocumentRestored(event.sender.id)
        : null;
  });
  const requestSchema = patcherDesktopPageScriptRpcRequestSchema
    .extend({ documentId: z.uuid() })
    .strict();
  ipcMain.handle(SITE_ACCESS_CHANNELS.rpc, async (event, payload: unknown) => {
    const parsed = requestSchema.safeParse(payload);
    if (!parsed.success || event.senderFrame !== event.sender.mainFrame)
      return { ok: false, message: "Runtime page RPC refused" };
    const { documentId, ...request } = parsed.data;
    try {
      return await args.manager.pageScriptRpc({
        webContentsId: event.sender.id,
        url: event.senderFrame.url,
        documentId,
        request,
      });
    } catch {
      return { ok: false, message: "Runtime page RPC refused" };
    }
  });
}
