import { useCallback, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BrowserHistoryEntry } from "@patcher/server-contract";
import { sdk } from "@/lib/sdk";
import { browserHistoryQueryKey } from "@/hooks/queries/query-keys";
import { invalidateBrowserHistory } from "@/hooks/cache-owners/browser-history-cache-owner";
import { FOCUS_OWNED_LIVE_QUERY_POLICY } from "@/hooks/queries/query-policies";
import { OMNIBOX_HISTORY_SEARCH_LIMIT } from "@/lib/omnibox/providers/history";

// The browser's history, per scope — a thread's id, or the browser surface's
// own. It lives on the server (`/browser-history`); this is the binding the
// browsing surface uses to write to it and to show its recents.
//
// It used to be 24 rows of localStorage, which made it a recents list and
// nothing else: the omnibox ranked against those 24 rows, plugins could not
// see them at all, and a second window had its own copy.

export type { BrowserHistoryEntry };

/**
 * How many rows the new-tab screen's "Recently visited" section reads. The
 * store behind it is far larger; this is what fits on the screen.
 */
export const BROWSER_HISTORY_RECENTS_LIMIT = 24;

interface RecordBrowserVisitArgs {
  url: string;
  title: string | null;
}

export interface BrowserHistoryController {
  entries: readonly BrowserHistoryEntry[];
  recordVisit: (args: RecordBrowserVisitArgs) => void;
  clear: () => void;
}

const EMPTY_BROWSER_HISTORY: readonly BrowserHistoryEntry[] = [];

function hasScopeId(scopeId: string | null | undefined): scopeId is string {
  return scopeId !== null && scopeId !== undefined && scopeId.trim().length > 0;
}

export function useBrowserHistory(
  scopeId: string | null | undefined,
): BrowserHistoryController {
  const queryClient = useQueryClient();
  const enabled = hasScopeId(scopeId);
  const scope = enabled ? scopeId : "";

  const { data } = useQuery({
    queryKey: browserHistoryQueryKey(scope),
    queryFn: ({ signal }) =>
      sdk.browserHistory.list({
        limit: BROWSER_HISTORY_RECENTS_LIMIT,
        scopeId: scope,
        signal,
      }),
    enabled,
    ...FOCUS_OWNED_LIVE_QUERY_POLICY,
  });

  const invalidate = useCallback(() => {
    void invalidateBrowserHistory({ queryClient, scopeId: scope });
  }, [queryClient, scope]);

  const recordMutation = useMutation({
    // Silent on failure, unlike the clear below: this fires on every page load,
    // and a server that is briefly unreachable would otherwise put a toast on
    // the screen for each one. A missing history row is not worth interrupting
    // browsing for.
    meta: { showErrorToast: false },
    mutationFn: (visit: RecordBrowserVisitArgs) =>
      sdk.browserHistory.record({ ...visit, scopeId: scope }),
    onSuccess: invalidate,
  });
  const clearMutation = useMutation({
    meta: { errorMessage: "Failed to clear history." },
    mutationFn: () => sdk.browserHistory.clear({ scopeId: scope }),
    onSuccess: invalidate,
  });

  // A browsed tab reports its state whenever anything about it changes, so the
  // same finished page arrives many times. In localStorage that cost a rewrite
  // nobody noticed; against the server it would be a request per report, each
  // one running every plugin's history filters.
  const lastRecorded = useRef<string | null>(null);
  const recordVisit = useCallback(
    (visit: RecordBrowserVisitArgs) => {
      if (!enabled || visit.url.length === 0) {
        return;
      }
      const identity = `${visit.url}\n${visit.title ?? ""}`;
      if (lastRecorded.current === identity) {
        return;
      }
      lastRecorded.current = identity;
      recordMutation.mutate(visit);
    },
    [enabled, recordMutation],
  );

  const clear = useCallback(() => {
    if (!enabled) {
      return;
    }
    lastRecorded.current = null;
    clearMutation.mutate();
  }, [clearMutation, enabled]);

  return { entries: data ?? EMPTY_BROWSER_HISTORY, recordVisit, clear };
}

/**
 * Search the whole store, across every scope — what the omnibox ranks against.
 *
 * Not a react-query hook: the omnibox owns its own run lifecycle (debounce,
 * abort on a newer keystroke) and hands the provider a signal to forward, so a
 * cache between the two would fight it for who cancels what.
 */
export function useBrowserHistorySearch(): (args: {
  query: string;
  signal: AbortSignal;
}) => Promise<readonly BrowserHistoryEntry[]> {
  return useCallback(
    ({ query, signal }) =>
      sdk.browserHistory.list({
        limit: OMNIBOX_HISTORY_SEARCH_LIMIT,
        query,
        signal,
      }),
    [],
  );
}
