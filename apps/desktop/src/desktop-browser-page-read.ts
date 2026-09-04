import {
  PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH,
} from "@patcher/desktop-contract";

/**
 * Reading what a page says, for the agent browser tools.
 *
 * The policy lives here rather than in the view manager for the same reason the
 * favicon rules do: it is the part carrying security-relevant limits, and it is
 * worth testing without an Electron window around it.
 *
 * Two limits of this approach, named here rather than papered over:
 *
 * - **Main frame only.** `WebFrameMain` exposes no isolated-world execution, so
 *   iframe content is not included. A page whose article lives in an iframe
 *   reads as empty.
 * - **Selection inside `<input>`/`<textarea>` reads as empty.** Chromium keeps
 *   native-control selection out of `document.getSelection()`. Reaching for
 *   `activeElement.value` would fix it and is deliberately not done: that reads
 *   form fields, including one the user is typing a password into.
 */

/**
 * The isolated world the read script runs in.
 *
 * Browsed pages are created with `sandbox: true`, `contextIsolation: true` and
 * deliberately **no preload** (`createEntry` in desktop-browser-view.ts), so the
 * main world belongs to the page alone. Running the read in a separate world
 * means `document`, `getSelection` and `String` are ours: a page cannot redefine
 * `innerText` on the prototype to forge the result, cannot defeat the size cap
 * by returning something huge, and — the one that matters most — cannot use a
 * property getter as a side channel telling it an agent is reading right now.
 * Cloaking against automated readers is an active pattern, not a hypothetical.
 *
 * An isolated world also bypasses page CSP, so a strict-CSP page cannot refuse
 * the read. Any id other than 0 (the main world) works; 999 is Electron's own
 * context-isolation world, so this sits well clear of both.
 */
export const PATCHER_DESKTOP_BROWSER_PAGE_READ_WORLD_ID = 1729;

/**
 * A page that never answers must not hold an agent's tool call open. This is
 * mandatory rather than defensive: script execution is suspended while a page is
 * loading, so a wedged subresource, a busy-looping main thread, or a very large
 * DOM (`innerText` forces layout) all reach us as "no answer yet".
 */
export const PATCHER_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS = 2_000;

/**
 * The read, or {@link PATCHER_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS} of waiting
 * for it — whichever comes first.
 *
 * Both reads need this and neither gets it for free. The unscoped one runs a
 * script in the page, and script execution is suspended while a page loads, so
 * a wedged subresource or a busy-looping main thread arrives as "no answer
 * yet". The scoped one asks the debugger which element a selector means, and a
 * CDP send has no deadline of its own either — four of them in a row, on a page
 * `DOM.getDocument` cannot get a word out of, is an IPC invoke held open until
 * something further out gives up. `wait --selector` polls that every 250ms.
 *
 * Whichever loses the race is dropped: a late answer must not resolve a call
 * already reported as timed out, the same discipline `startResizeSnapshot`
 * applies to a late capture. Nothing is cancelled, because neither an isolated
 * script nor a CDP command can be.
 *
 * `work` answers with an outcome rather than throwing — both callers turn their
 * failures into one — and if it throws anyway *after* the deadline has answered,
 * the rejection goes nowhere: `Promise.race` subscribed to it when the race
 * started, so it is a handled rejection with nothing left to report to, not an
 * unhandled one taking the main process down. Measured, not assumed: a spare
 * `.catch` here made no difference to a test that rejects a lost read.
 */
