import { describe, expect, it } from "vitest";
import { browserCommandRecordDetail } from "../src/browser-command-description.js";
import {
  BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH,
  BROWSER_COMMAND_MAX_EVAL_EXPRESSION_LENGTH,
} from "../src/browser-control.js";

/**
 * What a command looks like once it is a line of a record.
 *
 * Pinned here rather than through either surface that renders one, because both
 * of them — the caller's own trace and the `browser-driving` signal the other
 * windows get — show these strings to a person, and the rule they follow is not
 * a property of either: keys are named, values are not, and typed text is kept.
 */

describe("the line a record keeps", () => {
  it("says what was typed, because a log that will not is not a log", () => {
    expect(
      browserCommandRecordDetail({
        type: "page.interact",
        tabId: null,
        generation: null,
        interaction: { action: "fill", ref: "e2", text: "hello" },
      }),
    ).toBe('fill e2 "hello"');
  });

  it("names the storage keys a write touched and none of their values", () => {
    // A trace is a file people save and send each other; a cookie value in one
    // is a session in one.
    const detail = browserCommandRecordDetail({
      type: "page.storage",
      tabId: null,
      operation: {
        kind: "items-set",
        area: "local",
        items: [{ name: "token", value: "super-secret" }],
      },
    });

    expect(detail).toBe("items-set local token");
    expect(detail).not.toContain("super-secret");
  });

  it("does not spell a cookie write out at all", () => {
    const detail = browserCommandRecordDetail({
      type: "page.storage",
      tabId: null,
      operation: {
        kind: "cookies-set",
        cookies: [
          {
            name: "session",
            value: "super-secret",
            domain: "example.com",
            path: "/",
            secure: false,
            httpOnly: true,
            sameSite: "Lax",
            expires: -1,
          },
        ],
      },
    });

    expect(detail).toBe("cookies-set 1");
    expect(detail).not.toContain("super-secret");
  });

  it("keeps the parts of a control command that say what it did", () => {
    expect(
      browserCommandRecordDetail({
        type: "page.control",
        tabId: null,
        generation: null,
        operation: {
          kind: "evaluate",
          expression: "() => document.title",
          ref: null,
        },
      }),
    ).toBe("evaluate () => document.title");
  });
});

describe("what it cuts", () => {
  it("cuts a command that renders longer than a record's line", () => {
    // `evaluate` is the one whose payload is allowed to be far longer than the
    // line a record keeps, and the wire signal's schema holds the field to this
    // length — so a renderer that did not cut here would make the server's own
    // parse throw on the send path, where nothing is allowed to.
    const detail = browserCommandRecordDetail({
      type: "page.control",
      tabId: null,
      generation: null,
      operation: {
        kind: "evaluate",
        expression: "a".repeat(BROWSER_COMMAND_MAX_EVAL_EXPRESSION_LENGTH),
        ref: null,
      },
    });

    expect(detail.length).toBe(BROWSER_COMMAND_MAX_TRACE_DETAIL_LENGTH);
    expect(detail.startsWith("evaluate aaa")).toBe(true);
  });

  it("leaves a short one exactly as it reads", () => {
    expect(
      browserCommandRecordDetail({ type: "navigation.open", url: "https://x.test/", tabId: null }),
    ).toBe("https://x.test/");
  });
});
