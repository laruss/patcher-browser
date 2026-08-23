import {
  browserCommandSchema,
  type BrowserRecordOperation,
  type BrowserCommand,
  type BrowserCommandErrorCode,
  type BrowserCommandOutcome,
  type BrowserCommandValue,
  type BrowserTabSnapshot,
} from "@patcher/domain";
import type {
  PatcherDesktopBrowserApi,
  PatcherDesktopBrowserCaptureFullPageResult,
  PatcherDesktopBrowserControlResult,
  PatcherDesktopBrowserRecordResult,
  PatcherDesktopBrowserInteractResult,
  PatcherDesktopBrowserObserveResult,
  PatcherDesktopBrowserPageReadResult,
  PatcherDesktopBrowserSnapshotResult,
  PatcherDesktopBrowserState,
  PatcherDesktopBrowserStorageResult,
} from "@patcher/desktop-contract";
import type { BrowserFixedPanelTab } from "../fixed-panel-tabs-state";
import { normalizeBrowserUrl } from "../browser-url";
import {
  BROWSER_TRACE_SCREENSHOT_QUALITY,
  browserCommandChangesPage,
  type BrowserTraceRecorder,
} from "./trace";
import {
  BROWSER_SURFACE_NEW_TAB_URL,
  activateBrowserSurfaceTab,
  addBrowserSurfaceTab,
  closeBrowserSurfaceTab,
  createBrowserSurfaceTab,
  duplicateBrowserSurfaceTab,
  getActiveBrowserSurfaceWebTab,
  getBrowserSurfaceWebTabs,
  moveBrowserSurfaceTab,
  setBrowserSurfaceTabPinned,
  updateBrowserSurfaceTab,
  type BrowserSurfaceTabsState,
} from "../browser-surface-tabs";

/**
 * Performing one agent browser command against the browser surface.
 *
 * Everything here is a plain function over its dependencies — no React, no
 * module singletons — for the same reason the tab reducers are: the rules worth
 * getting right (which tab, is it live, what does a failure tell the caller to
 * do next) are worth testing without a rendered component.
 *
 * The tab reducers are reused rather than re-implemented, so an agent closing
 * the focused tab hands focus onwards exactly as a user's click does.
 */

export interface BrowserCommandDeps {
  /**
   * A fresh read, not a render snapshot: an agent issuing `tabs.open` then
   * `tabs.activate` in one turn must see its own first write.
   */
  getState: () => BrowserSurfaceTabsState;
  applyState: (
    update: (current: BrowserSurfaceTabsState) => BrowserSurfaceTabsState,
  ) => void;
  /** Null on the web build, where there is no browser at all. */
  desktopBrowser: PatcherDesktopBrowserApi | null;
  getLiveState: (tabId: string) => PatcherDesktopBrowserState | null;
  waitForSettled: (tabId: string) => Promise<{ timedOut: boolean }>;
  /** Seam so tests get predictable tab ids. */
  createTab?: (url: string) => BrowserFixedPanelTab;
  /**
   * Record which tabs are muted, so the strip marks them and the mute outlives a
   * renderer reload (see `browser-tab-mute.ts`). A seam like
   * {@link BrowserCommandDeps.destroyView}: absent means only the shell is told,
   * which is what tests want.
   */
  recordMuted?: (args: { muted: boolean; tabId: string }) => void;
  /** Called when a tab is closed, so its native view is torn down too. */
  destroyView?: (args: {
    desktopBrowser: PatcherDesktopBrowserApi;
    tabId: string;
  }) => void;
  /**
   * Ask plugins for the text of a PDF the browser read but found no text in
   * (`browser.pdf.textProviders`). A seam like the others: absent means no
   * plugin is consulted at all, which is what the web build and most tests
   * want. Resolves null when nobody answered.
   */
  resolvePdfText?: (args: {
    pageUrl: string;
    tabId: string;
    title: string | null;
  }) => Promise<string | null>;
  /**
   * Where the session's trace is kept, when the bridge holds one. Absent here
   * means tracing is simply unavailable rather than idle.
   */
  trace?: BrowserTraceRecorder;
  /** Seam so a trace's timings are predictable in tests. */
  now?: () => number;
}

function now(deps: BrowserCommandDeps): number {
  return (deps.now ?? Date.now)();
}

function failure(
  code: BrowserCommandErrorCode,
  message: string,
): BrowserCommandOutcome {
  return { ok: false, code, message };
}

function success(value: BrowserCommandValue): BrowserCommandOutcome {
  return { ok: true, value };
}

