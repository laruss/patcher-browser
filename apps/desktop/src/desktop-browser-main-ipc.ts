import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import {
  patcherDesktopBrowserAttachRequestSchema,
  patcherDesktopBrowserContextMenuItemsSchema,
  patcherDesktopBrowserPageStylesSchema,
  patcherDesktopBrowserPageScriptsSchema,
  patcherDesktopBrowserPageScriptResultSchema,
  patcherDesktopPageScriptRpcRequestSchema,
  patcherDesktopBrowserDownloadActionRequestSchema,
  patcherDesktopBrowserSetOverlayRequestSchema,
  patcherDesktopBrowserSetFullscreenRequestSchema,
  patcherDesktopBrowserFindRequestSchema,
  patcherDesktopBrowserNavigateRequestSchema,
  patcherDesktopBrowserSetBoundsRequestSchema,
  patcherDesktopBrowserSetVisibleRequestSchema,
  patcherDesktopBrowserSetMutedRequestSchema,
  patcherDesktopBrowserSetZoomRequestSchema,
  patcherDesktopBrowserDialogRespondRequestSchema,
  patcherDesktopBrowserPagePromptAnswerSchema,
  patcherDesktopBrowserPopupTabsSchema,
  patcherDesktopBrowserDevToolsRequestSchema,
  patcherDesktopBrowserDevToolsVisibleRequestSchema,
  patcherDesktopBrowserCaptureFullPageRequestSchema,
  patcherDesktopBrowserControlRequestSchema,
  patcherDesktopBrowserRecordRequestSchema,
  patcherDesktopBrowserInteractRequestSchema,
  patcherDesktopBrowserObserveRequestSchema,
  patcherDesktopBrowserSnapshotRequestSchema,
  patcherDesktopBrowserSnapshotInRequestSchema,
  patcherDesktopBrowserStorageRequestSchema,
  patcherDesktopBrowserTabRefSchema,
  type PatcherDesktopBrowserCaptureFullPageResult,
  type PatcherDesktopBrowserDownloadActionResult,
  type PatcherDesktopBrowserControlResult,
  type PatcherDesktopBrowserRecordResult,
  type PatcherDesktopBrowserInteractResult,
  type PatcherDesktopBrowserObserveResult,
  type PatcherDesktopBrowserPageReadResult,
  type PatcherDesktopBrowserSnapshotResult,
  type PatcherDesktopBrowserStorageResult,
  type PatcherDesktopPageScriptBootstrap,
  type PatcherDesktopPageScriptRpcAnswer,
} from "@patcher/desktop-contract";
import {
  PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DETACH_CHANNEL,
  PATCHER_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  PATCHER_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DOWNLOAD_ACTION_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_CONTEXT_MENU_ITEMS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_PAGE_STYLES_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_PAGE_SCRIPTS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_RESULT_CHANNEL,
  PATCHER_DESKTOP_PAGE_SCRIPT_BOOTSTRAP_CHANNEL,
  PATCHER_DESKTOP_PAGE_SCRIPT_RPC_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_OVERLAY_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_FULLSCREEN_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_POPUP_TABS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_VISIBLE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FIND_CHANNEL,
  PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_RESPOND_CHANNEL,
  PATCHER_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_CONTROL_CHANNEL,
  PATCHER_DESKTOP_BROWSER_RECORD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_INTERACT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_OBSERVE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STORAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_RELOAD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PRINT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_MUTED_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_ZOOM_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STOP_CHANNEL,
} from "./desktop-browser-ipc.js";
import type { DesktopBrowserViewManager } from "./desktop-browser-view.js";

interface DesktopBrowserTabCommandArgs {
  hostWindow: BrowserWindow;
  tabId: string;
}

type DesktopBrowserTabCommand = (args: DesktopBrowserTabCommandArgs) => void;

interface RegisterDesktopBrowserTabCommandArgs {
  channel: string;
  run: DesktopBrowserTabCommand;
}

function hostWindowFromBrowserIpcEvent(
  event: IpcMainEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerTabCommand(args: RegisterDesktopBrowserTabCommandArgs): void {
  ipcMain.on(args.channel, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = patcherDesktopBrowserTabRefSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    args.run({ hostWindow, tabId: parsed.data.tabId });
  });
}

