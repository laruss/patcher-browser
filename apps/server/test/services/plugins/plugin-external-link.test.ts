import { describe, expect, it } from "vitest";
import { readBrowserExternalLinkDecision } from "../../../src/services/plugins/plugin-external-link.js";

describe("readBrowserExternalLinkDecision", () => {
  it("takes a rewritten http(s) address", () => {
    expect(
      readBrowserExternalLinkDecision({ url: "https://example.com/work" }),
    ).toEqual({ url: "https://example.com/work" });
  });

  it("takes a link the plugin says it handled", () => {
    expect(readBrowserExternalLinkDecision({ handled: true })).toEqual({
      handled: true,
    });
  });

  it("declines for everything that decided nothing", () => {
    // Every one of these leaves the arriving link to open in a tab, which is
    // what it would have done with no plugin at all.
    expect(readBrowserExternalLinkDecision(null)).toBeNull();
    expect(readBrowserExternalLinkDecision(undefined)).toBeNull();
    expect(readBrowserExternalLinkDecision({})).toBeNull();
    expect(readBrowserExternalLinkDecision({ handled: false })).toBeNull();
    expect(readBrowserExternalLinkDecision("https://example.com/")).toBeNull();
  });

  it("refuses an address that is not a page", () => {
    // The rewrite opens in a browsed view: `file:` would read the local disk and
    // `javascript:` would run in whatever page it landed on.
    expect(
      readBrowserExternalLinkDecision({ url: "file:///etc/passwd" }),
    ).toBeNull();
    expect(
      readBrowserExternalLinkDecision({ url: "javascript:alert(1)" }),
    ).toBeNull();
    expect(readBrowserExternalLinkDecision({ url: "not a url" })).toBeNull();
    expect(
      readBrowserExternalLinkDecision({
        url: `https://example.com/${"a".repeat(5_000)}`,
      }),
    ).toBeNull();
  });

  it("keeps `handled` when the rewrite is refused", () => {
    // The plugin took the link over *and* offered an address Patcher will not open:
    // the take-over still stands, so nothing opens.
    expect(
      readBrowserExternalLinkDecision({ handled: true, url: "ftp://x/y" }),
    ).toEqual({ handled: true });
  });
});
