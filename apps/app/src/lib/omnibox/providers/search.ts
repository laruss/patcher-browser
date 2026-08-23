import { buildBrowserSearchUrl } from "@patcher/domain/browser-search-engine";
import { normalizeBrowserUrl } from "@/lib/browser-url";
import { OMNIBOX_DEFAULT_ACTION_SCORE } from "../default-action";
import type { OmniboxProvider, OmniboxProviderSuggestion } from "../types";

export const OMNIBOX_SEARCH_PROVIDER_ID = "search";

/**
 * Score for searching text that is *also* a valid address. It stays offered —
 * `github.com` is a plausible search — but below the address row and below the
 * list-filtering providers, because an address the user typed almost always
 * means "go there".
 */
const OMNIBOX_SEARCH_FALLBACK_SCORE = 0.4;

/**
 * Offers a search for the typed text. Always returns exactly one row: this is
 * the query the omnibox can always fall back to, and it takes the default-action
 * score whenever the text is not an address.
 *
 * There are no search *completions* here — that needs a suggest endpoint, which
 * would be the browser's first outbound call on every keystroke. Deliberately
 * deferred: it is a network and privacy decision, not an omnibox one, and the
 * provider interface is what makes adding it later a new file rather than an
 * edit to this one.
 */
export function createOmniboxSearchProvider(args: {
  /** The chosen engine's template — Patcher's own or one a plugin declared. */
  searchUrlTemplate: string;
}): OmniboxProvider {
  return {
    id: OMNIBOX_SEARCH_PROVIDER_ID,
    suggest(query): readonly OmniboxProviderSuggestion[] {
      return [
        {
          action: {
            type: "navigate",
            url: buildBrowserSearchUrl(query, args.searchUrlTemplate),
          },
          id: "query",
          kind: "search",
          score:
            normalizeBrowserUrl(query) === null
              ? OMNIBOX_DEFAULT_ACTION_SCORE
              : OMNIBOX_SEARCH_FALLBACK_SCORE,
          subtitle: null,
          title: query,
        },
      ];
    },
  };
}
