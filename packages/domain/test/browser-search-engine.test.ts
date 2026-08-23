import { describe, expect, it } from "vitest";
import {
  BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER,
  BUILT_IN_BROWSER_SEARCH_ENGINES,
  buildBrowserSearchUrl,
  DEFAULT_BROWSER_SEARCH_ENGINE_ID,
  normalizeBrowserSearchEngineTemplate,
  resolveBrowserSearchEngine,
} from "../src/browser-search-engine.js";

const GOOGLE = `https://www.google.com/search?q=${BROWSER_SEARCH_ENGINE_QUERY_PLACEHOLDER}`;

describe("browser search engines", () => {
  it("ships a usable list with the historical default in it", () => {
    expect(
      BUILT_IN_BROWSER_SEARCH_ENGINES.map((engine) => engine.id),
    ).toContain(DEFAULT_BROWSER_SEARCH_ENGINE_ID);
    for (const engine of BUILT_IN_BROWSER_SEARCH_ENGINES) {
      expect(normalizeBrowserSearchEngineTemplate(engine.urlTemplate)).toBe(
        engine.urlTemplate,
      );
    }
  });

  it("builds a search URL with the query escaped", () => {
    expect(buildBrowserSearchUrl("кот и пёс", GOOGLE)).toBe(
      "https://www.google.com/search?q=%D0%BA%D0%BE%D1%82%20%D0%B8%20%D0%BF%D1%91%D1%81",
    );
    // Everything the shell would otherwise read as structure.
    expect(buildBrowserSearchUrl("a&b=c#d", GOOGLE)).toBe(
      "https://www.google.com/search?q=a%26b%3Dc%23d",
    );
  });

  // A search is every word the user types into the address bar, so a plugin does
  // not get to send it in the clear to another machine.
  it("refuses a template that is not a safe absolute URL with a placeholder", () => {
    for (const template of [
      "http://example.com/?q=%s",
      "javascript:alert(1)?q=%s",
      "file:///tmp/%s",
      "https://example.com/search",
      "https://example.com/?q=%s and more",
      "/relative?q=%s",
      "",
      42,
      null,
    ]) {
      expect(normalizeBrowserSearchEngineTemplate(template)).toBeNull();
    }
  });

  // The one http exception: Patcher's own pages are loopback, and a plugin route is
  // the only way an engine can be something other than a web search.
  it("admits loopback, which is how a plugin route becomes an engine", () => {
    for (const template of [
      "http://127.0.0.1:38986/api/v1/plugins/ask/http/search?q=%s",
      "http://localhost:5173/?q=%s",
      "http://[::1]:3000/?q=%s",
    ]) {
      expect(normalizeBrowserSearchEngineTemplate(template)).toBe(template);
    }
    expect(
      normalizeBrowserSearchEngineTemplate("http://localhost.evil.test/?q=%s"),
    ).toBeNull();
  });

  // A setting outlives the plugin that put the engine in it, and Enter still has
  // to search rather than fail.
  it("falls back to Patcher's own engine for an id nothing answers to", () => {
    const engines = BUILT_IN_BROWSER_SEARCH_ENGINES;

    expect(
      resolveBrowserSearchEngine({ engineId: "gone-with-its-plugin", engines })
        .id,
    ).toBe(DEFAULT_BROWSER_SEARCH_ENGINE_ID);
    expect(resolveBrowserSearchEngine({ engineId: null, engines }).id).toBe(
      DEFAULT_BROWSER_SEARCH_ENGINE_ID,
    );
    expect(resolveBrowserSearchEngine({ engineId: "yandex", engines }).id).toBe(
      "yandex",
    );
  });
});
