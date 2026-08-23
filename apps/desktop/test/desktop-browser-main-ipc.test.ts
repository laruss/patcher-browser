import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PATCHER_DESKTOP_BROWSER_MAX_FIND_QUERY_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH,
  type PatcherDesktopBrowserCaptureFullPageResult,
  type PatcherDesktopBrowserFindRequest,
  type PatcherDesktopBrowserInteractResult,
  type PatcherDesktopBrowserObserveResult,
  type PatcherDesktopBrowserDownloadActionResult,
  type PatcherDesktopBrowserPageReadResult,
  type PatcherDesktopBrowserSnapshotResult,
  type PatcherDesktopBrowserControlResult,
  type PatcherDesktopBrowserRecordResult,
  type PatcherDesktopBrowserStorageResult,
  type PatcherDesktopBrowserAttachRequest,
  type PatcherDesktopBrowserNavigateRequest,
  type PatcherDesktopBrowserSetBoundsRequest,
  type PatcherDesktopBrowserSetVisibleRequest,
  type PatcherDesktopPageScriptBootstrap,
  type PatcherDesktopPageScriptRpcAnswer,
} from "@patcher/desktop-contract";
import {
  PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL,
  PATCHER_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DETACH_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FIND_CHANNEL,
  PATCHER_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  PATCHER_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_OBSERVE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_RELOAD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_VISIBLE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_MUTED_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STOP_CHANNEL,
  PATCHER_DESKTOP_BROWSER_CONTROL_CHANNEL,
  PATCHER_DESKTOP_BROWSER_RECORD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STORAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_PAGE_SCRIPTS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_RESULT_CHANNEL,
  PATCHER_DESKTOP_PAGE_SCRIPT_BOOTSTRAP_CHANNEL,
  PATCHER_DESKTOP_PAGE_SCRIPT_RPC_CHANNEL,
} from "../src/desktop-browser-ipc.js";
import { registerDesktopBrowserIpc } from "../src/desktop-browser-main-ipc.js";
import type { DesktopBrowserViewManager } from "../src/desktop-browser-view.js";

const electronMock = vi.hoisted(() => {
  interface FakeWebContents {
    id: number;
  }

  interface FakeBrowserWindow {
    label: string;
  }

  interface FakeIpcEvent {
    sender: FakeWebContents;
    /** Present for the channels a browsed page's preload reaches. */
    senderFrame?: { url: string } | null;
    returnValue?: unknown;
  }

  type FakeIpcListener = (event: FakeIpcEvent, payload: unknown) => void;
  type FakeIpcHandler = (
    event: FakeIpcEvent,
    payload: unknown,
  ) => Promise<unknown>;

  const listeners = new Map<string, FakeIpcListener>();
  const handlers = new Map<string, FakeIpcHandler>();
  const windowsBySender = new Map<FakeWebContents, FakeBrowserWindow>();

  return {
    handlers,
    listeners,
    windowsBySender,
    BrowserWindow: {
      fromWebContents(sender: FakeWebContents): FakeBrowserWindow | null {
        return windowsBySender.get(sender) ?? null;
      },
    },
    ipcMain: {
      handle(channel: string, handler: FakeIpcHandler): void {
        handlers.set(channel, handler);
      },
      on(channel: string, listener: FakeIpcListener): void {
        listeners.set(channel, listener);
      },
    },
  };
});

vi.mock("electron", () => ({
  BrowserWindow: electronMock.BrowserWindow,
  ipcMain: electronMock.ipcMain,
}));

type AttachCall = Parameters<DesktopBrowserViewManager["attach"]>[0];
type DetachCall = Parameters<DesktopBrowserViewManager["detach"]>[0];
type NavigateCall = Parameters<DesktopBrowserViewManager["navigate"]>[0];
type SetBoundsCall = Parameters<DesktopBrowserViewManager["setBounds"]>[0];
type SetVisibleCall = Parameters<DesktopBrowserViewManager["setVisible"]>[0];
type SetZoomCall = Parameters<DesktopBrowserViewManager["setZoom"]>[0];
type SetMutedCall = Parameters<DesktopBrowserViewManager["setMuted"]>[0];
type TabCommandCall = Parameters<DesktopBrowserViewManager["reload"]>[0];
type ReadPageCall = Parameters<DesktopBrowserViewManager["readPage"]>[0];
type DownloadActionCall = Parameters<
  DesktopBrowserViewManager["downloadAction"]
>[0];
type SetOverlayCall = Parameters<DesktopBrowserViewManager["setOverlay"]>[0];
type FindCall = Parameters<DesktopBrowserViewManager["find"]>[0];
type PagePromptRespondCall = Parameters<
  DesktopBrowserViewManager["respondToPagePrompt"]
>[0];
type SetFullscreenCall = Parameters<
  DesktopBrowserViewManager["setFullscreen"]
>[0];
type SetPopupTabsCall = Parameters<
  DesktopBrowserViewManager["setPopupTabs"]
