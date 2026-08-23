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
