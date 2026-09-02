import { describe, expect, it } from "vitest";
import {
  deriveTerminalApiKey,
  deriveThreadTurnApiKey,
  parseThreadCredential,
  verifyThreadApiKey,
} from "../src/thread-api-key.js";

const APP_KEY = "app-key-for-thread-derivation";

/**
 * The two credentials a thread's callers carry.
 *
 * What this module owns is what a credential *is* and whether it is genuine.
 * How long each one is good for is state the server keeps, and it is held to
 * that in `apps/server/test/security/thread-credential-lifetime.test.ts` — the
 * two halves are deliberately apart, because a key that verifies is not the
 * same thing as a key that is still accepted.
 */

describe("a turn's key", () => {
  it("is stable for one thread and different for another", () => {
    const first = deriveThreadTurnApiKey({
      appApiKey: APP_KEY,
      threadId: "thr-1",
    });

    expect(
      deriveThreadTurnApiKey({ appApiKey: APP_KEY, threadId: "thr-1" }),
    ).toBe(first);
    expect(
      deriveThreadTurnApiKey({ appApiKey: APP_KEY, threadId: "thr-2" }),
    ).not.toBe(first);
  });

  it("changes with the app key, so a re-keyed install invalidates every thread key", () => {
    expect(
      deriveThreadTurnApiKey({ appApiKey: "other-app-key", threadId: "thr-1" }),
    ).not.toBe(
      deriveThreadTurnApiKey({ appApiKey: APP_KEY, threadId: "thr-1" }),
    );
  });

  it("does not contain the app key it came from", () => {
    expect(
      deriveThreadTurnApiKey({ appApiKey: APP_KEY, threadId: "thr-1" }),
    ).not.toContain(APP_KEY);
  });

  it("refuses to derive from nothing", () => {
    expect(() =>
      deriveThreadTurnApiKey({ appApiKey: "", threadId: "thr-1" }),
    ).toThrow(/empty app API key/);
    expect(() =>
      deriveThreadTurnApiKey({ appApiKey: APP_KEY, threadId: "" }),
    ).toThrow(/without a thread id/);
  });
});

describe("a terminal's key", () => {
  it("is not a turn's, even for the same thread", () => {
    // Which is what stops one lifetime standing in for the other: a turn key
    // accepted as a terminal's would outlive its turn for as long as some
    // terminal stayed open. What makes them differ is the message — a
    // terminal's names the terminal — and the separate HMAC context on top of
    // that is domain separation rather than the load-bearing part. The part
    // that is load-bearing has its own test below: the id inside the MAC.
    expect(
      deriveTerminalApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-1",
        terminalId: "term-1",
      }),
    ).not.toBe(
      deriveThreadTurnApiKey({ appApiKey: APP_KEY, threadId: "thr-1" }),
    );
  });

  it("is bound to one terminal", () => {
    const first = deriveTerminalApiKey({
      appApiKey: APP_KEY,
      threadId: "thr-1",
      terminalId: "term-1",
    });

    expect(
      deriveTerminalApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-1",
        terminalId: "term-2",
      }),
    ).not.toBe(first);
    expect(
      deriveTerminalApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-2",
        terminalId: "term-1",
      }),
    ).not.toBe(first);
  });

  it("carries the terminal it names, through a dot in the id", () => {
    // Terminal ids have no charset the schema pins, so the id is base64url
    // inside the credential rather than laid between separators.
    const credential = deriveTerminalApiKey({
      appApiKey: APP_KEY,
      threadId: "thr-1",
      terminalId: "term.with.dots",
    });

    expect(parseThreadCredential(credential)).toEqual({
      kind: "terminal",
      terminalId: "term.with.dots",
    });
  });

  it("refuses to derive without a terminal", () => {
    expect(() =>
      deriveTerminalApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-1",
        terminalId: "",
      }),
    ).toThrow(/without a terminal id/);
  });
});

describe("verifying what was presented", () => {
  it("says which kind a genuine credential is", () => {
    expect(
      verifyThreadApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-1",
        presented: deriveThreadTurnApiKey({
          appApiKey: APP_KEY,
          threadId: "thr-1",
        }),
      }),
    ).toEqual({ kind: "turn" });
    expect(
      verifyThreadApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-1",
        presented: deriveTerminalApiKey({
          appApiKey: APP_KEY,
          threadId: "thr-1",
          terminalId: "term-1",
        }),
      }),
    ).toEqual({ kind: "terminal", terminalId: "term-1" });
  });

  it("refuses a credential moved onto another terminal's id", () => {
    // The terminal id is inside the MAC, so relabelling it does not carry the
    // signature across — which is what stops one terminal's key standing in
    // for another's lifetime.
    const genuine = deriveTerminalApiKey({
      appApiKey: APP_KEY,
      threadId: "thr-1",
      terminalId: "term-1",
    });
    const relabelled = genuine.replace(
      Buffer.from("term-1", "utf8").toString("base64url"),
      Buffer.from("term-2", "utf8").toString("base64url"),
    );

    expect(
      verifyThreadApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-1",
        presented: relabelled,
      }),
    ).toBeUndefined();
  });

  it("refuses another thread's key, a wrong app key, and the app key itself", () => {
    for (const presented of [
      deriveThreadTurnApiKey({ appApiKey: APP_KEY, threadId: "thr-2" }),
      deriveThreadTurnApiKey({ appApiKey: "other", threadId: "thr-1" }),
      APP_KEY,
      "",
    ]) {
      expect(
        verifyThreadApiKey({
          appApiKey: APP_KEY,
          threadId: "thr-1",
          presented,
        }),
        presented,
      ).toBeUndefined();
    }
  });

  it("refuses a credential with no kind in it", () => {
    // The shape before the two lifetimes existed: a bare digest. It cannot be
    // accepted, because there would be no way to know which state decides
    // whether it is still good — which is what the protocol bump is for.
    const bare = deriveThreadTurnApiKey({
      appApiKey: APP_KEY,
      threadId: "thr-1",
    }).split(".")[1] as string;

    expect(parseThreadCredential(bare)).toBeUndefined();
    expect(
      verifyThreadApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-1",
        presented: bare,
      }),
    ).toBeUndefined();
  });

  it("refuses shapes that are not credentials at all", () => {
    for (const presented of [
      "pt2",
      "pt2.",
      "pt2.a.b",
      "px2.only",
      "px2..mac",
      "pz2.something",
    ]) {
      expect(parseThreadCredential(presented), presented).toBeUndefined();
    }
  });
});
