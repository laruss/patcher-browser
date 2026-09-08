// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { Provider as JotaiProvider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserCommandOutcome } from "@patcher/domain";
import type {
  BrowserDrivingOutcome,
  BrowserDrivingSignal,
} from "@patcher/server-contract";
import {
  createNoopDesktopBrowserApi,
  createPatcherDesktopApi,
} from "@/test/patcher-desktop-test-utils";
import { browserActivityAtom } from "./activity";
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

/**
 * The executor, controllable rather than absent.
 *
 * Its default is a promise that never answers, which is the state the reconnect
 * case is about — a command this window is still performing. The tests that
 * care how a local command *ends* hand it one they can settle themselves,
 * because that path is the one the remote frames cannot stand in for: a window
 * performing a command is told nothing by the server about it.
 */
const executeBrowserCommand =
  vi.fn<(...args: unknown[]) => Promise<BrowserCommandOutcome>>(
    () => new Promise(() => undefined),
  );

vi.mock("./execute", () => ({
  executeBrowserCommand: (...args: unknown[]) =>
    executeBrowserCommand(...args),
}));

const GRANT = {
  kind: "grant",
  grantId: "bag_1",
  label: "Claude Code",
  level: "read",
} as const;

const CLICK = { name: "page.interact", detail: "click e42" } as const;

function drivingStarted(requestId = "r1"): BrowserDrivingSignal {
  return {
    type: "browser-driving",
    requestId,
    phase: "started",
    issuer: GRANT,
    command: CLICK,
  };
}

/** `outcome: null` is the server saying nobody answered — a timeout, or the
 *  window that was performing it going away. */
function drivingSettled(
  requestId = "r1",
  outcome: BrowserDrivingOutcome | null = { ok: true, error: null },
): BrowserDrivingSignal {
  return {
    type: "browser-driving",
    requestId,
    phase: "settled",
    issuer: GRANT,
    outcome,
  };
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
  // `clearAllMocks` also clears the implementation, and every test that does
  // not set its own needs the command it starts to stay unfinished.
  executeBrowserCommand.mockImplementation(
    () => new Promise(() => undefined),
  );
});

