// Omnibox provider contract. Kept free of React and of any Patcher service so
// providers can be unit tested directly, and so the plugin-facing contribution
// point can be bridged onto this same interface later.

/** What selecting a suggestion does. */
export type OmniboxAction =
  | { type: "navigate"; url: string }
  | { type: "activate-tab"; tabId: string }
  /**
   * Go to one of Patcher's own screens — Settings, Extensions, a plugin's panel.
   * Distinct from `navigate` because the destination is a route, not a page:
   * it belongs to the window's router, and the surface opens or focuses its
   * tab rather than pointing a `WebContentsView` at it.
   */
  | { type: "open-app-tab"; path: string }
  /**
   * Call a plugin's `run(itemId)` back on the server and open whatever URL it
   * returns. The browser deliberately learns nothing about what the plugin
   * does — that is what makes the omnibox extensible without core changes.
   */
  | {
      type: "plugin-run";
      itemId: string;
      pluginId: string;
      providerId: string;
      /** The query this row was produced for; the plugin's action needs it. */
      query: string;
    };

export type OmniboxSuggestionKind =
  | "navigate"
  | "search"
  | "tab"
  | "history"
  | "plugin";

/** A suggestion as returned by a provider, before the controller stamps it. */
export interface OmniboxProviderSuggestion {
  action: OmniboxAction;
  /**
   * Stable within the provider, so a re-run for a longer query keeps the same
   * row identity instead of remounting it.
   */
  id: string;
  kind: OmniboxSuggestionKind;
  /**
   * Provider confidence, clamped to [0, 1] by the controller. Ranking is
   * score-first, so this is how a provider competes for a visible row.
   *
   * A score of 1 is reserved for the default action — what pressing Enter does
   * without an explicit selection (see `providers/navigation.ts`). Other
   * providers stay below 1 so the top row never disagrees with Enter.
   */
  score: number;
  /**
   * Overrides the kind's generic label on the row. Plugin providers set their
   * own name here so the user can see which source a suggestion came from.
   */
  sourceLabel?: string | null;
  subtitle: string | null;
  title: string;
}

/** A ranked suggestion, attributed to the provider that produced it. */
export interface OmniboxSuggestion extends OmniboxProviderSuggestion {
  providerId: string;
}

export interface OmniboxProviderContext {
  /**
   * Aborted when a newer query supersedes this run. Providers doing real I/O
   * must forward it; the controller also drops late results on its own, so
   * ignoring it wastes work but cannot corrupt the result set.
   */
  signal: AbortSignal;
}

export interface OmniboxProvider {
  id: string;
  /**
   * Called with a non-empty, trimmed query. May be synchronous — the controller
   * awaits either way. Throwing only drops this provider's results.
   */
  suggest: (
    query: string,
    context: OmniboxProviderContext,
  ) =>
    | readonly OmniboxProviderSuggestion[]
    | Promise<readonly OmniboxProviderSuggestion[]>;
}

/**
 * Identity of what a suggestion *does*, used to collapse duplicates across
 * providers (an open tab and a history entry for the same URL are one row).
 * The exhaustive switch makes a new action type a compile error here, which is
 * the intended place to decide how it deduplicates.
 */
export function omniboxActionKey(action: OmniboxAction): string {
  switch (action.type) {
    case "navigate":
      return `navigate:${action.url}`;
    case "activate-tab":
      return `activate-tab:${action.tabId}`;
    case "open-app-tab":
      return `open-app-tab:${action.path}`;
    case "plugin-run":
      // Two plugins offering "ask an agent" are two different offers, so the
      // plugin and provider are part of the identity, not just the item.
      return `plugin-run:${action.pluginId}:${action.providerId}:${action.itemId}`;
  }
}

/** React key / DOM id fragment for a ranked suggestion. */
export function omniboxSuggestionKey(suggestion: OmniboxSuggestion): string {
  return `${suggestion.providerId}:${suggestion.id}`;
}