>[0];
type SetDevToolsCall = Parameters<DesktopBrowserViewManager["setDevTools"]>[0];
type SetDevToolsVisibleCall = Parameters<
  DesktopBrowserViewManager["setDevToolsVisible"]
>[0];
type SetContextMenuItemsCall = Parameters<
  DesktopBrowserViewManager["setContextMenuItems"]
>[0];
type SetPageStylesCall = Parameters<
  DesktopBrowserViewManager["setPageStyles"]
>[0];
type SetPageScriptsCall = Parameters<
  DesktopBrowserViewManager["setPageScripts"]
>[0];
type PageScriptBootstrapCall = Parameters<
  DesktopBrowserViewManager["pageScriptBootstrap"]
>[0];
type PageScriptRpcCall = Parameters<
  DesktopBrowserViewManager["pageScriptRpc"]
>[0];
type PageScriptRespondCall = Parameters<
  DesktopBrowserViewManager["respondToPageScriptCall"]
>[0];
type SnapshotCall = Parameters<DesktopBrowserViewManager["snapshot"]>[0];
type SnapshotInCall = Parameters<DesktopBrowserViewManager["snapshotIn"]>[0];
type DialogRespondCall = Parameters<
  DesktopBrowserViewManager["respondToDialog"]
>[0];
type InteractCall = Parameters<DesktopBrowserViewManager["interact"]>[0];
type ObserveCall = Parameters<DesktopBrowserViewManager["observe"]>[0];
type StorageCall = Parameters<DesktopBrowserViewManager["storage"]>[0];
type ControlCall = Parameters<DesktopBrowserViewManager["control"]>[0];
type RecordCall = Parameters<DesktopBrowserViewManager["record"]>[0];
type CaptureFullPageCall = Parameters<
  DesktopBrowserViewManager["captureFullPage"]
>[0];
type WindowResizeCall = Parameters<
  DesktopBrowserViewManager["beginWindowResize"]
>[0];

interface FakeWebContents {
  id: number;
}

interface FakeBrowserWindow {
  label: string;
}

interface FakeRenderer {
  hostWindow: FakeBrowserWindow;
  sender: FakeWebContents;
}

interface SendBrowserIpcArgs {
  channel: string;
  payload: unknown;
  sender: FakeWebContents;
}

class RecordingDesktopBrowserViewManager implements DesktopBrowserViewManager {
  public readonly attachCalls: AttachCall[] = [];
  public readonly beginWindowResizeCalls: WindowResizeCall[] = [];
  public readonly destroyAllCalls: string[] = [];
  public readonly detachCalls: DetachCall[] = [];
  public readonly endWindowResizeCalls: WindowResizeCall[] = [];
  public readonly goBackCalls: TabCommandCall[] = [];
  public readonly goForwardCalls: TabCommandCall[] = [];
  public readonly navigateCalls: NavigateCall[] = [];
  public readonly releaseWindowCalls: number[] = [];
  public readonly reloadCalls: TabCommandCall[] = [];
  public readonly setBoundsCalls: SetBoundsCall[] = [];
  public readonly setVisibleCalls: SetVisibleCall[] = [];
  public readonly setZoomCalls: SetZoomCall[] = [];
  public readonly setMutedCalls: SetMutedCall[] = [];
  public readonly printCalls: TabCommandCall[] = [];
  public readonly stopCalls: TabCommandCall[] = [];
  public readonly readPageCalls: ReadPageCall[] = [];
  public readonly downloadActionCalls: DownloadActionCall[] = [];
  public readonly setOverlayCalls: SetOverlayCall[] = [];
  public readonly findCalls: FindCall[] = [];
  public readonly setFullscreenCalls: SetFullscreenCall[] = [];
  public readonly setPopupTabsCalls: SetPopupTabsCall[] = [];
  public readonly setDevToolsCalls: SetDevToolsCall[] = [];
  public readonly setDevToolsVisibleCalls: SetDevToolsVisibleCall[] = [];
  public readonly setContextMenuItemsCalls: SetContextMenuItemsCall[] = [];
  public readonly setPageStylesCalls: SetPageStylesCall[] = [];
  public readonly setPageScriptsCalls: SetPageScriptsCall[] = [];
  public readonly pageScriptBootstrapCalls: PageScriptBootstrapCall[] = [];
  public readonly pageScriptRpcCalls: PageScriptRpcCall[] = [];
  public readonly pageScriptRespondCalls: PageScriptRespondCall[] = [];
  public pageScriptRpcFailure: Error | null = null;
  public pageScriptBootstrapFailure: Error | null = null;
  public downloadActionFailure: Error | null = null;
  public downloadActionResult: PatcherDesktopBrowserDownloadActionResult = {
    ok: true,
  };
  public readPageFailure: Error | null = null;
  public readPageResult: PatcherDesktopBrowserPageReadResult = {
    ok: false,
    reason: "no-view",
  };
  public readonly dialogRespondCalls: DialogRespondCall[] = [];
  public dialogRespondResult = true;
  public readonly pagePromptRespondCalls: PagePromptRespondCall[] = [];
  public pagePromptRespondResult = true;
  public readonly snapshotCalls: SnapshotCall[] = [];
  public snapshotFailure: Error | null = null;
  public snapshotResult: PatcherDesktopBrowserSnapshotResult = {
    ok: false,
    reason: "no-view",
  };
  public readonly interactCalls: InteractCall[] = [];
  public interactFailure: Error | null = null;
  public interactResult: PatcherDesktopBrowserInteractResult = {
    ok: false,
    reason: "no-view",
  };
  public readonly observeCalls: ObserveCall[] = [];
  public observeFailure: Error | null = null;
  public observeResult: PatcherDesktopBrowserObserveResult = {
    ok: false,
    reason: "no-view",
  };
  public readonly storageCalls: StorageCall[] = [];
  public storageFailure: Error | null = null;
  public storageResult: PatcherDesktopBrowserStorageResult = {
    ok: false,
    reason: "no-view",
  };
  public readonly controlCalls: ControlCall[] = [];
  public controlFailure: Error | null = null;
  public controlResult: PatcherDesktopBrowserControlResult = {
    ok: false,
    reason: "no-view",
  };
  public readonly snapshotInCalls: SnapshotInCall[] = [];
  public readonly recordCalls: RecordCall[] = [];
  public recordFailure: Error | null = null;
  public recordResult: PatcherDesktopBrowserRecordResult = {
    ok: false,
    reason: "no-view",
  };
  public readonly captureFullPageCalls: CaptureFullPageCall[] = [];
  public captureFullPageFailure: Error | null = null;
  public captureFullPageResult: PatcherDesktopBrowserCaptureFullPageResult = {
    ok: false,
    reason: "no-view",
  };

