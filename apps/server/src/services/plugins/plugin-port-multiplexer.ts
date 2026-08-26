/**
 * Many logical channels over one pipe.
 *
 * The transport was designed so that "one logical channel per plugin" and "how
 * many processes those channels live in" are separate questions
 * (docs/architecture/plugin-transport.md). This file is what makes that true
 * rather than merely claimed: a real port in, N virtual ports out, keyed by
 * plugin id.
 *
 * It existed first because of a measurement: a bundled plugin-host process
 * costs ~67MB resident before it loads any plugin at all, against ~50MB for a
 * bare Node process, so plugins shared a process and sharing a process meant
 * sharing a pipe. That default is gone — **a key here routes, it does not
 * isolate**, and two plugins in one process could read each other's frames off
 * `process.on("message")` regardless of what this file did with them. See
 * ./plugin-supervisor.ts.
 *
 * What still shares a pipe is one plugin's two instances during a reload swap,
 * which is co-residency that gives nothing away, plus any caller that asks for
 * `SHARED_PLACEMENT` knowing what it is.
 *
 * Nothing above this layer changes: each channel still gets a `PluginPort`
 * that behaves exactly like a dedicated one.
 */

import type { PluginPort } from "./plugin-channel.js";
import type { PluginMessage } from "./plugin-protocol.js";

/** One virtual channel's traffic, wrapped with the key that routes it. */
interface MultiplexedFrame {
  /** Which virtual channel. */
  c: string;
  /** The channel's own message, or absent on a close frame. */
  m?: PluginMessage;
  /** Set when this frame closes the virtual channel rather than carrying it. */
  close?: true;
}

function isFrame(value: unknown): value is MultiplexedFrame {
  if (typeof value !== "object" || value === null) return false;
  const frame = value as Record<string, unknown>;
  return typeof frame.c === "string";
}

export interface PortMultiplexer {
  /**
   * A port for one key. Opening the same key twice returns a second port that
   * would race the first for the same frames, so it throws instead.
   */
  open(key: string): PluginPort;
  /** Close one virtual channel and tell the far side. The pipe stays up. */
  close(key: string): void;
  /** Keys currently open on this side. */
  keys(): string[];
}

interface VirtualPort {
  port: PluginPort;
  messageListeners: ((message: unknown) => void)[];
  closeListeners: (() => void)[];
  closed: boolean;
}

/**
 * @param onUnroutable A frame for a key nobody opened, or one that is not a
 *   frame at all. The far side is another process, so this is untrusted input
 *   and gets reported rather than thrown — same rule as `parseMessage`.
 * @param acceptUnknownKeys Whether a frame for an unopened key should open one.
 *   True on the plugin process's side, where the server opens channels; false
 *   on the server's, where a plugin must not invent one.
 */
export function createPortMultiplexer(args: {
  port: PluginPort;
  onUnroutable?: (problem: string) => void;
  acceptUnknownKeys?: boolean;
  onChannelOpened?: (key: string, port: PluginPort) => void;
}): PortMultiplexer {
  const { port } = args;
  const report = args.onUnroutable ?? (() => {});
  const virtual = new Map<string, VirtualPort>();
  let pipeClosed = false;

  function makeVirtual(key: string): VirtualPort {
    const state: VirtualPort = {
      messageListeners: [],
      closeListeners: [],
      closed: false,
      port: {
        send(message) {
          if (state.closed || pipeClosed) return;
          port.send({ c: key, m: message } as unknown as PluginMessage);
        },
        onMessage(listener) {
          state.messageListeners.push(listener);
        },
        onClose(listener) {
          state.closeListeners.push(listener);
          if (state.closed) listener();
        },
        close() {
          closeVirtual(key, { tellFarSide: true });
        },
      },
    };
    return state;
  }

  function closeVirtual(key: string, options: { tellFarSide: boolean }): void {
    const state = virtual.get(key);
    if (state === undefined || state.closed) return;
    state.closed = true;
    virtual.delete(key);
    if (options.tellFarSide && !pipeClosed) {
      port.send({ c: key, close: true } as unknown as PluginMessage);
    }
    for (const listener of [...state.closeListeners]) listener();
  }

  port.onMessage((raw) => {
    if (!isFrame(raw)) {
      report(
        `unroutable frame: ${typeof raw === "object" ? "object" : typeof raw}`,
      );
      return;
    }
    if (raw.close === true) {
      closeVirtual(raw.c, { tellFarSide: false });
      return;
    }
    let state = virtual.get(raw.c);
    if (state === undefined) {
      if (args.acceptUnknownKeys !== true) {
        report(`frame for unopened channel "${raw.c}"`);
        return;
      }
      state = makeVirtual(raw.c);
      virtual.set(raw.c, state);
      args.onChannelOpened?.(raw.c, state.port);
    }
    if (raw.m === undefined) {
      report(`frame for "${raw.c}" carries nothing`);
      return;
    }
    for (const listener of [...state.messageListeners]) listener(raw.m);
  });

  // The pipe going down takes every channel with it. Each one's `onClose` is
  // what makes its channel reject its in-flight requests, which is the whole
  // reason a shared process is survivable: one crash, N notified callers.
  port.onClose(() => {
    if (pipeClosed) return;
    pipeClosed = true;
    for (const key of [...virtual.keys()]) {
      closeVirtual(key, { tellFarSide: false });
    }
  });

  return {
    open(key) {
      if (virtual.has(key)) {
        throw new Error(`multiplexed channel "${key}" is already open`);
      }
      const state = makeVirtual(key);
      virtual.set(key, state);
      return state.port;
    },
    close(key) {
      closeVirtual(key, { tellFarSide: true });
    },
    keys() {
      return [...virtual.keys()];
    },
  };
}
