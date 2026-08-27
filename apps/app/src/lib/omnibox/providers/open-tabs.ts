import { getBrowserUrlHost, normalizeBrowserUrl } from "@/lib/browser-url";
import { omniboxUrlMatchCandidates, scoreOmniboxTextMatch } from "../match";
import type { OmniboxProvider, OmniboxProviderSuggestion } from "../types";

export const OMNIBOX_OPEN_TABS_PROVIDER_ID = "open-tabs";

/**
 * Ceiling for an open-tab row: below the default action, above history. A page
 * that is already loaded in another tab is the better answer than reopening it.
 */
const OMNIBOX_OPEN_TABS_SCORE_WEIGHT = 0.9;

export interface OmniboxOpenTab {
  id: string;
  title: string | null;
  url: string;
}

export interface CreateOmniboxOpenTabsProviderArgs {
  /**
   * Excluded from results: offering to switch to the tab the user is typing in
   * is a no-op row.
   */
  activeTabId: string | null;
  tabs: readonly OmniboxOpenTab[];
}

/**
 * Offers the open tabs whose title or URL matches, as tab switches rather than
 * navigations — the point is to not open a second copy of a page that is
 * already loaded.
 *
 * **Nothing is offered for a typed address.** Typing one is not a search for a
 * page, it is an instruction to go there, and the row that offered to switch to
 * a tab already showing it sat next to the address row carrying a different
 * kind of action — so the list answered a question the user had not asked, and
 * a stray selection turned Enter into a tab switch. The condition is the
 * navigation provider's own (`normalizeBrowserUrl`), so the rule reads as one
 * sentence: where the address row is, tab rows are not. Searching by name
 * (`docs`, `jira`) is untouched, and that is what this provider is for.
 *
 * Tabs with no URL yet (a fresh new-tab row) are skipped: there is nothing to
 * switch to.
 */
export function createOmniboxOpenTabsProvider(
  args: CreateOmniboxOpenTabsProviderArgs,
): OmniboxProvider {
  return {
    id: OMNIBOX_OPEN_TABS_PROVIDER_ID,
    suggest(query): readonly OmniboxProviderSuggestion[] {
      if (normalizeBrowserUrl(query) !== null) {
        return [];
      }
      const suggestions: OmniboxProviderSuggestion[] = [];
      for (const tab of args.tabs) {
        if (tab.id === args.activeTabId || tab.url.length === 0) {
          continue;
        }
        const match = scoreOmniboxTextMatch({
          candidates: [tab.title, ...omniboxUrlMatchCandidates(tab.url)],
          query,
        });
        if (match === 0) {
          continue;
        }
        suggestions.push({
          action: { type: "activate-tab", tabId: tab.id },
          id: tab.id,
          kind: "tab",
          score: match * OMNIBOX_OPEN_TABS_SCORE_WEIGHT,
          subtitle: getBrowserUrlHost(tab.url),
          title: tab.title ?? tab.url,
        });
      }
      return suggestions;
    },
  };
}
