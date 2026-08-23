/**
 * Every call the server makes *into* a plugin.
 *
 * The other direction is settled: `patcher.sdk` is a loopback HTTP client that now
 * identifies itself, and `patcher.browser` is already a serialisable command union
 * on a message bus. What has no described shape is this direction — the server
 * holds a function the plugin registered and calls it. A function is exactly
 * the thing that cannot cross a process boundary, so plan Phase 7 is blocked on
 * replacing each of these with a message.
 *
 * This file names them before anything moves, for the same reason the
 * permission list was written before the boundary existed: a plugin host built
 * without the list would be an isolated process that still has to be handed
 * every callback ad hoc.
 *
 * **Nothing here changes how a call runs today.** The closure is still invoked
 * in-process. What each call site now does is *declare* what it is sending, in
 * a vocabulary a transport could carry — and `NODE_ENV=test` checks that the
 * declaration is true (see {@link assertCallbackCrosses}), so the existing
 * suite validates real payloads rather than fixtures written to agree.
 *
 * Where the payload of the declaration and the argument of the closure are the
 * same value, they cannot drift; that is why `invokeCallback` passes the
 * declared payload *into* the closure rather than letting the site pass its
 * own.
 */

import type { JsonValue } from "@patcher/domain";

/**
 * How a call behaves, which decides what a transport has to provide for it.
 *
 * - `call` — request in, response out. The bulk of them, and the easy case.
 * - `notify` — one way, no result, failure is the host's problem not the
 *   caller's. Thread events, settings changes, dispose hooks.
 * - `lifecycle` — not a call at all: something starts, runs, and is stopped.
 *   A transport needs start/stop messages and a liveness signal, not a
 *   request/response pair.
 */
export type PluginCallbackCategory = "call" | "notify" | "lifecycle";

export interface PluginCallbackShape {
  category: PluginCallbackCategory;
  /**
   * Whether the argument survives a boundary as JSON today. `false` names a
   * real obstacle, and `note` says what it is — these are the entries Phase 7
   * has to solve rather than translate.
   */
  payloadCrosses: boolean;
  /** Whether the return value survives as JSON. */
  resultCrosses: boolean;
  /**
   * The plugin is handed an `AbortSignal` for this call.
   *
   * Not an obstacle in the payload — the signal is deliberately not in it,
   * because it is a channel and not a value. It is a requirement *on the
   * transport*: these calls need a cancel message travelling alongside the
   * request, and a signal rebuilt from it on the plugin's side. Recorded here
   * because a payload that serialises cleanly is otherwise indistinguishable
   * from one with nothing to cancel.
   */
  cancellable?: true;
  /**
   * How this call reads in a log line and in the plugin's status detail.
   *
   * Separate from the kind on purpose: the kind is the transport's vocabulary
   * and the label is the user's. `patcher plugin list` shows the status detail, and
   * "threadEvent thread.deleted failed" is this file's word leaking into text
   * somebody reads about their own plugin.
   */
  label: (target: string | undefined) => string;
  note?: string;
}

/**
 * The complete set. Adding a server→plugin call without an entry here fails
 * to compile at its call site, which is the only place it can be forgotten.
 */
export const PLUGIN_CALLBACKS = {
  // -- Backend surfaces -----------------------------------------------------
  rpc: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `rpc ${target}` : "rpc"),
  },
  http: {
    category: "call",
    payloadCrosses: false,
    resultCrosses: false,
    note: "Takes a Hono Context and returns a Response, neither of which is data. ./plugin-http-message.ts is the shape they reduce to, and it is now applied at the boundary and only there: ./plugin-remote-handle.ts reduces on the way out and the plugin process rebuilds a real Context by running the request through a one-route Hono app. In-process the closure still receives the live Context, because reducing it would cost a buffered body for no boundary. The price, paid only by an out-of-process route, is that a streaming response stops streaming.",
    label: (target) => (target ? `http ${target}` : "http"),
  },
  cli: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    // Aborted when the invoking CLI request disconnects.
    cancellable: true,
    label: (target) => (target ? `cli ${target}` : "cli"),
  },
  schedule: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `schedule ${target}` : "schedule"),
  },
  backgroundService: {
    category: "lifecycle",
    payloadCrosses: true,
    resultCrosses: true,
    // The abort a service sees as its signal firing.
    cancellable: true,
    note: 'Runs until aborted, so it looked like it needed its own vocabulary — ./plugin-service-message.ts, commands one way and events the other. Applying it showed the channel already carries the whole lifecycle as one cancellable request: it stays open for as long as start() runs, the cancel message is the abort, resolving is "returned" and rejecting is "threw". Those are exactly the two outcomes the host\'s existing runner decides on, so the restart policy stays in one place. `reduceServiceEvent` in that file is the part that turned out to be a second copy of it.',
    label: (target) => (target ? `service ${target}` : "service"),
  },

  // -- Agent surfaces -------------------------------------------------------
  agentTool: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    // Aborted if the daemon round-trip is torn down mid-call.
    cancellable: true,
    label: (target) => (target ? `tool ${target}` : "tool"),
  },
  agentConfigure: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => "agent configure",
  },
  agentInstructions: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => "agent instructions",
  },
  mentionSearch: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `mention search ${target}` : "mention search"),
  },
  mentionResolve: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) =>
      target ? `mention resolve ${target}` : "mention resolve",
  },

  // -- Browser surfaces -----------------------------------------------------
  browserContextMenu: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `context menu ${target}` : "context menu"),
  },
  browserTabAction: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `tab action ${target}` : "tab action"),
  },
  browserSiteInfo: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `site info ${target}` : "site info"),
  },
  browserToolbarState: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `toolbar state ${target}` : "toolbar state"),
  },
  browserToolbarRun: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `toolbar item ${target}` : "toolbar item"),
  },
  browserNewTabRows: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `new tab widget ${target}` : "new tab widget"),
  },
  uiCommand: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `command ${target}` : "command"),
  },
  browserFindAction: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `find action ${target}` : "find action"),
  },
  browserAuth: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => "browser auth provider",
  },
  browserPdfText: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => "browser pdf text provider",
  },
  browserExternalLink: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => "browser external link handler",
  },
  browserOmniboxSuggest: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) =>
      target ? `omnibox suggest ${target}` : "omnibox suggest",
  },
  browserOmniboxRun: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `omnibox run ${target}` : "omnibox run"),
  },
  browserDownload: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => "browser download handler",
  },
  browserHistoryFilter: {
    category: "call",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => "browser history filter",
  },

  // -- Pushes ---------------------------------------------------------------
  threadEvent: {
    category: "notify",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => (target ? `${target} handler` : "thread event"),
  },
  settingsChange: {
    category: "notify",
    payloadCrosses: true,
    resultCrosses: true,
    label: (target) => "settings onChange",
  },
  dispose: {
    category: "notify",
    payloadCrosses: true,
    resultCrosses: true,
    note: "No payload. Ordering is the constraint a transport must keep: hooks run LIFO and the host waits for them before declaring the plugin gone.",
    label: (target) => "dispose hook",
  },
} as const satisfies Record<string, PluginCallbackShape>;

