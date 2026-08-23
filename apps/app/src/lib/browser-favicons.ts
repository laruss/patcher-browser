import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import { PATCHER_DESKTOP_BROWSER_MAX_FAVICON_DATA_URL_LENGTH } from "@patcher/desktop-contract";
import { createSessionStorageSyncStorage } from "./browser-storage";

/**
 * Page icons for the browser surface's tabs, by tab id.
 *
 * They are **not** kept with the tabs. The tab list is localStorage and lives
 * across restarts; icons are bytes a page supplied, and spending a 5MB budget
 * the tab list depends on to carry them is the trade this deliberately refuses.
 * So they were session state — held in React, gone when the app went away.
 *
 * React state turned out to be a narrower promise than "the session": reloading
 * the renderer (Cmd+R) throws it away while the shell, its tabs and its native
 * views all survive, and nothing re-announces an icon for a page that is already
 * loaded. Every tab lost its mark until it was navigated again. `sessionStorage`
 * is the same lifetime the decision above wanted, honestly spelled: it survives
 * the reload, dies with the window, and is a separate budget from the tab list's.
 */
const BROWSER_FAVICONS_STORAGE_KEY = "patcher.browserSurface.favicons-1";

export type BrowserFaviconsState = Readonly<Record<string, string>>;

export const EMPTY_BROWSER_FAVICONS: BrowserFaviconsState = {};

// Validated on the way in as well as on the way out: what is stored here came
// from a page originally, and the wire cap the shell enforces is the same cap
// that should survive a round trip through storage.
const browserFaviconsSchema = z.record(
  z.string().min(1),
  z
    .string()
    .min(1)
    .max(PATCHER_DESKTOP_BROWSER_MAX_FAVICON_DATA_URL_LENGTH)
    .startsWith("data:"),
);

export function getBrowserFaviconsStorageKey(): string {
  return BROWSER_FAVICONS_STORAGE_KEY;
}

export function parseBrowserFavicons(
  storedValue: string | null,
  initialValue: BrowserFaviconsState,
): BrowserFaviconsState {
  if (storedValue === null) {
    return initialValue;
  }
  try {
    const parsed = browserFaviconsSchema.safeParse(JSON.parse(storedValue));
    return parsed.success ? parsed.data : initialValue;
  } catch {
    return initialValue;
  }
}

export function setBrowserFavicon(
  favicons: BrowserFaviconsState,
  { dataUrl, tabId }: { dataUrl: string | null; tabId: string },
): BrowserFaviconsState {
  if (dataUrl === null) {
    if (favicons[tabId] === undefined) {
      return favicons;
    }
    const { [tabId]: _removed, ...rest } = favicons;
    return rest;
  }
  return favicons[tabId] === dataUrl
    ? favicons
    : { ...favicons, [tabId]: dataUrl };
}

/**
 * Exported so a test can exercise the round trip a reload actually makes.
 * `getOnInit` reads through this once, when the module is evaluated — which on
 * a reloaded renderer is exactly the moment the icons have to come back.
 */
export const browserFaviconsStorage =
  createSessionStorageSyncStorage<BrowserFaviconsState>({
    parse: parseBrowserFavicons,
    serialize: (value) => JSON.stringify(value),
  });

export const browserFaviconsAtom = atomWithStorage<BrowserFaviconsState>(
  BROWSER_FAVICONS_STORAGE_KEY,
  EMPTY_BROWSER_FAVICONS,
  browserFaviconsStorage,
  { getOnInit: true },
);
