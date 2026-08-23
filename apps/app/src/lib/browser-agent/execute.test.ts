import { describe, expect, it, vi } from "vitest";
import type {
  PatcherDesktopBrowserApi,
  PatcherDesktopBrowserCaptureFullPageResult,
  PatcherDesktopBrowserInteractResult,
  PatcherDesktopBrowserObserveResult,
  PatcherDesktopBrowserPageReadResult,
  PatcherDesktopBrowserSnapshotResult,
  PatcherDesktopBrowserState,
  PatcherDesktopBrowserControlResult,
  PatcherDesktopBrowserRecordResult,
  PatcherDesktopBrowserStorageResult,
} from "@patcher/desktop-contract";
import type { BrowserCommandOutcome } from "@patcher/domain";
import { createBrowserFixedPanelTab } from "../fixed-panel-tabs-state";
import {
  EMPTY_BROWSER_SURFACE_TABS_STATE,
  getBrowserSurfaceWebTabs,
  type BrowserSurfaceTabsState,
} from "../browser-surface-tabs";
import { executeBrowserCommand, type BrowserCommandDeps } from "./execute";
import { BrowserTraceRecorder } from "./trace";

/**
 * The executor is the whole of the agent-facing browser behaviour, so these
 * cases are mostly about what an agent is told when it cannot have what it
 * asked for — a wrong answer here reads to the model as a broken browser.
 */

function tab(id: string, url = "", title: string | null = null) {
  return {
    ...createBrowserFixedPanelTab({ environmentId: null, url }),
    id,
    title,
  };
}

function liveState(
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

interface HarnessArgs {
  state?: BrowserSurfaceTabsState;
  live?: Record<string, PatcherDesktopBrowserState>;
  readPage?: PatcherDesktopBrowserPageReadResult;
  omitReadPage?: boolean;
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
}

function createHarness(args: HarnessArgs = {}) {
  let state = args.state ?? EMPTY_BROWSER_SURFACE_TABS_STATE;
  let clock = 0;
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
    ...(args.omitReadPage === true
      ? {}
      : {
          readPage: () =>
            Promise.resolve(
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
              },
            ),
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
    recordMuted: (request) => {
      calls.mutedRecords.push(request);
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
    live,
    advance(ms: number) {
      clock += ms;
    },
    get state() {
      return state;
    },
  };
}

function expectFailure(outcome: BrowserCommandOutcome, code: string): void {
  expect(outcome.ok).toBe(false);
  if (!outcome.ok) {
    expect(outcome.code).toBe(code);
  }
}

describe("executeBrowserCommand — tabs", () => {
  it("lists tabs with liveness, activity and navigation flags", async () => {
    const harness = createHarness({
      state: {
        activeTabId: "a",
        tabs: [tab("a"), tab("b", "https://b.test/")],
      },
      live: { a: liveState("a", { canGoBack: true, title: "Live title" }) },
    });

    const outcome = await executeBrowserCommand(
      { type: "tabs.list" },
      harness.deps,
    );

    expect(outcome).toEqual({
      ok: true,
      value: {
        type: "tabs",
        tabs: [
          {
            tabId: "a",
            url: "https://example.com/",
            title: "Live title",
            active: true,
            live: true,
            loading: false,
            canGoBack: true,
            canGoForward: false,
          },
          {
            // No live view: the persisted tab is all there is, and the history
            // flags are false because they are unknown, not because they are no.
            tabId: "b",
            url: "https://b.test/",
            title: null,
            active: false,
            live: false,
            loading: false,
            canGoBack: false,
            canGoForward: false,
          },
        ],
      },
    });
  });

  it("opens a tab, honouring a request to leave focus alone", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    await executeBrowserCommand(
      { type: "tabs.open", url: "https://example.com", activate: false },
      harness.deps,
    );

    expect(harness.state.activeTabId).toBe("a");
    expect(
      getBrowserSurfaceWebTabs(harness.state).map((each) => each.url),
    ).toEqual(["", "https://example.com"]);

    await executeBrowserCommand(
      { type: "tabs.open", url: null, activate: true },
      harness.deps,
    );
    expect(harness.state.activeTabId).toBe("new-2");
  });

  it("refuses to open anything that is not an http(s) address", async () => {
    const harness = createHarness();

    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "not a url",
    ]) {
      expectFailure(
        await executeBrowserCommand(
          { type: "tabs.open", url, activate: true },
          harness.deps,
        ),
        "blocked_url",
      );
    }
    expect(harness.state.tabs).toHaveLength(0);
  });

  it("tears down the native view when it closes a tab", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a"), tab("b")] },
    });

    const outcome = await executeBrowserCommand(
      { type: "tabs.close", tabId: "a" },
      harness.deps,
    );

    // Without this the WebContentsView leaks: the deck only reaps vanished tabs
    // while it is mounted, and an agent can close a tab from any route.
    expect(harness.calls.destroyed).toEqual(["a"]);
    expect(harness.state.tabs.map((each) => each.id)).toEqual(["b"]);
    expect(harness.state.activeTabId).toBe("b");
    expect(outcome.ok && outcome.value.type === "closed").toBe(true);
  });

  it("reports an unknown tab id rather than doing nothing", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    expectFailure(
      await executeBrowserCommand(
        { type: "tabs.close", tabId: "nope" },
        harness.deps,
      ),
      "unknown_tab",
    );
    expectFailure(
      await executeBrowserCommand(
        { type: "tabs.activate", tabId: "nope" },
        harness.deps,
      ),
      "unknown_tab",
    );
  });

  // The strip's own three, driveable so a plugin can arrange tabs the way the
  // user can. Pin and duplicate are renderer state; mute is the shell's.
  it("pins and unpins a tab, moving it into the strip's leading block", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a"), tab("b")] },
    });

    const pinned = await executeBrowserCommand(
      { type: "tabs.pin", tabId: "b", pinned: true },
      harness.deps,
    );

    expect(harness.state.tabs.map((each) => each.id)).toEqual(["b", "a"]);
    expect(pinned.ok && pinned.value.type === "tab").toBe(true);

    await executeBrowserCommand(
      { type: "tabs.pin", tabId: "b", pinned: false },
      harness.deps,
    );

    expect(harness.state.tabs.some((each) => each.pinned === true)).toBe(false);
  });

  it("mutes a tab through the shell and records it for the strip", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    const outcome = await executeBrowserCommand(
      { type: "tabs.mute", tabId: "a", muted: true },
      harness.deps,
    );

    expect(harness.calls.muted).toEqual([{ muted: true, tabId: "a" }]);
    expect(harness.calls.mutedRecords).toEqual([{ muted: true, tabId: "a" }]);
    expect(outcome.ok).toBe(true);
  });

  // An older shell has no channel for it, and saying so beats recording a mute
  // that never reached a page.
  it("refuses to mute on a shell that cannot", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      omitSetMuted: true,
    });

    expectFailure(
      await executeBrowserCommand(
        { type: "tabs.mute", tabId: "a", muted: true },
        harness.deps,
      ),
      "desktop_unavailable",
    );
    expect(harness.calls.mutedRecords).toEqual([]);
  });

  it("duplicates a tab beside its source and answers with the copy", async () => {
    const harness = createHarness({
      state: {
        activeTabId: "a",
        tabs: [tab("a", "https://a.test/"), tab("b")],
      },
    });

    const outcome = await executeBrowserCommand(
      { type: "tabs.duplicate", tabId: "a" },
      harness.deps,
    );

    expect(harness.state.tabs.map((each) => each.id)).toEqual([
      "a",
      "new-1",
      "b",
    ]);
    expect(
      outcome.ok && outcome.value.type === "tab" && outcome.value.tab,
    ).toEqual(
      expect.objectContaining({ tabId: "new-1", url: "https://a.test/" }),
    );
  });

  it("moves a tab along the strip, clamped into its own block", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a"), tab("b"), tab("c")] },
    });

    await executeBrowserCommand(
      { type: "tabs.move", tabId: "a", toIndex: 2 },
      harness.deps,
    );
    expect(harness.state.tabs.map((each) => each.id)).toEqual(["b", "c", "a"]);

    // Past the end is as far as it goes, not an error — the strip has three tabs.
    const outcome = await executeBrowserCommand(
      { type: "tabs.move", tabId: "b", toIndex: 99 },
      harness.deps,
    );
    expect(harness.state.tabs.map((each) => each.id)).toEqual(["c", "a", "b"]);
    expect(outcome.ok).toBe(true);
  });

  it("says so when there is no active tab to default to", async () => {
    const harness = createHarness();

    expectFailure(
      await executeBrowserCommand(
        { type: "page.get_url", tabId: null },
        harness.deps,
      ),
      "no_active_tab",
    );
  });
});

