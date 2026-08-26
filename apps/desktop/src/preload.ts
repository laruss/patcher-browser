import { contextBridge, ipcRenderer, webFrame } from "electron";
import { appCommandIdSchema } from "@patcher/domain";
import {
  patcherDesktopBrowserCaptureFullPageResultSchema,
  patcherDesktopBrowserDownloadActionResultSchema,
  patcherDesktopBrowserContextMenuInvokeSchema,
  patcherDesktopBrowserSearchSelectionSchema,
  patcherDesktopBrowserDownloadSchema,
  patcherDesktopBrowserFaviconSchema,
  patcherDesktopBrowserFindResultSchema,
  patcherDesktopBrowserInteractResultSchema,
  patcherDesktopBrowserControlResultSchema,
  patcherDesktopBrowserRecordResultSchema,
  patcherDesktopBrowserObserveResultSchema,
  patcherDesktopBrowserOpenTabRequestSchema,
  patcherDesktopBrowserPageReadResultSchema,
  patcherDesktopBrowserScopedOpenTabRequestSchema,
  patcherDesktopBrowserExternalUrlsSchema,
  patcherDesktopDefaultBrowserStatusSchema,
  patcherDesktopBrowserDialogSchema,
  patcherDesktopBrowserPagePromptSchema,
  patcherDesktopBrowserPopupSchema,
  patcherDesktopBrowserDevToolsStateSchema,
  patcherDesktopBrowserSnapshotResultSchema,
  patcherDesktopBrowserSnapshotSchema,
  patcherDesktopBrowserStateSchema,
  patcherDesktopBrowserStorageResultSchema,
  patcherDesktopInfoSchema,
  patcherDesktopWindowStateSchema,
  type PatcherDesktopApi,
  type PatcherDesktopAppCommandHandler,
  type PatcherDesktopBrowserApi,
  type PatcherDesktopBrowserDownloadActionRequest,
  type PatcherDesktopBrowserSetOverlayRequest,
  type PatcherDesktopBrowserSetFullscreenRequest,
  type PatcherDesktopBrowserDownloadActionResult,
  type PatcherDesktopBrowserDownloadHandler,
  type PatcherDesktopBrowserContextMenuInvokeHandler,
  type PatcherDesktopBrowserContextMenuItems,
  type PatcherDesktopBrowserPageStyles,
  type PatcherDesktopBrowserPageScripts,
  type PatcherDesktopBrowserPageScriptResult,
  type PatcherDesktopBrowserPageScriptCallHandler,
  patcherDesktopBrowserPageScriptCallSchema,
  type PatcherDesktopBrowserSearchSelectionHandler,
  type PatcherDesktopBrowserFaviconHandler,
  type PatcherDesktopBrowserExternalUrlsPendingHandler,
  type PatcherDesktopDefaultBrowserStatus,
  type PatcherDesktopDefaultBrowserStatusChangeHandler,
  type PatcherDesktopBrowserFindRequest,
  type PatcherDesktopBrowserFindResultHandler,
  type PatcherDesktopBrowserCaptureFullPageResult,
  type PatcherDesktopBrowserInteractResult,
  type PatcherDesktopBrowserControlResult,
  type PatcherDesktopBrowserRecordResult,
  type PatcherDesktopBrowserObserveResult,
  type PatcherDesktopBrowserOpenTabHandler,
  type PatcherDesktopBrowserPageReadResult,
  type PatcherDesktopBrowserScopedOpenTabHandler,
  type PatcherDesktopBrowserDialogHandler,
  type PatcherDesktopBrowserPagePromptHandler,
  type PatcherDesktopBrowserPopupHandler,
  type PatcherDesktopBrowserPopupTabs,
  type PatcherDesktopBrowserDevToolsRequest,
  type PatcherDesktopBrowserDevToolsVisibleRequest,
  type PatcherDesktopBrowserDevToolsStateHandler,
  type PatcherDesktopBrowserSnapshotResult,
  type PatcherDesktopBrowserSnapshotHandler,
  type PatcherDesktopBrowserStateHandler,
  type PatcherDesktopBrowserStorageResult,
  type PatcherDesktopBrowserUnsubscribe,
  type PatcherDesktopBrowserViewBounds,
  type PatcherDesktopCloseWindowRequestHandler,
  type PatcherDesktopInfo,
  type PatcherDesktopInfoChangeHandler,
  type PatcherDesktopInfoUnsubscribe,
  type PatcherDesktopOpenNewTabHandler,
  type PatcherDesktopTheme,
  type PatcherDesktopWindowState,
  type PatcherDesktopWindowStateChangeHandler,
  patcherDesktopBrowserPageSecuritySchema,
  type PatcherDesktopBrowserPageSecurityHandler,
  type PatcherDesktopBrowserSetMutedRequest,
  type PatcherDesktopBrowserSetZoomRequest,
  type PatcherDesktopBrowserTabRef,
  type PatcherDesktopBrowserZoomHandler,
  patcherDesktopBrowserZoomSchema,
  PATCHER_DESKTOP_WINDOW_KEY_ARGUMENT_PREFIX,
} from "@patcher/desktop-contract";
import {
  PATCHER_DESKTOP_CHECK_FOR_UPDATES_CHANNEL,
  PATCHER_DESKTOP_GET_INFO_CHANNEL,
  PATCHER_DESKTOP_INFO_CHANGED_CHANNEL,
  PATCHER_DESKTOP_INSTALL_UPDATE_CHANNEL,
  PATCHER_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
  PATCHER_DESKTOP_SET_THEME_CHANNEL,
} from "./desktop-update-ipc.js";
import {
  PATCHER_DESKTOP_DEFAULT_BROWSER_CHANGED_CHANNEL,
  PATCHER_DESKTOP_GET_DEFAULT_BROWSER_CHANNEL,
  PATCHER_DESKTOP_REQUEST_DEFAULT_BROWSER_CHANNEL,
} from "./desktop-default-browser.js";
import {
  PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL,
  PATCHER_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DETACH_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DOWNLOAD_ACTION_CHANNEL,
  PATCHER_DESKTOP_BROWSER_CONTEXT_MENU_INVOKE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SEARCH_SELECTION_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_CONTEXT_MENU_ITEMS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_PAGE_STYLES_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_PAGE_SCRIPTS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_RESULT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_OVERLAY_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_FULLSCREEN_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DOWNLOAD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FAVICON_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FIND_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  PATCHER_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_CONTROL_CHANNEL,
  PATCHER_DESKTOP_BROWSER_RECORD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
  PATCHER_DESKTOP_BROWSER_OBSERVE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_RELOAD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  PATCHER_DESKTOP_BROWSER_TAKE_EXTERNAL_URLS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_EXTERNAL_URLS_PENDING_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STORAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DIALOG_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_RESPOND_CHANNEL,
  PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_POPUP_TABS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_VISIBLE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_INTERACT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PRINT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_SECURITY_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_MUTED_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_ZOOM_CHANNEL,
  PATCHER_DESKTOP_BROWSER_ZOOM_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STATE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STOP_CHANNEL,
} from "./desktop-browser-ipc.js";
import {
  PATCHER_DESKTOP_APP_COMMAND_CHANNEL,
  PATCHER_DESKTOP_CLOSE_WINDOW_CHANNEL,
  PATCHER_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
  PATCHER_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
  PATCHER_DESKTOP_GET_WINDOW_STATE_CHANNEL,
  PATCHER_DESKTOP_OPEN_NEW_TAB_CHANNEL,
  PATCHER_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
} from "./desktop-window-command-ipc.js";
import {
  PATCHER_DESKTOP_SPELLCHECK_GLOBAL_NAME,
  type PatcherDesktopSpellcheckApi,
} from "./desktop-spellcheck-contract.js";

