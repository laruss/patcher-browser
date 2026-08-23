import { describe, expect, it, vi } from "vitest";
import { PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH } from "@patcher/desktop-contract";
import {
  PATCHER_DESKTOP_BROWSER_MAX_PDF_BYTES,
  browserPdfFailureReason,
  buildBrowserPdfText,
  isBrowserPdfContentType,
  parseBrowserPdfTextMessage,
  readBrowserPdfBytes,
} from "../src/desktop-browser-pdf-text.js";

/**
 * The reading of a PDF, without a PDF.
 *
 * Everything the shell decides about a PDF read that is not "ask Chromium" or
 * "fork a process" lives in that module, which is what makes the parts worth
 * testing — the caps, the shaping, and what is believed about an answer that
 * came from a process parsing a document a page chose — testable at all.
 */

function items(
  ...entries: Array<[string, boolean]>
): Array<{ str: string; hasEOL: boolean }> {
  return entries.map(([str, hasEOL]) => ({ str, hasEOL }));
}

describe("isBrowserPdfContentType", () => {
  it("recognizes what Chromium hands its viewer, parameters and all", () => {
    expect(isBrowserPdfContentType("application/pdf")).toBe(true);
    expect(isBrowserPdfContentType("APPLICATION/PDF")).toBe(true);
    expect(isBrowserPdfContentType("application/pdf; charset=binary")).toBe(
      true,
    );
    expect(isBrowserPdfContentType(" application/pdf ")).toBe(true);
  });

  it("leaves every other document to the ordinary read", () => {
    expect(isBrowserPdfContentType("text/html")).toBe(false);
    expect(isBrowserPdfContentType("application/pdf+xml")).toBe(false);
    // A page read that could not tell reads as HTML, which is what every read
    // was before PDFs were read at all.
    expect(isBrowserPdfContentType("")).toBe(false);
  });
});

describe("buildBrowserPdfText", () => {
  it("turns positioned runs back into lines and pages into paragraphs", () => {
    const text = buildBrowserPdfText([
      items(["Quarterly ", false], ["Report", true], ["Revenue rose.", true]),
      items(["Second page.", true]),
    ]).text;

    expect(text).toBe("Quarterly Report\nRevenue rose.\n\nSecond page.");
  });

  it("drops the blank pages a header-and-footer document is mostly made of", () => {
    // Without this a scanned report reads as page after page of nothing, with
    // the little text it has buried in blank lines.
    const built = buildBrowserPdfText([
      items(["Chapter one", true]),
      items(["   ", true], ["", false]),
      items(["Chapter two", true]),
    ]);

    expect(built.text).toBe("Chapter one\n\nChapter two");
    expect(built.truncated).toBe(false);
  });

  it("collapses the runs of blank lines a PDF's line breaks leave behind", () => {
    const built = buildBrowserPdfText([
      items(["a", true], ["", true], ["", true], ["b", true]),
    ]);

    expect(built.text).toBe("a\n\nb");
  });

  it("truncates to the page-read cap and says so", () => {
    const long = "x".repeat(PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH + 100);
    const built = buildBrowserPdfText([items([long, false])]);

    expect(built.text).toHaveLength(
      PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH,
    );
    expect(built.truncated).toBe(true);
  });
});

describe("readBrowserPdfBytes", () => {
  function streamOf(
    chunks: Uint8Array[],
    onCancel?: () => void,
  ): { getReader(): ReturnType<typeof reader> } {
    let index = 0;
    function reader() {
      return {
        async read(): Promise<{ done: boolean; value?: Uint8Array }> {
          const value = chunks[index];
          index += 1;
          return value === undefined ? { done: true } : { done: false, value };
        },
        cancel(): unknown {
          onCancel?.();
          return undefined;
        },
      };
    }
    return { getReader: reader };
  }

  it("joins a streamed body back into the document's bytes", async () => {
    const result = await readBrowserPdfBytes({
      body: streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]),
      arrayBuffer: async () => {
        throw new Error("the stream is what should have been read");
      },
    });

    expect(result).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
  });

  it("stops at the first chunk past the cap rather than buffering the rest", async () => {
    // The size that matters is the one the server chooses to send: a body that
    // keeps going must not become an allocation the page controls.
    const cancel = vi.fn();
    const chunk = new Uint8Array(PATCHER_DESKTOP_BROWSER_MAX_PDF_BYTES);
    const result = await readBrowserPdfBytes({
      body: streamOf([chunk, new Uint8Array([1])], cancel),
      arrayBuffer: async () => new ArrayBuffer(0),
    });

    expect(result).toEqual({ ok: false, reason: "too-large" });
    expect(cancel).toHaveBeenCalled();
  });

  it("falls back to buffering a response with no stream, and still bounds it", async () => {
    await expect(
      readBrowserPdfBytes({
        body: null,
        arrayBuffer: async () => new Uint8Array([9, 9]).buffer,
      }),
    ).resolves.toEqual({ ok: true, bytes: new Uint8Array([9, 9]) });

    await expect(
      readBrowserPdfBytes({
        arrayBuffer: async () =>
          new ArrayBuffer(PATCHER_DESKTOP_BROWSER_MAX_PDF_BYTES + 1),
      }),
    ).resolves.toEqual({ ok: false, reason: "too-large" });
  });
});

describe("browserPdfFailureReason", () => {
  it("keeps the one distinction an agent can act on", () => {
    // A password-protected document is not broken: it is waiting for something
    // the agent does not have, and retrying will not produce it.
    expect(browserPdfFailureReason({ name: "PasswordException" })).toBe(
      "password-protected",
    );
    expect(browserPdfFailureReason(new Error("corrupt"))).toBe("unreadable");
    expect(browserPdfFailureReason(null)).toBe("unreadable");
    expect(browserPdfFailureReason("PasswordException")).toBe("unreadable");
  });
});

describe("parseBrowserPdfTextMessage", () => {
  it("accepts an answer and re-truncates it against the cap", () => {
    expect(
      parseBrowserPdfTextMessage({ ok: true, text: "hello", truncated: false }),
    ).toEqual({ ok: true, text: "hello", truncated: false });

    const parsed = parseBrowserPdfTextMessage({
      ok: true,
      text: "x".repeat(PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH + 5),
      truncated: false,
    });

    expect(parsed).toEqual({
      ok: true,
      text: "x".repeat(PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH),
      truncated: true,
    });
  });

  it("treats anything else as a document it could not read", () => {
    // The child parses attacker-supplied bytes; a last malformed message from a
    // wedged one must not become a malformed page read.
    expect(parseBrowserPdfTextMessage(null)).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(parseBrowserPdfTextMessage("done")).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(parseBrowserPdfTextMessage({ ok: true })).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(
      parseBrowserPdfTextMessage({ ok: false, reason: "something-new" }),
    ).toEqual({ ok: false, reason: "unreadable" });
  });

  it("passes through the refusals the wire knows", () => {
    expect(
      parseBrowserPdfTextMessage({ ok: false, reason: "password-protected" }),
    ).toEqual({ ok: false, reason: "password-protected" });
    expect(
      parseBrowserPdfTextMessage({ ok: false, reason: "too-large" }),
    ).toEqual({ ok: false, reason: "too-large" });
  });
});
