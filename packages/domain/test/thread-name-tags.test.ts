import { describe, expect, it } from "vitest";
import { threadScope } from "../src/thread-event-scope.js";
import type { ThreadEvent } from "../src/provider-event.js";
import {
  PATCHER_THREAD_NAME_TAG,
  fromProviderExternalThreadName,
  normalizeProviderThreadNameEvent,
  tagThreadName,
  toProviderExternalThreadName,
} from "../src/thread-name-tags.js";

describe("thread name tags", () => {
  it("round-trips user-provided literal Patcher-prefixed titles", () => {
    const providerName = toProviderExternalThreadName("[Patcher] Literal");

    expect(providerName).toBe("[Patcher] [Patcher] Literal");
    expect(fromProviderExternalThreadName(providerName)).toBe(
      "[Patcher] Literal",
    );
  });

  it("normalizes provider title events by stripping one Patcher tag", () => {
    const event = {
      type: "thread/name/updated",
      threadId: "t1",
      providerThreadId: "p1",
      scope: threadScope(),
      threadName: tagThreadName({
        name: "[Patcher] Literal",
        tag: PATCHER_THREAD_NAME_TAG,
      }),
    } satisfies ThreadEvent;

    expect(normalizeProviderThreadNameEvent(event)).toEqual({
      ...event,
      threadName: "[Patcher] Literal",
    });
  });
});
