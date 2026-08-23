import { PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION } from "@patcher/desktop-contract";

/**
 * Capturing the whole document rather than the visible viewport.
 *
 * Electron's `capturePage` composites the view, and a view is a viewport, so a
 * full-page picture has to come from `Page.captureScreenshot` — which is CDP,
 * which is the browser debugger. That is the whole reason this is opt-in per
 * call instead of being how screenshots work.
 *
 * The region to capture is measured by a script in the page-read isolated world
 * rather than by CDP's `Page.getLayoutMetrics`, which would be the obvious
 * choice. Two reasons: `getLayoutMetrics` is documented to want the `Page`
 * domain, and enabling that domain is exactly what moves a tab's dialogs off
 * Chromium's native modal for a user who only asked for a picture. The script
 * path is already proven here — it is the one page reads and web storage use —
 * and it answers in the CSS pixels the capture clip is expressed in.
 *
 * The policy sits in its own module for the reason the page-read rules do: it
 * carries the limits, and limits are worth testing without an Electron window.
 */

/**
 * Measure the scrollable document.
 *
 * The maximum of the two elements' four measures, because no single one of them
 * is right everywhere: a standards-mode page grows `documentElement`, a
 * quirks-mode one grows `body`, and a page whose content is absolutely
 * positioned out of flow reports a `scrollHeight` smaller than its
 * `offsetHeight`. Taking the largest is what Puppeteer settled on for the same
 * reason, and being too large only costs blank pixels at the bottom, while
 * being too small silently cuts the page off.
 *
 * A fixed constant with nothing interpolated into it, like every other script
 * this shell injects: the caller supplies no part of it, so a page has nothing
 * to inject into.
 */
export const PATCHER_DESKTOP_BROWSER_CONTENT_SIZE_SCRIPT = `(() => {
  const doc = document.documentElement;
  const body = document.body;
  const measure = (name) =>
    Math.max(
      doc === null ? 0 : Number(doc[name] ?? 0),
      body === null ? 0 : Number(body[name] ?? 0),
    );
  return {
    width: Math.max(measure("scrollWidth"), measure("offsetWidth"), measure("clientWidth")),
    height: Math.max(measure("scrollHeight"), measure("offsetHeight"), measure("clientHeight")),
  };
})()`;

/** The document's size in CSS pixels, and whether it fits a single capture. */
export interface BrowserCaptureRegion {
  width: number;
  height: number;
  /** The document was larger than one capture can be; this is its top-left. */
  truncated: boolean;
}

/**
 * Turn what the script measured into a region to capture, or null if it makes
 * no sense.
 *
 * The value arrives from a process rendering attacker-supplied content, so the
 * clamp is a guarantee rather than a courtesy: a page reporting a height of ten
 * million must cost a bounded capture, and one reporting `NaN` must cost
 * nothing at all. A zero in either dimension is a page with no layout yet — a
 * capture of it would be a blank image reported as a success.
 */
export function parseBrowserCaptureRegion(
  raw: unknown,
): BrowserCaptureRegion | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const { width, height } = raw as Record<string, unknown>;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1
  ) {
    return null;
  }
  const flooredWidth = Math.floor(width);
  const flooredHeight = Math.floor(height);
  return {
    width: Math.min(
      flooredWidth,
      PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION,
    ),
    height: Math.min(
      flooredHeight,
      PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION,
    ),
    truncated:
      flooredWidth > PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION ||
      flooredHeight > PATCHER_DESKTOP_BROWSER_MAX_FULL_PAGE_DIMENSION,
  };
}
