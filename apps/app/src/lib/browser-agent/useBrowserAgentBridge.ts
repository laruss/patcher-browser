import { useEffect } from "react";
import { useStore } from "jotai";
import { resolvePluginBrowserPdfText } from "@/hooks/queries/plugin-contribution-queries";
import { getDesktopBrowserApi } from "../patcher-desktop";
import {
  BROWSER_SURFACE_SCOPE_ID,
  browserSurfaceTabsAtom,
  getBrowserSurfaceWebTabs,
} from "../browser-surface-tabs";
import { browserMutedTabsAtom, withBrowserTabMuted } from "../browser-tab-mute";
import {
  destroyPersistedBrowserView,
  registerBrowserView,
} from "@/components/secondary-panel/browserViewVisibilityCoordinator";
import { wsManager } from "../ws";
import { browserDrivingAtom, createBrowserDrivingTracker } from "./driving";
import {
  browserTabOwnersAtom,
  requestBrowserTabHandoverAtom,
  withBrowserTabOwner,
} from "./tab-owners";
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

/**
 * Bounds for a view nobody is looking at.
 *
 * Deliberately not zeroes. The view is hidden, but it is laid out, and layout is
 * what `innerText`, `scrollHeight` and every actionability check read: a 0×0
 * page reports each of its elements as invisible, so a background tab would
 * accept commands and refuse all of them. The shell clamps a rect to the
 * window's content area (`clampPatcherDesktopBrowserViewBounds`), so asking for
 * more than any window has is how you ask for "whatever a real tab gets here".
 */
const BACKGROUND_BROWSER_VIEW_BOUNDS = {
  x: 0,
  y: 0,
  width: 100_000,
  height: 100_000,
} as const;

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

    // What the chrome draws when something other than the person is driving.
    // Fed here rather than inside `executeBrowserCommand`, because it is about
    // the request rather than about the command: the issuer arrives on the
    // signal and the executor never sees it.
    const driving = createBrowserDrivingTracker({
      set: (state) => {
        store.set(browserDrivingAtom, state);
      },
    });

    const unsubscribeCommands = wsManager.onBrowserCommand((signal) => {
      driving.started(signal.issuer);
      void executeBrowserCommand(signal.command, {
        // Who this is for, which decides which tab an unqualified command lands
        // on and whether a named one is theirs to touch (`tab-owners.ts`).
        issuer: signal.issuer,
        getTabOwners: () => store.get(browserTabOwnersAtom),
        setTabOwner: ({ issuer, tabId }) => {
          store.set(browserTabOwnersAtom, (current) =>
            withBrowserTabOwner(current, {
              issuer,
              // Read here rather than passed in: the claim is recorded after the
              // tab is in the strip, and this is the write that also drops
              // entries for tabs that are gone.
              openTabIds: getBrowserSurfaceWebTabs(
                store.get(browserSurfaceTabsAtom),
              ).map((tab) => tab.id),
              tabId,
            }),
          );
        },
        requestTabHandover: (ask) => {
          store.set(requestBrowserTabHandoverAtom, ask);
        },
        getState: () => store.get(browserSurfaceTabsAtom),
        applyState: (update) => {
          store.set(browserSurfaceTabsAtom, update);
        },
        desktopBrowser,
        getLiveState: getBrowserLiveState,
        waitForSettled: (tabId) => waitForBrowserTabSettled(tabId),
        destroyView: destroyPersistedBrowserView,
        attachBackgroundView: ({ desktopBrowser: shell, tabId, url }) => {
          // Registered under the same identity the deck will use when the user
          // finally selects this tab, so the view it finds is this one: an
          // `attach` on an existing entry re-applies bounds and visibility and
          // loads nothing it is already on. It also means the deck's own
          // reaping — and a thread teardown — can destroy a view the agent
          // created, which is what keeps this from leaking pages.
          registerBrowserView({
            environmentId: null,
            tabId,
            threadId: BROWSER_SURFACE_SCOPE_ID,
          });
          shell.attach({
            tabId,
            url,
            bounds: BACKGROUND_BROWSER_VIEW_BOUNDS,
            // The whole point. Attaching is what loads the page; visibility is
            // what would take the window away from the person using it.
            visible: false,
          });
        },
        recordMuted: ({ muted, tabId }) => {
          store.set(browserMutedTabsAtom, (current) =>
            withBrowserTabMuted(current, { muted, tabId }),
          );
        },
        resolvePdfText: resolvePluginBrowserPdfText,
        trace,
      })
        .then((outcome) => {
          driving.settled(signal.issuer);
          wsManager.sendBrowserCommandResponse({
            type: "browser-command.response",
            requestId: signal.requestId,
            outcome,
          });
        })
        .catch((error: unknown) => {
          driving.settled(signal.issuer);
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
      driving.dispose();
    };
  }, [store]);
}
