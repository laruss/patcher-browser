import ReconnectingWebSocket from "partysocket/ws";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The smallest transport partysocket will drive: it records every dial, and it
 * opens when the test says so. Enough to ask the only question here — did the
 * wrapper try to connect again?
 */
class FakeTransport {
  static dialled: FakeTransport[] = [];

  binaryType = "blob";
  readyState = 0;
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeTransport.dialled.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const existing = this.listeners.get(type) ?? new Set();
    existing.add(listener);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  send(): void {}

  close(): void {
    this.readyState = 3;
  }

  open(): void {
    this.readyState = 1;
    for (const listener of this.listeners.get("open") ?? []) {
      listener({ type: "open" });
    }
  }
}

function connect(): ReconnectingWebSocket {
  return new ReconnectingWebSocket(async () => "ws://127.0.0.1:1/daemon", [], {
    WebSocket: FakeTransport,
    minReconnectionDelay: 1,
    maxReconnectionDelay: 1,
    reconnectionDelayGrowFactor: 1,
    connectionTimeout: 60_000,
    maxRetries: Number.POSITIVE_INFINITY,
  });
}

afterEach(() => {
  vi.useRealTimers();
});

// The daemon recovers from a failed send by reconnecting rather than closing,
// and that choice is only correct because of the distinction below. It lives in
// a dependency rather than in this repository, which is exactly why it is
// pinned here: an upgrade that blurred it would restore the outage silently.
describe("partysocket close/reconnect contract", () => {
  it("stops for good after close() and dials again after reconnect()", async () => {
    vi.useFakeTimers();
    FakeTransport.dialled = [];
    const socket = connect();

    await vi.advanceTimersByTimeAsync(10);
    expect(FakeTransport.dialled).toHaveLength(1);
    FakeTransport.dialled[0]?.open();

    socket.close(1013, "terminal-backpressure");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeTransport.dialled).toHaveLength(1);

    socket.reconnect(1013, "terminal-backpressure");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(FakeTransport.dialled).toHaveLength(2);

    socket.close();
  });
});
