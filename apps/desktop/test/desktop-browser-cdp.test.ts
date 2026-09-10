import { describe, expect, it, vi } from "vitest";
import {
  PATCHER_CDP_PROTOCOL_VERSION,
  CdpUnavailableError,
  createCdpSession,
  endCdpAutomation,
  type CdpDebuggerTarget,
  type CdpSessionScopedState,
} from "../src/desktop-browser-cdp.js";

/**
 * The session is the thing every later automation command sits on, so what is
 * worth pinning down is its failure behaviour: a target somebody else holds, and
 * a session that goes away mid-flight, both have to be legible at the call site
 * rather than surfacing as whatever Electron throws from a dead handle.
 */

interface FakeTarget extends CdpDebuggerTarget {
  attached: boolean;
  attachCalls: string[];
  detachCalls: number;
  listenerCount(): number;
  commands: Array<{ method: string; params?: Record<string, unknown> }>;
  emitDetach(reason: string): void;
  emitMessage(method: string, params: unknown): void;
  failCommand(method: string, error: Error): void;
  resolveCommand(method: string, result: unknown): void;
}

function createFakeTarget(options: { attached?: boolean } = {}): FakeTarget {
  const detachListeners: Array<(event: unknown, reason: string) => void> = [];
  const messageListeners: Array<
    (event: unknown, method: string, params: unknown, sessionId: string) => void
  > = [];
  const results = new Map<string, unknown>();
  const failures = new Map<string, Error>();

  const target: FakeTarget = {
    attached: options.attached ?? false,
    attachCalls: [],
    detachCalls: 0,
    commands: [],
    isAttached: () => target.attached,
    attach(protocolVersion) {
      target.attachCalls.push(protocolVersion ?? "");
      target.attached = true;
    },
    detach() {
      target.detachCalls += 1;
      target.attached = false;
    },
    sendCommand(method, params) {
      target.commands.push({ method, params });
      const failure = failures.get(method);
      if (failure) {
        return Promise.reject(failure);
      }
      return Promise.resolve(results.get(method) ?? {});
    },
    on(event: string, listener: never) {
      if (event === "detach") {
        detachListeners.push(listener);
      } else {
        messageListeners.push(listener);
      }
      return target;
    },
    off(event: string, listener: never) {
      const list = event === "detach" ? detachListeners : messageListeners;
      const at = list.indexOf(listener);
      if (at >= 0) {
        list.splice(at, 1);
      }
      return target;
    },
    listenerCount() {
      return detachListeners.length + messageListeners.length;
    },
    emitDetach(reason) {
      for (const listener of detachListeners) {
        listener({}, reason);
      }
    },
    emitMessage(method, params) {
      for (const listener of messageListeners) {
        listener({}, method, params, "session-1");
      }
    },
    failCommand(method, error) {
      failures.set(method, error);
    },
    resolveCommand(method, result) {
      results.set(method, result);
    },
  } as FakeTarget;

  return target;
}

