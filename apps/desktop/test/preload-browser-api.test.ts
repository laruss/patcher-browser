import { describe, expect, it, vi } from "vitest";
import type { AppCommandId } from "@patcher/domain";
import type {
  PatcherDesktopApi,
  PatcherDesktopBrowserFindResult,
  PatcherDesktopBrowserOpenTabRequest,
  PatcherDesktopBrowserPagePrompt,
  PatcherDesktopBrowserScopedOpenTabRequest,
  PatcherDesktopBrowserSnapshot,
  PatcherDesktopBrowserState,
  PatcherDesktopInfo,
  PatcherDesktopWindowState,
} from "@patcher/desktop-contract";
import {
  PATCHER_DESKTOP_CHECK_FOR_UPDATES_CHANNEL,
  PATCHER_DESKTOP_GET_INFO_CHANNEL,
  PATCHER_DESKTOP_INSTALL_UPDATE_CHANNEL,
  PATCHER_DESKTOP_SET_THEME_CHANNEL,
} from "../src/desktop-update-ipc.js";
import {
  PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL,
  PATCHER_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DETACH_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FIND_CHANNEL,
  PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  PATCHER_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL,
  PATCHER_DESKTOP_BROWSER_INTERACT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_OBSERVE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL,
  PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_RELOAD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_POPUP_TABS_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_MUTED_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STATE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_CONTROL_CHANNEL,
  PATCHER_DESKTOP_BROWSER_RECORD_CHANNEL,
  PATCHER_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STORAGE_CHANNEL,
  PATCHER_DESKTOP_BROWSER_STOP_CHANNEL,
} from "../src/desktop-browser-ipc.js";
import {
  PATCHER_DESKTOP_APP_COMMAND_CHANNEL,
  PATCHER_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
  PATCHER_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
  PATCHER_DESKTOP_GET_WINDOW_STATE_CHANNEL,
  PATCHER_DESKTOP_OPEN_NEW_TAB_CHANNEL,
  PATCHER_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
} from "../src/desktop-window-command-ipc.js";
import { PATCHER_DESKTOP_SPELLCHECK_GLOBAL_NAME } from "../src/desktop-spellcheck-contract.js";

const electronMock = vi.hoisted(() => {
  interface IpcRendererEvent {}

  interface SendCall {
    channel: string;
    payload: unknown;
  }

  type IpcRendererListener = (
    event: IpcRendererEvent,
    payload: unknown,
  ) => void;

  const desktopInfo: PatcherDesktopInfo = {
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: "macos",
    updateAvailable: false,
    updateDownloaded: false,
    version: "0.0.0-test",
  };
  const desktopWindowState: PatcherDesktopWindowState = {
    isFullScreen: false,
  };
  const invokeCalls: string[] = [];
  const invokePayloads: unknown[] = [];
  // What the read-page channel answers with; tests swap it to drive the
  // malformed-reply and rejected-invoke paths.
  let readPageReply: (() => Promise<unknown>) | null = null;
  const listeners = new Map<string, IpcRendererListener>();
  const sendCalls: SendCall[] = [];
  const exposedNames: string[] = [];
  let exposedApi: PatcherDesktopApi | null = null;
  let exposedSpellcheckApi: {
    getCorrectionContext(word: string): unknown;
  } | null = null;
  let zoomFactor = 1;

  return {
    get exposedApi() {
      return exposedApi;
    },
    exposedNames,
    get exposedSpellcheckApi() {
      return exposedSpellcheckApi;
    },
    invokeCalls,
    invokePayloads,
    listeners,
    sendCalls,
    setReadPageReply(reply: (() => Promise<unknown>) | null): void {
      readPageReply = reply;
    },
    reset(): void {
      invokePayloads.length = 0;
      readPageReply = null;
      exposedApi = null;
      exposedSpellcheckApi = null;
      exposedNames.length = 0;
      invokeCalls.length = 0;
      listeners.clear();
      sendCalls.length = 0;
      zoomFactor = 1;
    },
    setZoomFactor(nextZoomFactor: number): void {
      zoomFactor = nextZoomFactor;
    },
    contextBridge: {
      exposeInMainWorld(name: string, api: unknown): void {
        exposedNames.push(name);
        if (name === "patcherDesktop") {
          exposedApi = api as PatcherDesktopApi;
          return;
        }
        exposedSpellcheckApi = api as {
          getCorrectionContext(word: string): unknown;
        };
      },
    },
    ipcRenderer: {
      invoke(channel: string, payload?: unknown): Promise<unknown> {
        invokeCalls.push(channel);
        invokePayloads.push(payload);
        if (channel === "patcher-desktop:browser:read-page") {
          return readPageReply === null
            ? Promise.resolve(null)
            : readPageReply();
        }
        if (channel === "patcher-desktop:get-window-state") {
          return Promise.resolve(desktopWindowState);
        }
        return Promise.resolve(desktopInfo);
      },
      on(channel: string, listener: IpcRendererListener): void {
        listeners.set(channel, listener);
      },
      send(channel: string, payload: unknown): void {
        sendCalls.push({ channel, payload });
      },
    },
    webFrame: {
      getZoomFactor(): number {
        return zoomFactor;
      },
      getWordSuggestions(word: string): string[] {
        return word === "recieve" ? ["receive", "relieve"] : [];
      },
      isWordMisspelled(word: string): boolean {
        return word === "recieve";
      },
    },
  };
});