describe("executeBrowserCommand — page reads", () => {
  it("reads text and selection from the tab's live page", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      live: { a: liveState("a") },
    });

    await expect(
      executeBrowserCommand(
        { type: "page.get_text", tabId: null, maxLength: 1000 },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { type: "text", text: "page text", truncated: false },
    });
    await expect(
      executeBrowserCommand(
        { type: "page.get_selection", tabId: null },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { type: "text", text: "selected", truncated: false },
    });
  });

  it("clamps to the caller's maxLength and reports the cut", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    await expect(
      executeBrowserCommand(
        { type: "page.get_text", tabId: null, maxLength: 4 },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { type: "text", text: "page", truncated: true },
    });
  });

  it("translates each shell refusal into an actionable code", async () => {
    const cases: Array<[PatcherDesktopBrowserPageReadResult, string]> = [
      [{ ok: false, reason: "no-view" }, "tab_not_live"],
      [{ ok: false, reason: "no-page" }, "tab_not_live"],
      [{ ok: false, reason: "timeout" }, "page_read_timeout"],
      [{ ok: false, reason: "unreadable" }, "page_read_failed"],
      // PDF-only refusals from a newer shell, which an older app maps onto the
      // same code rather than onto nothing.
      [{ ok: false, reason: "too-large" }, "page_read_failed"],
      [{ ok: false, reason: "password-protected" }, "page_read_failed"],
    ];

    for (const [readPage, code] of cases) {
      const harness = createHarness({
        state: { activeTabId: "a", tabs: [tab("a")] },
        readPage,
      });
      expectFailure(
        await executeBrowserCommand(
          { type: "page.get_text", tabId: null, maxLength: 100 },
          harness.deps,
        ),
        code,
      );
    }
  });

  // A PDF's text does not come from its DOM: the shell refetches and parses
  // the document. What is left for the app to decide is the one case the
  // shell can answer truthfully and uselessly — a scan, with no text in it.
  it("reads a PDF tab like any other page once the shell has parsed it", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      readPage: {
        ok: true,
        tabId: "a",
        url: "https://example.com/report.pdf",
        title: "report.pdf",
        isLoading: false,
        contentKind: "pdf",
        text: "Quarterly Report",
        textTruncated: false,
        selection: "",
        selectionTruncated: false,
      },
    });

    await expect(
      executeBrowserCommand(
        { type: "page.get_text", tabId: null, maxLength: 1000 },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { type: "text", text: "Quarterly Report", truncated: false },
    });
  });

  it("asks plugins for a PDF the shell read and found no text in", async () => {
    const asked: unknown[] = [];
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      readPage: {
        ok: true,
        tabId: "a",
        url: "https://example.com/scan.pdf",
        title: "scan.pdf",
        isLoading: false,
        contentKind: "pdf",
        text: "",
        textTruncated: false,
        selection: "",
        selectionTruncated: false,
      },
      resolvePdfText: async (request) => {
        asked.push(request);
        return "text an OCR pass produced";
      },
    });

    await expect(
      executeBrowserCommand(
        { type: "page.get_text", tabId: null, maxLength: 1000 },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        type: "text",
        text: "text an OCR pass produced",
        truncated: false,
      },
    });
    expect(asked).toEqual([
      {
        pageUrl: "https://example.com/scan.pdf",
        tabId: "a",
        title: "scan.pdf",
      },
    ]);
  });

  it("never asks plugins about a PDF that already read as text", async () => {
    let asked = 0;
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      readPage: {
        ok: true,
        tabId: "a",
        url: "https://example.com/report.pdf",
        title: null,
        isLoading: false,
        contentKind: "pdf",
        text: "Quarterly Report",
        textTruncated: false,
        selection: "",
        selectionTruncated: false,
      },
      resolvePdfText: async () => {
        asked += 1;
        return "should never be used";
      },
    });

    await executeBrowserCommand(
      { type: "page.get_text", tabId: null, maxLength: 1000 },
      harness.deps,
    );

    // Providers exist for what the browser cannot read, not to intercept what
    // it can — and the round trip is not spent on documents that read fine.
    expect(asked).toBe(0);
  });

  it("says a scan has no text layer rather than answering with nothing", async () => {
    for (const resolvePdfText of [
      undefined,
      async () => null,
      async () => "",
    ]) {
      const harness = createHarness({
        state: { activeTabId: "a", tabs: [tab("a")] },
        readPage: {
          ok: true,
          tabId: "a",
          url: "https://example.com/scan.pdf",
          title: null,
          isLoading: false,
          contentKind: "pdf",
          text: "",
          textTruncated: false,
          selection: "",
          selectionTruncated: false,
        },
        ...(resolvePdfText === undefined ? {} : { resolvePdfText }),
      });

      const outcome = await executeBrowserCommand(
        { type: "page.get_text", tabId: null, maxLength: 1000 },
        harness.deps,
      );

      // An empty success would read as a blank document. The difference
      // between "this PDF says nothing" and "this PDF is a picture of text" is
      // the whole answer an agent needs.
      expectFailure(outcome, "page_read_failed");
      expect(outcome.ok ? "" : outcome.message).toContain("no text layer");
    }
  });

  it("leaves an empty HTML page as the empty success it is", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      readPage: {
        ok: true,
        tabId: "a",
        url: "https://example.com/",
        title: null,
        isLoading: false,
        contentKind: "html",
        text: "",
        textTruncated: false,
        selection: "",
        selectionTruncated: false,
      },
    });

    await expect(
      executeBrowserCommand(
        { type: "page.get_text", tabId: null, maxLength: 1000 },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { type: "text", text: "", truncated: false },
    });
  });

  it("reports an older desktop shell that has no read-page channel", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      omitReadPage: true,
    });

    // Feature detection is the version negotiation for the whole channel.
    expectFailure(
      await executeBrowserCommand(
        { type: "page.get_text", tabId: null, maxLength: 100 },
        harness.deps,
      ),
      "unsupported_command",
    );
  });

  it("answers url and title from tab state, with no page involved", async () => {
    const harness = createHarness({
      state: {
        activeTabId: "a",
        tabs: [tab("a", "https://stored.test/", "Stored")],
      },
      noDesktop: true,
    });

    // These work on the web build and for tabs that were never opened, which is
    // why they are not gated behind the desktop shell.
    await expect(
      executeBrowserCommand(
        { type: "page.get_url", tabId: null },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { type: "url", url: "https://stored.test/" },
    });
    await expect(
      executeBrowserCommand(
        { type: "page.get_title", tabId: null },
        harness.deps,
      ),
    ).resolves.toEqual({ ok: true, value: { type: "title", title: "Stored" } });
  });
});