function toSnapshot(
  tab: BrowserFixedPanelTab,
  state: BrowserSurfaceTabsState,
  live: PatcherDesktopBrowserState | null,
): BrowserTabSnapshot {
  return {
    tabId: tab.id,
    // Live state is the truth while it exists — the persisted tab lags a
    // redirect until the shell's push lands.
    url: live?.url ?? tab.url,
    title: live?.title ?? tab.title,
    active: state.activeTabId === tab.id,
    live: live !== null,
    loading: live?.isLoading ?? false,
    canGoBack: live?.canGoBack ?? false,
    canGoForward: live?.canGoForward ?? false,
  };
}

function snapshotAll(
  state: BrowserSurfaceTabsState,
  deps: BrowserCommandDeps,
): BrowserTabSnapshot[] {
  // Web tabs only, here and in `resolveTab`. The strip also carries Patcher's own
  // screens (Settings, Extensions, a plugin's panel), and those have no page for
  // an agent to read, navigate or screenshot — listing them would be offering
  // tools that cannot work on them.
  return getBrowserSurfaceWebTabs(state).map((tab) =>
    toSnapshot(tab, state, deps.getLiveState(tab.id)),
  );
}

interface ResolvedTab {
  tab: BrowserFixedPanelTab;
  state: BrowserSurfaceTabsState;
}

type Resolution =
  | { ok: true; resolved: ResolvedTab }
  | { ok: false; outcome: BrowserCommandOutcome };

/** A null tabId means the active tab, everywhere it appears. */
function resolveTab(
  tabId: string | null,
  deps: BrowserCommandDeps,
): Resolution {
  const state = deps.getState();
  if (tabId === null) {
    const active = getActiveBrowserSurfaceWebTab(state);
    if (active === null) {
      return {
        ok: false,
        outcome: failure(
          "no_active_tab",
          "No browser tab is open. Open one with browser_tabs_open first.",
        ),
      };
    }
    return { ok: true, resolved: { tab: active, state } };
  }
  const tab = getBrowserSurfaceWebTabs(state).find(
    (candidate) => candidate.id === tabId,
  );
  if (tab === undefined) {
    return {
      ok: false,
      outcome: failure(
        "unknown_tab",
        `No browser tab with id ${JSON.stringify(tabId)} is open. Call browser_tabs_list to see the open tabs.`,
      ),
    };
  }
  return { ok: true, resolved: { tab, state } };
}

const NOT_LIVE_HINT =
  "Open the Browser surface in the Patcher desktop app and select that tab, then try again.";

/** Maps the shell's typed refusals onto the codes the agent tools speak. */
function pageReadFailure(
  result: Extract<PatcherDesktopBrowserPageReadResult, { ok: false }>,
  tabId: string,
): BrowserCommandOutcome {
  switch (result.reason) {
    case "no-view":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has no live page. ${NOT_LIVE_HINT}`,
      );
    case "no-page":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has not loaded a page yet.`,
      );
    case "timeout":
      return failure(
        "page_read_timeout",
        `The page in browser tab ${tabId} did not respond in time.`,
      );
    default:
      return failure(
        "page_read_failed",
        `The page in browser tab ${tabId} could not be read.`,
      );
  }
}

/** Maps the shell's snapshot refusals onto the codes the agent tools speak. */
function snapshotFailure(
  result: Extract<PatcherDesktopBrowserSnapshotResult, { ok: false }>,
  tabId: string,
): BrowserCommandOutcome {
  switch (result.reason) {
    case "no-view":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has no live page. ${NOT_LIVE_HINT}`,
      );
    case "no-page":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has not loaded a page yet.`,
      );
    case "debugger-unavailable":
      return failure(
        "debugger_unavailable",
        `The browser debugger could not attach to tab ${tabId}${
          result.message === undefined ? "" : ` (${result.message})`
        }. Close DevTools for that tab and try again.`,
      );
    case "invalid-selector":
      return failure(
        "invalid_selector",
        `That is not a CSS selector the browser can parse${
          result.message === undefined ? "" : ` (${result.message})`
        }.`,
      );
    case "no-match":
      return failure(
        "no_match",
        result.message ?? "Nothing on the page matches that selector.",
      );
    default:
      return failure(
        "page_read_failed",
        `The page in browser tab ${tabId} could not be inspected.`,
      );
  }
}