export function withPageReadDeadline<T>(
  work: Promise<T>,
  onTimeout: T,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race<T>([
    work,
    new Promise<T>((resolve) => {
      timer = setTimeout(
        () => resolve(onTimeout),
        PATCHER_DESKTOP_BROWSER_PAGE_READ_TIMEOUT_MS,
      );
    }),
  ]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Slicing inside the page keeps a document with megabytes of text from crossing
 * the process boundary just to be thrown away here. The script reports what it
 * cut, because after the slice the original length is gone.
 */
export const PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT = `(() => {
  const body = document.body;
  const rawText = body === null ? "" : String(body.innerText ?? "");
  const selection = window.getSelection();
  const rawSelection = selection === null ? "" : String(selection.toString());
  return {
    contentType: String(document.contentType ?? ""),
    text: rawText.slice(0, ${PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH}),
    textTruncated: rawText.length > ${PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH},
    selection: rawSelection.slice(0, ${PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH}),
    selectionTruncated: rawSelection.length > ${PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH},
  };
})()`;

/**
 * The same read, of one element — the body of `readPageIn`.
 *
 * A **function declaration**, not a script, and that is the whole point. The
 * unscoped read's request carries `tabId` and nothing else because any knob on
 * it would be a caller's value spliced into a privileged snippet running in an
 * untrusted page. Nothing is spliced here either: the selector is resolved by
 * `DOM.querySelector` over the debugger, the element arrives as a CDP object id,
 * and this constant is called *on* it. `this` and the first argument are both
 * the element, matching the shape `eval` already accepts.
 *
 * It slices in the page for the same reason the script does: a `<main>` holding
 * megabytes of text should not cross the process boundary to be cut here.
 */
export const PATCHER_DESKTOP_BROWSER_ELEMENT_READ_FUNCTION = `(function () {
  const raw = String(this.innerText ?? "");
  return {
    text: raw.slice(0, ${PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH}),
    textTruncated: raw.length > ${PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH},
  };
})`;

/** What {@link PATCHER_DESKTOP_BROWSER_ELEMENT_READ_FUNCTION} resolves to. */
export interface BrowserElementReadContent {
  text: string;
  textTruncated: boolean;
}

/**
 * Validate and re-truncate a scoped read, for the reasons
 * {@link parseBrowserPageReadContent} gives at length. Returns null for
 * anything malformed, which the caller reports as `unreadable`.
 */
export function parseBrowserElementReadContent(
  raw: unknown,
): BrowserElementReadContent | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const { text, textTruncated } = raw as Record<string, unknown>;
  if (typeof text !== "string" || typeof textTruncated !== "boolean") {
    return null;
  }
  return {
    text: truncate(text, PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH),
    textTruncated:
      textTruncated ||
      text.length > PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH,
  };
}

/** What {@link PATCHER_DESKTOP_BROWSER_PAGE_READ_SCRIPT} resolves to. */
export interface BrowserPageReadContent {
  /**
   * What Chromium decided this document is. The read asks because a PDF's text
   * is not in its DOM and has to be fetched and parsed instead (see
   * desktop-browser-pdf-text.ts) — and the content type is how the viewer's
   * empty wrapper is told apart from a page that really is blank.
   */
  contentType: string;
  text: string;
  textTruncated: boolean;
  selection: string;
  selectionTruncated: boolean;
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Validate and re-truncate the script's result before it reaches the wire.
 *
 * The script runs in an isolated world, so a page cannot rewrite it — but the
 * value still arrives from a process rendering attacker-supplied content, and
 * "it must be an object holding two strings and two booleans" is exactly the
 * kind of assumption that ages badly. Re-truncating here is what guarantees the
 * response validates even if the in-page slice ever stops agreeing with the
 * contract caps; a value that came back over-long is reported as truncated
 * whatever the script claimed.
 *
 * Returns null for anything malformed, which the caller reports as `unreadable`.
 */
export function parseBrowserPageReadContent(
  raw: unknown,
): BrowserPageReadContent | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const { contentType, text, textTruncated, selection, selectionTruncated } =
    raw as Record<string, unknown>;
  if (
    typeof text !== "string" ||
    typeof selection !== "string" ||
    typeof textTruncated !== "boolean" ||
    typeof selectionTruncated !== "boolean"
  ) {
    return null;
  }
  return {
    // Leniently, unlike the four above: the content type decides which of two
    // ways the text is read, and a page that somehow has none is a page read
    // the ordinary way — which is what every read did before it was asked for.
    contentType: typeof contentType === "string" ? contentType : "",
    text: truncate(text, PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH),
    textTruncated:
      textTruncated ||
      text.length > PATCHER_DESKTOP_BROWSER_MAX_PAGE_TEXT_LENGTH,
    selection: truncate(
      selection,
      PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH,
    ),
    selectionTruncated:
      selectionTruncated ||
      selection.length > PATCHER_DESKTOP_BROWSER_MAX_PAGE_SELECTION_LENGTH,
  };
}
