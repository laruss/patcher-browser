import { Icon, type IconName } from "@patcher/shared-ui/icon";
import { cn } from "@patcher/shared-ui/lib/utils";
import {
  omniboxSuggestionKey,
  type OmniboxSuggestion,
  type OmniboxSuggestionKind,
} from "@/lib/omnibox";

export interface BrowserOmniboxSuggestionsProps {
  /** `-1` means no row is selected, so Enter runs the default action. */
  highlightedIndex: number;
  listboxId: string;
  onHighlight: (index: number) => void;
  onSelect: (suggestion: OmniboxSuggestion) => void;
  optionId: (index: number) => string;
  suggestions: readonly OmniboxSuggestion[];
}

interface SuggestionKindPresentation {
  icon: IconName;
  label: string;
}

/**
 * Every row states which source produced it. That attribution is the point of
 * the omnibox rather than decoration: once plugins contribute suggestions, a
 * user must be able to see that a row came from a plugin and not from the
 * browser's own search.
 */
const SUGGESTION_KIND_PRESENTATION: Record<
  OmniboxSuggestionKind,
  SuggestionKindPresentation
> = {
  history: { icon: "Clock", label: "History" },
  navigate: { icon: "Globe", label: "Go" },
  // A plugin row's real source is its own label; this is only the fallback for
  // a provider that somehow contributed none.
  plugin: { icon: "Puzzle", label: "Plugin" },
  search: { icon: "Search", label: "Search" },
  tab: { icon: "Browser", label: "Tab" },
};

export function BrowserOmniboxSuggestions({
  highlightedIndex,
  listboxId,
  onHighlight,
  onSelect,
  optionId,
  suggestions,
}: BrowserOmniboxSuggestionsProps) {
  return (
    <ul
      // Part of the chrome's own layout rather than an overlay: a native
      // `WebContentsView` composites above the DOM, so anything drawn over the
      // page area would be invisible in the desktop app. See
      // docs/architecture/browser-surface.md.
      // Its width comes from the column it sits in — the address bar's — rather
      // than from the chrome, because a list spanning the window over a 400px
      // input reads as a different control than the one being typed into.
      className="max-h-[45vh] shrink-0 overflow-y-auto rounded-md border border-border bg-sidebar p-1"
      id={listboxId}
      role="listbox"
      aria-label="Address and search suggestions"
    >
      {suggestions.map((suggestion, index) => {
        const presentation = SUGGESTION_KIND_PRESENTATION[suggestion.kind];
        const isHighlighted = index === highlightedIndex;
        return (
          <li key={omniboxSuggestionKey(suggestion)}>
            <button
              type="button"
              id={optionId(index)}
              role="option"
              aria-selected={isHighlighted}
              // Keep focus in the input: a blur would tear the list down before
              // the click landed.
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onMouseEnter={() => {
                onHighlight(index);
              }}
              onClick={() => {
                onSelect(suggestion);
              }}
              className={cn(
                "flex w-full min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-xs",
                isHighlighted
                  ? "bg-state-hover text-foreground"
                  : "text-muted-foreground hover:bg-state-hover hover:text-foreground",
              )}
            >
              {/* Wide enough for the longest built-in label ("History") with
                  its icon: this column exists to be scanned down, and the
                  clipped "His…" it used to show is unscannable. A plugin's own
                  label can be any length, so the truncation stays as the cap for
                  that case.

                  Not covered by a test on purpose: CSS truncation is invisible
                  to jsdom, so a test asserting it would pass at any width. */}
              <span className="flex w-20 shrink-0 items-center gap-1.5 text-subtle-foreground">
                <Icon name={presentation.icon} aria-hidden />
                <span className="truncate">
                  {suggestion.sourceLabel ?? presentation.label}
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground">
                {suggestion.title}
              </span>
              {suggestion.subtitle === null ? null : (
                <span className="min-w-0 truncate font-mono text-muted-foreground [flex-shrink:9999]">
                  {suggestion.subtitle}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