describe("createCdpSession", () => {
  it("negotiates the stable protocol version on attach", () => {
    const target = createFakeTarget();

    const session = createCdpSession({ target });

    expect(target.attachCalls).toEqual([PATCHER_CDP_PROTOCOL_VERSION]);
    expect(session.isAttached()).toBe(true);
  });

  it("refuses a target another client already holds", () => {
    // DevTools on the view is the realistic case; two protocol clients cannot
    // share a target, so this has to fail here rather than half-work later.
    const target = createFakeTarget({ attached: true });

    expect(() => createCdpSession({ target })).toThrow(CdpUnavailableError);
    expect(target.attachCalls).toEqual([]);
  });

  it("wraps an attach failure instead of leaking Electron's error", () => {
    const target = createFakeTarget();
    target.attach = () => {
      throw new Error("cannot attach to this target");
    };

    expect(() => createCdpSession({ target })).toThrow(
      /Could not attach the browser debugger: cannot attach/u,
    );
  });

  it("routes events to subscribers of that method only", () => {
    const target = createFakeTarget();
    const session = createCdpSession({ target });
    const dialogs = vi.fn();
    const console = vi.fn();
    session.on("Page.javascriptDialogOpening", dialogs);
    const unsubscribe = session.on("Runtime.consoleAPICalled", console);

    target.emitMessage("Page.javascriptDialogOpening", { message: "hi" });
    expect(dialogs).toHaveBeenCalledWith({ message: "hi" });
    expect(console).not.toHaveBeenCalled();

    unsubscribe();
    target.emitMessage("Runtime.consoleAPICalled", {});
    expect(console).not.toHaveBeenCalled();
  });

  it("keeps one throwing subscriber from taking down the others", () => {
    const target = createFakeTarget();
    const session = createCdpSession({ target });
    const healthy = vi.fn();
    session.on("Network.requestWillBeSent", () => {
      throw new Error("subscriber bug");
    });
    session.on("Network.requestWillBeSent", healthy);

    expect(() => {
      target.emitMessage("Network.requestWillBeSent", {});
    }).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("enables a domain once, and only once, under concurrent callers", async () => {
    const target = createFakeTarget();
    const session = createCdpSession({ target });

    await Promise.all([
      session.enableDomain("Accessibility"),
      session.enableDomain("Accessibility"),
    ]);
    await session.enableDomain("Accessibility");

    // Without sharing the in-flight promise the second caller would race the
    // first's enable rather than wait for it.
    expect(
      target.commands.filter(
        (command) => command.method === "Accessibility.enable",
      ),
    ).toHaveLength(1);
  });

  it("reports a session lost to DevTools or a crash, and notifies its owner", async () => {
    const target = createFakeTarget();
    const onDetach = vi.fn();
    const session = createCdpSession({ target, onDetach });

    target.emitDetach("target closed");

    expect(onDetach).toHaveBeenCalledWith("target closed");
    expect(session.isAttached()).toBe(false);
    await expect(session.send("DOM.getDocument")).rejects.toThrow(
      /detached \(target closed\)/u,
    );
    await expect(session.enableDomain("Page")).rejects.toThrow(
      CdpUnavailableError,
    );
  });

  it("re-enables a domain after a reattach, having forgotten the old session's state", async () => {
    const target = createFakeTarget();
    const first = createCdpSession({ target });
    await first.enableDomain("Page");
    target.emitDetach("crashed");

    target.attached = false;
    const second = createCdpSession({ target });
    await second.enableDomain("Page");

    // Domain state belongs to the session, not the target: carrying it across a
    // reattach would leave the new session believing Page was live.
    expect(
      target.commands.filter((command) => command.method === "Page.enable"),
    ).toHaveLength(2);
  });

  it("detaches once and stays quiet afterwards", () => {
    const target = createFakeTarget();
    const session = createCdpSession({ target });

    session.detach();
    session.detach();

    expect(target.detachCalls).toBe(1);
    expect(session.isAttached()).toBe(false);
  });

  it("survives a detach that throws because the view is already gone", () => {
    const target = createFakeTarget();
    const session = createCdpSession({ target });
    target.detach = () => {
      throw new Error("webContents destroyed");
    };

    expect(() => {
      session.detach();
    }).not.toThrow();
  });

  it("passes command failures through untouched", async () => {
    const target = createFakeTarget();
    const session = createCdpSession({ target });
    target.failCommand("DOM.querySelector", new Error("No node with given id"));

    await expect(session.send("DOM.querySelector")).rejects.toThrow(
      "No node with given id",
    );
  });
});

/**
 * Ending a tab's automation, which is what a claim ending has to do to it.
 *
 * The failures worth pinning are both about *not* acting: the sweep that hands
 * a tab back must not be the thing that starts driving it, and it must not drop
 * the only client that can answer a dialog the page is blocked on.
 */
describe("ending a tab's automation", () => {
  function stateWith(
    overrides: Partial<CdpSessionScopedState> = {},
  ): CdpSessionScopedState {
    return {
      cdp: null,
      dialogsWired: true,
      pendingDialog: null,
      automationEndPending: false,
      dialogAnswerInFlight: false,
      routes: [{ pattern: "*" }],
      routesWired: true,
      routesEnabled: true,
      offline: true,
      video: { frames: [] },
      videoWired: true,
      ...overrides,
    };
  }

  function attachedSession(): {
    detachCalls: number;
  } & CdpSessionScopedState["cdp"] {
    let detachCalls = 0;
    return {
      get detachCalls() {
        return detachCalls;
      },
      isAttached: () => true,
      detach: () => {
        detachCalls += 1;
      },
    } as unknown as { detachCalls: number } & CdpSessionScopedState["cdp"];
  }

  it("drops the session and everything that lived with it", () => {
    const session = attachedSession();
    const state = stateWith({ cdp: session });

    endCdpAutomation(state);

    // Chromium undoes the interception, the emulation and the screencast when
    // its client goes, so detaching *is* the undo; this clears the bookkeeping
    // that would otherwise describe a tab none of it is true of any more.
    expect(session?.detachCalls).toBe(1);
    expect(state.cdp).toBeNull();
    expect(state).toMatchObject({
      dialogsWired: false,
      routes: [],
      routesWired: false,
      routesEnabled: false,
      offline: false,
      video: null,
      videoWired: false,
    });
  });

  it("never attaches one to a tab that had none", () => {
    const state = stateWith({ cdp: null, routes: [], offline: false });

    endCdpAutomation(state);

    // The whole reason this is its own call rather than a `route-clear` and an
    // `offline false` from the renderer: those go through `ensureCdpSession`,
    // so sweeping a tab nobody drove would have attached a debugger to it and
    // taken the person's dialogs over — the sweep becoming the change it was
    // meant to undo (#117).
    expect(state.dialogsWired).toBe(true);
  });

  it("defers past an open dialog rather than skipping it", () => {
    const session = attachedSession();
    const state = stateWith({
      cdp: session,
      pendingDialog: { type: "confirm", message: "Sure?" },
    });

    endCdpAutomation(state);

    // Only this client can answer it, and a dialog open when the client goes
    // most likely stands — so handing the tab back here would hand back a page
    // nothing can unblock.
    expect(session?.detachCalls).toBe(0);
    expect(state.offline).toBe(true);
    expect(state.routes).toHaveLength(1);
    // But it is written down, and the dialog path runs it as the dialog clears.
    // Review caught the first version skipping outright: the claim is gone by
    // then, so nothing would ever have asked again — the whole bug, one
    // doorway narrower.
    expect(state.automationEndPending).toBe(true);

    state.pendingDialog = null;
    endCdpAutomation(state);

    expect(session?.detachCalls).toBe(1);
    expect(state.automationEndPending).toBe(false);
  });
});

describe("a session's debugger listeners", () => {
  it("come off the target when the session ends", () => {
    const target = createFakeTarget();
    const first = createCdpSession({ target });

    const wired = target.listenerCount();
    first.detach();

    // A tab's debugger outlives its sessions, and ending a tab's automation
    // then driving it again is a normal cycle now (#117). Listeners left
    // behind would stack another pair every time round — Node warns at ten,
    // and every stale detach handler fires on the next detach. Found by
    // review.
    expect(wired).toBeGreaterThan(0);
    expect(target.listenerCount()).toBe(0);

    createCdpSession({ target });
    expect(target.listenerCount()).toBe(wired);
  });

  it("come off when the target detaches on its own, too", () => {
    const target = createFakeTarget();
    createCdpSession({ target });

    target.emitDetach("devtools took the tab");

    expect(target.listenerCount()).toBe(0);
  });
});
