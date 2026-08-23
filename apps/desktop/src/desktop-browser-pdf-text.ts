import { PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH } from "@patcher/desktop-contract";

/**
 * Reading a PDF tab as text, for the agent browser tools.
 *
 * A PDF is the one document the page read cannot reach. Chromium hands the URL
 * to its built-in viewer, and what that leaves in the main frame is a stub — a
 * stylesheet link and an empty body — with the document itself rendered by
 * PDFium in a frame of its own. `document.body.innerText` is therefore `""`,
 * which is why a PDF tab used to answer an agent with nothing at all.
 *
 * Two ways out were measured against a real viewer before this one was written,
 * and both are dead ends worth recording so they are not tried again:
 *
 * - **The accessibility tree.** PDFium does build one — it is how a screen
 *   reader reads a PDF in Chrome — but it is assembled in the browser process,
 *   not in the renderer CDP's `Accessibility` domain answers from. Attaching to
 *   the PDF content frame (auto-attach, flattened, one level per session) and
 *   asking for the full tree returns five nodes ending in an `EmbeddedObject`,
 *   with `--force-renderer-accessibility` making no difference. The text is
 *   simply not on that side of the process boundary.
 * - **Asking the viewer.** Its plugin messages (`getSelectedText`, `selectAll`)
 *   are Chromium internals with no compatibility promise, reachable only by
 *   scripting an extension frame whose id and layout are free to change.
 *
 * So the bytes are fetched again and parsed here. What that costs, stated
 * rather than discovered:
 *
 * - **A second request.** It goes through the browsing session, so cookies,
 *   proxy and cache all apply and the usual answer comes from the cache the
 *   viewer just filled. A document that only exists as the response to a POST
 *   is the case this cannot serve; it reads as `unreadable`.
 * - **`blob:` and `data:` are out of reach**, because the main process cannot
 *   resolve a URL that only means something inside one renderer. An in-page
 *   fetch would cover them and is the fallback to add if it turns out to
 *   matter.
 * - **The same cap as any other page read.** A long document is truncated to
 *   {@link PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH} with `textTruncated` set,
 *   exactly as a long article is; there is no page range to ask for.
 *
 * Parsing happens in a **utility process**. Not for privilege — the parser is
 * JavaScript, so this is not the sandbox PDFium has — but because the work is
 * unbounded CPU on attacker-supplied input, and the main process is where every
 * window's UI thread lives. A parse that spins there freezes the whole app and
 * no timeout can rescue it; a parse that spins in a child is killed.
 *
 * The parser is pdf.js, packaged as `unpdf`: one dependency, no native code,
 * and no `eval` or `Function` constructor left anywhere in the build — the path
 * that made CVE-2024-4367 possible was removed upstream rather than switched
 * off, so there is no option here to get wrong.
 */

/**
 * Documents past this are refused rather than parsed. A cap is needed because
 * the bytes are held in memory twice (fetched here, cloned to the child), and
 * this one is set where a refusal is more useful than an answer: everything
 * under it parses in well under the deadline below, and a caller told
 * `too-large` knows to stop asking rather than to try again.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_PDF_BYTES = 32 * 1024 * 1024;

/**
 * The whole read — fetch, fork, parse — under one deadline, because an agent's
 * tool call is on the other end of it. Longer than the 2s a page script gets:
 * this one includes a network request and a document parse, where two seconds
 * would refuse ordinary work rather than catch a hang.
 */
export const PATCHER_DESKTOP_BROWSER_PDF_READ_TIMEOUT_MS = 15_000;

/** What the viewer sets as the main frame's `document.contentType`. */
export const PATCHER_DESKTOP_BROWSER_PDF_CONTENT_TYPE = "application/pdf";

/**
 * Whether a page read is looking at a PDF.
 *
 * The content type is the whole test, and it is the reliable one: it is what
 * Chromium decided to hand its viewer, so it stays true for a document served
 * without a `.pdf` in its URL and for one whose URL says `.pdf` but is not.
 * Parameters may carry a charset, hence the split.
 */
export function isBrowserPdfContentType(contentType: string): boolean {
  return (
    contentType.split(";")[0]?.trim().toLowerCase() ===
    PATCHER_DESKTOP_BROWSER_PDF_CONTENT_TYPE
  );
}

/** One run of text pdf.js reports, with where the document broke the line. */
export interface BrowserPdfTextItem {
  str: string;
  hasEOL: boolean;
}

export type DesktopBrowserPdfTextOutcome =
  | { ok: true; text: string; truncated: boolean }
  | {
      ok: false;
      reason: "too-large" | "password-protected" | "timeout" | "unreadable";
    };

