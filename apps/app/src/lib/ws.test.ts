import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientMessageSchema, type ClientMessage } from "@patcher/domain";
import type { RealtimeSubscriptionTarget } from "@patcher/server-contract";

const fakeSocketState = vi.hoisted(() => {
  type CloseHandler = () => void;
  type MessageHandler = (event: MessageEvent) => void;
  type OpenHandler = () => void;

  class FakeReconnectingWebSocket {
    onclose: CloseHandler | null = null;
    onmessage: MessageHandler | null = null;
    onopen: OpenHandler | null = null;
    readyState = 1;
    readonly sentMessages: string[] = [];

    constructor() {
      instances.push(this);
    }

    close(): void {
      this.readyState = 3;
      this.onclose?.();
    }

    open(): void {
      this.readyState = 1;
      this.onopen?.();
    }

    send(data: string): void {
      this.sentMessages.push(data);
    }
  }

  const instances: FakeReconnectingWebSocket[] = [];

  return {
    FakeReconnectingWebSocket,
    instances,
  };
});

vi.mock("partysocket/ws", () => ({
  default: fakeSocketState.FakeReconnectingWebSocket,
}));

vi.mock("./dev-websocket-url", () => ({
  buildDevWebSocketUrl: () => "ws://patcher.test/ws",
}));

import { WebSocketManager } from "./ws";

const THREAD_TARGET = {
  kind: "thread-detail",
  threadId: "thr_1",
} satisfies RealtimeSubscriptionTarget;
const PROJECT_TARGET = {
  kind: "project-list",
} satisfies RealtimeSubscriptionTarget;

interface ConnectedManager {
  manager: WebSocketManager;
  socket: FakeSocket;
}

interface FakeSocket {
  readonly sentMessages: string[];
  close: () => void;
  open: () => void;
}

function installOpenWebSocketConstructor(): void {
  Object.defineProperty(globalThis, "WebSocket", {
    configurable: true,
    value: {
      OPEN: 1,
    },
  });
}

function readClientMessages(socket: FakeSocket): readonly ClientMessage[] {
  return socket.sentMessages.map((message) =>
    clientMessageSchema.parse(JSON.parse(message)),
  );
}

function getOnlySocket(): FakeSocket {
  const socket = fakeSocketState.instances[0];
  if (!socket) {
    throw new Error("Expected websocket to be created");
  }
  return socket;
}

function createConnectedManager(): ConnectedManager {
  const manager = new WebSocketManager();
  manager.connect();
  const socket = getOnlySocket();
  socket.open();
  return { manager, socket };
}

describe("WebSocketManager subscriptions", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    fakeSocketState.instances.length = 0;
    installOpenWebSocketConstructor();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
  });

  it("ref-counts duplicate subscriptions and unsubscribes only after the final cleanup", () => {
    const { manager, socket } = createConnectedManager();

    manager.subscribe(THREAD_TARGET);
    manager.subscribe(THREAD_TARGET);

    expect(readClientMessages(socket)).toEqual([
      {
        type: "subscribe",
        target: THREAD_TARGET,
      },
    ]);

    manager.unsubscribe(THREAD_TARGET);

    expect(readClientMessages(socket)).toEqual([
      {
        type: "subscribe",
        target: THREAD_TARGET,
      },
    ]);

    manager.unsubscribe(THREAD_TARGET);

    expect(readClientMessages(socket)).toEqual([
      {
        type: "subscribe",
        target: THREAD_TARGET,
      },
      {
        type: "unsubscribe",
        target: THREAD_TARGET,
      },
    ]);
  });

  it("resends active subscriptions when the websocket reconnects", () => {
    const { manager, socket } = createConnectedManager();

    manager.subscribe(THREAD_TARGET);
    manager.subscribe(PROJECT_TARGET);
    socket.sentMessages.length = 0;

    socket.close();
    socket.open();

    expect(readClientMessages(socket)).toEqual([
      {
        type: "subscribe",
        target: THREAD_TARGET,
      },
      {
        type: "subscribe",
        target: PROJECT_TARGET,
      },
    ]);
  });
});

