import { describe, expect, it } from "vitest";
import { browserCommandSchema } from "../src/browser-control.js";
import {
  pluginSiteAccessAllows,
  pluginSiteCeilingAllows,
  pluginSiteOrigin,
  runtimeSiteCommandSupported,
} from "../src/plugin-site-access.js";

describe("runtime site origin", () => {
  it.each([
    ["https://EXAMPLE.com:443/path", "https://example.com"],
    ["https://example.com:444/path", "https://example.com:444"],
    ["https://bücher.example/a", "https://xn--bcher-kva.example"],
    ["http://localhost:80/a", "http://localhost"],
    ["http://127.0.0.1:123/a", "http://127.0.0.1:123"],
    ["http://[::1]:123/a", "http://[::1]:123"],
    ["http://example.com/", null],
    ["file:///tmp/a", null],
    ["data:text/plain,a", null],
    ["https://user:pass@example.com/", null],
    ["about:blank", null],
  ])("canonicalizes %s", (url, expected) =>
    expect(pluginSiteOrigin(url!)).toBe(expected),
  );
  it("intersects exact grants with the actual URL ceiling", () => {
    const sites = ["https://*.example.com/private/*"];
    expect(
      pluginSiteCeilingAllows(sites, "https://a.example.com/private/a"),
    ).toBe(true);
    expect(
      pluginSiteAccessAllows(
        sites,
        ["https://a.example.com"],
        "https://a.example.com/private/a",
      ),
    ).toBe(true);
    for (const url of [
      "https://b.example.com/private/a",
      "https://a.example.com:444/private/a",
      "https://a.example.com/public/a",
    ])
      expect(
        pluginSiteAccessAllows(sites, ["https://a.example.com"], url),
      ).toBe(false);
  });
});
describe("runtime command subset", () => {
  it.each([
    { type: "tabs.list" },
    { type: "navigation.back", tabId: "tab" },
    { type: "page.get_url", tabId: null },
    {
      type: "page.observe",
      tabId: "tab",
      observation: { kind: "console", limit: 50 },
    },
    {
      type: "page.observe",
      tabId: "tab",
      observation: {
        kind: "screenshot",
        format: "png",
        quality: 80,
        fullPage: true,
      },
    },
    {
      type: "page.control",
      tabId: "tab",
      generation: null,
      operation: { kind: "offline", offline: true },
    },
  ])("refuses unscoped or session operations: %j", (raw) => {
    expect(runtimeSiteCommandSupported(browserCommandSchema.parse(raw))).toBe(
      false,
    );
  });
  it("admits an explicitly named read/evaluate/viewport screenshot", () => {
    for (const raw of [
      { type: "page.get_url", tabId: "tab" },
      {
        type: "page.control",
        tabId: "tab",
        generation: null,
        operation: { kind: "evaluate", expression: "1", ref: null },
      },
      {
        type: "page.observe",
        tabId: "tab",
        observation: {
          kind: "screenshot",
          format: "png",
          quality: 80,
          fullPage: false,
        },
      },
    ])
      expect(runtimeSiteCommandSupported(browserCommandSchema.parse(raw))).toBe(
        true,
      );
  });
});