  attach(args: AttachCall): void {
    this.attachCalls.push(args);
  }

  beginWindowResize(hostWindow: WindowResizeCall): void {
    this.beginWindowResizeCalls.push(hostWindow);
  }

  destroyAll(): void {
    this.destroyAllCalls.push("destroyAll");
  }

  detach(args: DetachCall): void {
    this.detachCalls.push(args);
  }

  endWindowResize(hostWindow: WindowResizeCall): void {
    this.endWindowResizeCalls.push(hostWindow);
  }

  goBack(args: TabCommandCall): void {
    this.goBackCalls.push(args);
  }

  goForward(args: TabCommandCall): void {
    this.goForwardCalls.push(args);
  }

  navigate(args: NavigateCall): void {
    this.navigateCalls.push(args);
  }

  releaseWindow(hostWebContentsId: number): void {
    this.releaseWindowCalls.push(hostWebContentsId);
  }

  reload(args: TabCommandCall): void {
    this.reloadCalls.push(args);
  }

  setBounds(args: SetBoundsCall): void {
    this.setBoundsCalls.push(args);
  }

  setZoom(args: SetZoomCall): void {
    this.setZoomCalls.push(args);
  }

  setMuted(args: SetMutedCall): void {
    this.setMutedCalls.push(args);
  }

  print(args: TabCommandCall): void {
    this.printCalls.push(args);
  }

  setVisible(args: SetVisibleCall): void {
    this.setVisibleCalls.push(args);
  }

  stop(args: TabCommandCall): void {
    this.stopCalls.push(args);
  }

  setOverlay(args: SetOverlayCall): void {
    this.setOverlayCalls.push(args);
  }

  find(args: FindCall): void {
    this.findCalls.push(args);
  }

  setFullscreen(args: SetFullscreenCall): void {
    this.setFullscreenCalls.push(args);
  }

  setPopupTabs(args: SetPopupTabsCall): void {
    this.setPopupTabsCalls.push(args);
  }

  setDevTools(args: SetDevToolsCall): void {
    this.setDevToolsCalls.push(args);
  }

  setDevToolsVisible(args: SetDevToolsVisibleCall): void {
    this.setDevToolsVisibleCalls.push(args);
  }

  respondToPagePrompt(args: PagePromptRespondCall): Promise<boolean> {
    this.pagePromptRespondCalls.push(args);
    return Promise.resolve(this.pagePromptRespondResult);
  }

  setContextMenuItems(args: SetContextMenuItemsCall): void {
    this.setContextMenuItemsCalls.push(args);
  }

  setPageStyles(args: SetPageStylesCall): void {
    this.setPageStylesCalls.push(args);
  }

  setPageScripts(args: SetPageScriptsCall): void {
    this.setPageScriptsCalls.push(args);
  }

  pageScriptBootstrap(
    args: PageScriptBootstrapCall,
  ): PatcherDesktopPageScriptBootstrap {
    this.pageScriptBootstrapCalls.push(args);
    if (this.pageScriptBootstrapFailure !== null) {
      throw this.pageScriptBootstrapFailure;
    }
    return {
      worlds: [{ pluginId: "site-tweaks", worldId: 9001, scripts: [] }],
    };
  }

