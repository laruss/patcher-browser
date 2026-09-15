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

describe("--tab <the middle of an id>", () => {
  const MINTED = "browser:mBzvl_Vk4OTrCNzR5SpTr:none";

  it("names the tab whose id it is the middle of", async () => {
    // The reported spelling: the listing prints the id between `browser:` and
    // `:none`, and the part in between is the one that tells tabs apart.
    const resolved = await resolveTabTarget(
      browserWithTabs([
        { tabId: "browser:V1StGXR8_Z5jdHi6B-myT:none", url: "https://a.test/" },
        { tabId: MINTED, url: "https://x.com/cocktailpeanut" },
      ]),
      "mBzvl_Vk4OTrCNzR5SpTr",
      {},
    );

    expect(resolved).toEqual({ tabId: MINTED });
  });

  it("wins over another tab's URL that happens to contain it", async () => {
    const resolved = await resolveTabTarget(
      browserWithTabs([
        {
          tabId: "browser:V1StGXR8_Z5jdHi6B-myT:none",
          url: "https://docs.test/?id=mBzvl_Vk4OTrCNzR5SpTr",
        },
        { tabId: MINTED, url: "https://x.com/" },
      ]),
      "mBzvl_Vk4OTrCNzR5SpTr",
      {},
    );

    expect(resolved).toEqual({ tabId: MINTED });
  });

  it("is only the middle of an id the browser minted", async () => {
    // `tab-1` has no middle; `browser:1:none` is not a shape this browser
    // mints, so `1` stays an index rather than naming it.
    const resolved = await resolveTabTarget(
      browserWithTabs([
        { tabId: "tab-9", url: "https://first.test/" },
        { tabId: "browser:1:none", url: "https://second.test/" },
      ]),
      "1",
      {},
    );

    expect(resolved).toEqual({ tabId: "tab-9" });
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
