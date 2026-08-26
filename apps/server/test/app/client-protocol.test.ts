import { describe, expect, it, vi } from "vitest";
import {
  onClientSocketMessage,
  onClientSocketOpen,
} from "../../src/ws/client-protocol.js";
import { NotificationHub } from "../../src/ws/hub.js";
import { createMockHubSocket } from "../helpers/mock-hub-socket.js";

function createProtocolDeps(hub: NotificationHub) {
  return {
    hub,
    watchInterests: {
      releaseSocket: vi.fn(),
      subscribe: vi.fn(),
      unsubscribe: vi.fn(),
    },
  };
}

describe("client websocket protocol", () => {
  it("subscribes valid client messages parsed through the shared schema", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toHaveLength(0);
    expect(socket.messages).toHaveLength(1);
    expect(JSON.parse(socket.messages[0])).toMatchObject({
      type: "changed",
      entity: "thread",
      id: "thread-1",
      changes: ["events-appended"],
    });
  });

  /**
   * `/ws` is not under `/api/v1`, so the request gate never sees it, and a
   * subscription is the whole of what it carries inward. A plugin subscribing
   * past its grants would be the one unpoliced route to the data the
   * permission names.
   */
  describe("a socket a plugin opened", () => {
    function pluginDeps(hub: NotificationHub, granted: string[]) {
      return {
        ...createProtocolDeps(hub),
        plugins: {
          apiPermissionProblem: (
            _id: string,
            required: readonly string[] | null,
          ) =>
            (required ?? []).every((permission) => granted.includes(permission))
              ? null
              : "missing",
        },
      };
    }

    function subscribe(
      deps: ReturnType<typeof pluginDeps>,
      socket: ReturnType<typeof createMockHubSocket>,
      target: unknown,
    ) {
      onClientSocketMessage(
        deps,
        socket,
        JSON.stringify({ type: "subscribe", target }),
      );
    }

    it("is refused a feed the plugin did not declare", () => {
      const hub = new NotificationHub();
      const warn = vi.fn();
      const deps = { ...pluginDeps(hub, ["workspace"]), logger: { warn } };
      const socket = createMockHubSocket();
      onClientSocketOpen(hub, socket, "notes");

      subscribe(deps, socket, { kind: "thread-detail", threadId: "t1" });
      hub.notifyThread("t1", ["events-appended"]);

      expect(socket.messages).toHaveLength(0);
      // Refused, not fatal: other feeds on this socket keep working.
      expect(socket.closed).toHaveLength(0);
      // And not silent: this protocol has no error frame, so the only way a
      // refusal is findable at all is that the server says it happened.
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("thread-detail"),
      );
    });

    it("keeps the feeds it did declare", () => {
      const hub = new NotificationHub();
      const deps = pluginDeps(hub, ["workspace"]);
      const socket = createMockHubSocket();
      onClientSocketOpen(hub, socket, "notes");

      subscribe(deps, socket, { kind: "host-list" });
      hub.notifyHost("h1", ["host-connected"]);

      expect(socket.messages).toHaveLength(1);
    });

    it("admits the thread feed once the plugin declares it", () => {
      const hub = new NotificationHub();
      const deps = pluginDeps(hub, ["threads"]);
      const socket = createMockHubSocket();
      onClientSocketOpen(hub, socket, "notes");

      subscribe(deps, socket, { kind: "thread-detail", threadId: "t1" });
      hub.notifyThread("t1", ["events-appended"]);

      expect(socket.messages).toHaveLength(1);
    });

    // The app and the CLI open the same endpoint and are not plugins.
    it("leaves a socket nobody claimed alone", () => {
      const hub = new NotificationHub();
      const deps = pluginDeps(hub, []);
      const socket = createMockHubSocket();
      onClientSocketOpen(hub, socket);

      subscribe(deps, socket, { kind: "thread-detail", threadId: "t1" });
      hub.notifyThread("t1", ["events-appended"]);

      expect(socket.messages).toHaveLength(1);
    });
  });

  /**
   * The message next to `subscribe`, which was not gated at all. The browser
   * host answers every browser command the server routes, so claiming the role
   * reads that stream and decides what the model is told the page said.
   */
  describe("claiming the browser host role", () => {
    function register(
      deps: ReturnType<typeof createProtocolDeps> & {
        logger: { warn: (message: string) => void };
      },
      socket: ReturnType<typeof createMockHubSocket>,
      browserHostId: string,
    ) {
      onClientSocketMessage(
        deps,
        socket,
        JSON.stringify({ type: "browser-host.register", browserHostId }),
      );
    }

    it("refuses a plugin's claim to be the browser", () => {
      const hub = new NotificationHub();
      const warn = vi.fn();
      const deps = { ...createProtocolDeps(hub), logger: { warn } };
      const socket = createMockHubSocket();
      onClientSocketOpen(hub, socket, "notes");

      register(deps, socket, "not-the-browser");

      // Nothing is registered at all, not even behind the app: a plugin does
      // not serve browser commands, it makes them through `patcher.browser`
      // and is charged the permission there.
      expect(hub.getBrowserHostSnapshot()).toEqual({
        connected: false,
        browserHostId: null,
        hostCount: 0,
      });
      // Refused, not fatal — the same treatment a subscription it may not have
      // gets, and for the same reason.
      expect(socket.closed).toHaveLength(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("notes"));
    });

    it("leaves the app window driving when a plugin asks for the role", () => {
      const hub = new NotificationHub();
      const deps = { ...createProtocolDeps(hub), logger: { warn: vi.fn() } };
      const app = createMockHubSocket();
      const plugin = createMockHubSocket();
      onClientSocketOpen(hub, app);
      onClientSocketOpen(hub, plugin, "notes");

      register(deps, app, "window-a");
      register(deps, plugin, "not-the-browser");

      expect(hub.getBrowserHostSnapshot()).toEqual({
        connected: true,
        browserHostId: "window-a",
        hostCount: 1,
      });
    });

    it("records a second window as waiting rather than driving", () => {
      const hub = new NotificationHub();
      const warn = vi.fn();
      const deps = { ...createProtocolDeps(hub), logger: { warn } };
      const first = createMockHubSocket();
      const second = createMockHubSocket();
      onClientSocketOpen(hub, first);
      onClientSocketOpen(hub, second);

      register(deps, first, "window-a");
      register(deps, second, "window-b");

      expect(hub.getBrowserHostSnapshot()).toEqual({
        connected: true,
        browserHostId: "window-a",
        hostCount: 2,
      });
      // `hostCount` is the only other trace of a window that serves nothing,
      // so the log is what answers "why is the agent driving my other window".
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("window-b registered behind window-a"),
      );
    });
  });

  it("rejects subscribe messages whose target id is not a string", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: 123 },
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(socket.messages).toHaveLength(0);
  });

  it("removes subscriptions after unsubscribe messages", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "unsubscribe",
        target: { kind: "thread-detail", threadId: "thread-1" },
      }),
    );
    hub.notifyThread("thread-1", ["events-appended"]);

    expect(socket.closed).toHaveLength(0);
    expect(socket.messages).toHaveLength(0);
  });

  it("rejects subscribe messages for unknown targets", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "bogus" },
      }),
    );

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(socket.messages).toHaveLength(0);
  });

  it("rejects client messages with missing required fields", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
      }),
    );

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(socket.messages).toHaveLength(0);
  });

  it("closes the socket instead of throwing on malformed JSON", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);

    expect(() => onClientSocketMessage(deps, socket, "{")).not.toThrow();
    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
  });

  it("updates watch interests from subscribe and unsubscribe messages", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "subscribe",
        target: { kind: "environment-detail", environmentId: "env-1" },
      }),
    );
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "unsubscribe",
        target: { kind: "environment-detail", environmentId: "env-1" },
      }),
    );

    expect(deps.watchInterests.subscribe).toHaveBeenCalledWith(socket, {
      kind: "environment-detail",
      environmentId: "env-1",
    });
    expect(deps.watchInterests.unsubscribe).toHaveBeenCalledWith(socket, {
      kind: "environment-detail",
      environmentId: "env-1",
    });
  });

  it("rejects direct watch messages", () => {
    const hub = new NotificationHub();
    const deps = createProtocolDeps(hub);
    const socket = createMockHubSocket();

    onClientSocketOpen(hub, socket);
    onClientSocketMessage(
      deps,
      socket,
      JSON.stringify({
        type: "watch.acquire",
        target: {
          kind: "environment-workspace",
          environmentId: "env-1",
        },
      }),
    );

    expect(socket.closed).toEqual([{ code: 1008, reason: "invalid-message" }]);
    expect(deps.watchInterests.subscribe).not.toHaveBeenCalled();
  });
});