describe("executeBrowserCommand — navigation", () => {
  it("navigates a live tab and waits for the load to settle", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      live: { a: liveState("a") },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "navigation.open",
        tabId: null,
        url: "https://example.com/next",
        newTab: false,
      },
      harness.deps,
    );

    expect(harness.calls.navigate).toEqual([
      { tabId: "a", url: "https://example.com/next" },
    ]);
    // Without the wait, an agent that navigates then reads gets the old page.
    expect(harness.calls.settled).toEqual(["a"]);
    expect(outcome.ok).toBe(true);
  });

  it("stores the URL for a tab with no live view instead of failing", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "navigation.open",
        tabId: null,
        url: "https://example.com/later",
        newTab: false,
      },
      harness.deps,
    );

    // Nothing to drive yet, but the tab loads this when it is next opened.
    expect(harness.calls.navigate).toEqual([]);
    expect(harness.calls.settled).toEqual([]);
    expect(getBrowserSurfaceWebTabs(harness.state)[0]?.url).toBe(
      "https://example.com/later",
    );
    expect(outcome.ok).toBe(true);
  });

  it("opens in a new tab when asked", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
    });

    await executeBrowserCommand(
      {
        type: "navigation.open",
        tabId: null,
        url: "https://example.com/new",
        newTab: true,
      },
      harness.deps,
    );

    expect(harness.state.tabs).toHaveLength(2);
    expect(getBrowserSurfaceWebTabs(harness.state)[1]?.url).toBe(
      "https://example.com/new",
    );
  });

  it("refuses a URL the browser would not open", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      live: { a: liveState("a") },
    });

    expectFailure(
      await executeBrowserCommand(
        {
          type: "navigation.open",
          tabId: null,
          url: "javascript:alert(1)",
          newTab: false,
        },
        harness.deps,
      ),
      "blocked_url",
    );
    expect(harness.calls.navigate).toEqual([]);
  });

  it("replays history only where there is history to replay", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a"), tab("dead")] },
      live: { a: liveState("a", { canGoBack: true, canGoForward: false }) },
    });

    expect(
      (
        await executeBrowserCommand(
          { type: "navigation.back", tabId: null },
          harness.deps,
        )
      ).ok,
    ).toBe(true);
    expect(harness.calls.goBack).toEqual(["a"]);

    // canGoForward is false, so there is nothing forward of here.
    expectFailure(
      await executeBrowserCommand(
        { type: "navigation.forward", tabId: null },
        harness.deps,
      ),
      "tab_not_live",
    );

    // And a tab with no live view has no history at all.
    expectFailure(
      await executeBrowserCommand(
        { type: "navigation.reload", tabId: "dead" },
        harness.deps,
      ),
      "tab_not_live",
    );
    expect(harness.calls.reload).toEqual([]);
  });

  it("reloads a live tab and waits for it", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      live: { a: liveState("a") },
    });

    expect(
      (
        await executeBrowserCommand(
          { type: "navigation.reload", tabId: null },
          harness.deps,
        )
      ).ok,
    ).toBe(true);
    expect(harness.calls.reload).toEqual(["a"]);
    expect(harness.calls.settled).toEqual(["a"]);
  });
});

