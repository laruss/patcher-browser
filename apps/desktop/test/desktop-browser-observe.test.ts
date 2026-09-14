import { describe, expect, it } from "vitest";
import {
  BrowserObservationLog,
  toBrowserConsoleEntry,
  toBrowserNetworkEntry,
} from "../src/desktop-browser-observe.js";

describe("BrowserObservationLog", () => {
  it("keeps the newest entries and counts what fell out", () => {
    const log = new BrowserObservationLog<number>(3);
    for (const value of [1, 2, 3, 4, 5]) {
      log.record(value);
    }

    expect(log.read(10)).toEqual({ entries: [3, 4, 5], droppedCount: 2 });
  });

  it("counts what the limit cuts alongside what the ring cut", () => {
    const log = new BrowserObservationLog<number>(3);
    for (const value of [1, 2, 3, 4]) {
      log.record(value);
    }

    // One evicted by the ring, one more left behind by the limit. A caller that
    // saw only the eviction count would think it was looking at everything
    // recent, which is the mistake this number exists to prevent.
    expect(log.read(2)).toEqual({ entries: [3, 4], droppedCount: 2 });
  });

  it("reports nothing dropped while it is still filling", () => {
    const log = new BrowserObservationLog<string>(5);
    log.record("a");

    expect(log.read(5)).toEqual({ entries: ["a"], droppedCount: 0 });
  });
});

describe("toBrowserConsoleEntry", () => {
  it("carries the level, text and origin of a message", () => {
    expect(
      toBrowserConsoleEntry(
        {
          level: "error",
          message: "Uncaught TypeError: x is not a function",
          lineNumber: 42,
          sourceId: "https://example.com/app.js",
        },
        1_700_000_000_000,
      ),
    ).toEqual({
      level: "error",
      text: "Uncaught TypeError: x is not a function",
      source: "https://example.com/app.js",
      line: 42,
      timestamp: 1_700_000_000_000,
    });
  });

  it("treats a level it does not know as ordinary output", () => {
    // The level decides how a reader triages the log, so an unrecognized one
    // must not become "error" by accident.
    expect(toBrowserConsoleEntry({ level: "verbose" }, 1).level).toBe("info");
    expect(toBrowserConsoleEntry({}, 1).level).toBe("info");
  });

  it("survives a message with nothing usable in it", () => {
    expect(toBrowserConsoleEntry({ message: 12, lineNumber: -3 }, 7)).toEqual({
      level: "info",
      text: "",
      source: "",
      line: 0,
      timestamp: 7,
    });
  });

  it("truncates a message a page made enormous", () => {
    const entry = toBrowserConsoleEntry({ message: "x".repeat(9_000) }, 1);

    expect(entry.text).toHaveLength(4096);
  });
});

describe("toBrowserNetworkEntry", () => {
  it("carries the outcome of a completed request", () => {
    expect(
      toBrowserNetworkEntry(
        {
          url: "https://example.com/api",
          method: "POST",
          resourceType: "xhr",
          statusCode: 201,
          fromCache: false,
          timestamp: 1_700_000_000_000,
        },
        1,
      ),
    ).toEqual({
      method: "POST",
      url: "https://example.com/api",
      resourceType: "xhr",
      status: 201,
      fromCache: false,
      error: null,
      timestamp: 1_700_000_000_000,
    });
  });

  it("does not call a request that worked an error", () => {
    // `onCompleted` hands over `net::ErrorToString(net_error)` exactly as
    // `onErrorOccurred` does, so every ordinary request arrives with the string
    // for success. Keeping it would have shown "net::OK" in place of the status
    // wherever the error is what gets displayed (#121).
    const entry = toBrowserNetworkEntry(
      {
        url: "https://example.com/app.js",
        method: "GET",
        resourceType: "script",
        statusCode: 200,
        fromCache: false,
        error: "net::OK",
      },
      3,
    );

    expect(entry.error).toBeNull();
    expect(entry.status).toBe(200);
  });

  it("does not call an upgraded WebSocket an error either", () => {
    // A successful handshake is completed with `net::ERR_WS_UPGRADE` — the one
    // other `net_error` that reaches `onCompleted` without anything having gone
    // wrong. `resourceType` already says it was a socket; the sentinel would
    // only have hidden the 101.
    const entry = toBrowserNetworkEntry(
      {
        url: "wss://example.com/socket",
        method: "GET",
        resourceType: "webSocket",
        statusCode: 101,
        fromCache: false,
        error: "net::ERR_WS_UPGRADE",
      },
      4,
    );

    expect(entry.error).toBeNull();
    expect(entry.status).toBe(101);
  });

  it("keeps a failure as the net:: name Chromium gave it", () => {
    // Including the firewall's own refusal, which is the case worth being able
    // to recognize rather than guess at.
    const entry = toBrowserNetworkEntry(
      {
        url: "http://127.0.0.1:9999/",
        method: "GET",
        resourceType: "xhr",
        error: "net::ERR_BLOCKED_BY_CLIENT",
      },
      5,
    );

    expect(entry.status).toBeNull();
    expect(entry.error).toBe("net::ERR_BLOCKED_BY_CLIENT");
  });

  it("falls back to now when the details carry no timestamp", () => {
    expect(toBrowserNetworkEntry({ url: "https://example.com/" }, 99)).toEqual({
      method: "",
      url: "https://example.com/",
      resourceType: "other",
      status: null,
      fromCache: false,
      error: null,
      timestamp: 99,
    });
  });
});