export function registerDesktopBrowserIpc(
  manager: DesktopBrowserViewManager,
): void {
  // Every browser command is renderer -> main fire-and-forget; navigation state
  // flows back over `PATCHER_DESKTOP_BROWSER_STATE_CHANNEL`. Each handler resolves
  // its own host window from the sender, so multi-window is safe, and zod-parses
  // the untrusted-content-adjacent payload before touching the view.
  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserAttachRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.attach({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserNavigateRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.navigate({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserSetBoundsRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setBounds({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserSetVisibleRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setVisible({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_ZOOM_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserSetZoomRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setZoom({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_MUTED_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserSetMutedRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setMuted({ hostWindow, request: parsed.data });
    },
  );

  registerTabCommand({
    channel: PATCHER_DESKTOP_BROWSER_DETACH_CHANNEL,
    run: (args) => manager.detach(args),
  });
  registerTabCommand({
    channel: PATCHER_DESKTOP_BROWSER_PRINT_CHANNEL,
    run: (args) => manager.print(args),
  });
  registerTabCommand({
    channel: PATCHER_DESKTOP_BROWSER_GO_BACK_CHANNEL,
    run: (args) => manager.goBack(args),
  });
  registerTabCommand({
    channel: PATCHER_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
    run: (args) => manager.goForward(args),
  });
  registerTabCommand({
    channel: PATCHER_DESKTOP_BROWSER_RELOAD_CHANNEL,
    run: (args) => manager.reload(args),
  });
  registerTabCommand({
    channel: PATCHER_DESKTOP_BROWSER_STOP_CHANNEL,
    run: (args) => manager.stop(args),
  });

  // The browser channels that answer use `handle` rather than `on`, and must
  // never throw: a rejection crosses `invoke` as a mangled "Error invoking
  // remote method …" string carrying nothing the caller could branch on, so
  // every failure — including an unresolvable window and a malformed payload —
  // comes back as a typed `ok: false` instead.
  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_OVERLAY_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserSetOverlayRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setOverlay({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_FULLSCREEN_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserSetFullscreenRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setFullscreen({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_FIND_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = patcherDesktopBrowserFindRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.find({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserDevToolsRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setDevTools({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_VISIBLE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserDevToolsVisibleRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setDevToolsVisible({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_POPUP_TABS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = patcherDesktopBrowserPopupTabsSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setPopupTabs({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_CONTEXT_MENU_ITEMS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserContextMenuItemsSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setContextMenuItems({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_PAGE_STYLES_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = patcherDesktopBrowserPageStylesSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setPageStyles({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_SET_PAGE_SCRIPTS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = patcherDesktopBrowserPageScriptsSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setPageScripts({ hostWindow, request: parsed.data });
    },
  );

  // The app answering a page script's rpc. Needs no host window — the call id
  // identifies which page is waiting — but still requires the sender to *be* an
  // app window, so a browsed page cannot answer a call on the app's behalf.
  ipcMain.on(
    PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_RESULT_CHANNEL,
    (event, payload: unknown) => {
      if (hostWindowFromBrowserIpcEvent(event) === null) {
        return;
      }
      const parsed =
        patcherDesktopBrowserPageScriptResultSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.respondToPageScriptCall({ result: parsed.data });
    },
  );

  // --- The two channels a browsed page's own preload reaches ---
  //
  // Everything above is the trusted app talking to the shell. These two are a
  // *website's* renderer talking to it, so neither trusts a word of the payload
  // about where it is: the address comes from `event.senderFrame`, which is
  // Chromium's answer, and the manager re-decides what that address is allowed.

  // Synchronous, and answered unconditionally: this runs while the browsed frame
  // is blocked at document start, so any path that failed to set a return value
  // would hang the page rather than merely skip its scripts.
  ipcMain.on(PATCHER_DESKTOP_PAGE_SCRIPT_BOOTSTRAP_CHANNEL, (event) => {
    const empty: PatcherDesktopPageScriptBootstrap = { worlds: [] };
    try {
      const url = event.senderFrame?.url ?? "";
      event.returnValue =
        url.length === 0
          ? empty
          : manager.pageScriptBootstrap({
              webContentsId: event.sender.id,
              url,
            });
    } catch {
      event.returnValue = empty;
    }
  });

  ipcMain.handle(
    PATCHER_DESKTOP_PAGE_SCRIPT_RPC_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<PatcherDesktopPageScriptRpcAnswer> => {
      const parsed =
        patcherDesktopPageScriptRpcRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          message: "patcher.rpc: that call was not understood.",
        };
      }
      const url = event.senderFrame?.url ?? "";
      if (url.length === 0) {
        return {
          ok: false,
          message: "patcher.rpc is not available in this page.",
        };
      }
      try {
        return await manager.pageScriptRpc({
          webContentsId: event.sender.id,
          url,
          request: parsed.data,
        });
      } catch {
        // Every refusal is a resolved `ok: false`, because an invoke rejection
        // reaches the page as an opaque Electron string with nothing in it for
        // the script's author.
        return { ok: false, message: "patcher.rpc: the call failed." };
      }
    },
  );

  // Opening a download needs no host window: the manager answers from the set
  // of paths it wrote, which is not scoped to a window.
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_DOWNLOAD_ACTION_CHANNEL,
    async (
      _event,
      payload: unknown,
    ): Promise<PatcherDesktopBrowserDownloadActionResult> => {
      const parsed =
        patcherDesktopBrowserDownloadActionRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "unknown-path",
          message: "Patcher did not download that file.",
        };
      }
      try {
        return await manager.downloadAction(parsed.data);
      } catch {
        // An invoke rejection reaches the renderer as an opaque string, so
        // every failure becomes a typed refusal instead.
        return {
          ok: false,
          reason: "failed",
          message: "The file could not be opened.",
        };
      }
    },
  );

  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<PatcherDesktopBrowserPageReadResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed = patcherDesktopBrowserTabRefSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, reason: "no-view" };
      }
      try {
        return await manager.readPage({
          hostWindow,
          tabId: parsed.data.tabId,
        });
      } catch {
        return { ok: false, reason: "unreadable" };
      }
    },
  );

  // Same request/response discipline as the page read: a typed refusal, never a
  // rejection, so the renderer can tell "no view" from "DevTools has this tab".
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<PatcherDesktopBrowserSnapshotResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed =
        patcherDesktopBrowserSnapshotRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return { ok: false, reason: "no-view" };
      }
      try {
        return await manager.snapshot({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // The same snapshot, scoped to a selector. A malformed payload answers
  // `failed` rather than `no-view` for the reason the interaction handler
  // below gives: the tab is not the problem, the request is.
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<PatcherDesktopBrowserSnapshotResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed =
        patcherDesktopBrowserSnapshotInRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not a snapshot request this browser understands.",
        };
      }
      try {
        return await manager.snapshotIn({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Acting on a page. A malformed payload answers `failed` rather than
  // `no-view`: the tab is not the problem, the request is, and telling the
  // caller to go activate a tab would send it after the wrong fix.
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_INTERACT_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<PatcherDesktopBrowserInteractResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed =
        patcherDesktopBrowserInteractRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not an interaction this browser understands.",
        };
      }
      try {
        return await manager.interact({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Looking at a page. Same discipline as the interact channel: a malformed
  // payload is the request's fault, not the tab's.
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_OBSERVE_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<PatcherDesktopBrowserObserveResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed =
        patcherDesktopBrowserObserveRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not an observation this browser understands.",
        };
      }
      try {
        return await manager.observe({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // A picture of the whole document. Same discipline as the observe channel,
  // and the same reason a malformed payload is not `no-view`.
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<PatcherDesktopBrowserCaptureFullPageResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed =
        patcherDesktopBrowserCaptureFullPageRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not a capture this browser understands.",
        };
      }
      try {
        return await manager.captureFullPage({
          hostWindow,
          request: parsed.data,
        });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Cookies and web storage. Same discipline again, and the same reason a
  // malformed payload is not `no-view`.
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_STORAGE_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<PatcherDesktopBrowserStorageResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed =
        patcherDesktopBrowserStorageRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not a storage request this browser understands.",
        };
      }
      try {
        return await manager.storage({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Direct control of a tab. Same discipline once more; the refusals this one
  // can carry are wider, but a request that did not parse is still the
  // request's fault.
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_CONTROL_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<PatcherDesktopBrowserControlResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed =
        patcherDesktopBrowserControlRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not a control request this browser understands.",
        };
      }
      try {
        return await manager.control({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Filming a tab. The frames cross here in one reply, so this is the widest
  // payload the browser bridge carries; what bounds it is the recording's caps,
  // applied while it films rather than discovered at the end.
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_RECORD_CHANNEL,
    async (
      event,
      payload: unknown,
    ): Promise<PatcherDesktopBrowserRecordResult> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return { ok: false, reason: "no-view" };
      }
      const parsed =
        patcherDesktopBrowserRecordRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return {
          ok: false,
          reason: "failed",
          message: "That is not a recording request this browser understands.",
        };
      }
      try {
        return await manager.record({ hostWindow, request: parsed.data });
      } catch {
        return { ok: false, reason: "failed" };
      }
    },
  );

  // Answering a page prompt reports whether there was one to answer, for the
  // same reason the dialog channel does — and here the race is real: a prompt
  // can be closed by a navigation while a human is still typing into it.
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_RESPOND_CHANNEL,
    async (event, payload: unknown): Promise<boolean> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return false;
      }
      const parsed =
        patcherDesktopBrowserPagePromptAnswerSchema.safeParse(payload);
      if (!parsed.success) {
        return false;
      }
      try {
        return await manager.respondToPagePrompt({
          hostWindow,
          request: parsed.data,
        });
      } catch {
        return false;
      }
    },
  );

  // Answering a dialog reports whether there was one to answer, so a caller can
  // tell "dismissed it" from "a human got there first".
  ipcMain.handle(
    PATCHER_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL,
    async (event, payload: unknown): Promise<boolean> => {
      const hostWindow = BrowserWindow.fromWebContents(event.sender);
      if (hostWindow === null) {
        return false;
      }
      const parsed =
        patcherDesktopBrowserDialogRespondRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return false;
      }
      try {
        return await manager.respondToDialog({
          hostWindow,
          request: parsed.data,
        });
      } catch {
        return false;
      }
    },
  );
}