describe("executeBrowserCommand — guards", () => {
  it("rejects a command it does not recognize", async () => {
    const harness = createHarness();

    expectFailure(
      await executeBrowserCommand({ type: "page.eval" }, harness.deps),
      "invalid_command",
    );
    expectFailure(
      await executeBrowserCommand({ type: "tabs.close" }, harness.deps),
      "invalid_command",
    );
    expectFailure(
      await executeBrowserCommand(null, harness.deps),
      "invalid_command",
    );
  });

  it("explains that anything touching a page needs the desktop app", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      noDesktop: true,
    });

    for (const command of [
      { type: "tabs.open", url: null, activate: true },
      { type: "page.get_text", tabId: null, maxLength: 10 },
      { type: "navigation.reload", tabId: null },
    ]) {
      expectFailure(
        await executeBrowserCommand(command, harness.deps),
        "desktop_unavailable",
      );
    }

    // Listing still works: tabs are renderer state, not an Electron thing.
    expect(
      (await executeBrowserCommand({ type: "tabs.list" }, harness.deps)).ok,
    ).toBe(true);
  });

  it("sees its own writes within one turn", async () => {
    const harness = createHarness();

    await executeBrowserCommand(
      { type: "tabs.open", url: "https://first.test", activate: true },
      harness.deps,
    );
    const outcome = await executeBrowserCommand(
      { type: "page.get_url", tabId: null },
      harness.deps,
    );

    // Reading state through a getter rather than a render snapshot is what makes
    // an open-then-read sequence in one turn work.
    expect(outcome).toEqual({
      ok: true,
      value: { type: "url", url: "https://first.test" },
    });
  });
});

describe("executeBrowserCommand — snapshot", () => {
  it("returns the tree, its refs and the generation they belong to", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      snapshot: {
        ok: true,
        tabId: "a",
        url: "https://example.com/",
        title: "Example",
        snapshot: '- button "Save" [ref=e1]',
        generation: 3,
        refCount: 1,
        truncated: false,
      },
    });

    await expect(
      executeBrowserCommand(
        { type: "page.snapshot", tabId: null, maxDepth: null, selector: null },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        type: "snapshot",
        tabId: "a",
        url: "https://example.com/",
        title: "Example",
        snapshot: '- button "Save" [ref=e1]',
        // Carried through so interaction commands can be refused when the page
        // has navigated since the refs were handed out.
        generation: 3,
        refCount: 1,
        truncated: false,
      },
    });
  });

  it("names DevTools as the reason the debugger could not attach", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      snapshot: {
        ok: false,
        reason: "debugger-unavailable",
        message: "Another debugger is already attached",
      },
    });

    const outcome = await executeBrowserCommand(
      { type: "page.snapshot", tabId: null, maxDepth: null, selector: null },
      harness.deps,
    );

    expectFailure(outcome, "debugger_unavailable");
    if (!outcome.ok) {
      expect(outcome.message).toContain("Close DevTools");
    }
  });

  it("maps a cold tab and an outright failure to their own codes", async () => {
    for (const [snapshot, code] of [
      [{ ok: false as const, reason: "no-view" as const }, "tab_not_live"],
      [{ ok: false as const, reason: "no-page" as const }, "tab_not_live"],
      [{ ok: false as const, reason: "failed" as const }, "page_read_failed"],
    ] as const) {
      const harness = createHarness({
        state: { activeTabId: "a", tabs: [tab("a")] },
        snapshot,
      });
      expectFailure(
        await executeBrowserCommand(
          {
            type: "page.snapshot",
            tabId: null,
            maxDepth: null,
            selector: null,
          },
          harness.deps,
        ),
        code,
      );
    }
  });

  it("sends a selector down the scoped channel, and nothing else there", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      snapshot: {
        ok: true,
        tabId: "a",
        url: "https://example.com/",
        title: "Example",
        snapshot: '- button "Pay" [ref=e1]',
        generation: 4,
        refCount: 1,
        truncated: false,
      },
    });

    await executeBrowserCommand(
      { type: "page.snapshot", tabId: null, maxDepth: null, selector: null },
      harness.deps,
    );
    await executeBrowserCommand(
      {
        type: "page.snapshot",
        tabId: null,
        maxDepth: 3,
        selector: "form.checkout",
      },
      harness.deps,
    );

    expect(harness.calls.snapshots).toEqual([
      { tabId: "a" },
      { tabId: "a", selector: "form.checkout", maxDepth: 3 },
    ]);
  });

  it("tells a bad selector apart from one that matched nothing", async () => {
    for (const [reason, code] of [
      ["invalid-selector", "invalid_selector"],
      ["no-match", "no_match"],
    ] as const) {
      const harness = createHarness({
        state: { activeTabId: "a", tabs: [tab("a")] },
        snapshot: { ok: false, reason, message: "because" },
      });

      expectFailure(
        await executeBrowserCommand(
          {
            type: "page.snapshot",
            tabId: null,
            maxDepth: null,
            selector: "#nope",
          },
          harness.deps,
        ),
        code,
      );
    }
  });

  it("says a shell can snapshot a page but not part of one", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      omitSnapshotIn: true,
      snapshot: {
        ok: true,
        tabId: "a",
        url: "https://example.com/",
        title: null,
        snapshot: "- main",
        generation: 1,
        refCount: 0,
        truncated: false,
      },
    });

    // Scoping rides its own channel, so an older shell has to be told what it
    // cannot do rather than quietly handed the whole page.
    expectFailure(
      await executeBrowserCommand(
        {
          type: "page.snapshot",
          tabId: null,
          maxDepth: null,
          selector: "#main",
        },
        harness.deps,
      ),
      "unsupported_command",
    );
    await expect(
      executeBrowserCommand(
        { type: "page.snapshot", tabId: null, maxDepth: null, selector: null },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: true });
  });

  it("reports a desktop build with no snapshot channel", async () => {
    const harness = createHarness({
      state: { activeTabId: "a", tabs: [tab("a")] },
      omitSnapshot: true,
    });

    expectFailure(
      await executeBrowserCommand(
        { type: "page.snapshot", tabId: null, maxDepth: null, selector: null },
        harness.deps,
      ),
      "unsupported_command",
    );
  });
});