function getDesktopVersion(version: string | undefined): string {
  if (version === undefined || version.length === 0) {
    throw new Error("Desktop version must be injected at build time");
  }
  return version;
}

function createInitialDesktopInfo(): PatcherDesktopInfo {
  return {
    downloadState: "idle",
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: getDesktopVersion(process.env.PATCHER_DESKTOP_VERSION),
  };
}

function createInitialDesktopWindowState(): PatcherDesktopWindowState {
  return {
    isFullScreen: false,
  };
}

const listeners = new Set<PatcherDesktopInfoChangeHandler>();
const appCommandListeners = new Set<PatcherDesktopAppCommandHandler>();
const windowStateListeners = new Set<PatcherDesktopWindowStateChangeHandler>();
let currentInfo = createInitialDesktopInfo();
let currentWindowState = createInitialDesktopWindowState();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(currentInfo);
  }
}

function notifyWindowStateListeners(): void {
  for (const listener of windowStateListeners) {
    listener(currentWindowState);
  }
}

function applyDesktopInfoPayload(payload: unknown): PatcherDesktopInfo | null {
  const parsed = patcherDesktopInfoSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  currentInfo = parsed.data;
  notifyListeners();
  return currentInfo;
}

function applyDesktopWindowStatePayload(
  payload: unknown,
): PatcherDesktopWindowState | null {
  const parsed = patcherDesktopWindowStateSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  currentWindowState = parsed.data;
  notifyWindowStateListeners();
  return currentWindowState;
}

