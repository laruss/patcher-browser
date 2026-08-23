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

  it("addresses the most recently registered window and no other", async () => {
    const hub = new NotificationHub();
    const first = createMockHubSocket();
    const second = createMockHubSocket();
    hub.registerBrowserHost(first, { browserHostId: "window-a" });
    hub.registerBrowserHost(second, { browserHostId: "window-b" });

    expect(hub.getBrowserHostSnapshot()).toEqual({
      connected: true,
      browserHostId: "window-b",
      hostCount: 2,
    });

    const pending = hub.requestBrowserCommand({
      message: { type: "browser-command-request", requestId: "r1", command: LIST },
      timeoutMs: 1_000,
    });

    // The command must be performed once, so it is sent to one socket — never
    // broadcast the way the thread-open and plugin signals are.
    expect(sentRequestIds(second.messages)).toEqual(["r1"]);
    expect(sentRequestIds(first.messages)).toEqual([]);

    hub.recordBrowserCommandResponse({ socket: second, message: okResponse("r1") });
    await expect(pending).resolves.toEqual(okResponse("r1"));
  });

  it("ignores a response from a window the request did not go to", async () => {
    const hub = new NotificationHub();
    const addressed = createMockHubSocket();
    const other = createMockHubSocket();
    hub.registerBrowserHost(other, { browserHostId: "window-a" });
    hub.registerBrowserHost(addressed, { browserHostId: "window-b" });

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
});