describe("executeBrowserCommand — interaction", () => {
  const CLICK = {
    action: "click" as const,
    ref: "e1",
    button: "left" as const,
    clickCount: 1 as const,
    modifiers: [],
  };

  it("forwards the action and reports where the tab ended up", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: 3,
        interaction: CLICK,
      },
      harness.deps,
    );

    expect(harness.calls.interactions).toEqual([
      { tabId: "t", generation: 3, interaction: CLICK },
    ]);
    expect(outcome).toEqual({
      ok: true,
      value: {
        type: "interacted",
        tabId: "t",
        url: "https://example.com/next",
        title: "Next",
      },
    });
  });

  it("omits the generation entirely when the caller passed none", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
    });

    await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: CLICK,
      },
      harness.deps,
    );

    // A `generation: undefined` field would be a `.strict()` parse failure on
    // the shell side, so the key has to be absent rather than empty.
    expect(harness.calls.interactions).toEqual([
      { tabId: "t", interaction: CLICK },
    ]);
  });

  it("waits for a navigation the action started", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t", { isLoading: true }) },
    });

    await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: CLICK,
      },
      harness.deps,
    );

    // Otherwise the agent's next snapshot reads the page it just left.
    expect(harness.calls.settled).toEqual(["t"]);
  });

  it("does not wait when nothing navigated", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
    });

    await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: CLICK,
      },
      harness.deps,
    );

    // Waiting unconditionally would cost the settle timeout on every click that
    // only opened a menu.
    expect(harness.calls.settled).toEqual([]);
  });

  it("gives each shell refusal its own code", async () => {
    for (const [reason, code] of [
      ["stale-refs", "stale_refs"],
      ["unknown-ref", "unknown_ref"],
      ["not-actionable", "not_actionable"],
      ["unsupported-key", "unsupported_key"],
      ["debugger-unavailable", "debugger_unavailable"],
      ["no-view", "tab_not_live"],
    ] as const) {
      const harness = createHarness({
        state: { tabs: [tab("t")], activeTabId: "t" },
        live: { t: liveState("t") },
        interact: { ok: false, reason, message: "because" },
      });

      expectFailure(
        await executeBrowserCommand(
          {
            type: "page.interact",
            tabId: null,
            generation: null,
            interaction: CLICK,
          },
          harness.deps,
        ),
        code,
      );
    }
  });

  it("reports a desktop build with no interact channel", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      omitInteract: true,
    });

    expectFailure(
      await executeBrowserCommand(
        {
          type: "page.interact",
          tabId: null,
          generation: null,
          interaction: CLICK,
        },
        harness.deps,
      ),
      "unsupported_command",
    );
  });

  it("rejects an action that is not one of the known shapes", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
    });

    // The command came from a model, so a malformed one must not reach the page.
    expectFailure(
      await executeBrowserCommand(
        {
          type: "page.interact",
          tabId: null,
          generation: null,
          interaction: { action: "click", ref: "not-a-ref" },
        },
        harness.deps,
      ),
      "invalid_command",
    );
    expect(harness.calls.interactions).toEqual([]);
  });
});