async function invokeDesktopInfo(channel: string): Promise<PatcherDesktopInfo> {
  try {
    const payload: unknown = await ipcRenderer.invoke(channel);
    return applyDesktopInfoPayload(payload) ?? currentInfo;
  } catch {
    return currentInfo;
  }
}

async function invokeDesktopWindowState(): Promise<PatcherDesktopWindowState> {
  try {
    const payload: unknown = await ipcRenderer.invoke(
      PATCHER_DESKTOP_GET_WINDOW_STATE_CHANNEL,
    );
    return applyDesktopWindowStatePayload(payload) ?? currentWindowState;
  } catch {
    return currentWindowState;
  }
}

async function invokeInstallUpdate(): Promise<void> {
  try {
    await ipcRenderer.invoke(PATCHER_DESKTOP_INSTALL_UPDATE_CHANNEL);
  } catch {
    return;
  }
}

const browserStateListeners = new Set<PatcherDesktopBrowserStateHandler>();
const browserOpenTabListeners = new Set<PatcherDesktopBrowserOpenTabHandler>();
const browserScopedOpenTabListeners =
  new Set<PatcherDesktopBrowserScopedOpenTabHandler>();
const browserExternalUrlsPendingListeners =
  new Set<PatcherDesktopBrowserExternalUrlsPendingHandler>();
const defaultBrowserStatusListeners =
  new Set<PatcherDesktopDefaultBrowserStatusChangeHandler>();
const browserSnapshotListeners =
  new Set<PatcherDesktopBrowserSnapshotHandler>();
const browserFaviconListeners = new Set<PatcherDesktopBrowserFaviconHandler>();
const browserZoomListeners = new Set<PatcherDesktopBrowserZoomHandler>();
const browserPageSecurityListeners =
  new Set<PatcherDesktopBrowserPageSecurityHandler>();
const browserDownloadListeners =
  new Set<PatcherDesktopBrowserDownloadHandler>();
const browserFindResultListeners =
  new Set<PatcherDesktopBrowserFindResultHandler>();
const browserSearchSelectionListeners =
  new Set<PatcherDesktopBrowserSearchSelectionHandler>();
const browserContextMenuInvokeListeners =
  new Set<PatcherDesktopBrowserContextMenuInvokeHandler>();
const browserDialogListeners = new Set<PatcherDesktopBrowserDialogHandler>();
const browserPageScriptCallListeners =
  new Set<PatcherDesktopBrowserPageScriptCallHandler>();
const browserPagePromptListeners =
  new Set<PatcherDesktopBrowserPagePromptHandler>();
