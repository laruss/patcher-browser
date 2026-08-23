import { PATCHER_DESKTOP_BROWSER_MAX_FAVICON_DATA_URL_LENGTH } from "@patcher/desktop-contract";

/**
 * Turning a page's declared favicon into something the trusted Patcher app may show.
 *
 * The rule this module exists to keep: **the app never touches the page's URL.**
 * The shell fetches the icon itself, inside the browsing session — so the request
 * carries that session's cookies and passes the session's own network firewall
 * (`shouldBlockBrowserRequest`, which already refuses LAN hosts outright and
 * loopback without frame attribution) — and hands the renderer a `data:` URI it
 * built. A page therefore cannot use its tab icon to make the Patcher origin issue a
 * request: no beacon, no credentialed loopback probe, no scheme of its choosing
 * in an `<img src>`.
 *
 * What still crosses the boundary is image bytes, decoded by the renderer's
 * Chromium the same way it decodes any `<img>`. That is the residual risk this
 * bounds rather than removes: an allowlisted raster media type, a hard byte cap,
 * and a media type taken from the allowlist instead of from the response.
 */

/**
 * Raster formats a favicon may arrive in. SVG is deliberately absent: it is a
 * document format with a parser surface far larger than a bitmap's, and the tab
 * strip gains nothing from vectors at 16px.
 */
const ALLOWED_FAVICON_MEDIA_TYPES: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
];

/**
 * Byte cap on a fetched icon. Comfortably above a normal favicon (a few KB) and
 * far below anything that would matter in renderer memory once every tab holds
 * one. Oversized icons are dropped rather than downscaled: the shell would have
 * to decode them to resize, and decoding untrusted bytes in the privileged
 * process is the one thing this path does not do.
 */
export const PATCHER_DESKTOP_BROWSER_MAX_FAVICON_BYTES = 131_072;

/** The subset of `Response` this module needs, so `session.fetch` fits as-is. */
export interface BrowserFaviconFetchResponse {
  ok: boolean;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type BrowserFaviconFetch = (
  url: string,
) => Promise<BrowserFaviconFetchResponse>;

export interface ResolveBrowserFaviconDataUrlArgs {
  /** Must perform the request in the browsing session, never the app's. */
  fetchFavicon: BrowserFaviconFetch;
  /** Candidate URLs exactly as the page declared them. */
  urls: readonly string[];
}

/**
 * The candidate to fetch, or null when the page declared nothing usable. Only
 * `http(s)` qualifies: a page can declare `data:`, `blob:`, `file:` or a custom
 * scheme, and none of those should reach a fetch or a renderer.
 */
export function selectBrowserFaviconUrl(
  urls: readonly string[],
): string | null {
  for (const candidate of urls) {
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return candidate;
    }
  }
  return null;
}

/**
 * The key an icon is remembered against: the page's origin, or null when the URL
 * is not one (`about:blank`, an empty tab). Origin rather than full URL because
 * that is the granularity a site's icon actually has — it keeps the icon across a
 * reload, a hash change and a `pushState`, all of which announce nothing new, and
 * still drops it the moment the tab lands on another site. A page that wants a
 * different icon announces one, and that replaces this.
 */
export function resolveBrowserFaviconPageKey(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The canonical media type for a `content-type` header, or null when it is
 * missing, malformed or not an allowlisted raster image. The returned value comes
 * from the allowlist, so nothing from the response is interpolated into the data
 * URI the renderer receives.
 */
export function resolveBrowserFaviconMediaType(
  contentType: string | null,
): string | null {
  if (contentType === null) {
    return null;
  }
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    ALLOWED_FAVICON_MEDIA_TYPES.find((allowed) => allowed === mediaType) ?? null
  );
}

/**
 * Fetch a page's declared favicon and return it as a `data:` URI, or null if
 * anything about it disqualifies it. Every failure is a null — a missing tab icon
 * is not worth surfacing to the user, and a page must not learn which of its
 * icons the shell rejected.
 */
export async function resolveBrowserFaviconDataUrl(
  args: ResolveBrowserFaviconDataUrlArgs,
): Promise<string | null> {
  const url = selectBrowserFaviconUrl(args.urls);
  if (url === null) {
    return null;
  }

  let response: BrowserFaviconFetchResponse;
  try {
    response = await args.fetchFavicon(url);
  } catch {
    return null;
  }
  if (!response.ok) {
    return null;
  }

  const mediaType = resolveBrowserFaviconMediaType(
    response.headers.get("content-type"),
  );
  if (mediaType === null) {
    return null;
  }

  let bytes: ArrayBuffer;
  try {
    bytes = await response.arrayBuffer();
  } catch {
    return null;
  }
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > PATCHER_DESKTOP_BROWSER_MAX_FAVICON_BYTES
  ) {
    return null;
  }

  const dataUrl = `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
  // The byte cap already bounds this; the check is the wire contract's own limit
  // restated where the value is built, so the two cannot drift apart silently.
  return dataUrl.length > PATCHER_DESKTOP_BROWSER_MAX_FAVICON_DATA_URL_LENGTH
    ? null
    : dataUrl;
}