describe("executeBrowserCommand — observation", () => {
  it("renames the shell's capture into the agent's image result", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      observe: {
        ok: true,
        kind: "screenshot",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        mimeType: "image/jpeg",
        base64: "AAA=",
        width: 1440,
        height: 900,
      },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "page.observe",
        tabId: null,
        observation: {
          kind: "screenshot",
          format: "jpeg",
          quality: 80,
          fullPage: false,
        },
      },
      harness.deps,
    );

    expect(harness.calls.observations).toEqual([
      {
        tabId: "t",
        observation: { kind: "screenshot", format: "jpeg", quality: 80 },
      },
    ]);
    expect(outcome).toEqual({
      ok: true,
      value: {
        type: "image",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        mimeType: "image/jpeg",
        base64: "AAA=",
        width: 1440,
        height: 900,
        fullPage: false,
        // The viewport is a different question, not a cut-off document.
        truncated: false,
      },
    });
  });

  it("sends a full-page capture down its own channel, not the observe one", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "page.observe",
        tabId: null,
        observation: {
          kind: "screenshot",
          format: "jpeg",
          quality: 80,
          fullPage: true,
        },
      },
      harness.deps,
    );

    // `fullPage` never reaches the shell's observation union, which has no such
    // field and would drop it — the flag picks the channel instead.
    expect(harness.calls.observations).toEqual([]);
    expect(harness.calls.fullPageCaptures).toEqual([
      { tabId: "t", format: "jpeg", quality: 80 },
    ]);
    expect(outcome).toEqual({
      ok: true,
      value: {
        type: "image",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        mimeType: "image/jpeg",
        base64: "FULL",
        width: 1280,
        height: 4200,
        fullPage: true,
        truncated: false,
      },
    });
  });

  it("passes on a capture that stopped at the height limit", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      captureFullPage: {
        ok: true,
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        mimeType: "image/jpeg",
        base64: "FULL",
        width: 1280,
        height: 16_384,
        truncated: true,
      },
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.observe",
          tabId: null,
          observation: {
            kind: "screenshot",
            format: "jpeg",
            quality: 80,
            fullPage: true,
          },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: true, value: { truncated: true } });
  });

  it("tells the caller to ask for the viewport when the shell is older", async () => {
    // Feature detection, not a silent fallback: a viewport picture returned as
    // a full-page one is a wrong answer nobody can see is wrong.
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      omitCaptureFullPage: true,
    });

    const outcome = await executeBrowserCommand(
      {
        type: "page.observe",
        tabId: null,
        observation: {
          kind: "screenshot",
          format: "jpeg",
          quality: 80,
          fullPage: true,
        },
      },
      harness.deps,
    );

    expect(outcome).toMatchObject({ ok: false, code: "unsupported_command" });
    expect(harness.calls.observations).toEqual([]);
  });

  it("reports DevTools holding the tab rather than a generic failure", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      captureFullPage: {
        ok: false,
        reason: "debugger-unavailable",
        message: "Another debugger is attached",
      },
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.observe",
          tabId: null,
          observation: {
            kind: "screenshot",
            format: "jpeg",
            quality: 80,
            fullPage: true,
          },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: false, code: "debugger_unavailable" });
  });

  it("carries a log through with the count of what it is not showing", async () => {
    const entry = {
      level: "error" as const,
      text: "boom",
      source: "https://example.com/app.js",
      line: 3,
      timestamp: 1_700_000_000_000,
    };
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      observe: {
        ok: true,
        kind: "console",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        entries: [entry],
        droppedCount: 12,
      },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "page.observe",
        tabId: null,
        observation: { kind: "console", limit: 50 },
      },
      harness.deps,
    );

    expect(outcome).toMatchObject({
      ok: true,
      value: { type: "console", entries: [entry], droppedCount: 12 },
    });
  });

  it("does not wait for a load, because looking at a page changes nothing", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t", { isLoading: true }) },
    });

    await executeBrowserCommand(
      {
        type: "page.observe",
        tabId: null,
        observation: { kind: "network", limit: 50 },
      },
      harness.deps,
    );

    expect(harness.calls.settled).toEqual([]);
  });

  it("gives each shell refusal its own code", async () => {
    for (const [reason, code] of [
      ["too-large", "result_too_large"],
      ["no-view", "tab_not_live"],
      ["no-page", "tab_not_live"],
      ["failed", "page_read_failed"],
    ] as const) {
      const harness = createHarness({
        state: { tabs: [tab("t")], activeTabId: "t" },
        live: { t: liveState("t") },
        observe: { ok: false, reason, message: "because" },
      });

      await expect(
        executeBrowserCommand(
          {
            type: "page.observe",
            tabId: null,
            observation: { kind: "pdf" },
          },
          harness.deps,
        ),
      ).resolves.toMatchObject({ ok: false, code });
    }
  });

  it("reports an older shell that has no observation channel", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      omitObserve: true,
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.observe",
          tabId: null,
          observation: { kind: "pdf" },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: false, code: "unsupported_command" });
  });
});

describe("executeBrowserCommand — storage", () => {
  const COOKIE = {
    name: "session",
    value: "abc",
    domain: ".example.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };

  it("carries a tab's cookies back with their values", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      storage: {
        ok: true,
        kind: "cookies",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        cookies: [COOKIE],
      },
    });

    const outcome = await executeBrowserCommand(
      { type: "page.storage", tabId: null, operation: { kind: "cookies-get" } },
      harness.deps,
    );

    expect(harness.calls.storage).toEqual([
      { tabId: "t", operation: { kind: "cookies-get" } },
    ]);
    expect(outcome).toEqual({
      ok: true,
      value: {
        type: "cookies",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        cookies: [COOKIE],
      },
    });
  });

  it("keeps the truncation flag on a web-storage read", async () => {
    // An origin that held more than the caps allow produces a state file that
    // restores a session only partly, so this flag has to survive the trip.
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      storage: {
        ok: true,
        kind: "items",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        area: "local",
        items: [{ name: "token", value: "abc" }],
        truncated: true,
      },
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.storage",
          tabId: null,
          operation: { kind: "items-get", area: "local" },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { type: "storage", area: "local", truncated: true },
    });
  });

  it("reports what a write landed and what the browser refused", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      storage: { ok: true, kind: "written", applied: 3, rejected: 1 },
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.storage",
          tabId: null,
          operation: { kind: "cookies-set", cookies: [COOKIE] },
        },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: { type: "written", applied: 3, rejected: 1 },
    });
  });

  it("gives each shell refusal its own code", async () => {
    for (const [reason, code] of [
      ["no-view", "tab_not_live"],
      ["no-page", "tab_not_live"],
      ["timeout", "page_read_timeout"],
      ["failed", "page_read_failed"],
    ] as const) {
      const harness = createHarness({
        state: { tabs: [tab("t")], activeTabId: "t" },
        live: { t: liveState("t") },
        storage: { ok: false, reason, message: "because" },
      });

      await expect(
        executeBrowserCommand(
          {
            type: "page.storage",
            tabId: null,
            operation: { kind: "items-get", area: "session" },
          },
          harness.deps,
        ),
      ).resolves.toMatchObject({ ok: false, code });
    }
  });

  it("reports an older shell that has no storage channel", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      omitStorage: true,
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.storage",
          tabId: null,
          operation: { kind: "cookies-get" },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: false, code: "unsupported_command" });
  });
});

