// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserDrivingSignal } from "@patcher/server-contract";
import {
  createNoopDesktopBrowserApi,
  createPatcherDesktopApi,
} from "@/test/patcher-desktop-test-utils";
import { browserDrivingAtom } from "./driving";

/**
 * The half of "who is driving" that reaches a window which is *not* serving the
 * commands.
 *
 * Worth a test of the wiring rather than of the tracker underneath it: only one
 * window is sent the agent's commands, so every other window's indicator hangs
 * entirely on this subscription — and both of the ways it can be wrong are
 * invisible from a type. Dropping `elsewhere` would send a person looking for a
 * tab that is not in their window; missing the reconnect reset would leave the
 * row up for a command that ended while the socket was down.
 */

type Unsubscribe = () => void;

const wsManager = {
  onBrowserCommand: vi.fn<(callback: (signal: unknown) => void) => Unsubscribe>(
    () => () => undefined,
  ),
  onBrowserDriving: vi.fn<
    (callback: (signal: BrowserDrivingSignal) => void) => Unsubscribe
  >(() => () => undefined),
  onConnected: vi.fn<
    (callback: (event: { reconnected: boolean }) => void) => Unsubscribe
  >(() => () => undefined),
  registerBrowserHost: vi.fn(),
  unregisterBrowserHost: vi.fn(),
  sendBrowserCommandResponse: vi.fn(),
};

vi.mock("@/lib/ws", () => ({ wsManager }));

const GRANT = {
  kind: "grant",
  grantId: "bag_1",
  label: "Claude Code",
  level: "read",
} as const;

function driving(phase: "started" | "settled"): BrowserDrivingSignal {
  return { type: "browser-driving", requestId: "r1", phase, issuer: GRANT };
}

function mountBridge() {
  window.patcherDesktop = createPatcherDesktopApi(
    {
      lastCheckedAt: null,
      latestVersion: null,
      pendingVersion: null,
      platform: "macos",
      updateAvailable: false,
      updateDownloaded: false,
      version: "0.0.0-test",
    },
    createNoopDesktopBrowserApi(),
  );
  const store = createStore();
  const Bridge = () => {
    useBridge();
    return null;
  };
  const result = render(
    <JotaiProvider store={store}>
      <Bridge />
    </JotaiProvider>,
  );
  return {
    store,
    unmount: result.unmount,
    /** Deliver a signal the way the server's socket would. */
    deliver(signal: BrowserDrivingSignal) {
      for (const [callback] of wsManager.onBrowserDriving.mock.calls) {
        callback(signal);
      }
    },
    /** Reconnect, the way the ws manager announces one. */
    reconnect() {
      for (const [callback] of wsManager.onConnected.mock.calls) {
        callback({ reconnected: true });
      }
    },
  };
}

// Imported after the mock so the hook's own `../ws` import resolves to it.
const { useBrowserAgentBridge: useBridge } = await import(
  "./useBrowserAgentBridge"
);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the browser agent bridge, in a window that is not serving", () => {
  it("shows the other window's driver as being somewhere else", () => {
    const bridge = mountBridge();

    bridge.deliver(driving("started"));

    expect(bridge.store.get(browserDrivingAtom)).toEqual({
      issuer: GRANT,
      active: true,
      // The whole point of the flag: this window cannot show the tab, so a row
      // saying "this browser" would be pointing at nothing.
      elsewhere: true,
    });

    bridge.deliver(driving("settled"));

    expect(bridge.store.get(browserDrivingAtom)).toEqual({
      issuer: GRANT,
      active: false,
      elsewhere: true,
    });
  });

  it("stops claiming somebody is driving after the stream broke", () => {
    const bridge = mountBridge();
    bridge.deliver(driving("started"));

    // The settle that would have ended it was sent while this window's socket
    // was down, and nothing resends it. Without this the row stays up for a
    // command that finished minutes ago.
    bridge.reconnect();

    expect(bridge.store.get(browserDrivingAtom)).toBeNull();
  });

  it("stops listening when the window unmounts", () => {
    const unsubscribe = vi.fn();
    wsManager.onBrowserDriving.mockReturnValueOnce(unsubscribe);
    const bridge = mountBridge();

    bridge.unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