  async pageScriptRpc(
    args: PageScriptRpcCall,
  ): Promise<PatcherDesktopPageScriptRpcAnswer> {
    this.pageScriptRpcCalls.push(args);
    if (this.pageScriptRpcFailure !== null) {
      throw this.pageScriptRpcFailure;
    }
    return { ok: true, result: '{"ok":1}' };
  }

  respondToPageScriptCall(args: PageScriptRespondCall): void {
    this.pageScriptRespondCalls.push(args);
  }

  downloadAction(
    request: DownloadActionCall,
  ): Promise<PatcherDesktopBrowserDownloadActionResult> {
    this.downloadActionCalls.push(request);
    if (this.downloadActionFailure !== null) {
      return Promise.reject(this.downloadActionFailure);
    }
    return Promise.resolve(this.downloadActionResult);
  }

  readPage(args: ReadPageCall): Promise<PatcherDesktopBrowserPageReadResult> {
    this.readPageCalls.push(args);
    if (this.readPageFailure !== null) {
      return Promise.reject(this.readPageFailure);
    }
    return Promise.resolve(this.readPageResult);
  }

  respondToDialog(args: DialogRespondCall): Promise<boolean> {
    this.dialogRespondCalls.push(args);
    return Promise.resolve(this.dialogRespondResult);
  }

  snapshot(args: SnapshotCall): Promise<PatcherDesktopBrowserSnapshotResult> {
    this.snapshotCalls.push(args);
    if (this.snapshotFailure !== null) {
      return Promise.reject(this.snapshotFailure);
    }
    return Promise.resolve(this.snapshotResult);
  }

  interact(args: InteractCall): Promise<PatcherDesktopBrowserInteractResult> {
    this.interactCalls.push(args);
    if (this.interactFailure !== null) {
      return Promise.reject(this.interactFailure);
    }
    return Promise.resolve(this.interactResult);
  }

  observe(args: ObserveCall): Promise<PatcherDesktopBrowserObserveResult> {
    this.observeCalls.push(args);
    if (this.observeFailure !== null) {
      return Promise.reject(this.observeFailure);
    }
    return Promise.resolve(this.observeResult);
  }

  control(args: ControlCall): Promise<PatcherDesktopBrowserControlResult> {
    this.controlCalls.push(args);
    if (this.controlFailure !== null) {
      return Promise.reject(this.controlFailure);
    }
    return Promise.resolve(this.controlResult);
  }

  snapshotIn(
    args: SnapshotInCall,
  ): Promise<PatcherDesktopBrowserSnapshotResult> {
    this.snapshotInCalls.push(args);
    if (this.snapshotFailure !== null) {
      return Promise.reject(this.snapshotFailure);
    }
    return Promise.resolve(this.snapshotResult);
  }

  record(args: RecordCall): Promise<PatcherDesktopBrowserRecordResult> {
    this.recordCalls.push(args);
    if (this.recordFailure !== null) {
      return Promise.reject(this.recordFailure);
    }
    return Promise.resolve(this.recordResult);
  }

  captureFullPage(
    args: CaptureFullPageCall,
  ): Promise<PatcherDesktopBrowserCaptureFullPageResult> {
    this.captureFullPageCalls.push(args);
    if (this.captureFullPageFailure !== null) {
      return Promise.reject(this.captureFullPageFailure);
    }
    return Promise.resolve(this.captureFullPageResult);
  }

  storage(args: StorageCall): Promise<PatcherDesktopBrowserStorageResult> {
    this.storageCalls.push(args);
    if (this.storageFailure !== null) {
      return Promise.reject(this.storageFailure);
    }
    return Promise.resolve(this.storageResult);
  }
}

let nextWebContentsId = 1;

beforeEach(() => {
  electronMock.handlers.clear();
  electronMock.listeners.clear();
  electronMock.windowsBySender.clear();
  nextWebContentsId = 1;
});

function createTrustedRenderer(label: string): FakeRenderer {
  const sender = { id: nextWebContentsId };
  nextWebContentsId += 1;
  const hostWindow = { label };
  electronMock.windowsBySender.set(sender, hostWindow);
  return { hostWindow, sender };
}

function createUntrustedSender(): FakeWebContents {
  const sender = { id: nextWebContentsId };
  nextWebContentsId += 1;
  return sender;
}

function sendBrowserIpc(args: SendBrowserIpcArgs): void {
  const listener = electronMock.listeners.get(args.channel);
  expect(listener).toBeDefined();
  if (listener === undefined) {
    throw new Error(`Expected listener for ${args.channel}.`);
  }
  listener({ sender: args.sender }, args.payload);
}

async function invokeBrowserIpc(
  args: SendBrowserIpcArgs,
): Promise<PatcherDesktopBrowserPageReadResult> {
  const handler = electronMock.handlers.get(args.channel);
  expect(handler).toBeDefined();
  if (handler === undefined) {
    throw new Error(`Expected handler for ${args.channel}.`);
  }
  return (await handler(
    { sender: args.sender },
    args.payload,
  )) as PatcherDesktopBrowserPageReadResult;
}

