import { describe, expect, it, vi } from "vitest";
import type { PluginApiHandle } from "../../../src/services/plugins/plugin-api.js";
import { readThreadEventHandlers } from "../../../src/services/plugins/plugin-thread-event-registry.js";

/**
 * Handles the type says cannot exist. Every one of these came from somewhere
 * real: the missing key is what a snapshot-built remote handle used to hand
 * back, and the throwing member is what that same handle does by contract for
 * everything that has to stay in the plugin's process.
 *
 * The point is not that a handle is repaired — it is that dispatch reads every
 * loaded plugin's handle, so one bad one must cost its own plugin its events
 * and nothing else. Before this, from inside the dispatch `setImmediate`, it
 * cost the server its process.
 */

function handleWith(threadEventHandlers: unknown): PluginApiHandle {
  return { threadEventHandlers } as unknown as PluginApiHandle;
}

describe("reading a plugin's thread event registrations", () => {
  it("returns the handlers a well-formed handle carries", () => {
    const handler = () => {};
    const onUnreadable = vi.fn();

    const handlers = readThreadEventHandlers({
      handle: handleWith({ "thread.created": [handler] }),
      event: "thread.created",
      onUnreadable,
    });

    expect(handlers).toEqual([handler]);
    expect(onUnreadable).not.toHaveBeenCalled();
  });

  it("reports and yields none for an event the handle left out", () => {
    const onUnreadable = vi.fn();

    const handlers = readThreadEventHandlers({
      handle: handleWith({ "thread.created": [() => {}] }),
      event: "thread.active",
      onUnreadable,
    });

    expect(handlers).toEqual([]);
    expect(onUnreadable).toHaveBeenCalledWith("handlers are undefined");
  });

  it("reports and yields none when the registry itself is absent", () => {
    const onUnreadable = vi.fn();

    const handlers = readThreadEventHandlers({
      handle: handleWith(undefined),
      event: "thread.idle",
      onUnreadable,
    });

    expect(handlers).toEqual([]);
    expect(onUnreadable).toHaveBeenCalledTimes(1);
  });

  it("reports and yields none when reading it throws", () => {
    const onUnreadable = vi.fn();
    const handle = {
      get threadEventHandlers(): never {
        throw new Error("it runs in its own process");
      },
    } as unknown as PluginApiHandle;

    const handlers = readThreadEventHandlers({
      handle,
      event: "thread.deleted",
      onUnreadable,
    });

    expect(handlers).toEqual([]);
    expect(onUnreadable).toHaveBeenCalledWith("it runs in its own process");
  });

  it("reports and yields none for something that is not a list", () => {
    const onUnreadable = vi.fn();

    const handlers = readThreadEventHandlers({
      handle: handleWith({ "thread.failed": () => {} }),
      event: "thread.failed",
      onUnreadable,
    });

    expect(handlers).toEqual([]);
    expect(onUnreadable).toHaveBeenCalledWith("handlers are function");
  });
});
