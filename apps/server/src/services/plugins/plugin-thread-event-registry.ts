import type { PluginApiHandle } from "./plugin-api.js";
import type {
  PluginThreadEventName,
  PluginThreadEventPayloads,
} from "@patcher/plugin-sdk";

/**
 * Reading one plugin's thread-event registrations, contained.
 *
 * A handle is supposed to carry a list per event — the type is a mapped type
 * over every event name, so an absent one is a compile error. This exists
 * because the type is not the only thing standing between a plugin's
 * registrations and the dispatch loop: the handle for a plugin that runs in its
 * own process is assembled on this side from a message
 * (./plugin-remote-handle.ts), and some of its members are getters that throw by
 * contract.
 *
 * The reason to contain it rather than let it throw is that dispatch reads
 * *every* loaded plugin's handle before it delivers anything. A handle rebuilt
 * from a snapshot once carried only the events its plugin had registered, so it
 * answered `undefined` here: read while deciding whether to dispatch, that
 * surfaced as a 500 out of whatever transaction was open, and read inside the
 * dispatch loop — a `setImmediate` with no caller left to catch anything — it
 * took the server process down. One plugin's bad handle, every thread in the
 * app.
 */
export function readThreadEventHandlers<E extends PluginThreadEventName>(args: {
  handle: PluginApiHandle;
  event: E;
  /** Called with what was wrong, at most once per read. */
  onUnreadable: (detail: string) => void;
}): ReadonlyArray<
  (payload: PluginThreadEventPayloads[E]) => void | Promise<void>
> {
  try {
    const handlers = args.handle.threadEventHandlers[args.event];
    if (Array.isArray(handlers)) return handlers;
    args.onUnreadable(`handlers are ${typeof handlers}`);
  } catch (error) {
    args.onUnreadable(error instanceof Error ? error.message : String(error));
  }
  return [];
}
