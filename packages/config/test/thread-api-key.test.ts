import { describe, expect, it } from "vitest";
import {
  deriveThreadApiKey,
  verifyThreadApiKey,
} from "../src/thread-api-key.js";

const APP_KEY = "app-key-for-thread-derivation";

describe("deriveThreadApiKey", () => {
  it("is stable for one thread and different for another", () => {
    const first = deriveThreadApiKey({
      appApiKey: APP_KEY,
      threadId: "thr-1",
    });

    expect(
      deriveThreadApiKey({ appApiKey: APP_KEY, threadId: "thr-1" }),
    ).toBe(first);
    expect(
      deriveThreadApiKey({ appApiKey: APP_KEY, threadId: "thr-2" }),
    ).not.toBe(first);
  });

  it("changes with the app key, so a re-keyed install invalidates every thread key", () => {
    expect(
      deriveThreadApiKey({ appApiKey: "other-app-key", threadId: "thr-1" }),
    ).not.toBe(deriveThreadApiKey({ appApiKey: APP_KEY, threadId: "thr-1" }));
  });

  it("does not contain the app key it came from", () => {
    expect(
      deriveThreadApiKey({ appApiKey: APP_KEY, threadId: "thr-1" }),
    ).not.toContain(APP_KEY);
  });

  it("refuses to derive from nothing", () => {
    expect(() =>
      deriveThreadApiKey({ appApiKey: "", threadId: "thr-1" }),
    ).toThrow(/empty app API key/);
    expect(() =>
      deriveThreadApiKey({ appApiKey: APP_KEY, threadId: "" }),
    ).toThrow(/without a thread id/);
  });
});

describe("verifyThreadApiKey", () => {
  it("accepts the key for the thread it was derived for", () => {
    expect(
      verifyThreadApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-1",
        presented: deriveThreadApiKey({
          appApiKey: APP_KEY,
          threadId: "thr-1",
        }),
      }),
    ).toBe(true);
  });

  it("refuses one thread's key presented under another thread's id", () => {
    expect(
      verifyThreadApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-2",
        presented: deriveThreadApiKey({
          appApiKey: APP_KEY,
          threadId: "thr-1",
        }),
      }),
    ).toBe(false);
  });

  it("refuses the app key itself", () => {
    expect(
      verifyThreadApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-1",
        presented: APP_KEY,
      }),
    ).toBe(false);
  });

  it("refuses empty inputs instead of throwing", () => {
    expect(
      verifyThreadApiKey({
        appApiKey: APP_KEY,
        threadId: "thr-1",
        presented: "",
      }),
    ).toBe(false);
    expect(
      verifyThreadApiKey({ appApiKey: "", threadId: "thr-1", presented: "x" }),
    ).toBe(false);
    expect(
      verifyThreadApiKey({ appApiKey: APP_KEY, threadId: "", presented: "x" }),
    ).toBe(false);
  });
});