describe("executeBrowserCommand direct control", () => {
  it("forwards an expression and the snapshot it came from", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      control: {
        ok: true,
        kind: "evaluated",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        value: '{"count":3}',
        truncated: false,
      },
    });

    const outcome = await executeBrowserCommand(
      {
        type: "page.control",
        tabId: null,
        generation: 4,
        operation: {
          kind: "evaluate",
          expression: "(el) => el.children.length",
          ref: "e2",
        },
      },
      harness.deps,
    );

    expect(harness.calls.control).toEqual([
      {
        tabId: "t",
        generation: 4,
        operation: {
          kind: "evaluate",
          expression: "(el) => el.children.length",
          ref: "e2",
        },
      },
    ]);
    expect(outcome).toEqual({
      ok: true,
      value: {
        type: "evaluated",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        value: '{"count":3}',
        truncated: false,
      },
    });
  });

  it("carries the route table and whether the tab is offline", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      control: {
        ok: true,
        kind: "routes",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        routes: [
          {
            pattern: "**/api/me",
            status: 200,
            contentType: "application/json",
            body: "{}",
            headers: [],
            matched: 2,
          },
        ],
        offline: true,
      },
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.control",
          tabId: null,
          generation: null,
          operation: { kind: "route-list" },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        type: "routes",
        routes: [{ pattern: "**/api/me", matched: 2 }],
        offline: true,
      },
    });
  });

  it("answers a coordinate click with where the tab ended up", async () => {
    // A click at a coordinate navigates exactly as a click on a ref does, so it
    // reports the same thing rather than nothing.
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.control",
          tabId: null,
          generation: null,
          operation: { kind: "mouse-button", button: "left", down: true },
        },
        harness.deps,
      ),
    ).resolves.toEqual({
      ok: true,
      value: {
        type: "interacted",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
      },
    });
  });

  it("gives each shell refusal its own code", async () => {
    for (const [reason, code] of [
      ["no-view", "tab_not_live"],
      ["no-page", "tab_not_live"],
      ["debugger-unavailable", "debugger_unavailable"],
      ["stale-refs", "stale_refs"],
      ["unknown-ref", "unknown_ref"],
      ["evaluation-failed", "evaluation_failed"],
      ["too-many-routes", "too_many_routes"],
      ["failed", "page_read_failed"],
    ] as const) {
      const harness = createHarness({
        state: { tabs: [tab("t")], activeTabId: "t" },
        live: { t: liveState("t") },
        control: { ok: false, reason, message: "because" },
      });

      await expect(
        executeBrowserCommand(
          {
            type: "page.control",
            tabId: null,
            generation: null,
            operation: { kind: "evaluate", expression: "() => 1", ref: null },
          },
          harness.deps,
        ),
      ).resolves.toMatchObject({ ok: false, code });
    }
  });

  it("reports an older shell that has no control channel", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      omitControl: true,
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.control",
          tabId: null,
          generation: null,
          operation: { kind: "route-list" },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: false, code: "unsupported_command" });
  });
});

