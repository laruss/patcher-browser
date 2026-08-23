import type {
  PatcherDesktopBrowserApi,
  PatcherDesktopBrowserState,
} from "@patcher/desktop-contract";

/**
 * The navigation state the shell pushes for every browser view, kept where code
 * outside the browser surface can read it.
 *
 * `BrowserTabContent` already subscribes to `onState`, but only for the tab it
 * is mounted for, and only while the surface is on screen. Agent browser tools
 * have to work from any route, and they need three things the persisted tab
 * state does not carry: whether a tab has a live page at all, and whether its
 * history can go back or forward.
 *
 * This is also what lets a navigation *settle* before the caller is told it
 * happened — the desktop navigate/reload commands are fire-and-forget, so
 * without waiting, an agent that navigates and then reads the page reads the
 * previous one.
 */

const liveStates = new Map<string, PatcherDesktopBrowserState>();
type LiveStateListener = (state: PatcherDesktopBrowserState) => void;
const listeners = new Set<LiveStateListener>();

/** How long to wait for a navigation to settle before answering anyway. */
export const BROWSER_TAB_SETTLE_TIMEOUT_MS = 15_000;

/**
 * Start recording state pushes. Returns an unsubscribe. Safe to call when there
 * is no desktop bridge (the web build), where it does nothing.
 */
export function subscribeBrowserLiveState(
  desktopBrowser: PatcherDesktopBrowserApi | null,
): () => void {
  if (desktopBrowser === null) {
    return () => undefined;
  }
  return desktopBrowser.onState((state) => {
    liveStates.set(state.tabId, state);
    for (const listener of listeners) {
      listener(state);
    }
  });
}

/**
 * The last state pushed for a tab, or null when the shell has never reported
 * one — which means the tab has no live view *as far as this renderer knows*.
 * That is deliberately conservative: after an app-window reload the shell still
 * holds views this renderer has not heard about, so a null here means "ask the
 * user to open the tab", never "the view certainly does not exist".
 */
export function getBrowserLiveState(
  tabId: string,
): PatcherDesktopBrowserState | null {
  return liveStates.get(tabId) ?? null;
}

export function forgetBrowserLiveState(tabId: string): void {
  liveStates.delete(tabId);
}

/** Test seam: the map is module state and would otherwise leak between cases. */
export function resetBrowserLiveState(): void {
  liveStates.clear();
  listeners.clear();
}

/**
 * Resolve once the tab reports that it has stopped loading.
 *
 * Resolves rather than rejects on timeout: a slow page is not a failed command,
 * and the caller reports what it knows instead of losing the navigation it
 * already performed.
 */
export function waitForBrowserTabSettled(
  tabId: string,
  timeoutMs: number = BROWSER_TAB_SETTLE_TIMEOUT_MS,
): Promise<{ timedOut: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (timedOut: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      listeners.delete(listener);
      clearTimeout(timer);
      resolve({ timedOut });
    };
    const listener: LiveStateListener = (state) => {
      // Only a push for this tab counts, and only one that says it is done. The
      // load-started push for this very navigation arrives first, which is what
      // keeps this from resolving on the state the tab had a moment ago.
      if (state.tabId === tabId && !state.isLoading) {
        finish(false);
      }
    };
    const timer = setTimeout(() => {
      finish(true);
    }, timeoutMs);
    listeners.add(listener);
  });
}