/** Maps the shell's interaction refusals onto the codes the agent tools speak. */
function interactFailure(
  result: Extract<PatcherDesktopBrowserInteractResult, { ok: false }>,
  tabId: string,
): BrowserCommandOutcome {
  const detail = result.message === undefined ? "" : ` ${result.message}`;
  switch (result.reason) {
    case "no-view":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has no live page. ${NOT_LIVE_HINT}`,
      );
    case "no-page":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has not loaded a page yet.`,
      );
    case "debugger-unavailable":
      return failure(
        "debugger_unavailable",
        `The browser debugger could not attach to tab ${tabId}${detail}. Close DevTools for that tab and try again.`,
      );
    case "stale-refs":
      return failure(
        "stale_refs",
        `Those element refs are out of date.${detail}`,
      );
    case "unknown-ref":
      return failure("unknown_ref", `No such element.${detail}`);
    case "not-actionable":
      return failure(
        "not_actionable",
        `The element could not be acted on.${detail}`,
      );
    case "unsupported-key":
      return failure("unsupported_key", `That key cannot be pressed.${detail}`);
    default:
      return failure(
        "page_read_failed",
        `The browser could not perform that action.${detail}`,
      );
  }
}

/**
 * Maps the shell's observation refusals onto the codes the agent tools speak.
 *
 * Shared with the full-page capture, whose refusals are the same list plus
 * `debugger-unavailable` — the one thing it can hit that a viewport capture
 * cannot, because it is the one capture that needs the debugger.
 */
function observeFailure(
  result: Extract<
    | PatcherDesktopBrowserObserveResult
    | PatcherDesktopBrowserCaptureFullPageResult,
    { ok: false }
  >,
  tabId: string,
): BrowserCommandOutcome {
  const detail = result.message === undefined ? "" : ` ${result.message}`;
  switch (result.reason) {
    case "no-view":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has no live page. ${NOT_LIVE_HINT}`,
      );
    case "no-page":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has not loaded a page yet.`,
      );
    case "debugger-unavailable":
      return failure(
        "debugger_unavailable",
        `The browser debugger could not attach to tab ${tabId}${detail}. Close DevTools for that tab and try again, or ask for the visible viewport instead.`,
      );
    case "too-large":
      return failure(
        "result_too_large",
        `That is too large to return.${detail}`,
      );
    default:
      return failure(
        "page_read_failed",
        `The browser could not look at tab ${tabId}.${detail}`,
      );
  }
}

/** Maps the shell's storage refusals onto the codes the agent tools speak. */
function storageFailure(
  result: Extract<PatcherDesktopBrowserStorageResult, { ok: false }>,
  tabId: string,
): BrowserCommandOutcome {
  const detail = result.message === undefined ? "" : ` ${result.message}`;
  switch (result.reason) {
    case "no-view":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has no live page. ${NOT_LIVE_HINT}`,
      );
    case "no-page":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has not loaded a page yet, so it has no cookies or storage of its own.`,
      );
    case "timeout":
      return failure(
        "page_read_timeout",
        `The page in browser tab ${tabId} did not respond in time.`,
      );
    default:
      return failure(
        "page_read_failed",
        `The browser could not reach that tab's storage.${detail}`,
      );
  }
}

/** Maps the shell's direct-control refusals onto the agent tools' codes. */
function controlFailure(
  result: Extract<PatcherDesktopBrowserControlResult, { ok: false }>,
  tabId: string,
): BrowserCommandOutcome {
  const detail = result.message === undefined ? "" : ` ${result.message}`;
  switch (result.reason) {
    case "no-view":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has no live page. ${NOT_LIVE_HINT}`,
      );
    case "no-page":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has not loaded a page yet.`,
      );
    case "debugger-unavailable":
      return failure(
        "debugger_unavailable",
        `The browser debugger could not attach to tab ${tabId}${detail}. Close DevTools for that tab and try again.`,
      );
    case "stale-refs":
      return failure(
        "stale_refs",
        `Those element refs are out of date.${detail}`,
      );
    case "unknown-ref":
      return failure("unknown_ref", `No such element.${detail}`);
    case "evaluation-failed":
      // The page's own error text, kept whole: it is the only thing that says
      // what to change about the expression.
      return failure("evaluation_failed", `The page threw.${detail}`);
    case "too-many-routes":
      return failure(
        "too_many_routes",
        `That tab holds too many routes.${detail}`,
      );
    default:
      return failure(
        "page_read_failed",
        `The browser could not drive tab ${tabId}.${detail}`,
      );
  }
}