const browserPopupListeners = new Set<PatcherDesktopBrowserPopupHandler>();
const browserDevToolsListeners =
  new Set<PatcherDesktopBrowserDevToolsStateHandler>();
const closeWindowRequestListeners =
  new Set<PatcherDesktopCloseWindowRequestHandler>();
const openNewTabListeners = new Set<PatcherDesktopOpenNewTabHandler>();

function normalizeSpellcheckWord(word: string): string | null {
  const normalized = word.trim();
  if (
    normalized.length === 0 ||
    normalized.length > 80 ||
    /\s/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

const patcherSpellcheckApi: PatcherDesktopSpellcheckApi = {
  getCorrectionContext(word) {
    const normalized = normalizeSpellcheckWord(word);
    if (normalized === null || !webFrame.isWordMisspelled(normalized)) {
      return null;
    }
    return {
      dictionarySuggestions: webFrame.getWordSuggestions(normalized),
      misspelledWord: normalized,
    };
  },
};

function browserViewBoundsAtWindowScale(
  bounds: PatcherDesktopBrowserViewBounds,
): PatcherDesktopBrowserViewBounds {
  const zoomFactor = webFrame.getZoomFactor();
  if (zoomFactor === 1) {
    return bounds;
  }
  const x = Math.round(bounds.x * zoomFactor);
  const y = Math.round(bounds.y * zoomFactor);
  return {
    x,
    y,
    width: Math.max(0, Math.round((bounds.x + bounds.width) * zoomFactor) - x),
    height: Math.max(
      0,
      Math.round((bounds.y + bounds.height) * zoomFactor) - y,
    ),
  };
}

const patcherBrowserApi: PatcherDesktopBrowserApi = {
  attach(request): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL, {
      ...request,
      bounds: browserViewBoundsAtWindowScale(request.bounds),
    });
  },
  detach(tabId): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_DETACH_CHANNEL, { tabId });
  },
  navigate(request): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_NAVIGATE_CHANNEL, request);
  },
  goBack(tabId): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_GO_BACK_CHANNEL, { tabId });
  },
  goForward(tabId): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_GO_FORWARD_CHANNEL, { tabId });
  },
  reload(tabId): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_RELOAD_CHANNEL, { tabId });
  },
  stop(tabId): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_STOP_CHANNEL, { tabId });
  },
  setBounds(request): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL, {
      ...request,
      bounds: browserViewBoundsAtWindowScale(request.bounds),
    });
  },
  setVisible(request): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL, request);
  },
  onState(listener): PatcherDesktopBrowserUnsubscribe {
    browserStateListeners.add(listener);
    return () => {
      browserStateListeners.delete(listener);
    };
  },
  onOpenTab(listener): PatcherDesktopBrowserUnsubscribe {
    browserOpenTabListeners.add(listener);
    return () => {
      browserOpenTabListeners.delete(listener);
    };
  },
  onScopedOpenTab(listener): PatcherDesktopBrowserUnsubscribe {
    browserScopedOpenTabListeners.add(listener);
    return () => {
      browserScopedOpenTabListeners.delete(listener);
    };
  },
  async takeExternalUrls(): Promise<string[]> {
    // Parse here and swallow rejections, the way `readPage` does: the SPA gets a
    // list it can loop over, never a transport error.
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_TAKE_EXTERNAL_URLS_CHANNEL,
      );
      const parsed = patcherDesktopBrowserExternalUrlsSchema.safeParse(payload);
      return parsed.success ? parsed.data.urls : [];
    } catch {
      return [];
    }
  },
  onExternalUrlsPending(listener): PatcherDesktopBrowserUnsubscribe {
    browserExternalUrlsPendingListeners.add(listener);
    return () => {
      browserExternalUrlsPendingListeners.delete(listener);
    };
  },
  onSnapshot(listener): PatcherDesktopBrowserUnsubscribe {
    browserSnapshotListeners.add(listener);
    return () => {
      browserSnapshotListeners.delete(listener);
    };
  },
  onFavicon(listener): PatcherDesktopBrowserUnsubscribe {
    browserFaviconListeners.add(listener);
    return () => {
      browserFaviconListeners.delete(listener);
    };
  },
  onZoom(listener): PatcherDesktopBrowserUnsubscribe {
    browserZoomListeners.add(listener);
    return () => {
      browserZoomListeners.delete(listener);
    };
  },
  setZoom(request: PatcherDesktopBrowserSetZoomRequest): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_SET_ZOOM_CHANNEL, request);
  },
  onPageSecurity(listener): PatcherDesktopBrowserUnsubscribe {
    browserPageSecurityListeners.add(listener);
    return () => {
      browserPageSecurityListeners.delete(listener);
    };
  },
  setMuted(request: PatcherDesktopBrowserSetMutedRequest): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_SET_MUTED_CHANNEL, request);
  },
  print(request: PatcherDesktopBrowserTabRef): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_PRINT_CHANNEL, request);
  },
  onDownload(listener): PatcherDesktopBrowserUnsubscribe {
    browserDownloadListeners.add(listener);
    return () => {
      browserDownloadListeners.delete(listener);
    };
  },
  setContextMenuItems(request: PatcherDesktopBrowserContextMenuItems): void {
    ipcRenderer.send(
      PATCHER_DESKTOP_BROWSER_SET_CONTEXT_MENU_ITEMS_CHANNEL,
      request,
    );
  },
  setPageStyles(request: PatcherDesktopBrowserPageStyles): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_SET_PAGE_STYLES_CHANNEL, request);
  },
  setPageScripts(request: PatcherDesktopBrowserPageScripts): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_SET_PAGE_SCRIPTS_CHANNEL, request);
  },
  onPageScriptCall(listener): PatcherDesktopBrowserUnsubscribe {
    browserPageScriptCallListeners.add(listener);
    return () => {
      browserPageScriptCallListeners.delete(listener);
    };
  },
  respondToPageScriptCall(result: PatcherDesktopBrowserPageScriptResult): void {
    ipcRenderer.send(
      PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_RESULT_CHANNEL,
      result,
    );
  },
  onContextMenuInvoke(listener): PatcherDesktopBrowserUnsubscribe {
    browserContextMenuInvokeListeners.add(listener);
    return () => {
      browserContextMenuInvokeListeners.delete(listener);
    };
  },
  onSearchSelection(listener): PatcherDesktopBrowserUnsubscribe {
    browserSearchSelectionListeners.add(listener);
    return () => {
      browserSearchSelectionListeners.delete(listener);
    };
  },
  setOverlay(request: PatcherDesktopBrowserSetOverlayRequest): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_SET_OVERLAY_CHANNEL, request);
  },
  setFullscreen(request: PatcherDesktopBrowserSetFullscreenRequest): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_SET_FULLSCREEN_CHANNEL, request);
  },
  find(request: PatcherDesktopBrowserFindRequest): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_FIND_CHANNEL, request);
  },
  onFindResult(listener): PatcherDesktopBrowserUnsubscribe {
    browserFindResultListeners.add(listener);
    return () => {
      browserFindResultListeners.delete(listener);
    };
  },
  async downloadAction(
    request: PatcherDesktopBrowserDownloadActionRequest,
  ): Promise<PatcherDesktopBrowserDownloadActionResult> {
    // Same discipline as `readPage`: parse here and swallow rejections, so the
    // SPA always gets a value it can branch on.
    const failed = {
      ok: false,
      reason: "failed",
      message: "The file could not be opened.",
    } as const;
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_DOWNLOAD_ACTION_CHANNEL,
        request,
      );
      const parsed =
        patcherDesktopBrowserDownloadActionResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : failed;
    } catch {
      return failed;
    }
  },
  async readPage(tabId): Promise<PatcherDesktopBrowserPageReadResult> {
    // Parse here and swallow rejections, the same way `invokeDesktopInfo` does:
    // the SPA gets a value it can branch on, never a transport error.
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
        { tabId },
      );
      const parsed =
        patcherDesktopBrowserPageReadResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "unreadable" };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  },
  onDialog(listener): PatcherDesktopBrowserUnsubscribe {
    browserDialogListeners.add(listener);
    return () => {
      browserDialogListeners.delete(listener);
    };
  },
  setPopupTabs(request: PatcherDesktopBrowserPopupTabs): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_SET_POPUP_TABS_CHANNEL, request);
  },
  setDevTools(request: PatcherDesktopBrowserDevToolsRequest): void {
    ipcRenderer.send(PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_CHANNEL, {
      ...request,
      bounds: browserViewBoundsAtWindowScale(request.bounds),
    });
  },
  setDevToolsVisible(
    request: PatcherDesktopBrowserDevToolsVisibleRequest,
  ): void {
    ipcRenderer.send(
      PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_VISIBLE_CHANNEL,
      request,
    );
  },
  onDevToolsState(listener): PatcherDesktopBrowserUnsubscribe {
    browserDevToolsListeners.add(listener);
    return () => {
      browserDevToolsListeners.delete(listener);
    };
  },
  onPopup(listener): PatcherDesktopBrowserUnsubscribe {
    browserPopupListeners.add(listener);
    return () => {
      browserPopupListeners.delete(listener);
    };
  },
  onPagePrompt(listener): PatcherDesktopBrowserUnsubscribe {
    browserPagePromptListeners.add(listener);
    return () => {
      browserPagePromptListeners.delete(listener);
    };
  },
  async respondToPagePrompt(answer): Promise<boolean> {
    try {
      const answered: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_RESPOND_CHANNEL,
        answer,
      );
      return answered === true;
    } catch {
      return false;
    }
  },
  async respondToDialog(request): Promise<boolean> {
    try {
      const answered: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL,
        request,
      );
      return answered === true;
    } catch {
      return false;
    }
  },
  async snapshot(request): Promise<PatcherDesktopBrowserSnapshotResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL,
        request,
      );
      const parsed =
        patcherDesktopBrowserSnapshotResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async snapshotIn(request): Promise<PatcherDesktopBrowserSnapshotResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
        request,
      );
      const parsed =
        patcherDesktopBrowserSnapshotResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async interact(request): Promise<PatcherDesktopBrowserInteractResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_INTERACT_CHANNEL,
        request,
      );
      const parsed =
        patcherDesktopBrowserInteractResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async observe(request): Promise<PatcherDesktopBrowserObserveResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_OBSERVE_CHANNEL,
        request,
      );
      const parsed =
        patcherDesktopBrowserObserveResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async captureFullPage(
    request,
  ): Promise<PatcherDesktopBrowserCaptureFullPageResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
        request,
      );
      const parsed =
        patcherDesktopBrowserCaptureFullPageResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async storage(request): Promise<PatcherDesktopBrowserStorageResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_STORAGE_CHANNEL,
        request,
      );
      const parsed =
        patcherDesktopBrowserStorageResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async control(request): Promise<PatcherDesktopBrowserControlResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_CONTROL_CHANNEL,
        request,
      );
      const parsed =
        patcherDesktopBrowserControlResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
  async record(request): Promise<PatcherDesktopBrowserRecordResult> {
    try {
      const payload: unknown = await ipcRenderer.invoke(
        PATCHER_DESKTOP_BROWSER_RECORD_CHANNEL,
        request,
      );
      const parsed = patcherDesktopBrowserRecordResultSchema.safeParse(payload);
      return parsed.success ? parsed.data : { ok: false, reason: "failed" };
    } catch {
      return { ok: false, reason: "failed" };
    }
  },
};

