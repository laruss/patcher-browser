import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import { createSessionStorageSyncStorage } from "./browser-storage";

/**
 * Which of the browser surface's tabs are muted, by tab id.
 *
 * Session state deliberately, and in `sessionStorage` for the reason the page
 * icons are (see `browser-favicons.ts`): a mute is applied to a live
 * `webContents` and holds only while that page exists. The window's native views
 * survive a renderer reload (Cmd+R) and die with the window, so the record of
 * what is muted has to do exactly that too — kept in React it would be lost on
 * reload and the strip would stop marking a page that is still silent.
 *
 * The consequence worth stating: a restart brings every restored tab back
 * audible. Chromium remembers mute per site; Patcher does not, because a mute stored
 * against a page that has not loaded yet is a promise about a `webContents` that
 * does not exist.
 */
const BROWSER_MUTED_TABS_STORAGE_KEY = "patcher.browserSurface.mutedTabs-1";

export const EMPTY_BROWSER_MUTED_TABS: ReadonlySet<string> = new Set();

/** Exported so a test can clear what a previous one left in session storage. */
export function getBrowserMutedTabsStorageKey(): string {
  return BROWSER_MUTED_TABS_STORAGE_KEY;
}

const browserMutedTabsSchema = z.array(z.string().min(1));

export function parseBrowserMutedTabs(
  storedValue: string | null,
  initialValue: ReadonlySet<string>,
): ReadonlySet<string> {
  if (storedValue === null) {
    return initialValue;
  }
  try {
    const parsed = browserMutedTabsSchema.safeParse(JSON.parse(storedValue));
    return parsed.success ? new Set(parsed.data) : initialValue;
  } catch {
    return initialValue;
  }
}

/**
 * Also how a closing tab's entry is dropped — muting nothing and forgetting a
 * mute are the same set, and a tab id that outlived its tab would otherwise sit
 * in storage for the life of the window.
 */
export function withBrowserTabMuted(
  mutedTabIds: ReadonlySet<string>,
  { muted, tabId }: { muted: boolean; tabId: string },
): ReadonlySet<string> {
  if (mutedTabIds.has(tabId) === muted) {
    return mutedTabIds;
  }
  const next = new Set(mutedTabIds);
  if (muted) {
    next.add(tabId);
  } else {
    next.delete(tabId);
  }
  return next;
}

export const browserMutedTabsStorage = createSessionStorageSyncStorage<
  ReadonlySet<string>
>({
  parse: parseBrowserMutedTabs,
  serialize: (value) => JSON.stringify([...value]),
});

export const browserMutedTabsAtom = atomWithStorage<ReadonlySet<string>>(
  BROWSER_MUTED_TABS_STORAGE_KEY,
  EMPTY_BROWSER_MUTED_TABS,
  browserMutedTabsStorage,
  { getOnInit: true },
);
