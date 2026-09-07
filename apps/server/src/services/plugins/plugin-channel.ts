/**
 * One end of the plugin boundary.
 *
 * Both ends run this same object: the server holds one per loaded plugin, the
 * plugin's process holds one, and neither is the client. That symmetry is the
 * point — server→plugin and plugin→host are the same machine pointed the other
 * way, and a second implementation of it is a second place for correlation,
 * cancellation and shutdown to be subtly different.
 *
 * What it owes its callers:
 *
 * - a request resolves with the far side's result or rejects with the far
 *   side's error, rebuilt (./plugin-protocol.ts);
 * - a request made under an `AbortSignal` cancels the far side's work, using
 *   the message ./plugin-cancellation.ts already defines;
 * - **when the channel closes, every in-flight request rejects.** A plugin
 *   process can die at any moment, and the failure mode that is worse than a
 *   crash is a crash nobody is told about: an agent tool call that never
 *   settles hangs the turn;
 * - **a request sent while serving one says which one** (`origin`), so a side
 *   that recorded something under the call it made can find it again when the
 *   answer comes back as a call of its own — and a quoted call that is not one
 *   this end has in flight is dropped, since the far side chose the value.
 *   That is the whole of how "who asked for this" crosses the boundary — see
 *   `browser-caller-handoff.ts`.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { JsonValue } from "@patcher/domain";
import {
  receiveCancellation,
  watchForCancellation,
  type PluginCancelMessage,
} from "./plugin-cancellation.js";
import {
  parseMessage,
  rebuildError,
  reduceError,
  type PluginMessage,
} from "./plugin-protocol.js";

/**
 * The byte-moving part, kept out of this file entirely.
 *
 * A port is whatever carries an object to the other side and hands one back:
 * `child_process` IPC in production, a linked pair in tests — both in
 * ./plugin-ports.ts. Framing and serialisation belong to the port, not here.
 */
export interface PluginPort {
  send(message: PluginMessage): void;
  /**
   * `unknown`, deliberately asymmetric with `send`: what leaves is ours, what
   * arrives came from another process and is checked before it is believed.
   */
  onMessage(listener: (message: unknown) => void): void;
  /** Called when the far side is gone, however it went. */
  onClose(listener: () => void): void;
  close(): void;
}

/** What a peer does with a request from the far side. */
export type PluginRequestHandler = (request: {
  method: string;
  target?: string;
  payload: JsonValue;
  /**
   * The call *this* end made that the far side was serving when it sent this,
   * when there was one — and checked before it gets here: present only if it
   * names a request this channel still has in flight. The far side chose the
   * value, so a settled call, another channel's call and an invented string
   * all arrive as absent. See `origin` on {@link PluginRequestMessage}.
   */
  origin?: string;
  /** Aborts when the far side cancels. */
  signal: AbortSignal;
}) => JsonValue | undefined | Promise<JsonValue | undefined>;

export type PluginNotifyHandler = (notification: {
  method: string;
  target?: string;
  payload: JsonValue;
}) => void;

export interface PluginChannelOptions {
  port: PluginPort;
  /**
   * Names this end in errors and call ids ("server", "plugin:notes"). Both
   * ends allocate call ids independently, so a log with two peers in it is
   * unreadable without knowing which allocated what.
   */
  name: string;
  onRequest?: PluginRequestHandler;
  onNotify?: PluginNotifyHandler;
  /**
   * A message that could not be understood, or one for a call nobody is
   * waiting for. Not thrown: a malformed frame from the far side is that side's
   * bug and must not take this side down. Not silent either — the last thing
   * anyone needs is a plugin whose calls vanish.
   */
  onProtocolError?: (problem: string) => void;
  /**
   * This end is about to send a request, with the id the far side will quote
   * back as `origin` on anything it sends while serving it. Returns a function
   * run once that request settles, however it settles — including the channel
   * closing under it.
   *
   * Here rather than at the three call sites that make requests, because the
   * thing it exists for (`browser-caller-handoff.ts`) has to cover *every*
   * host→plugin call and a chokepoint the next one has to opt into is a
   * chokepoint with a hole in it.
   *
   * Called before the frame is posted, because nothing in the port contract
   * says when delivery happens: both ports in tree happen to defer it (a
   * microtask for a linked pair, the pipe for a child process), and a hook
   * that ran after the send would be relying on that. Recording first costs
   * nothing and does not.
   */
  onOutboundRequest?: (callId: string) => () => void;
}

