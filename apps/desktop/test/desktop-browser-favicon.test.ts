import { describe, expect, it, vi } from "vitest";
import { PATCHER_DESKTOP_BROWSER_MAX_FAVICON_DATA_URL_LENGTH } from "@patcher/desktop-contract";
import {
  PATCHER_DESKTOP_BROWSER_MAX_FAVICON_BYTES,
  resolveBrowserFaviconDataUrl,
  resolveBrowserFaviconMediaType,
  resolveBrowserFaviconPageKey,
  selectBrowserFaviconUrl,
  type BrowserFaviconFetchResponse,
} from "../src/desktop-browser-favicon.js";

const PNG_BYTES = Buffer.from("fake-png-bytes");

function response(
  overrides: Partial<{
    ok: boolean;
    contentType: string | null;
    body: Buffer;
    throwOnBody: boolean;
  }> = {},
): BrowserFaviconFetchResponse {
  const {
    ok = true,
    contentType = "image/png",
    body = PNG_BYTES,
    throwOnBody = false,
  } = overrides;
  return {
    ok,
    headers: {
      get: (name) =>
        name.toLowerCase() === "content-type" ? contentType : null,
    },
    arrayBuffer: async () => {
      if (throwOnBody) {
        throw new Error("body failed");
      }
      return body.buffer.slice(
        body.byteOffset,
        body.byteOffset + body.byteLength,
      ) as ArrayBuffer;
    },
  };
}

describe("selectBrowserFaviconUrl", () => {
  it("takes the first http(s) candidate the page declared", () => {
    expect(
      selectBrowserFaviconUrl([
        "https://example.test/icon.png",
        "https://example.test/other.png",
      ]),
    ).toBe("https://example.test/icon.png");
  });

  // A page controls these strings, so anything that is not a plain web fetch is
  // refused before it can reach the shell's network stack or the renderer's DOM.
  it("refuses schemes that are not http(s), and junk", () => {
    for (const urls of [
      ["data:image/png;base64,AAAA"],
      ["javascript:alert(1)"],
      ["file:///etc/passwd"],
      ["blob:https://example.test/abc"],
      ["not a url"],
      [],
    ]) {
      expect(selectBrowserFaviconUrl(urls)).toBeNull();
    }
  });

  it("skips unusable candidates to reach a usable one", () => {
    expect(
      selectBrowserFaviconUrl([
        "javascript:alert(1)",
        "http://example.test/icon.ico",
      ]),
    ).toBe("http://example.test/icon.ico");
  });
});

// What counts as "the same page" for keeping an icon. Comparing full URLs made a
// reload lose its icon over a trailing slash.
describe("resolveBrowserFaviconPageKey", () => {
  it("treats every URL on a site as the same page", () => {
    const key = resolveBrowserFaviconPageKey("https://example.test");
    for (const url of [
      "https://example.test/",
      "https://example.test/deep/path?q=1#frag",
    ]) {
      expect(resolveBrowserFaviconPageKey(url)).toBe(key);
    }
  });

  it("separates other sites, ports and schemes", () => {
    const key = resolveBrowserFaviconPageKey("https://example.test/");
    for (const url of [
      "https://other.test/",
      "https://example.test:8443/",
      "http://example.test/",
    ]) {
      expect(resolveBrowserFaviconPageKey(url)).not.toBe(key);
    }
  });

  it("has no key for a tab that is on no page", () => {
    expect(resolveBrowserFaviconPageKey("")).toBeNull();
  });
});

describe("resolveBrowserFaviconMediaType", () => {
  it("accepts allowlisted raster types, parameters and case included", () => {
    expect(resolveBrowserFaviconMediaType("image/png")).toBe("image/png");
    expect(resolveBrowserFaviconMediaType("IMAGE/PNG; charset=binary")).toBe(
      "image/png",
    );
    expect(resolveBrowserFaviconMediaType(" image/vnd.microsoft.icon ")).toBe(
      "image/vnd.microsoft.icon",
    );
  });

  // SVG is a document format with a parser surface a 16px tab icon does not need.
  it("refuses svg, non-images, and a missing header", () => {
    expect(resolveBrowserFaviconMediaType("image/svg+xml")).toBeNull();
    expect(resolveBrowserFaviconMediaType("text/html")).toBeNull();
    expect(
      resolveBrowserFaviconMediaType("application/octet-stream"),
    ).toBeNull();
    expect(resolveBrowserFaviconMediaType(null)).toBeNull();
  });
});

describe("resolveBrowserFaviconDataUrl", () => {
  it("returns a data URI whose media type comes from the allowlist", async () => {
    const fetchFavicon = vi.fn(async () =>
      response({ contentType: "image/png;charset=binary" }),
    );

    const dataUrl = await resolveBrowserFaviconDataUrl({
      fetchFavicon,
      urls: ["https://example.test/icon.png"],
    });

    expect(fetchFavicon).toHaveBeenCalledWith("https://example.test/icon.png");
    expect(dataUrl).toBe(
      `data:image/png;base64,${PNG_BYTES.toString("base64")}`,
    );
  });

  it("fetches nothing when the page declared no usable candidate", async () => {
    const fetchFavicon = vi.fn(async () => response());

    expect(
      await resolveBrowserFaviconDataUrl({
        fetchFavicon,
        urls: ["data:image/png;base64,AAAA"],
      }),
    ).toBeNull();
    expect(fetchFavicon).not.toHaveBeenCalled();
  });

  // Every rejection is the same silent null: a missing tab icon is not worth a
  // user-visible error, and the page must not learn what the shell refused.
  it("returns null for a failed request, a rejected type, and a broken body", async () => {
    const cases: BrowserFaviconFetchResponse[] = [
      response({ ok: false }),
      response({ contentType: "image/svg+xml" }),
      response({ contentType: null }),
      response({ throwOnBody: true }),
      response({ body: Buffer.alloc(0) }),
    ];
    for (const stub of cases) {
      expect(
        await resolveBrowserFaviconDataUrl({
          fetchFavicon: async () => stub,
          urls: ["https://example.test/icon.png"],
        }),
      ).toBeNull();
    }
  });

  it("returns null when the fetch itself throws", async () => {
    expect(
      await resolveBrowserFaviconDataUrl({
        fetchFavicon: async () => {
          throw new Error("offline");
        },
        urls: ["https://example.test/icon.png"],
      }),
    ).toBeNull();
  });

  // The byte cap is the guard that keeps a hostile page from pushing megabytes
  // into IPC and renderer memory, one tab at a time.
  it("drops an icon past the byte cap", async () => {
    const oversized = Buffer.alloc(
      PATCHER_DESKTOP_BROWSER_MAX_FAVICON_BYTES + 1,
      1,
    );

    expect(
      await resolveBrowserFaviconDataUrl({
        fetchFavicon: async () => response({ body: oversized }),
        urls: ["https://example.test/icon.png"],
      }),
    ).toBeNull();
  });

  // The two caps are stated in different packages; this is what keeps them from
  // drifting into a payload the wire schema would reject.
  it("keeps the largest accepted icon inside the wire cap", async () => {
    const largest = Buffer.alloc(PATCHER_DESKTOP_BROWSER_MAX_FAVICON_BYTES, 1);

    const dataUrl = await resolveBrowserFaviconDataUrl({
      fetchFavicon: async () => response({ body: largest }),
      urls: ["https://example.test/icon.png"],
    });

    expect(dataUrl).not.toBeNull();
    expect(dataUrl?.length).toBeLessThanOrEqual(
      PATCHER_DESKTOP_BROWSER_MAX_FAVICON_DATA_URL_LENGTH,
    );
  });
});
