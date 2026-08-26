import { PATCHER_APP_KEY_HEADER } from "@patcher/config/app-key";
import { appKey } from "./app-key";

/**
 * Sign this page's `/api/v1` requests, wherever in the app they are made.
 *
 * One interceptor rather than a header at every call site, and that is a
 * deliberate trade. The app reaches its own API three ways — the typed client
 * in `api-server.ts`, `appSurfaceRequestInit` in `api.ts`, and about twenty
 * bare `fetch("/api/v1/...")` calls under `hooks/queries` and `lib` — and a
 * credential that has to be remembered at each of them is a credential that
 * will be forgotten at the next one. The gate this feeds refuses the request
 * rather than quietly widening it, so forgetting means a broken feature, but
 * it means a broken feature *found late*.
 *
 * What it deliberately does not do is touch anything else: not another origin,
 * not `/health`, not a plugin's own `/api/v1/plugins/<id>/http` route, which is
 * reachable without a key on purpose. The key goes to Patcher's own API on
 * this page's own origin and nowhere else.
 *
 * The URLs the browser fetches for itself — `<img src>`, downloads, the
 * websocket — never reach `fetch`, and carry the key in the query instead. See
 * `withAppKeyQuery`.
 */

/**
 * The two route families the server serves without a key, and that this must
 * therefore not sign: a plugin's own `http` routes and its frontend assets.
 * Signing them would hand the app's credential to plugin-authored code — the
 * `http` dispatcher passes the whole request, headers included, to the plugin's
 * handler. Mirrors `PLUGIN_UNKEYED_ROUTE_PATTERN` in the server.
 */
const PLUGIN_UNKEYED_ROUTE_PATTERN =
  /^\/api\/v1\/plugins\/[^/]+\/(http|assets)(\/|$)/u;

function isPatcherApiUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    // Against `href`, not `origin`: a path-relative URL resolves against the
    // current document, and classifying it against the origin would judge a
    // different path than the one that is actually fetched.
    url = new URL(rawUrl, window.location.href);
  } catch {
    return false;
  }
  if (url.origin !== window.location.origin) return false;
  if (url.pathname !== "/api/v1" && !url.pathname.startsWith("/api/v1/")) {
    return false;
  }
  return !PLUGIN_UNKEYED_ROUTE_PATTERN.test(url.pathname);
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function installAppKeyFetch(): void {
  if (typeof window === "undefined") return;
  // Resolved now rather than on the first request: reading it is what strips
  // `?appKey=` out of the address bar, and that has to happen before the
  // router reads `location`.
  const key = appKey();
  const inner = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (key === undefined || !isPatcherApiUrl(requestUrl(input))) {
      return inner(input, init);
    }
    // Seeded from the `Request`'s own headers when `init` names none, because
    // an `init.headers` replaces a `Request`'s header list rather than merging
    // into it — building it from `init` alone would drop the caller's.
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    // A caller that set the header itself meant it — the same rule the plugin
    // and thread-id wrappers follow.
    if (headers.has(PATCHER_APP_KEY_HEADER)) return inner(input, init);
    headers.set(PATCHER_APP_KEY_HEADER, key);
    return inner(input, { ...init, headers });
  };
}
