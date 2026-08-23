import { PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH } from "@patcher/desktop-contract";
import { getDocumentProxy } from "unpdf";
import {
  buildBrowserPdfText,
  browserPdfFailureReason,
  type BrowserPdfTextItem,
} from "./desktop-browser-pdf-text.js";

/**
 * The utility process that turns PDF bytes into text.
 *
 * It exists to be killable. Parsing is unbounded CPU work on a document some
 * page chose, and the main process it would otherwise run in is where every
 * window's UI thread lives — see desktop-browser-pdf-text.ts for the rest of
 * that reasoning. Here the consequences are two: this file talks to its parent
 * over `parentPort` and nothing else, and it never has to shut itself down,
 * because the parent kills it once it has an answer or has waited long enough.
 *
 * One document per process. A pool would save the ~100ms a fork costs and buy a
 * shared heap between two documents that have nothing to do with each other,
 * which is the wrong trade for something whose entire job is to be disposable.
 *
 * It is bundled with its parser rather than resolving one, like every other
 * entry here: packaged, this file is read out of `app.asar`, and a self-
 * contained bundle is the version of that with nothing left to resolve. Both
 * halves were run from a real archive before this was written.
 */

interface PdfTextRequest {
  bytes: Uint8Array;
}

/**
 * Pages are read until the cap is reached, not until the document ends.
 *
 * The difference matters on the documents most worth refusing to read whole: a
 * 900-page scan costs one `getTextContent` per page whether or not anything is
 * still being kept, and everything past the cap is thrown away by definition.
 */
async function extractPdfText(request: PdfTextRequest): Promise<unknown> {
  const document = await getDocumentProxy(request.bytes, {
    // Fonts are the parser's most complex input and none of them carry text,
    // so a text read declines to build them: no font faces, no system font
    // lookups, and nothing fetched while parsing.
    disableFontFace: true,
    useSystemFonts: false,
    useWorkerFetch: false,
  });

  const pages: BrowserPdfTextItem[][] = [];
  let collected = 0;
  let truncated = false;
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const items: BrowserPdfTextItem[] = [];
    for (const item of content.items) {
      if ("str" in item && typeof item.str === "string") {
        items.push({ str: item.str, hasEOL: item.hasEOL === true });
        collected += item.str.length;
      }
    }
    pages.push(items);
    // Freed per page rather than at the end: a page's operator list and fonts
    // are the bulk of what a parse holds, and a long document is exactly the
    // case where holding all of them at once is the problem.
    page.cleanup();
    if (collected > PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH) {
      truncated = pageNumber < document.numPages;
      break;
    }
  }

  const built = buildBrowserPdfText(pages);
  return {
    ok: true,
    text: built.text,
    truncated: built.truncated || truncated,
  };
}

process.parentPort.on("message", (event) => {
  const request = event.data as PdfTextRequest;
  void extractPdfText(request)
    .catch((error: unknown) => ({
      ok: false,
      reason: browserPdfFailureReason(error),
    }))
    .then((message) => {
      process.parentPort.postMessage(message);
    });
});