/**
 * Which window this renderer is, handed over as a launch argument because the
 * app reads it while its modules initialise — see `PatcherDesktopApi.windowKey`.
 * Absent only if the shell and the preload came from different builds.
 */
const windowKey = process.argv
  .find((argument) =>
    argument.startsWith(PATCHER_DESKTOP_WINDOW_KEY_ARGUMENT_PREFIX),
  )
  ?.slice(PATCHER_DESKTOP_WINDOW_KEY_ARGUMENT_PREFIX.length);

/**
 * Parse here and swallow rejections, the way `invokeDesktopInfo` does: a shell
 * that predates these channels answers with a rejection, and "Patcher is not the
 * default and cannot ask" is exactly what such a shell means.
 */
async function invokeDefaultBrowserStatus(
  channel: string,
): Promise<PatcherDesktopDefaultBrowserStatus> {
  const unavailable = { canRequest: false, isDefault: false } as const;
  try {
    const payload: unknown = await ipcRenderer.invoke(channel);
    const parsed = patcherDesktopDefaultBrowserStatusSchema.safeParse(payload);
    return parsed.success ? parsed.data : unavailable;
  } catch {
    return unavailable;
  }
}

const patcherDesktopApi: PatcherDesktopApi = {
  browser: patcherBrowserApi,
  ...(windowKey === undefined || windowKey.length === 0 ? {} : { windowKey }),
  get lastCheckedAt() {
    return currentInfo.lastCheckedAt;
  },
  get latestVersion() {
    return currentInfo.latestVersion;
  },
  get pendingVersion() {
    return currentInfo.pendingVersion;
  },
  platform: "macos",
  get updateAvailable() {
    return currentInfo.updateAvailable;
  },
  get updateDownloaded() {
    return currentInfo.updateDownloaded;
  },
  version: currentInfo.version,
  checkForUpdates() {
    return invokeDesktopInfo(PATCHER_DESKTOP_CHECK_FOR_UPDATES_CHANNEL);
  },
  closeWindow() {
    ipcRenderer.send(PATCHER_DESKTOP_CLOSE_WINDOW_CHANNEL);
  },
  getInfo() {
    return invokeDesktopInfo(PATCHER_DESKTOP_GET_INFO_CHANNEL);
  },
  getWindowState() {
    return invokeDesktopWindowState();
  },
  async getDefaultBrowserStatus(): Promise<PatcherDesktopDefaultBrowserStatus> {
    return await invokeDefaultBrowserStatus(
      PATCHER_DESKTOP_GET_DEFAULT_BROWSER_CHANNEL,
    );
  },
  async requestDefaultBrowser(): Promise<PatcherDesktopDefaultBrowserStatus> {
    return await invokeDefaultBrowserStatus(
      PATCHER_DESKTOP_REQUEST_DEFAULT_BROWSER_CHANNEL,
    );
  },
  onDefaultBrowserStatusChange(
    listener: PatcherDesktopDefaultBrowserStatusChangeHandler,
  ): PatcherDesktopInfoUnsubscribe {
    defaultBrowserStatusListeners.add(listener);
    return () => {
      defaultBrowserStatusListeners.delete(listener);
    };
  },
  installUpdate() {
    return invokeInstallUpdate();
  },
  onChange(
    listener: PatcherDesktopInfoChangeHandler,
  ): PatcherDesktopInfoUnsubscribe {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  onWindowStateChange(
    listener: PatcherDesktopWindowStateChangeHandler,
  ): PatcherDesktopInfoUnsubscribe {
    windowStateListeners.add(listener);
    return () => {
      windowStateListeners.delete(listener);
    };
  },
  onOpenNewTab(listener): PatcherDesktopInfoUnsubscribe {
    openNewTabListeners.add(listener);
    return () => {
      openNewTabListeners.delete(listener);
    };
  },
  onAppCommand(listener): PatcherDesktopInfoUnsubscribe {
    appCommandListeners.add(listener);
    return () => {
      appCommandListeners.delete(listener);
    };
  },
  onCloseWindowRequest(listener): PatcherDesktopInfoUnsubscribe {
    closeWindowRequestListeners.add(listener);
    return () => {
      closeWindowRequestListeners.delete(listener);
    };
  },
  openExternalUrl(url: string): void {
    ipcRenderer.send(PATCHER_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL, url);
  },
  setTheme(theme: PatcherDesktopTheme): void {
    ipcRenderer.send(PATCHER_DESKTOP_SET_THEME_CHANNEL, theme);
  },
};

ipcRenderer.on(
  PATCHER_DESKTOP_INFO_CHANGED_CHANNEL,
  (_event, payload: unknown) => {
    applyDesktopInfoPayload(payload);
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_DEFAULT_BROWSER_CHANGED_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopDefaultBrowserStatusSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of defaultBrowserStatusListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
  (_event, payload: unknown) => {
    applyDesktopWindowStatePayload(payload);
  },
);

ipcRenderer.on(PATCHER_DESKTOP_OPEN_NEW_TAB_CHANNEL, () => {
  for (const listener of openNewTabListeners) {
    listener();
  }
});

ipcRenderer.on(
  PATCHER_DESKTOP_APP_COMMAND_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = appCommandIdSchema.safeParse(payload);
    if (!parsed.success) return;
    for (const listener of appCommandListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(PATCHER_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL, () => {
  let handled = false;
  for (const listener of closeWindowRequestListeners) {
    handled = listener() || handled;
  }
  // Always answer: main closes the window on `false` and falls back to
  // closing it itself if no answer arrives in time.
  ipcRenderer.send(PATCHER_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL, handled);
});

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_STATE_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserStateSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserStateListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserOpenTabRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserOpenTabListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  (_event, payload: unknown) => {
    const parsed =
      patcherDesktopBrowserScopedOpenTabRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserScopedOpenTabListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(PATCHER_DESKTOP_BROWSER_EXTERNAL_URLS_PENDING_CHANNEL, () => {
  // No payload to parse: the queue in main is the single source, and every
  // listener answers by draining it.
  for (const listener of browserExternalUrlsPendingListeners) {
    listener();
  }
});

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserSnapshotSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserSnapshotListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_FAVICON_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserFaviconSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserFaviconListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_PAGE_SECURITY_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserPageSecuritySchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserPageSecurityListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_ZOOM_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserZoomSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserZoomListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_CONTEXT_MENU_INVOKE_CHANNEL,
  (_event, payload: unknown) => {
    const parsed =
      patcherDesktopBrowserContextMenuInvokeSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserContextMenuInvokeListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_SEARCH_SELECTION_CHANNEL,
  (_event, payload: unknown) => {
    const parsed =
      patcherDesktopBrowserSearchSelectionSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserSearchSelectionListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_DOWNLOAD_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserDownloadSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserDownloadListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_DEV_TOOLS_STATE_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserDevToolsStateSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserDevToolsListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserPopupSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserPopupListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserPagePromptSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserPagePromptListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserFindResultSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserFindResultListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_CALL_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserPageScriptCallSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserPageScriptCallListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  PATCHER_DESKTOP_BROWSER_DIALOG_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = patcherDesktopBrowserDialogSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserDialogListeners) {
      listener(parsed.data);
    }
  },
);

void invokeDesktopInfo(PATCHER_DESKTOP_GET_INFO_CHANNEL);
void invokeDesktopWindowState();

contextBridge.exposeInMainWorld(
  PATCHER_DESKTOP_SPELLCHECK_GLOBAL_NAME,
  patcherSpellcheckApi,
);
// One name. The renderer is served by whichever server the shell attached to,
// so a renderer built before this rename would find nothing here — but Patcher
// has never shipped a build that reads `bbDesktop`, so there is no such
// renderer to keep working, and carrying the old name would only mean two
// spellings for every future reader to check. `preload-browser-api.test.ts`
// pins the name, because nothing else on this boundary can notice it changing.
contextBridge.exposeInMainWorld("patcherDesktop", patcherDesktopApi);
