import { describe, expect, it } from "vitest";
import { PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION } from "@patcher/desktop-contract";
import {
  PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT,
  missingViewportCaptureRefusal,
  offScreenCaptureRefusal,
  parseBrowserCaptureRegion,
} from "../src/desktop-browser-capture.js";

describe("the content-size script", () => {
  it("is a constant with no interpolation left in it", () => {
    // Injected into an untrusted page, like every other script this shell
    // runs: nothing a caller supplies may reach it.
    expect(PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT).not.toMatch(/\$\{/);
  });

  it("measures both elements, because neither one is right everywhere", () => {
    // A standards-mode page grows `documentElement`; a quirks-mode one grows
    // `body`. Reading only one of them cuts half the web off at the viewport.
    expect(PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT).toContain(
      "document.documentElement",
    );
    expect(PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT).toContain("document.body");
    expect(PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT).toContain("scrollHeight");
    expect(PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT).toContain("offsetHeight");
  });
});

describe("parseBrowserCaptureRegion", () => {
  it("takes a measured document as the region to capture", () => {
    expect(parseBrowserCaptureRegion({ width: 1280, height: 4200 })).toEqual({
      width: 1280,
      height: 4200,
      truncated: false,
    });
  });

  it("floors fractional pixels rather than asking for a fraction of one", () => {
    expect(parseBrowserCaptureRegion({ width: 1280.6, height: 900.4 })).toEqual({
      width: 1280,
      height: 900,
      truncated: false,
    });
  });

  it("clamps a document past what one capture can hold, and says so", () => {
    // Past the maximum texture size the answer is a blank image or an error,
    // so a very long page is captured down to its top — reported, not hidden.
    const region = parseBrowserCaptureRegion({
      width: 1280,
      height: PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION + 5_000,
    });

    expect(region).toEqual({
      width: 1280,
      height: PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION,
      truncated: true,
    });
  });

  it("clamps width the same way, since a wide page fails the same way", () => {
    expect(
      parseBrowserCaptureRegion({
        width: PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION + 1,
        height: 600,
      }),
    ).toEqual({
      width: PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION,
      height: 600,
      truncated: true,
    });
  });

  it("refuses anything that is not a pair of usable numbers", () => {
    // The value comes back from a process rendering attacker-supplied content.
    // A page reporting NaN, a negative height, or an object of its own choosing
    // must cost a refusal rather than a capture request built from it.
    for (const raw of [
      null,
      "big",
      {},
      { width: 100 },
      { width: 100, height: 0 },
      { width: 0, height: 100 },
      { width: -1, height: 100 },
      { width: Number.NaN, height: 100 },
      { width: 100, height: Number.POSITIVE_INFINITY },
      { width: "100", height: "100" },
    ]) {
      expect(parseBrowserCaptureRegion(raw), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("offScreenCaptureRefusal", () => {
  const drawn = {
    visible: true,
    overlayActive: false,
    pendingDialog: null,
    pagePrompt: null,
  };

  it("lets a tab on screen be captured", () => {
    expect(offScreenCaptureRefusal(drawn)).toBeNull();
    expect(missingViewportCaptureRefusal(drawn).message).toBe(
      "The browser captured nothing.",
    );
  });

  it("refuses a tab in the background, or one the app is drawing over", () => {
    for (const tab of [
      { ...drawn, visible: false },
      { ...drawn, overlayActive: true },
      { ...drawn, pagePrompt: { kind: "auth" } },
    ]) {
      const message = offScreenCaptureRefusal(tab)?.message ?? "";
      expect(message).toContain("not on screen");
      expect(missingViewportCaptureRefusal(tab).message).toBe(message);
      // A fact, not advice: the shell cannot tell a caller that may bring the
      // tab forward from one that may not, nor a tab behind another from every
      // tab behind a thread.
      expect(message).not.toMatch(/activat|front|switch/i);
    }
  });

  it("names the dialog when a dialog is what hides the page", () => {
    expect(
      offScreenCaptureRefusal({ ...drawn, pendingDialog: { type: "alert" } })
        ?.message,
    ).toContain("dialog is open");
  });
});
