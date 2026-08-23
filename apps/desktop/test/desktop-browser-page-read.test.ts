import { describe, expect, it } from "vitest";
import {
  PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH,
  patcherDesktopBrowserPageReadResultSchema,
} from "@patcher/desktop-contract";
import {
  PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT,
  PATCHER_DESKTOP_BROWSER_PAGE_READ_WORLD_ID,
  parseBrowserPageReadContent,
} from "../src/desktop-browser-page-read.js";

describe("browser page read script", () => {
  it("runs outside the page's own world", () => {
    // 0 is the main world (where a page could redefine innerText, getSelection
    // or String to forge the result and to notice it was read); 999 is
    // Electron's own context-isolation world.
    expect(PATCHER_DESKTOP_BROWSER_PAGE_READ_WORLD_ID).not.toBe(0);
    expect(PATCHER_DESKTOP_BROWSER_PAGE_READ_WORLD_ID).not.toBe(999);
  });

  it("is a constant with no interpolation left in it", () => {
    // The script is injected into an untrusted page. Nothing a caller supplies
    // may ever reach it, so the only values baked in are this module's own caps.
    expect(PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT).not.toMatch(/\$\{/);
    expect(PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT).toContain(
      String(PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH),
    );
    expect(PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT).toContain(
      String(PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH),
    );
  });
});

describe("parseBrowserPageReadContent", () => {
  it("accepts a well-formed result", () => {
    expect(
      parseBrowserPageReadContent({
        contentType: "text/html",
        text: "hello",
        textTruncated: false,
        selection: "ell",
        selectionTruncated: false,
      }),
    ).toEqual({
      contentType: "text/html",
      text: "hello",
      textTruncated: false,
      selection: "ell",
      selectionTruncated: false,
    });
  });

  it("rejects anything that is not the expected shape", () => {
    expect(parseBrowserPageReadContent(null)).toBeNull();
    expect(parseBrowserPageReadContent("hello")).toBeNull();
    expect(parseBrowserPageReadContent(undefined)).toBeNull();
    expect(parseBrowserPageReadContent({})).toBeNull();
    expect(
      parseBrowserPageReadContent({
        text: 42,
        textTruncated: false,
        selection: "",
        selectionTruncated: false,
      }),
    ).toBeNull();
    // A truncation flag that is not a boolean would otherwise reach the wire.
    expect(
      parseBrowserPageReadContent({
        text: "hello",
        textTruncated: "no",
        selection: "",
        selectionTruncated: false,
      }),
    ).toBeNull();
  });

  it("reads a missing content type as unknown rather than failing the whole read", () => {
    // The content type only decides which of two ways the text is read. A page
    // that somehow has none is read the ordinary way, which is what every read
    // did before PDFs were read at all.
    const parsed = parseBrowserPageReadContent({
      contentType: 42,
      text: "hello",
      textTruncated: false,
      selection: "",
      selectionTruncated: false,
    });

    expect(parsed?.contentType).toBe("");
    expect(parsed?.text).toBe("hello");
  });

  it("re-truncates and re-flags a result the in-page slice did not bound", () => {
    // The script slices already; this is the layer that guarantees the response
    // validates even if the two ever stop agreeing.
    const parsed = parseBrowserPageReadContent({
      text: "a".repeat(PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH + 10),
      textTruncated: false,
      selection: "b".repeat(
        PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH + 10,
      ),
      selectionTruncated: false,
    });

    expect(parsed?.text).toHaveLength(
      PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH,
    );
    expect(parsed?.textTruncated).toBe(true);
    expect(parsed?.selection).toHaveLength(
      PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH,
    );
    expect(parsed?.selectionTruncated).toBe(true);
  });

  it("keeps a truncation the script reported even when the value now fits", () => {
    const parsed = parseBrowserPageReadContent({
      text: "a".repeat(PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH),
      textTruncated: true,
      selection: "",
      selectionTruncated: false,
    });

    expect(parsed?.textTruncated).toBe(true);
  });

  it("produces a payload the other package's schema accepts at full size", () => {
    // The caps live in @patcher/desktop-contract and the slicing lives here; this is
    // what stops the two from drifting apart unnoticed.
    const parsed = parseBrowserPageReadContent({
      text: "a".repeat(PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH + 1),
      textTruncated: true,
      selection: "b".repeat(
        PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH + 1,
      ),
      selectionTruncated: true,
    });

    expect(
      patcherDesktopBrowserPageReadResultSchema.safeParse({
        ok: true,
        tabId: "browser:a",
        url: "https://example.com/",
        title: "Example",
        isLoading: false,
        ...parsed,
      }).success,
    ).toBe(true);
  });
});