describe("the browser agent bridge, in a window that is not serving", () => {
  it("shows the other window's driver as being somewhere else", () => {
    const bridge = mountBridge();

    bridge.deliver(drivingStarted());

    expect(bridge.store.get(browserDrivingAtom)).toEqual({
      issuer: GRANT,
      active: true,
      // The whole point of the flag: this window cannot show the tab, so a row
      // saying "this browser" would be pointing at nothing.
      elsewhere: true,
      // And what it is doing, which this window has no other way to know: it
      // never saw the command, only this frame.
      command: CLICK,
    });

    bridge.deliver(drivingSettled());

    expect(bridge.store.get(browserDrivingAtom)).toEqual({
      issuer: GRANT,
      active: false,
      elsewhere: true,
      command: CLICK,
    });
  });

  it("stops claiming somebody is driving after the stream broke", () => {
    const bridge = mountBridge();
    bridge.deliver(drivingStarted());

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
    bridge.deliver(drivingStarted("r2"));
    bridge.deliver(drivingSettled("r1"));

    // The tracker ignores an end it never saw begin, but only if it is given
    // the id: a subscription that passed the same id for both phases, or
    // dropped it, would end r2 here — and r2 is still driving.
    expect(bridge.store.get(browserDrivingAtom)).toEqual({
      issuer: GRANT,
      active: true,
      elsewhere: true,
      command: CLICK,
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
      // Rendered in this window from the command it was sent, by the same
      // function the server renders the frame with.
      command: { name: "tabs.list", detail: "" },
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
      // Rendered in this window from the command it was sent, by the same
      // function the server renders the frame with.
      command: { name: "tabs.list", detail: "" },
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

/**
 * The other half of what a window keeps: not "is something driving" but "what
 * did it do", which is asked after the indicator is gone (`activity.ts`).
 *
 * At this level because the record's two feeders are here, and each of them can
 * be wired wrong in a way the log itself cannot see: a local command whose
 * rendering never happens, an outcome dropped on the way from the frame, or a
 * reconnect that leaves a row saying "running" for the rest of the session.
 */
describe("the browser agent bridge, keeping the record", () => {
  it("writes down a command this window performs, as it renders it", () => {
    const bridge = mountBridge();

    bridge.command("r1");

    const entries = bridge.store.get(browserActivityAtom);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      requestId: "r1",
      issuer: GRANT,
      // The window has the command itself and no frame, so this is the local
      // rendering — same function as the server's, which is what keeps one
      // command from reading two ways in two windows.
      command: { name: "tabs.list", detail: "" },
      status: { kind: "running" },
      elsewhere: false,
    });
  });

  it("takes the outcome off the settle rather than guessing one", () => {
    const bridge = mountBridge();

    bridge.deliver(drivingStarted("r1"));
    bridge.deliver(
      drivingSettled("r1", { ok: false, error: "unknown_tab" }),
    );

    expect(bridge.store.get(browserActivityAtom)[0]?.status).toEqual({
      kind: "failed",
      code: "unknown_tab",
    });
  });

  it("says no answer, which is not the same as done", () => {
    const bridge = mountBridge();

    bridge.deliver(drivingStarted("r1"));
    // What the server sends when the command timed out or the window
    // performing it went away: the phase, and no outcome to report.
    bridge.deliver(drivingSettled("r1", null));

    expect(bridge.store.get(browserActivityAtom)[0]?.status).toEqual({
      kind: "unanswered",
    });
  });

  it("ends the other window's rows on a reconnect and keeps its own running", () => {
    const bridge = mountBridge();

    bridge.deliver(drivingStarted("r1"));
    bridge.command("r2");

    bridge.reconnect();

    const entries = bridge.store.get(browserActivityAtom);
    // The mirrored one can never be settled now — its settle was sent while
    // this socket was down and nothing resends it — so the record says what is
    // true about it rather than leaving it open forever.
    expect(entries.find((entry) => entry.requestId === "r1")?.status).toEqual({
      kind: "unanswered",
    });
    // And the local one is still being performed: it answers to a promise, not
    // to the socket.
    expect(entries.find((entry) => entry.requestId === "r2")?.status).toEqual({
      kind: "running",
    });
  });

  it("finishes a row this window performed, with the outcome it got", async () => {
    executeBrowserCommand.mockResolvedValueOnce({
      ok: false,
      code: "unknown_tab",
      message: "That tab is not open. List the tabs to see which ids exist.",
    });
    const bridge = mountBridge();

    bridge.command("r1");
    // The executor's promise, and the `.then` behind it.
    await act(async () => {
      await Promise.resolve();
    });

    // The path no frame can stand in for: the window performing a command is
    // told nothing about it by the server, so if this window did not write the
    // answer down itself the row would say "running" for the rest of the
    // session. The code, not the message the agent is sent.
    expect(bridge.store.get(browserActivityAtom)[0]?.status).toEqual({
      kind: "failed",
      code: "unknown_tab",
    });
    // And the agent still gets its answer.
    expect(wsManager.sendBrowserCommandResponse).toHaveBeenCalledTimes(1);
  });

  it("marks a row done when the command it performed succeeded", async () => {
    executeBrowserCommand.mockResolvedValueOnce({
      ok: true,
      value: { type: "tabs", tabs: [] },
    });
    const bridge = mountBridge();

    bridge.command("r1");
    await act(async () => {
      await Promise.resolve();
    });

    expect(bridge.store.get(browserActivityAtom)[0]?.status).toEqual({
      kind: "ok",
    });
  });

  it("records a bug in the executor as the failure the agent is sent", async () => {
    executeBrowserCommand.mockRejectedValueOnce(new Error("boom"));
    const bridge = mountBridge();

    bridge.command("r1");
    await act(async () => {
      await Promise.resolve();
    });

    // Not "no answer": the agent is being sent `invalid_command`, and a record
    // that said nobody answered would disagree with what the caller was told.
    expect(bridge.store.get(browserActivityAtom)[0]?.status).toEqual({
      kind: "failed",
      code: "invalid_command",
    });
  });
});
