import { useEffect } from "react";
import { useStore } from "jotai";
import { resolvePluginBrowserPdfText } from "@/hooks/queries/plugin-contribution-queries";
import { getDesktopBrowserApi } from "../patcher-desktop";
import { browserSurfaceTabsAtom } from "../browser-surface-tabs";
import { browserMutedTabsAtom, withBrowserTabMuted } from "../browser-tab-mute";
import { destroyPersistedBrowserView } from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { wsManager } from "../ws";
import { executeBrowserCommand } from "./execute";
import { BrowserTraceRecorder } from "./trace";
import {
  getBrowserLiveState,
  subscribeBrowserLiveState,
  waitForBrowserTabSettled,
} from "./live-state";

/**
 * Serves agent browser commands for this app window.
 *
 * Mount it above the router, not inside the browser surface: an agent's tools
 * have to work while the user is reading a thread, and every route under
 * `<Routes>` unmounts on navigation. The browser surface itself is unaffected —
 * both sides go through the same tabs atom, so an agent's change shows up in an
 * open strip immediately.
 */

/** Distinguishes windows in the server's host registry; one per app load. */
function createBrowserHostId(): string {
  return `browser-host-${Math.random().toString(36).slice(2, 10)}`;
}

export function useBrowserAgentBridge(): void {
  const store = useStore();

  useEffect(() => {
    const browserHostId = createBrowserHostId();
    const desktopBrowser = getDesktopBrowserApi();
    // One trace per window, living as long as the bridge does. A reload ends
    // it, which is the honest behaviour: the log is held in memory here, and a
    // window that went away recorded nothing anyone can still read.
    const trace = new BrowserTraceRecorder();

    // One subscription for the whole window. This is what makes the tools work
    // off-route: the shell pushes navigation state for every view, while
    // BrowserTabContent only listens for the tab it is mounted for.
    const unsubscribeLiveState = subscribeBrowserLiveState(desktopBrowser);

    const unsubscribeCommands = wsManager.onBrowserCommand((signal) => {
      void executeBrowserCommand(signal.command, {
        getState: () => store.get(browserSurfaceTabsAtom),
        applyState: (update) => {
          store.set(browserSurfaceTabsAtom, update);
        },
        desktopBrowser,
        getLiveState: getBrowserLiveState,
        waitForSettled: (tabId) => waitForBrowserTabSettled(tabId),
        destroyView: destroyPersistedBrowserView,
        recordMuted: ({ muted, tabId }) => {
          store.set(browserMutedTabsAtom, (current) =>
            withBrowserTabMuted(current, { muted, tabId }),
          );
        },
        resolvePdfText: resolvePluginBrowserPdfText,
        trace,
      })
        .then((outcome) => {
          wsManager.sendBrowserCommandResponse({
            type: "browser-command.response",
            requestId: signal.requestId,
            outcome,
          });
        })
        .catch((error: unknown) => {
          // Never leave the server's waiter to time out on a bug in here: an
          // answer, even a bad one, is what unblocks the agent's tool call.
          wsManager.sendBrowserCommandResponse({
            type: "browser-command.response",
            requestId: signal.requestId,
            outcome: {
              ok: false,
              code: "invalid_command",
              message: `The browser could not perform that command: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          });
        });
    });

    wsManager.registerBrowserHost(browserHostId);

    return () => {
      wsManager.unregisterBrowserHost(browserHostId);
      unsubscribeCommands();
      unsubscribeLiveState();
    };
  }, [store]);
}
