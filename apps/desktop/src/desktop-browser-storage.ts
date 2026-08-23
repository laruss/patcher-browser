import {
  PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_COOKIE_VALUE_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_STORAGE_ITEMS,
  PATCHER_DESKTOP_BROWSER_MAX_STORAGE_TOTAL_LENGTH,
  PATCHER_DESKTOP_BROWSER_MAX_STORAGE_VALUE_LENGTH,
  type PatcherDesktopBrowserCookie,
  type PatcherDesktopBrowserStorageItem,
  type PatcherDesktopBrowserStorageOperation,
} from "@patcher/desktop-contract";

/**
 * Reading and writing what a tab has stored, for the agent browser tools.
 *
 * Two mechanisms, neither of them the browser debugger:
 *
 * - **Cookies** are `session.cookies`, which is why `httpOnly` ones are here at
 *   all — `document.cookie` cannot see them, and they are the ones that hold a
 *   login.
 * - **`localStorage` / `sessionStorage`** are a script in the page-read isolated
 *   world. CDP's `DOMStorage` domain was the planned route and would have taken
 *   structured parameters instead of a built string; it also attaches the
 *   debugger, which moves that tab's dialogs off Chromium's native path for a
 *   user who only asked what a site had stored. Storage is an observation, and
 *   Stage C's rule holds.
 *
 * The mapping lives here rather than in the view manager for the reason the
 * favicon and page-read policies do: it is the part carrying the security
 * limits and the format contract, and it is worth testing with no Electron
 * window around it.
 */

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * The shape `session.cookies.get` resolves with, as much of it as we read.
 *
 * Declared structurally rather than imported from Electron so this module stays
 * testable as a plain function, exactly as the console and network normalizers
 * are.
 */
export interface BrowserSessionCookie {
  name?: string;
  value?: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: string;
}

/** What `session.cookies.set` takes. */
export interface BrowserSessionCookieDetails {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  expirationDate?: number;
  sameSite: "unspecified" | "no_restriction" | "lax" | "strict";
}

/**
 * Chromium's `unspecified` — the cookie never declared a policy — is reported
 * as `Lax`, because that is the policy the browser then applies to it. Saying
 * "unspecified" in a file meant to be reloaded would lose that.
 */
function toCookieSameSite(sameSite: string | undefined): "Strict" | "Lax" | "None" {
  switch (sameSite) {
    case "strict":
      return "Strict";
    case "no_restriction":
      return "None";
    default:
      return "Lax";
  }
}

const SAME_SITE_TO_SESSION: Record<
  PatcherDesktopBrowserCookie["sameSite"],
  BrowserSessionCookieDetails["sameSite"]
> = {
  Strict: "strict",
  Lax: "lax",
  None: "no_restriction",
};

/** Electron's cookie, in the shape a `storageState` file uses. */
export function toBrowserCookie(
  cookie: BrowserSessionCookie,
): PatcherDesktopBrowserCookie {
  // A cookie with no expiry is a session cookie, and Playwright spells that
  // -1 rather than by omitting the field.
  const expires =
    cookie.session === true ||
    typeof cookie.expirationDate !== "number" ||
    !Number.isFinite(cookie.expirationDate)
      ? -1
      : cookie.expirationDate;
  return {
    name: truncate(
      String(cookie.name ?? ""),
      PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH,
    ),
    value: truncate(
      String(cookie.value ?? ""),
      PATCHER_DESKTOP_BROWSER_MAX_COOKIE_VALUE_LENGTH,
    ),
    domain: truncate(
      String(cookie.domain ?? ""),
      PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH,
    ),
    path: truncate(
      String(cookie.path ?? "/"),
      PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH,
    ),
    expires,
    httpOnly: cookie.httpOnly === true,
    secure: cookie.secure === true,
    sameSite: toCookieSameSite(cookie.sameSite),
  };
}

/**
 * The reverse, for writing a saved cookie back.
 *
 * `url` is required by Electron and absent from a `storageState` file, so it is
 * rebuilt from the cookie's own domain — with the scheme its `secure` flag
 * implies, since Chromium refuses a secure cookie offered over http. A cookie
 * that names no domain (`cookie-set foo bar` from the CLI) belongs to the tab,
 * and `fallbackUrl` is that tab's URL.
 */
export function toBrowserSessionCookieDetails(
  cookie: PatcherDesktopBrowserCookie,
  fallbackUrl: string,
): BrowserSessionCookieDetails {
  const host = cookie.domain.replace(/^\./u, "");
  const path = cookie.path.startsWith("/") ? cookie.path : "/";
  return {
    url:
      host.length === 0
        ? fallbackUrl
        : `${cookie.secure ? "https" : "http"}://${host}${path}`,
    name: cookie.name,
    value: cookie.value,
    // Only a leading dot means "and every subdomain". Passing `domain` for a
    // host-only cookie would widen it, because Electron normalizes whatever it
    // is given with a preceding dot.
    ...(cookie.domain.startsWith(".") ? { domain: cookie.domain } : {}),
    path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    ...(cookie.expires >= 0 ? { expirationDate: cookie.expires } : {}),
    sameSite: SAME_SITE_TO_SESSION[cookie.sameSite],
  };
}

