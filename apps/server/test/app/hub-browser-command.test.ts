import type {
  BrowserCommandResponseMessage,
  BrowserCommand,
} from "@patcher/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

/**
 * The browser an agent drives lives in the app client, so the server has to ask
 * it and wait. This is the same correlated request/response shape the daemon
 * online-RPC uses, addressed at an app socket instead of a daemon session.
 */

const LIST: BrowserCommand = { type: "tabs.list" };

function okResponse(requestId: string): BrowserCommandResponseMessage {
  return {
    type: "browser-command.response",
    requestId,
    outcome: { ok: true, value: { type: "tabs", tabs: [] } },
  };
}

function sentRequestIds(messages: string[]): string[] {
  return messages
    .map((raw) => JSON.parse(raw) as { type?: string; requestId?: string })
    .filter((message) => message.type === "browser-command-request")
    .map((message) => message.requestId ?? "");
}

describe("NotificationHub browser commands", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects immediately when no browser window is connected", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerClient(socket);

    // A plain client is not a browser host: the app announces that capability
    // explicitly, because most connected clients cannot drive a browser.
    expect(hub.getBrowserHostSnapshot()).toEqual({
      connected: false,
      browserHostId: null,
      hostCount: 0,
    });
    await expect(
      hub.requestBrowserCommand({
        message: { type: "browser-command-request", requestId: "r1", command: LIST },
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("No browser window is connected");
  });

  it("delivers to the registered host and resolves its response", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerClient(socket);
    hub.registerBrowserHost(socket, { browserHostId: "window-a" });

    expect(hub.getBrowserHostSnapshot()).toEqual({
      connected: true,
      browserHostId: "window-a",
      hostCount: 1,
    });

    const pending = hub.requestBrowserCommand({
      message: { type: "browser-command-request", requestId: "r1", command: LIST },
      timeoutMs: 1_000,
    });
    expect(sentRequestIds(socket.messages)).toEqual(["r1"]);

    expect(
      hub.recordBrowserCommandResponse({
        socket,
        message: okResponse("r1"),
      }),
    ).toEqual({ handled: true });
    await expect(pending).resolves.toEqual(okResponse("r1"));
  });

  it("addresses the window that claimed the role first and no other", async () => {
    const hub = new NotificationHub();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    expect(
      hub.registerBrowserHost(first, { browserHostId: "window-a" }),
    ).toEqual({ primary: true });
    // A window arriving later waits. It used to take over: the map was read
    // from the back, and the message that registers is authenticated no
    // further than "not a plugin", so a takeover was there for the asking.
    expect(
      hub.registerBrowserHost(second, { browserHostId: "window-b" }),
    ).toEqual({ primary: false, primaryBrowserHostId: "window-a" });

    expect(hub.getBrowserHostSnapshot()).toEqual({
      connected: true,
      browserHostId: "window-a",
      hostCount: 2,
    });

    const pending = hub.requestBrowserCommand({
      message: { type: "browser-command-request", requestId: "r1", command: LIST },
      timeoutMs: 1_000,
    });

    // The command must be performed once, so it is sent to one socket — never
    // broadcast the way the thread-open and plugin signals are.
    expect(sentRequestIds(first.messages)).toEqual(["r1"]);
    expect(sentRequestIds(second.messages)).toEqual([]);

    hub.recordBrowserCommandResponse({ socket: first, message: okResponse("r1") });
    await expect(pending).resolves.toEqual(okResponse("r1"));
  });

  it("ignores a response from a window the request did not go to", async () => {
    const hub = new NotificationHub();
    const addressed = createMockHubSocket();
    const other = createMockHubSocket();
    hub.registerBrowserHost(addressed, { browserHostId: "window-a" });
    hub.registerBrowserHost(other, { browserHostId: "window-b" });

    const pending = hub.requestBrowserCommand({
      message: { type: "browser-command-request", requestId: "r1", command: LIST },
      timeoutMs: 1_000,
    });

    expect(
      hub.recordBrowserCommandResponse({
        socket: other,
        message: okResponse("r1"),
      }),
    ).toEqual({ handled: false, reason: "host_mismatch" });

    // Still waiting for the window it actually asked.
    hub.recordBrowserCommandResponse({
      socket: addressed,
      message: okResponse("r1"),
    });
    await expect(pending).resolves.toEqual(okResponse("r1"));
  });

  it("drops a response whose request is gone", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerBrowserHost(socket, { browserHostId: "window-a" });

    expect(
      hub.recordBrowserCommandResponse({
        socket,
        message: okResponse("never-asked"),
      }),
    ).toEqual({ handled: false, reason: "stale" });
  });

  it("times out a window that never answers", async () => {
    vi.useFakeTimers();
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerBrowserHost(socket, { browserHostId: "window-a" });

    const pending = hub.requestBrowserCommand({
      message: { type: "browser-command-request", requestId: "r1", command: LIST },
      timeoutMs: 1_000,
    });
    const assertion = expect(pending).rejects.toThrow(
      "Timed out waiting for the browser to answer",
    );
    await vi.advanceTimersByTimeAsync(1_001);
    await assertion;

    // The waiter is gone, so a late answer is stale rather than a resolution.
    expect(
      hub.recordBrowserCommandResponse({ socket, message: okResponse("r1") }),
    ).toEqual({ handled: false, reason: "stale" });
  });

  it("fails in-flight commands when the browser window disconnects", async () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerClient(socket);
    hub.registerBrowserHost(socket, { browserHostId: "window-a" });

    const pending = hub.requestBrowserCommand({
      message: { type: "browser-command-request", requestId: "r1", command: LIST },
      timeoutMs: 60_000,
    });
    const assertion = expect(pending).rejects.toThrow(
      "No browser window is connected",
    );

    // Closing the window must fail the wait now rather than let the caller sit
    // out a 60s timeout for an answer that can never arrive.
    hub.unregisterClient(socket);
    await assertion;
    expect(hub.getBrowserHostSnapshot().connected).toBe(false);
  });

  it("releases a browser host that never subscribed to anything", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    // No registerClient and no subscribe: unregisterClient returns early for a
    // socket with no subscription keys, so host cleanup has to happen first.
    hub.registerBrowserHost(socket, { browserHostId: "window-a" });

    hub.unregisterClient(socket);

    expect(hub.getBrowserHostSnapshot()).toEqual({
      connected: false,
      browserHostId: null,
      hostCount: 0,
    });
  });

  it("keeps one window as the host when it re-registers", () => {
    const hub = new NotificationHub();
    const socket = createMockHubSocket();
    hub.registerBrowserHost(socket, { browserHostId: "window-a" });
    hub.registerBrowserHost(socket, { browserHostId: "window-a" });

    expect(hub.getBrowserHostSnapshot()).toEqual({
      connected: true,
      browserHostId: "window-a",
      hostCount: 1,
    });
  });

  it("hands the role back to the same window on a new socket", async () => {
    const hub = new NotificationHub();
    const dropped = createMockHubSocket();
    const reconnected = createMockHubSocket();
    hub.registerClient(dropped);
    hub.registerBrowserHost(dropped, { browserHostId: "window-a" });

    const stranded = hub.requestBrowserCommand({
      message: { type: "browser-command-request", requestId: "r1", command: LIST },
      timeoutMs: 60_000,
    });
    const assertion = expect(stranded).rejects.toThrow(
      "No browser window is connected",
    );

    // A reconnect is a new socket presenting the id the window generated for
    // this page load — the app client's own re-announce. Making it wait behind
    // the socket it replaced would leave the agent addressing a connection
    // nobody is listening on until the server noticed the close.
    hub.registerClient(reconnected);
    expect(
      hub.registerBrowserHost(reconnected, { browserHostId: "window-a" }),
    ).toEqual({ primary: true });
    await assertion;

    expect(hub.getBrowserHostSnapshot()).toEqual({
      connected: true,
      browserHostId: "window-a",
      hostCount: 1,
    });

    const pending = hub.requestBrowserCommand({
      message: { type: "browser-command-request", requestId: "r2", command: LIST },
      timeoutMs: 1_000,
    });
    expect(sentRequestIds(reconnected.messages)).toEqual(["r2"]);
    hub.recordBrowserCommandResponse({
      socket: reconnected,
      message: okResponse("r2"),
    });
    await expect(pending).resolves.toEqual(okResponse("r2"));
  });

  it("keeps a reconnecting window ahead of one that registered later", () => {
    const hub = new NotificationHub();
    const dropped = createMockHubSocket();
    const newer = createMockHubSocket();
    const reconnected = createMockHubSocket();
    hub.registerBrowserHost(dropped, { browserHostId: "window-a" });
    hub.registerBrowserHost(newer, { browserHostId: "window-b" });

    // The claim belongs to the window rather than to the socket, so a blip does
    // not reorder two windows a person has open.
    expect(
      hub.registerBrowserHost(reconnected, { browserHostId: "window-a" }),
    ).toEqual({ primary: true });
    expect(hub.getBrowserHostSnapshot()).toEqual({
      connected: true,
      browserHostId: "window-a",
      hostCount: 2,
    });
  });

  it("promotes the waiting window when the one driving goes away", () => {
    const hub = new NotificationHub();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    hub.registerClient(first);
    hub.registerClient(second);
    hub.registerBrowserHost(first, { browserHostId: "window-a" });
    hub.registerBrowserHost(second, { browserHostId: "window-b" });

    // A later claim is recorded rather than refused, so closing the window that
    // was driving leaves the other one serving. Refusing it outright would buy
    // nothing — the empty role is there for whoever asks next — and would cost
    // an open window that only re-registers on its next reconnect.
    hub.unregisterClient(first);

    expect(hub.getBrowserHostSnapshot()).toEqual({
      connected: true,
      browserHostId: "window-b",
      hostCount: 1,
    });
  });
});
