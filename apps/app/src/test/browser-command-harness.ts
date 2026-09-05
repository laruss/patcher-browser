import { vi } from "vitest";
import type {
  PatcherDesktopBrowserApi,
  PatcherDesktopBrowserCaptureFullPageResult,
  PatcherDesktopBrowserControlResult,
  PatcherDesktopBrowserInteractResult,
  PatcherDesktopBrowserObserveResult,
  PatcherDesktopBrowserPageReadResult,
  PatcherDesktopBrowserRecordResult,
  PatcherDesktopBrowserSnapshotResult,
  PatcherDesktopBrowserState,
  PatcherDesktopBrowserStorageResult,
} from "@patcher/desktop-contract";
import type { BrowserCommandIssuer } from "@patcher/server-contract";
import { createBrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import {
  EMPTY_BROWSER_SURFACE_TABS_STATE,
  getBrowserSurfaceWebTabs,
  type BrowserSurfaceTabsState,
} from "@/lib/browser-surface-tabs";
import type { BrowserCommandDeps } from "@/lib/browser-agent/execute";
import {
  EMPTY_BROWSER_TAB_OWNERS,
  withBrowserTabOwner,
  type BrowserTabOwners,
} from "@/lib/browser-agent/tab-owners";
import type { BrowserTabQueue } from "@/lib/browser-agent/tab-queue";
import type { BrowserTraceRecorder } from "@/lib/browser-agent/trace";

/**
 * A browser executor with a stand-in shell behind it.
 *
 * Extracted from `execute.test.ts` when the tab-ownership cases pushed that file
 * past the line limit, and shared rather than copied for the usual reason: two
 * harnesses drift, and the one that drifts is the one whose test then passes for
 * the wrong reason. Everything here is a seam the executor already has — the
 * shell methods it calls, the state it reads, the records it writes — so a test
 * that needs a new one adds it here and every other test keeps working.
 */

export function tab(id: string, url = "", title: string | null = null) {
  return {
    ...createBrowserFixedPanelTab({ environmentId: null, url }),
    id,
    title,
  };
}

export function liveState(
  tabId: string,
  overrides: Partial<PatcherDesktopBrowserState> = {},
): PatcherDesktopBrowserState {
  return {
    tabId,
    url: "https://example.com/",
    title: "Example",
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    errorText: null,
    ...overrides,
  };
}

export interface HarnessArgs {
  state?: BrowserSurfaceTabsState;
  live?: Record<string, PatcherDesktopBrowserState>;
  readPage?: PatcherDesktopBrowserPageReadResult;
  omitReadPage?: boolean;
  /**
   * Held open until this resolves, so a test can have one command in flight
   * while it issues another — the only way to see whether they interleave.
   */
  readPageGate?: Promise<unknown>;
  readPageIn?: PatcherDesktopBrowserPageReadResult;
  omitReadPageIn?: boolean;
  omitAttachBackgroundView?: boolean;
  resolvePdfText?: (args: {
    pageUrl: string;
    tabId: string;
    title: string | null;
  }) => Promise<string | null>;
  snapshot?: PatcherDesktopBrowserSnapshotResult;
  omitSnapshot?: boolean;
  omitSnapshotIn?: boolean;
  interact?: PatcherDesktopBrowserInteractResult;
  omitInteract?: boolean;
  observe?: PatcherDesktopBrowserObserveResult;
  omitObserve?: boolean;
  captureFullPage?: PatcherDesktopBrowserCaptureFullPageResult;
  omitCaptureFullPage?: boolean;
  storage?: PatcherDesktopBrowserStorageResult;
  omitStorage?: boolean;
  control?: PatcherDesktopBrowserControlResult;
  omitControl?: boolean;
  record?: PatcherDesktopBrowserRecordResult;
  omitRecord?: boolean;
  omitSetZoom?: boolean;
  omitSetMuted?: boolean;
  trace?: BrowserTraceRecorder;
  noDesktop?: boolean;
  /** Who the command is for; absent is the app's own work. */
  issuer?: BrowserCommandIssuer;
  /**
   * The window's command queue, when a test is about ordering. Absent means
   * what the executor does without a bridge: run everything at once.
   */
  queue?: BrowserTabQueue;
  /** Tabs already claimed, as the window would hold them. */
  owners?: BrowserTabOwners;
}

export function createHarness(args: HarnessArgs = {}) {
  let state = args.state ?? EMPTY_BROWSER_SURFACE_TABS_STATE;
  let clock = 0;
  let owners = args.owners ?? EMPTY_BROWSER_TAB_OWNERS;
  const live = new Map(Object.entries(args.live ?? {}));
  const calls = {
    navigate: [] as Array<{ tabId: string; url: string }>,
    goBack: [] as string[],
    goForward: [] as string[],
    reload: [] as string[],
    destroyed: [] as string[],
    settled: [] as string[],
    snapshots: [] as unknown[],
    interactions: [] as unknown[],
    observations: [] as unknown[],
    fullPageCaptures: [] as unknown[],
    storage: [] as unknown[],
    control: [] as unknown[],
    record: [] as unknown[],
    zoom: [] as unknown[],
    muted: [] as unknown[],
    mutedRecords: [] as unknown[],
    readPageIn: [] as unknown[],
    backgroundViews: [] as Array<{ tabId: string; url: string }>,
    handoverAsks: [] as Array<{ issuer: BrowserCommandIssuer; tabId: string }>,
  };
  let nextTabId = 0;

  const desktopBrowser = {
    attach: vi.fn(),
    detach: vi.fn(),
    ...(args.omitSetZoom === true
      ? {}
      : {
          setZoom: (request: { tabId: string; factor: number }) => {
            calls.zoom.push(request);
          },
        }),
    ...(args.omitSetMuted === true
      ? {}
      : {
          setMuted: (request: { tabId: string; muted: boolean }) => {
            calls.muted.push(request);
          },
        }),
    navigate: (request: { tabId: string; url: string }) => {
      calls.navigate.push(request);
    },
    goBack: (tabId: string) => {
      calls.goBack.push(tabId);
    },
    goForward: (tabId: string) => {
      calls.goForward.push(tabId);
    },
    reload: (tabId: string) => {
      calls.reload.push(tabId);
    },
    stop: vi.fn(),
    setBounds: vi.fn(),
    setVisible: vi.fn(),
    onState: () => () => undefined,
    onOpenTab: () => () => undefined,
    ...(args.omitSnapshot === true
      ? {}
      : {
          snapshot: (request: unknown) => {
            calls.snapshots.push(request);
            return Promise.resolve(
              args.snapshot ?? {
                ok: false as const,
                reason: "failed" as const,
              },
            );
          },
        }),
    ...(args.omitSnapshotIn === true
      ? {}
      : {
          snapshotIn: (request: unknown) => {
            calls.snapshots.push(request);
            return Promise.resolve(
              args.snapshot ?? {
                ok: false as const,
                reason: "failed" as const,
              },
            );
          },
        }),
    ...(args.omitInteract === true
      ? {}
      : {
          interact: (request: unknown) => {
            calls.interactions.push(request);
            return Promise.resolve(
              args.interact ?? {
                ok: true as const,
                tabId: "t",
                url: "https://example.com/next",
                title: "Next",
              },
            );
          },
        }),
    ...(args.omitObserve === true
      ? {}
      : {
          observe: (request: unknown) => {
            calls.observations.push(request);
            return Promise.resolve(
              args.observe ?? {
                ok: true as const,
                kind: "console" as const,
                tabId: "t",
                url: "https://example.com/",
                title: "Example",
                entries: [],
                droppedCount: 0,
              },
            );
          },
        }),
    ...(args.omitCaptureFullPage === true
      ? {}
      : {
          captureFullPage: (request: unknown) => {
            calls.fullPageCaptures.push(request);
            return Promise.resolve(
              args.captureFullPage ?? {
                ok: true as const,
                tabId: "t",
                url: "https://example.com/",
                title: "Example",
                mimeType: "image/jpeg" as const,
                base64: "FULL",
                width: 1280,
                height: 4200,
                truncated: false,
              },
            );
          },
        }),
    ...(args.omitStorage === true
      ? {}
      : {
          storage: (request: unknown) => {
            calls.storage.push(request);
            return Promise.resolve(
              args.storage ?? {
                ok: true as const,
                kind: "removed" as const,
                removed: 0,
              },
            );
          },
        }),
    ...(args.omitControl === true
      ? {}
      : {
          control: (request: unknown) => {
            calls.control.push(request);
            return Promise.resolve(
              args.control ?? {
                ok: true as const,
                kind: "acted" as const,
                tabId: "t",
                url: "https://example.com/",
                title: "Example",
              },
            );
          },
        }),
    ...(args.omitRecord === true
      ? {}
      : {
          record: (request: unknown) => {
            calls.record.push(request);
            return Promise.resolve(
              args.record ?? {
                ok: true as const,
                kind: "recording" as const,
                tabId: "t",
                url: "https://example.com/",
                title: "Example",
                active: true,
              },
            );
          },
        }),
    ...(args.omitReadPageIn === true
      ? {}
      : {
          readPageIn: (request: unknown) => {
            calls.readPageIn.push(request);
            return Promise.resolve(
              args.readPageIn ?? {
                ok: true as const,
                tabId: "t",
                url: "https://example.com/",
                title: "Example",
                isLoading: false,
                contentKind: "html" as const,
                text: "just the article",
                textTruncated: false,
                selection: "",
                selectionTruncated: false,
              },
            );
          },
        }),
    ...(args.omitReadPage === true
      ? {}
      : {
          readPage: async () => {
            await (args.readPageGate ?? Promise.resolve());
            return (
              args.readPage ?? {
                ok: true as const,
                tabId: "t",
                url: "https://example.com/",
                title: "Example",
                isLoading: false,
                contentKind: "html" as const,
                text: "page text",
                textTruncated: false,
                selection: "selected",
                selectionTruncated: false,
              }
            );
          },
        }),
  } as unknown as PatcherDesktopBrowserApi;

  const deps: BrowserCommandDeps = {
    getState: () => state,
    applyState: (update) => {
      state = update(state);
    },
    desktopBrowser: args.noDesktop === true ? null : desktopBrowser,
    getLiveState: (tabId) => live.get(tabId) ?? null,
    waitForSettled: (tabId) => {
      calls.settled.push(tabId);
      return Promise.resolve({ timedOut: false });
    },
    createTab: (url) => {
      nextTabId += 1;
      return tab(`new-${nextTabId}`, url);
    },
    destroyView: ({ tabId }) => {
      calls.destroyed.push(tabId);
    },
    ...(args.omitAttachBackgroundView === true
      ? {}
      : {
          attachBackgroundView: ({
            tabId,
            url,
          }: {
            tabId: string;
            url: string;
          }) => {
            calls.backgroundViews.push({ tabId, url });
          },
        }),
    recordMuted: (request) => {
      calls.mutedRecords.push(request);
    },
    ...(args.issuer === undefined ? {} : { issuer: args.issuer }),
    ...(args.queue === undefined ? {} : { runOnTab: args.queue.run }),
    getTabOwners: () => owners,
    // The bridge's own wiring, on purpose: pruning happens on write, so a test
    // that kept its own map would not be exercising the rule that drops the
    // entry for a tab somebody closed.
    setTabOwner: ({ issuer, tabId }) => {
      owners = withBrowserTabOwner(owners, {
        issuer,
        openTabIds: getBrowserSurfaceWebTabs(state).map((each) => each.id),
        tabId,
      });
    },
    requestTabHandover: (ask) => {
      calls.handoverAsks.push(ask);
    },
    ...(args.resolvePdfText === undefined
      ? {}
      : { resolvePdfText: args.resolvePdfText }),
    ...(args.trace === undefined ? {} : { trace: args.trace }),
    now: () => clock,
  };

  return {
    calls,
    deps,
    getOwners: () => owners,
    live,
    advance(ms: number) {
      clock += ms;
    },
    get state() {
      return state;
    },
  };
}
