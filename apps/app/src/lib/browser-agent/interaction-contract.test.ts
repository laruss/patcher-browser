import { describe, expect, it } from "vitest";
import { patcherDesktopBrowserInteractionSchema } from "@patcher/desktop-contract";
import { browserInteractionSchema } from "@patcher/domain";

/**
 * The interaction union is written twice — once in `@patcher/domain` for the wire
 * between the server and this app, once in `@patcher/desktop-contract` for the wire
 * between this app and the Electron shell. They are separate because only the
 * second one carries version skew, not because they mean different things, and
 * the executor forwards a value parsed by the first straight into the second.
 *
 * So a field one accepts and the other rejects is a shape that parses on the way
 * in and is refused at the last hop, with the failure surfacing far from the
 * change that caused it. This is the only place both are in scope.
 */

const ACCEPTED: unknown[] = [
  { action: "click", ref: "e1", button: "left", clickCount: 1, modifiers: [] },
  {
    action: "click",
    ref: "e120",
    button: "right",
    clickCount: 2,
    modifiers: ["Shift", "Meta"],
  },
  { action: "hover", ref: "e2" },
  { action: "drag", ref: "e1", targetRef: "e2" },
  { action: "fill", ref: "e1", text: "" },
  { action: "type", ref: "e1", text: "abc" },
  { action: "press", ref: null, key: "Enter" },
  { action: "press", ref: "e1", key: "Control+a" },
  { action: "select", ref: "e1", values: ["Red"] },
  { action: "check", ref: "e1", checked: false },
  { action: "upload", ref: "e1", paths: ["/tmp/a.png"] },
  { action: "resize", width: 0, height: 0 },
  { action: "resize", width: 1280, height: 720 },
];

const REJECTED: unknown[] = [
  {},
  { action: "click", ref: "e1" },
  // A ref is a shape, so something that was never a ref is refused before it is
  // looked up.
  { action: "hover", ref: "button.submit" },
  { action: "hover", ref: "e0" },
  { action: "hover", ref: "e-1" },
  { action: "press", ref: null, key: "" },
  { action: "select", ref: "e1", values: [] },
  { action: "upload", ref: "e1", paths: [] },
  { action: "resize", width: -1, height: 100 },
  { action: "resize", width: 1.5, height: 100 },
  { action: "resize", width: 100_000, height: 100 },
  { action: "teleport", ref: "e1" },
];

describe("the interaction union, on both wires", () => {
  it("accepts the same actions", () => {
    for (const value of ACCEPTED) {
      expect(
        browserInteractionSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(true);
      expect(
        patcherDesktopBrowserInteractionSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(true);
    }
  });

  it("rejects the same actions", () => {
    for (const value of REJECTED) {
      expect(
        browserInteractionSchema.safeParse(value).success,
        `domain: ${JSON.stringify(value)}`,
      ).toBe(false);
      expect(
        patcherDesktopBrowserInteractionSchema.safeParse(value).success,
        `desktop: ${JSON.stringify(value)}`,
      ).toBe(false);
    }
  });

  it("agrees on where the text caps fall", () => {
    // `fill` replaces a value in one step; `type` sends an event per character,
    // so its cap is what keeps one command from spending minutes in the main
    // process. Both wires have to draw the line in the same place.
    for (const [action, limit] of [
      ["fill", 8_192],
      ["type", 1_024],
    ] as const) {
      const atLimit = { action, ref: "e1", text: "x".repeat(limit) };
      const overLimit = { action, ref: "e1", text: "x".repeat(limit + 1) };
      expect(browserInteractionSchema.safeParse(atLimit).success).toBe(true);
      expect(
        patcherDesktopBrowserInteractionSchema.safeParse(atLimit).success,
      ).toBe(true);
      expect(browserInteractionSchema.safeParse(overLimit).success).toBe(false);
      expect(
        patcherDesktopBrowserInteractionSchema.safeParse(overLimit).success,
      ).toBe(false);
    }
  });
});