describe("WebSocketManager thread-open signals", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    fakeSocketState.instances.length = 0;
    installOpenWebSocketConstructor();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
  });

  function dispatchRaw(payload: unknown): void {
    const instance = fakeSocketState.instances[0];
    if (!instance) {
      throw new Error("Expected websocket instance");
    }
    instance.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  it("notifies layout listeners and buffers an included file once", () => {
    const { manager } = createConnectedManager();
    const threadOpen = vi.fn();
    const changed = vi.fn();
    manager.onThreadOpen(threadOpen);
    manager.onChanged(changed);

    const signal = {
      type: "thread-open",
      projectId: "proj_1",
      threadId: "thr_1",
      split: "right",
      file: {
        source: "workspace",
        path: "src/index.ts",
        lineNumber: 7,
      },
    };
    dispatchRaw(signal);

    expect(threadOpen).toHaveBeenCalledWith(signal);
    expect(changed).not.toHaveBeenCalled();
    expect(manager.consumePendingOpenFile("thr_1")).toEqual(signal.file);
    // Consumed exactly once: a later visit does not re-open.
    expect(manager.consumePendingOpenFile("thr_1")).toBeNull();
  });

  it("still routes changed messages to onChanged", () => {
    const { manager } = createConnectedManager();
    const changed = vi.fn();
    const threadOpen = vi.fn();
    manager.onChanged(changed);
    manager.onThreadOpen(threadOpen);

    dispatchRaw({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      changes: ["events-appended"],
    });

    expect(changed).toHaveBeenCalledTimes(1);
    expect(threadOpen).not.toHaveBeenCalled();
  });

  it("routes typed thread-pane actions separately", () => {
    const { manager } = createConnectedManager();
    const paneAction = vi.fn();
    const threadOpen = vi.fn();
    manager.onThreadPaneAction(paneAction);
    manager.onThreadOpen(threadOpen);

    const signal = {
      type: "thread-pane-action",
      projectId: "proj_1",
      threadId: "thr_1",
      action: "maximize",
    } as const;
    dispatchRaw(signal);

    expect(paneAction).toHaveBeenCalledWith(signal);
    expect(threadOpen).not.toHaveBeenCalled();
  });
});