describe("executeBrowserCommand — recording", () => {
  function trace(): BrowserTraceRecorder {
    return new BrowserTraceRecorder();
  }

  it("records the commands it ran, in order, with their outcomes", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      trace: trace(),
    });

    await executeBrowserCommand(
      {
        type: "page.record",
        tabId: null,
        operation: { kind: "trace-start", screenshots: false },
      },
      harness.deps,
    );
    harness.advance(500);
    await executeBrowserCommand({ type: "tabs.list" }, harness.deps);
    await executeBrowserCommand(
      { type: "navigation.open", tabId: null, url: "not a url", newTab: false },
      harness.deps,
    );
    harness.advance(500);
    const stopped = await executeBrowserCommand(
      { type: "page.record", tabId: null, operation: { kind: "trace-stop" } },
      harness.deps,
    );

    expect(stopped).toMatchObject({
      ok: true,
      value: {
        type: "trace",
        durationMs: 1_000,
        droppedSteps: 0,
        droppedImages: 0,
        steps: [
          { seq: 1, at: 500, command: "tabs.list", ok: true, error: null },
          {
            seq: 2,
            at: 500,
            command: "navigation.open",
            detail: "not a url",
            ok: false,
            error: "blocked_url",
          },
        ],
      },
    });
  });

  it("does not record the commands that control the trace", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      trace: trace(),
    });

    await executeBrowserCommand(
      {
        type: "page.record",
        tabId: null,
        operation: { kind: "trace-start", screenshots: false },
      },
      harness.deps,
    );
    const stopped = await executeBrowserCommand(
      { type: "page.record", tabId: null, operation: { kind: "trace-stop" } },
      harness.deps,
    );

    expect(stopped).toMatchObject({ ok: true, value: { steps: [] } });
  });

  it("counts a command an agent issued once, even when it fans out", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      trace: trace(),
    });
    await executeBrowserCommand(
      {
        type: "page.record",
        tabId: null,
        operation: { kind: "trace-start", screenshots: false },
      },
      harness.deps,
    );

    // `navigation.open --new-tab` runs the tab-opening command internally; two
    // steps here would be the trace describing work nobody asked for.
    await executeBrowserCommand(
      {
        type: "navigation.open",
        tabId: null,
        url: "https://example.com/",
        newTab: true,
      },
      harness.deps,
    );

    const stopped = await executeBrowserCommand(
      { type: "page.record", tabId: null, operation: { kind: "trace-stop" } },
      harness.deps,
    );
    expect(stopped).toMatchObject({
      ok: true,
      value: { steps: [{ command: "navigation.open" }] },
    });
  });

  it("attaches a picture of the visible tab after a step that could change it", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      trace: trace(),
      observe: {
        ok: true,
        kind: "screenshot",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        mimeType: "image/jpeg",
        base64: "AAAA",
        width: 800,
        height: 600,
      },
    });
    await executeBrowserCommand(
      {
        type: "page.record",
        tabId: null,
        operation: { kind: "trace-start", screenshots: true },
      },
      harness.deps,
    );

    await executeBrowserCommand({ type: "tabs.list" }, harness.deps);
    await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: { action: "hover", ref: "e1" },
      },
      harness.deps,
    );

    const stopped = await executeBrowserCommand(
      { type: "page.record", tabId: null, operation: { kind: "trace-stop" } },
      harness.deps,
    );
    // A picture after `tabs.list` would be a picture of nothing happening.
    expect(stopped).toMatchObject({
      ok: true,
      value: {
        steps: [
          { command: "tabs.list", image: null },
          { command: "page.interact", image: "AAAA" },
        ],
      },
    });
    expect(harness.calls.observations).toEqual([
      {
        tabId: "t",
        observation: { kind: "screenshot", format: "jpeg", quality: 50 },
      },
    ]);
  });

  it("leaves the step without a picture rather than failing the step", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      trace: trace(),
      observe: { ok: false, reason: "failed" },
    });
    await executeBrowserCommand(
      {
        type: "page.record",
        tabId: null,
        operation: { kind: "trace-start", screenshots: true },
      },
      harness.deps,
    );

    await executeBrowserCommand(
      {
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: { action: "hover", ref: "e1" },
      },
      harness.deps,
    );

    await expect(
      executeBrowserCommand(
        { type: "page.record", tabId: null, operation: { kind: "trace-stop" } },
        harness.deps,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { steps: [{ command: "page.interact", ok: true, image: null }] },
    });
  });

  it("refuses a second trace, and a stop with nothing running", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      trace: trace(),
    });

    await expect(
      executeBrowserCommand(
        { type: "page.record", tabId: null, operation: { kind: "trace-stop" } },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: false, code: "not_recording" });
    await executeBrowserCommand(
      {
        type: "page.record",
        tabId: null,
        operation: { kind: "trace-start", screenshots: false },
      },
      harness.deps,
    );
    await expect(
      executeBrowserCommand(
        {
          type: "page.record",
          tabId: null,
          operation: { kind: "trace-start", screenshots: false },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: false, code: "already_recording" });
  });

  it("starts a trace with no tab open, because it is not about a tab", async () => {
    const harness = createHarness({ trace: trace() });

    await expect(
      executeBrowserCommand(
        {
          type: "page.record",
          tabId: null,
          operation: { kind: "trace-start", screenshots: false },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: { type: "recording", recording: "trace", active: true },
    });
  });

  it("sends the video half to the shell and answers with its frames", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      record: {
        ok: true,
        kind: "video",
        tabId: "t",
        url: "https://example.com/",
        title: "Example",
        frames: [{ at: 0, base64: "AAAA" }],
        chapters: [{ at: 10, title: "signed in" }],
        droppedFrames: 12,
        durationMs: 900,
      },
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.record",
          tabId: null,
          operation: { kind: "video-stop" },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        type: "video",
        frames: [{ at: 0, base64: "AAAA" }],
        droppedFrames: 12,
        durationMs: 900,
      },
    });
    expect(harness.calls.record).toEqual([
      { tabId: "t", operation: { kind: "video-stop" } },
    ]);
  });

  it("maps the shell's filming refusals onto codes an agent can act on", async () => {
    const cases = [
      ["no-page", "tab_not_live"],
      ["already-recording", "already_recording"],
      ["not-recording", "not_recording"],
      ["debugger-unavailable", "debugger_unavailable"],
    ] as const;

    for (const [reason, code] of cases) {
      const harness = createHarness({
        state: { tabs: [tab("t")], activeTabId: "t" },
        live: { t: liveState("t") },
        record: { ok: false, reason, message: "because" },
      });

      await expect(
        executeBrowserCommand(
          {
            type: "page.record",
            tabId: null,
            operation: { kind: "video-start", fps: 5 },
          },
          harness.deps,
        ),
      ).resolves.toMatchObject({ ok: false, code });
    }
  });

  it("reports an older shell that cannot film, and a session that keeps no trace", async () => {
    const harness = createHarness({
      state: { tabs: [tab("t")], activeTabId: "t" },
      live: { t: liveState("t") },
      omitRecord: true,
    });

    await expect(
      executeBrowserCommand(
        {
          type: "page.record",
          tabId: null,
          operation: { kind: "video-start", fps: 5 },
        },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: false, code: "unsupported_command" });
    // No recorder in the deps at all: tracing is unavailable rather than idle.
    await expect(
      executeBrowserCommand(
        { type: "page.record", tabId: null, operation: { kind: "trace-stop" } },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: false, code: "unsupported_command" });
  });
});

describe("page.zoom", () => {
  const state = {
    activeTabId: "t1",
    tabs: [tab("t1", "https://example.com/")],
  } satisfies BrowserSurfaceTabsState;

  it("asks the shell to scale the active tab and reports the factor", async () => {
    const harness = createHarness({ state });

    await expect(
      executeBrowserCommand(
        { type: "page.zoom", tabId: null, factor: 1.25 },
        harness.deps,
      ),
    ).resolves.toEqual({ ok: true, value: { type: "zoom", factor: 1.25 } });
    expect(harness.calls.zoom).toEqual([{ tabId: "t1", factor: 1.25 }]);
  });

  // A plugin can ask for anything, and the wire refuses it before the executor
  // ever sees it. Refusing with a message beats quietly applying something else
  // and reporting that as if it had been asked for.
  it("refuses a factor outside the range rather than clamping it", async () => {
    const harness = createHarness({ state });

    await expect(
      executeBrowserCommand(
        { type: "page.zoom", tabId: null, factor: 99 },
        harness.deps,
      ),
    ).resolves.toMatchObject({ ok: false, code: "invalid_command" });
    expect(harness.calls.zoom).toEqual([]);
  });

  // Version skew: a shell that predates the zoom channel. Saying so beats
  // reporting a factor that nothing applied.
  it("says the desktop build cannot zoom rather than pretending", async () => {
    const harness = createHarness({ state, omitSetZoom: true });

    expectFailure(
      await executeBrowserCommand(
        { type: "page.zoom", tabId: null, factor: 1.5 },
        harness.deps,
      ),
      "desktop_unavailable",
    );
  });
});
