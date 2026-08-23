import type { BrowserHistoryEntry } from "@patcher/server-contract";
import { getBrowserUrlHost } from "@/lib/browser-url";
import { omniboxUrlMatchCandidates, scoreOmniboxTextMatch } from "../match";
import type { OmniboxProvider, OmniboxProviderSuggestion } from "../types";

export const OMNIBOX_HISTORY_PROVIDER_ID = "history";

/** Ceiling for a history row: below an open tab holding the same page. */
const OMNIBOX_HISTORY_SCORE_WEIGHT = 0.85;

/**
 * How many candidates one keystroke asks the store for. The store holds
 * thousands; this is how many are worth scoring for a list that shows a
 * handful, and the server returns them newest first, so the cut is by recency.
 */
export const OMNIBOX_HISTORY_SEARCH_LIMIT = 50;

export interface OmniboxHistorySearchArgs {
  query: string;
  signal: AbortSignal;
}

export interface CreateOmniboxHistoryProviderArgs {
  /**
   * Reads the history store, most-recently-visited first. Injected rather than
   * called directly so the provider stays free of the SDK — and so its ranking
   * can be tested without a server.
   *
   * Recency needs no score term of its own: equal-scoring rows break their tie
   * on input order, so the newer visit stays above the older one.
   */
  search: (
    args: OmniboxHistorySearchArgs,
  ) => Promise<readonly BrowserHistoryEntry[]>;
}

/**
 * Offers previously visited pages, from the browser's whole history store
 * rather than the current surface's recents — the store is server-side and
 * searchable, so the omnibox asks it per keystroke instead of ranking whatever
 * a window happened to keep.
 */
export function createOmniboxHistoryProvider(
  args: CreateOmniboxHistoryProviderArgs,
): OmniboxProvider {
  return {
    id: OMNIBOX_HISTORY_PROVIDER_ID,
    async suggest(
      query,
      context,
    ): Promise<readonly OmniboxProviderSuggestion[]> {
      const entries = await args.search({ query, signal: context.signal });
      const suggestions: OmniboxProviderSuggestion[] = [];
      for (const entry of entries) {
        // The store matched a substring; this decides how well, and drops rows
        // whose only match was somewhere the ranking does not count.
        const match = scoreOmniboxTextMatch({
          candidates: [entry.title, ...omniboxUrlMatchCandidates(entry.url)],
          query,
        });
        if (match === 0) {
          continue;
        }
        suggestions.push({
          action: { type: "navigate", url: entry.url },
          id: entry.url,
          kind: "history",
          score: match * OMNIBOX_HISTORY_SCORE_WEIGHT,
          subtitle: getBrowserUrlHost(entry.url),
          title: entry.title ?? entry.url,
        });
      }
      return suggestions;
    },
  };
}
