/**
 * What actually travels between the server and a plugin's process.
 *
 * The two catalogues describe the *vocabulary* — ./plugin-callbacks.ts for
 * server→plugin, ./plugin-host-calls.ts for plugin→host. This file is the
 * envelope both directions share, and it is deliberately the same envelope:
 * each side makes requests, answers them, and sends one-way notifications, so
 * one message union and one peer (./plugin-channel.ts) serve both ends rather
 * than two half-implementations that drift.
 *
 * `method` is where the catalogues re-enter: the server sends a
 * `PluginCallbackKind`, the plugin sends a `PluginHostCallPath`. The envelope
 * does not care which, and the channel is generic over both so a call site
 * still cannot invent one.
 */

import type { JsonValue } from "@patcher/domain";
import type { PluginCancelMessage } from "./plugin-cancellation.js";

/** A request expecting exactly one response. */
export interface PluginRequestMessage {
  kind: "request";
  callId: string;
  method: string;
  /**
   * Which registration within the plugin — the route, tool name, or item id.
   * Absent for methods a plugin can only have one of.
   */
  target?: string;
  payload: JsonValue;
}

/** One way. The sender does not learn whether it arrived or worked. */
export interface PluginNotifyMessage {
  kind: "notify";
  method: string;
  target?: string;
  payload: JsonValue;
}

export interface PluginResultMessage {
  kind: "result";
  callId: string;
  value: JsonValue;
}

export interface PluginFailureMessage {
  kind: "failure";
  callId: string;
  error: PluginWireError;
}

export type PluginMessage =
  | PluginRequestMessage
  | PluginNotifyMessage
  | PluginResultMessage
  | PluginFailureMessage
  | PluginCancelMessage;

/**
 * An error, reduced to what survives.
 *
 * Reducing an error is usually lossy in a way that matters, and here it is
 * not — because this codebase already decided that error *identity is the
 * name*. `@patcher/plugin-sdk`'s contract says so in as many words ("Runtime classes
 * stay host-side. NeedsConfigurationError in particular is matched by NAME"),
 * `isNeedsConfigurationError` tests `error.name`, and plugin code is told to
 * throw `Object.assign(new Error(msg), { name: "..." })`. So a rebuilt error is
 * not an approximation of the original; it is the same thing by the only
 * measure anything applies to it.
 *
 * `props` carries the own enumerable fields that some errors are read for —
 * `PluginPermissionError.permission`, a CLI output-limit error's byte counts.
 * Without them a caller that branches on the name gets the error it expects
 * and then finds it empty.
 */
export interface PluginWireError {
  name: string;
  message: string;
  /** The far side's stack, kept for logs. Never parsed. */
  stack?: string;
  props?: Record<string, JsonValue>;
}

/** Anything thrown, reduced for the wire. */
export function reduceError(thrown: unknown): PluginWireError {
  if (!(thrown instanceof Error)) {
    // A plugin can throw a string, and losing that is worse than an odd name.
    return { name: "Error", message: String(thrown) };
  }
  const reduced: PluginWireError = {
    name: thrown.name,
    message: thrown.message,
  };
  if (typeof thrown.stack === "string") reduced.stack = thrown.stack;
  const props = ownJsonProps(thrown);
  if (props !== undefined) reduced.props = props;
  return reduced;
}

/**
 * Rebuild it on the far side.
 *
 * `instanceof` against the original class is the one thing that cannot come
 * back, which is why it was worth checking that nothing depends on it: the only
 * `instanceof` on a plugin error class in the repo is
 * `PluginSettingsValidationError` in routes/plugins.ts, thrown by host code
 * inside the host and never crossing.
 */
export function rebuildError(wire: PluginWireError): Error {
  const error = new Error(wire.message);
  error.name = wire.name;
  if (wire.stack !== undefined) error.stack = wire.stack;
  if (wire.props !== undefined) Object.assign(error, wire.props);
  return error;
}

/** Own enumerable fields worth carrying, or undefined when there are none. */
function ownJsonProps(error: Error): Record<string, JsonValue> | undefined {
  let props: Record<string, JsonValue> | undefined;
  for (const [key, value] of Object.entries(error)) {
    // `message` and `stack` have their own slots; name is not enumerable.
    if (key === "message" || key === "stack") continue;
    if (!isJsonValue(value)) continue;
    props ??= {};
    props[key] = value;
  }
  return props;
}

/**
 * Whether a value survives JSON unchanged.
 *
 * The catalogues' `assertCallbackCrosses` answers the same question but for a
 * different audience: it explains *what* is wrong so a declaration can be
 * fixed, and only under test. This one is a plain predicate used on live
 * values, where a reason nobody reads is not worth the walk.
 */
export function isJsonValue(value: unknown): value is JsonValue {
  const seen = new WeakSet<object>();
  const walk = (node: unknown): boolean => {
    if (node === null) return true;
    switch (typeof node) {
      case "string":
      case "boolean":
        return true;
      case "number":
        return Number.isFinite(node);
      case "object":
        break;
      default:
        return false;
    }
    const object = node as object;
    if (seen.has(object)) return false;
    seen.add(object);
    try {
      if (Array.isArray(object)) return object.every(walk);
      const prototype = Object.getPrototypeOf(object) as unknown;
      if (prototype !== Object.prototype && prototype !== null) return false;
      return Object.values(object).every(walk);
    } finally {
      seen.delete(object);
    }
  };
  return walk(value);
}

/**
 * Recognise a message off the wire.
 *
 * The far side is a separate process that can be any version, so a message is
 * untrusted input rather than a value this codebase produced. Anything that
 * fails here is reported through the channel's protocol-error hook and
 * dropped — never thrown at whoever happened to be reading the pipe.
 */
export function parseMessage(value: unknown): PluginMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const message = value as Record<string, unknown>;
  const stringOrUndefined = (field: unknown): boolean =>
    field === undefined || typeof field === "string";
  switch (message.kind) {
    case "request":
      return typeof message.callId === "string" &&
        typeof message.method === "string" &&
        stringOrUndefined(message.target) &&
        isJsonValue(message.payload)
        ? (message as unknown as PluginRequestMessage)
        : null;
    case "notify":
      return typeof message.method === "string" &&
        stringOrUndefined(message.target) &&
        isJsonValue(message.payload)
        ? (message as unknown as PluginNotifyMessage)
        : null;
    case "result":
      return typeof message.callId === "string" && isJsonValue(message.value)
        ? (message as unknown as PluginResultMessage)
        : null;
    case "failure":
      return typeof message.callId === "string" && isWireError(message.error)
        ? (message as unknown as PluginFailureMessage)
        : null;
    case "cancel":
      return typeof message.callId === "string" &&
        typeof message.reason === "string"
        ? (message as unknown as PluginCancelMessage)
        : null;
    default:
      return null;
  }
}

function isWireError(value: unknown): value is PluginWireError {
  if (typeof value !== "object" || value === null) return false;
  const error = value as Record<string, unknown>;
  return (
    typeof error.name === "string" &&
    typeof error.message === "string" &&
    (error.stack === undefined || typeof error.stack === "string") &&
    (error.props === undefined || isJsonValue(error.props))
  );
}