describe("WebSocketManager browser commands", () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    fakeSocketState.instances.length = 0;
    installOpenWebSocketConstructor();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      value: originalWebSocket,
    });
  });

  function dispatchRaw(payload: unknown): void {
    const instance = fakeSocketState.instances[0];
    if (!instance) {
      throw new Error("Expected websocket instance");
    }
    instance.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }

  it("routes an agent browser command to its own subscribers only", () => {
    const { manager } = createConnectedManager();
    const browserCommand = vi.fn();
    const changed = vi.fn();
    const pluginSignal = vi.fn();
    manager.onBrowserCommand(browserCommand);
    manager.onChanged(changed);
    manager.onPluginSignal(pluginSignal);

    const signal = {
      type: "browser-command-request",
      requestId: "req_1",
      command: { type: "tabs.list" },
    } as const;
    dispatchRaw(signal);

    expect(browserCommand).toHaveBeenCalledWith(signal);
    expect(changed).not.toHaveBeenCalled();
    expect(pluginSignal).not.toHaveBeenCalled();
  });

  it("keeps the issuer the server named on a browser command", () => {
    // The lenient parse strips what it does not name, so leaving `issuer` out
    // of that schema is indistinguishable from a server that never sent it —
    // and the indicator in the browser chrome would simply never appear.
    const { manager } = createConnectedManager();
    const browserCommand = vi.fn();
    manager.onBrowserCommand(browserCommand);

    dispatchRaw({
      type: "browser-command-request",
      requestId: "req_2",
      command: { type: "tabs.list" },
      issuer: {
        kind: "grant",
        grantId: "bag_1",
        label: "Claude Code",
        level: "read",
      },
    });

    expect(browserCommand.mock.calls[0]?.[0]?.issuer).toEqual({
      kind: "grant",
      grantId: "bag_1",
      label: "Claude Code",
      level: "read",
    });
  });

  it("still runs a command whose issuer is from a newer server", () => {
    // The union is closed, and a signal this schema rejects is dropped whole by
    // the dispatcher — so a fourth issuer kind would stop an older app from
    // answering browser commands at all and every tool call would time out.
    // Losing the indicator is the failure this lenient copy is for.
    const { manager } = createConnectedManager();
    const browserCommand = vi.fn();
    manager.onBrowserCommand(browserCommand);

    dispatchRaw({
      type: "browser-command-request",
      requestId: "req_3",
      command: { type: "tabs.list" },
      issuer: { kind: "plugin", pluginId: "something-new" },
    });

    expect(browserCommand).toHaveBeenCalledTimes(1);
    expect(browserCommand.mock.calls[0]?.[0]?.requestId).toBe("req_3");
    expect(browserCommand.mock.calls[0]?.[0]?.issuer).toBeUndefined();
  });

  it("routes who-is-driving to its own subscribers, and never as a command", () => {
    // The two signals are one fact from two sides: the window that has to
    // perform the command gets the command, every other window gets this. A
    // window that handled this one as a command would try to perform a browser
    // action nobody sent it.
    const { manager } = createConnectedManager();
    const driving = vi.fn();
    const browserCommand = vi.fn();
    const changed = vi.fn();
    manager.onBrowserDriving(driving);
    manager.onBrowserCommand(browserCommand);
    manager.onChanged(changed);

    const signal = {
      type: "browser-driving",
      requestId: "req_1",
      phase: "started",
      issuer: { kind: "outside" },
    } as const;
    dispatchRaw(signal);

    expect(driving).toHaveBeenCalledWith(signal);
    expect(browserCommand).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });

  it("takes a driving signal that is missing the half it can do without", () => {
    // The one place the strict and lenient schemas of this signal disagree on
    // purpose. A `started` the server built always names the command and a
    // `settled` always reports an outcome or the absence of one — but a window
    // loaded from a server that predates those fields would otherwise drop the
    // frame entirely, and who is driving is the whole signal.
    const { manager } = createConnectedManager();
    const driving = vi.fn();
    const changed = vi.fn();
    manager.onBrowserDriving(driving);
    manager.onChanged(changed);

    dispatchRaw({
      type: "browser-driving",
      requestId: "req_4",
      phase: "settled",
      issuer: { kind: "outside" },
    });

    expect(driving).toHaveBeenCalledTimes(1);
    expect(driving.mock.calls[0]?.[0]?.outcome).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
  });

  it("carries what the command did through to the subscriber", () => {
    const { manager } = createConnectedManager();
    const driving = vi.fn();
    manager.onBrowserDriving(driving);

    const signal = {
      type: "browser-driving",
      requestId: "req_5",
      phase: "settled",
      issuer: { kind: "outside" },
      outcome: { ok: false, error: "tab_not_found" },
    } as const;
    dispatchRaw(signal);

    // Passed on whole rather than reduced to a boolean here: the window's
    // record shows the code, and this is the only place it can come from.
    expect(driving).toHaveBeenCalledWith(signal);
  });

  it("drops a driving signal it cannot read, and drives nothing on it", () => {
    // Unlike a command, there is nothing here to degrade to: the whole content
    // is who is driving, so an issuer kind this app does not know leaves
    // nothing to show and the signal is dropped — no indicator, which is what
    // this window showed before the signal existed. It falls through to the
    // changed-message parser like any unrecognised message and is logged there;
    // asserted rather than prevented, because that is what this app does with
    // every message a newer server invents.
    const { manager } = createConnectedManager();
    const driving = vi.fn();
    const changed = vi.fn();
    manager.onBrowserDriving(driving);
    manager.onChanged(changed);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    dispatchRaw({
      type: "browser-driving",
      requestId: "req_2",
      phase: "started",
      issuer: { kind: "plugin", pluginId: "something-new" },
    });

    expect(driving).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  it("re-announces the browser host after a reconnect", () => {
    const { manager, socket } = createConnectedManager();
    manager.registerBrowserHost("window-a");

    expect(socket.sentMessages.map((raw) => JSON.parse(raw) as { type: string })).toEqual([
      { type: "browser-host.register", browserHostId: "window-a" },
    ]);

    // Registration is per-connection server-side, so a reconnect that did not
    // re-announce would silently leave agents with no browser to drive.
    socket.sentMessages.length = 0;
    socket.open();
    expect(socket.sentMessages.map((raw) => JSON.parse(raw) as { type: string })).toEqual([
      { type: "browser-host.register", browserHostId: "window-a" },
    ]);
  });

  it("sends a response the server can correlate", () => {
    const { manager, socket } = createConnectedManager();

    manager.sendBrowserCommandResponse({
      type: "browser-command.response",
      requestId: "req_1",
      outcome: { ok: true, value: { type: "tabs", tabs: [] } },
    });

    expect(JSON.parse(socket.sentMessages[0] ?? "null")).toEqual({
      type: "browser-command.response",
      requestId: "req_1",
      outcome: { ok: true, value: { type: "tabs", tabs: [] } },
    });
  });
});