function oversizedBrowserUrl(): string {
  return `https://example.com/${"a".repeat(PATCHER_DESKTOP_BROWSER_MAX_URL_LENGTH)}`;
}

describe("registerDesktopBrowserIpc", () => {
  it("dispatches valid browser commands only from BrowserWindow-owned senders", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const untrustedSender = createUntrustedSender();
    const attachRequest: PatcherDesktopBrowserAttachRequest = {
      tabId: "browser:a",
      url: "http://localhost:5173/",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      visible: true,
    };
    const navigateRequest: PatcherDesktopBrowserNavigateRequest = {
      tabId: "browser:a",
      url: "https://example.com/",
    };

    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL,
      payload: attachRequest,
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL,
      payload: attachRequest,
      sender: untrustedSender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
      payload: navigateRequest,
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_RELOAD_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });

    expect(manager.attachCalls).toHaveLength(1);
    expect(manager.attachCalls[0]?.hostWindow).toBe(renderer.hostWindow);
    expect(manager.attachCalls[0]?.request).toEqual(attachRequest);
    expect(manager.navigateCalls).toHaveLength(1);
    expect(manager.navigateCalls[0]?.hostWindow).toBe(renderer.hostWindow);
    expect(manager.navigateCalls[0]?.request).toEqual(navigateRequest);
    expect(manager.reloadCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
  });

  it("rejects malformed attach and navigate payloads before manager dispatch", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const validAttachRequest: PatcherDesktopBrowserAttachRequest = {
      tabId: "browser:a",
      url: "",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      visible: false,
    };

    for (const payload of [
      { ...validAttachRequest, extra: true },
      { ...validAttachRequest, tabId: "" },
      { ...validAttachRequest, url: oversizedBrowserUrl() },
      { ...validAttachRequest, bounds: { x: 0, y: 0, width: -1, height: 600 } },
    ]) {
      sendBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL,
        payload,
        sender: renderer.sender,
      });
    }

    for (const payload of [
      { tabId: "browser:a", url: "" },
      { tabId: "browser:a", url: oversizedBrowserUrl() },
      { tabId: "browser:a", url: "https://example.com/", extra: true },
    ]) {
      sendBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
        payload,
        sender: renderer.sender,
      });
    }

    expect(manager.attachCalls).toEqual([]);
    expect(manager.navigateCalls).toEqual([]);
  });

  it("rejects malformed bounds, visibility, and tab-command payloads", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const boundsRequest: PatcherDesktopBrowserSetBoundsRequest = {
      tabId: "browser:a",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    };
    const visibleRequest: PatcherDesktopBrowserSetVisibleRequest = {
      tabId: "browser:a",
      visible: true,
    };

    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
      payload: {
        ...boundsRequest,
        bounds: { x: 0.5, y: 0, width: 1, height: 1 },
      },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
      payload: boundsRequest,
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
      payload: { tabId: "browser:a", visible: "yes" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
      payload: visibleRequest,
      sender: renderer.sender,
    });

    for (const channel of [
      PATCHER_DESKTOP_BROWSER_DETACH_CHANNEL,
      PATCHER_DESKTOP_BROWSER_GO_BACK_CHANNEL,
      PATCHER_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
      PATCHER_DESKTOP_BROWSER_RELOAD_CHANNEL,
      PATCHER_DESKTOP_BROWSER_STOP_CHANNEL,
    ]) {
      sendBrowserIpc({
        channel,
        payload: { tabId: "", extra: true },
        sender: renderer.sender,
      });
    }

    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_DETACH_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_GO_BACK_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_STOP_CHANNEL,
      payload: { tabId: "browser:a" },
      sender: renderer.sender,
    });

    expect(manager.setBoundsCalls).toEqual([
      { hostWindow: renderer.hostWindow, request: boundsRequest },
    ]);
    expect(manager.setVisibleCalls).toEqual([
      { hostWindow: renderer.hostWindow, request: visibleRequest },
    ]);
    expect(manager.detachCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
    expect(manager.goBackCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
    expect(manager.goForwardCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
    expect(manager.stopCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);
  });

  it("routes a mute and refuses a payload that is not one", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");

    for (const payload of [
      { tabId: "browser:a", muted: "yes" },
      { tabId: "", muted: true },
      { tabId: "browser:a", muted: true, extra: true },
    ]) {
      sendBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_SET_MUTED_CHANNEL,
        payload,
        sender: renderer.sender,
      });
    }
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_SET_MUTED_CHANNEL,
      payload: { tabId: "browser:a", muted: true },
      sender: renderer.sender,
    });

    expect(manager.setMutedCalls).toEqual([
      {
        hostWindow: renderer.hostWindow,
        request: { tabId: "browser:a", muted: true },
      },
    ]);
  });

  // The find bar sends one of these per keystroke, so what it may say is worth
  // pinning: an action outside the set, or a stray field, is not a find.
  // A channel of its own rather than a field on the DevTools request, because
  // the request schemas are wire-frozen — so it needs its own parse, and its own
  // refusal of anything that is not one.
  it("routes DevTools panel visibility and refuses a payload that is not one", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");

    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_VISIBLE_CHANNEL,
      payload: { tabId: "browser:a", visible: "yes" },
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_SET_DEV_TOOLS_VISIBLE_CHANNEL,
      payload: { tabId: "browser:a", visible: true },
      sender: renderer.sender,
    });

    expect(manager.setDevToolsVisibleCalls).toHaveLength(1);
    expect(manager.setDevToolsVisibleCalls[0]?.request).toEqual({
      tabId: "browser:a",
      visible: true,
    });
  });

  it("routes find commands and drops payloads that are not one", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const request: PatcherDesktopBrowserFindRequest = {
      tabId: "browser:a",
      action: "start",
      query: "needle",
    };

    for (const payload of [
      { ...request, action: "restart" },
      { ...request, extra: true },
      { ...request, tabId: "" },
      {
        ...request,
        query: "q".repeat(PATCHER_DESKTOP_BROWSER_MAX_FIND_QUERY_LENGTH + 1),
      },
    ]) {
      sendBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_FIND_CHANNEL,
        payload,
        sender: renderer.sender,
      });
    }
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_FIND_CHANNEL,
      payload: request,
      sender: createUntrustedSender(),
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_FIND_CHANNEL,
      payload: request,
      sender: renderer.sender,
    });

    expect(manager.findCalls).toEqual([
      { hostWindow: renderer.hostWindow, request },
    ]);
  });

  it("answers page reads for owned senders and never throws for anyone else", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    manager.readPageResult = {
      ok: true,
      tabId: "browser:a",
      url: "https://example.com/",
      title: "Example",
      isLoading: false,
      text: "hello",
      textTruncated: false,
      selection: "",
      selectionTruncated: false,
      contentKind: "html",
    };
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");

    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
        payload: { tabId: "browser:a" },
        sender: renderer.sender,
      }),
    ).resolves.toEqual(manager.readPageResult);
    expect(manager.readPageCalls).toEqual([
      { hostWindow: renderer.hostWindow, tabId: "browser:a" },
    ]);

    // A sender with no BrowserWindow and a malformed payload both resolve to a
    // typed refusal rather than rejecting: an `invoke` rejection reaches the
    // renderer as an opaque string it could not branch on.
    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
        payload: { tabId: "browser:a" },
        sender: createUntrustedSender(),
      }),
    ).resolves.toEqual({ ok: false, reason: "no-view" });
    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
        payload: { tabId: "" },
        sender: renderer.sender,
      }),
    ).resolves.toEqual({ ok: false, reason: "no-view" });
    expect(manager.readPageCalls).toHaveLength(1);
  });

  it("routes observations and refuses a payload it cannot understand", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    manager.observeResult = {
      ok: true,
      kind: "console",
      tabId: "browser:a",
      url: "https://example.com/",
      title: null,
      entries: [],
      droppedCount: 0,
    };
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const request = {
      tabId: "browser:a",
      observation: { kind: "console", limit: 25 },
    };

    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_OBSERVE_CHANNEL,
        payload: request,
        sender: renderer.sender,
      }),
    ).resolves.toEqual(manager.observeResult);
    expect(manager.observeCalls).toEqual([
      { hostWindow: renderer.hostWindow, request },
    ]);

    // A malformed observation is the request's fault, not the tab's — telling
    // the caller to go activate a tab would send it after the wrong fix.
    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_OBSERVE_CHANNEL,
        payload: { tabId: "browser:a", observation: { kind: "video" } },
        sender: renderer.sender,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "failed" });
    expect(manager.observeCalls).toHaveLength(1);
  });

  it("routes storage operations and refuses a payload it cannot understand", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    manager.storageResult = { ok: true, kind: "removed", removed: 3 };
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const request = {
      tabId: "browser:a",
      operation: { kind: "cookies-clear", name: null },
    };

    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_STORAGE_CHANNEL,
        payload: request,
        sender: renderer.sender,
      }),
    ).resolves.toEqual(manager.storageResult);
    expect(manager.storageCalls).toEqual([
      { hostWindow: renderer.hostWindow, request },
    ]);

    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_STORAGE_CHANNEL,
        payload: { tabId: "browser:a", operation: { kind: "indexeddb-get" } },
        sender: renderer.sender,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "failed" });
    expect(manager.storageCalls).toHaveLength(1);
  });

  it("routes control operations and refuses a payload it cannot understand", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    manager.controlResult = {
      ok: true,
      kind: "evaluated",
      tabId: "browser:a",
      url: "https://example.com/",
      title: null,
      value: '"Example"',
      truncated: false,
    };
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const request = {
      tabId: "browser:a",
      operation: {
        kind: "evaluate",
        expression: "() => document.title",
        ref: null,
      },
    };

    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_CONTROL_CHANNEL,
        payload: request,
        sender: renderer.sender,
      }),
    ).resolves.toEqual(manager.controlResult);
    expect(manager.controlCalls).toEqual([
      { hostWindow: renderer.hostWindow, request },
    ]);

    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_CONTROL_CHANNEL,
        payload: { tabId: "browser:a", operation: { kind: "screencast" } },
        sender: renderer.sender,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "failed" });
    expect(manager.controlCalls).toHaveLength(1);
  });

  it("routes a scoped snapshot to its own channel and refuses one without a selector", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    manager.snapshotResult = {
      ok: true,
      tabId: "browser:a",
      url: "https://example.com/",
      title: null,
      snapshot: '- button "Pay" [ref=e1]',
      generation: 3,
      refCount: 1,
      truncated: false,
    };
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const request = { tabId: "browser:a", selector: "form.checkout" };

    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
        payload: request,
        sender: renderer.sender,
      }),
    ).resolves.toEqual(manager.snapshotResult);
    expect(manager.snapshotInCalls).toEqual([
      { hostWindow: renderer.hostWindow, request },
    ]);
    // The unscoped snapshot never reaches this channel, and a request without a
    // selector is the request's fault rather than the tab's.
    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
        payload: { tabId: "browser:a" },
        sender: renderer.sender,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "failed" });
    expect(manager.snapshotInCalls).toHaveLength(1);
  });

  it("routes a full-page capture to its own channel", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    manager.captureFullPageResult = {
      ok: true,
      tabId: "browser:a",
      url: "https://example.com/",
      title: null,
      mimeType: "image/jpeg",
      base64: "AAAA",
      width: 1280,
      height: 4200,
      truncated: false,
    };
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const request = { tabId: "browser:a", format: "jpeg", quality: 70 };

    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
        payload: request,
        sender: renderer.sender,
      }),
    ).resolves.toEqual(manager.captureFullPageResult);
    expect(manager.captureFullPageCalls).toEqual([
      { hostWindow: renderer.hostWindow, request },
    ]);

    // An observation payload sent here is the request's fault, not the tab's.
    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
        payload: {
          tabId: "browser:a",
          observation: { kind: "screenshot", format: "jpeg", quality: 70 },
        },
        sender: renderer.sender,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "failed" });
    expect(manager.captureFullPageCalls).toHaveLength(1);
  });

  it("routes recording operations and refuses a payload it cannot understand", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    manager.recordResult = {
      ok: true,
      kind: "video",
      tabId: "browser:a",
      url: "https://example.com/",
      title: null,
      frames: [{ at: 0, base64: "AAAA" }],
      chapters: [],
      droppedFrames: 3,
      durationMs: 1_200,
    };
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const request = {
      tabId: "browser:a",
      operation: { kind: "video-stop" },
    };

    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_RECORD_CHANNEL,
        payload: request,
        sender: renderer.sender,
      }),
    ).resolves.toEqual(manager.recordResult);
    expect(manager.recordCalls).toEqual([
      { hostWindow: renderer.hostWindow, request },
    ]);

    // The trace half of the agent-facing union never reaches the shell, so this
    // channel does not understand it — which is the wire saying what the note on
    // the schema says.
    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_RECORD_CHANNEL,
        payload: {
          tabId: "browser:a",
          operation: { kind: "trace-start", screenshots: false },
        },
        sender: renderer.sender,
      }),
    ).resolves.toMatchObject({ ok: false, reason: "failed" });
    expect(manager.recordCalls).toHaveLength(1);
  });

  it("converts a throwing manager read into a typed refusal", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    manager.readPageFailure = new Error("boom");
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");

    await expect(
      invokeBrowserIpc({
        channel: PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
        payload: { tabId: "browser:a" },
        sender: renderer.sender,
      }),
    ).resolves.toEqual({ ok: false, reason: "unreadable" });
  });

  // --- The two channels a browsed page's own preload reaches ---

  it("answers a page's bootstrap from the frame url Chromium reported", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const page = createUntrustedSender();
    const listener = electronMock.listeners.get(
      PATCHER_DESKTOP_PAGE_SCRIPT_BOOTSTRAP_CHANNEL,
    );
    expect(listener).toBeDefined();
    const event = {
      sender: page,
      senderFrame: { url: "https://github.com/patcher/pulls" },
      returnValue: undefined as unknown,
    };

    listener?.(event, { url: "https://bank.example/" });

    // The payload's claim about where it is was not read at all.
    expect(manager.pageScriptBootstrapCalls).toEqual([
      { webContentsId: page.id, url: "https://github.com/patcher/pulls" },
    ]);
    expect(event.returnValue).toEqual({
      worlds: [{ pluginId: "site-tweaks", worldId: 9001, scripts: [] }],
    });
  });

  // A frame with no address gets an answer anyway: the page is blocked on this
  // call at document start, so a path that returned nothing would hang it.
  it("always answers the bootstrap, even for a frame it will not serve", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const listener = electronMock.listeners.get(
      PATCHER_DESKTOP_PAGE_SCRIPT_BOOTSTRAP_CHANNEL,
    );
    const event = {
      sender: createUntrustedSender(),
      senderFrame: null,
      returnValue: undefined as unknown,
    };

    listener?.(event, undefined);

    expect(event.returnValue).toEqual({ worlds: [] });
    expect(manager.pageScriptBootstrapCalls).toEqual([]);

    // And the same when the manager itself throws: whatever went wrong, the page
    // is unblocked with an empty answer rather than left waiting.
    manager.pageScriptBootstrapFailure = new Error("boom");
    const thrown = {
      sender: createUntrustedSender(),
      senderFrame: { url: "https://github.com/" },
      returnValue: undefined as unknown,
    };
    listener?.(thrown, undefined);
    expect(thrown.returnValue).toEqual({ worlds: [] });
  });

  it("passes a page script's rpc with the frame url, not the payload's", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const page = createUntrustedSender();
    const handler = electronMock.handlers.get(
      PATCHER_DESKTOP_PAGE_SCRIPT_RPC_CHANNEL,
    );
    expect(handler).toBeDefined();

    const answer = await handler?.(
      { sender: page, senderFrame: { url: "https://github.com/" } },
      {
        pluginId: "site-tweaks",
        method: "notes",
        input: '{"repo":"patcher/browser"}',
      },
    );

    expect(manager.pageScriptRpcCalls).toEqual([
      {
        webContentsId: page.id,
        url: "https://github.com/",
        request: {
          pluginId: "site-tweaks",
          method: "notes",
          input: '{"repo":"patcher/browser"}',
        },
      },
    ]);
    expect(answer).toEqual({ ok: true, result: '{"ok":1}' });
  });

  it("refuses a page script's rpc that does not parse, or has no frame", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const handler = electronMock.handlers.get(
      PATCHER_DESKTOP_PAGE_SCRIPT_RPC_CHANNEL,
    );
    const frame = { url: "https://github.com/" };

    await expect(
      handler?.(
        { sender: createUntrustedSender(), senderFrame: frame },
        {
          pluginId: "site-tweaks",
          method: "notes",
          input: 42,
        },
      ),
    ).resolves.toEqual({
      ok: false,
      message: "patcher.rpc: that call was not understood.",
    });
    await expect(
      handler?.(
        { sender: createUntrustedSender(), senderFrame: null },
        {
          pluginId: "site-tweaks",
          method: "notes",
          input: "",
        },
      ),
    ).resolves.toEqual({
      ok: false,
      message: "patcher.rpc is not available in this page.",
    });
    expect(manager.pageScriptRpcCalls).toEqual([]);
  });

  // The refusal a page script sees is a resolved answer, never a rejected
  // invoke: Electron turns a rejection into an opaque string with nothing in it
  // for whoever wrote the script.
  it("turns a manager failure into an answer rather than a rejection", async () => {
    const manager = new RecordingDesktopBrowserViewManager();
    manager.pageScriptRpcFailure = new Error("boom");
    registerDesktopBrowserIpc(manager);
    const handler = electronMock.handlers.get(
      PATCHER_DESKTOP_PAGE_SCRIPT_RPC_CHANNEL,
    );

    await expect(
      handler?.(
        {
          sender: createUntrustedSender(),
          senderFrame: { url: "https://github.com/" },
        },
        { pluginId: "site-tweaks", method: "notes", input: "" },
      ),
    ).resolves.toEqual({ ok: false, message: "patcher.rpc: the call failed." });
  });

  it("takes page scripts and their answers only from an app window", () => {
    const manager = new RecordingDesktopBrowserViewManager();
    registerDesktopBrowserIpc(manager);
    const renderer = createTrustedRenderer("main-window");
    const page = createUntrustedSender();
    const scripts = {
      scripts: [
        {
          pluginId: "site-tweaks",
          scriptId: "toolbar",
          matches: ["https://github.com/**"],
          code: "patcher.ready(function(){})",
        },
      ],
    };
    const result = { callId: "page-script-1", ok: true, result: "{}" };

    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_SET_PAGE_SCRIPTS_CHANNEL,
      payload: scripts,
      sender: renderer.sender,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_SET_PAGE_SCRIPTS_CHANNEL,
      payload: scripts,
      sender: page,
    });
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_RESULT_CHANNEL,
      payload: result,
      sender: renderer.sender,
    });
    // A browsed page answering a call it did not make would be a page speaking
    // for the plugin host.
    sendBrowserIpc({
      channel: PATCHER_DESKTOP_BROWSER_PAGE_SCRIPT_RESULT_CHANNEL,
      payload: result,
      sender: page,
    });

    expect(manager.setPageScriptsCalls).toEqual([
      { hostWindow: renderer.hostWindow, request: scripts },
    ]);
    expect(manager.pageScriptRespondCalls).toEqual([{ result }]);
  });
});
