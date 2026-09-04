import { describe, expect, it } from "vitest";
import { urlMatches } from "./cli-targets.js";

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
  });

  it("matches a pattern full of regex syntax against itself", () => {
    // Substring and glob both, because the escaping is what stops a pattern
    // from being read as a program.
    expect(urlMatches("https://example.com/a+b(c)", "a+b(c)")).toBe(true);
    expect(urlMatches("https://example.com/a+b(c)", "**/a+b(c)")).toBe(true);
    expect(urlMatches("https://example.com/axb", "**/a+b(c)")).toBe(false);
  });
});
