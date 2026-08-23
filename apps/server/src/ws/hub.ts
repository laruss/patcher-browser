import { Buffer } from "node:buffer";
import {
  realtimeSubscriptionTargetKey as subscriptionKey,
  type RealtimeSubscriptionTarget,
  type ChangedMessage,
  type EnvironmentChangeKind,
  type HostChangeKind,
  type ProjectChangeKind,
  type SystemChangeKind,
  type BrowserCommandResponseMessage,
  type ThreadChangeKind,
  type ThreadChangeMetadata,
} from "@patcher/domain";
import type { DbNotifier } from "@patcher/db";
import type {
  HostPlatform,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResponseMessage,
  HostDaemonServerWsMessage,
  HostDaemonSessionCloseReason,
} from "@patcher/host-daemon-contract";
import {
  browserCommandRequestSignalSchema,
  pluginSignalSchema,
  serverMessageSchema,
  terminalServerMessageSchema,
  threadOpenSignalSchema,
  threadPaneActionSignalSchema,
  type BrowserCommandRequestSignal,
  type ThreadPaneAction,
  type ThreadOpenFile,
  type ThreadOpenSplit,
  type TerminalServerMessage,
} from "@patcher/server-contract";

const TERMINAL_SOCKET_HIGH_WATER_BYTES = 1024 * 1024;
// A 16 MiB raw burst expands to about 21.4 MiB as base64 + JSON. Keep
// enough bounded headroom for that workload while preventing unbounded growth.
const TERMINAL_SOCKET_MAX_QUEUE_BYTES = 32 * 1024 * 1024;
const TERMINAL_SOCKET_DRAIN_POLL_MS = 10;

interface HubSocket {
  close(code?: number, reason?: string): void;
  raw?: { bufferedAmount: number };
  send(data: string): void;
}

interface TerminalSocketSendQueue {
  bytes: number;
  payloads: string[];
  timeout: ReturnType<typeof setTimeout> | null;
}

type ChangedMessageListener = (message: ChangedMessage) => void;

/**
 * Something changed about which app windows can serve browser commands.
 *
 * No payload: a listener that cares reads `getBrowserHostSnapshot()`, which is
 * the one answer, rather than being handed a copy that could disagree with it.
 */
type BrowserHostsChangedListener = () => void;

function subscriptionKeysForMessage(message: ChangedMessage): string[] {
  switch (message.entity) {
    case "thread":
      return message.id
        ? [
            subscriptionKey({ kind: "thread-list" }),
            subscriptionKey({ kind: "thread-detail", threadId: message.id }),
          ]
        : [subscriptionKey({ kind: "thread-list" })];
    case "project":
      return message.id
        ? [
            subscriptionKey({ kind: "project-list" }),
            subscriptionKey({ kind: "project-detail", projectId: message.id }),
          ]
        : [subscriptionKey({ kind: "project-list" })];
    case "environment":
      return message.id
        ? [
            subscriptionKey({ kind: "environment-list" }),
            subscriptionKey({
              kind: "environment-detail",
              environmentId: message.id,
            }),
          ]
        : [subscriptionKey({ kind: "environment-list" })];
    case "host":
      return message.id
        ? [
            subscriptionKey({ kind: "host-list" }),
            subscriptionKey({ kind: "host-detail", hostId: message.id }),
          ]
        : [subscriptionKey({ kind: "host-list" })];
    case "system":
      return [subscriptionKey({ kind: "system" })];
  }
}