/** Maps the shell's filming refusals onto the codes the agent tools speak. */
function recordFailure(
  result: Extract<PatcherDesktopBrowserRecordResult, { ok: false }>,
  tabId: string,
): BrowserCommandOutcome {
  const detail = result.message === undefined ? "" : ` ${result.message}`;
  switch (result.reason) {
    case "no-view":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has no live page. ${NOT_LIVE_HINT}`,
      );
    case "no-page":
      return failure(
        "tab_not_live",
        `Browser tab ${tabId} has not loaded a page yet, so there is nothing to film.`,
      );
    case "debugger-unavailable":
      return failure(
        "debugger_unavailable",
        `The browser debugger could not attach to tab ${tabId}${detail}. Close DevTools for that tab and try again.`,
      );
    case "already-recording":
      return failure(
        "already_recording",
        `That tab is already being filmed.${detail}`,
      );
    case "not-recording":
      return failure("not_recording", `That tab is not being filmed.${detail}`);
    default:
      return failure(
        "page_read_failed",
        `The browser could not film tab ${tabId}.${detail}`,
      );
  }
}

/**
 * The half of `page.record` the app answers itself. The video half is the
 * shell's; see the note on `browserRecordOperationSchema` for why the two halves
 * of one command live in different processes.
 */
function runTraceOperation(
  operation: Extract<
    BrowserRecordOperation,
    { kind: "trace-start" | "trace-stop" }
  >,
  deps: BrowserCommandDeps,
): BrowserCommandOutcome {
  const trace = deps.trace;
  if (trace === undefined) {
    return failure(
      "unsupported_command",
      "This browser session keeps no trace.",
    );
  }
  if (operation.kind === "trace-start") {
    if (!trace.start(now(deps), operation.screenshots)) {
      return failure(
        "already_recording",
        "A trace is already running. Stop it first, which is also how you read it.",
      );
    }
    return success({ type: "recording", recording: "trace", active: true });
  }
  const stopped = trace.stop(now(deps));
  if (stopped === null) {
    return failure("not_recording", "No trace is running.");
  }
  return success({ type: "trace", ...stopped });
}

/**
 * A picture of what the user would be looking at, for the step just taken.
 *
 * The active tab, and only it: a `WebContentsView` that is not the visible one
 * has nothing composited to capture, so a picture of the tab a background
 * command addressed would come back empty anyway. A capture that fails leaves
 * the step without an image rather than failing the step — the command already
 * happened.
 */
async function captureTraceImage(
  deps: BrowserCommandDeps,
): Promise<string | null> {
  const observe = deps.desktopBrowser?.observe;
  const active = getActiveBrowserSurfaceWebTab(deps.getState());
  if (observe === undefined || active === null) {
    return null;
  }
  const result = await observe({
    tabId: active.id,
    observation: {
      kind: "screenshot",
      format: "jpeg",
      quality: BROWSER_TRACE_SCREENSHOT_QUALITY,
    },
  }).catch(() => null);
  return result !== null && result.ok && result.kind === "screenshot"
    ? result.base64
    : null;
}

async function recordTraceStep(
  command: BrowserCommand,
  outcome: BrowserCommandOutcome,
  deps: BrowserCommandDeps,
): Promise<void> {
  const trace = deps.trace;
  // A trace does not record the commands that control it.
  if (trace === undefined || !trace.active || command.type === "page.record") {
    return;
  }
  const image =
    trace.wantsScreenshots && browserCommandChangesPage(command)
      ? await captureTraceImage(deps)
      : null;
  trace.record(command, outcome, image, now(deps));
}

async function readPage(
  tabId: string,
  desktopBrowser: PatcherDesktopBrowserApi,
): Promise<
  | {
      ok: true;
      content: Extract<PatcherDesktopBrowserPageReadResult, { ok: true }>;
    }
  | { ok: false; outcome: BrowserCommandOutcome }
> {
  // Feature-detected: an older desktop shell has no read-page channel at all.
  if (desktopBrowser.readPage === undefined) {
    return {
      ok: false,
      outcome: failure(
        "unsupported_command",
        "This version of the Patcher desktop app cannot read page content.",
      ),
    };
  }
  // Let the shell answer rather than pre-checking liveness here: it is the only
  // side that authoritatively knows which views exist.
  const result = await desktopBrowser.readPage(tabId);
  if (!result.ok) {
    return { ok: false, outcome: pageReadFailure(result, tabId) };
  }
  return { ok: true, content: result };
}

export async function executeBrowserCommand(
  rawCommand: unknown,
  deps: BrowserCommandDeps,
): Promise<BrowserCommandOutcome> {
  // The command originated from a language model, so it is parsed like any
  // other untrusted payload rather than trusted for having come from Patcher.
  const parsed = browserCommandSchema.safeParse(rawCommand);
  if (!parsed.success) {
    return failure(
      "invalid_command",
      `Unrecognized browser command: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  const command: BrowserCommand = parsed.data;
  const outcome = await runBrowserCommand(command, deps);
  // After, not around: a trace records what happened, and the picture worth
  // keeping is of the page the command left behind.
  await recordTraceStep(command, outcome, deps);
  return outcome;
}

async function runBrowserCommand(
  command: BrowserCommand,
  deps: BrowserCommandDeps,
): Promise<BrowserCommandOutcome> {
  // Tab bookkeeping is renderer state and answers anywhere, including the web
  // build. Everything below the second switch touches a real page and needs the
  // desktop shell, which is why the guard sits between them rather than being
  // repeated in each branch.
  switch (command.type) {
    case "tabs.list": {
      const state = deps.getState();
      return success({ type: "tabs", tabs: snapshotAll(state, deps) });
    }

    case "page.get_url": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      return success({
        type: "url",
        url: deps.getLiveState(tab.id)?.url ?? tab.url,
      });
    }

    case "page.get_title": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      const live = deps.getLiveState(tab.id);
      return success({ type: "title", title: live?.title ?? tab.title });
    }
  }

  const desktopBrowser = deps.desktopBrowser;
  if (desktopBrowser === null) {
    return failure(
      "desktop_unavailable",
      "Browser control needs the Patcher desktop app; this session is running in a web browser.",
    );
  }

  switch (command.type) {
    case "tabs.open": {
      let url = BROWSER_SURFACE_NEW_TAB_URL;
      if (command.url !== null && command.url.length > 0) {
        const normalized = normalizeBrowserUrl(command.url);
        if (normalized === null) {
          return failure(
            "blocked_url",
            `${JSON.stringify(command.url)} is not an http(s) address the browser can open.`,
          );
        }
        url = normalized;
      }
      const tab = (deps.createTab ?? createBrowserSurfaceTab)(url);
      deps.applyState((current) => {
        const opened = addBrowserSurfaceTab(current, tab);
        // addBrowserSurfaceTab always focuses the new tab; put focus back when
        // the caller asked for a background tab.
        return command.activate
          ? opened
          : { ...opened, activeTabId: current.activeTabId ?? tab.id };
      });
      const state = deps.getState();
      return success({
        type: "tab",
        tab: toSnapshot(tab, state, deps.getLiveState(tab.id)),
      });
    }

    case "tabs.close": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      // Deletion owns detach. Dropping the tab from the store alone would leak
      // a live WebContentsView, because the deck only reaps vanished tabs while
      // it is mounted — and an agent can close a tab from any route.
      deps.destroyView?.({ desktopBrowser, tabId: tab.id });
      deps.applyState((current) => closeBrowserSurfaceTab(current, tab.id));
      const state = deps.getState();
      return success({
        type: "closed",
        closedTabId: tab.id,
        tabs: snapshotAll(state, deps),
      });
    }

    case "tabs.activate": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      deps.applyState((current) => activateBrowserSurfaceTab(current, tab.id));
      const state = deps.getState();
      return success({
        type: "tab",
        tab: toSnapshot(tab, state, deps.getLiveState(tab.id)),
      });
    }

    case "tabs.pin": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      deps.applyState((current) =>
        setBrowserSurfaceTabPinned(current, {
          pinned: command.pinned,
          tabId: tab.id,
        }),
      );
      const state = deps.getState();
      return success({
        type: "tab",
        tab: toSnapshot(tab, state, deps.getLiveState(tab.id)),
      });
    }

    case "tabs.mute": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      const setMuted = desktopBrowser.setMuted;
      if (setMuted === undefined) {
        return failure(
          "desktop_unavailable",
          "This Patcher desktop build cannot mute a tab.",
        );
      }
      setMuted({ muted: command.muted, tabId: tab.id });
      deps.recordMuted?.({ muted: command.muted, tabId: tab.id });
      const state = deps.getState();
      return success({
        type: "tab",
        tab: toSnapshot(tab, state, deps.getLiveState(tab.id)),
      });
    }

    case "tabs.duplicate": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      const duplicate = (deps.createTab ?? createBrowserSurfaceTab)(tab.url);
      deps.applyState((current) =>
        duplicateBrowserSurfaceTab(current, {
          sourceTabId: tab.id,
          tab: duplicate,
        }),
      );
      const state = deps.getState();
      return success({
        type: "tab",
        tab: toSnapshot(duplicate, state, deps.getLiveState(duplicate.id)),
      });
    }

    case "tabs.move": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      deps.applyState((current) =>
        moveBrowserSurfaceTab(current, {
          tabId: tab.id,
          toIndex: command.toIndex,
        }),
      );
      const state = deps.getState();
      return success({
        type: "tab",
        tab: toSnapshot(tab, state, deps.getLiveState(tab.id)),
      });
    }

    case "page.get_text": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      const read = await readPage(tab.id, desktopBrowser);
      if (!read.ok) {
        return read.outcome;
      }
      // A PDF the shell read but found nothing in is a scan: pages of images
      // with no text layer, which no amount of re-reading turns into words.
      // That is the one case worth handing to a plugin, because reading it
      // needs something the browser does not have (an OCR pass, a document
      // service), and the one case where asking costs nothing — the built-in
      // read has already come back empty.
      const isEmptyPdf =
        read.content.contentKind === "pdf" && read.content.text.length === 0;
      const full =
        isEmptyPdf && deps.resolvePdfText !== undefined
          ? ((await deps.resolvePdfText({
              pageUrl: read.content.url,
              tabId: tab.id,
              title: read.content.title,
            })) ?? "")
          : read.content.text;
      if (full.length === 0 && read.content.contentKind === "pdf") {
        // Not an empty success: "" would read as a blank document, and the
        // difference between "this PDF says nothing" and "this PDF is a
        // picture of text" is the whole answer an agent needs here.
        return failure(
          "page_read_failed",
          `Browser tab ${tab.id} is a PDF with no text layer — a scan, or images of text. Nothing could be read from it as text.`,
        );
      }
      const text = full.slice(0, command.maxLength);
      return success({
        type: "text",
        text,
        truncated: read.content.textTruncated || text.length < full.length,
      });
    }

    case "page.handle_dialog": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      if (desktopBrowser.respondToDialog === undefined) {
        return failure(
          "unsupported_command",
          "This version of the Patcher desktop app cannot answer page dialogs.",
        );
      }
      const answered = await desktopBrowser.respondToDialog({
        tabId: tab.id,
        accept: command.accept,
        ...(command.promptText === null
          ? {}
          : { promptText: command.promptText }),
      });
      // False is not an error: the user may simply have answered it first.
      return success({ type: "answered", answered });
    }

    case "page.snapshot": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      // Feature-detected like readPage: a shell predating the browser debugger
      // has no such channel at all. Scoping rides its own channel, so it is
      // detected separately — an older shell can snapshot a page but not a part
      // of one, and saying that is better than snapshotting the whole thing.
      if (desktopBrowser.snapshot === undefined) {
        return failure(
          "unsupported_command",
          "This version of the Patcher desktop app cannot snapshot pages.",
        );
      }
      const depth =
        command.maxDepth === null ? {} : { maxDepth: command.maxDepth };
      let result: PatcherDesktopBrowserSnapshotResult;
      if (command.selector === null) {
        result = await desktopBrowser.snapshot({ tabId: tab.id, ...depth });
      } else {
        if (desktopBrowser.snapshotIn === undefined) {
          return failure(
            "unsupported_command",
            "This version of the Patcher desktop app cannot snapshot part of a page. Snapshot the whole page instead.",
          );
        }
        result = await desktopBrowser.snapshotIn({
          tabId: tab.id,
          selector: command.selector,
          ...depth,
        });
      }
      if (!result.ok) {
        return snapshotFailure(result, tab.id);
      }
      return success({
        type: "snapshot",
        tabId: result.tabId,
        url: result.url,
        title: result.title,
        snapshot: result.snapshot,
        generation: result.generation,
        refCount: result.refCount,
        truncated: result.truncated,
      });
    }

    case "page.interact": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      if (desktopBrowser.interact === undefined) {
        return failure(
          "unsupported_command",
          "This version of the Patcher desktop app cannot act on pages.",
        );
      }
      const result = await desktopBrowser.interact({
        tabId: tab.id,
        ...(command.generation === null
          ? {}
          : { generation: command.generation }),
        interaction: command.interaction,
      });
      if (!result.ok) {
        return interactFailure(result, tab.id);
      }
      // A click that navigated has already produced a load-started push by the
      // time the shell answers — both travel the same main → renderer pipe, so
      // the push is queued ahead of the reply. A navigation the page starts
      // *later* (a timer, a fetch that then redirects) is not covered, which is
      // why the tool instructions tell the model to re-snapshot after acting.
      //
      // The shell read the URL at the moment the action finished, so that is
      // the answer unless we then waited out a load — in which case the state
      // the tab settled on is the newer of the two.
      let ended: { url: string; title: string | null } = result;
      if (deps.getLiveState(tab.id)?.isLoading === true) {
        await deps.waitForSettled(tab.id);
        ended = deps.getLiveState(tab.id) ?? result;
      }
      return success({
        type: "interacted",
        tabId: result.tabId,
        url: ended.url,
        title: ended.title,
      });
    }

    case "page.observe": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      if (desktopBrowser.observe === undefined) {
        return failure(
          "unsupported_command",
          "This version of the Patcher desktop app cannot capture or inspect pages.",
        );
      }
      // A full-page capture is a different channel and a different mechanism,
      // so it is decided here rather than forwarded. This is also why the
      // screenshot observation is rebuilt below instead of being passed
      // through: the shell's union has no `fullPage`, and would drop it.
      if (
        command.observation.kind === "screenshot" &&
        command.observation.fullPage
      ) {
        if (desktopBrowser.captureFullPage === undefined) {
          return failure(
            "unsupported_command",
            "This version of the Patcher desktop app cannot capture a whole page — ask for the visible viewport instead.",
          );
        }
        const captured = await desktopBrowser.captureFullPage({
          tabId: tab.id,
          format: command.observation.format,
          quality: command.observation.quality,
        });
        if (!captured.ok) {
          return observeFailure(captured, tab.id);
        }
        return success({
          type: "image",
          tabId: captured.tabId,
          url: captured.url,
          title: captured.title,
          mimeType: captured.mimeType,
          base64: captured.base64,
          width: captured.width,
          height: captured.height,
          fullPage: true,
          truncated: captured.truncated,
        });
      }
      const result = await desktopBrowser.observe({
        tabId: tab.id,
        observation:
          command.observation.kind === "screenshot"
            ? {
                kind: "screenshot",
                format: command.observation.format,
                quality: command.observation.quality,
              }
            : command.observation,
      });
      if (!result.ok) {
        return observeFailure(result, tab.id);
      }
      // The shell's four success shapes map one-to-one onto four result
      // variants; the `kind`/`type` rename is the only difference, and doing it
      // here keeps the agent-facing vocabulary independent of the shell's.
      const page = {
        tabId: result.tabId,
        url: result.url,
        title: result.title,
      };
      switch (result.kind) {
        case "screenshot":
          return success({
            type: "image",
            ...page,
            mimeType: result.mimeType,
            base64: result.base64,
            width: result.width,
            height: result.height,
            fullPage: false,
            // The viewport is not a cut-off document; it is a different
            // question. Only a full-page capture can come back short.
            truncated: false,
          });
        case "pdf":
          return success({
            type: "pdf",
            ...page,
            base64: result.base64,
            byteLength: result.byteLength,
          });
        case "console":
          return success({
            type: "console",
            ...page,
            entries: result.entries,
            droppedCount: result.droppedCount,
          });
        default:
          return success({
            type: "network",
            ...page,
            entries: result.entries,
            droppedCount: result.droppedCount,
          });
      }
    }

    case "page.storage": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      if (desktopBrowser.storage === undefined) {
        return failure(
          "unsupported_command",
          "This version of the Patcher desktop app cannot read or write browser storage.",
        );
      }
      const result = await desktopBrowser.storage({
        tabId: tab.id,
        operation: command.operation,
      });
      if (!result.ok) {
        return storageFailure(result, tab.id);
      }
      switch (result.kind) {
        case "cookies":
          return success({
            type: "cookies",
            tabId: result.tabId,
            url: result.url,
            title: result.title,
            cookies: result.cookies,
          });
        case "items":
          return success({
            type: "storage",
            tabId: result.tabId,
            url: result.url,
            title: result.title,
            area: result.area,
            items: result.items,
            truncated: result.truncated,
          });
        case "written":
          return success({
            type: "written",
            applied: result.applied,
            rejected: result.rejected,
          });
        default:
          return success({ type: "removed", removed: result.removed });
      }
    }

    case "page.control": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      if (desktopBrowser.control === undefined) {
        return failure(
          "unsupported_command",
          "This version of the Patcher desktop app cannot evaluate scripts, mock requests or act by coordinate.",
        );
      }
      const result = await desktopBrowser.control({
        tabId: tab.id,
        ...(command.generation === null
          ? {}
          : { generation: command.generation }),
        operation: command.operation,
      });
      if (!result.ok) {
        return controlFailure(result, tab.id);
      }
      const page = {
        tabId: result.tabId,
        url: result.url,
        title: result.title,
      };
      switch (result.kind) {
        case "evaluated":
          return success({
            type: "evaluated",
            ...page,
            value: result.value,
            truncated: result.truncated,
          });
        case "routes":
          return success({
            type: "routes",
            ...page,
            routes: result.routes,
            offline: result.offline,
          });
        default:
          // A coordinate click can navigate exactly as a ref click can, so it
          // answers with where the tab ended up, under the same variant.
          return success({ type: "interacted", ...page });
      }
    }

    case "page.record": {
      const operation = command.operation;
      if (operation.kind === "trace-start" || operation.kind === "trace-stop") {
        return runTraceOperation(operation, deps);
      }
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      if (desktopBrowser.record === undefined) {
        return failure(
          "unsupported_command",
          "This version of the Patcher desktop app cannot film a tab.",
        );
      }
      const result = await desktopBrowser.record({
        tabId: tab.id,
        operation,
      });
      if (!result.ok) {
        return recordFailure(result, tab.id);
      }
      if (result.kind === "video") {
        return success({
          type: "video",
          tabId: result.tabId,
          url: result.url,
          title: result.title,
          frames: result.frames,
          chapters: result.chapters,
          droppedFrames: result.droppedFrames,
          durationMs: result.durationMs,
        });
      }
      return success({
        type: "recording",
        recording: "video",
        active: result.active,
      });
    }

    case "page.get_selection": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      const read = await readPage(tab.id, desktopBrowser);
      if (!read.ok) {
        return read.outcome;
      }
      return success({
        type: "text",
        text: read.content.selection,
        truncated: read.content.selectionTruncated,
      });
    }

    case "navigation.open": {
      // Deliberately not resolveBrowserAddressInput: the omnibox's silent
      // fall-through to a web search is right for a human typing and wrong for
      // an agent that passed a malformed URL and should be told so.
      const url = normalizeBrowserUrl(command.url);
      if (url === null) {
        return failure(
          "blocked_url",
          `${JSON.stringify(command.url)} is not an http(s) address the browser can open.`,
        );
      }
      if (command.newTab) {
        // Straight to the runner rather than back through the front door, so
        // one command an agent issued is one step in the trace.
        return runBrowserCommand(
          { type: "tabs.open", url, activate: true },
          deps,
        );
      }
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      const live = deps.getLiveState(tab.id);
      // Write through to the tab first: a tab with no view yet loads this URL
      // when it is next opened, which makes this the one navigation command
      // that still does something useful off-screen.
      deps.applyState((current) =>
        updateBrowserSurfaceTab(current, {
          tabId: tab.id,
          url,
          title: null,
        }),
      );
      if (live !== null) {
        desktopBrowser.navigate({ tabId: tab.id, url });
        await deps.waitForSettled(tab.id);
      }
      const state = deps.getState();
      const updated =
        getBrowserSurfaceWebTabs(state).find(
          (candidate) => candidate.id === tab.id,
        ) ?? tab;
      return success({
        type: "tab",
        tab: toSnapshot(updated, state, deps.getLiveState(tab.id)),
      });
    }

    case "navigation.back":
    case "navigation.forward":
    case "navigation.reload": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      const live = deps.getLiveState(tab.id);
      // History lives in the webContents; with no live view there is nothing to
      // replay and no way to learn whether there would have been.
      if (live === null) {
        return failure(
          "tab_not_live",
          `Browser tab ${tab.id} has no live page. ${NOT_LIVE_HINT}`,
        );
      }
      if (command.type === "navigation.back") {
        if (!live.canGoBack) {
          return failure(
            "tab_not_live",
            `Browser tab ${tab.id} has nothing to go back to.`,
          );
        }
        desktopBrowser.goBack(tab.id);
      } else if (command.type === "navigation.forward") {
        if (!live.canGoForward) {
          return failure(
            "tab_not_live",
            `Browser tab ${tab.id} has nothing to go forward to.`,
          );
        }
        desktopBrowser.goForward(tab.id);
      } else {
        desktopBrowser.reload(tab.id);
      }
      await deps.waitForSettled(tab.id);
      const state = deps.getState();
      const updated =
        getBrowserSurfaceWebTabs(state).find(
          (candidate) => candidate.id === tab.id,
        ) ?? tab;
      return success({
        type: "tab",
        tab: toSnapshot(updated, state, deps.getLiveState(tab.id)),
      });
    }

    case "page.zoom": {
      const resolution = resolveTab(command.tabId, deps);
      if (!resolution.ok) {
        return resolution.outcome;
      }
      const { tab } = resolution.resolved;
      const setZoom = desktopBrowser.setZoom;
      if (setZoom === undefined) {
        return failure(
          "desktop_unavailable",
          "This Patcher desktop build cannot zoom a page.",
        );
      }
      // No clamping here: the command schema already refuses a factor outside
      // Chrome's range, and refusing with a message beats quietly applying
      // something else.
      setZoom({ tabId: tab.id, factor: command.factor });
      return success({ type: "zoom", factor: command.factor });
    }

    default: {
      const exhaustive: never = command;
      return failure(
        "invalid_command",
        `Unhandled browser command ${JSON.stringify(exhaustive)}`,
      );
    }
  }
}
