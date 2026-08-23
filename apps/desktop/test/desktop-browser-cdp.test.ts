import { describe, expect, it, vi } from "vitest";
import {
  PATCHER_CDP_PROTOCOL_VERSION,
  CdpUnavailableError,
  createCdpSession,
  type CdpDebuggerTarget,
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