/**
 * Turn the parser's per-page runs into the text an agent reads.
 *
 * Kept away from the parser so the shaping is testable without a PDF: text
 * comes out of a PDF as positioned runs, not as prose, and what turns it back
 * into something readable is entirely in the joining. A page break becomes a
 * blank line — the one piece of structure a PDF always has — and runs of blank
 * lines collapse, because a document that leads every page with a header and
 * trails it with a page number otherwise arrives mostly empty.
 *
 * Truncation reports itself for the same reason the in-page slice does: after
 * the cut the original length is gone.
 */
export function buildBrowserPdfText(
  pages: ReadonlyArray<ReadonlyArray<BrowserPdfTextItem>>,
): { text: string; truncated: boolean } {
  const rendered: string[] = [];
  for (const page of pages) {
    let text = "";
    for (const item of page) {
      text += item.str;
      if (item.hasEOL) {
        text += "\n";
      }
    }
    const trimmed = text.replace(/[ \t]+$/gm, "").trim();
    if (trimmed.length > 0) {
      rendered.push(trimmed);
    }
  }
  const joined = rendered.join("\n\n").replace(/\n{3,}/g, "\n\n");
  return {
    text: joined.slice(0, PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH),
    truncated: joined.length > PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH,
  };
}

/** As much of `fetch`'s response as reading a bounded body needs. */
export interface BrowserPdfResponseBody {
  body?: {
    getReader(): {
      read(): Promise<{ done: boolean; value?: Uint8Array }>;
      cancel(): unknown;
    };
  } | null;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Read a response body, giving up once it passes the cap.
 *
 * Streamed rather than buffered because the size that matters is the one the
 * server chooses to send, not the one it announced: a `Content-Length` is a
 * claim, and `arrayBuffer()` on a body that keeps going is a page-controlled
 * allocation in the main process. Reading it in chunks with a running total
 * makes the cap real — the read stops at the first chunk that crosses it.
 *
 * The bufferless path is the fallback for a response with no stream, where
 * checking after the fact is the only check available.
 */
export async function readBrowserPdfBytes(
  response: BrowserPdfResponseBody,
): Promise<
  { ok: true; bytes: Uint8Array } | { ok: false; reason: "too-large" }
> {
  const stream = response.body ?? null;
  if (stream === null) {
    const buffer = await response.arrayBuffer();
    return buffer.byteLength > PATCHER_DESKTOP_BROWSER_MAX_PDF_BYTES
      ? { ok: false, reason: "too-large" }
      : { ok: true, bytes: new Uint8Array(buffer) };
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value === undefined) {
      continue;
    }
    total += value.length;
    if (total > PATCHER_DESKTOP_BROWSER_MAX_PDF_BYTES) {
      void reader.cancel();
      return { ok: false, reason: "too-large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { ok: true, bytes };
}

/**
 * Why a parse failed, in the terms the wire speaks.
 *
 * Only one distinction is worth carrying: a password-protected document is not
 * broken, it is waiting for something an agent does not have, and telling it so
 * saves it from retrying. pdf.js reports that as a named exception rather than
 * a typed one, so the name is what this reads.
 */
export function browserPdfFailureReason(
  error: unknown,
): "password-protected" | "unreadable" {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? (error as { name?: unknown }).name
      : null;
  return name === "PasswordException" ? "password-protected" : "unreadable";
}

/**
 * Validate what the utility process sent back.
 *
 * The child parses attacker-supplied bytes, so its reply is treated like any
 * other untrusted payload — a crashed or wedged child that manages one last
 * malformed message must not become a malformed page read. Anything unexpected
 * reads as `unreadable`, which is also what a child that says nothing gets.
 */
export function parseBrowserPdfTextMessage(
  raw: unknown,
): DesktopBrowserPdfTextOutcome {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "unreadable" };
  }
  const message = raw as Record<string, unknown>;
  if (message.ok !== true) {
    const reason = message.reason;
    return {
      ok: false,
      reason:
        reason === "password-protected" || reason === "too-large"
          ? reason
          : "unreadable",
    };
  }
  if (typeof message.text !== "string") {
    return { ok: false, reason: "unreadable" };
  }
  return {
    ok: true,
    // Re-truncated here for the same reason the page read is: the cap must hold
    // even if the child ever stops agreeing with it.
    text: message.text.slice(0, PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH),
    truncated:
      message.truncated === true ||
      message.text.length > PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH,
  };
}