export interface PluginChannel<
  TSend extends string = string,
  TReceive extends string = string,
> {
  request(args: {
    method: TSend;
    target?: string;
    payload: JsonValue;
    signal?: AbortSignal;
  }): Promise<JsonValue>;
  notify(args: { method: TSend; target?: string; payload: JsonValue }): void;
  /** Requests still awaiting an answer. */
  readonly pendingCount: number;
  readonly closed: boolean;
  /** Reject everything in flight and drop the port. Idempotent. */
  close(reason?: string): void;
  /** Narrowing sugar for a dispatcher; the wire is checked, not this. */
  readonly receives?: TReceive;
}

export class PluginChannelClosedError extends Error {
  constructor(peer: string, reason: string) {
    super(`plugin channel to ${peer} closed: ${reason}`);
    this.name = "PluginChannelClosedError";
  }
}

interface PendingRequest {
  resolve: (value: JsonValue) => void;
  reject: (error: Error) => void;
  detachCancellation: () => void;
  /** What {@link PluginChannelOptions.onOutboundRequest} handed back. */
  releaseOrigin: () => void;
}

export function createPluginChannel<
  TSend extends string = string,
  TReceive extends string = string,
>(options: PluginChannelOptions): PluginChannel<TSend, TReceive> {
  const { port, name } = options;
  const reportProblem =
    options.onProtocolError ??
    (() => {
      // A caller that does not want them still must not get an exception.
    });

  const pending = new Map<string, PendingRequest>();
  /** Cancellers for requests *this* end is currently serving. */
  const serving = new Map<string, (message: PluginCancelMessage) => void>();
  /**
   * The request this end is serving right now, so anything it sends back can
   * say which call it is part of.
   *
   * Per channel rather than per process: two channels in one process are two
   * unrelated conversations, and stamping one's frame with the other's call id
   * would name a call the reader has no record of. An `AsyncLocalStorage`
   * because the handler is arbitrary async code with a whole plugin API
   * between it and here — the same reason the two scopes this feeds are
   * ambient (`browser-external-access.ts`).
   */
  const servingCall = new AsyncLocalStorage<string>();
  let closed = false;
  let sequence = 0;

  /**
   * Unique across both ends and across restarts of either. The uuid is what
   * makes a late answer from a previous process recognisably not ours; the
   * counter and name are for reading a log.
   */
  const epoch = randomUUID();
  const nextCallId = (): string => `${name}:${epoch}:${++sequence}`;

  function post(message: PluginMessage): void {
    if (closed) return;
    try {
      port.send(message);
    } catch (error) {
      // A port that cannot send is a dead port, whatever it says about itself.
      closeChannel(
        `send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  function closeChannel(reason: string): void {
    if (closed) return;
    closed = true;
    const failure = new PluginChannelClosedError(name, reason);
    // Copied out first: rejecting runs continuations that may close again.
    const inFlight = [...pending.values()];
    pending.clear();
    for (const request of inFlight) {
      request.detachCancellation();
      request.releaseOrigin();
      request.reject(failure);
    }
    // Work this end is serving is abandoned, and telling it so is the only way
    // a handler awaiting something slow ever stops.
    const abandoned = [...serving.entries()];
    serving.clear();
    for (const [callId, cancel] of abandoned) {
      cancel({ kind: "cancel", callId, reason });
    }
    try {
      port.close();
    } catch {
      // Closing a port that is already gone is the normal case, not a problem.
    }
  }

  async function serveRequest(message: {
    callId: string;
    method: string;
    target?: string;
    origin?: string;
    payload: JsonValue;
  }): Promise<void> {
    const handler = options.onRequest;
    if (handler === undefined) {
      post({
        kind: "failure",
        callId: message.callId,
        error: reduceError(
          new Error(`${name} has no handler for request "${message.method}"`),
        ),
      });
      return;
    }
    const receiver = receiveCancellation(message.callId);
    serving.set(message.callId, receiver.cancel);
    try {
      // An `origin` is only passed on when it names a request *this* channel
      // has in flight right now. The far side chose the value, so this is the
      // one place it can be held to something: a call that has already
      // settled, one this end never made, and one another channel minted are
      // all indistinguishable from a plugin's invention, and all three are
      // dropped rather than handed to a reader that would look them up.
      const claimed = message.origin;
      const origin =
        claimed !== undefined && pending.has(claimed) ? claimed : undefined;
      const value = await servingCall.run(message.callId, () =>
        handler({
          method: message.method,
          ...(message.target === undefined ? {} : { target: message.target }),
          ...(origin === undefined ? {} : { origin }),
          payload: message.payload,
          signal: receiver.signal,
        }),
      );
      // `undefined` is not JSON. Normalising to null matches what
      // `patcher.realtime.publish` already does with an absent payload.
      post({ kind: "result", callId: message.callId, value: value ?? null });
    } catch (error) {
      post({
        kind: "failure",
        callId: message.callId,
        error: reduceError(error),
      });
    } finally {
      serving.delete(message.callId);
    }
  }

  function settle(
    callId: string,
    settleOne: (request: PendingRequest) => void,
  ) {
    const request = pending.get(callId);
    if (request === undefined) {
      // Either the far side answered twice, or this is an answer to a call
      // that closing already rejected. Both are the far side's business and
      // neither is actionable here beyond saying so.
      reportProblem(`answer for unknown call ${callId}`);
      return;
    }
    pending.delete(callId);
    request.detachCancellation();
    request.releaseOrigin();
    settleOne(request);
  }

  port.onMessage((raw) => {
    if (closed) return;
    const message = parseMessage(raw);
    if (message === null) {
      reportProblem(`unreadable message: ${describeBriefly(raw)}`);
      return;
    }
    switch (message.kind) {
      case "request":
        void serveRequest(message);
        return;
      case "notify":
        try {
          options.onNotify?.({
            method: message.method,
            ...(message.target === undefined ? {} : { target: message.target }),
            payload: message.payload,
          });
        } catch (error) {
          // Nobody is waiting on a notification, so a throwing handler has no
          // one to tell but the log.
          reportProblem(
            `notify handler for "${message.method}" threw: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
        return;
      case "result":
        settle(message.callId, (request) => {
          request.resolve(message.value);
        });
        return;
      case "failure":
        settle(message.callId, (request) => {
          request.reject(rebuildError(message.error));
        });
        return;
      case "cancel": {
        const cancel = serving.get(message.callId);
        // A cancel that arrives after the work finished is ordinary — the
        // caller gave up at the moment the answer was already on its way.
        cancel?.(message);
        return;
      }
    }
  });

  port.onClose(() => {
    closeChannel("the far side is gone");
  });

  return {
    request({ method, target, payload, signal }) {
      if (closed) {
        return Promise.reject(new PluginChannelClosedError(name, "closed"));
      }
      const callId = nextCallId();
      // What the far side will be serving when it sends this on, if it does.
      const origin = servingCall.getStore();
      return new Promise<JsonValue>((resolve, reject) => {
        const request: PendingRequest = {
          resolve,
          reject,
          detachCancellation: () => {},
          releaseOrigin: options.onOutboundRequest?.(callId) ?? (() => {}),
        };
        pending.set(callId, request);
        post({
          kind: "request",
          callId,
          method,
          ...(target === undefined ? {} : { target }),
          ...(origin === undefined ? {} : { origin }),
          payload,
        });
        // Watched *after* the request is on the wire, because an already
        // aborted source emits at once: a cancel that overtakes its own
        // request names a call the far side has not seen, is dropped there as
        // unknown, and the work then runs to completion uncancelled.
        if (signal !== undefined && !closed) {
          request.detachCancellation = watchForCancellation({
            callId,
            source: signal,
            send: post,
          });
        }
      });
    },
    notify({ method, target, payload }) {
      post({
        kind: "notify",
        method,
        ...(target === undefined ? {} : { target }),
        payload,
      });
    },
    get pendingCount() {
      return pending.size;
    },
    get closed() {
      return closed;
    },
    close(reason = "closed locally") {
      closeChannel(reason);
    },
  };
}

/** Enough of an unreadable message to find it, without logging a payload. */
function describeBriefly(value: unknown): string {
  if (typeof value !== "object" || value === null) return typeof value;
  const kind = (value as { kind?: unknown }).kind;
  return typeof kind === "string" ? `kind "${kind}"` : "object without a kind";
}
