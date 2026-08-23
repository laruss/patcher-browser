import { fork, spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPluginChannel,
  PluginChannelClosedError,
  type PluginChannel,
  type PluginRequestHandler,
} from "../../../src/services/plugins/plugin-channel.js";
import {
  createChildProcessPort,
  createLinkedPorts,
} from "../../../src/services/plugins/plugin-ports.js";
import {
  isJsonValue,
  parseMessage,
  rebuildError,
  reduceError,
} from "../../../src/services/plugins/plugin-protocol.js";

/**
 * The boundary's own behaviour. Two peers, wired to each other, asked to do
 * the things a plugin process does — including dying in the middle.
 */

/** Promise.withResolvers is newer than this package's lib target. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Pair {
  host: PluginChannel;
  plugin: PluginChannel;
  problems: string[];
}

function linkedPair(options: {
  onHostRequest?: PluginRequestHandler;
  onPluginRequest?: PluginRequestHandler;
  onHostNotify?: (n: { method: string; payload: unknown }) => void;
}): Pair {
  const [hostPort, pluginPort] = createLinkedPorts();
  const problems: string[] = [];
  const host = createPluginChannel({
    port: hostPort,
    name: "server",
    ...(options.onHostRequest ? { onRequest: options.onHostRequest } : {}),
    ...(options.onHostNotify ? { onNotify: options.onHostNotify } : {}),
    onProtocolError: (problem) => problems.push(problem),
  });
  const plugin = createPluginChannel({
    port: pluginPort,
    name: "plugin:probe",
    ...(options.onPluginRequest ? { onRequest: options.onPluginRequest } : {}),
    onProtocolError: (problem) => problems.push(problem),
  });
  return { host, plugin, problems };
}

describe("plugin channel: requests", () => {
  it("carries a request and its answer", async () => {
    const { host } = linkedPair({
      onPluginRequest: ({ method, target, payload }) => ({
        saw: method,
        target: target ?? null,
        payload,
      }),
    });

    await expect(
      host.request({
        method: "agentTool",
        target: "summarise",
        payload: { text: "привет" },
      }),
    ).resolves.toEqual({
      saw: "agentTool",
      target: "summarise",
      payload: { text: "привет" },
    });
  });

  // A linked pair stands in for a pipe, and Node's IPC puts every message
  // through JSON: an optional field left `undefined` simply does not arrive.
  // A pair that delivered the object as-is failed `isJsonValue` instead, and
  // the request hung until close — a trap for anyone adding an optional field
  // to a payload, sprung only in tests.
  it("drops an undefined property the way a real pipe does", async () => {
    let seen: unknown;
    const { host } = linkedPair({
      onHostRequest: () => null,
      onPluginRequest: ({ payload }) => {
        seen = payload;
        return "ok";
      },
    });

    await expect(
      host.request({
        method: "agentTool",
        payload: { text: "привет", note: undefined } as never,
      }),
    ).resolves.toBe("ok");
    expect(seen).toEqual({ text: "привет" });
  });

  it("goes both ways — the plugin can ask the host", async () => {
    const { plugin } = linkedPair({
      onHostRequest: ({ method }) => ({ answered: method }),
    });

    await expect(
      plugin.request({ method: "storage.kv.get", payload: { key: "a" } }),
    ).resolves.toEqual({ answered: "storage.kv.get" });
  });

  // undefined is not JSON, and a void handler is the common case.
  it("turns an absent result into null", async () => {
    const { host } = linkedPair({ onPluginRequest: () => undefined });

    await expect(
      host.request({ method: "dispose", payload: null }),
    ).resolves.toBeNull();
  });

  it("stops tracking a call once it settles", async () => {
    const { host } = linkedPair({ onPluginRequest: () => 1 });

    const inFlight = host.request({ method: "rpc", payload: null });
    expect(host.pendingCount).toBe(1);
    await inFlight;
    expect(host.pendingCount).toBe(0);
  });

  // A peer with nothing registered must answer, not swallow: the alternative
  // is a caller waiting on a process that will never reply.
  it("fails a request the far side has no handler for", async () => {
    const { host } = linkedPair({});

    await expect(
      host.request({ method: "cli", payload: null }),
    ).rejects.toThrow(/no handler for request "cli"/);
  });
});

describe("plugin channel: errors", () => {
  // The repo matches plugin errors by name, not by class — see the note in
  // @patcher/plugin-sdk's backend contract — so this is the whole of error identity.
  it("keeps the name a caller branches on", async () => {
    const { host } = linkedPair({
      onPluginRequest: () => {
        throw Object.assign(new Error("configure me"), {
          name: "NeedsConfigurationError",
        });
      },
    });

    await expect(
      host.request({ method: "backgroundService", payload: null }),
    ).rejects.toMatchObject({
      name: "NeedsConfigurationError",
      message: "configure me",
    });
  });

  it("keeps the fields an error is read for", async () => {
    const { host } = linkedPair({
      onPluginRequest: () => {
        throw Object.assign(new Error("too much output"), {
          name: "PluginCliOutputLimitError",
          code: "plugin_cli_output_too_large",
          maxBytes: 65_536,
        });
      },
    });

    await expect(
      host.request({ method: "cli", payload: null }),
    ).rejects.toMatchObject({
      code: "plugin_cli_output_too_large",
      maxBytes: 65_536,
    });
  });

  it("carries something thrown that was never an error", async () => {
    const { host } = linkedPair({
      onPluginRequest: () => {
        throw "just a string";
      },
    });

    await expect(
      host.request({ method: "rpc", payload: null }),
    ).rejects.toThrow("just a string");
  });

  // A field that cannot survive JSON must not take the whole error with it.
  it("drops an unsendable field rather than the error", () => {
    const wire = reduceError(
      Object.assign(new Error("nope"), {
        permission: "threads",
        handle: () => {},
      }),
    );

    expect(wire.props).toEqual({ permission: "threads" });
    expect(rebuildError(wire)).toMatchObject({
      message: "nope",
      permission: "threads",
    });
  });
});

describe("plugin channel: cancellation", () => {
  it("aborts the far side's work", async () => {
    const started = deferred<void>();
    const { host } = linkedPair({
      onPluginRequest: async ({ signal }) => {
        started.resolve();
        await new Promise<void>((done) => {
          signal.addEventListener("abort", () => done());
        });
        return { reason: String(signal.reason) };
      },
    });

    const controller = new AbortController();
    const inFlight = host.request({
      method: "agentTool",
      payload: null,
      signal: controller.signal,
    });
    await started.promise;
    controller.abort(new Error("the turn ended"));

    // The far side decides what an abort means. Here it answers, which is why
    // the request resolves rather than rejecting — cancellation is a message,
    // not a way to break the call.
    //
    // "AbortError", not "Error": a reason cannot cross as an object, so the
    // far side rebuilds one as the DOMException that `fetch` produces and that
    // `error.name === "AbortError"` branches expect. See plugin-cancellation.ts.
    await expect(inFlight).resolves.toEqual({
      reason: "AbortError: the turn ended",
    });
  });

  it("ignores a cancel for work that already finished", async () => {
    const { host, problems } = linkedPair({ onPluginRequest: () => "done" });

    const controller = new AbortController();
    await expect(
      host.request({
        method: "agentTool",
        payload: null,
        signal: controller.signal,
      }),
    ).resolves.toBe("done");
    controller.abort();
    await new Promise((r) => setTimeout(r, 5));

    expect(problems).toEqual([]);
  });
});

describe("plugin channel: shutdown", () => {
  it("rejects everything in flight when the channel closes", async () => {
    const { host } = linkedPair({
      onPluginRequest: () => new Promise<never>(() => {}),
    });

    const inFlight = host.request({ method: "http", payload: null });
    host.close("reloading");

    await expect(inFlight).rejects.toBeInstanceOf(PluginChannelClosedError);
    expect(host.pendingCount).toBe(0);
  });

  // The one that matters most: a plugin process dies and the server is holding
  // a promise for an agent tool call.
  it("rejects in flight when the far side goes away", async () => {
    const { host, plugin } = linkedPair({
      onPluginRequest: () => new Promise<never>(() => {}),
    });

    const inFlight = host.request({ method: "agentTool", payload: null });
    plugin.close("crashed");

    await expect(inFlight).rejects.toThrow(/closed/);
  });

  it("refuses a new request instead of hanging", async () => {
    const { host } = linkedPair({});
    host.close();

    await expect(
      host.request({ method: "rpc", payload: null }),
    ).rejects.toBeInstanceOf(PluginChannelClosedError);
  });

  it("closes once, however many times it is asked", () => {
    const { host } = linkedPair({});
    host.close("first");
    host.close("second");

    expect(host.closed).toBe(true);
  });

  // Abandoning work is not the same as leaving it running: a handler waiting
  // on something slow has to be told, or the dying process never drains.
  it("aborts work it was serving", async () => {
    const aborted = deferred<string>();
    const { host, plugin } = linkedPair({
      onPluginRequest: ({ signal }) => {
        signal.addEventListener("abort", () => {
          aborted.resolve(String(signal.reason));
        });
        return new Promise<never>(() => {});
      },
    });

    void host.request({ method: "http", payload: null }).catch(() => {});
    await new Promise((r) => setTimeout(r, 5));
    plugin.close("host went away");

    await expect(aborted.promise).resolves.toContain("host went away");
  });
});

describe("plugin channel: bad input from the far side", () => {
  it("reports an unreadable message and keeps going", async () => {
    const [hostPort, pluginPort] = createLinkedPorts();
    const problems: string[] = [];
    const host = createPluginChannel({
      port: hostPort,
      name: "server",
      onRequest: () => "still here",
      onProtocolError: (problem) => problems.push(problem),
    });
    const plugin = createPluginChannel({
      port: pluginPort,
      name: "plugin:probe",
    });

    // Cast because the port's type is what *this* codebase sends. The far side
    // is another process on another version and is under no such obligation,
    // which is the whole reason parseMessage exists.
    const foreign = pluginPort.send as (message: unknown) => void;
    foreign({ kind: "nonsense" });
    foreign("not even an object");
    await new Promise((r) => setTimeout(r, 5));

    expect(problems).toHaveLength(2);
    await expect(
      plugin.request({ method: "log.info", payload: null }),
    ).resolves.toBe("still here");
    expect(host.closed).toBe(false);
  });

  it("reports an answer nobody is waiting for", async () => {
    const [hostPort, pluginPort] = createLinkedPorts();
    const problems: string[] = [];
    createPluginChannel({
      port: hostPort,
      name: "server",
      onProtocolError: (problem) => problems.push(problem),
    });

    pluginPort.send({ kind: "result", callId: "server:gone:1", value: 1 });
    await new Promise((r) => setTimeout(r, 5));

    expect(problems).toEqual(["answer for unknown call server:gone:1"]);
  });

  it("does not let a throwing notify handler escape", async () => {
    const problems: string[] = [];
    const [hostPort, pluginPort] = createLinkedPorts();
    createPluginChannel({
      port: hostPort,
      name: "server",
      onNotify: () => {
        throw new Error("handler is broken");
      },
      onProtocolError: (problem) => problems.push(problem),
    });
    const plugin = createPluginChannel({ port: pluginPort, name: "p" });

    plugin.notify({ method: "log.info", payload: "hello" });
    await new Promise((r) => setTimeout(r, 5));

    expect(problems).toEqual([
      'notify handler for "log.info" threw: handler is broken',
    ]);
  });

  it("rejects a payload that is not JSON before it is trusted", () => {
    expect(parseMessage({ kind: "notify", method: "x", payload: 1 })).not.toBe(
      null,
    );
    expect(
      parseMessage({ kind: "notify", method: "x", payload: { f: () => {} } }),
    ).toBeNull();
    expect(
      parseMessage({ kind: "request", method: "x", payload: 1 }),
    ).toBeNull();
    expect(isJsonValue({ a: [1, "two", null] })).toBe(true);
    expect(isJsonValue({ a: Number.NaN })).toBe(false);
  });
});

describe("plugin channel over a real process", () => {
  const children: ChildProcess[] = [];

  afterEach(() => {
    for (const child of children.splice(0)) child.kill("SIGKILL");
  });

  function spawnEchoChild(): {
    channel: PluginChannel;
    child: ChildProcess;
    notifications: { method: string; payload: unknown }[];
  } {
    const here = dirname(fileURLToPath(import.meta.url));
    const child = fork(resolve(here, "fixtures/echo-plugin-child.ts"), [], {
      // Same idiom the agent-runtime bridge uses to run a TS entry.
      execArgv: ["--import", import.meta.resolve("tsx")],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    children.push(child);
    const notifications: { method: string; payload: unknown }[] = [];
    const channel = createPluginChannel({
      port: createChildProcessPort(child),
      name: "server",
      onNotify: ({ method, payload }) =>
        notifications.push({ method, payload }),
    });
    return { channel, child, notifications };
  }

  it("round-trips through a spawned Node process", async () => {
    const { channel, child, notifications } = spawnEchoChild();

    await expect(
      channel.request({
        method: "echo",
        target: "первый",
        payload: { text: "текст", n: 1 },
      }),
    ).resolves.toEqual({
      method: "echo",
      target: "первый",
      payload: { text: "текст", n: 1 },
    });
    // The child spoke first, unasked — the direction a request/response test
    // never exercises.
    expect(notifications).toEqual([
      { method: "ready", payload: { pid: child.pid } },
    ]);
  }, 20_000);

  it("brings an error back across the boundary by name", async () => {
    const { channel } = spawnEchoChild();

    await expect(
      channel.request({ method: "throw", payload: null }),
    ).rejects.toMatchObject({ name: "NeedsConfigurationError" });
  }, 20_000);

  it("cancels work running in the other process", async () => {
    const { channel } = spawnEchoChild();
    const controller = new AbortController();

    const inFlight = channel.request({
      method: "hang",
      payload: null,
      signal: controller.signal,
    });
    await new Promise((r) => setTimeout(r, 200));
    controller.abort(new Error("caller gave up"));

    await expect(inFlight).resolves.toMatchObject({ cancelled: true });
  }, 20_000);

  it("rejects the in-flight call when the process exits under it", async () => {
    const { channel } = spawnEchoChild();

    await expect(
      channel.request({ method: "exit", payload: null }),
    ).rejects.toBeInstanceOf(PluginChannelClosedError);
    expect(channel.closed).toBe(true);
  }, 20_000);

  // `fork` always makes an IPC channel, so the way to get a child without one
  // is `spawn` — which is also how someone would get here by accident.
  it("refuses to wrap a child with no IPC channel", () => {
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 5000)"]);
    children.push(child);

    expect(() => createChildProcessPort(child)).toThrow(/IPC channel/);
  });

  // A plugin process that dies before the server finishes wiring it up: the
  // `exit` event has been and gone, so nothing will fire it again.
  it("treats a child that already exited as a closed port", async () => {
    const child = spawn(process.execPath, ["-e", ""], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    children.push(child);
    await new Promise((r) => child.once("exit", r));

    const channel = createPluginChannel({
      port: createChildProcessPort(child),
      name: "server",
    });

    expect(channel.closed).toBe(true);
  }, 20_000);
});

describe("plugin channel: hygiene", () => {
  it("does not leave a listener on a caller's signal", async () => {
    const { host } = linkedPair({ onPluginRequest: () => "ok" });
    // One long-lived signal, many short calls under it — the shape that leaks.
    const controller = new AbortController();
    const spy = vi.spyOn(controller.signal, "removeEventListener");

    for (let i = 0; i < 5; i += 1) {
      await host.request({
        method: "agentTool",
        payload: i,
        signal: controller.signal,
      });
    }

    expect(spy).toHaveBeenCalledTimes(5);
  });
});