vi.mock("electron", () => ({
  contextBridge: electronMock.contextBridge,
  ipcRenderer: electronMock.ipcRenderer,
  webFrame: electronMock.webFrame,
}));

interface EmitIpcPayloadArgs {
  channel: string;
  payload: unknown;
}

async function loadPreload(): Promise<PatcherDesktopApi> {
  electronMock.reset();
  vi.resetModules();
  process.env.PATCHER_DESKTOP_VERSION = "0.0.0-test";
  await import("../src/preload.js");
  const api = electronMock.exposedApi;
  // The renderer reads this global by name and nothing else on that boundary
  // can notice it changing, so the name is asserted here as a wire value.
  expect(electronMock.exposedNames).toContain("patcherDesktop");
  expect(api).not.toBeNull();
  if (api === null) {
    throw new Error("Expected preload to expose the desktop API.");
  }
  return api;
}

function emitIpcPayload(args: EmitIpcPayloadArgs): void {
  const listener = electronMock.listeners.get(args.channel);
  expect(listener).toBeDefined();
  if (listener === undefined) {
    throw new Error(`Expected listener for ${args.channel}.`);
  }
  listener({}, args.payload);
}

describe("desktop preload browser API", () => {
  it("exposes a narrow spellcheck helper for desktop context menus", async () => {
    await loadPreload();

    expect(electronMock.exposedNames).toContain(
      PATCHER_DESKTOP_SPELLCHECK_GLOBAL_NAME,
    );
    expect(electronMock.exposedSpellcheckApi).not.toBeNull();
    expect(
      electronMock.exposedSpellcheckApi?.getCorrectionContext("recieve"),
    ).toEqual({
      dictionarySuggestions: ["receive", "relieve"],
      misspelledWord: "recieve",
    });
    expect(
      electronMock.exposedSpellcheckApi?.getCorrectionContext("receive"),
    ).toBeNull();
    expect(
      electronMock.exposedSpellcheckApi?.getCorrectionContext("two words"),
    ).toBeNull();
  }, 15_000);

  it("exposes only the typed browser commands and forwards them over fixed channels", async () => {
    const api = await loadPreload();
    const attachRequest = {
      tabId: "browser:a",
      url: "http://localhost:5173/",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      visible: true,
    };
    const navigateRequest = {
      tabId: "browser:a",
      url: "https://example.com/",
    };
    const boundsRequest = {
      tabId: "browser:a",
      bounds: { x: 10, y: 20, width: 300, height: 200 },
    };
    const visibleRequest = {
      tabId: "browser:a",
      visible: false,
    };

    expect(Object.keys(api.browser).sort()).toEqual([
      "attach",
      "captureFullPage",
      "control",
      "detach",
      "downloadAction",
      "find",
      "goBack",
      "goForward",
      "interact",
      "navigate",
      "observe",
      "onContextMenuInvoke",
      "onDevToolsState",
      "onDialog",
      "onDownload",
      "onExternalUrlsPending",
      "onFavicon",
      "onFindResult",
      "onOpenTab",
      "onPagePrompt",
      "onPageScriptCall",
      "onPageSecurity",
      "onPopup",
      "onScopedOpenTab",
      "onSearchSelection",
      "onSnapshot",
      "onState",
      "onZoom",
      "print",
      "readPage",
      "record",
      "reload",
      "respondToDialog",
      "respondToPagePrompt",
      "respondToPageScriptCall",
      "setBounds",
      "setContextMenuItems",
      "setDevTools",
      "setDevToolsVisible",
      "setFullscreen",
      "setMuted",
      "setOverlay",
      "setPageScripts",
      "setPageStyles",
      "setPopupTabs",
      "setVisible",
      "setZoom",
      "snapshot",
      "snapshotIn",
      "stop",
      "storage",
      "takeExternalUrls",
    ]);
    expect(api.browser).not.toHaveProperty("send");
    expect(api.browser).not.toHaveProperty("invoke");

    api.browser.attach(attachRequest);
    api.browser.detach("browser:a");
    api.browser.navigate(navigateRequest);
    api.browser.goBack("browser:a");
    api.browser.goForward("browser:a");
    api.browser.reload("browser:a");
    api.browser.stop("browser:a");
    api.browser.setBounds(boundsRequest);
    api.browser.setVisible(visibleRequest);
    api.browser.setMuted?.({ tabId: "browser:a", muted: true });
    api.setTheme("dark");
    await api.checkForUpdates();
    await expect(api.getWindowState?.()).resolves.toEqual({
      isFullScreen: false,
    });
    await api.installUpdate();

    expect(electronMock.sendCalls).toEqual([
      {
        channel: PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL,
        payload: attachRequest,
      },
      {
        channel: PATCHER_DESKTOP_BROWSER_DETACH_CHANNEL,
        payload: { tabId: "browser:a" },
      },
      {
        channel: PATCHER_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
        payload: navigateRequest,
      },
      {
        channel: PATCHER_DESKTOP_BROWSER_GO_BACK_CHANNEL,
        payload: { tabId: "browser:a" },
      },
      {
        channel: PATCHER_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
        payload: { tabId: "browser:a" },
      },
      {
        channel: PATCHER_DESKTOP_BROWSER_RELOAD_CHANNEL,
        payload: { tabId: "browser:a" },
      },
      {
        channel: PATCHER_DESKTOP_BROWSER_STOP_CHANNEL,
        payload: { tabId: "browser:a" },
      },
      {
        channel: PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
        payload: boundsRequest,
      },
      {
        channel: PATCHER_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
        payload: visibleRequest,
      },
      {
        channel: PATCHER_DESKTOP_BROWSER_SET_MUTED_CHANNEL,
        payload: { tabId: "browser:a", muted: true },
      },
      { channel: PATCHER_DESKTOP_SET_THEME_CHANNEL, payload: "dark" },
    ]);
    expect(electronMock.invokeCalls).toContain(
      PATCHER_DESKTOP_GET_INFO_CHANNEL,
    );
    expect(electronMock.invokeCalls).toContain(
      PATCHER_DESKTOP_CHECK_FOR_UPDATES_CHANNEL,
    );
    expect(electronMock.invokeCalls).toContain(
      PATCHER_DESKTOP_GET_WINDOW_STATE_CHANNEL,
    );
    expect(electronMock.invokeCalls).toContain(
      PATCHER_DESKTOP_INSTALL_UPDATE_CHANNEL,
    );
  }, 10_000);

  it("parses page reads and turns every failure into a typed refusal", async () => {
    const api = await loadPreload();
    const content = {
      ok: true,
      tabId: "browser:a",
      url: "https://example.com/",
      title: "Example",
      isLoading: false,
      text: "hello",
      textTruncated: false,
      selection: "",
      selectionTruncated: false,
    };
    electronMock.setReadPageReply(() => Promise.resolve(content));

    // `contentKind` is absent above on purpose: that is what an older shell
    // sends, and the SPA must read it as the HTML page every read used to be.
    await expect(api.browser.readPage?.("browser:a")).resolves.toEqual({
      ...content,
      contentKind: "html",
    });
    expect(electronMock.invokeCalls).toContain(
      PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
    );
    expect(electronMock.invokePayloads).toContainEqual({ tabId: "browser:a" });

    // A shell that answers with something this build cannot read, and one whose
    // handler rejects outright, must both reach the SPA as a value it can
    // branch on rather than as a thrown transport error.
    electronMock.setReadPageReply(() => Promise.resolve({ ok: true }));
    await expect(api.browser.readPage?.("browser:a")).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });

    electronMock.setReadPageReply(() =>
      Promise.reject(new Error("no handler")),
    );
    await expect(api.browser.readPage?.("browser:a")).resolves.toEqual({
      ok: false,
      reason: "unreadable",
    });
  }, 10_000);

  it("sends each answering command down its own channel", async () => {
    const api = await loadPreload();

    // Every one of these is `invoke(channel, request)` with an identical
    // signature, so a copy-pasted call reaching the wrong channel type-checks
    // and then silently does the wrong thing at runtime. This is the only
    // place that pins the pairing.
    await api.browser.readPage?.("browser:a");
    await api.browser.snapshot?.({ tabId: "browser:a" });
    await api.browser.respondToDialog?.({ tabId: "browser:a", accept: true });
    await api.browser.interact?.({
      tabId: "browser:a",
      interaction: { action: "hover", ref: "e1" },
    });
    await api.browser.observe?.({
      tabId: "browser:a",
      observation: { kind: "console", limit: 10 },
    });
    await api.browser.storage?.({
      tabId: "browser:a",
      operation: { kind: "items-get", area: "local" },
    });
    await api.browser.control?.({
      tabId: "browser:a",
      operation: { kind: "route-list" },
    });
    await api.browser.record?.({
      tabId: "browser:a",
      operation: { kind: "video-stop" },
    });
    await api.browser.snapshotIn?.({ tabId: "browser:a", selector: "#main" });
    await api.browser.captureFullPage?.({
      tabId: "browser:a",
      format: "jpeg",
      quality: 80,
    });

    // Loading the preload invokes its own startup channels first; only the
    // browser ones are this test's business.
    expect(
      electronMock.invokeCalls.filter((channel) =>
        channel.startsWith("patcher-desktop:browser:"),
      ),
    ).toEqual([
      PATCHER_DESKTOP_BROWSER_READ_PAGE_CHANNEL,
      PATCHER_DESKTOP_BROWSER_SNAPSHOT_TREE_CHANNEL,
      PATCHER_DESKTOP_BROWSER_DIALOG_RESPOND_CHANNEL,
      PATCHER_DESKTOP_BROWSER_INTERACT_CHANNEL,
      PATCHER_DESKTOP_BROWSER_OBSERVE_CHANNEL,
      PATCHER_DESKTOP_BROWSER_STORAGE_CHANNEL,
      PATCHER_DESKTOP_BROWSER_CONTROL_CHANNEL,
      PATCHER_DESKTOP_BROWSER_RECORD_CHANNEL,
      PATCHER_DESKTOP_BROWSER_SNAPSHOT_IN_CHANNEL,
      PATCHER_DESKTOP_BROWSER_CAPTURE_FULL_PAGE_CHANNEL,
    ]);
  }, 10_000);

  it("converts zoomed renderer bounds to native window coordinates", async () => {
    const api = await loadPreload();
    electronMock.setZoomFactor(1.25);

    api.browser.attach({
      tabId: "browser:zoomed",
      url: "https://example.com/",
      bounds: { x: 800, y: 40, width: 400, height: 600 },
      visible: false,
    });
    api.browser.setBounds({
      tabId: "browser:zoomed",
      bounds: { x: 801, y: 41, width: 399, height: 599 },
    });

    expect(electronMock.sendCalls).toEqual([
      {
        channel: PATCHER_DESKTOP_BROWSER_ATTACH_CHANNEL,
        payload: {
          tabId: "browser:zoomed",
          url: "https://example.com/",
          bounds: { x: 1000, y: 50, width: 500, height: 750 },
          visible: false,
        },
      },
      {
        channel: PATCHER_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
        payload: {
          tabId: "browser:zoomed",
          bounds: { x: 1001, y: 51, width: 499, height: 749 },
        },
      },
    ]);
  });

  it("validates browser event payloads before notifying renderer listeners", async () => {
    const api = await loadPreload();
    const states: PatcherDesktopBrowserState[] = [];
    const openTabs: PatcherDesktopBrowserOpenTabRequest[] = [];
    const scopedOpenTabs: PatcherDesktopBrowserScopedOpenTabRequest[] = [];
    const snapshots: PatcherDesktopBrowserSnapshot[] = [];
    let closeWindowRequestCount = 0;
    let openNewTabCount = 0;
    const appCommands: AppCommandId[] = [];
    const windowStates: PatcherDesktopWindowState[] = [];
    const state: PatcherDesktopBrowserState = {
      tabId: "browser:a",
      url: "https://example.com/",
      title: "Example",
      isLoading: false,
      canGoBack: false,
      canGoForward: true,
      errorText: null,
    };
    const openTab: PatcherDesktopBrowserOpenTabRequest = {
      url: "https://example.com/popup",
    };
    const scopedOpenTab: PatcherDesktopBrowserScopedOpenTabRequest = {
      tabId: "browser:a",
      url: "https://example.com/scoped-popup",
    };
    const snapshot: PatcherDesktopBrowserSnapshot = {
      tabId: "browser:a",
      dataUrl: null,
    };

    api.browser.onState((nextState) => {
      states.push(nextState);
    });
    api.browser.onOpenTab((request) => {
      openTabs.push(request);
    });
    api.browser.onScopedOpenTab?.((request) => {
      scopedOpenTabs.push(request);
    });
    api.browser.onSnapshot?.((nextSnapshot) => {
      snapshots.push(nextSnapshot);
    });
    api.onOpenNewTab?.(() => {
      openNewTabCount += 1;
    });
    api.onAppCommand?.((command) => {
      appCommands.push(command);
    });
    api.onCloseWindowRequest?.(() => {
      closeWindowRequestCount += 1;
      return true;
    });
    api.onWindowStateChange?.((windowState) => {
      windowStates.push(windowState);
    });

    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_STATE_CHANNEL,
      payload: { ...state, extra: true },
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
      payload: { url: "" },
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
      payload: { tabId: "", url: "https://example.com/scoped-popup" },
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
      payload: { tabId: "browser:a", dataUrl: 42 },
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
      payload: { isFullScreen: false, extra: true },
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_STATE_CHANNEL,
      payload: state,
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
      payload: openTab,
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
      payload: scopedOpenTab,
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
      payload: snapshot,
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
      payload: { isFullScreen: true },
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_OPEN_NEW_TAB_CHANNEL,
      payload: null,
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_APP_COMMAND_CHANNEL,
      payload: "not-a-command",
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_APP_COMMAND_CHANNEL,
      payload: "thread.new",
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
      payload: null,
    });

    expect(states).toEqual([state]);
    expect(openTabs).toEqual([openTab]);
    expect(scopedOpenTabs).toEqual([scopedOpenTab]);
    expect(snapshots).toEqual([snapshot]);
    expect(windowStates).toEqual([{ isFullScreen: true }]);
    expect(closeWindowRequestCount).toBe(1);
    expect(openNewTabCount).toBe(1);
    expect(appCommands).toEqual(["thread.new"]);
    expect(electronMock.sendCalls).toContainEqual({
      channel: PATCHER_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
      payload: true,
    });
  });

  it("validates the network questions before showing them to the app", async () => {
    const api = await loadPreload();
    const prompts: Array<PatcherDesktopBrowserPagePrompt["prompt"]> = [];
    const prompt = {
      kind: "auth" as const,
      id: "page-prompt-1",
      host: "example.com",
      insecure: false,
    };

    api.browser.onPagePrompt?.((event) => {
      prompts.push(event.prompt);
    });

    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
      // A prompt of no known kind is not one this app can answer.
      payload: { tabId: "browser:a", prompt: { ...prompt, kind: "totp" } },
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
      payload: { tabId: "browser:a", prompt },
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_PAGE_PROMPT_CHANNEL,
      payload: { tabId: "browser:a", prompt: null },
    });

    expect(prompts).toEqual([prompt, null]);
  });

  it("validates popups before handing them to the app", async () => {
    const api = await loadPreload();
    const popups: unknown[] = [];
    const opened = {
      kind: "opened" as const,
      openerTabId: "browser:a",
      tabId: "browser-popup:1",
      url: "https://accounts.example.com/oauth",
    };

    api.browser.onPopup?.((popup) => {
      popups.push(popup);
    });
    api.browser.setPopupTabs?.({ tabIds: ["browser:a"] });

    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL,
      // No `kind` this app knows: not a popup event it can act on.
      payload: { kind: "resized", tabId: "browser-popup:1" },
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL,
      payload: opened,
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_POPUP_CHANNEL,
      payload: { kind: "closed", tabId: "browser-popup:1" },
    });

    expect(electronMock.sendCalls).toContainEqual({
      channel: PATCHER_DESKTOP_BROWSER_SET_POPUP_TABS_CHANNEL,
      payload: { tabIds: ["browser:a"] },
    });
    expect(popups).toEqual([
      opened,
      { kind: "closed", tabId: "browser-popup:1" },
    ]);
  });

  it("forwards find commands and validates the counts coming back", async () => {
    const api = await loadPreload();
    const results: PatcherDesktopBrowserFindResult[] = [];
    const result: PatcherDesktopBrowserFindResult = {
      tabId: "browser:a",
      activeMatchOrdinal: 2,
      matches: 7,
      finalUpdate: true,
    };

    api.browser.onFindResult?.((next) => {
      results.push(next);
    });
    api.browser.find?.({
      tabId: "browser:a",
      action: "start",
      query: "needle",
    });

    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
      payload: { ...result, matches: "many" },
    });
    emitIpcPayload({
      channel: PATCHER_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
      payload: result,
    });

    expect(electronMock.sendCalls).toContainEqual({
      channel: PATCHER_DESKTOP_BROWSER_FIND_CHANNEL,
      payload: { tabId: "browser:a", action: "start", query: "needle" },
    });
    expect(results).toEqual([result]);
  });

  it("answers unhandled close-window requests so main closes the window", async () => {
    await loadPreload();

    emitIpcPayload({
      channel: PATCHER_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
      payload: null,
    });

    expect(electronMock.sendCalls).toContainEqual({
      channel: PATCHER_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
      payload: false,
    });
  });
});
