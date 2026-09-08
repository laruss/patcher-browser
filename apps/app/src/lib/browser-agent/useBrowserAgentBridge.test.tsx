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

interface CommandSignal {
  type: "browser-command-request";
  requestId: string;
  command: { type: "tabs.list" };
  issuer: typeof GRANT;
}

const wsManager = {
  onBrowserCommand: vi.fn<
    (callback: (signal: CommandSignal) => void) => Unsubscribe
  >(() => () => undefined),
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

// A command this window is performing and has not finished. Nothing else here
// needs the executor, and a real one would answer within the test — which is
// the opposite of the state the reconnect case is about.
vi.mock("./execute", () => ({
  executeBrowserCommand: () => new Promise(() => undefined),
}));

const GRANT = {
  kind: "grant",
  grantId: "bag_1",
  label: "Claude Code",
  level: "read",
} as const;

function driving(
  phase: "started" | "settled",
  requestId = "r1",
): BrowserDrivingSignal {
  return { type: "browser-driving", requestId, phase, issuer: GRANT };
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
    /** A command addressed to this window, the way the server sends one. */
    command(requestId: string) {
      for (const [callback] of wsManager.onBrowserCommand.mock.calls) {
        callback({
          type: "browser-command-request",
          requestId,
          command: { type: "tabs.list" },
          issuer: GRANT,
        });
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

  it("passes each phase's own command id through", () => {
    const bridge = mountBridge();

    // The sequence a window gets when it registers — or reconnects — part-way
    // through a command: it hears that command's settle without ever having
    // heard its start. Meanwhile the same caller started another one, which
    // this window did see.
    bridge.deliver(driving("started", "r2"));
    bridge.deliver(driving("settled", "r1"));

    // The tracker ignores an end it never saw begin, but only if it is given
    // the id: a subscription that passed the same id for both phases, or
    // dropped it, would end r2 here — and r2 is still driving.
    expect(bridge.store.get(browserDrivingAtom)).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: true,
    });
  });

  it("keeps a command this window is performing through a reconnect", () => {
    const bridge = mountBridge();

    // This window is the one serving: the command arrives as a request, and
    // its executor has not answered.
    bridge.command("r1");
    expect(bridge.store.get(browserDrivingAtom)).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: false,
    });

    bridge.reconnect();

    // A reconnect drops what this window was told about *other* windows, and
    // nothing else. Clearing the tracker wholesale — which is what this did
    // before the review — takes the row down while a tab in this window is
    // visibly being driven, and no settle is coming to put it back: the local
    // command answers to a promise, not to the socket.
    expect(bridge.store.get(browserDrivingAtom)).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: false,
    });
  });

  it("stops listening when the window unmounts", () => {
    const unsubscribeDriving = vi.fn();
    const unsubscribeConnected = vi.fn();
    wsManager.onBrowserDriving.mockReturnValueOnce(unsubscribeDriving);
    wsManager.onConnected.mockReturnValueOnce(unsubscribeConnected);
    const bridge = mountBridge();

    bridge.unmount();

    expect(unsubscribeDriving).toHaveBeenCalledTimes(1);
    // Both, because a listener left behind closes over this window's store: a
    // reconnect would go on clearing an indicator in a window that is gone.
    expect(unsubscribeConnected).toHaveBeenCalledTimes(1);
  });
});
