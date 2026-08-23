// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { adoptLegacyBrowserStorage } from "./legacy-storage-adoption";

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("legacy browser-storage adoption", () => {
  it("renames pre-rename keys in both stores and leaves nothing behind", () => {
    window.localStorage.setItem("bb.sidebar.width", "320");
    window.localStorage.setItem(
      "bb.promptbox.contents-proj_1-thr_1-3",
      '"unsent draft"',
    );
    window.sessionStorage.setItem("bb.browserSurface.mutedTabs-1", "[1,2]");

    expect(adoptLegacyBrowserStorage()).toBe(3);

    expect(window.localStorage.getItem("patcher.sidebar.width")).toBe("320");
    expect(
      window.localStorage.getItem("patcher.promptbox.contents-proj_1-thr_1-3"),
    ).toBe('"unsent draft"');
    expect(
      window.sessionStorage.getItem("patcher.browserSurface.mutedTabs-1"),
    ).toBe("[1,2]");

    expect(window.localStorage.getItem("bb.sidebar.width")).toBeNull();
    expect(
      window.sessionStorage.getItem("bb.browserSurface.mutedTabs-1"),
    ).toBeNull();
  });

  it("keeps a value this build already wrote and still drops the old key", () => {
    window.localStorage.setItem("bb.sidebar.width", "320");
    window.localStorage.setItem("patcher.sidebar.width", "480");

    expect(adoptLegacyBrowserStorage()).toBe(0);

    expect(window.localStorage.getItem("patcher.sidebar.width")).toBe("480");
    expect(window.localStorage.getItem("bb.sidebar.width")).toBeNull();
  });

  it("leaves keys belonging to anything else alone", () => {
    window.localStorage.setItem("patcher.sidebar.open", "true");
    window.localStorage.setItem("some-other-app.state", "keep");
    window.localStorage.setItem("bbedit.recent", "keep");

    adoptLegacyBrowserStorage();

    expect(window.localStorage.getItem("some-other-app.state")).toBe("keep");
    expect(window.localStorage.getItem("bbedit.recent")).toBe("keep");
    expect(window.localStorage.getItem("patcher.sidebar.open")).toBe("true");
  });

  // Runs on every boot, so the second one must be a no-op rather than a
  // second pass that re-reads what the first moved.
  it("is idempotent", () => {
    window.localStorage.setItem("bb.splitLayout", '"wide"');

    expect(adoptLegacyBrowserStorage()).toBe(1);
    expect(adoptLegacyBrowserStorage()).toBe(0);
    expect(window.localStorage.getItem("patcher.splitLayout")).toBe('"wide"');
  });
});
