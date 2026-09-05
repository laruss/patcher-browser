import { describe, expect, it } from "vitest";
import type { PatcherPluginApi, PluginBrowserTab } from "@patcher/plugin-sdk";
import { resolveTabTarget, urlMatches } from "./cli-targets.js";

function browserWithTabs(tabs: Partial<PluginBrowserTab>[]): PatcherPluginApi {
  return {
    browser: { tabs: { list: () => Promise.resolve(tabs) } },
  } as unknown as PatcherPluginApi;
}

describe("--tab active", () => {
  it("names the tab the person is looking at, rather than falling through", async () => {
    // It used to resolve to "no tab named", which meant the same thing while
    // an unnamed command went to the active tab. Ownership moved that default
    // to the caller's own newest tab, so passing it through would now answer
    // about a different page than the caller asked about — silently.
    const resolved = await resolveTabTarget(
      browserWithTabs([
        { tabId: "tab-1", active: false },
        { tabId: "tab-2", active: true },
      ]),
      "active",
      {},
    );

    expect(resolved).toEqual({ tabId: "tab-2" });
  });

  it("says so when the window has no active tab", async () => {
    const resolved = await resolveTabTarget(browserWithTabs([]), "active", {});

    expect(resolved).toEqual({
      error: "No tab is active in that browser window.\n",
    });
  });
});

describe("urlMatches", () => {
  it("matches a query string, which is a common thing to wait for", () => {
    // The defect: `?` used to switch the pattern into glob mode, and a glob is
    // anchored at both ends, so the substring a caller typed could never match
    // the URL it is a substring of. It waited out the timeout and exited 124.
    expect(
      urlMatches("https://example.com/search?q=cats", "search?q=cats"),
    ).toBe(true);
  });

  it("still reads a * as a glob, anchored at both ends", () => {
    expect(
      urlMatches("https://example.com/a/b", "https://example.com/**"),
    ).toBe(true);
    // `*` stops at a separator, which is what makes the two spellings worth
    // having, and the anchoring is what makes a glob different from a
    // substring.
    expect(urlMatches("https://example.com/a/b", "https://example.com/*")).toBe(
      false,
    );
    expect(urlMatches("https://example.com/a", "example.com/*")).toBe(false);
  });

  it("keeps the ? wildcard inside a pattern that is a glob", () => {
    // Not a special case for `--url`: this is the dialect the rest of the
    // repository writes URL patterns in, and a pattern copied from one surface
    // to another has to mean the same thing.
    expect(
      urlMatches("https://example.com/search?q=cats", "**/search?q=*"),
    ).toBe(true);
    // The discriminating half: that one passes whether the `?` is a wildcard or
    // an escaped literal, because the URL happens to have a `?` in the same
    // place. This one only passes if it is still a wildcard.
    expect(
      urlMatches("https://example.com/searchXq=cats", "**/search?q=*"),
    ).toBe(true);
    // And it stops at a separator, as `*` does.
    expect(
      urlMatches("https://example.com/search/q=cats", "**/search?q=*"),
    ).toBe(false);
  });

  it("matches a pattern full of regex syntax against itself", () => {
    // Substring and glob both, because the escaping is what stops a pattern
    // from being read as a program.
    expect(urlMatches("https://example.com/a+b(c)", "a+b(c)")).toBe(true);
    expect(urlMatches("https://example.com/a+b(c)", "**/a+b(c)")).toBe(true);
    expect(urlMatches("https://example.com/axb", "**/a+b(c)")).toBe(false);
  });
});
