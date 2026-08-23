import { scoreOmniboxTextMatch } from "../match";
import type { OmniboxProvider, OmniboxProviderSuggestion } from "../types";

export const OMNIBOX_APP_ROUTES_PROVIDER_ID = "app-routes";

/**
 * Below the default action and below an already-open tab: typing a URL must
 * still go to that URL, and a destination that is already open is better
 * reached as the tab it is.
 */
const OMNIBOX_APP_ROUTES_SCORE_WEIGHT = 0.85;

export interface OmniboxAppRoute {
  /** Stable across runs so a longer query keeps the row's identity. */
  id: string;
  /** Extra words that should find this screen, beyond its own title. */
  keywords?: readonly string[];
  path: string;
  subtitle: string | null;
  title: string;
}

export interface CreateOmniboxAppRouteProviderArgs {
  routes: readonly OmniboxAppRoute[];
}

/**
 * Patcher's own screens, offered from the address bar the way Chromium offers its
 * settings pages: typing "extensions" should reach Extensions without knowing
 * that Patcher spells it `/tools/plugins`.
 *
 * The list is passed in rather than hard-coded, which is what lets a plugin's
 * panel appear here on the same footing as Settings — a plugin registers a
 * panel, and the panel is a destination like any other.
 */
export function createOmniboxAppRouteProvider({
  routes,
}: CreateOmniboxAppRouteProviderArgs): OmniboxProvider {
  return {
    id: OMNIBOX_APP_ROUTES_PROVIDER_ID,
    suggest(query): readonly OmniboxProviderSuggestion[] {
      const suggestions: OmniboxProviderSuggestion[] = [];
      for (const route of routes) {
        const match = scoreOmniboxTextMatch({
          candidates: [route.title, ...(route.keywords ?? [])],
          query,
        });
        if (match === 0) {
          continue;
        }
        suggestions.push({
          action: { type: "open-app-tab", path: route.path },
          id: route.id,
          kind: "navigate",
          score: match * OMNIBOX_APP_ROUTES_SCORE_WEIGHT,
          // Named rather than left as the kind's generic "Go": the row leads
          // out of the web and into Patcher, and the user should see that before
          // pressing Enter.
          sourceLabel: "Patcher",
          subtitle: route.subtitle,
          title: route.title,
        });
      }
      return suggestions;
    },
  };
}
