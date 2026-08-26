import { describe, expect, it } from "vitest";
import {
  PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
  PATCHER_BROWSER_PREPARE_FILL_SCRIPT,
  PATCHER_BROWSER_READ_CHECKED_SCRIPT,
  PATCHER_BROWSER_SELECT_OPTION_SCRIPT,
  browserActionRectsAgree,
  parseBrowserActionSample,
  parseBrowserScriptOutcome,
} from "../src/desktop-browser-actions.js";

/**
 * These scripts run inside a page we do not trust, and their answers cross back
 * as plain JSON. The parsers are the boundary: anything they accept becomes a
 * click at a coordinate, so a page that answers with nonsense has to be told
 * apart from one answering "not yet".
 */

describe("parseBrowserActionSample", () => {
  const RECT = { x: 10, y: 20, width: 30, height: 40 };

  it("accepts a ready sample with a usable point and box", () => {
    expect(
      parseBrowserActionSample({ ready: true, x: 12.5, y: 40, rect: RECT }),
    ).toEqual({ ready: true, x: 12.5, y: 40, rect: RECT });
  });

  it("accepts each blocked reason, since each implies a different next move", () => {
    for (const reason of [
      "detached",
      "not_visible",
      "disabled",
      "offscreen",
      "covered",
    ]) {
      expect(parseBrowserActionSample({ ready: false, reason })).toEqual({
        ready: false,
        reason,
      });
    }
  });

  it("does not accept `unstable` from the page, which never decides it", () => {
    // One sample cannot know whether a box is moving; the caller decides that by
    // comparing two. Accepting it here would let a page claim a verdict that is
    // ours to reach.
    expect(
      parseBrowserActionSample({ ready: false, reason: "unstable" }),
    ).toBeNull();
  });

  it("rejects an unusable answer instead of treating it as not-ready", () => {
    // The difference matters: "not ready" is retried until the deadline, while
    // an unusable answer means the page is not answering our question at all
    // and retrying would just burn the whole timeout.
    expect(parseBrowserActionSample(null)).toBeNull();
    expect(parseBrowserActionSample("ready")).toBeNull();
    expect(parseBrowserActionSample({})).toBeNull();
    expect(
      parseBrowserActionSample({ ready: false, reason: "bored" }),
    ).toBeNull();
    expect(parseBrowserActionSample({ ready: true, x: 1, rect: RECT })).toBeNull();
    // A coordinate that is not a number is the dangerous one: it would reach
    // Input.dispatchMouseEvent and click somewhere undefined.
    expect(
      parseBrowserActionSample({ ready: true, x: "10", y: 20, rect: RECT }),
    ).toBeNull();
    expect(
      parseBrowserActionSample({ ready: true, x: Number.NaN, y: 20, rect: RECT }),
    ).toBeNull();
    expect(
      parseBrowserActionSample({ ready: true, x: Infinity, y: 20, rect: RECT }),
    ).toBeNull();
    // Without a usable box there is no settle check, so this must not pass as
    // ready either.
    expect(parseBrowserActionSample({ ready: true, x: 1, y: 2 })).toBeNull();
    expect(
      parseBrowserActionSample({
        ready: true,
        x: 1,
        y: 2,
        rect: { x: 0, y: 0, width: 10 },
      }),
    ).toBeNull();
  });
});

describe("browserActionRectsAgree", () => {
  const RECT = { x: 10, y: 20, width: 30, height: 40 };

  it("tolerates a subpixel wobble, which is not movement", () => {
    expect(browserActionRectsAgree(RECT, { ...RECT, x: 10.5 })).toBe(true);
    expect(browserActionRectsAgree(RECT, { ...RECT, height: 39.2 })).toBe(true);
  });

  it("calls a real move a move, on any edge", () => {
    expect(browserActionRectsAgree(RECT, { ...RECT, x: 14 })).toBe(false);
    expect(browserActionRectsAgree(RECT, { ...RECT, y: 2 })).toBe(false);
    expect(browserActionRectsAgree(RECT, { ...RECT, width: 60 })).toBe(false);
    expect(browserActionRectsAgree(RECT, { ...RECT, height: 4 })).toBe(false);
  });
});

describe("parseBrowserScriptOutcome", () => {
  it("carries a checked state when there is one", () => {
    expect(
      parseBrowserScriptOutcome({ ok: true, checked: false }),
    ).toEqual({ ok: true, checked: false });
    // The scripts that report no state still succeed; null means "not asked".
    expect(parseBrowserScriptOutcome({ ok: true })).toEqual({
      ok: true,
      checked: null,
    });
  });

  it("keeps the refusal reason and defaults it when absent", () => {
    expect(
      parseBrowserScriptOutcome({ ok: false, reason: "not_editable" }),
    ).toEqual({ ok: false, reason: "not_editable" });
    expect(parseBrowserScriptOutcome({ ok: false })).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("rejects anything that is not an outcome", () => {
    expect(parseBrowserScriptOutcome(undefined)).toBeNull();
    expect(parseBrowserScriptOutcome({ ok: "yes" })).toBeNull();
  });
});

describe("the injected scripts", () => {
  it("are constants with nothing interpolated into them", () => {
    // The whole safety argument for running privileged script in an untrusted
    // page is that the source is fixed and every value crosses as a CDP
    // argument. A template placeholder here would be script injection.
    for (const script of [
      PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
      PATCHER_BROWSER_PREPARE_FILL_SCRIPT,
      PATCHER_BROWSER_READ_CHECKED_SCRIPT,
      PATCHER_BROWSER_SELECT_OPTION_SCRIPT,
    ]) {
      expect(script).not.toContain("${");
      expect(script.startsWith("function")).toBe(true);
    }
  });

  it("never waits inside the page", () => {
    // The bug this guards: awaiting an animation frame here never returns while
    // the app window is covered or minimised, because Chromium stops producing
    // frames for a view nobody can see — and the action hangs until something
    // incidental forces one. The settle interval belongs to the main process.
    for (const script of [
      PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
      PATCHER_BROWSER_PREPARE_FILL_SCRIPT,
      PATCHER_BROWSER_READ_CHECKED_SCRIPT,
      PATCHER_BROWSER_SELECT_OPTION_SCRIPT,
    ]) {
      expect(script).not.toContain("requestAnimationFrame");
      expect(script).not.toContain("await");
      expect(script).not.toContain("setTimeout");
    }
  });

  it("passes the select values in as a parameter rather than baking them in", () => {
    expect(PATCHER_BROWSER_SELECT_OPTION_SCRIPT).toContain("function (values)");
  });
});
