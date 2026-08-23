import { describe, expect, it } from "vitest";
import {
  assertCallbackCrosses,
  callbackShape,
  describeCallback,
  PLUGIN_CALLBACKS,
  type PluginCallbackKind,
} from "../../../src/services/plugins/plugin-callbacks.js";

/**
 * The description of every server→plugin call, which is what plan Phase 7 has
 * to replace the closures with.
 *
 * The interesting assertions here are not that the table exists but that it is
 * *checked against reality*: the whole plugin suite runs with
 * `assertCallbackCrosses` live, so a payload that stops being sendable fails
 * where it is sent. These tests cover the checker itself, plus the two things
 * a table like this quietly gets wrong — going stale, and leaking its own
 * vocabulary into what a user reads.
 */

describe("the serialisation checker", () => {
  it("is live under test, which is what makes the suite the fixture", () => {
    expect(process.env.NODE_ENV).toBe("test");
  });

  it("rejects a function, which is what a closure boundary cannot carry", () => {
    expect(() =>
      assertCallbackCrosses({ kind: "rpc", payload: null }, "payload", {
        run: () => {},
      }),
    ).toThrow(/is a function/);
  });

  // The dangerous case: JSON.stringify turns these into {} or a string without
  // complaining, so the loss only shows up as missing behaviour much later.
  it("rejects values that survive JSON only by changing shape", () => {
    expect(() =>
      assertCallbackCrosses({ kind: "rpc", payload: null }, "payload", {
        at: new Date(),
      }),
    ).toThrow(/is a Date/);
    expect(() =>
      assertCallbackCrosses({ kind: "rpc", payload: null }, "payload", {
        seen: new Map(),
      }),
    ).toThrow(/is a Map/);
  });

  it("rejects a circular payload", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() =>
      assertCallbackCrosses(
        { kind: "rpc", payload: null },
        "payload",
        circular,
      ),
    ).toThrow(/is circular/);
  });

  // The same object reached twice is not a cycle. A `seen` set that only ever
  // grows cannot tell them apart, and reports the second visit as circular —
  // turning a perfectly sendable payload into a failure blamed on the wrong
  // thing.
  it("tells a shared reference from a cycle", () => {
    const shared = { a: 1 };

    expect(() =>
      assertCallbackCrosses({ kind: "rpc", payload: null }, "payload", {
        x: shared,
        y: shared,
      }),
    ).not.toThrow();
  });

  it("accepts a plain payload", () => {
    expect(() =>
      assertCallbackCrosses({ kind: "rpc", payload: null }, "payload", {
        a: [1, "x", { b: true }, null],
      }),
    ).not.toThrow();
  });

  it("says nothing about a direction declared as not crossing", () => {
    expect(() =>
      assertCallbackCrosses({ kind: "http", payload: null }, "payload", {
        context: () => {},
      }),
    ).not.toThrow();
  });

  // There is no per-field escape hatch, on purpose: one would be reached for
  // instead of fixing the value, which is what happened to all three of the
  // obstacles this check originally found.
  it("has no way to excuse a field that cannot cross", () => {
    expect(() =>
      assertCallbackCrosses({ kind: "agentTool", payload: null }, "payload", {
        input: { q: "x" },
        ctx: { signal: new AbortController().signal },
      }),
    ).toThrow(/ctx\.signal is a AbortSignal/);
  });

  // Object.create(null) is how the agent configuration keys overrides by tool
  // name, since `__proto__` is a legal tool name. It has to read as plain.
  it("accepts a null-prototype object", () => {
    const overrides = Object.create(null) as Record<string, unknown>;
    overrides.docs_search = { type: "object" };

    expect(() =>
      assertCallbackCrosses({ kind: "rpc", payload: null }, "payload", {
        overrides,
      }),
    ).not.toThrow();
  });
});

describe("the callback table", () => {
  const kinds = Object.keys(PLUGIN_CALLBACKS) as PluginCallbackKind[];

  // What a transport still has to solve, stated once so it cannot quietly
  // grow. Everything absent from this list crosses as it stands.
  it("names every remaining obstacle to a boundary", () => {
    const blocked = kinds.filter(
      (kind) =>
        !callbackShape(kind).payloadCrosses ||
        !callbackShape(kind).resultCrosses,
    );

    // `http` alone, and only in the in-process sense the flags describe: what
    // `invokeCallback` sees is still a live Hono Context. At the boundary it
    // is carried — plugin-remote-handle.ts reduces it and the plugin process
    // rebuilds one. backgroundService left this list when applying its shape
    // showed the channel already carries it as a cancellable request.
    expect(blocked.sort()).toEqual(["http"]);
  });

  it("explains why each of them blocks", () => {
    for (const kind of kinds) {
      const shape = callbackShape(kind);
      if (!shape.payloadCrosses || !shape.resultCrosses) {
        expect(shape.note, `${kind} blocks without saying why`).toBeTruthy();
      }
    }
  });

  // A payload that serialises cleanly looks identical whether or not the call
  // can be cancelled, so the two that hand the plugin a signal say so.
  it("names the calls that need a cancel channel", () => {
    const cancellable = kinds.filter(
      (kind) => callbackShape(kind).cancellable === true,
    );

    expect(cancellable.sort()).toEqual([
      "agentTool",
      "backgroundService",
      "cli",
    ]);
  });
});

/**
 * The kind is the transport's word; the label is the user's. These are the
 * strings that reach `patcher plugin list` as a plugin's status detail, and they
 * predate this file — a rename here must not rewrite them.
 */
describe("what a user reads", () => {
  it.each([
    ["rpc", "list", "rpc list"],
    ["cli", "notes", "cli notes"],
    ["agentTool", "docs_search", "tool docs_search"],
    ["agentConfigure", undefined, "agent configure"],
    ["mentionSearch", "docs", "mention search docs"],
    ["browserContextMenu", "explain", "context menu explain"],
    ["browserOmniboxSuggest", "fast", "omnibox suggest fast"],
    ["browserDownload", undefined, "browser download handler"],
    ["threadEvent", "thread.deleted", "thread.deleted handler"],
  ] as const)("%s → %s", (kind, target, expected) => {
    expect(describeCallback({ kind, target, payload: null })).toBe(expected);
  });
});
