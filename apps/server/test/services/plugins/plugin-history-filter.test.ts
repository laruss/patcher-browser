import { describe, expect, it } from "vitest";
import { BROWSER_HISTORY_URL_MAX_LENGTH } from "@patcher/domain";
import { applyBrowserHistoryRewrite } from "../../../src/services/plugins/plugin-history-filter.js";

const VISIT = {
  scopeId: "browser",
  title: "Example",
  url: "https://example.test/page?utm_source=mail",
  visitedAt: 1_700_000_000_000,
} as const;

/**
 * The rewrite is the one value on the history write path that no schema has
 * checked — the route validated the visit, and this comes back from plugin code,
 * as JSON when the plugin runs out of process. What it may not do is produce a
 * row the read contract cannot describe, because reads validate what they
 * return: the cost of writing one lands on the next read of the whole list, far
 * from the plugin that caused it.
 */
describe("applyBrowserHistoryRewrite", () => {
  it("applies a rewrite of both fields", () => {
    expect(
      applyBrowserHistoryRewrite(VISIT, {
        title: "Cleaned",
        url: "https://example.test/page",
      }),
    ).toEqual({
      ...VISIT,
      title: "Cleaned",
      url: "https://example.test/page",
    });
  });

  it("keeps the visit's own values for fields the rewrite leaves out", () => {
    expect(applyBrowserHistoryRewrite(VISIT, {})).toEqual(VISIT);
  });

  // A page with no title is a real answer, and the store holds null for it.
  it("takes a null title", () => {
    expect(applyBrowserHistoryRewrite(VISIT, { title: null }).title).toBeNull();
  });

  it("ignores a URL that is not a string", () => {
    expect(
      applyBrowserHistoryRewrite(VISIT, {
        url: 12_345 as never,
      }).url,
    ).toBe(VISIT.url);
  });

  it("ignores a URL past the store's cap", () => {
    expect(
      applyBrowserHistoryRewrite(VISIT, {
        url: `https://example.test/${"x".repeat(BROWSER_HISTORY_URL_MAX_LENGTH)}`,
      }).url,
    ).toBe(VISIT.url);
  });

  // The read contract's URL is a non-empty string, so "" is as unwritable as a
  // number — and a row with no URL is not a page anyone could go back to.
  it("ignores an empty URL", () => {
    expect(applyBrowserHistoryRewrite(VISIT, { url: "" }).url).toBe(VISIT.url);
  });

  it("ignores a title that is neither string nor null", () => {
    expect(
      applyBrowserHistoryRewrite(VISIT, { title: { text: "no" } as never })
        .title,
    ).toBe(VISIT.title);
  });
});