type BrowserStorageScriptOperation = Extract<
  PatcherDesktopBrowserStorageOperation,
  { kind: "items-get" | "items-set" | "items-clear" }
>;

/**
 * The web-storage script, with its operation baked in.
 *
 * Unlike the page read this one cannot be a constant: a key and a value have to
 * reach the page. They are carried as one `JSON.stringify`d literal rather than
 * spliced into expressions, which is what keeps a key named `"); drop()` a
 * string instead of a statement — JSON's output is a JavaScript expression for
 * plain data, and the one historical hole in that (U+2028/U+2029 ending a
 * string literal) was closed by ES2019, long before this engine.
 *
 * The caps are applied **inside the page**, so an origin holding megabytes does
 * not put megabytes on the wire to have them dropped here. The script reports
 * what it cut, because after the cut the original size is gone.
 */
export function buildBrowserStorageScript(
  operation: BrowserStorageScriptOperation,
): string {
  return `(() => {
  const op = ${JSON.stringify(operation)};
  let store;
  try {
    store = op.area === "local" ? window.localStorage : window.sessionStorage;
    // Touch it: an origin that blocks storage throws on access, not on lookup.
    store.length;
  } catch (error) {
    return { error: "This page's storage is not accessible." };
  }
  try {
    if (op.kind === "items-get") {
      const items = [];
      let total = 0;
      let truncated = false;
      for (let index = 0; index < store.length; index += 1) {
        if (items.length >= ${PATCHER_DESKTOP_BROWSER_MAX_STORAGE_ITEMS}) {
          truncated = true;
          break;
        }
        const name = String(store.key(index) ?? "");
        const raw = String(store.getItem(name) ?? "");
        const value = raw.slice(0, ${PATCHER_DESKTOP_BROWSER_MAX_STORAGE_VALUE_LENGTH});
        if (value.length < raw.length) {
          truncated = true;
        }
        if (total + name.length + value.length > ${PATCHER_DESKTOP_BROWSER_MAX_STORAGE_TOTAL_LENGTH}) {
          truncated = true;
          break;
        }
        total += name.length + value.length;
        items.push({ name: name, value: value });
      }
      return { items: items, truncated: truncated };
    }
    if (op.kind === "items-set") {
      let applied = 0;
      let rejected = 0;
      for (const item of op.items) {
        try {
          store.setItem(item.name, item.value);
          applied += 1;
        } catch (error) {
          rejected += 1;
        }
      }
      return { applied: applied, rejected: rejected };
    }
    if (op.name === null) {
      const removed = store.length;
      store.clear();
      return { removed: removed };
    }
    if (store.getItem(op.name) === null) {
      return { removed: 0 };
    }
    store.removeItem(op.name);
    return { removed: 1 };
  } catch (error) {
    return { error: "That storage operation was refused by the page." };
  }
})()`;
}

/** The message a page's own refusal came back with, if that is what happened. */
export function readBrowserStorageScriptError(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const error = (raw as { error?: unknown }).error;
  return typeof error === "string" && error.length > 0 ? error : null;
}

/**
 * Null when the script answered with something unusable, which is a bug here
 * rather than something the page did — an isolated world means the page cannot
 * reach into the result.
 */
export function parseBrowserStorageItems(
  raw: unknown,
): { items: PatcherDesktopBrowserStorageItem[]; truncated: boolean } | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as { items?: unknown; truncated?: unknown };
  if (!Array.isArray(record.items)) {
    return null;
  }
  const items: PatcherDesktopBrowserStorageItem[] = [];
  for (const entry of record.items.slice(0, PATCHER_DESKTOP_BROWSER_MAX_STORAGE_ITEMS)) {
    if (typeof entry !== "object" || entry === null) {
      return null;
    }
    const item = entry as { name?: unknown; value?: unknown };
    items.push({
      name: truncate(
        String(item.name ?? ""),
        PATCHER_DESKTOP_BROWSER_MAX_COOKIE_NAME_LENGTH,
      ),
      value: truncate(
        String(item.value ?? ""),
        PATCHER_DESKTOP_BROWSER_MAX_STORAGE_VALUE_LENGTH,
      ),
    });
  }
  return {
    items,
    truncated:
      record.truncated === true || record.items.length > items.length,
  };
}

/** The counts a write or a clear answered with; missing ones read as zero. */
export function parseBrowserStorageCounts(
  raw: unknown,
): { applied: number; rejected: number; removed: number } | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as {
    applied?: unknown;
    rejected?: unknown;
    removed?: unknown;
  };
  const count = (value: unknown): number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0
      ? value
      : 0;
  return {
    applied: count(record.applied),
    rejected: count(record.rejected),
    removed: count(record.removed),
  };
}
