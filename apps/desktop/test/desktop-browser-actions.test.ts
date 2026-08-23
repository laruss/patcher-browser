import { describe, expect, it } from "vitest";
import {
  PATCHER_BROWSER_ACTIONABILITY_SCRIPT,
  PATCHER_BROWSER_PREPARE_FILL_SCRIPT,
  PATCHER_BROWSER_READ_CHECKED_SCRIPT,
  PATCHER_BROWSER_SELECT_OPTION_SCRIPT,
  parseBrowserActionProbe,
  parseBrowserScriptOutcome,
} from "../src/desktop-browser-actions.js";

/**
 * These scripts run inside a page we do not trust, and their answers cross back
 * as plain JSON. The parsers are the boundary: anything they accept becomes a
 * click at a coordinate, so a page that answers with nonsense has to be told
 * apart from one answering "not yet".
 */

describe("parseBrowserActionProbe", () => {
  it("accepts a ready probe with a usable point", () => {
    expect(parseBrowserActionProbe({ ready: true, x: 12.5, y: 40 })).toEqual({
      ready: true,
      x: 12.5,
      y: 40,
    });
  });

  it("accepts each blocked reason, since each implies a different next move", () => {
    for (const reason of [
      "detached",
      "not_visible",
      "unstable",
      "disabled",
      "offscreen",
      "covered",
    ]) {
      expect(parseBrowserActionProbe({ ready: false, reason })).toEqual({
        ready: false,
        reason,
      });
    }
  });

  it("rejects an unusable answer instead of treating it as not-ready", () => {
    // The difference matters: "not ready" is retried until the deadline, while
    // an unusable answer means the page is not answering our question at all
    // and retrying would just burn the whole timeout.
    expect(parseBrowserActionProbe(null)).toBeNull();
    expect(parseBrowserActionProbe("ready")).toBeNull();
    expect(parseBrowserActionProbe({})).toBeNull();
    expect(parseBrowserActionProbe({ ready: false, reason: "bored" })).toBeNull();
    expect(parseBrowserActionProbe({ ready: true, x: 1 })).toBeNull();
    // A coordinate that is not a number is the dangerous one: it would reach
    // Input.dispatchMouseEvent and click somewhere undefined.
    expect(
      parseBrowserActionProbe({ ready: true, x: "10", y: 20 }),
    ).toBeNull();
    expect(
      parseBrowserActionProbe({ ready: true, x: Number.NaN, y: 20 }),
    ).toBeNull();
    expect(
      parseBrowserActionProbe({ ready: true, x: Infinity, y: 20 }),
    ).toBeNull();
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
      expect(script.startsWith("function") || script.startsWith("async function")).toBe(
        true,
      );
    }
  });

  it("passes the select values in as a parameter rather than baking them in", () => {
    expect(PATCHER_BROWSER_SELECT_OPTION_SCRIPT).toContain("function (values)");
  });
});