interface ThreadEventWaiter {
  reject: (reason?: Error) => void;
  resolve: (notified: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface HostEventWaiter {
  reject: (reason?: Error) => void;
  resolve: (notified: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface DaemonRegistrationWaiter {
  resolve: (registered: boolean) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface HostOnlineRpcWaiter {
  reject: (reason?: Error) => void;
  resolve: (message: HostDaemonOnlineRpcResponseMessage) => void;
  sessionId: string;
  timeout: ReturnType<typeof setTimeout>;
}

export interface RecordHostOnlineRpcResponseArgs {
  message: HostDaemonOnlineRpcResponseMessage;
  sessionId: string;
}

export type HostOnlineRpcResponseDisposition =
  | { handled: true }
  | { handled: false; reason: "stale" }
  | {
      expectedSessionId: string;
      handled: false;
      reason: "session_mismatch";
    };

export class HostOnlineRpcTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for host RPC response");
    this.name = "HostOnlineRpcTimeoutError";
  }
}

export class HostOnlineRpcUnavailableError extends Error {
  constructor() {
    super("Host daemon is not connected");
    this.name = "HostOnlineRpcUnavailableError";
  }
}

interface BrowserHostRegistration {
  browserHostId: string;
  socket: HubSocket;
}

interface BrowserCommandWaiter {
  reject: (reason?: Error) => void;
  resolve: (message: BrowserCommandResponseMessage) => void;
  /** The socket the request went to — the analogue of the RPC waiter's session. */
  socket: HubSocket;
  timeout: ReturnType<typeof setTimeout>;
}

export interface RecordBrowserCommandResponseArgs {
  message: BrowserCommandResponseMessage;
  socket: HubSocket;
}

export type BrowserCommandResponseDisposition =
  | { handled: true }
  | { handled: false; reason: "stale" }
  | { handled: false; reason: "host_mismatch" };

export interface BrowserHostSnapshot {
  connected: boolean;
  browserHostId: string | null;
  /** How many app windows could serve browser commands right now. */
  hostCount: number;
}

export class BrowserCommandTimeoutError extends Error {
  constructor() {
    super("Timed out waiting for the browser to answer");
    this.name = "BrowserCommandTimeoutError";
  }
}

export class BrowserHostUnavailableError extends Error {
  constructor() {
    super("No browser window is connected");
    this.name = "BrowserHostUnavailableError";
  }
}

export class NotificationHub implements DbNotifier {
  private readonly clientKeysBySocket = new Map<HubSocket, Set<string>>();
  /**
   * Which plugin owns a socket, for sockets that said. Absent means the app,
   * the CLI, or anything else local — the same reading the request gate gives
   * an unidentified call.
   */
  private readonly pluginIdBySocket = new WeakMap<HubSocket, string>();
  private readonly clientSocketsByKey = new Map<string, Set<HubSocket>>();
  private readonly daemonSessions = new Map<
    string,
    { hostId: string; platform: HostPlatform; socket: HubSocket }
  >();
  private readonly daemonSessionPlatformsBySessionId = new Map<
    string,
    HostPlatform
  >();
  private readonly daemonRegistrationWaiters = new Map<
    string,
    Set<DaemonRegistrationWaiter>
  >();
  private readonly daemonSessionIdsByHost = new Map<string, string>();
  private readonly hostEventWaiters = new Map<string, Set<HostEventWaiter>>();
  private readonly hostOnlineRpcWaiters = new Map<
    string,
    HostOnlineRpcWaiter
  >();
  /**
   * App sockets that can drive a browser surface. Insertion-ordered, and a
   * re-registration deletes before it sets, so **the last entry is the primary
   * host** — the window the user most recently connected (or refocused) is the
   * one an agent drives. Same "latest client wins" rule terminal resize
   * ownership already uses.
   */
  private readonly browserHosts = new Map<HubSocket, BrowserHostRegistration>();
  private readonly browserCommandWaiters = new Map<
    string,
    BrowserCommandWaiter
  >();
  private readonly hostProtocolUpdateRetryRequests = new Set<string>();
  private readonly changedMessageListeners = new Set<ChangedMessageListener>();
  private readonly browserHostsChangedListeners =
    new Set<BrowserHostsChangedListener>();
  private readonly pendingDaemonDisconnects = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly pendingDaemonActiveWorkDisconnects = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly terminalClientSocketsById = new Map<
    string,
    Set<HubSocket>
  >();
  private readonly terminalSocketSendQueues = new Map<
    HubSocket,
    TerminalSocketSendQueue
  >();
  private readonly terminalIdsByClientSocket = new Map<
    HubSocket,
    Set<string>
  >();
  private readonly terminalResizeOwnerById = new Map<string, HubSocket>();
  private readonly threadEventWaiters = new Map<
    string,
    Set<ThreadEventWaiter>
  >();

  registerClient(socket: HubSocket, pluginId?: string): void {
    if (!this.clientKeysBySocket.has(socket)) {
      this.clientKeysBySocket.set(socket, new Set());
    }
    if (pluginId !== undefined) {
      this.pluginIdBySocket.set(socket, pluginId);
    }
  }

  /** The plugin that opened this socket, or null for everyone else. */
  pluginIdForSocket(socket: HubSocket): string | null {
    return this.pluginIdBySocket.get(socket) ?? null;
  }

  unregisterClient(socket: HubSocket): void {
    this.unregisterTerminalClientSocket(socket);
    // Before the early return below: a socket that never subscribed to anything
    // can still be the browser host, and its in-flight commands must be failed
    // rather than left to time out.
    this.unregisterBrowserHost(socket);
    const keys = this.clientKeysBySocket.get(socket);
    if (!keys) {
      return;
    }

    for (const key of keys) {
      const sockets = this.clientSocketsByKey.get(key);
      if (!sockets) {
        continue;
      }
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.clientSocketsByKey.delete(key);
      }
    }

    this.clientKeysBySocket.delete(socket);
  }

  onChangedMessage(listener: ChangedMessageListener): () => void {
    this.changedMessageListeners.add(listener);
    return () => {
      this.changedMessageListeners.delete(listener);
    };
  }

  registerTerminalClient(terminalId: string, socket: HubSocket): void {
    const sockets =
      this.terminalClientSocketsById.get(terminalId) ?? new Set<HubSocket>();
    sockets.add(socket);
    this.terminalClientSocketsById.set(terminalId, sockets);

    const terminalIds =
      this.terminalIdsByClientSocket.get(socket) ?? new Set<string>();
    terminalIds.add(terminalId);
    this.terminalIdsByClientSocket.set(socket, terminalIds);
  }

  claimTerminalResizeOwnership(terminalId: string, socket: HubSocket): void {
    this.terminalResizeOwnerById.set(terminalId, socket);
  }

  isTerminalResizeOwner(terminalId: string, socket: HubSocket): boolean {
    return this.terminalResizeOwnerById.get(terminalId) === socket;
  }

  unregisterTerminalClient(terminalId: string, socket: HubSocket): void {
    const sockets = this.terminalClientSocketsById.get(terminalId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.terminalClientSocketsById.delete(terminalId);
      }
    }
    this.releaseTerminalResizeOwnership(terminalId, socket, sockets);

    const terminalIds = this.terminalIdsByClientSocket.get(socket);
    if (!terminalIds) {
      return;
    }
    terminalIds.delete(terminalId);
    if (terminalIds.size === 0) {
      this.terminalIdsByClientSocket.delete(socket);
      this.clearTerminalSocketSendQueue(socket);
    }
  }

  unregisterTerminalClientSocket(socket: HubSocket): void {
    const terminalIds = this.terminalIdsByClientSocket.get(socket);
    if (!terminalIds) {
      return;
    }

    for (const terminalId of terminalIds) {
      const sockets = this.terminalClientSocketsById.get(terminalId);
      if (!sockets) {
        continue;
      }
      sockets.delete(socket);
      if (sockets.size === 0) {
        this.terminalClientSocketsById.delete(terminalId);
      }
      this.releaseTerminalResizeOwnership(terminalId, socket, sockets);
    }

    this.terminalIdsByClientSocket.delete(socket);
    this.clearTerminalSocketSendQueue(socket);
  }

  private releaseTerminalResizeOwnership(
    terminalId: string,
    socket: HubSocket,
    sockets: Set<HubSocket> | undefined,
  ): void {
    if (this.terminalResizeOwnerById.get(terminalId) !== socket) {
      return;
    }
    let replacement: HubSocket | undefined;
    for (const candidate of sockets ?? []) {
      replacement = candidate;
    }
    if (replacement === undefined) {
      this.terminalResizeOwnerById.delete(terminalId);
    } else {
      this.terminalResizeOwnerById.set(terminalId, replacement);
    }
  }

  sendTerminalSocketMessage(
    socket: HubSocket,
    message: TerminalServerMessage,
  ): void {
    this.sendOrQueueTerminalPayload(
      socket,
      JSON.stringify(terminalServerMessageSchema.parse(message)),
    );
  }

  sendTerminalClientMessage(
    terminalId: string,
    message: TerminalServerMessage,
  ): void {
    const sockets = this.terminalClientSocketsById.get(terminalId);
    if (!sockets) {
      return;
    }

    const payload = JSON.stringify(terminalServerMessageSchema.parse(message));
    for (const socket of [...sockets]) {
      this.sendOrQueueTerminalPayload(socket, payload);
    }
  }

  private sendOrQueueTerminalPayload(socket: HubSocket, payload: string): void {
    const existingQueue = this.terminalSocketSendQueues.get(socket);
    if (
      !existingQueue &&
      (socket.raw?.bufferedAmount ?? 0) <= TERMINAL_SOCKET_HIGH_WATER_BYTES
    ) {
      try {
        socket.send(payload);
        return;
      } catch {
        this.dropTerminalSocket(socket, "terminal-send-failed");
        return;
      }
    }

    const queue = existingQueue ?? {
      bytes: 0,
      payloads: [],
      timeout: null,
    };
    const payloadBytes = Buffer.byteLength(payload, "utf8");
    if (queue.bytes + payloadBytes > TERMINAL_SOCKET_MAX_QUEUE_BYTES) {
      this.dropTerminalSocket(socket, "terminal-backpressure");
      return;
    }
    queue.payloads.push(payload);
    queue.bytes += payloadBytes;
    this.terminalSocketSendQueues.set(socket, queue);
    this.scheduleTerminalSocketDrain(socket, queue);
  }

  private scheduleTerminalSocketDrain(
    socket: HubSocket,
    queue: TerminalSocketSendQueue,
  ): void {
    if (queue.timeout !== null) {
      return;
    }
    queue.timeout = setTimeout(() => {
      queue.timeout = null;
      this.flushTerminalSocketQueue(socket, queue);
    }, TERMINAL_SOCKET_DRAIN_POLL_MS);
  }

  private flushTerminalSocketQueue(
    socket: HubSocket,
    queue: TerminalSocketSendQueue,
  ): void {
    if (this.terminalSocketSendQueues.get(socket) !== queue) {
      return;
    }
    while (
      queue.payloads.length > 0 &&
      (socket.raw?.bufferedAmount ?? 0) <= TERMINAL_SOCKET_HIGH_WATER_BYTES
    ) {
      const payload = queue.payloads[0];
      if (payload === undefined) {
        break;
      }
      try {
        socket.send(payload);
      } catch {
        this.dropTerminalSocket(socket, "terminal-send-failed");
        return;
      }
      queue.payloads.shift();
      queue.bytes -= Buffer.byteLength(payload, "utf8");
    }
    if (queue.payloads.length === 0) {
      this.clearTerminalSocketSendQueue(socket);
      return;
    }
    this.scheduleTerminalSocketDrain(socket, queue);
  }

  private dropTerminalSocket(socket: HubSocket, reason: string): void {
    this.unregisterTerminalClientSocket(socket);
    try {
      socket.close(1013, reason);
    } catch {
      // The socket is already unusable; registration and queue state are gone.
    }
  }

  private clearTerminalSocketSendQueue(socket: HubSocket): void {
    const queue = this.terminalSocketSendQueues.get(socket);
    if (!queue) {
      return;
    }
    if (queue.timeout !== null) {
      clearTimeout(queue.timeout);
    }
    this.terminalSocketSendQueues.delete(socket);
  }

  subscribe(socket: HubSocket, target: RealtimeSubscriptionTarget): void {
    this.registerClient(socket);
    const key = subscriptionKey(target);
    this.clientKeysBySocket.get(socket)?.add(key);

    const sockets = this.clientSocketsByKey.get(key) ?? new Set<HubSocket>();
    sockets.add(socket);
    this.clientSocketsByKey.set(key, sockets);
  }

  unsubscribe(socket: HubSocket, target: RealtimeSubscriptionTarget): void {
    const key = subscriptionKey(target);
    this.clientKeysBySocket.get(socket)?.delete(key);

    const sockets = this.clientSocketsByKey.get(key);
    if (!sockets) {
      return;
    }
    sockets.delete(socket);
    if (sockets.size === 0) {
      this.clientSocketsByKey.delete(key);
    }
  }

  recordDaemonSessionPlatform(sessionId: string, platform: HostPlatform): void {
    this.daemonSessionPlatformsBySessionId.set(sessionId, platform);
  }

  registerDaemon(sessionId: string, hostId: string, socket: HubSocket): void {
    this.cancelPendingDaemonDisconnect(sessionId);
    const existingSessionId = this.daemonSessionIdsByHost.get(hostId);
    if (existingSessionId && existingSessionId !== sessionId) {
      this.cancelPendingDaemonDisconnect(existingSessionId);
      this.unregisterDaemon(existingSessionId);
    }
    this.daemonSessions.set(sessionId, {
      hostId,
      platform:
        this.daemonSessionPlatformsBySessionId.get(sessionId) ?? "unknown",
      socket,
    });
    this.daemonSessionIdsByHost.set(hostId, sessionId);
    this.resolveDaemonRegistrationWaiters(hostId);
    // Broadcast only now that the socket is registered: host status derives
    // from this registration, so any earlier host-connected (e.g. at session
    // open) races clients into refetching a still-"disconnected" /hosts and
    // caching it as fresh.
    this.notifyHost(hostId, ["host-connected"]);
  }

  unregisterDaemon(sessionId: string): void {
    const entry = this.daemonSessions.get(sessionId);
    if (!entry) {
      return;
    }
    this.daemonSessions.delete(sessionId);
    this.daemonSessionPlatformsBySessionId.delete(sessionId);
    this.rejectHostOnlineRpcWaitersForSession(sessionId);
    if (this.daemonSessionIdsByHost.get(entry.hostId) === sessionId) {
      this.daemonSessionIdsByHost.delete(entry.hostId);
    }
  }

  hasDaemonForHost(hostId: string): boolean {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    return sessionId !== undefined && this.daemonSessions.has(sessionId);
  }

  getDaemonSessionIdForHost(hostId: string): string | null {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    if (!sessionId || !this.daemonSessions.has(sessionId)) {
      return null;
    }
    return sessionId;
  }

  getDaemonPlatformForHost(hostId: string): HostPlatform | null {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    if (!sessionId) {
      return null;
    }
    return this.daemonSessions.get(sessionId)?.platform ?? null;
  }

  async waitForDaemonForHost(
    hostId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    if (this.hasDaemonForHost(hostId)) {
      return true;
    }

    return new Promise<boolean>((resolve) => {
      const waiter: DaemonRegistrationWaiter = {
        resolve,
        timeout: setTimeout(() => {
          this.deleteDaemonRegistrationWaiter(hostId, waiter);
          resolve(false);
        }, timeoutMs),
      };
      const waiters =
        this.daemonRegistrationWaiters.get(hostId) ??
        new Set<DaemonRegistrationWaiter>();
      waiters.add(waiter);
      this.daemonRegistrationWaiters.set(hostId, waiters);
    });
  }

  closeDaemonSession(
    sessionId: string,
    reason: HostDaemonSessionCloseReason,
  ): void {
    const entry = this.daemonSessions.get(sessionId);
    if (entry) {
      entry.socket.send(JSON.stringify({ type: "session-close", reason }));
    }
    this.closeDaemonSessionSocket(sessionId, reason);
  }

  closeDaemonSessionSocket(
    sessionId: string,
    reason: HostDaemonSessionCloseReason,
  ): void {
    this.cancelPendingDaemonDisconnect(sessionId);
    const entry = this.daemonSessions.get(sessionId);
    if (!entry) {
      return;
    }
    entry.socket.close(1000, reason);
    this.unregisterDaemon(sessionId);
  }

  scheduleDaemonDisconnect(
    sessionId: string,
    delayMs: number,
    callback: () => void,
  ): void {
    this.cancelPendingDaemonDisconnectGrace(sessionId);
    const timeout = setTimeout(() => {
      this.pendingDaemonDisconnects.delete(sessionId);
      callback();
    }, delayMs);
    this.pendingDaemonDisconnects.set(sessionId, timeout);
  }

  scheduleDaemonActiveWorkDisconnect(
    sessionId: string,
    delayMs: number,
    callback: () => void,
  ): void {
    this.cancelPendingDaemonActiveWorkDisconnect(sessionId);
    const timeout = setTimeout(() => {
      this.pendingDaemonActiveWorkDisconnects.delete(sessionId);
      callback();
    }, delayMs);
    this.pendingDaemonActiveWorkDisconnects.set(sessionId, timeout);
  }

  private cancelPendingDaemonDisconnectGrace(sessionId: string): void {
    const timeout = this.pendingDaemonDisconnects.get(sessionId);
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    this.pendingDaemonDisconnects.delete(sessionId);
  }

  private cancelPendingDaemonActiveWorkDisconnect(sessionId: string): void {
    const timeout = this.pendingDaemonActiveWorkDisconnects.get(sessionId);
    if (!timeout) {
      return;
    }
    clearTimeout(timeout);
    this.pendingDaemonActiveWorkDisconnects.delete(sessionId);
  }

  cancelPendingDaemonDisconnect(sessionId: string): void {
    this.cancelPendingDaemonDisconnectGrace(sessionId);
    this.cancelPendingDaemonActiveWorkDisconnect(sessionId);
  }

  async waitForThreadEvent(
    threadId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const { promise } = this.registerThreadEventWaiter(threadId, timeoutMs);
    return promise;
  }

  async waitForHostEvent(hostId: string, timeoutMs: number): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const waiter: HostEventWaiter = {
        reject,
        resolve: (notified) => resolve(notified),
        timeout: setTimeout(() => {
          this.deleteHostEventWaiter(hostId, waiter);
          resolve(false);
        }, timeoutMs),
      };
      const waiters =
        this.hostEventWaiters.get(hostId) ?? new Set<HostEventWaiter>();
      waiters.add(waiter);
      this.hostEventWaiters.set(hostId, waiters);
    });
  }

  requestHostOnlineRpc(args: {
    hostId: string;
    message: HostDaemonOnlineRpcRequestMessage;
    timeoutMs: number;
  }): Promise<HostDaemonOnlineRpcResponseMessage> {
    const sessionId = this.daemonSessionIdsByHost.get(args.hostId);
    if (!sessionId) {
      return Promise.reject(new HostOnlineRpcUnavailableError());
    }
    const session = this.daemonSessions.get(sessionId);
    if (!session) {
      return Promise.reject(new HostOnlineRpcUnavailableError());
    }

    return new Promise<HostDaemonOnlineRpcResponseMessage>(
      (resolve, reject) => {
        const waiter: HostOnlineRpcWaiter = {
          reject,
          resolve,
          sessionId,
          timeout: setTimeout(() => {
            this.deleteHostOnlineRpcWaiter(args.message.requestId, waiter);
            reject(new HostOnlineRpcTimeoutError());
          }, args.timeoutMs),
        };
        this.hostOnlineRpcWaiters.set(args.message.requestId, waiter);
        try {
          session.socket.send(JSON.stringify(args.message));
        } catch (error) {
          this.deleteHostOnlineRpcWaiter(args.message.requestId, waiter);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      },
    );
  }

  recordHostOnlineRpcResponse(
    args: RecordHostOnlineRpcResponseArgs,
  ): HostOnlineRpcResponseDisposition {
    const waiter = this.hostOnlineRpcWaiters.get(args.message.requestId);
    if (!waiter) {
      return { handled: false, reason: "stale" };
    }
    if (waiter.sessionId !== args.sessionId) {
      return {
        expectedSessionId: waiter.sessionId,
        handled: false,
        reason: "session_mismatch",
      };
    }
    this.deleteHostOnlineRpcWaiter(args.message.requestId, waiter);
    waiter.resolve(args.message);
    return { handled: true };
  }

  /**
   * Record that an app socket can drive a browser surface. Re-registering the
   * same socket moves it to the back of the map, which is what makes it the
   * primary host.
   */
  registerBrowserHost(
    socket: HubSocket,
    args: { browserHostId: string },
  ): void {
    this.browserHosts.delete(socket);
    this.browserHosts.set(socket, {
      browserHostId: args.browserHostId,
      socket,
    });
    this.notifyBrowserHostsChangedListeners();
  }

  unregisterBrowserHost(socket: HubSocket): void {
    if (!this.browserHosts.delete(socket)) {
      return;
    }
    this.rejectBrowserCommandWaitersForSocket(socket);
    this.notifyBrowserHostsChangedListeners();
  }

  /**
   * Watch browser-host arrivals and departures.
   *
   * Everything else on this side reads the snapshot when it needs it, which is
   * enough while the reader is in this process. A plugin in its own process is
   * not: it holds a copy pushed to it, and without this it would hold the copy
   * from the moment it loaded forever.
   */
  onBrowserHostsChanged(listener: BrowserHostsChangedListener): () => void {
    this.browserHostsChangedListeners.add(listener);
    return () => {
      this.browserHostsChangedListeners.delete(listener);
    };
  }

  getBrowserHostSnapshot(): BrowserHostSnapshot {
    const primary = this.primaryBrowserHost();
    return {
      connected: primary !== undefined,
      browserHostId: primary?.browserHostId ?? null,
      hostCount: this.browserHosts.size,
    };
  }

  /**
   * Ask the primary browser host to perform one command and wait for its answer.
   *
   * Deliberately no grace period when nothing is connected: a daemon is expected
   * to reconnect, but a missing browser window is a user action, and stalling
   * every tool call on the chance one appears is worse than saying so at once.
   */
  requestBrowserCommand(args: {
    message: BrowserCommandRequestSignal;
    timeoutMs: number;
  }): Promise<BrowserCommandResponseMessage> {
    const host = this.primaryBrowserHost();
    if (!host) {
      return Promise.reject(new BrowserHostUnavailableError());
    }

    return new Promise<BrowserCommandResponseMessage>((resolve, reject) => {
      const waiter: BrowserCommandWaiter = {
        reject,
        resolve,
        socket: host.socket,
        timeout: setTimeout(() => {
          this.deleteBrowserCommandWaiter(args.message.requestId, waiter);
          reject(new BrowserCommandTimeoutError());
        }, args.timeoutMs),
      };
      this.browserCommandWaiters.set(args.message.requestId, waiter);
      try {
        host.socket.send(
          JSON.stringify(browserCommandRequestSignalSchema.parse(args.message)),
        );
      } catch (error) {
        this.deleteBrowserCommandWaiter(args.message.requestId, waiter);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  recordBrowserCommandResponse(
    args: RecordBrowserCommandResponseArgs,
  ): BrowserCommandResponseDisposition {
    const waiter = this.browserCommandWaiters.get(args.message.requestId);
    if (!waiter) {
      // A response to a request that already timed out or was abandoned.
      return { handled: false, reason: "stale" };
    }
    if (waiter.socket !== args.socket) {
      return { handled: false, reason: "host_mismatch" };
    }
    this.deleteBrowserCommandWaiter(args.message.requestId, waiter);
    waiter.resolve(args.message);
    return { handled: true };
  }

  registerThreadEventWaiter(
    threadId: string,
    timeoutMs: number,
  ): { promise: Promise<boolean>; cancel: () => void } {
    let waiter: ThreadEventWaiter;
    const promise = new Promise<boolean>((resolve, reject) => {
      waiter = {
        reject,
        resolve: (notified) => resolve(notified),
        timeout: setTimeout(() => {
          this.deleteThreadEventWaiter(threadId, waiter);
          resolve(false);
        }, timeoutMs),
      };
      const waiters =
        this.threadEventWaiters.get(threadId) ?? new Set<ThreadEventWaiter>();
      waiters.add(waiter);
      this.threadEventWaiters.set(threadId, waiters);
    });
    const cancel = () => {
      this.deleteThreadEventWaiter(threadId, waiter!);
    };
    return { promise, cancel };
  }

  notifyThread(
    threadId: string,
    changes: ThreadChangeKind[],
    metadata?: ThreadChangeMetadata,
  ): void {
    this.notifyClients({
      type: "changed",
      entity: "thread",
      id: threadId,
      ...(metadata ? { metadata } : {}),
      changes,
    });

    const threadEventWaiters = this.threadEventWaiters.get(threadId);
    if (threadEventWaiters) {
      for (const waiter of threadEventWaiters) {
        clearTimeout(waiter.timeout);
        waiter.resolve(true);
      }
      this.threadEventWaiters.delete(threadId);
    }
  }

  /**
   * Broadcast an ephemeral thread-open signal to every connected client.
   * Nothing is persisted. Returns how many clients the signal reached.
   */
  notifyThreadOpen(
    thread: { projectId: string; threadId: string },
    request: { split: ThreadOpenSplit; file: ThreadOpenFile | null },
  ): number {
    const payload = JSON.stringify(
      threadOpenSignalSchema.parse({
        type: "thread-open",
        projectId: thread.projectId,
        threadId: thread.threadId,
        split: request.split,
        file: request.file,
      }),
    );
    let delivered = 0;
    for (const socket of this.clientKeysBySocket.keys()) {
      socket.send(payload);
      delivered += 1;
    }
    return delivered;
  }

  /** Broadcast an ephemeral maximize/restore request to every app client. */
  notifyThreadPaneAction(
    thread: { projectId: string; threadId: string },
    action: ThreadPaneAction,
  ): number {
    const payload = JSON.stringify(
      threadPaneActionSignalSchema.parse({
        type: "thread-pane-action",
        projectId: thread.projectId,
        threadId: thread.threadId,
        action,
      }),
    );
    let delivered = 0;
    for (const socket of this.clientKeysBySocket.keys()) {
      socket.send(payload);
      delivered += 1;
    }
    return delivered;
  }

  /**
   * Broadcast an ephemeral plugin realtime signal (`patcher.realtime.publish`) to
   * every connected client. V1 broadcasts to all clients — per-channel
   * subscriptions arrive with the plugin frontend runtime. Returns how many
   * clients the signal reached.
   */
  notifyPluginSignal(
    pluginId: string,
    channel: string,
    payload: unknown,
  ): number {
    const message = JSON.stringify(
      pluginSignalSchema.parse({
        type: "plugin-signal",
        pluginId,
        channel,
        payload,
      }),
    );
    let delivered = 0;
    for (const socket of this.clientKeysBySocket.keys()) {
      socket.send(message);
      delivered += 1;
    }
    return delivered;
  }

  notifyProject(projectId: string, changes: ProjectChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "project",
      id: projectId,
      changes,
    });
  }

  notifyEnvironment(
    environmentId: string,
    changes: EnvironmentChangeKind[],
  ): void {
    this.notifyClients({
      type: "changed",
      entity: "environment",
      id: environmentId,
      changes,
    });
  }

  notifyHost(hostId: string, changes: HostChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "host",
      id: hostId,
      changes,
    });

    const waiters = this.hostEventWaiters.get(hostId);
    if (!waiters) {
      return;
    }

    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(true);
    }
    this.hostEventWaiters.delete(hostId);
  }

  requestHostProtocolUpdateRetry(hostId: string): void {
    this.hostProtocolUpdateRetryRequests.add(hostId);
  }

  takeHostProtocolUpdateRetry(hostId: string): boolean {
    if (!this.hostProtocolUpdateRetryRequests.has(hostId)) {
      return false;
    }
    this.hostProtocolUpdateRetryRequests.delete(hostId);
    return true;
  }

  notifySystem(changes: SystemChangeKind[]): void {
    this.notifyClients({
      type: "changed",
      entity: "system",
      changes,
    });
  }

  private deleteThreadEventWaiter(
    threadId: string,
    waiter: ThreadEventWaiter,
  ): void {
    const waiters = this.threadEventWaiters.get(threadId);
    if (!waiters) {
      return;
    }
    clearTimeout(waiter.timeout);
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.threadEventWaiters.delete(threadId);
    }
  }

  private deleteHostEventWaiter(hostId: string, waiter: HostEventWaiter): void {
    clearTimeout(waiter.timeout);
    const waiters = this.hostEventWaiters.get(hostId);
    if (!waiters) {
      return;
    }
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.hostEventWaiters.delete(hostId);
    }
  }

  /** The most recently registered host; `Map` preserves insertion order. */
  private primaryBrowserHost(): BrowserHostRegistration | undefined {
    let latest: BrowserHostRegistration | undefined;
    for (const registration of this.browserHosts.values()) {
      latest = registration;
    }
    return latest;
  }

  private deleteBrowserCommandWaiter(
    requestId: string,
    waiter: BrowserCommandWaiter,
  ): void {
    if (this.browserCommandWaiters.get(requestId) === waiter) {
      this.browserCommandWaiters.delete(requestId);
    }
    clearTimeout(waiter.timeout);
  }

  private rejectBrowserCommandWaitersForSocket(socket: HubSocket): void {
    for (const [requestId, waiter] of this.browserCommandWaiters) {
      if (waiter.socket !== socket) {
        continue;
      }
      this.deleteBrowserCommandWaiter(requestId, waiter);
      waiter.reject(new BrowserHostUnavailableError());
    }
  }

  private deleteHostOnlineRpcWaiter(
    requestId: string,
    waiter: HostOnlineRpcWaiter,
  ): void {
    clearTimeout(waiter.timeout);
    if (this.hostOnlineRpcWaiters.get(requestId) === waiter) {
      this.hostOnlineRpcWaiters.delete(requestId);
    }
  }

  private rejectHostOnlineRpcWaitersForSession(sessionId: string): void {
    for (const [requestId, waiter] of this.hostOnlineRpcWaiters) {
      if (waiter.sessionId !== sessionId) {
        continue;
      }
      this.deleteHostOnlineRpcWaiter(requestId, waiter);
      waiter.reject(new HostOnlineRpcUnavailableError());
    }
  }

  private deleteDaemonRegistrationWaiter(
    hostId: string,
    waiter: DaemonRegistrationWaiter,
  ): void {
    clearTimeout(waiter.timeout);
    const waiters = this.daemonRegistrationWaiters.get(hostId);
    if (!waiters) {
      return;
    }
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.daemonRegistrationWaiters.delete(hostId);
    }
  }

  private resolveDaemonRegistrationWaiters(hostId: string): void {
    const waiters = this.daemonRegistrationWaiters.get(hostId);
    if (!waiters) {
      return;
    }
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout);
      waiter.resolve(true);
    }
    this.daemonRegistrationWaiters.delete(hostId);
  }

  private notifyClients(message: ChangedMessage): void {
    const sockets = new Set<HubSocket>();
    for (const key of subscriptionKeysForMessage(message)) {
      const specificSockets = this.clientSocketsByKey.get(key);
      if (!specificSockets) {
        continue;
      }
      for (const socket of specificSockets) {
        sockets.add(socket);
      }
    }

    const parseResult = serverMessageSchema.safeParse(message);
    if (!parseResult.success) {
      console.error("Skipping invalid realtime broadcast", parseResult.error);
      return;
    }
    const payload = JSON.stringify(parseResult.data);
    this.notifyClientsByKeySet(sockets, payload);
    this.notifyChangedMessageListeners(message);
  }

  private notifyClientsByKeySet(
    sockets: Iterable<HubSocket>,
    payload: string,
  ): void {
    for (const socket of sockets) {
      socket.send(payload);
    }
  }

  private notifyChangedMessageListeners(message: ChangedMessage): void {
    for (const listener of this.changedMessageListeners) {
      listener(message);
    }
  }

  private notifyBrowserHostsChangedListeners(): void {
    for (const listener of this.browserHostsChangedListeners) {
      listener();
    }
  }

  sendDaemonMessage(
    hostId: string,
    message: HostDaemonServerWsMessage,
  ): boolean {
    const sessionId = this.daemonSessionIdsByHost.get(hostId);
    if (!sessionId) {
      return false;
    }
    return this.sendDaemonSessionMessage(sessionId, message);
  }

  sendDaemonSessionMessage(
    sessionId: string,
    message: HostDaemonServerWsMessage,
  ): boolean {
    const session = this.daemonSessions.get(sessionId);
    if (!session) {
      return false;
    }
    session.socket.send(JSON.stringify(message));
    return true;
  }
}
