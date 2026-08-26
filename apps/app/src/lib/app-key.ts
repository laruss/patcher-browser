import {
  PATCHER_APP_KEY_HEADER,
  PATCHER_APP_KEY_QUERY_PARAM,
} from "@patcher/config/app-key";
import { getPatcherDesktopInfo } from "./patcher-desktop";

/**
 * What this page presents to `/api/v1` and `/ws`.
 *
 * The API refuses a request that identifies itself as nothing, because a
 * plugin process holds the loopback URL and "anonymous" was how it skipped the
 * permission map. So the app says who it is too.
 *
 * Three sources, in the order they are trustworthy:
 *
 * 1. **The desktop shell**, over the preload bridge. It reads the key file and
 *    hands it to the renderer as a launch argument, which is the only channel
 *    that has already arrived when the first module runs.
 * 2. **`?appKey=` in this page's own URL**, for a browser with no shell — a
 *    plain `patcher-app start`, or a server published over Tailscale. Stashed
 *    in `sessionStorage` and stripped from the address bar immediately, so it
 *    survives navigation without living in history or in a shared link.
 * 3. **`sessionStorage`**, which is (2) on every page after the first.
 *
 * There is deliberately no fourth: the server does not hand the key to an
 * unidentified caller, because a plugin is an unidentified caller.
 */

const SESSION_STORAGE_KEY = "patcher.appKey";

function readFromUrl(): string | undefined {
  const url = new URL(window.location.href);
  const key = url.searchParams.get(PATCHER_APP_KEY_QUERY_PARAM);
  if (key === null || key.length === 0) return undefined;
  url.searchParams.delete(PATCHER_APP_KEY_QUERY_PARAM);
  // Replace rather than push: the key should not be one Back away, and a
  // reload of this entry should not put it back in the address bar.
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
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
  // Same guard `api-server.ts` and `getPatcherDesktopInfo` carry: this module
  // is reachable from tests and any non-browser evaluation of the bundle,
  // where there is no URL to read and no shell to ask.
  if (typeof window === "undefined") {
    resolved = undefined;
    return resolved;
  }
  const fromShell = getPatcherDesktopInfo()?.appKey;
  if (fromShell !== undefined && fromShell.length > 0) {
    resolved = fromShell;
    return resolved;
  }
  const fromUrl = readFromUrl();
  if (fromUrl !== undefined) {
    rememberInSession(fromUrl);
    resolved = fromUrl;
    return resolved;
  }
  resolved = readFromSession();
  return resolved;
}

/** The header, for anything that can set one. */
export function appKeyHeaders(): Record<string, string> {
  const key = appKey();
  return key === undefined ? {} : { [PATCHER_APP_KEY_HEADER]: key };
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
  // wrong), while the file-content URLs are paths.
  let absolute: URL;
  let wasAbsolute = true;
  try {
    absolute = new URL(url);
  } catch {
    absolute = new URL(url, window.location.origin);
    wasAbsolute = false;
  }
  absolute.searchParams.set(PATCHER_APP_KEY_QUERY_PARAM, key);
  return wasAbsolute
    ? absolute.href
    : `${absolute.pathname}${absolute.search}${absolute.hash}`;
}
