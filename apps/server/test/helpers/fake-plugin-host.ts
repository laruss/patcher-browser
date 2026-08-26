import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { PluginPort } from "../../src/services/plugins/plugin-channel.js";
import type { PluginMessage } from "../../src/services/plugins/plugin-protocol.js";
import { createPluginChildRuntime } from "../../src/services/plugins/plugin-child-runtime.js";
import { createPortMultiplexer } from "../../src/services/plugins/plugin-port-multiplexer.js";

/**
 * A plugin host process with the operating system taken out.
 *
 * Everything inside is real — the multiplexer, the child runtime, the plugin —
 * and only the pipe is a pair of event emitters. That makes a crash
 * instantaneous and exactly repeatable, which is what tests about dying
 * processes need; the supervisor suite forks a real one too, so the fake is
 * never the only evidence.
 */
export interface FakePluginHostProcess {
  child: ChildProcess;
  /** Kill it the way a crash does: no warning, no dispose. */
  crash(code: number): void;
  /** Channel keys this process is currently hosting a runtime for. */
  hosted(): string[];
}

export interface FakePluginHostOptions {
  /**
   * Rewrite what the process answers, on its way out.
   *
   * Not a convenience: once a plugin's own code runs in there, the frames on
   * the pipe are the plugin's to write, and the host has to hold what arrives
   * to its own rules rather than to what the child runtime would have sent. A
   * test needs a way to be that plugin.
   */
  rig?: (message: PluginMessage) => PluginMessage;
}

export function createFakePluginHostProcess(
  onCreated?: (host: FakePluginHostProcess) => void,
  options: FakePluginHostOptions = {},
): FakePluginHostProcess {
  const outward = new EventEmitter();
  const child = new EventEmitter() as unknown as ChildProcess & {
    connected: boolean;
  };
  const hosted: string[] = [];
  let alive = true;

  Object.assign(child, {
    pid: Math.floor(Math.random() * 100_000),
    connected: true,
    exitCode: null,
    signalCode: null,
    stderr: null,
    send(message: unknown, cb?: (error: Error | null) => void) {
      if (!alive) {
        cb?.(new Error("channel closed"));
        return false;
      }
      queueMicrotask(() => outward.emit("in", message));
      cb?.(null);
      return true;
    },
    disconnect() {
      finish(0, null);
    },
    kill() {
      finish(0, "SIGTERM");
      return true;
    },
  });

  function finish(code: number | null, signal: string | null): void {
    if (!alive) return;
    alive = false;
    (child as unknown as { connected: boolean }).connected = false;
    (child as unknown as { exitCode: number | null }).exitCode = code;
    queueMicrotask(() => child.emit("exit", code, signal));
  }

  // The inside of the process: exactly what plugin-host-entry.ts does.
  const insidePort: PluginPort = {
    send: (message) => {
      if (!alive) return;
      queueMicrotask(() => child.emit("message", message));
    },
    onMessage: (listener) => outward.on("in", listener),
    onClose: (listener) => child.once("exit", listener),
    close: () => finish(0, null),
  };
  createPortMultiplexer({
    port: insidePort,
    acceptUnknownKeys: true,
    onChannelOpened: (key, port) => {
      hosted.push(key);
      const rig = options.rig;
      createPluginChildRuntime({
        port:
          rig === undefined
            ? port
            : {
                send: (message) => port.send(rig(message)),
                onMessage: (listener) => port.onMessage(listener),
                onClose: (listener) => port.onClose(listener),
                close: () => port.close(),
              },
      });
    },
  });

  const host: FakePluginHostProcess = {
    child,
    crash: (code) => finish(code, null),
    hosted: () => [...hosted],
  };
  onCreated?.(host);
  return host;
}
