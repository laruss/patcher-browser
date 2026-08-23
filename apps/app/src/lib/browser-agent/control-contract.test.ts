import { describe, expect, it } from "vitest";
import { patcherDesktopBrowserControlOperationSchema } from "@patcher/desktop-contract";
import { browserControlOperationSchema } from "@patcher/domain";

/**
 * The fourth union written twice, for the reason the other three are (see
 * interaction-contract.test.ts, observation-contract.test.ts and
 * storage-contract.test.ts): one copy is the agent wire and one is the
 * version-skewed shell wire, and the executor forwards a value parsed by the
 * first straight into the second.
 */

const ROUTE = {
  pattern: "**/api/me",
  status: 200,
  contentType: "application/json",
  body: "{}",
  headers: [{ name: "x-mock", value: "1" }],
};

const ACCEPTED: unknown[] = [
  { kind: "mouse-move", x: 0, y: 0 },
  { kind: "mouse-move", x: 1280, y: 720 },
  { kind: "mouse-button", button: "right", down: true },
  { kind: "mouse-wheel", deltaX: 0, deltaY: -240 },
  { kind: "evaluate", expression: "() => document.title", ref: null },
  { kind: "evaluate", expression: "(el) => el.value", ref: "e12" },
  { kind: "route-set", route: ROUTE },
  { kind: "route-set", route: { ...ROUTE, headers: [] } },
  { kind: "route-list" },
  { kind: "route-clear", pattern: null },
  { kind: "route-clear", pattern: "**/api/me" },
  { kind: "offline", offline: true },
];

const REJECTED: unknown[] = [
  {},
  // A negative coordinate is off the viewport, not behind it.
  { kind: "mouse-move", x: -1, y: 0 },
  { kind: "mouse-move", x: 10 },
  { kind: "mouse-button", button: "left" },
  { kind: "mouse-button", button: "back", down: true },
  { kind: "mouse-wheel", deltaX: 0 },
  { kind: "evaluate", expression: "", ref: null },
  // Absent is not the same as null everywhere else in these unions, and it is
  // not here either.
  { kind: "evaluate", expression: "() => 1" },
  { kind: "evaluate", expression: "() => 1", ref: "button" },
  { kind: "route-set", route: { ...ROUTE, status: 99 } },
  { kind: "route-set", route: { ...ROUTE, pattern: "" } },
  { kind: "route-clear" },
  { kind: "offline" },
  { kind: "screencast" },
];

describe("the control union, on both wires", () => {
  it("accepts the same operations", () => {
    for (const value of ACCEPTED) {
      expect(
        browserControlOperationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(true);
      expect(
        patcherDesktopBrowserControlOperationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(true);
    }
  });

  it("rejects the same operations", () => {
    for (const value of REJECTED) {
      expect(
        browserControlOperationSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(false);
      expect(
        patcherDesktopBrowserControlOperationSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(false);
    }
  });
});
