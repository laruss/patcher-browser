import { useCallback, useEffect, useMemo, useState } from "react";
import type { PatcherDesktopBrowserFindAction } from "@patcher/desktop-contract";
import { getDesktopBrowserApi } from "./patcher-desktop";

// Find in page, as the browser surface drives it.
//
// The find bar takes layout space rather than floating over the page, and that
// is forced rather than chosen: a `WebContentsView` composites above the DOM, so
// the only way to draw over a page is to freeze it to a bitmap (`setOverlay`) —
// and a find bar over a frozen page could never show what it just highlighted.
// So the bar sits in the chrome and the page shrinks under it, which is where
// Firefox puts its own.

/** What the shell counted for the query currently in the bar. */
export interface BrowserFindMatches {
  /** 1-based position of the highlighted match; 0 when there are none. */
  activeMatchOrdinal: number;
  matches: number;
}

export interface BrowserFindState {
  close: () => void;
  /**
   * Bumped on every open. The field takes focus from this rather than from
   * `isOpen`, so pressing the shortcut again while the bar is already open
   * still selects what is in it — which is what every browser does.
   */
  focusToken: number;
  isOpen: boolean;
  /** Null until the shell has counted anything for the current query. */
  matches: BrowserFindMatches | null;
  /** False when this shell has no find channel, so the shortcut falls through. */
  open: () => boolean;
  query: string;
  search: (query: string) => void;
  step: (direction: 1 | -1) => void;
}

export interface UseBrowserFindArgs {
  /** Null when the surface has no active tab; the bar cannot open without one. */
  tabId: string | null;
  /** The active tab's URL, watched only to drop a count the page has outlived. */
  url: string;
}

/**
 * What the counter reads. Pure, so every state is testable without a shell.
 *
 * Blank while nothing has been counted yet: a page that is still being scanned
 * has no honest number, and showing the previous query's would be worse than
 * showing none.
 */
export function describeBrowserFindMatches(
  matches: BrowserFindMatches | null,
): string {
  if (matches === null) return "";
  if (matches.matches === 0) return "No results";
  return `${matches.activeMatchOrdinal}/${matches.matches}`;
}

export function useBrowserFind({
  tabId,
  url,
}: UseBrowserFindArgs): BrowserFindState {
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  const [isOpen, setIsOpen] = useState(false);
  const [focusToken, setFocusToken] = useState(0);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<BrowserFindMatches | null>(null);

  const send = useCallback(
    (action: PatcherDesktopBrowserFindAction, text: string) => {
      if (tabId === null || desktopBrowser?.find === undefined) {
        return;
      }
      desktopBrowser.find({ tabId, action, query: text });
    },
    [desktopBrowser, tabId],
  );

  useEffect(() => {
    if (desktopBrowser?.onFindResult === undefined) {
      return;
    }
    return desktopBrowser.onFindResult((result) => {
      if (result.tabId !== tabId) {
        return;
      }
      setMatches({
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
      });
    });
  }, [desktopBrowser, tabId]);

  // A new page has not been searched, whatever the bar still says. The shell
  // stops pushing counts for the old document; this is the half the user sees.
  useEffect(() => {
    setMatches(null);
  }, [url]);

  // The bar belongs to the tab it was opened over, so switching tabs — or
  // leaving the surface — closes it and ends that tab's session.
  useEffect(() => {
    return () => {
      send("stop", "");
      setIsOpen(false);
      setMatches(null);
    };
  }, [send]);

  const search = useCallback(
    (next: string) => {
      setQuery(next);
      setMatches(null);
      send("start", next);
    },
    [send],
  );

  const open = useCallback((): boolean => {
    if (tabId === null || desktopBrowser?.find === undefined) {
      return false;
    }
    setIsOpen(true);
    setFocusToken((current) => current + 1);
    // Reopening with the last query searches for it again, so the counter is
    // right before the user has typed anything.
    if (query.length > 0) {
      setMatches(null);
      send("start", query);
    }
    return true;
  }, [desktopBrowser, query, send, tabId]);

  const close = useCallback(() => {
    setIsOpen(false);
    setMatches(null);
    send("stop", "");
  }, [send]);

  const step = useCallback(
    (direction: 1 | -1) => {
      if (query.length === 0) {
        return;
      }
      send(direction === 1 ? "next" : "previous", query);
    },
    [query, send],
  );

  return { close, focusToken, isOpen, matches, open, query, search, step };
}