export type PluginCallbackKind = keyof typeof PLUGIN_CALLBACKS;

/**
 * One entry, widened from its literal type so the optional members are
 * readable. `as const` above is there to keep the key set exact, and the cost
 * is that each value's optional fields vanish from the narrowed type.
 */
export function callbackShape(kind: PluginCallbackKind): PluginCallbackShape {
  return PLUGIN_CALLBACKS[kind];
}

/**
 * One call, described. `target` names the registration within the plugin —
 * the method, item id, or provider id — and is what a transport routes on
 * once the closure is gone.
 */
export interface PluginCallback<TPayload> {
  kind: PluginCallbackKind;
  target?: string;
  payload: TPayload;
}

/** The label used in logs and in a plugin's status detail. */
export function describeCallback(call: PluginCallback<unknown>): string {
  return callbackShape(call.kind).label(call.target);
}

/**
 * Under test, prove the declaration above is true of the real value.
 *
 * Deliberately not run in production: these are hot paths (an omnibox suggest
 * per keystroke), and the check is only worth what it costs when something
 * exercises it — which the existing suite does, with real payloads, for free.
 * A fixture written by hand would be a second description free to agree with
 * the first while both are wrong.
 */
export function assertCallbackCrosses(
  call: PluginCallback<unknown>,
  direction: "payload" | "result",
  value: unknown,
): void {
  if (process.env.NODE_ENV !== "test") return;
  const shape = callbackShape(call.kind);
  const crosses =
    direction === "payload" ? shape.payloadCrosses : shape.resultCrosses;
  if (!crosses) return;
  const problem = describeNonJson(value, direction);
  if (problem !== null) {
    throw new Error(
      `plugin callback "${describeCallback(call)}" declares its ${direction} ` +
        `crosses as JSON, but ${problem}. Either the value is wrong or ` +
        `PLUGIN_CALLBACKS is.`,
    );
  }
}

/** What makes this value un-sendable, or null when nothing does. */
function describeNonJson(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  const seen = new WeakSet<object>();
  const walk = (node: unknown, path: string): string | null => {
    if (node === null) return null;
    const type = typeof node;
    if (type === "string" || type === "boolean") return null;
    if (type === "number") {
      return Number.isFinite(node) ? null : `${path} is ${String(node)}`;
    }
    if (type === "undefined") return null;
    if (type === "bigint" || type === "symbol" || type === "function") {
      return `${path} is a ${type}`;
    }
    if (type !== "object") return `${path} is a ${type}`;
    const object = node as object;
    // `seen` holds the current path, not everything visited: the same object
    // reached twice down two branches is a shared reference, which JSON copies
    // out twice and a transport carries fine. Only an object still open on the
    // way down is a cycle, so it comes back off on the way out.
    if (seen.has(object)) return `${path} is circular`;
    seen.add(object);
    try {
      if (Array.isArray(object)) {
        for (const [index, item] of object.entries()) {
          const problem = walk(item, `${path}[${index}]`);
          if (problem !== null) return problem;
        }
        return null;
      }
      // A plain object or a null-prototype one; anything else (Date, Map, a
      // class instance) survives JSON only by luck and changes shape doing it.
      const prototype = Object.getPrototypeOf(object) as unknown;
      if (prototype !== Object.prototype && prototype !== null) {
        return `${path} is a ${object.constructor?.name ?? "non-plain object"}`;
      }
      for (const [key, child] of Object.entries(object)) {
        const problem = walk(child, `${path}.${key}`);
        if (problem !== null) return problem;
      }
      return null;
    } finally {
      seen.delete(object);
    }
  };
  return walk(value, label);
}

/** Every callback that a transport can carry unchanged, for the docs guard. */
export function serialisableCallbackKinds(): PluginCallbackKind[] {
  return (Object.keys(PLUGIN_CALLBACKS) as PluginCallbackKind[]).filter(
    (kind) =>
      PLUGIN_CALLBACKS[kind].payloadCrosses &&
      PLUGIN_CALLBACKS[kind].resultCrosses,
  );
}

export type { JsonValue };
