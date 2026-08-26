import { PATCHER_APP_KEY_QUERY_PARAM } from "@patcher/config/app-key";

/**
 * What this page presents to `/api/v1` and `/ws`.
 *
 * The API refuses a request that identifies itself as nothing, because a
 * plugin process holds the loopback URL and "anonymous" was how it skipped the
 * permission map. So the app says who it is too.
 *
 * Two sources:
 *
 * 1. **`?appKey=` in this page's own URL.** The desktop shell puts it there
 *    when it navigates to the app; a plain browser — `patcher-app start`, or a
 *    server published over Tailscale — is opened with it once by hand. Stashed
 *    in `sessionStorage` and stripped from the address bar immediately, so it
 *    survives navigation without living in history or in a shared link.
 * 2. **`sessionStorage`**, which is (1) on every page after the first.
 *
 * Not a launch argument, though the shell could: a process's command line is
 * readable by anything running as the same user, which is the reason
 * `plugin-child-runtime.ts` refuses argv for the plugin API keys.
 *
 * And deliberately not a third: the server does not hand the key to an
 * unidentified caller, because a plugin is an unidentified caller.
 */

const SESSION_STORAGE_KEY = "patcher.appKey";

function readFromUrl(): string | undefined {
  const url = new URL(window.location.href);
  const key = url.searchParams.get(PATCHER_APP_KEY_QUERY_PARAM);
  if (key === null || key.length === 0) return undefined;
  url.searchParams.delete(PATCHER_APP_KEY_QUERY_PARAM);
  try {
    // Replace rather than push: the key should not be one Back away, and a
    // reload of this entry should not put it back in the address bar.
    window.history.replaceState(
      null,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  } catch {
    // An opaque origin throws here, and this runs at module scope before
    // anything renders. Failing to tidy the address bar is not a reason to
    // give the user a blank page instead of a working one.
  }
  return key;
}

function readFromSession(): string | undefined {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) ?? undefined;
  } catch {
    // Private browsing and blocked site data both throw here. The page still
    // works if the shell supplied a key, and says 401 clearly if not.
    return undefined;
  }
}

function rememberInSession(key: string): void {
  try {
    sessionStorage.setItem(SESSION_STORAGE_KEY, key);
  } catch {
    // Same as above: worth trying, never worth failing over.
  }
}

/**
 * Resolved once. Every source is fixed for the life of the page — the shell's
 * argument, the URL as it loaded, the session store — so re-reading would only
 * repeat the URL-stripping side effect.
 */
let resolved: string | undefined | null = null;

export function appKey(): string | undefined {
  if (resolved !== null) return resolved;
  resolved = resolveAppKey();
  return resolved;
}

function resolveAppKey(): string | undefined {
  // Same guard `api-server.ts` carries: this module
  // is reachable from tests and any non-browser evaluation of the bundle,
  // where there is no URL to read and no shell to ask.
  if (typeof window === "undefined") return undefined;
  const fromUrl = readFromUrl();
  if (fromUrl !== undefined) {
    rememberInSession(fromUrl);
    return fromUrl;
  }
  return readFromSession();
}

/**
 * The key in the query string, for the URLs the browser fetches itself.
 *
 * `<img src>`, a download link and a `WebSocket` upgrade set no headers, and
 * the app uses all three against `/api/v1`. Same shape as the per-plugin
 * `.http-token`, which takes `?token=` for the same reason.
 */
export function withAppKeyQuery(url: string): string {
  const key = appKey();
  if (key === undefined || typeof window === "undefined") return url;
  // Absolute or relative, and the answer keeps whichever shape came in: the
  // websocket URL is absolute (and `ws:`, so testing for `http` would get it
  // wrong), while the file-content URLs are paths. Tested by scheme rather
  // than by letting `new URL` throw — the relative case is the common one, and
  // it runs per attachment and per markdown image in a render pass.
  const wasAbsolute = HAS_SCHEME_PATTERN.test(url);
  const absolute = new URL(url, window.location.origin);
  absolute.searchParams.set(PATCHER_APP_KEY_QUERY_PARAM, key);
  return wasAbsolute
    ? absolute.href
    : `${absolute.pathname}${absolute.search}${absolute.hash}`;
}

/** A URL that names its own scheme, per RFC 3986's `scheme` production. */
const HAS_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;
