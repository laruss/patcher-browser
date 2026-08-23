import type {
  BrowserCommandResponseMessage,
  BrowserCommandValue,
} from "@patcher/domain";
import { describe, expect, it } from "vitest";
import {
  BROWSER_COMMAND_MAX_TIMEOUT_MS,
  BrowserCommandAbortedError,
  createBrowserBridge,
} from "../../../src/services/browser/browser-bridge.js";
import type { BrowserCommandRequestSignal } from "@patcher/server-contract";

/**
 * The bridge is what a plugin's browser call actually goes through, so these
 * cases are about the parts a plugin can observe: the shape of a refusal, and
 * what abandoning a call does.
 */

const TABS_VALUE: BrowserCommandValue = { type: "tabs", tabs: [] };

interface HubStub {
  requests: Array<{
    message: BrowserCommandRequestSignal;
    timeoutMs: number;
  }>;
  settle: (message: BrowserCommandResponseMessage) => void;
  fail: (error: Error) => void;
}

function createHub(): {
  hub: Parameters<typeof createBrowserBridge>[0]["hub"];
  stub: HubStub;
} {
  const requests: HubStub["requests"] = [];
  let settle: ((message: BrowserCommandResponseMessage) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;

  return {
    hub: {
      getBrowserHostSnapshot: () => ({
        connected: true,
        browserHostId: "window-a",
        hostCount: 1,
      }),
      onBrowserHostsChanged: () => () => {},
      requestBrowserCommand: (args) => {
        requests.push(args);
        return new Promise((resolve, reject) => {
          settle = resolve;
          fail = reject;
        });
      },
    },
    stub: {
      requests,
      settle: (message) => settle?.(message),
      fail: (error) => fail?.(error),
    },
  };
}

function respond(
  requestId: string,
  outcome: BrowserCommandResponseMessage["outcome"],
): BrowserCommandResponseMessage {
  return { type: "browser-command.response", requestId, outcome };
}

describe("createBrowserBridge", () => {
  it("gives every call its own request id and returns the value", async () => {
    const { hub, stub } = createHub();
    const bridge = createBrowserBridge({ hub });

    const first = bridge.call({ command: { type: "tabs.list" } });
    const firstId = stub.requests[0]?.message.requestId ?? "";
    stub.settle(respond(firstId, { ok: true, value: TABS_VALUE }));
    await expect(first).resolves.toEqual(TABS_VALUE);

    const second = bridge.call({ command: { type: "tabs.list" } });
    const secondId = stub.requests[1]?.message.requestId ?? "";
    expect(secondId).not.toBe(firstId);
    stub.settle(respond(secondId, { ok: true, value: TABS_VALUE }));
    await expect(second).resolves.toEqual(TABS_VALUE);
  });

  it("turns a refusal into an error carrying its code", async () => {
    const { hub, stub } = createHub();
    const bridge = createBrowserBridge({ hub });

    const pending = bridge.call({ command: { type: "tabs.list" } });
    stub.settle(
      respond(stub.requests[0]?.message.requestId ?? "", {
        ok: false,
        code: "tab_not_live",
        message: "no live page",
      }),
    );

    // Matched by name, not instanceof: no runtime class from here ships to
    // plugins, so `instanceof` would silently never match on their side.
    await expect(pending).rejects.toMatchObject({
      name: "BrowserCommandError",
      code: "tab_not_live",
      message: "no live page",
    });
  });

  it("stops waiting when the caller aborts, and does not touch the page", async () => {
    const { hub, stub } = createHub();
    const bridge = createBrowserBridge({ hub });
    const controller = new AbortController();

    const pending = bridge.call({
      command: { type: "navigation.reload", tabId: null },
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toBeInstanceOf(
      BrowserCommandAbortedError,
    );
    controller.abort();
    await assertion;

    // The command was already sent; abandoning the wait cannot recall it, and
    // the app's eventual reply is dropped by the hub as stale.
    expect(stub.requests).toHaveLength(1);
  });

  it("refuses an already-aborted signal without sending anything", async () => {
    const { hub, stub } = createHub();
    const bridge = createBrowserBridge({ hub });

    await expect(
      bridge.call({
        command: { type: "tabs.list" },
        signal: AbortSignal.abort(),
      }),
    ).rejects.toBeInstanceOf(BrowserCommandAbortedError);
    expect(stub.requests).toHaveLength(0);
  });

  it("propagates a hub failure such as no window being connected", async () => {
    const { hub, stub } = createHub();
    const bridge = createBrowserBridge({ hub });

    const pending = bridge.call({ command: { type: "tabs.list" } });
    stub.fail(
      Object.assign(new Error("No browser window is connected"), {
        name: "BrowserHostUnavailableError",
      }),
    );

    await expect(pending).rejects.toMatchObject({
      name: "BrowserHostUnavailableError",
    });
  });

  it("bounds the timeout a caller can ask for", async () => {
    const { hub, stub } = createHub();
    const bridge = createBrowserBridge({ hub });

    void bridge.call({ command: { type: "tabs.list" } });
    void bridge.call({ command: { type: "tabs.list" }, timeoutMs: 10_000_000 });
    void bridge.call({ command: { type: "tabs.list" }, timeoutMs: 0 });

    expect(stub.requests.map((request) => request.timeoutMs)).toEqual([
      10_000,
      BROWSER_COMMAND_MAX_TIMEOUT_MS,
      1,
    ]);
  });

  it("rejects a command that is not in the contract", async () => {
    const { hub, stub } = createHub();
    const bridge = createBrowserBridge({ hub });

    // Trusted code calls this, but the command it built may have come from a
    // model, so it is parsed on the way out too.
    await expect(
      bridge.call({
        command: { type: "page.eval" } as never,
      }),
    ).rejects.toThrow();
    expect(stub.requests).toHaveLength(0);
  });

  it("reports host status straight through", () => {
    const { hub } = createHub();

    expect(createBrowserBridge({ hub }).status()).toEqual({
      connected: true,
      browserHostId: "window-a",
      hostCount: 1,
    });
  });
});
