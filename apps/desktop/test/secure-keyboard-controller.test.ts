import { EventEmitter } from "node:events";
import type { BrowserWindow, IpcMainEvent, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SecureKeyboardController } from "../src/secure-keyboard-controller.js";

class Window extends EventEmitter {
  focused = false;
  destroyed = false;
  isFocused() {
    return this.focused;
  }
  isDestroyed() {
    return this.destroyed;
  }
}
class Contents extends EventEmitter {
  destroyed = false;
  crashed = false;
  focused = false;
  mainFrame = {
    processId: 1,
    routingId: 1,
    detached: false,
    isDestroyed: () => false,
  };
  focusedFrame: object | null = this.mainFrame;
  constructor(public id: number) {
    super();
  }
  isFocused() {
    return this.focused;
  }
  isDestroyed() {
    return this.destroyed;
  }
  isCrashed() {
    return this.crashed;
  }
}

describe("secure keyboard lifecycle", () => {
  let controller: SecureKeyboardController;
  let focused: Contents | null;
  let setEnabled: ReturnType<typeof vi.fn<(value: boolean) => void>>;
  let enabled: boolean;
  let window: Window;
  let contents: Contents;
  const eventFor = (target: Contents) =>
    ({
      sender: target,
      senderFrame: target.mainFrame,
    }) as unknown as Pick<IpcMainEvent, "sender" | "senderFrame">;
  function register(
    target: Contents,
    owner: Window,
    browser = false,
    visible = true,
  ) {
    controller.register(
      target as unknown as WebContents,
      owner as unknown as BrowserWindow,
      browser,
      visible,
    );
  }
  function focus(target: Contents, owner: Window) {
    window.focused = false;
    owner.focused = true;
    focused = target;
    target.focused = true;
    target.emit("focus");
    owner.emit("focus");
  }
  function report(target: Contents, protect: boolean) {
    const documentId = controller.documentFor(eventFor(target));
    controller.report(eventFor(target), { documentId, protect });
    return documentId;
  }

  beforeEach(() => {
    focused = null;
    enabled = false;
    setEnabled = vi.fn((value: boolean) => {
      enabled = value;
    });
    controller = new SecureKeyboardController(
      () => focused as unknown as WebContents | null,
      setEnabled,
    );
    window = new Window();
    contents = new Contents(1);
    register(contents, window);
  });

  it("protects a foreground password and releases ordinary focus", () => {
    focus(contents, window);
    report(contents, true);
    expect(enabled).toBe(true);
    report(contents, false);
    expect(enabled).toBe(false);
  });

  it("keeps background reports and another window's teardown from disabling the foreground password", () => {
    const other = new Contents(2);
    const otherWindow = new Window();
    register(other, otherWindow);
    report(other, false);
    focus(contents, window);
    report(contents, true);
    const documentId = controller.documentFor(eventFor(other));
    controller.report(eventFor(other), { documentId, protect: false });
    other.destroyed = true;
    other.emit("destroyed");
    expect(enabled).toBe(true);
    expect(setEnabled).toHaveBeenCalledTimes(1);
  });

  it("switches between two windows even if both contents retain first responder status", () => {
    const other = new Contents(2);
    const otherWindow = new Window();
    register(other, otherWindow);
    report(other, true);
    focus(contents, window);
    report(contents, false);
    focus(other, otherWindow);
    expect(contents.focused).toBe(true);
    expect(enabled).toBe(true);
    otherWindow.focused = false;
    window.focused = true;
    focused = contents;
    window.emit("focus");
    expect(enabled).toBe(false);
  });

  it("keeps the retained document live through canceled provisional navigation", () => {
    focus(contents, window);
    const oldId = report(contents, true);
    contents.emit(
      "did-start-navigation",
      {},
      "https://example.com/new",
      false,
      true,
    );
    expect(enabled).toBe(true);
    controller.report(eventFor(contents), {
      documentId: oldId,
      protect: false,
    });
    expect(enabled).toBe(false);
    controller.report(eventFor(contents), { documentId: oldId, protect: true });
    expect(enabled).toBe(true);
  });

  it("rejects stale reports after a new document bootstrap or history restore", () => {
    focus(contents, window);
    const oldId = report(contents, true);
    const newId = report(contents, true);
    expect(newId).not.toBe(oldId);
    controller.report(eventFor(contents), {
      documentId: oldId,
      protect: false,
    });
    expect(enabled).toBe(true);
    contents.emit(
      "did-start-navigation",
      {},
      "https://example.com/new#hash",
      true,
      true,
    );
    expect(enabled).toBe(true);
  });

  it("refuses unregistered senders, subframes, detached frames and malformed payloads", () => {
    focus(contents, window);
    const documentId = report(contents, true);
    const badFrame = { ...contents.mainFrame, routingId: 2 };
    controller.report(
      {
        ...eventFor(contents),
        senderFrame: badFrame,
      } as unknown as IpcMainEvent,
      { documentId, protect: false },
    );
    expect(controller.documentFor(eventFor(new Contents(99)))).toBeNull();
    for (const payload of [
      null,
      false,
      { documentId, protect: "false" },
      { documentId, protect: false, password: "sentinel" },
    ]) {
      controller.report(eventFor(contents), payload);
    }
    contents.mainFrame.detached = true;
    controller.report(eventFor(contents), { documentId, protect: false });
    expect(controller.documentFor(eventFor(contents))).toBeNull();
    expect(enabled).toBe(true);
  });

  it("protects an unknown nested browser frame but releases the address bar", () => {
    register(contents, window, true);
    focus(contents, window);
    report(contents, false);
    contents.focusedFrame = { processId: 2, routingId: 2 };
    controller.refresh();
    expect(enabled).toBe(true);
    const chrome = new Contents(2);
    register(chrome, window);
    report(chrome, false);
    focus(chrome, window);
    expect(enabled).toBe(false);
  });

  it("releases hidden and detached tabs while respecting the new active tab", () => {
    register(contents, window, true);
    focus(contents, window);
    report(contents, true);
    register(contents, window, true, false);
    expect(enabled).toBe(false);
    const other = new Contents(2);
    register(other, window, true);
    report(other, true);
    focus(other, window);
    contents.destroyed = true;
    contents.emit("destroyed");
    expect(enabled).toBe(true);
  });

  it("clears protection on crash and requires a new live document", () => {
    focus(contents, window);
    const oldId = report(contents, true);
    contents.crashed = true;
    contents.emit("render-process-gone");
    expect(enabled).toBe(false);
    controller.report(eventFor(contents), { documentId: oldId, protect: true });
    expect(enabled).toBe(false);
    contents.crashed = false;
    contents.emit(
      "did-start-navigation",
      {},
      "https://example.com",
      false,
      true,
    );
    report(contents, true);
    expect(enabled).toBe(true);
  });

  it("releases app and window blur, screen lock, suspend and quit independently", () => {
    focus(contents, window);
    report(contents, true);
    window.focused = false;
    window.emit("blur");
    expect(enabled).toBe(false);
    window.focused = true;
    window.emit("focus");
    controller.block("inactive", true);
    expect(enabled).toBe(false);
    controller.block("inactive", false);
    controller.block("suspend", true);
    controller.block("lock-screen", true);
    controller.block("suspend", false);
    expect(enabled).toBe(false);
    controller.block("lock-screen", false);
    expect(enabled).toBe(true);
    controller.block("quit", true);
    expect(enabled).toBe(false);
    controller.dispose();
    report(contents, true);
    controller.block("quit", false);
    expect(enabled).toBe(false);
  });

  it("releases closing windows and destroyed contents", () => {
    focus(contents, window);
    report(contents, true);
    window.destroyed = true;
    window.emit("closed");
    expect(enabled).toBe(false);
    contents.destroyed = true;
    contents.emit("destroyed");
    expect(controller.documentFor(eventFor(contents))).toBeNull();
  });
});
